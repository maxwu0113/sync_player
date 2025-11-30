/**
 * Background service worker for Sync Player Chrome extension.
 * Handles communication between tabs and manages synchronization state.
 */

// Store the current room information
let currentRoom = null;
// Store connected peers
let connectedPeers = new Map();
// WebSocket connection for real-time sync
let wsConnection = null;

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
      sendResponse({ room: currentRoom });
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
    createdAt: Date.now()
  };
  
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
    joinedAt: Date.now()
  };

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

  // Broadcast to all tabs except sender
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
}

/**
 * Broadcast video events to all connected tabs
 * @param {object} event - The video event to broadcast
 * @param {number} senderTabId - The tab ID that sent the event
 */
function broadcastVideoEvent(event, senderTabId) {
  if (!currentRoom) return;

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
}

/**
 * Initialize extension state on startup
 */
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get('currentRoom', (result) => {
    if (result.currentRoom) {
      currentRoom = result.currentRoom;
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
