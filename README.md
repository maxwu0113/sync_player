# Sync Player

A Chrome extension that allows users to remotely synchronize watching the same video together across different devices.

## Features

- **Create Room**: Generate a unique room ID to share with friends
- **Join Room**: Enter a room ID to sync with others watching the same video
- **Real-time Sync**: Automatically synchronize play, pause, seek, and playback speed
- **Cross-Device Sync**: Sync video playback across different devices and browsers
- **Works on Any Video**: Compatible with video elements on any website
- **YouTube Ad Synchronization**: Automatically detects and synchronizes YouTube advertisements - all users wait for ads to finish before resuming playback

## Installation

### Development Mode

1. Clone this repository:
   ```bash
   git clone https://github.com/maxwu0113/sync_player.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" in the top right corner

4. Click "Load unpacked" and select the `sync_player` directory

5. The Sync Player extension icon will appear in your browser toolbar

## Usage

1. **Create a Room**:
   - Click the Sync Player extension icon
   - Click "Create Room" to generate a unique room ID
   - Share this room ID with friends

2. **Join a Room**:
   - Click the Sync Player extension icon
   - Enter the room ID shared by a friend
   - Click "Join Room"

3. **Sync Videos**:
   - Navigate to a page with a video (e.g., YouTube, Netflix, etc.)
   - When one user plays, pauses, or seeks the video, all users in the room will be synchronized
   - Works across different devices and browsers!

4. **Manual Sync**:
   - Click "Sync Now" to manually broadcast your current video state to all room members

5. **YouTube Ad Synchronization**:
   - When watching YouTube videos together, the extension automatically detects when ads are playing
   - If one user is watching an ad, other users will be paused and see a "Waiting for others" notification
   - Once all users have finished watching ads, playback resumes automatically
   - This ensures everyone stays synchronized and no one misses content while others watch ads

## Cross-Device Synchronization

The extension supports real-time synchronization across different devices. When you create or join a room, the extension connects to a signaling server that relays video events between all participants.

### Setting Up Your Own Signaling Server

If you want to use your own signaling server instead of the default one:

1. Navigate to the `server` directory
2. Install dependencies: `npm install`
3. Start the server: `npm start`
4. Update the `signalingServerUrl` in `background.js` to point to your server

See [server/README.md](server/README.md) for more details.

## File Structure

```
sync_player/
├── manifest.json      # Chrome extension manifest
├── background.js      # Service worker for message handling and WebSocket connection
├── content.js         # Content script for video monitoring
├── popup.html         # Extension popup UI
├── popup.css          # Popup styles
├── popup.js           # Popup interaction logic
├── server/            # Signaling server for cross-device sync
│   ├── server.js      # WebSocket server
│   ├── package.json   # Server dependencies
│   └── README.md      # Server documentation
├── icons/             # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md          # This file
```

## Technical Details

- **Manifest Version**: 3 (latest Chrome extension standard)
- **Permissions**: 
  - `storage`: For persisting room state
  - `activeTab`: For accessing the current tab
  - `tabs`: For cross-tab communication
- **Cross-Device Sync**: WebSocket-based signaling server for real-time communication

## License

MIT License - see [LICENSE](LICENSE) file for details
