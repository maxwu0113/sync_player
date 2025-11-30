/**
 * Background service worker for Sync Player Chrome extension.
 * Handles communication between tabs and manages synchronization state.
 * Supports cross-device synchronization via WebSocket signaling server.
 */

// Store the current room information
let currentRoom = null;
// Store connected peers
let connectedPeers = new Map();
// WebSocket connection for real-time sync
let wsConnection = null;
// Reconnection settings
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;
// Default signaling server URL
// Users can host their own server using the code in /server directory
// and change this URL to point to their server
const DEFAULT_SIGNALING_SERVER = 'wss://sync-player-server.glitch.me';
let signalingServerUrl = DEFAULT_SIGNALING_SERVER;

/**
 * Generate a unique room ID using cryptographically secure random values
 * @returns {string} A random 6-character room ID
 */
function generateRoomId() {
  const array = new Uint8Array(4);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map(b => b.toString(36))
    .join('')
    .substring(0, 6)
    .toUpperCase();
}

/**
 * Connect to the signaling server for cross-device sync
 * @param {string} roomId - The room ID to join
 */
function connectToSignalingServer(roomId) {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    // Already connected, just join the room
    wsConnection.send(JSON.stringify({
      type: 'JOIN_ROOM',
      roomId: roomId
    }));
    return;
  }

  try {
    wsConnection = new WebSocket(signalingServerUrl);

    wsConnection.onopen = () => {
      console.log('Sync Player: Connected to signaling server');
      reconnectAttempts = 0;
      
      // Join the room
      wsConnection.send(JSON.stringify({
        type: 'JOIN_ROOM',
        roomId: roomId
      }));

      // Notify all tabs about connection status
      broadcastConnectionStatus(true);
    };

    wsConnection.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleSignalingMessage(message);
      } catch (error) {
        console.error('Sync Player: Error parsing signaling message:', error);
      }
    };

    wsConnection.onerror = (error) => {
      console.error('Sync Player: WebSocket error:', error);
      broadcastConnectionStatus(false);
    };

    wsConnection.onclose = () => {
      console.log('Sync Player: Disconnected from signaling server');
      broadcastConnectionStatus(false);
      
      // Attempt to reconnect if still in a room
      if (currentRoom && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        // Use exponential backoff with jitter to avoid thundering herd
        const backoffDelay = RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1) + Math.random() * 1000;
        console.log(`Sync Player: Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${Math.round(backoffDelay)}ms`);
        setTimeout(() => {
          if (currentRoom) {
            connectToSignalingServer(currentRoom.id);
          }
        }, backoffDelay);
      }
    };
  } catch (error) {
    console.error('Sync Player: Error connecting to signaling server:', error);
    broadcastConnectionStatus(false);
  }
}

/**
 * Disconnect from the signaling server
 */
function disconnectFromSignalingServer() {
  if (wsConnection) {
    // Send leave message before closing
    if (wsConnection.readyState === WebSocket.OPEN && currentRoom) {
      wsConnection.send(JSON.stringify({
        type: 'LEAVE_ROOM',
        roomId: currentRoom.id
      }));
    }
    wsConnection.close();
    wsConnection = null;
  }
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
  broadcastConnectionStatus(false);
}

/**
 * Handle messages from the signaling server
 * @param {object} message - The message from the server
 */
function handleSignalingMessage(message) {
  switch (message.type) {
    case 'ROOM_JOINED':
      console.log(`Sync Player: Joined room ${message.roomId} with ${message.peerCount} peers`);
      if (currentRoom) {
        currentRoom.peerCount = message.peerCount;
      }
      break;

    case 'PEER_JOINED':
      console.log('Sync Player: A peer joined the room');
      if (currentRoom) {
        currentRoom.peerCount = message.peerCount;
      }
      break;

    case 'PEER_LEFT':
      console.log('Sync Player: A peer left the room');
      if (currentRoom) {
        currentRoom.peerCount = message.peerCount;
      }
      break;

    case 'VIDEO_EVENT':
      // Received a video event from another device
      handleRemoteVideoEvent(message.event);
      break;

    case 'SYNC_VIDEO_STATE':
      // Received sync state from another device
      handleRemoteSyncState(message.state);
      break;

    case 'ERROR':
      console.error('Sync Player: Server error:', message.error);
      break;
  }
}

/**
 * Handle video events from remote devices
 * @param {object} event - The video event
 */
function handleRemoteVideoEvent(event) {
  // Broadcast to all local tabs
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'VIDEO_EVENT',
        event: event
      }).catch(() => {
        // Ignore errors for tabs without content script
      });
    });
  });
}

/**
 * Handle sync state from remote devices
 * @param {object} state - The video state
 */
function handleRemoteSyncState(state) {
  // Apply state to all local tabs
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_VIDEO_STATE',
        state: state
      }).catch(() => {
        // Ignore errors for tabs without content script
      });
    });
  });
}

/**
 * Broadcast connection status to all tabs
 * @param {boolean} connected - Whether connected to signaling server
 */
