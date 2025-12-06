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
const SYNC_COOLDOWN_MS = 250;
// YouTube ad state tracking
let isWatchingAd = false;
let adCheckInterval = null;
// Ad check interval in milliseconds (1 second provides good balance between responsiveness and performance)
const AD_CHECK_INTERVAL_MS = 1000;
// UI overlay for ad waiting notification
let adWaitingOverlay = null;

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
 * Check if current page is YouTube
 * @returns {boolean} True if on YouTube
 */
function isYouTube() {
  const hostname = window.location.hostname.toLowerCase();
  // Check if hostname is exactly youtube.com or a subdomain of youtube.com
  // Also check for youtu.be (YouTube's URL shortener)
  return hostname === 'youtube.com' || 
         hostname.endsWith('.youtube.com') ||
         hostname === 'youtu.be' ||
         hostname.endsWith('.youtu.be');
}

/**
 * Detect if a YouTube ad is currently playing
 * @returns {boolean} True if an ad is playing
 */
function isYouTubeAdPlaying() {
  if (!isYouTube()) return false;
  
  // Check for multiple indicators that an ad is playing
  // Method 1: Check for ad-specific classes on the player
  const player = document.querySelector('.html5-video-player');
  if (player && player.classList.contains('ad-showing')) {
    return true;
  }
  
  // Method 2: Check for ad overlay/container
  const adModule = document.querySelector('.video-ads.ytp-ad-module');
  if (adModule) {
    const adDisplay = window.getComputedStyle(adModule).display;
    if (adDisplay !== 'none') {
      return true;
    }
  }
  
  // Method 3: Check for ad player overlay
  const adPlayerOverlay = document.querySelector('.ytp-ad-player-overlay');
  if (adPlayerOverlay && window.getComputedStyle(adPlayerOverlay).display !== 'none') {
    return true;
  }
  
  // Method 4: Check for skip ad button or ad text
  const adText = document.querySelector('.ytp-ad-text, .ytp-ad-preview-text');
  if (adText && window.getComputedStyle(adText).display !== 'none') {
    return true;
  }
  
  return false;
}

/**
 * Get the current state of a video element
 * @param {HTMLVideoElement} video - The video element
 * @returns {object} The video state
 */
function getVideoState(video) {
  const state = {
    currentTime: video.currentTime,
    paused: video.paused,
    playbackRate: video.playbackRate,
    timestamp: Date.now()
  };
  
  // Add YouTube ad state if on YouTube
  if (isYouTube()) {
    state.isWatchingAd = isYouTubeAdPlaying();
  }
  
  return state;
}

/**
 * Apply a synchronized state to a video element
 * @param {HTMLVideoElement} video - The video element
 * @param {object} state - The state to apply
 */
