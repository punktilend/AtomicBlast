#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# replay-completed.sh
#
# Re-runs upload-to-b2.sh for every completed torrent in qBittorrent.
# Safe to run on already-processed torrents — rclone skips existing files.
#
# Usage:
#   ./replay-completed.sh [--dry-run]
#
#   --dry-run   Print what would be processed without running anything
#
# Env vars:
#   QB_URL      qBittorrent web UI base URL  (default: http://localhost:8080)
#   QB_USER     qBittorrent username         (default: admin)
#   QB_PASS     qBittorrent password         (default: adminadmin)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

QB_URL="${QB_URL:-http://localhost:8080}"
QB_USER="${QB_USER:-admin}"
QB_PASS="${QB_PASS:-adminadmin}"
UPLOAD_SCRIPT="${UPLOAD_SCRIPT:-/root/upload-to-b2.sh}"
LOG=/var/log/seedcrow.log

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# ── Login to qBittorrent, store session cookie ────────────────────────────────
COOKIE_JAR=$(mktemp /tmp/qb_cookies_XXXX)
trap 'rm -f "$COOKIE_JAR"' EXIT

login_resp=$(curl -sf -c "$COOKIE_JAR" \
    --data-urlencode "username=${QB_USER}" \
    --data-urlencode "password=${QB_PASS}" \
    "${QB_URL}/api/v2/auth/login")

if [[ "$login_resp" != "Ok." ]]; then
    echo "ERROR: qBittorrent login failed (got: $login_resp)"
    echo "  Check QB_URL, QB_USER, QB_PASS env vars or that qBittorrent web UI is enabled."
    exit 1
fi

log "Logged in to qBittorrent at ${QB_URL}"

# ── Fetch completed torrents ──────────────────────────────────────────────────
torrents_json=$(curl -sf -b "$COOKIE_JAR" \
    "${QB_URL}/api/v2/torrents/info?filter=completed")

count=$(echo "$torrents_json" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
log "Found $count completed torrent(s)"

if [[ "$DRY_RUN" -eq 1 ]]; then
    log "--- DRY RUN (nothing will be executed) ---"
fi

# ── Process each torrent ──────────────────────────────────────────────────────
processed=0
skipped=0

echo "$torrents_json" | python3 -c "
import sys, json
for t in json.load(sys.stdin):
    name = t.get('name','').strip()
    path = t.get('content_path') or t.get('save_path','')
    print(f'{name}\t{path}')
" | while IFS=$'\t' read -r name path; do
    if [[ -z "$name" ]]; then
        skipped=$((skipped+1))
        continue
    fi

    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "  [DRY] Would process: $name  (path: $path)"
    else
        log "Processing: $name"
        bash "$UPLOAD_SCRIPT" "$name" "$path" || log "  ✗ Failed: $name"
    fi
done

log "=== replay-completed done ==="
