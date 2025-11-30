/**
 * Popup script for Sync Player Chrome extension.
 * Handles user interactions and communicates with background script.
 */

// DOM element references
const notInRoomSection = document.getElementById('not-in-room');
const inRoomSection = document.getElementById('in-room');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const syncNowBtn = document.getElementById('sync-now-btn');
const copyRoomIdBtn = document.getElementById('copy-room-id');
const roomIdInput = document.getElementById('room-id-input');
const usernameInput = document.getElementById('username-input');
const currentRoomIdDisplay = document.getElementById('current-room-id');
const statusMessage = document.getElementById('status-message');
const connectionStatus = document.getElementById('connection-status');
const userCountDisplay = document.getElementById('user-count');
const usersList = document.getElementById('users-list');

// Current user's ID (for identifying self in user list)
let currentUserId = null;

/**
 * Show a status message to the user
 * @param {string} message - The message to display
 * @param {string} type - Message type: 'success', 'error', or 'info'
 * @param {number} duration - How long to show the message in ms
 */
function showStatus(message, type = 'info', duration = 3000) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.classList.remove('hidden');

  if (duration > 0) {
    setTimeout(() => {
      statusMessage.classList.add('hidden');
    }, duration);
  }
}

/**
 * Update the UI based on current room state
 * @param {object|null} room - The current room info or null if not in a room
 * @param {boolean} connected - Whether connected to signaling server
 * @param {Array} users - List of users in the room
 */
function updateUI(room, connected = false, users = []) {
  if (room) {
    notInRoomSection.classList.add('hidden');
    inRoomSection.classList.remove('hidden');
    currentRoomIdDisplay.textContent = room.id;
    
    // Update connection status
    updateConnectionStatus(connected);
    
    // Update user count and list
    updateUsersList(users);
  } else {
    notInRoomSection.classList.remove('hidden');
    inRoomSection.classList.add('hidden');
    roomIdInput.value = '';
  }
}

/**
 * Update the connection status display
 * @param {boolean} connected - Whether connected to signaling server
 */
function updateConnectionStatus(connected) {
  if (connected) {
    connectionStatus.textContent = 'Connected';
    connectionStatus.classList.remove('disconnected');
  } else {
    connectionStatus.textContent = 'Connecting...';
    connectionStatus.classList.add('disconnected');
  }
}

/**
 * Update the users list display
 * @param {Array} users - List of users in the room
 */
function updateUsersList(users) {
  // Clear existing list
  usersList.innerHTML = '';
  
  // If no users provided, show at least current user as placeholder
  if (!users || users.length === 0) {
    userCountDisplay.textContent = '1';
    const li = document.createElement('li');
    li.className = 'current-user';
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'user-icon';
    iconSpan.textContent = '👤';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = 'You';
    
    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'you-badge';
    badgeSpan.textContent = 'You';
    
    li.appendChild(iconSpan);
    li.appendChild(nameSpan);
    li.appendChild(badgeSpan);
    usersList.appendChild(li);
    return;
  }
  
  // Update user count
  userCountDisplay.textContent = users.length;
  
  // Add each user to the list
  users.forEach(user => {
    const li = document.createElement('li');
    const isCurrentUser = user.id === currentUserId;
    
    if (isCurrentUser) {
      li.className = 'current-user';
    }
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'user-icon';
    iconSpan.textContent = '👤';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = user.name || 'Anonymous';
    
    li.appendChild(iconSpan);
    li.appendChild(nameSpan);
    
    if (isCurrentUser) {
      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'you-badge';
      badgeSpan.textContent = 'You';
      li.appendChild(badgeSpan);
    }
    
    usersList.appendChild(li);
  });
}

/**
 * Get the current username from input
 * @returns {string} The username or a default value
 */
function getUsername() {
  const name = usernameInput.value.trim();
  return name || 'Anonymous';
}

/**
 * Create a new room
 */
async function createRoom() {
  try {
    createRoomBtn.disabled = true;
    createRoomBtn.textContent = 'Creating...';

    const username = getUsername();
    const response = await chrome.runtime.sendMessage({ 
      type: 'CREATE_ROOM',
      username: username
    });
    
    if (response.success) {
      currentUserId = response.userId;
      updateUI({ id: response.roomId, isHost: true }, false, response.users || []);
      showStatus('Room created! Connecting...', 'success');
      initializeVideoSync();
      // Poll for connection status and users
      pollConnectionStatus();
    } else {
      showStatus(response.error || 'Failed to create room', 'error');
    }
  } catch (error) {
    showStatus('Error creating room', 'error');
    console.error('Create room error:', error);
  } finally {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = 'Create Room';
  }
}

/**
 * Join an existing room
 */
async function joinRoom() {
  const roomId = roomIdInput.value.trim().toUpperCase();
  
  if (!roomId) {
    showStatus('Please enter a Room ID', 'error');
    roomIdInput.focus();
    return;
  }

  if (roomId.length < 6) {
    showStatus('Room ID must be 6 characters', 'error');
    roomIdInput.focus();
    return;
  }

  try {
    joinRoomBtn.disabled = true;
    joinRoomBtn.textContent = 'Joining...';

    const username = getUsername();
    const response = await chrome.runtime.sendMessage({ 
      type: 'JOIN_ROOM', 
      roomId,
      username: username
    });
    
    if (response.success) {
      currentUserId = response.userId;
      updateUI({ id: response.roomId, isHost: false }, false, response.users || []);
      showStatus('Joined room! Connecting...', 'success');
      initializeVideoSync();
      // Poll for connection status and users
      pollConnectionStatus();
    } else {
      showStatus(response.error || 'Failed to join room', 'error');
    }
  } catch (error) {
    showStatus('Error joining room', 'error');
    console.error('Join room error:', error);
  } finally {
    joinRoomBtn.disabled = false;
    joinRoomBtn.textContent = 'Join Room';
  }
}

