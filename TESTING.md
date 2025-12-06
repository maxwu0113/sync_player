# YouTube Ad Synchronization Testing Guide

This document provides a comprehensive testing guide for the YouTube ad synchronization feature.

## Prerequisites

1. Chrome browser with Sync Player extension installed
2. At least 2 browser instances or devices for testing synchronization
3. YouTube account (ads are more common when logged in)

## Test Scenarios

### Test 1: Basic Ad Detection

**Objective**: Verify that the extension correctly detects YouTube ads

**Steps**:
1. Load the extension in Chrome
2. Create a room and note the Room ID
3. Navigate to a YouTube video that contains ads (e.g., popular music videos, trending videos)
4. Open Chrome DevTools Console
5. Look for the console message: "Sync Player: YouTube ad detected, broadcasting ad state"

**Expected Result**: 
- The extension should log when an ad starts playing
- The extension should log when the ad finishes: "Sync Player: YouTube ad finished, resuming sync"

### Test 2: Two Users - One Watching Ad

**Objective**: Verify synchronization when one user watches an ad

**Setup**:
- User A: Browser instance 1 (or Device 1)
- User B: Browser instance 2 (or Device 2)

**Steps**:
1. User A: Create a room and share the Room ID
2. User B: Join the room using the Room ID
3. Both users navigate to the same YouTube video
4. User A: Start playing the video
5. Wait for an ad to appear on User A's screen
6. Observe User B's screen

**Expected Result**:
- When User A sees an ad, User B should see:
  - Video paused automatically
  - A notification overlay at the top of the page saying:
    ```
    ⏸️ Waiting for others
    Other users are watching ads...
    ```
  - A loading spinner animation in the notification
- When User A's ad finishes, User B should:
  - See the notification disappear
  - Video should resume playing automatically

### Test 3: Two Users - Both Watching Ads

**Objective**: Verify behavior when both users watch ads simultaneously

**Steps**:
1. Both users navigate to the same YouTube video
2. Start playing the video around the same time
3. Both users encounter ads (may happen naturally or can be triggered by refreshing)

**Expected Result**:
- Both users should be able to watch their respective ads without interference
- No notification should appear since both are in the same state
- When both ads finish, playback should resume normally

### Test 4: User Joins During Ad

**Objective**: Verify behavior when a user joins a room while another user is watching an ad

**Steps**:
1. User A: Create a room and start playing a YouTube video
2. User A: Let the video play until an ad appears
3. User B: Join the room while User A is still watching the ad
4. User B: Navigate to the same YouTube video

**Expected Result**:
- User B should see the video paused
- User B should see the "Waiting for others" notification
- When User A's ad finishes, User B's notification should disappear and video should sync

### Test 5: Ad State Synchronization

**Objective**: Verify that ad state is properly synchronized across all events

**Steps**:
1. Set up two users in the same room
2. User A: Start watching a video with ads
3. During User A's ad playback, User B should try to:
   - Play the video
   - Seek to a different time
   - Change playback speed

**Expected Result**:
- All User B's actions should be blocked while User A is watching an ad
- The notification should remain visible on User B's screen
- After User A's ad finishes, normal synchronization should resume

### Test 6: Multiple Sequential Ads

**Objective**: Verify behavior with multiple ads in sequence

**Steps**:
1. Find a YouTube video with multiple ads (usually longer videos)
2. Two users in the same room start watching
3. Observe behavior through multiple ad breaks

**Expected Result**:
- Each ad should be detected and synchronized properly
- Notification should show/hide correctly for each ad
- No sync issues between ad breaks

### Test 7: Ad Skipping

**Objective**: Verify behavior when skipping an ad

**Steps**:
1. User A starts watching a video with a skippable ad
2. User B is in the same room
3. User A clicks "Skip Ad" button when it appears

**Expected Result**:
- User B's notification should disappear immediately after User A skips the ad
- Video should resume synchronized playback

### Test 8: Cross-Device Synchronization

**Objective**: Verify ad sync works across different devices

**Steps**:
1. User A on Desktop: Create room and start video
2. User B on Mobile/Tablet: Join the same room
3. Test scenarios 2-7 across devices

**Expected Result**:
- All synchronization should work the same across devices
- UI notification should be visible and properly formatted on all screen sizes

## UI Verification

### Notification Overlay Appearance

The notification overlay should have the following characteristics:

**Position**: Fixed at the top center of the page

**Visual Design**:
- Dark background with blur effect (rgba(0, 0, 0, 0.9))
- White text
- Loading spinner (rotating circle)
- Rounded corners (8px border radius)
- Shadow for depth
- Semi-transparent border

**Content**:
- Icon: ⏸️ (pause emoji)
- Main text: "Waiting for others" (bold)
- Subtext: "Other users are watching ads..." (smaller, slightly transparent)

**Animation**:
- Fade-in animation when appearing
- Smooth spinner rotation

## Debugging

If issues occur, check:

1. **Console Logs**: Open DevTools Console for debug messages
   - Look for "Sync Player: YouTube ad detected"
   - Look for "Sync Player: Started YouTube ad monitoring"

2. **Network**: Verify WebSocket connection to signaling server
   - Should see "Connected to sync server!" in the extension popup

3. **Ad Detection**: Manually check if YouTube player has ad-related classes
   - Inspect `.html5-video-player` for `ad-showing` class
   - Check for `.video-ads.ytp-ad-module` visibility

4. **Extension State**: Check the extension popup
   - Verify users are in the same room
   - Check user count matches expected number
   - Verify connection status shows "Connected"

## Known Limitations

1. **Ad Blockers**: If users have ad blockers installed, they won't see ads and synchronization may not work as expected. All users should either have ad blockers enabled or disabled.

2. **YouTube Premium**: Users with YouTube Premium don't see ads, so this feature won't activate for them.

3. **Network Latency**: There may be a 1-second delay in ad detection due to the polling interval.

## Reporting Issues

When reporting issues, please include:
- Browser version and OS
- Number of users in the room
- Console logs from DevTools
- Screenshot of the issue
- Steps to reproduce
