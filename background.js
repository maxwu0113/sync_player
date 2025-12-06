/**
 * Background service worker for Sync Player Chrome extension.
 * Handles communication between tabs and manages synchronization state.
 * Supports cross-device synchronization via WebSocket signaling server.
 */

// Store the current room information
let currentRoom = null;
// Store connected peers
let connectedPeers = new Map();
// Store users list in the room
let roomUsers = [];
// Current user's ID and name
let currentUserId = null;
let currentUsername = 'Anonymous';
// WebSocket connection for real-time sync
let wsConnection = null;
// Track the last room ID we sent a JOIN_ROOM message for
// This prevents duplicate JOIN_ROOM messages for the same room
let lastJoinedRoomId = null;
// Reconnection settings
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;
// Default signaling server URL
// Users can host their own server using the code in /server directory
// and change this URL to point to their server
const DEFAULT_SIGNALING_SERVER = 'https://sync-player-ummm.onrender.com';
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
 * Generate a unique user ID using cryptographically secure random values
 * @returns {string} A random 8-character user ID
 */
function generateUserId() {
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
    .substring(0, 8);
}

/**
 * Connect to the signaling server for cross-device sync
 * @param {string} roomId - The room ID to join
 */
function connectToSignalingServer(roomId) {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    // Client-side protection: avoid sending JOIN_ROOM if already sent for this room
    // This reduces unnecessary network traffic and prevents potential issues
    // Also verify we're still in that room to handle edge cases where server disconnected us
    if (lastJoinedRoomId === roomId && currentRoom && currentRoom.id === roomId) {
      console.log('Sync Player: Already sent JOIN_ROOM for room', roomId, '- skipping duplicate');
      return;
    }
    
    // Already connected, join the room
    wsConnection.send(JSON.stringify({
      type: 'JOIN_ROOM',
      roomId: roomId,
      userId: currentUserId,
      username: currentUsername
    }));
    lastJoinedRoomId = roomId;
    return;
  }

  try {
    wsConnection = new WebSocket(signalingServerUrl);

    wsConnection.onopen = () => {
      console.log('Sync Player: Connected to signaling server');
      reconnectAttempts = 0;
      
      // Join the room with user info
      wsConnection.send(JSON.stringify({
        type: 'JOIN_ROOM',
        roomId: roomId,
        userId: currentUserId,
        username: currentUsername
      }));
      lastJoinedRoomId = roomId;

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
      // Reset last joined room ID since connection is closed
      lastJoinedRoomId = null;
      
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
        currentRoom.isHost = message.isHost;
        
        // If this client is the host, send current URL to server
        if (message.isHost) {
          sendCurrentUrlToServer();
        } else if (message.hostUrl) {
          // If joining and host URL is available, open it in a new tab
          openHostUrl(message.hostUrl);
        }
      }
      // Update users list if provided
      if (message.users) {
        roomUsers = message.users;
      }
      break;

    case 'PEER_JOINED':
      console.log('Sync Player: A peer joined the room');
      if (currentRoom) {
        currentRoom.peerCount = message.peerCount;
        // If we are host, send our URL to the server so new peers can receive it
        if (currentRoom.isHost) {
          sendCurrentUrlToServer();
        }
      }
      // Update users list if provided
      if (message.users) {
        roomUsers = message.users;
      }
      break;

    case 'PEER_LEFT':
      console.log('Sync Player: A peer left the room');
      if (currentRoom) {
        currentRoom.peerCount = message.peerCount;
      }
      // Update users list if provided
      if (message.users) {
        roomUsers = message.users;
      }
      break;

    case 'USERS_UPDATE':
      console.log('Sync Player: Users list updated');
      if (message.users) {
        roomUsers = message.users;
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

    case 'HOST_URL_UPDATED':
      // Host URL was updated, open it if we're not the host
      if (currentRoom && !currentRoom.isHost && message.url) {
        openHostUrl(message.url);
      }
      break;

    case 'ERROR':
      console.error('Sync Player: Server error:', message.error);
      break;
    
    case 'ROOM_LEFT':
      // Server notified us that we left the room
      console.log('Sync Player: Left room');
      currentRoom = null;
      roomUsers = [];
      lastJoinedRoomId = null;
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
 * Send the current tab URL to the signaling server
 * Only called when this client is the host
 */
function sendCurrentUrlToServer() {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN || !currentRoom) {
    return;
  }

  // Get the active tab's URL
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    // Handle potential chrome.runtime.lastError
    if (chrome.runtime.lastError) {
      console.error('Sync Player: Error querying tabs:', chrome.runtime.lastError.message);
      return;
    }
    
    if (tabs && tabs.length > 0 && tabs[0].url) {
      const url = tabs[0].url;
      // Only send if it's a valid http/https URL (not chrome:// or extension pages)
      if (url.startsWith('http://') || url.startsWith('https://')) {
        wsConnection.send(JSON.stringify({
          type: 'UPDATE_HOST_URL',
          roomId: currentRoom.id,
          url: url
        }));
        console.log('Sync Player: Sent host URL to server:', url);
      }
    }
  });
}

/**
 * Open the host's URL in a new tab or navigate current tab
 * @param {string} url - The URL to open
 */
