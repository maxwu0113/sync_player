/**
 * WebSocket Signaling Server for Sync Player
 * 
 * This server enables cross-device video synchronization by relaying
 * messages between clients in the same room.
 */

const WebSocket = require('ws');
const http = require('http');

// Configuration
const PORT = process.env.PORT || 8080;

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', rooms: rooms.size }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Sync Player Signaling Server');
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store rooms and their connected clients
// Map<roomId, Set<WebSocket>>
const rooms = new Map();

// Store client info
// Map<WebSocket, { roomId: string }>
const clients = new Map();

/**
 * Generate a unique client ID
 * @returns {string} A unique identifier
 */
function generateClientId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Send a message to a WebSocket client
 * @param {WebSocket} ws - The WebSocket client
 * @param {object} message - The message to send
 */
function sendMessage(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast a message to all clients in a room except the sender
 * @param {string} roomId - The room ID
 * @param {object} message - The message to broadcast
 * @param {WebSocket} excludeClient - Optional client to exclude
 */
function broadcastToRoom(roomId, message, excludeClient = null) {
  const roomClients = rooms.get(roomId);
  if (!roomClients) return;

  roomClients.forEach((client) => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

/**
 * Handle a client joining a room
 * @param {WebSocket} ws - The WebSocket client
 * @param {string} roomId - The room ID to join
 */
function handleJoinRoom(ws, roomId) {
  // Leave any existing room first
  const clientInfo = clients.get(ws);
  if (clientInfo && clientInfo.roomId) {
    handleLeaveRoom(ws, clientInfo.roomId, false);
  }

  // Create room if it doesn't exist
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  // Add client to room
  const roomClients = rooms.get(roomId);
  roomClients.add(ws);

  // Update client info
  clients.set(ws, { roomId });

  // Notify the client they joined
  sendMessage(ws, {
    type: 'ROOM_JOINED',
    roomId: roomId,
    peerCount: roomClients.size
  });

  // Notify other clients in the room
  broadcastToRoom(roomId, {
    type: 'PEER_JOINED',
    peerCount: roomClients.size
  }, ws);

  console.log(`Client joined room ${roomId}. Room now has ${roomClients.size} clients.`);
}

/**
 * Handle a client leaving a room
 * @param {WebSocket} ws - The WebSocket client
 * @param {string} roomId - The room ID to leave
 * @param {boolean} notifyClient - Whether to notify the leaving client
 */
function handleLeaveRoom(ws, roomId, notifyClient = true) {
  const roomClients = rooms.get(roomId);
  if (!roomClients) return;

  // Remove client from room
  roomClients.delete(ws);

  // If room is empty, delete it
  if (roomClients.size === 0) {
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted (empty).`);
  } else {
    // Notify remaining clients
    broadcastToRoom(roomId, {
      type: 'PEER_LEFT',
      peerCount: roomClients.size
    });
  }

  // Update client info
  if (clients.has(ws)) {
    clients.set(ws, { roomId: null });
  }

  if (notifyClient) {
    sendMessage(ws, {
      type: 'ROOM_LEFT',
      roomId: roomId
    });
  }

  console.log(`Client left room ${roomId}. Room now has ${roomClients.size} clients.`);
}

/**
 * Handle video events from a client
 * @param {WebSocket} ws - The WebSocket client
 * @param {string} roomId - The room ID
 * @param {object} event - The video event
 */
function handleVideoEvent(ws, roomId, event) {
  broadcastToRoom(roomId, {
    type: 'VIDEO_EVENT',
    event: event
  }, ws);
}

/**
 * Handle sync video state from a client
 * @param {WebSocket} ws - The WebSocket client
 * @param {string} roomId - The room ID
 * @param {object} state - The video state
 */
function handleSyncVideoState(ws, roomId, state) {
  broadcastToRoom(roomId, {
    type: 'SYNC_VIDEO_STATE',
    state: state
  }, ws);
}

/**
 * Handle incoming WebSocket messages
 * @param {WebSocket} ws - The WebSocket client
 * @param {string} data - The raw message data
 */
function handleMessage(ws, data) {
  try {
    const message = JSON.parse(data);

    switch (message.type) {
      case 'JOIN_ROOM':
        if (message.roomId) {
          handleJoinRoom(ws, message.roomId);
        } else {
          sendMessage(ws, { type: 'ERROR', error: 'Room ID is required' });
        }
        break;

      case 'LEAVE_ROOM':
        if (message.roomId) {
          handleLeaveRoom(ws, message.roomId);
        }
        break;

      case 'VIDEO_EVENT':
        if (message.roomId && message.event) {
          handleVideoEvent(ws, message.roomId, message.event);
        }
        break;

      case 'SYNC_VIDEO_STATE':
        if (message.roomId && message.state) {
          handleSyncVideoState(ws, message.roomId, message.state);
        }
        break;

      default:
        sendMessage(ws, { type: 'ERROR', error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('Error parsing message:', error);
    sendMessage(ws, { type: 'ERROR', error: 'Invalid message format' });
  }
}

/**
 * Handle client disconnection
 * @param {WebSocket} ws - The WebSocket client
 */
function handleDisconnect(ws) {
  const clientInfo = clients.get(ws);
  if (clientInfo && clientInfo.roomId) {
    handleLeaveRoom(ws, clientInfo.roomId, false);
  }
  clients.delete(ws);
  console.log('Client disconnected.');
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('New client connected.');
  
  // Initialize client info
  clients.set(ws, { roomId: null });

  // Send welcome message
  sendMessage(ws, { type: 'CONNECTED' });

  // Handle messages
  ws.on('message', (data) => handleMessage(ws, data.toString()));

  // Handle disconnection
  ws.on('close', () => handleDisconnect(ws));

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    handleDisconnect(ws);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Sync Player Signaling Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  
  // Close all client connections
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });
  
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
