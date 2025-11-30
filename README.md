# Sync Player

A Chrome extension that allows users to remotely synchronize watching the same video together.

## Features

- **Create Room**: Generate a unique room ID to share with friends
- **Join Room**: Enter a room ID to sync with others watching the same video
- **Real-time Sync**: Automatically synchronize play, pause, seek, and playback speed
- **Works on Any Video**: Compatible with video elements on any website

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

4. **Manual Sync**:
   - Click "Sync Now" to manually broadcast your current video state to all room members

## File Structure

```
sync_player/
├── manifest.json      # Chrome extension manifest
├── background.js      # Service worker for message handling
├── content.js         # Content script for video monitoring
├── popup.html         # Extension popup UI
├── popup.css          # Popup styles
├── popup.js           # Popup interaction logic
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

## License

MIT License - see [LICENSE](LICENSE) file for details
