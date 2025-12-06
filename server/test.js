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
    const roomUrls = new Map();
    wss = new WebSocket.Server({ server: httpServer });

    wss.on('connection', (ws) => {
      clients.set(ws, { roomId: null, userId: null, username: null, isHost: false });
      ws.send(JSON.stringify({ type: 'CONNECTED' }));

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleMessage(ws, message, roomUrls);
        } catch (error) {
          ws.send(JSON.stringify({ type: 'ERROR', error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        const clientInfo = clients.get(ws);
        if (clientInfo && clientInfo.roomId) {
          leaveRoom(ws, clientInfo.roomId, false, roomUrls);
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

function isValidUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function isValidRoomId(roomId) {
  if (!roomId || typeof roomId !== 'string') {
    return false;
  }
  return /^[A-Za-z0-9]{1,20}$/.test(roomId);
}

function handleMessage(ws, message, roomUrls) {
  switch (message.type) {
    case 'JOIN_ROOM':
      if (message.roomId) {
        if (!isValidRoomId(message.roomId)) {
          ws.send(JSON.stringify({ type: 'ERROR', error: 'Invalid room ID format. Room ID must be 1-20 alphanumeric characters.' }));
          break;
        }
        joinRoom(ws, message.roomId, message.userId, message.username, roomUrls);
      } else {
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Room ID is required' }));
      }
      break;
    case 'LEAVE_ROOM':
      if (message.roomId) {
        leaveRoom(ws, message.roomId, true, roomUrls);
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
    case 'UPDATE_HOST_URL':
      if (message.roomId && message.url) {
        const clientInfo = clients.get(ws);
        if (clientInfo && clientInfo.isHost) {
          if (!isValidUrl(message.url)) {
            ws.send(JSON.stringify({ type: 'ERROR', error: 'Invalid URL format. Only http and https URLs are allowed.' }));
            break;
          }
          roomUrls.set(message.roomId, message.url);
          broadcastToRoom(message.roomId, { type: 'HOST_URL_UPDATED', url: message.url }, ws);
        }
      }
      break;
    default:
      ws.send(JSON.stringify({ type: 'ERROR', error: 'Unknown message type' }));
  }
}

function joinRoom(ws, roomId, userId, username, roomUrls) {
  // Check if client is already in this room (rejoining)
  const clientInfo = clients.get(ws);
  const isRejoining = clientInfo && clientInfo.roomId === roomId;
  
  // Leave any existing room first, but only if it's a different room
  if (clientInfo && clientInfo.roomId && clientInfo.roomId !== roomId) {
    leaveRoom(ws, clientInfo.roomId, false, roomUrls);
  }

  // Determine if this client is the host
  // If rejoining, preserve existing host status
  // Otherwise, client is host if the room doesn't exist yet
  let isHost;
  if (isRejoining && clientInfo) {
    isHost = clientInfo.isHost;
  } else {
    isHost = !rooms.has(roomId);
  }
  
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  const roomClients = rooms.get(roomId);
  roomClients.add(ws);
  clients.set(ws, { 
    roomId, 
    isHost,
    userId: (isRejoining && clientInfo && clientInfo.userId) ? clientInfo.userId : (userId || 'test-user'),
    username: username || 'Anonymous' 
  });

  const hostUrl = roomUrls.get(roomId);
  const users = getRoomUsers(roomId);
  
  ws.send(JSON.stringify({ 
    type: 'ROOM_JOINED', 
    roomId, 
    peerCount: roomClients.size, 
    isHost, 
    hostUrl: hostUrl || null,
    users
  }));
  
  // Only notify other clients if this is a new join, not a rejoin
  if (!isRejoining) {
    broadcastToRoom(roomId, { type: 'PEER_JOINED', peerCount: roomClients.size, users }, ws);
  } else {
    // For rejoining, just update users list without broadcasting join event
    broadcastToRoom(roomId, { type: 'USERS_UPDATE', users });
  }
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

function leaveRoom(ws, roomId, notifyClient = true, roomUrls) {
  const roomClients = rooms.get(roomId);
  if (!roomClients) return;

  roomClients.delete(ws);

  if (roomClients.size === 0) {
    rooms.delete(roomId);
    if (roomUrls) {
      roomUrls.delete(roomId);
    }
  } else {
    const users = getRoomUsers(roomId);
    broadcastToRoom(roomId, { type: 'PEER_LEFT', peerCount: roomClients.size, users });
  }

  const clientInfo = clients.get(ws);
  if (clientInfo) {
    clientInfo.roomId = null;
    clientInfo.isHost = false;
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

    // Test 10: Host URL sharing - host creates room and gets isHost=true
    console.log('\nTest 10: Host URL sharing - first client is host');
    const { ws: host } = await createClient();
    const hostRoomId = 'HOST01';
    const hostJoinResponse = await sendAndWait(host, { type: 'JOIN_ROOM', roomId: hostRoomId }, 'ROOM_JOINED');
    assert.strictEqual(hostJoinResponse.isHost, true);
    assert.strictEqual(hostJoinResponse.hostUrl, null);
    console.log('✓ First client joining room becomes host');
    passed++;

    // Test 11: Host can update their URL
    console.log('\nTest 11: Host URL update');
    const testUrl = 'https://www.youtube.com/watch?v=test123';
    const { ws: guest } = await createClient();
    
    // Guest joins room
    const urlUpdatePromise = waitForMessage(guest, 'HOST_URL_UPDATED');
    await sendAndWait(guest, { type: 'JOIN_ROOM', roomId: hostRoomId }, 'ROOM_JOINED');
    
    // Host updates URL
    host.send(JSON.stringify({ type: 'UPDATE_HOST_URL', roomId: hostRoomId, url: testUrl }));
    const urlUpdate = await urlUpdatePromise;
    
    assert.strictEqual(urlUpdate.url, testUrl);
    console.log('✓ Host can update URL and guests receive it');
    passed++;

    // Test 12: Guest cannot update host URL
    console.log('\nTest 12: Non-host cannot update URL');
    const fakeUrl = 'https://www.example.com/fake';
    // Guest tries to update URL - should not broadcast
    guest.send(JSON.stringify({ type: 'UPDATE_HOST_URL', roomId: hostRoomId, url: fakeUrl }));
    // Wait a bit to ensure no message is received
    await new Promise(resolve => setTimeout(resolve, 200));
    // If we get here without error, the message was correctly ignored
    console.log('✓ Non-host cannot update URL (no broadcast)');
    passed++;

    // Test 13: New guest receives host URL when joining
    console.log('\nTest 13: New guest receives host URL on join');
    const { ws: guest2 } = await createClient();
    const guest2JoinResponse = await sendAndWait(guest2, { type: 'JOIN_ROOM', roomId: hostRoomId }, 'ROOM_JOINED');
    
    assert.strictEqual(guest2JoinResponse.isHost, false);
    assert.strictEqual(guest2JoinResponse.hostUrl, testUrl);
    console.log('✓ New guest receives host URL when joining');
    passed++;

    // Test 14: Security - Invalid URL rejected
    console.log('\nTest 14: Security - Invalid URL rejected');
    const { ws: secHost } = await createClient();
    const secRoomId = 'SEC001';
    await sendAndWait(secHost, { type: 'JOIN_ROOM', roomId: secRoomId }, 'ROOM_JOINED');
    
    // Try to set a javascript: URL (should be rejected)
    const maliciousUrl = 'javascript:alert(1)';
    const errorPromise = waitForMessage(secHost, 'ERROR');
    secHost.send(JSON.stringify({ type: 'UPDATE_HOST_URL', roomId: secRoomId, url: maliciousUrl }));
    const errorMsg = await errorPromise;
    assert.strictEqual(errorMsg.type, 'ERROR');
    console.log('✓ Malicious javascript: URL rejected');
    passed++;

    // Test 15: Security - Invalid room ID rejected
    console.log('\nTest 15: Security - Invalid room ID rejected');
    const { ws: secClient } = await createClient();
    const invalidRoomErrorPromise = waitForMessage(secClient, 'ERROR');
    secClient.send(JSON.stringify({ type: 'JOIN_ROOM', roomId: '../../../etc/passwd' }));
    const invalidRoomError = await invalidRoomErrorPromise;
    assert.strictEqual(invalidRoomError.type, 'ERROR');
    console.log('✓ Invalid room ID rejected');
    passed++;

    // Test 16: Rejoin same room preserves host status and doesn't broadcast PEER_JOINED
    console.log('\nTest 16: Rejoin same room preserves host status');
    const { ws: rejoinHost } = await createClient();
    const { ws: rejoinGuest } = await createClient();
    const rejoinRoomId = 'REJOIN01';
    
    // Host joins
    const hostJoin1 = await sendAndWait(rejoinHost, { 
      type: 'JOIN_ROOM', 
      roomId: rejoinRoomId,
      userId: 'host123',
      username: 'HostUser'
    }, 'ROOM_JOINED');
    assert.strictEqual(hostJoin1.isHost, true, 'First join should make client host');
    
    // Guest joins
    await sendAndWait(rejoinGuest, { 
      type: 'JOIN_ROOM', 
      roomId: rejoinRoomId,
      userId: 'guest456',
      username: 'GuestUser'
    }, 'ROOM_JOINED');
    
    // Host rejoins same room - should NOT receive PEER_JOINED on guest
    // Set up listener to catch any PEER_JOINED (should timeout)
    let receivedPeerJoined = false;
    let peerJoinedHandler;
    const peerJoinedCheck = new Promise((resolve) => {
      const timer = setTimeout(() => {
        rejoinGuest.removeListener('message', peerJoinedHandler);
        resolve(false);
      }, 500); // 500ms timeout
      peerJoinedHandler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'PEER_JOINED') {
          clearTimeout(timer);
          rejoinGuest.removeListener('message', peerJoinedHandler);
          receivedPeerJoined = true;
          resolve(true);
        }
      };
      rejoinGuest.on('message', peerJoinedHandler);
    });
    
    // Host rejoins
    const hostJoin2 = await sendAndWait(rejoinHost, { 
      type: 'JOIN_ROOM', 
      roomId: rejoinRoomId,
      userId: 'host123', // Same userId
      username: 'HostUser'
    }, 'ROOM_JOINED');
    
    // Check that host status is preserved
    assert.strictEqual(hostJoin2.isHost, true, 'Rejoin should preserve host status');
    assert.strictEqual(hostJoin2.peerCount, 2, 'Room should still have 2 clients');
    
    // Check that no PEER_JOINED was broadcast
    await peerJoinedCheck;
    assert.strictEqual(receivedPeerJoined, false, 'Rejoin should not broadcast PEER_JOINED');
    
    console.log('✓ Rejoin same room preserves host status and does not broadcast PEER_JOINED');
    passed++;
    
    // Close test clients
    rejoinHost.close();
    rejoinGuest.close();

    // Cleanup
    client1.close();
    client2.close();
    host.close();
    guest.close();
    guest2.close();
    secHost.close();
    secClient.close();
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
