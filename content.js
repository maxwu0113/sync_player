/**
 * Content script for Sync Player Chrome extension.
 * Monitors video elements on the page and handles synchronization.
 */

// Flag to prevent recursive sync updates
let isSyncing = false;
// Reference to the currently monitored video element
let monitoredVideo = null;
// Debounce timer for seeking
let seekDebounceTimer = null;
// Seek threshold in seconds - only sync if difference exceeds this value
const SEEK_THRESHOLD_SECONDS = 1;
// Last synced time to track significant changes
let lastSyncedTime = 0;
// Sync cooldown period in milliseconds
const SYNC_COOLDOWN_MS = 500;

/**
 * Find the primary video element on the page
 * @returns {HTMLVideoElement|null} The main video element or null
 */
function findVideoElement() {
  // Try to find the most relevant video element
  const videos = document.querySelectorAll('video');
  
  if (videos.length === 0) return null;
  if (videos.length === 1) return videos[0];

  // If multiple videos, find the largest visible one
  let bestVideo = null;
  let maxArea = 0;

  videos.forEach((video) => {
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    
    // Check if video is visible and has the largest area
    if (area > maxArea && rect.width > 100 && rect.height > 100) {
      maxArea = area;
      bestVideo = video;
    }
  });

  return bestVideo || videos[0];
}

/**
 * Get the current state of a video element
 * @param {HTMLVideoElement} video - The video element
 * @returns {object} The video state
 */
function getVideoState(video) {
  return {
    currentTime: video.currentTime,
    paused: video.paused,
    playbackRate: video.playbackRate,
    timestamp: Date.now()
  };
}

/**
 * Apply a synchronized state to a video element
 * @param {HTMLVideoElement} video - The video element
 * @param {object} state - The state to apply
 */
function applyVideoState(video, state) {
  if (!video || isSyncing) return;

  isSyncing = true;

  try {
    // Calculate time difference to account for network latency
    const latency = (Date.now() - state.timestamp) / 1000;
    let targetTime = state.currentTime;
    
    // Adjust for latency if video is playing
    if (!state.paused) {
      targetTime += latency;
    }

    // Only seek if difference is significant (more than threshold)
    if (Math.abs(video.currentTime - targetTime) > SEEK_THRESHOLD_SECONDS) {
      video.currentTime = targetTime;
      lastSyncedTime = targetTime;
    }

    // Sync playback rate
    if (video.playbackRate !== state.playbackRate) {
      video.playbackRate = state.playbackRate;
    }

    // Sync play/pause state
    if (state.paused && !video.paused) {
      video.pause();
    } else if (!state.paused && video.paused) {
      video.play().catch(() => {
        // Autoplay may be blocked
        console.log('Sync Player: Autoplay blocked by browser');
      });
    }
  } finally {
    // Reset sync flag after cooldown to prevent bounce-back effects
    setTimeout(() => {
      isSyncing = false;
    }, SYNC_COOLDOWN_MS);
  }
}

/**
 * Send video event to background script
 * @param {string} eventType - The type of event
 * @param {object} data - Additional event data
 */
function sendVideoEvent(eventType, data = {}) {
  if (isSyncing) return;

  chrome.runtime.sendMessage({
    type: 'VIDEO_EVENT',
    event: {
      eventType,
      ...data,
      timestamp: Date.now()
    }
  }).catch(() => {
    // Extension context may not be available
  });
}

/**
 * Set up event listeners for a video element
 * @param {HTMLVideoElement} video - The video element to monitor
 */
function setupVideoListeners(video) {
  if (!video || monitoredVideo === video) return;

  // Remove listeners from previous video
  if (monitoredVideo) {
    removeVideoListeners(monitoredVideo);
  }

  monitoredVideo = video;

  // Play event handler
  video.addEventListener('play', handlePlay);
  // Pause event handler
  video.addEventListener('pause', handlePause);
  // Seeking event handler
  video.addEventListener('seeked', handleSeeked);
  // Rate change event handler
  video.addEventListener('ratechange', handleRateChange);

  console.log('Sync Player: Video element monitoring started');
}

/**
 * Remove event listeners from a video element
 * @param {HTMLVideoElement} video - The video element
 */
function removeVideoListeners(video) {
  if (!video) return;

  video.removeEventListener('play', handlePlay);
  video.removeEventListener('pause', handlePause);
  video.removeEventListener('seeked', handleSeeked);
  video.removeEventListener('ratechange', handleRateChange);
}

/**
 * Handle video play event
 */
function handlePlay() {
  if (isSyncing || !monitoredVideo) return;
  
  sendVideoEvent('play', {
    currentTime: monitoredVideo.currentTime,
    playbackRate: monitoredVideo.playbackRate
  });
}

/**
 * Handle video pause event
 */
