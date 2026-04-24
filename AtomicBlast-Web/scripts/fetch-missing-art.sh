#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# fetch-missing-art.sh
#
# Scans every Artist and Artist/Album folder in B2 and fetches any missing
# cover art or artist photos via Last.fm.  Safe to re-run — skips folders
# that already have the image.
#
# Usage:
#   ./fetch-missing-art.sh [--dry-run] [--artist "Name"] [--force]
#
#   --dry-run        Show what would be fetched without uploading anything
#   --artist "Name"  Only process one specific artist folder
#   --force          Re-fetch art even if it already exists (overwrite)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MUSIC="crowbox:SpAtomify/Music"
LASTFM_API_KEY="${LASTFM_API_KEY:-d67dea9be32d3f2510ef5cde2db140fb}"
LOG="${FETCH_ART_LOG:-/var/log/fetch-missing-art.log}"

DRY_RUN=0
FORCE=0
ONLY_ARTIST=""

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --force)   FORCE=1 ;;
        --artist)  shift; ONLY_ARTIST="$1" ;;
        *)         if [[ "${PREV_ARG:-}" == "--artist" ]]; then ONLY_ARTIST="$arg"; fi ;;
    esac
    PREV_ARG="$arg"
done

# ── Counters ──────────────────────────────────────────────────────────────────
ARTIST_OK=0
ARTIST_FETCHED=0
ARTIST_MISS=0
ALBUM_OK=0
ALBUM_FETCHED=0
ALBUM_MISS=0

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

dry() {
    echo "  [DRY] $*"
}

# ── URL-encode a string (requires python3) ────────────────────────────────────
urlencode() {
    python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$1" 2>/dev/null || echo "$1"
}

# ── "The Beatles" → "Beatles, The" for Last.fm article-aware sorting ─────────
normalize_for_lastfm() {
    echo "$1" | sed -E 's/^(The|A|An) (.+)$/\2, \1/'
}

# ── Check whether a path exists in B2 ────────────────────────────────────────
b2_exists() {
    rclone lsf "$1" --max-depth 1 2>/dev/null | grep -q . && return 0 || return 1
}

# ── Upload a temp file to B2, then delete it ─────────────────────────────────
upload_image() {
    local tmp="$1" b2_path="$2"
    if [ "$DRY_RUN" -eq 1 ]; then
        dry "Would upload -> $b2_path"
        rm -f "$tmp"
        return
    fi
    rclone copyto "$tmp" "$b2_path" 2>>"$LOG" \
        && log "  ✓ Uploaded -> $b2_path" \
        || log "  ✗ Upload failed -> $b2_path"
    rm -f "$tmp"
}

