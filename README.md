# Puls Proxy

Adaptive streaming proxy for Puls_Android. Sits between the app and Backblaze B2.
Transcodes FLAC on the fly based on requested quality. FLAC stays untouched in B2.

## Endpoints

### GET /health
Returns `{ status: 'ok' }` — use for uptime checks.

### GET /stream?file=PATH&quality=QUALITY

| Param | Required | Values |
|---|---|---|
| file | yes | Path to file in B2 bucket (e.g. `Music/Artist/Album/song.flac`) |
| quality | no | `flac`, `high`, `medium`, `low` (default: `high`) |

| Quality | Format | Bitrate |
|---|---|---|
| flac | FLAC | Passthrough (no transcode) |
| high | MP3 | 320kbps |
| medium | MP3 | 192kbps |
| low | AAC | 128kbps |

### Example
```
http://23.95.216.131:3000/stream?file=Music/Prince/Purple Rain.flac&quality=high
```

## Setup

```bash
# On RackNerd VPS
chmod +x setup.sh
./setup.sh

cp .env.example .env
nano .env   # fill in B2 keys

pm2 start server.js --name puls-proxy
pm2 save
pm2 startup
```

## Android Integration

In Puls_Android, detect connection type and pass the quality param:

```kotlin
val quality = when {
    isWifi() -> "flac"
    is4G()   -> "high"
    is3G()   -> "medium"
    else     -> "low"
}
val streamUrl = "http://23.95.216.131:3000/stream?file=${encodedPath}&quality=$quality"
```