function handlePause() {
  if (isSyncing || !monitoredVideo) return;
  
  sendVideoEvent('pause', {
    currentTime: monitoredVideo.currentTime
  });
}

/**
 * Handle video seek event with debouncing
 */
function handleSeeked() {
  if (isSyncing || !monitoredVideo) return;

  // Debounce seek events with a longer delay to prevent stuttering
  clearTimeout(seekDebounceTimer);
  seekDebounceTimer = setTimeout(() => {
    // Only send seek event if the change is significant
    if (Math.abs(monitoredVideo.currentTime - lastSyncedTime) > SEEK_THRESHOLD_SECONDS) {
      lastSyncedTime = monitoredVideo.currentTime;
      sendVideoEvent('seek', {
        currentTime: monitoredVideo.currentTime,
        paused: monitoredVideo.paused
      });
    }
  }, 300);
}

/**
 * Handle playback rate change event
 */
function handleRateChange() {
  if (isSyncing || !monitoredVideo) return;
  
  sendVideoEvent('ratechange', {
    playbackRate: monitoredVideo.playbackRate
  });
}

/**
 * Handle messages from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'APPLY_VIDEO_STATE':
      if (monitoredVideo) {
        applyVideoState(monitoredVideo, message.state);
      }
      sendResponse({ success: true });
      break;

    case 'VIDEO_EVENT':
      handleRemoteVideoEvent(message.event);
      sendResponse({ success: true });
      break;

    case 'GET_VIDEO_STATE':
      const video = monitoredVideo || findVideoElement();
      if (video) {
        sendResponse({ success: true, state: getVideoState(video) });
      } else {
        sendResponse({ success: false, error: 'No video found' });
      }
      break;

    case 'INIT_SYNC':
      initializeSync();
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  return true;
});

/**
 * Handle remote video events from other synced users
 * @param {object} event - The remote video event
 */
function handleRemoteVideoEvent(event) {
  if (!monitoredVideo || isSyncing) return;

  isSyncing = true;

  try {
    switch (event.eventType) {
      case 'play':
        // Adjust time for network latency
        const playLatency = (Date.now() - event.timestamp) / 1000;
        const targetPlayTime = event.currentTime + playLatency;
        // Only seek if difference is significant
        if (Math.abs(monitoredVideo.currentTime - targetPlayTime) > SEEK_THRESHOLD_SECONDS) {
          monitoredVideo.currentTime = targetPlayTime;
          lastSyncedTime = targetPlayTime;
        }
        monitoredVideo.playbackRate = event.playbackRate;
        monitoredVideo.play().catch(() => {
          console.log('Sync Player: Autoplay blocked');
        });
        break;

      case 'pause':
        // Only seek if difference is significant
        if (Math.abs(monitoredVideo.currentTime - event.currentTime) > SEEK_THRESHOLD_SECONDS) {
          monitoredVideo.currentTime = event.currentTime;
          lastSyncedTime = event.currentTime;
        }
        monitoredVideo.pause();
        break;

      case 'seek':
        // Only seek if difference is significant to prevent stuttering
        if (Math.abs(monitoredVideo.currentTime - event.currentTime) > SEEK_THRESHOLD_SECONDS) {
          monitoredVideo.currentTime = event.currentTime;
          lastSyncedTime = event.currentTime;
        }
        // Ensure playback state is synced regardless of seek threshold
        if (!event.paused && monitoredVideo.paused) {
          monitoredVideo.play().catch(() => {});
        } else if (event.paused && !monitoredVideo.paused) {
          monitoredVideo.pause();
        }
        break;

      case 'ratechange':
        monitoredVideo.playbackRate = event.playbackRate;
        break;
    }
  } finally {
    // Reset sync flag after a longer delay to prevent bounce-back effects
    setTimeout(() => {
      isSyncing = false;
    }, SYNC_COOLDOWN_MS);
  }
}

/**
 * Initialize video synchronization
 */
function initializeSync() {
  const video = findVideoElement();
  if (video) {
    setupVideoListeners(video);
  }
}

/**
 * Observe DOM for dynamically added video elements
 */
function observeForVideos() {
  const observer = new MutationObserver((mutations) => {
    // Check if a video was added
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeName === 'VIDEO') {
          initializeSync();
        } else if (node.querySelector) {
          const video = node.querySelector('video');
          if (video) {
            initializeSync();
          }
        }
      });
    });
  });

  // Observe document.documentElement as fallback if body is not available
  const targetNode = document.body || document.documentElement;
  observer.observe(targetNode, {
    childList: true,
    subtree: true
  });
}

// Initialize on page load
if (document.readyState === 'complete') {
  initializeSync();
  observeForVideos();
} else {
  window.addEventListener('load', () => {
    initializeSync();
    observeForVideos();
  });
}

console.log('Sync Player: Content script loaded');