function openHostUrl(url) {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    console.log('Sync Player: Invalid host URL, skipping:', url);
    return;
  }

  // Check if we already have a tab with this URL
  chrome.tabs.query({}, (tabs) => {
    // Handle potential chrome.runtime.lastError
    if (chrome.runtime.lastError) {
      console.error('Sync Player: Error querying tabs:', chrome.runtime.lastError.message);
      return;
    }
    
    const existingTab = tabs && tabs.find(tab => tab.url === url);
    
    if (existingTab) {
      // If tab exists, focus on it
      chrome.tabs.update(existingTab.id, { active: true }, () => {
        if (chrome.runtime.lastError) {
          console.error('Sync Player: Error focusing tab:', chrome.runtime.lastError.message);
        } else {
          console.log('Sync Player: Focused existing tab with host URL');
        }
      });
    } else {
      // Check if there's an active tab we should navigate
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (activeTabs) => {
        if (chrome.runtime.lastError) {
          console.error('Sync Player: Error querying active tabs:', chrome.runtime.lastError.message);
          return;
        }
        
        if (activeTabs && activeTabs.length > 0) {
          const activeTab = activeTabs[0];
          // If the active tab is a video page (http/https), navigate it to the new URL
          if (activeTab.url && (activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://'))) {
            chrome.tabs.update(activeTab.id, { url: url }, () => {
              if (chrome.runtime.lastError) {
                console.error('Sync Player: Error updating tab:', chrome.runtime.lastError.message);
              } else {
                console.log('Sync Player: Navigated current tab to host URL:', url);
              }
            });
          } else {
            // Otherwise open a new tab
            chrome.tabs.create({ url: url, active: true }, () => {
              if (chrome.runtime.lastError) {
                console.error('Sync Player: Error creating tab:', chrome.runtime.lastError.message);
              } else {
                console.log('Sync Player: Opened host URL in new tab:', url);
              }
            });
          }
        } else {
          // No active tab, create a new one
          chrome.tabs.create({ url: url, active: true }, () => {
            if (chrome.runtime.lastError) {
              console.error('Sync Player: Error creating tab:', chrome.runtime.lastError.message);
            } else {
              console.log('Sync Player: Opened host URL in new tab:', url);
            }
          });
        }
      });
    }
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
      handleCreateRoom(message.username, sendResponse);
      return true;

    case 'JOIN_ROOM':
      handleJoinRoom(message.roomId, message.username, sendResponse);
      return true;

    case 'LEAVE_ROOM':
      handleLeaveRoom(sendResponse);
      return true;

    case 'GET_ROOM_STATUS':
      sendResponse({ 
        room: currentRoom,
        connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
        users: roomUsers,
        userId: currentUserId
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

    case 'UPDATE_HOST_URL':
      // Host updates their current URL to share with peers
      if (currentRoom && currentRoom.isHost) {
        sendCurrentUrlToServer();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Only host can update URL' });
      }
      return true;

    default:
      sendResponse({ error: 'Unknown message type' });
      return true;
  }
});

/**
 * Create a new synchronization room
 * @param {string} username - The user's display name
 * @param {function} sendResponse - Callback to send response
 */
function handleCreateRoom(username, sendResponse) {
  const roomId = generateRoomId();
  currentUserId = generateUserId();
  currentUsername = username || 'Anonymous';
  
  // Initialize users list with current user
  roomUsers = [{ id: currentUserId, name: currentUsername }];
  
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
  chrome.storage.local.set({ currentRoom, currentUserId, currentUsername }, () => {
    sendResponse({ 
      success: true, 
      roomId, 
      userId: currentUserId,
      users: roomUsers
    });
  });
}

/**
 * Join an existing synchronization room
 * @param {string} roomId - The room ID to join
 * @param {string} username - The user's display name
 * @param {function} sendResponse - Callback to send response
 */
function handleJoinRoom(roomId, username, sendResponse) {
  if (!roomId) {
    sendResponse({ success: false, error: 'Room ID is required' });
    return;
  }

  currentUserId = generateUserId();
  currentUsername = username || 'Anonymous';
  
  // Initialize users list with current user (will be updated by server)
  roomUsers = [{ id: currentUserId, name: currentUsername }];

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
  chrome.storage.local.set({ currentRoom, currentUserId, currentUsername }, () => {
    sendResponse({ 
      success: true, 
      roomId: currentRoom.id,
      userId: currentUserId,
      users: roomUsers
    });
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
  roomUsers = [];
  currentUserId = null;
  lastJoinedRoomId = null;
  
  chrome.storage.local.remove(['currentRoom', 'currentUserId'], () => {
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
  chrome.storage.local.get(['currentRoom', 'currentUserId', 'currentUsername'], (result) => {
    if (result.currentRoom) {
      currentRoom = result.currentRoom;
      currentUserId = result.currentUserId || generateUserId();
      currentUsername = result.currentUsername || 'Anonymous';
      roomUsers = [{ id: currentUserId, name: currentUsername }];
      
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

/**
 * Listen for tab URL changes to sync video page navigation
 * When the host navigates to a new video page, broadcast it to all participants
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process when URL changes and loading is complete
  if (changeInfo.status === 'complete' && tab.url) {
    // Only process if we're in a room and are the host
    if (currentRoom && currentRoom.isHost) {
      // Only send if it's a valid http/https URL
      if (tab.url.startsWith('http://') || tab.url.startsWith('https://')) {
        // Check if this is the active tab in the last focused window
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          // Handle potential chrome.runtime.lastError
          if (chrome.runtime.lastError) {
            console.error('Sync Player: Error querying active tabs:', chrome.runtime.lastError.message);
            return;
          }
          
          if (tabs && tabs.length > 0 && tabs[0].id === tabId) {
            // Send the new URL to the server
            sendCurrentUrlToServer();
            console.log('Sync Player: Host navigated to new page, broadcasting URL:', tab.url);
          }
        });
      }
    }
  }
});
