# Sync Player Signaling Server

A WebSocket signaling server that enables cross-device video synchronization for the Sync Player Chrome extension.

## Overview

This server acts as a relay for video synchronization events between different devices running the Sync Player extension. When users join the same room, their video playback events (play, pause, seek, rate change) are broadcast to all other users in that room.

## Features

- **Room-based synchronization**: Users can create and join rooms with unique IDs
- **Real-time communication**: WebSocket-based for low-latency message delivery
- **Video event broadcasting**: Play, pause, seek, and playback rate changes
- **Health check endpoint**: Monitor server status
- **Auto-reconnection support**: Built-in support for reconnection on disconnect

## Setup

### Prerequisites

- Node.js 14.0.0 or higher
- npm

### Installation

```bash
cd server
npm install
```

### Running Locally

```bash
npm start
```

The server will start on port 8080 by default. You can change this by setting the `PORT` environment variable:

```bash
PORT=3000 npm start
```

### Running Tests

```bash
npm test
```

### Demo Page

Open `demo.html` in your browser to test the WebSocket server functionality. You can:
1. Connect to the server
2. Join rooms
3. Send test video events
4. See messages in real-time

## Deployment

### GitHub Actions CI

This repository includes a GitHub Actions workflow (`.github/workflows/server-ci.yml`) that:
- Runs tests on Node.js 18.x and 20.x
- Performs health checks
- Validates server functionality on each push

### Deploying to GitHub Codespaces

1. Open this repository in GitHub Codespaces
2. Run `cd server && npm install && npm start`
3. The server will be available at the forwarded port

### Deploying to Glitch

1. Create a new project on [Glitch](https://glitch.com)
2. Import from GitHub: `https://github.com/maxwu0113/sync_player`
3. In the Glitch terminal, run:
   ```bash
   cd server
   npm install
   ```
4. Update `package.json` in Glitch root to point to server:
   ```json
   {
     "scripts": {
       "start": "cd server && npm start"
     }
   }
   ```
5. The server will automatically start and be available at `wss://your-project.glitch.me`

### Deploying to Railway

1. Go to [Railway](https://railway.app)
2. Create a new project → Deploy from GitHub repo
3. Select the `server` directory as the root
4. Railway will auto-detect Node.js and deploy
5. Get your URL from the Railway dashboard

### Deploying to Render

1. Go to [Render](https://render.com)
2. Create a new Web Service
3. Connect your GitHub repository
4. Set the following:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Deploy and get your URL

### Deploying to Fly.io

1. Install the Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Login: `fly auth login`
3. Initialize from the server directory:
   ```bash
   cd server
   fly launch
   ```
4. Deploy: `fly deploy`

### Environment Variables

- `PORT`: The port to listen on (default: 8080)

## Updating the Chrome Extension

After deploying your server, update the `signalingServerUrl` in `background.js`:

```javascript
const DEFAULT_SIGNALING_SERVER = 'wss://your-server-url.com';
```

## API

### WebSocket Messages

#### Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `JOIN_ROOM` | `{ roomId: string }` | Join a synchronization room |
| `LEAVE_ROOM` | `{ roomId: string }` | Leave a room |
| `VIDEO_EVENT` | `{ roomId: string, event: object }` | Broadcast a video event |
| `SYNC_VIDEO_STATE` | `{ roomId: string, state: object }` | Broadcast current video state |

#### Server → Client

| Type | Payload | Description |
|------|---------|-------------|
| `CONNECTED` | `{}` | Connection established |
| `ROOM_JOINED` | `{ roomId: string, peerCount: number }` | Successfully joined a room |
| `ROOM_LEFT` | `{ roomId: string }` | Successfully left a room |
| `PEER_JOINED` | `{ peerCount: number }` | A new peer joined the room |
| `PEER_LEFT` | `{ peerCount: number }` | A peer left the room |
| `VIDEO_EVENT` | `{ event: object }` | Video event from another peer |
| `SYNC_VIDEO_STATE` | `{ state: object }` | Video state from another peer |
| `ERROR` | `{ error: string }` | Error message |

### Video Event Object

```javascript
{
  eventType: 'play' | 'pause' | 'seek' | 'ratechange',
  currentTime: number,      // Current playback position in seconds
  playbackRate: number,     // Playback speed (1.0 = normal)
  paused: boolean,          // Whether video is paused
  timestamp: number         // Unix timestamp for latency compensation
}
```

### Video State Object

```javascript
{
  currentTime: number,
  paused: boolean,
  playbackRate: number,
  timestamp: number
}
```

### Health Check

```
GET /health
```

Returns:
```json
{
  "status": "healthy",
  "rooms": 5
}
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Device A       │     │  Device B       │
│  (Chrome)       │     │  (Chrome)       │
│                 │     │                 │
│  Sync Player    │     │  Sync Player    │
│  Extension      │     │  Extension      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │   WebSocket           │   WebSocket
         │                       │
         ▼                       ▼
    ┌────────────────────────────────┐
    │     Signaling Server           │
    │                                │
    │  ┌─────────────────────────┐   │
    │  │  Room: ABC123           │   │
    │  │  - Device A             │   │
    │  │  - Device B             │   │
    │  └─────────────────────────┘   │
    └────────────────────────────────┘
```

## Room Flow

1. **Client A** connects → Receives `CONNECTED`
2. **Client A** sends `JOIN_ROOM` with roomId → Receives `ROOM_JOINED` with peerCount=1
3. **Client B** connects → Receives `CONNECTED`
4. **Client B** sends `JOIN_ROOM` with same roomId → Receives `ROOM_JOINED` with peerCount=2
5. **Client A** receives `PEER_JOINED` with peerCount=2
6. **Client A** sends `VIDEO_EVENT` (e.g., play) → **Client B** receives `VIDEO_EVENT`
7. **Client B** leaves → **Client A** receives `PEER_LEFT`

## License

MIT