function applyVideoState(video, state) {
  if (!video || isSyncing) return;

  // On YouTube, handle ad synchronization
  if (isYouTube()) {
    const localAdPlaying = isYouTubeAdPlaying();
    const remoteAdPlaying = state.isWatchingAd === true;
    
    if (remoteAdPlaying && !localAdPlaying) {
      // Remote user is watching ad, we are not - pause and wait
      if (!video.paused) {
        video.pause();
      }
      showAdWaitingOverlay();
      return; // Don't apply other state changes while remote user is watching ad
    } else if (!remoteAdPlaying && localAdPlaying) {
      // We're watching ad, remote user is not - show overlay to inform we're the ones causing the wait
      // But don't interfere with our own ad playback
      return; // Don't apply remote state while we're watching ad
    } else {
      // Either both watching ads or neither - hide overlay
      hideAdWaitingOverlay();
      if (localAdPlaying) {
        // Both watching ads - don't sync
        return;
      }
      // Neither watching ads - continue with normal sync
    }
  }

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
 * Show overlay notification that other users are watching ads
 */
function showAdWaitingOverlay() {
  // Don't create duplicate overlays
  if (adWaitingOverlay && document.body.contains(adWaitingOverlay)) {
    return;
  }
  
  // Remove any existing overlay first
  hideAdWaitingOverlay();
  
  // Create overlay element
  adWaitingOverlay = document.createElement('div');
  adWaitingOverlay.id = 'sync-player-ad-waiting-overlay';
  adWaitingOverlay.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 9999999;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      gap: 12px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      animation: sync-player-fade-in 0.3s ease;
    ">
      <div style="
        width: 20px;
        height: 20px;
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: sync-player-spin 1s linear infinite;
      "></div>
      <div>
        <div style="font-weight: 600; margin-bottom: 2px;">⏸️ Waiting for others</div>
        <div style="font-size: 12px; opacity: 0.8;">Other users are watching ads...</div>
      </div>
    </div>
  `;
  
  // Add animations via style tag if not already present
  if (!document.getElementById('sync-player-animations')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'sync-player-animations';
    styleEl.textContent = `
      @keyframes sync-player-spin {
        to { transform: rotate(360deg); }
      }
      @keyframes sync-player-fade-in {
        from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
    document.head.appendChild(styleEl);
  }
  
  document.body.appendChild(adWaitingOverlay);
  console.log('Sync Player: Showing ad waiting overlay');
}

/**
 * Hide the ad waiting overlay
 */
function hideAdWaitingOverlay() {
  if (adWaitingOverlay && document.body.contains(adWaitingOverlay)) {
    adWaitingOverlay.remove();
    adWaitingOverlay = null;
    console.log('Sync Player: Hiding ad waiting overlay');
  }
}

/**
 * Start monitoring YouTube ad state changes
 */
function startYouTubeAdMonitoring() {
  // Stop any existing monitoring first
  stopYouTubeAdMonitoring();
  
  // Initialize the ad state
  isWatchingAd = isYouTubeAdPlaying();
  
  // Check ad state periodically
  // 1 second provides good balance between responsiveness and performance
  // YouTube ads typically last 5-30 seconds, so 1s delay is acceptable
  adCheckInterval = setInterval(() => {
    const currentAdState = isYouTubeAdPlaying();
    
    // If ad state changed, broadcast it
    if (currentAdState !== isWatchingAd) {
      isWatchingAd = currentAdState;
      
      if (monitoredVideo) {
        // Broadcast the state change
        if (currentAdState) {
          // Ad started playing
          console.log('Sync Player: YouTube ad detected, broadcasting ad state');
          sendVideoEvent('pause', {
            currentTime: monitoredVideo.currentTime,
            isWatchingAd: true
          });
        } else {
          // Ad finished, broadcast current state
          console.log('Sync Player: YouTube ad finished, resuming sync');
          // When ad finishes, send current play state
          sendVideoEvent(monitoredVideo.paused ? 'pause' : 'play', {
            currentTime: monitoredVideo.currentTime,
            playbackRate: monitoredVideo.playbackRate,
            isWatchingAd: false
          });
        }
      }
    }
  }, AD_CHECK_INTERVAL_MS);
  
  console.log('Sync Player: Started YouTube ad monitoring');
}

/**
 * Stop monitoring YouTube ad state changes
 */
function stopYouTubeAdMonitoring() {
  if (adCheckInterval) {
    clearInterval(adCheckInterval);
    adCheckInterval = null;
    // Don't reset isWatchingAd - let it maintain current state
    console.log('Sync Player: Stopped YouTube ad monitoring');
  }
}

/**
 * Send video event to background script
 * @param {string} eventType - The type of event
 * @param {object} data - Additional event data
 */
function sendVideoEvent(eventType, data = {}) {
  if (isSyncing) return;
  
  // Add YouTube ad state if on YouTube and not already provided
  const eventData = { ...data };
  if (isYouTube() && eventData.isWatchingAd === undefined) {
    eventData.isWatchingAd = isYouTubeAdPlaying();
  }

  chrome.runtime.sendMessage({
    type: 'VIDEO_EVENT',
    event: {
      eventType,
      ...eventData,
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
  
  // Start YouTube ad monitoring if on YouTube
  if (isYouTube()) {
    startYouTubeAdMonitoring();
  }

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
  
  // Stop YouTube ad monitoring
  stopYouTubeAdMonitoring();
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

  // On YouTube, handle ad synchronization
  if (isYouTube()) {
    const localAdPlaying = isYouTubeAdPlaying();
    const remoteAdPlaying = event.isWatchingAd === true;
    
    if (remoteAdPlaying && !localAdPlaying) {
      // Remote user is watching ad, we are not - pause and wait
      if (!monitoredVideo.paused) {
        monitoredVideo.pause();
      }
      showAdWaitingOverlay();
      return; // Don't process other events while remote user is watching ad
    } else if (!remoteAdPlaying && localAdPlaying) {
      // We're watching ad, remote user is not - don't sync their events
      return;
    } else {
      // Either both watching ads or neither - hide overlay
      hideAdWaitingOverlay();
      if (localAdPlaying) {
        // Both watching ads - don't sync
        return;
      }
      // Neither watching ads - continue with normal sync
    }
  }

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
