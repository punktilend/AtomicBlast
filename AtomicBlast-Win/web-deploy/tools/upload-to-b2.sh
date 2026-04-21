#!/usr/bin/env bash
set -euo pipefail

TORRENT_NAME="${1:-}"
TORRENT_PATH="${2:-}"
TORRENT_LABEL="${3:-}"

LOG_FILE="/var/log/seedcrow.log"
LOCK_FILE="/tmp/organize-music.lock"
ORGANIZER="/root/organize-music.sh"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

if [[ -z "$TORRENT_NAME" ]]; then
  log "upload-to-b2: skipped because torrent name was empty"
  exit 0
fi

log "upload-to-b2: completed torrent name='$TORRENT_NAME' path='$TORRENT_PATH' label='$TORRENT_LABEL'"

if [[ ! -x "$ORGANIZER" ]]; then
  log "upload-to-b2: organizer missing or not executable at $ORGANIZER"
  exit 1
fi

if flock -n "$LOCK_FILE" "$ORGANIZER" "$TORRENT_NAME" >> "$LOG_FILE" 2>&1; then
  log "upload-to-b2: organizer finished for '$TORRENT_NAME'"
else
  log "upload-to-b2: organizer busy, cron fallback will pick up '$TORRENT_NAME'"
fi
