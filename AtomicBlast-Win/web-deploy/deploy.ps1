# AtomicBlast Web — deploy to server
# Run from AtomicBlast-Win/web-deploy/
# Usage: pwsh -File deploy.ps1

$server  = "racknerd-atomicblast"   # SSH alias in ~/.ssh/config — uses atomicblast_id key (no password prompt)
$srcDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$winDir  = Split-Path -Parent $srcDir   # AtomicBlast-Win/
$pubDir  = "$srcDir\public"

Write-Host "=== Patching index.html for web ===" -ForegroundColor Cyan

# Read the original Win app index.html
$html = Get-Content "$winDir\index.html" -Raw -Encoding UTF8

# 1a. Add viewport, iOS PWA meta, manifest, and ipc-shim just after <title>
#     (ipc-shim must load before the inline JS in <body>)
$headTop = @'
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="AtomicBlast">
  <meta name="theme-color" content="#080c08">
  <link rel="manifest" href="/manifest.json">
  <link rel="apple-touch-icon" href="/assets/icon-192.png">
  <script src="/ipc-shim.js"></script>
'@
$html = $html -replace '(<title>AtomicBlast</title>)', "`$1`n$headTop"

# 1b. Inject mobile.css LAST in <head> (after the inline <style> block) so it wins the cascade
$html = $html -replace '</head>', "  <link rel=`"stylesheet`" href=`"/mobile.css`">`n</head>"

# 2. Replace the Electron require with a comment (shim loaded above)
$html = $html -replace "const \{ ipcRenderer \} = require\('electron'\)", "// ipcRenderer provided by /ipc-shim.js (web mode)"

# 3. Inject web proxy overrides before </body>
#    - b2CoverUrl: routes cover images through /img proxy (fixes CORS in Safari)
#    - b2TrackObj: routes audio through /stream proxy (fixes CORS in Safari)
$webOverrides = @'

  <script>
  // AtomicBlast-Server: route all B2 audio + images through the local proxy (CORS fix for Safari)
  function b2CoverUrl(filePath, dlUrl, dlToken, bucketName) {
    if (!filePath) return '';
    return '/img?file=' + encodeURIComponent(filePath);
  }
  function b2TrackObj(track, artistName, album, dlUrl, dlToken, bucket) {
    var signedUrl = '/stream?file=' + encodeURIComponent(track.path) + '&quality=flac';
    var coverUrl  = b2CoverUrl(album.coverPath);
    return { id: track.path, title: track.title, artist: artistName, album: album.name,
             path: signedUrl, ext: track.ext, coverPath: coverUrl };
  }
  </script>
'@
$html = $html -replace '</body>', "$webOverrides`n</body>"

# Write patched index.html to public/
$html | Set-Content "$pubDir\index.html" -Encoding UTF8
Write-Host "  -> public/index.html written" -ForegroundColor Green

# Copy Win app assets (svg logo etc)
Copy-Item "$winDir\assets\*" "$pubDir\assets\" -Force
Write-Host "  -> assets copied" -ForegroundColor Green

Write-Host ""
Write-Host "=== Uploading to server ===" -ForegroundColor Cyan

# Upload updated server.js
scp "$srcDir\server.js" "${server}:/opt/pulse-proxy/server.js"
Write-Host "  -> server.js uploaded" -ForegroundColor Green

# Upload public/ directory (static web app)
ssh $server "mkdir -p /opt/pulse-proxy/public/assets"
scp "$pubDir\index.html"    "${server}:/opt/pulse-proxy/public/index.html"
scp "$pubDir\ipc-shim.js"   "${server}:/opt/pulse-proxy/public/ipc-shim.js"
scp "$pubDir\mobile.css"    "${server}:/opt/pulse-proxy/public/mobile.css"
scp "$pubDir\manifest.json" "${server}:/opt/pulse-proxy/public/manifest.json"
scp "$winDir\assets\pulse-logo.svg" "${server}:/opt/pulse-proxy/public/assets/pulse-logo.svg"
scp "$pubDir\assets\icon-192.png"  "${server}:/opt/pulse-proxy/public/assets/icon-192.png"
scp "$pubDir\assets\icon-512.png"  "${server}:/opt/pulse-proxy/public/assets/icon-512.png"
Write-Host "  -> public/ uploaded" -ForegroundColor Green

Write-Host ""
Write-Host "=== Opening port 3000 & restarting proxy ===" -ForegroundColor Cyan
ssh $server "ufw allow 3000/tcp && cd /opt/pulse-proxy && set -a && . ./.env && set +a && pm2 restart pulse-proxy --update-env && pm2 save"

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Green
Write-Host "Open http://23.95.216.131:3000 in Safari on your iPhone" -ForegroundColor Yellow
Write-Host "Then: Share -> Add to Home Screen for the PWA install" -ForegroundColor Yellow
