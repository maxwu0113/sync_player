/**
 * Tests for WebSocket Signaling Server
 * 
 * Run with: npm test
 */

const WebSocket = require('ws');
const http = require('http');
const assert = require('assert');

// Test configuration
const TEST_PORT = 8081;
const WS_URL = `ws://localhost:${TEST_PORT}`;
const HTTP_URL = `http://localhost:${TEST_PORT}`;

// Import server code (we'll need to modify how we start it for testing)
let server;
let wss;
let rooms;
let clients;

/**
 * Helper to create a WebSocket client and wait for CONNECTED message
 * @returns {Promise<{ws: WebSocket, connectedMsg: object}>}
 */
function createClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 5000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'CONNECTED') {
          clearTimeout(timeout);
          resolve({ ws, connectedMsg: msg });
        }
      } catch (e) {
        // Continue waiting
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Helper to wait for a specific message type
 * @param {WebSocket} ws 
 * @param {string} type 
 * @param {number} timeout 
 * @returns {Promise<object>}
 */
function waitForMessage(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeout);

    function handler(data) {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === type) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(message);
        }
      } catch (e) {
        // Continue waiting
      }
    }

    ws.on('message', handler);
  });
}

/**
 * Helper to send a message and wait for response
 * @param {WebSocket} ws 
 * @param {object} message 
 * @param {string} expectedType 
 * @returns {Promise<object>}
 */
async function sendAndWait(ws, message, expectedType) {
  const responsePromise = waitForMessage(ws, expectedType);
  ws.send(JSON.stringify(message));
  return responsePromise;
}

// Start server before tests
function startServer() {
  return new Promise((resolve) => {
    const httpServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', rooms: rooms.size }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Sync Player Signaling Server');
      }
    });

    rooms = new Map();
    clients = new Map();
    wss = new WebSocket.Server({ server: httpServer });

    wss.on('connection', (ws) => {
      clients.set(ws, { roomId: null, userId: null, username: null });
      ws.send(JSON.stringify({ type: 'CONNECTED' }));

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleMessage(ws, message);
        } catch (error) {
          ws.send(JSON.stringify({ type: 'ERROR', error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        const clientInfo = clients.get(ws);
        if (clientInfo && clientInfo.roomId) {
          leaveRoom(ws, clientInfo.roomId, false);
        }
        clients.delete(ws);
      });
    });

    server = httpServer;
    httpServer.listen(TEST_PORT, () => {
      resolve();
    });
  });
}

function handleMessage(ws, message) {
  switch (message.type) {
    case 'JOIN_ROOM':
      if (message.roomId) {
        joinRoom(ws, message.roomId, message.userId, message.username);
      } else {
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Room ID is required' }));
      }
      break;
    case 'LEAVE_ROOM':
      if (message.roomId) {
        leaveRoom(ws, message.roomId);
      }
      break;
    case 'VIDEO_EVENT':
      if (message.roomId && message.event) {
        broadcastToRoom(message.roomId, { type: 'VIDEO_EVENT', event: message.event }, ws);
      }
      break;
    case 'SYNC_VIDEO_STATE':
      if (message.roomId && message.state) {
        broadcastToRoom(message.roomId, { type: 'SYNC_VIDEO_STATE', state: message.state }, ws);
      }
      break;
    default:
      ws.send(JSON.stringify({ type: 'ERROR', error: 'Unknown message type' }));
  }
}

function joinRoom(ws, roomId, userId, username) {
  const clientInfo = clients.get(ws);
  if (clientInfo && clientInfo.roomId) {
    leaveRoom(ws, clientInfo.roomId, false);
  }

  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  const roomClients = rooms.get(roomId);
  roomClients.add(ws);
  clients.set(ws, { roomId, userId: userId || 'test-user', username: username || 'Anonymous' });

  const users = getRoomUsers(roomId);
  ws.send(JSON.stringify({ type: 'ROOM_JOINED', roomId, peerCount: roomClients.size, users }));
  broadcastToRoom(roomId, { type: 'PEER_JOINED', peerCount: roomClients.size, users }, ws);
}

function getRoomUsers(roomId) {
  const roomClients = rooms.get(roomId);
  if (!roomClients) return [];
  
  const users = [];
  roomClients.forEach((client) => {
    const clientInfo = clients.get(client);
    if (clientInfo) {
      users.push({
        id: clientInfo.userId || 'unknown',
        name: clientInfo.username || 'Anonymous'
      });
    }
  });
  return users;
}

function leaveRoom(ws, roomId, notifyClient = true) {
  const roomClients = rooms.get(roomId);
  if (!roomClients) return;

  roomClients.delete(ws);

  if (roomClients.size === 0) {
    rooms.delete(roomId);
  } else {
    const users = getRoomUsers(roomId);
    broadcastToRoom(roomId, { type: 'PEER_LEFT', peerCount: roomClients.size, users });
  }

  const clientInfo = clients.get(ws);
  if (clientInfo) {
    clientInfo.roomId = null;
  }

  if (notifyClient) {
    ws.send(JSON.stringify({ type: 'ROOM_LEFT', roomId }));
  }
}

