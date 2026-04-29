#!/bin/bash
# Music library cleanup: fix top-level folder mess, merge duplicates
# Usage: ./music-cleanup.sh [--dry-run]
MUSIC="crowbox:SpAtomify/Music"
DRY=${1:-}
log() { echo "[$(date '+%H:%M:%S')] $*"; }
move() {
    local src="$1" dst="$2"
    if [ -n "$DRY" ]; then
        echo "  MOVE: $src"
        echo "     -> $dst"
    else
        log "Moving: $src -> $dst"
        rclone move "$MUSIC/$src" "$MUSIC/$dst" --transfers=4 2>/dev/null \
            && log "  OK" || log "  WARN: move may have partially failed"
    fi
}

echo "=== Music Library Cleanup ==="
[ -n "$DRY" ] && echo "=== DRY RUN ===" || echo "=== LIVE RUN ==="
echo ""

# ── Phase 1: Move misnamed top-level folders to correct artist/album ──────────
echo "--- Phase 1: Fix album-as-artist top-level folders ---"

# Beatles content scattered at top level
move "Revolver" "The Beatles/Revolver"
move "[1966] Revolver (1966 Parlophone PCS 7009 Original UK Tube Cut Stereo Pressing) [24-96]" "The Beatles/Revolver (Parlophone 24-96)"
move "The Beatles ‎– The Beatles (1968) {2496} [Apple Records SWBO 101]" "The Beatles/The Beatles"

# Misidentified albums (artist name was used as folder name)
move "Dookie/1994 - Dookie" "Green Day/Dookie"
move "Dookie/artist.jpg" "Green Day/artist.jpg"
move "Stations of the Crass/Stations of the Crass" "Crass/Stations of the Crass"
move "Fat Music Vol. II/1996 - Survival Of The Fattest" "Various Artists/Survival Of The Fattest"

# Billy Idol album at top level
move "[1982] Billy Idol (1984 Chrysalis VK-41377)" "Billy Idol/Billy Idol"

# Waylon Jennings year-dot folders
move "1984. Waylon Jennings/1984 - Never Could Toe The Mark" "Waylon Jennings/Never Could Toe The Mark"
move "1985. Waylon Jennings/1985 - Turn The Page" "Waylon Jennings/Turn The Page"

# Artist - Album folders that ended up at root level
move "AFI -1997- Shut Your Mouth And Open Your Eyes [FLAC]" "AFI/Shut Your Mouth And Open Your Eyes"
move "AFI -1999- Black Sails In The Sunset [FLAC]" "AFI/Black Sails In The Sunset"
move "Alkaline Trio - 2000 - Maybe I'll Catch Fire [FLAC]" "Alkaline Trio/Maybe I'll Catch Fire"
move "Ice Cube - 1990 - AmeriKKKa'S Most Wanted (FLAC)" "Ice Cube/AmeriKKKa'S Most Wanted"
move "Ol' Dirty Bastard - Nigga Please (1999) [FLAC]" "Ol' Dirty Bastard/Nigga Please"
move "Steve Martin & Steep Canyon Rangers - \"The Long-Awaited Album\" (2017) [24-48]" "Steve Martin & Steep Canyon Rangers/The Long-Awaited Album"
move "Anti‐Flag _ Obnoxious - 1996 - I'd Rather Be in Japan _ Fuck You Fucking All [FLAC]" "Anti-Flag/I'd Rather Be in Japan - Fuck You Fucking All"
move "VA -1999- Go Simpsonic With the Simpsons {8122-75480-2} [FLAC]" "The Simpsons/Go Simpsonic With the Simpsons"

# NOFX: standalone album folders → into NOFX/ (files may already exist; rclone skips dupes)
move "NOFX - Ribbed [FLAC]" "NOFX/Ribbed"
move "NOFX - Cokie The Clown (FLAC)" "NOFX/Cokie The Clown"
move "NOFX - Double Album (2022) [24Bit-48kHz] FLAC [PMEDIA] ⭐️" "NOFX/Double Album"
move "NOFX - First Ditch Effort (2016) [FLAC]" "NOFX/First Ditch Effort"
move "NOFX - Pump Up The Valuum [FLAC 24-48]-SPI7F1RE" "NOFX/Pump Up The Valuum"
move "NOFX - Ribbed [FLAC]" "NOFX/Ribbed"
move "NOFX - Self-Entitled (2012) [FLAC]" "NOFX/Self-Entitled"
move "NOFX - Stoke Extinguisher [2013] [EP] [FLAC]" "NOFX/Stoke Extinguisher"
move "Nofx - A to H (2025 Punk-New wave) [Flac 24-48]" "NOFX/A to H"
move "NoFX Lossless [torrents.ru]" "NOFX/_lossless-collection"

# Aquabats: extra standalone folders
move "The Aquabats! . 2011 . Hi-Five Soup!" "The Aquabats!/Hi-Five Soup!"
move "The Aquabats! . 2011 . Hi-Five Soup! {WEB,Fearless,Deezer}" "The Aquabats!/Hi-Five Soup! (Deezer)"

echo ""
echo "--- Phase 2: Merge duplicate artist folders ---"

# Aquabats: merge all into "The Aquabats!"
move "Aquabats, The" "The Aquabats!"
move "The Aquabats" "The Aquabats!"

# RATM: merge lowercase → canonical
move "Rage Against The Machine" "Rage Against the Machine"

# Blair Crimmins: merge capitalization variant
move "Blair Crimmins & The Hookers" "Blair Crimmins & the Hookers"

# Vandals
move "Vandals" "The Vandals"

# Queers
move "Queers, The" "The Queers"

echo ""
echo "--- Phase 3: Strip year prefix from all album subfolders ---"
# Iterate every artist folder, find album dirs starting with YYYY - , rename to strip year
rclone lsf "$MUSIC" --dirs-only 2>/dev/null | sed 's|/$||' | while read -r artist; do
    rclone lsf "$MUSIC/$artist" --dirs-only 2>/dev/null | sed 's|/$||' | grep -P '^\d{4} - ' | while read -r album; do
        clean=$(echo "$album" | sed -E 's/^[0-9]{4} - //')
        if [ "$album" != "$clean" ]; then
            if [ -n "$DRY" ]; then
                echo "  RENAME: $artist/$album"
                echo "       -> $artist/$clean"
            else
                log "Renaming: $artist/$album -> $clean"
                rclone move "$MUSIC/$artist/$album" "$MUSIC/$artist/$clean" --transfers=4 2>/dev/null \
                    && log "  OK" || log "  WARN: $artist/$album"
            fi
        fi
    done
done

echo ""
echo "=== Done ==="