/**
 * Leave the current room
 */
async function leaveRoom() {
  try {
    leaveRoomBtn.disabled = true;
    leaveRoomBtn.textContent = 'Leaving...';

    const response = await chrome.runtime.sendMessage({ type: 'LEAVE_ROOM' });
    
    if (response.success) {
      updateUI(null);
      showStatus('Left room', 'info');
    } else {
      showStatus(response.error || 'Failed to leave room', 'error');
    }
  } catch (error) {
    showStatus('Error leaving room', 'error');
    console.error('Leave room error:', error);
  } finally {
    leaveRoomBtn.disabled = false;
    leaveRoomBtn.textContent = 'Leave Room';
  }
}

/**
 * Copy room ID to clipboard
 */
async function copyRoomId() {
  const roomId = currentRoomIdDisplay.textContent;
  
  try {
    await navigator.clipboard.writeText(roomId);
    showStatus('Room ID copied!', 'success', 2000);
    
    // Visual feedback
    copyRoomIdBtn.textContent = '✓';
    setTimeout(() => {
      copyRoomIdBtn.textContent = '📋';
    }, 1500);
  } catch (error) {
    showStatus('Failed to copy', 'error');
    console.error('Copy error:', error);
  }
}

/**
 * Sync video state now
 */
async function syncNow() {
  try {
    syncNowBtn.disabled = true;
    
    // Get the current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      showStatus('No active tab found', 'error');
      return;
    }

    // Request video state from content script
    const response = await chrome.tabs.sendMessage(tab.id, { 
      type: 'GET_VIDEO_STATE' 
    });
    
    if (response.success && response.state) {
      // Broadcast the state to other tabs
      await chrome.runtime.sendMessage({
        type: 'SYNC_VIDEO_STATE',
        state: response.state
      });
      showStatus('Video synced!', 'success', 2000);
    } else {
      showStatus('No video found on this page', 'error');
    }
  } catch (error) {
    showStatus('Error syncing video', 'error');
    console.error('Sync error:', error);
  } finally {
    syncNowBtn.disabled = false;
  }
}

/**
 * Initialize video synchronization on the current tab
 */
async function initializeVideoSync() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab) {
      await chrome.tabs.sendMessage(tab.id, { type: 'INIT_SYNC' });
    }
  } catch (error) {
    // Content script might not be loaded on this page
    console.log('Could not initialize sync on current tab');
  }
}

/**
 * Check current room status on popup open
 */
async function checkRoomStatus() {
  try {
    // Load saved username
    const stored = await chrome.storage.local.get(['username']);
    if (stored.username) {
      usernameInput.value = stored.username;
    }
    
    const response = await chrome.runtime.sendMessage({ type: 'GET_ROOM_STATUS' });
    currentUserId = response.userId || null;
    updateUI(response.room, response.connected, response.users || []);
  } catch (error) {
    console.error('Error checking room status:', error);
    updateUI(null, false, []);
  }
}

/**
 * Poll for connection status updates with exponential backoff
 */
function pollConnectionStatus() {
  let attempts = 0;
  const maxAttempts = 5;
  
  async function checkStatus() {
    attempts++;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ROOM_STATUS' });
      
      // Update users list
      if (response.users) {
        updateUsersList(response.users);
      }
      
      if (response.connected) {
        updateConnectionStatus(true);
        showStatus('Connected to sync server!', 'success', 2000);
        return; // Stop polling
      } else if (attempts >= maxAttempts) {
        updateConnectionStatus(false);
        showStatus('Connection may be slow, sync still works locally', 'info', 3000);
        return; // Stop polling
      }
      // Exponential backoff: 1s, 2s, 4s, 8s
      const delay = Math.pow(2, attempts - 1) * 1000;
      setTimeout(checkStatus, delay);
    } catch (error) {
      // Stop polling on error
    }
  }
  
  // Start first check after 1 second
  setTimeout(checkStatus, 1000);
}

// Event listeners
createRoomBtn.addEventListener('click', createRoom);
joinRoomBtn.addEventListener('click', joinRoom);
leaveRoomBtn.addEventListener('click', leaveRoom);
syncNowBtn.addEventListener('click', syncNow);
copyRoomIdBtn.addEventListener('click', copyRoomId);

// Handle Enter key in room ID input
roomIdInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    joinRoom();
  }
});

// Auto-uppercase room ID input
roomIdInput.addEventListener('input', () => {
  roomIdInput.value = roomIdInput.value.toUpperCase();
});

// Save username when it changes
usernameInput.addEventListener('change', () => {
  const username = usernameInput.value.trim();
  chrome.storage.local.set({ username });
});

// Initialize popup
document.addEventListener('DOMContentLoaded', checkRoomStatus);