function broadcastToRoom(roomId, message, excludeClient = null) {
  const roomClients = rooms.get(roomId);
  if (!roomClients) return;

  roomClients.forEach((client) => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Stop server after tests
function stopServer() {
  return new Promise((resolve) => {
    wss.clients.forEach((client) => {
      client.close();
    });
    server.close(() => {
      resolve();
    });
  });
}

// Test cases
async function runTests() {
  console.log('Starting WebSocket Server Tests...\n');

  await startServer();
  console.log('✓ Server started on port', TEST_PORT);

  let passed = 0;
  let failed = 0;

  try {
    // Test 1: Health check endpoint
    console.log('\nTest 1: Health check endpoint');
    const healthResponse = await new Promise((resolve, reject) => {
      http.get(`${HTTP_URL}/health`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
    assert.strictEqual(healthResponse.status, 'healthy');
    console.log('✓ Health check returns healthy status');
    passed++;

    // Test 2: Client connection
    console.log('\nTest 2: Client connection');
    const { ws: client1, connectedMsg } = await createClient();
    assert.strictEqual(connectedMsg.type, 'CONNECTED');
    console.log('✓ Client receives CONNECTED message on connection');
    passed++;

    // Test 3: Join room
    console.log('\nTest 3: Join room');
    const roomId = 'TEST01';
    const joinResponse = await sendAndWait(client1, { type: 'JOIN_ROOM', roomId }, 'ROOM_JOINED');
    assert.strictEqual(joinResponse.roomId, roomId);
    assert.strictEqual(joinResponse.peerCount, 1);
    console.log('✓ Client can join a room');
    passed++;

    // Test 4: Second client joins same room
    console.log('\nTest 4: Second client joins same room');
    const { ws: client2 } = await createClient();
    
    const peerJoinPromise = waitForMessage(client1, 'PEER_JOINED');
    const join2Response = await sendAndWait(client2, { type: 'JOIN_ROOM', roomId }, 'ROOM_JOINED');
    const peerJoinMsg = await peerJoinPromise;
    
    assert.strictEqual(join2Response.peerCount, 2);
    assert.strictEqual(peerJoinMsg.peerCount, 2);
    console.log('✓ Second client joins and first client receives PEER_JOINED');
    passed++;

    // Test 5: Video event broadcast
    console.log('\nTest 5: Video event broadcast');
    const videoEvent = { eventType: 'play', currentTime: 10.5, timestamp: Date.now() };
    const videoEventPromise = waitForMessage(client2, 'VIDEO_EVENT');
    client1.send(JSON.stringify({ type: 'VIDEO_EVENT', roomId, event: videoEvent }));
    const receivedEvent = await videoEventPromise;
    
    assert.strictEqual(receivedEvent.event.eventType, 'play');
    assert.strictEqual(receivedEvent.event.currentTime, 10.5);
    console.log('✓ Video events are broadcast to other clients in the room');
    passed++;

    // Test 6: Sync video state
    console.log('\nTest 6: Sync video state');
    const syncState = { currentTime: 25.0, paused: false, playbackRate: 1.5, timestamp: Date.now() };
    const syncStatePromise = waitForMessage(client1, 'SYNC_VIDEO_STATE');
    client2.send(JSON.stringify({ type: 'SYNC_VIDEO_STATE', roomId, state: syncState }));
    const receivedState = await syncStatePromise;
    
    assert.strictEqual(receivedState.state.currentTime, 25.0);
    assert.strictEqual(receivedState.state.playbackRate, 1.5);
    console.log('✓ Sync video state is broadcast correctly');
    passed++;

    // Test 7: Leave room
    console.log('\nTest 7: Leave room');
    const peerLeftPromise = waitForMessage(client1, 'PEER_LEFT');
    const leaveResponse = await sendAndWait(client2, { type: 'LEAVE_ROOM', roomId }, 'ROOM_LEFT');
    const peerLeftMsg = await peerLeftPromise;
    
    assert.strictEqual(leaveResponse.roomId, roomId);
    assert.strictEqual(peerLeftMsg.peerCount, 1);
    console.log('✓ Client can leave room and others receive PEER_LEFT');
    passed++;

    // Test 8: Error handling - join without room ID
    console.log('\nTest 8: Error handling');
    const errorResponse = await sendAndWait(client1, { type: 'JOIN_ROOM' }, 'ERROR');
    assert.strictEqual(errorResponse.type, 'ERROR');
    console.log('✓ Server sends ERROR for invalid requests');
    passed++;

    // Test 9: Users list with usernames
    console.log('\nTest 9: Users list with usernames');
    const roomId2 = 'TEST02';
    const { ws: client3 } = await createClient();
    const { ws: client4 } = await createClient();
    
    // Client 3 joins with username
    const join3Response = await sendAndWait(client3, { 
      type: 'JOIN_ROOM', 
      roomId: roomId2,
      userId: 'user1',
      username: 'Alice'
    }, 'ROOM_JOINED');
    
    assert.strictEqual(join3Response.users.length, 1);
    assert.strictEqual(join3Response.users[0].name, 'Alice');
    
    // Client 4 joins with username
    const peer3JoinPromise = waitForMessage(client3, 'PEER_JOINED');
    const join4Response = await sendAndWait(client4, { 
      type: 'JOIN_ROOM', 
      roomId: roomId2,
      userId: 'user2',
      username: 'Bob'
    }, 'ROOM_JOINED');
    const peer3JoinMsg = await peer3JoinPromise;
    
    assert.strictEqual(join4Response.users.length, 2);
    assert.strictEqual(peer3JoinMsg.users.length, 2);
    
    // Check that both users are in the list
    const userNames = join4Response.users.map(u => u.name);
    assert.ok(userNames.includes('Alice'), 'Alice should be in the users list');
    assert.ok(userNames.includes('Bob'), 'Bob should be in the users list');
    
    console.log('✓ Users list is correctly populated with usernames');
    passed++;

    // Cleanup
    client1.close();
    client2.close();
    client3.close();
    client4.close();

  } catch (error) {
    console.log('✗ Test failed:', error.message);
    failed++;
  }

  await stopServer();
  console.log('\n========================================');
  console.log(`Tests completed: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
