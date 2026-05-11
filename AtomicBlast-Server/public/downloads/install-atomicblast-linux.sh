#!/usr/bin/env sh
set -eu

APP_NAME="AtomicBlast"
APP_URL="https://blast.atomicradius.app"
DESKTOP_DIR="${XDG_DATA_HOME:-"$HOME/.local/share"}/applications"
DESKTOP_FILE="$DESKTOP_DIR/atomicblast.desktop"

find_browser() {
  for browser in google-chrome-stable google-chrome chromium chromium-browser brave-browser microsoft-edge microsoft-edge-stable; do
    if command -v "$browser" >/dev/null 2>&1; then
      printf '%s\n' "$browser"
      return 0
    fi
  done
  return 1
}

BROWSER="$(find_browser || true)"

if [ -z "$BROWSER" ]; then
  printf '%s\n' "No Chromium-based browser was found."
  printf '%s\n' "Install Chrome, Chromium, Brave, or Edge, then open $APP_URL and choose Install page as app or Create shortcut."
  exit 1
fi

mkdir -p "$DESKTOP_DIR"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=$APP_NAME
Comment=Open AtomicBlast as a desktop app
Exec=$BROWSER --app=$APP_URL
Terminal=false
Type=Application
Categories=Audio;Music;Player;
StartupNotify=true
EOF

chmod +x "$DESKTOP_FILE"

printf '%s\n' "AtomicBlast launcher created: $DESKTOP_FILE"
printf '%s\n' "Open it from your app menu. On Linux Mint, it may appear after logging out and back in."