# ── Fetch artist photo from Last.fm → artist.jpg ─────────────────────────────
fetch_artist_art() {
    local artist="$1"
    local b2_dir="$MUSIC/$artist"
    local b2_target="$b2_dir/artist.jpg"

    # Skip if already present (unless --force)
    if [ "$FORCE" -eq 0 ] && rclone lsf "$b2_target" 2>/dev/null | grep -q "artist.jpg"; then
        ARTIST_OK=$((ARTIST_OK + 1))
        return
    fi

    local display_name; display_name=$(normalize_for_lastfm "$artist")
    local encoded;      encoded=$(urlencode "$display_name")
    local resp img

    resp=$(curl -sf --max-time 10 \
        "http://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encoded}&api_key=${LASTFM_API_KEY}&format=json")

    img=$(echo "$resp" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    imgs = d['artist']['image']
    for i in reversed(imgs):
        u = i.get('#text', '')
        if u and 'placeholder' not in u and u.strip():
            print(u); break
except:
    pass
" 2>/dev/null)

    if [ -n "$img" ]; then
        if [ "$DRY_RUN" -eq 1 ]; then
            dry "Would fetch artist art for: $artist  ($img)"
            ARTIST_FETCHED=$((ARTIST_FETCHED + 1))
            return
        fi
        local tmp; tmp=$(mktemp /tmp/artist_XXXX.jpg)
        if curl -sf --max-time 20 -o "$tmp" "$img" && [ -s "$tmp" ]; then
            upload_image "$tmp" "$b2_target"
            ARTIST_FETCHED=$((ARTIST_FETCHED + 1))
        else
            rm -f "$tmp"
            log "  ✗ Download failed for artist art: $artist"
            ARTIST_MISS=$((ARTIST_MISS + 1))
        fi
    else
        log "  ~ No Last.fm artist art: $artist"
        ARTIST_MISS=$((ARTIST_MISS + 1))
    fi
}

# ── Fetch album cover from Last.fm → cover.jpg ───────────────────────────────
fetch_album_art() {
    local artist="$1" album="$2"
    local b2_dir="$MUSIC/$artist/$album"
    local b2_target="$b2_dir/cover.jpg"

    # Skip if already present (unless --force)
    if [ "$FORCE" -eq 0 ] && rclone lsf "$b2_target" 2>/dev/null | grep -q "cover.jpg"; then
        ALBUM_OK=$((ALBUM_OK + 1))
        return
    fi

    # Also accept folder.jpg / front.jpg / artwork.jpg as existing cover
    if [ "$FORCE" -eq 0 ]; then
        local existing
        existing=$(rclone lsf "$b2_dir/" 2>/dev/null \
            | grep -iE '^(cover|folder|front|artwork|album)\.(jpg|png)$' | head -1)
        if [ -n "$existing" ]; then
            ALBUM_OK=$((ALBUM_OK + 1))
            return
        fi
    fi

    local display_artist; display_artist=$(normalize_for_lastfm "$artist")
    local enc_artist enc_album
    enc_artist=$(urlencode "$display_artist")
    enc_album=$(urlencode "$album")

    local resp img
    resp=$(curl -sf --max-time 10 \
        "http://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${enc_artist}&album=${enc_album}&api_key=${LASTFM_API_KEY}&format=json")

    img=$(echo "$resp" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    imgs = d['album']['image']
    for i in reversed(imgs):
        u = i.get('#text', '')
        if u and 'placeholder' not in u and u.strip():
            print(u); break
except:
    pass
" 2>/dev/null)

    if [ -n "$img" ]; then
        if [ "$DRY_RUN" -eq 1 ]; then
            dry "Would fetch album art for: $artist / $album  ($img)"
            ALBUM_FETCHED=$((ALBUM_FETCHED + 1))
            return
        fi
        local tmp; tmp=$(mktemp /tmp/cover_XXXX.jpg)
        if curl -sf --max-time 20 -o "$tmp" "$img" && [ -s "$tmp" ]; then
            upload_image "$tmp" "$b2_target"
            ALBUM_FETCHED=$((ALBUM_FETCHED + 1))
        else
            rm -f "$tmp"
            log "  ✗ Download failed for album art: $artist / $album"
            ALBUM_MISS=$((ALBUM_MISS + 1))
        fi
    else
        log "  ~ No Last.fm album art: $artist / $album"
        ALBUM_MISS=$((ALBUM_MISS + 1))
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
log "=== fetch-missing-art starting ==="
[ "$DRY_RUN"  -eq 1 ] && log "--- DRY RUN (no changes will be made) ---"
[ "$FORCE"    -eq 1 ] && log "--- FORCE mode (will overwrite existing art) ---"
[ -n "$ONLY_ARTIST" ] && log "--- Single artist mode: $ONLY_ARTIST ---"

# Get artist list
if [ -n "$ONLY_ARTIST" ]; then
    artists=("$ONLY_ARTIST")
else
    mapfile -t artists < <(rclone lsf "$MUSIC" --dirs-only 2>/dev/null | sed 's|/$||' | sort)
fi

total_artists=${#artists[@]}
log "Found $total_artists artist folder(s) to process"

for artist in "${artists[@]}"; do
    log "Artist: $artist"

    # Fetch artist photo
    fetch_artist_art "$artist"

    # Fetch album covers
    mapfile -t albums < <(rclone lsf "$MUSIC/$artist" --dirs-only 2>/dev/null | sed 's|/$||' | sort)

    for album in "${albums[@]}"; do
        # Skip non-album meta folders
        case "${album,,}" in
            artwork|scans|extras|bonus|booklet|images|covers|art) continue ;;
        esac

        log "  Album: $artist / $album"
        fetch_album_art "$artist" "$album"

        # Throttle slightly to avoid Last.fm rate limits
        sleep 0.3
    done
done

log "=== Done ==="
log "Artist art  — already had: $ARTIST_OK  |  fetched: $ARTIST_FETCHED  |  no result: $ARTIST_MISS"
log "Album covers — already had: $ALBUM_OK   |  fetched: $ALBUM_FETCHED   |  no result: $ALBUM_MISS"
