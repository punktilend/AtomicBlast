#!/bin/bash
# organize-music.sh
# Organizes music from crowbox/seedbox/ into aharveyGoogleDriveBackup/Music/
# with Artist/Year - Album/ structure, fetches art from Last.fm
#
# Usage:
#   ./organize-music.sh "Radiohead - OK Computer (1997) [FLAC]"   # single torrent
#   ./organize-music.sh                                            # scan all seedbox

SEEDBOX="crowbox:crowbox/seedbox"
MUSIC="crowbox:aharveyGoogleDriveBackup/Music"
LASTFM_API_KEY="d67dea9be32d3f2510ef5cde2db140fb"
LOG="/var/log/organize-music.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# -------------------------------------------------------
# Parse torrent folder name into ARTIST, ALBUM, YEAR, ALBUM_FOLDER
# -------------------------------------------------------
parse_name() {
    local raw="$1"

    # Extract year (1950-2029)
    YEAR=$(echo "$raw" | grep -oP '\b(19[5-9]\d|20[0-2]\d)\b' | head -1)

    # Strip format tags, catalog numbers, quality markers, parenthetical junk
    local clean
    clean=$(echo "$raw" \
        | sed -E 's/\[[^]]*\]//g' \
        | sed -E 's/\{[^}]*\}//g' \
        | sed -E 's/\([^)]*\)//g' \
        | sed -E 's/-?\s*(REMASTER(ED)?|DELUXE|BONUS|LIMITED|EDITION|REISSUE|EXPANDED)\s*//gi' \
        | sed -E 's/  +/ /g' \
        | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

    # Split on first " - "
    if echo "$clean" | grep -q ' - '; then
        ARTIST=$(echo "$clean" | sed 's/ - .*//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        ALBUM=$(echo "$clean" | sed 's/^[^-]*- //' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    else
        ARTIST="$clean"
        ALBUM="$clean"
    fi

    # Strip leading "YEAR - " from album if present (e.g. "1997 - OK Computer")
    ALBUM=$(echo "$ALBUM" | sed -E 's/^(19[5-9][0-9]|20[0-2][0-9]) - //')

    # Sanitize: remove trailing dots/spaces
    ARTIST=$(echo "$ARTIST" | sed 's/[. ]*$//')
    ALBUM=$(echo "$ALBUM"  | sed 's/[. ]*$//')

    # Build album folder name
    if [ -n "$YEAR" ]; then
        ALBUM_FOLDER="$YEAR - $ALBUM"
    else
        ALBUM_FOLDER="$ALBUM"
    fi
}

# -------------------------------------------------------
# Upload a local temp file to B2 then remove it
# -------------------------------------------------------
# Normalize "Artist, The" -> "The Artist" for Last.fm queries
# -------------------------------------------------------
normalize_for_lastfm() {
    echo "$1" | sed -E 's/^(.+), (The|A|An)$/\2 \1/'
}

# -------------------------------------------------------
upload_image() {
    local tmp="$1"
    local b2_path="$2"
    rclone copyto "$tmp" "$b2_path" 2>/dev/null \
        && log "  Art -> $b2_path" \
        || log "  WARN: failed to upload art to $b2_path"
    rm -f "$tmp"
}

# -------------------------------------------------------
# Fetch artist photo from Last.fm -> artist.jpg
# Skips if already exists in B2
# -------------------------------------------------------
fetch_artist_art() {
    local artist="$1"
    local b2_artist_dir="$2"

    rclone lsf "$b2_artist_dir/artist.jpg" 2>/dev/null | grep -q "artist.jpg" && return

    local artist_query; artist_query=$(normalize_for_lastfm "$artist")
    local encoded
    encoded=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$artist_query" 2>/dev/null)
    local resp
    resp=$(curl -sf "http://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encoded}&api_key=${LASTFM_API_KEY}&format=json")
    local img
    img=$(echo "$resp" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    imgs=d['artist']['image']
    for i in reversed(imgs):
        u=i.get('#text','')
        if u and 'placeholder' not in u:
            print(u); break
except: pass
" 2>/dev/null)

    if [ -n "$img" ]; then
        local tmp; tmp=$(mktemp /tmp/artist_XXXX.jpg)
        curl -sf -o "$tmp" "$img" && upload_image "$tmp" "$b2_artist_dir/artist.jpg" || rm -f "$tmp"
    else
        log "  No artist art found for: $artist_query"
    fi
}

# -------------------------------------------------------
# Fetch album cover from Last.fm -> cover.jpg
# Skips if already exists in B2
# -------------------------------------------------------
fetch_album_art() {
    local artist="$1"
    local album="$2"
    local b2_album_dir="$3"

    rclone lsf "$b2_album_dir/cover.jpg" 2>/dev/null | grep -q "cover.jpg" && return

    local artist_query; artist_query=$(normalize_for_lastfm "$artist")
    local enc_artist enc_album
    enc_artist=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$artist_query" 2>/dev/null)
    enc_album=$(python3 -c  "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$album"  2>/dev/null)
    local resp
    resp=$(curl -sf "http://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${enc_artist}&album=${enc_album}&api_key=${LASTFM_API_KEY}&format=json")
    local img
    img=$(echo "$resp" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    imgs=d['album']['image']
    for i in reversed(imgs):
        u=i.get('#text','')
        if u and 'placeholder' not in u:
            print(u); break
except: pass
" 2>/dev/null)

    if [ -n "$img" ]; then
        local tmp; tmp=$(mktemp /tmp/cover_XXXX.jpg)
        curl -sf -o "$tmp" "$img" && upload_image "$tmp" "$b2_album_dir/cover.jpg" || rm -f "$tmp"
    else
        log "  No album art found for: $artist_query - $album"
    fi
}

# -------------------------------------------------------
# Process a single seedbox torrent folder
# -------------------------------------------------------
process_torrent() {
    local torrent_name="$1"

    # Skip non-music — check for audio files in the folder
    local has_audio
    has_audio=$(rclone lsf "$SEEDBOX/$torrent_name" --recursive 2>/dev/null \
        | grep -iE '\.(flac|mp3|aac|ogg|wav|m4a|opus|wma)$' | head -1)

    if [ -z "$has_audio" ]; then
        log "Skipping (no audio files): $torrent_name"
        return
    fi

    parse_name "$torrent_name"

    log "Processing: $torrent_name"
    log "  Artist: $ARTIST"
    log "  Album:  $ALBUM_FOLDER"

    local src="$SEEDBOX/$torrent_name"
    local dst="$MUSIC/$ARTIST/$ALBUM_FOLDER"

    # Server-side B2 copy — audio files only, no re-upload of data
    rclone copy "$src" "$dst" \
        --transfers=4 \
        --include "*.flac" \
        --include "*.mp3"  \
        --include "*.aac"  \
        --include "*.ogg"  \
        --include "*.wav"  \
        --include "*.m4a"  \
        --include "*.opus" \
        --include "*.wma"  \
        --include "*.cue"  \
        --include "*.log"  \
        --include "*.m3u"  \
        --include "*.m3u8" \
        --include "*.nfo"  \
        --include "*.jpg"  \
        --include "*.jpeg" \
        --include "*.png"  \
        --include "*.webp" \
        --log-file="$LOG" 2>/dev/null

    log "  Copied to: $dst"

    # Fetch artwork
    fetch_artist_art "$ARTIST" "$MUSIC/$ARTIST"
    fetch_album_art  "$ARTIST" "$ALBUM" "$dst"

    log "  Done: $torrent_name"
}

# -------------------------------------------------------
# Entry point
# -------------------------------------------------------
if [ -n "$1" ]; then
    process_torrent "$1"
else
    log "=== Full seedbox scan started ==="
    rclone lsf "$SEEDBOX" --dirs-only 2>/dev/null | sed 's|/$||' | while read -r dir; do
        process_torrent "$dir"
    done
    log "=== Full scan complete ==="
fi