function broadcastConnectionStatus(connected) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'CONNECTION_STATUS',
        connected: connected
      }).catch(() => {
        // Ignore errors
      });
    });
  });
}

/**
 * Send a video event to the signaling server for cross-device sync
 * @param {object} event - The video event to send
 */
function sendVideoEventToServer(event) {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN && currentRoom) {
    wsConnection.send(JSON.stringify({
      type: 'VIDEO_EVENT',
      roomId: currentRoom.id,
      event: event
    }));
  }
}

/**
 * Send sync state to the signaling server for cross-device sync
 * @param {object} state - The video state to send
 */
function sendSyncStateToServer(state) {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN && currentRoom) {
    wsConnection.send(JSON.stringify({
      type: 'SYNC_VIDEO_STATE',
      roomId: currentRoom.id,
      state: state
    }));
  }
}

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'CREATE_ROOM':
      handleCreateRoom(sendResponse);
      return true;

    case 'JOIN_ROOM':
      handleJoinRoom(message.roomId, sendResponse);
      return true;

    case 'LEAVE_ROOM':
      handleLeaveRoom(sendResponse);
      return true;

    case 'GET_ROOM_STATUS':
      sendResponse({ 
        room: currentRoom,
        connected: wsConnection && wsConnection.readyState === WebSocket.OPEN
      });
      return true;

    case 'SYNC_VIDEO_STATE':
      handleSyncVideoState(message.state, sender.tab?.id);
      sendResponse({ success: true });
      return true;

    case 'VIDEO_EVENT':
      broadcastVideoEvent(message.event, sender.tab?.id);
      sendResponse({ success: true });
      return true;

    default:
      sendResponse({ error: 'Unknown message type' });
      return true;
  }
});

/**
 * Create a new synchronization room
 * @param {function} sendResponse - Callback to send response
 */
function handleCreateRoom(sendResponse) {
  const roomId = generateRoomId();
  currentRoom = {
    id: roomId,
    isHost: true,
    createdAt: Date.now(),
    peerCount: 1
  };
  
  // Connect to signaling server for cross-device sync
  reconnectAttempts = 0;
  connectToSignalingServer(roomId);
  
  // Store room info in chrome storage
  chrome.storage.local.set({ currentRoom }, () => {
    sendResponse({ success: true, roomId });
  });
}

/**
 * Join an existing synchronization room
 * @param {string} roomId - The room ID to join
 * @param {function} sendResponse - Callback to send response
 */
function handleJoinRoom(roomId, sendResponse) {
  if (!roomId) {
    sendResponse({ success: false, error: 'Room ID is required' });
    return;
  }

  currentRoom = {
    id: roomId.toUpperCase(),
    isHost: false,
    joinedAt: Date.now(),
    peerCount: 1
  };

  // Connect to signaling server for cross-device sync
  reconnectAttempts = 0;
  connectToSignalingServer(currentRoom.id);

  // Store room info in chrome storage
  chrome.storage.local.set({ currentRoom }, () => {
    sendResponse({ success: true, roomId: currentRoom.id });
  });
}

/**
 * Leave the current room
 * @param {function} sendResponse - Callback to send response
 */
function handleLeaveRoom(sendResponse) {
  // Disconnect from signaling server
  disconnectFromSignalingServer();
  
  currentRoom = null;
  chrome.storage.local.remove('currentRoom', () => {
    sendResponse({ success: true });
  });
}

/**
 * Handle video state synchronization
 * @param {object} state - The video state to sync
 * @param {number} senderTabId - The tab ID that sent the state
 */
function handleSyncVideoState(state, senderTabId) {
  if (!currentRoom) return;

  // Broadcast to all local tabs except sender
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id !== senderTabId) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'APPLY_VIDEO_STATE',
          state
        }).catch(() => {
          // Ignore errors for tabs without content script
        });
      }
    });
  });

  // Also send to signaling server for cross-device sync
  sendSyncStateToServer(state);
}

/**
 * Broadcast video events to all connected tabs
 * @param {object} event - The video event to broadcast
 * @param {number} senderTabId - The tab ID that sent the event
 */
function broadcastVideoEvent(event, senderTabId) {
  if (!currentRoom) return;

  // Broadcast to all local tabs except sender
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id !== senderTabId) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'VIDEO_EVENT',
          event
        }).catch(() => {
          // Ignore errors for tabs without content script
        });
      }
    });
  });

  // Also send to signaling server for cross-device sync
  sendVideoEventToServer(event);
}

/**
 * Initialize extension state on startup
 */
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get('currentRoom', (result) => {
    if (result.currentRoom) {
      currentRoom = result.currentRoom;
      // Reconnect to signaling server for the existing room
      reconnectAttempts = 0;
      connectToSignalingServer(currentRoom.id);
    }
  });
});

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('Sync Player extension installed');
  // Clear any stale room data on install/update
  chrome.storage.local.remove('currentRoom');
});
