#!/bin/bash
TORRENT_NAME="$1"
TORRENT_PATH="$2"
ATOMICBLAST_URL="${ATOMICBLAST_URL:-http://localhost:3000}"
LOG=/var/log/seedcrow.log

echo "[$(date)] Completed: $TORRENT_NAME" >> "$LOG"
/root/organize-music.sh "$TORRENT_NAME" >> "$LOG" 2>&1

if [ $? -eq 0 ]; then
    echo "[$(date)] Triggering AtomicBlast library rescan..." >> "$LOG"
    curl -sf -X POST "${ATOMICBLAST_URL}/api/scan-b2-music/refresh" >> "$LOG" 2>&1 \
        && echo "[$(date)] Rescan triggered OK" >> "$LOG" \
        || echo "[$(date)] Rescan ping failed (server down?)" >> "$LOG"
fi
