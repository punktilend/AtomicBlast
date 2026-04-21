#!/bin/bash
SEEDBOX="/crowbox/crowbox/seedbox"
MUSIC="crowbox:aharveyGoogleDriveBackup/Music"
LASTFM_API_KEY="d67dea9be32d3f2510ef5cde2db140fb"
LOG="/var/log/organize-music.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# Flip "Artist, The" -> "The Artist" for Last.fm queries
normalize_for_lastfm() {
    echo "$1" | sed -E 's/^(.*), (The|A|An)$/\2 \1/'
}

parse_name() {
    local raw="$1"

    # Extract year (1950-2029)
    YEAR=$(echo "$raw" | grep -oP '\b(19[5-9]\d|20[0-2]\d)\b' | head -1)

    # Strip format tags, catalog numbers, quality markers
    local clean
    clean=$(echo "$raw" \
        | sed -E 's/\[[^]]*\]//g' \
        | sed -E 's/\{[^}]*\}//g' \
        | sed -E 's/\([^)]*\)//g' \
        | sed -E 's/ - (FLAC|MP3|AAC|WEB|Vinyl|CD)[^-]*$//gi' \
        | sed -E 's/-?\s*(REMASTER(ED)?|DELUXE|BONUS|LIMITED|EDITION|REISSUE|EXPANDED)\s*//gi' \
        | sed -E 's/  +/ /g' \
        | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

    # Handle "YEAR - Artist - Album" format (year-prefixed)
    if echo "$clean" | grep -qP '^(19[5-9]\d|20[0-2]\d)\s*-'; then
        local rest
        rest=$(echo "$clean" | sed -E 's/^(19[5-9][0-9]|20[0-2][0-9])\s*-\s*//')
        if echo "$rest" | grep -q ' - '; then
            ARTIST=$(echo "$rest" | sed 's/ - .*//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            ALBUM=$(echo "$rest" | sed 's/^[^-]*- //' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        else
            ARTIST="$rest"
            ALBUM="$rest"
        fi
    # Handle "Artist (Year) Album" format — no dash separator
    elif ! echo "$clean" | grep -q ' - '; then
        local before_year after_year
        before_year=$(echo "$raw" | sed -E 's/\s*\((19[5-9][0-9]|20[0-2][0-9])\).*//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        after_year=$(echo "$raw"  | sed -E 's/^.*\((19[5-9][0-9]|20[0-2][0-9])\)\s*//' \
            | sed -E 's/\[[^]]*\]//g' | sed -E 's/\{[^}]*\}//g' \
            | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        if [ -n "$before_year" ] && [ -n "$after_year" ] && [ "$before_year" != "$after_year" ]; then
            ARTIST="$before_year"
            ALBUM="$after_year"
        else
            ARTIST="$clean"
            ALBUM="$clean"
        fi
    else
        # Normal "Artist - Album" format
        ARTIST=$(echo "$clean" | sed 's/ - .*//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        ALBUM=$(echo "$clean"  | sed 's/^[^-]*- //' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    fi

    # Strip leading "YEAR - " from album if present
    ALBUM=$(echo "$ALBUM" | sed -E 's/^(19[5-9][0-9]|20[0-2][0-9])\s*-\s*//')

    # Sanitize trailing dots/spaces
    ARTIST=$(echo "$ARTIST" | sed 's/[. ]*$//')
    ALBUM=$(echo "$ALBUM"   | sed 's/[. ]*$//')

    ALBUM_FOLDER="$ALBUM"
}

upload_image() {
    local tmp="$1" b2_path="$2"
    rclone copyto "$tmp" "$b2_path" 2>/dev/null \
        && log "  Art -> $b2_path" \
        || log "  WARN: failed to upload $b2_path"
    rm -f "$tmp"
}

fetch_artist_art() {
    local artist="$1" b2_artist_dir="$2"
    rclone lsf "$b2_artist_dir/artist.jpg" 2>/dev/null | grep -q "artist.jpg" && return
    local display_name
    display_name=$(normalize_for_lastfm "$artist")
    local encoded
    encoded=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$display_name" 2>/dev/null)
    local resp img
    resp=$(curl -sf "http://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encoded}&api_key=${LASTFM_API_KEY}&format=json")
    img=$(echo "$resp" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    imgs=d['artist']['image']
    for i in reversed(imgs):
        u=i.get('#text','')
        if u and 'placeholder' not in u: print(u); break
except: pass
" 2>/dev/null)
    if [ -n "$img" ]; then
        local tmp; tmp=$(mktemp /tmp/artist_XXXX.jpg)
        curl -sf -o "$tmp" "$img" && upload_image "$tmp" "$b2_artist_dir/artist.jpg" || rm -f "$tmp"
    else
        log "  No artist art found for: $display_name"
    fi
}

fetch_album_art() {
    local artist="$1" album="$2" b2_album_dir="$3"
    rclone lsf "$b2_album_dir/cover.jpg" 2>/dev/null | grep -q "cover.jpg" && return
    local display_name
    display_name=$(normalize_for_lastfm "$artist")
    local enc_artist enc_album
    enc_artist=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$display_name" 2>/dev/null)
    enc_album=$(python3  -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$album" 2>/dev/null)
    local resp img
    resp=$(curl -sf "http://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${enc_artist}&album=${enc_album}&api_key=${LASTFM_API_KEY}&format=json")
    img=$(echo "$resp" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    imgs=d['album']['image']
    for i in reversed(imgs):
        u=i.get('#text','')
        if u and 'placeholder' not in u: print(u); break
except: pass
" 2>/dev/null)
    if [ -n "$img" ]; then
        local tmp; tmp=$(mktemp /tmp/cover_XXXX.jpg)
        curl -sf -o "$tmp" "$img" && upload_image "$tmp" "$b2_album_dir/cover.jpg" || rm -f "$tmp"
    else
        log "  No album art found for: $display_name - $album"
    fi
}

process_torrent() {
    local torrent_name="$1"
    local has_audio
    has_audio=$(rclone lsf "$SEEDBOX/$torrent_name" --recursive 2>/dev/null \
        | grep -iE '\.(flac|mp3|aac|ogg|wav|m4a|opus|wma)$' | head -1)
    if [ -z "$has_audio" ]; then
        log "Skipping (no audio): $torrent_name"
        return
    fi
    parse_name "$torrent_name"
    log "Processing: $torrent_name"
    log "  Artist: $ARTIST  |  Album: $ALBUM_FOLDER"
    local src="$SEEDBOX/$torrent_name"
    local dst="$MUSIC/$ARTIST/$ALBUM_FOLDER"
    rclone copy "$src" "$dst" \
        --transfers=4 \
        --include "*.flac" --include "*.mp3" --include "*.aac" \
        --include "*.ogg"  --include "*.wav" --include "*.m4a" \
        --include "*.opus" --include "*.wma" \
        --include "*.cue"  --include "*.log" --include "*.m3u" \
        --include "*.m3u8" --include "*.nfo" --include "*.jpg" \
        --include "*.jpeg" --include "*.png" --include "*.webp" \
        --log-file="$LOG" 2>/dev/null
    log "  Copied to: $dst"
    fetch_artist_art "$ARTIST" "$MUSIC/$ARTIST"
    fetch_album_art  "$ARTIST" "$ALBUM" "$dst"
    log "  Done: $torrent_name"
}

if [ -n "$1" ]; then
    process_torrent "$1"
else
    log "=== Full seedbox scan ==="
    rclone lsf "$SEEDBOX" --dirs-only 2>/dev/null | sed 's|/$||' | while read -r dir; do
        process_torrent "$dir"
    done
    log "=== Scan complete ==="
fi
