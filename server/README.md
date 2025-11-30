# Sync Player Signaling Server

A WebSocket signaling server that enables cross-device video synchronization for the Sync Player Chrome extension.

## Overview

This server acts as a relay for video synchronization events between different devices running the Sync Player extension. When users join the same room, their video playback events (play, pause, seek, rate change) are broadcast to all other users in that room.

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

## Deployment

### Deploying to Glitch

1. Create a new project on [Glitch](https://glitch.com)
2. Import from GitHub or paste the server code
3. The server will automatically start

### Deploying to Railway/Render/Fly.io

These platforms support Node.js applications out of the box. Simply connect your repository and deploy.

### Environment Variables

- `PORT`: The port to listen on (default: 8080)

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

## License

MIT
