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

// Map<WebSocket, { roomId: string, userId: string, username: string, isHost: boolean }>
const clients = new Map();

// Store room host URLs
// Map<roomId, string>
const roomUrls = new Map();

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
 * Get the list of users in a room
 * @param {string} roomId - The room ID
 * @returns {Array} List of users with id and name
 */
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

/**
 * Handle a client joining a room
 * @param {WebSocket} ws - The WebSocket client
 * @param {string} roomId - The room ID to join
 * @param {string} userId - The user's ID
 * @param {string} username - The user's display name
 */
function handleJoinRoom(ws, roomId, userId, username) {
  // Check if client is already in this room (rejoining)
  const clientInfo = clients.get(ws);
  const isRejoining = clientInfo && clientInfo.roomId === roomId;
  
  // Leave any existing room first, but only if it's a different room
  if (clientInfo && clientInfo.roomId && clientInfo.roomId !== roomId) {
    handleLeaveRoom(ws, clientInfo.roomId, false);
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

  // Create room if it doesn't exist
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  // Add client to room (Set.add is idempotent, won't duplicate)
  const roomClients = rooms.get(roomId);
  roomClients.add(ws);

  // Update client info with user details, preserving userId if rejoining
  clients.set(ws, { 
    roomId, 
    userId: (isRejoining && clientInfo && clientInfo.userId) ? clientInfo.userId : (userId || generateClientId()),
    username: username || 'Anonymous',
    isHost
  });

  // Get the updated users list
  const users = getRoomUsers(roomId);

  // Get the host URL if available
  const hostUrl = roomUrls.get(roomId);

  // Notify the client they joined, including host URL if available
  sendMessage(ws, {
    type: 'ROOM_JOINED',
    roomId: roomId,
    peerCount: roomClients.size,
    isHost: isHost,
    hostUrl: hostUrl || null,
    users: users
  });

  // Only notify other clients if this is a new join, not a rejoin
  if (!isRejoining) {
    broadcastToRoom(roomId, {
      type: 'PEER_JOINED',
      peerCount: roomClients.size,
      users: users
    }, ws);
    console.log(`Client ${username || 'Anonymous'} (${userId}) joined room ${roomId}. Room now has ${roomClients.size} clients. isHost: ${isHost}`);
  } else {
    // For rejoining, just update users list without broadcasting join event
    broadcastToRoom(roomId, {
      type: 'USERS_UPDATE',
      users: users
    });
    console.log(`Client ${username || 'Anonymous'} (${userId}) rejoined room ${roomId}. Room has ${roomClients.size} clients. isHost: ${isHost}`);
  }
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

  // Get username for logging before removing
  const clientInfo = clients.get(ws);
  const username = clientInfo ? clientInfo.username : 'Unknown';

  // Remove client from room
  roomClients.delete(ws);

  // If room is empty, delete it and clean up room URL
  if (roomClients.size === 0) {
    rooms.delete(roomId);
    roomUrls.delete(roomId);
    console.log(`Room ${roomId} deleted (empty).`);
  } else {
    // Get the updated users list
    const users = getRoomUsers(roomId);
    
    // Notify remaining clients
    broadcastToRoom(roomId, {
      type: 'PEER_LEFT',
      peerCount: roomClients.size,
      users: users
    });
  }

  // Clear client's room association but keep userId and username
  if (clientInfo) {
    clientInfo.roomId = null;
    clientInfo.isHost = false;
  }

  if (notifyClient) {
    sendMessage(ws, {
      type: 'ROOM_LEFT',
      roomId: roomId
    });
  }

  console.log(`Client ${username} left room ${roomId}. Room now has ${roomClients ? roomClients.size : 0} clients.`);
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
 * Validate that a URL is safe (http or https only)
 * @param {string} url - The URL to validate
 * @returns {boolean} True if the URL is safe
 */
function isValidUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  // Only allow http and https protocols
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/**
 * Validate room ID format (alphanumeric, 6 characters)
 * @param {string} roomId - The room ID to validate
 * @returns {boolean} True if the room ID is valid
 */
function isValidRoomId(roomId) {
  if (!roomId || typeof roomId !== 'string') {
    return false;
  }
  // Allow alphanumeric room IDs between 1-20 characters
  return /^[A-Za-z0-9]{1,20}$/.test(roomId);
}

/**
 * Handle host URL update from a client
 * @param {WebSocket} ws - The WebSocket client
 * @param {string} roomId - The room ID
 * @param {string} url - The current video page URL
 */
function handleUpdateHostUrl(ws, roomId, url) {
  const clientInfo = clients.get(ws);
  // Only allow host to update URL
  if (clientInfo && clientInfo.isHost) {
    // Validate URL before storing and broadcasting
    if (!isValidUrl(url)) {
      console.log(`Invalid URL rejected for room ${roomId}: ${url}`);
      sendMessage(ws, { type: 'ERROR', error: 'Invalid URL format. Only http and https URLs are allowed.' });
      return;
    }
    
    roomUrls.set(roomId, url);
    // Broadcast the URL to all other clients in the room
    broadcastToRoom(roomId, {
      type: 'HOST_URL_UPDATED',
      url: url
    }, ws);
    console.log(`Host URL updated for room ${roomId}: ${url}`);
  }
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
          // Validate room ID format
          if (!isValidRoomId(message.roomId)) {
            sendMessage(ws, { type: 'ERROR', error: 'Invalid room ID format. Room ID must be 1-20 alphanumeric characters.' });
            break;
          }
          handleJoinRoom(ws, message.roomId, message.userId, message.username);
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

      case 'UPDATE_HOST_URL':
        if (message.roomId && message.url) {
          handleUpdateHostUrl(ws, message.roomId, message.url);
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
  
  // Initialize client info with isHost: false (will be set when joining a room)
  clients.set(ws, { roomId: null, userId: null, username: null, isHost: false });

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

// Graceful shutdown handler
function gracefulShutdown() {
  console.log('Shutting down gracefully...');
  
  // Close all client connections
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });
  
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
}

// Handle termination signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
