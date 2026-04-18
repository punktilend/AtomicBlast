# AtomicBlast-Server

The server-side of AtomicBlast. Runs on a RackNerd VPS (`23.95.216.131`) as a Node.js Express app managed by PM2. Handles B2 library scanning, on-the-fly audio transcoding, metadata enrichment, and serves the AtomicBlast web PWA.

## Folder Structure

```
AtomicBlast-Server/
  server.js           — Express app (~1000 lines): B2 scanning, streaming, Spotify/Last.fm metadata, PWA host
  package.json
  setup.sh            — First-time VPS setup (apt deps, PM2, node)
  public/             — AtomicBlast web PWA (served at /)
    index.html
    ipc-shim.js       — Electron ipcRenderer shim → HTTP fetch (app was originally Electron)
    mobile.css
    manifest.json
    assets/
  scripts/
    upload-to-b2.sh   — Called by qBittorrent on torrent complete; copies to B2 seedbox, triggers organize
    organize-music.sh — Parses torrent name, copies audio to Music library, fetches Last.fm artwork
    music-cleanup.sh  — Cleanup utility for the music library
    watch-cleanup.sh  — Watch-based cleanup helper
```

## Services & Ports

| Service | Manager | Port | Notes |
|---|---|---|---|
| pulse-proxy (server.js) | PM2 | :3000 | AtomicBlast server |
| qbittorrent | systemd | :8080 | Calls upload-to-b2.sh on complete; runs as root |
| jellyfin | systemd | :8096 | Video media server |
| rclone-crowbox | systemd | — | FUSE mounts B2 at /crowbox with 10G VFS write cache |

## Pipeline

```
Torrent completes
  → upload-to-b2.sh      copies to crowbox:crowbox/seedbox/, calls organize-music.sh
  → organize-music.sh    parses name, copies audio to crowbox:aharveyGoogleDriveBackup/Music/
                         fetches artist.jpg + cover.jpg from Last.fm API
  → pulse-proxy          scans B2, caches library in-memory, streams on demand
```

## B2 Layout

```
crowbox: (rclone remote, type=b2)
  crowbox/seedbox/                                         ← raw torrents (kept for seeding)
  aharveyGoogleDriveBackup/Music/<Artist>/<Year - Album>/  ← organized library
```

The `rclone-crowbox` systemd service FUSE-mounts all of `crowbox:` at `/crowbox`.
`upload-to-b2.sh` writes through the mount at `/crowbox/crowbox/seedbox/`.
`organize-music.sh` uses `rclone copy` directly (not the mount) for the organized library.

## Environment Variables

Set in PM2 env or `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `B2_KEY_ID` / `B2_APP_KEY` | hardcoded in server.js | B2 native API credentials |
| `B2_BUCKET` | `aharveyGoogleDriveBackup` | Bucket name |
| `B2_BUCKET_URL` | `https://s3.us-east-005.backblazeb2.com/aharveyGoogleDriveBackup` | S3-compat URL for /stream |
| `B2_PREFIX` | `Music/` | Library prefix for B2 scanning |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | — | Spotify metadata (optional) |
| `LASTFM_API_KEY` | — | Last.fm bio/tags/artwork (optional) |
| `PORT` | `3000` | HTTP port |

## Key API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Uptime check — returns `{ status: 'ok' }` |
| `GET /library` | Full B2 library scan (cached 1h) — returns artists/albums/tracks |
| `GET /stream?file=PATH&quality=QUALITY` | Stream/transcode from B2 |
| `GET /spotify/*` | Spotify metadata proxy (artist, album, features, recommendations) |
| `GET /lastfm/*` | Last.fm bio, tags, listener counts |
| `POST /favorites` | Add/remove favorited tracks |
| `GET /playlists` | Playlist + liked songs state |
| `GET /playback-state` | Cross-device resume state |

### Stream Quality Options

| quality | Format | Bitrate |
|---|---|---|
| `flac` | FLAC | Passthrough |
| `high` | MP3 | 320kbps |
| `medium` | MP3 | 192kbps |
| `low` | AAC | 128kbps |

## Setup (Fresh VPS)

```bash
chmod +x setup.sh && ./setup.sh

# Fill in credentials
nano /opt/pulse-proxy/.env

# Start with PM2
pm2 start server.js --name pulse-proxy
pm2 save && pm2 startup

# Install cron for nightly scan
crontab -e
# add: 0 3 * * * /root/organize-music.sh >> /var/log/organize-music.log 2>&1

# Deploy scripts to /root
cp scripts/*.sh /root/ && chmod +x /root/*.sh
```

## Common Commands

```bash
pm2 restart pulse-proxy           # restart after code changes
pm2 logs pulse-proxy              # live logs
tail -f /var/log/seedcrow.log     # torrent + upload activity
tail -f /var/log/organize-music.log  # nightly scan

# Process a single torrent manually
/root/organize-music.sh "Artist - 2024 - Album Name [FLAC]"

# Full seedbox rescan (same as 3am cron)
/root/organize-music.sh

pm2 status
systemctl status qbittorrent rclone-crowbox jellyfin
```

## State Files (persisted to disk in /opt/pulse-proxy/)

| File | Purpose |
|---|---|
| `favorites.json` | Favorited tracks |
| `playlists.json` | Playlists + liked songs |
| `playback-state.json` | Cross-device resume position |
| `genres.json` | iTunes genre lookup cache |

## organize-music.sh — Name Parsing

Handles three torrent naming conventions:

1. `YEAR - Artist - Album` (year-prefixed)
2. `Artist (Year) Album` (parenthetical year, no dash)
3. `Artist - Album` (standard)

Strips `[FLAC]`, `(WEB)`, `{catalog}`, quality markers, and edition suffixes before parsing.
Sets globals: `$ARTIST`, `$ALBUM`, `$ALBUM_FOLDER` (`$YEAR - $ALBUM`), `$YEAR`.

## Versions

Node.js 20.20.2 | PM2 6.0.14 | rclone 1.73.2 | ffmpeg 4.2.7 | qBittorrent 4.1.7
