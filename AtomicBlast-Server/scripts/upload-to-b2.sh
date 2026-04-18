#!/bin/bash
TORRENT_NAME="$1"
TORRENT_PATH="$2"
echo "[$(date)] Completed: $TORRENT_NAME" >> /var/log/seedcrow.log
/root/organize-music.sh "$TORRENT_NAME" >> /var/log/seedcrow.log 2>&1
