# AtomicBlast — Claude Notes

Running notes for Claude Code sessions. Covers architecture, known gotchas, and
lessons learned the hard way so we don't repeat them.

---

## Project Map

| Folder | What it is |
|---|---|
| `AtomicBlast-Win/` | Electron desktop app (Windows). Source of truth for `index.html` / UI. |
| `AtomicBlast-Win/web-deploy/` | **AtomicBlast-Server** — Node.js server + deploy script. Web/iPhone PWA. |
| `AtomicBlast-Win/web-deploy/public/` | Static files served to the browser (ipc-shim.js, mobile.css, manifest.json) |
| `AtomicBlast-Android/` | Android app (Kotlin) |
| `AtomicBlast-Extension/` | Browser extension |

**Live server:** `root@23.95.216.131` (alias: `racknerd-atomicblast`) port **3000**
**SSH key:** `~/.ssh/atomicblast_id` — configured in `~/.ssh/config` as `racknerd-atomicblast`. Always use the alias, never the bare IP, so key auth works without a password prompt.

**PM2 process:** `pulse-proxy` → `/opt/pulse-proxy/server.js`

---

## AtomicBlast-Server (web-deploy)

The Win Electron app is adapted as a hosted web PWA by the deploy script at
`AtomicBlast-Win/web-deploy/deploy.ps1`. Run it from PowerShell on your local machine:

```powershell
pwsh -File "C:\Users\adamm\AndroidStudioProjects\AtomicBlast-Android\AtomicBlast-Win\web-deploy\deploy.ps1"
```

### What deploy.ps1 does

1. Reads the Win app's `index.html`
2. Patches it for web:
   - Injects viewport / PWA meta tags + `ipc-shim.js` script right after `<title>`
   - Injects `<link rel="stylesheet" href="/mobile.css">` just before `</head>` (**must be last — see iOS CSS gotcha below**)
   - Replaces `require('electron')` with a comment
   - Appends a `<script>` block before `</body>` that overrides `b2CoverUrl` and `b2TrackObj` to proxy through the server (CORS fix for Safari)
3. SCPs all files to the server
4. Restarts PM2

### B2 config

```
Bucket : SpAtomify
Prefix : Music/
```

### Music structure rule

Album companion files should live with the album tracks, not at the artist root.

Current rule:
- audio plus album sidecars like `.cue`, `.log`, `.m3u`, `.m3u8`, album `.nfo`,
  and album artwork should be copied into the same album folder during ingest
- if old bad B2 paths exist like `Artist/Album.cue/Album.cue` or root-level
  album `.cue` / `.log` entries, the normalizer should fold them into the
  canonical album folder and remove the misplaced companion object afterward

If the music ever moves again, update these two lines in `server.js`:
```js
const B2_BUCKET     = process.env.B2_BUCKET  || 'SpAtomify';
const B2_PREFIX     = process.env.B2_PREFIX  || 'Music/';
```
Also update `B2_BUCKET_URL` on the line above to match the new bucket name.

### API endpoints

| Endpoint | What it does |
|---|---|
| `GET /api/scan-b2-music` | Returns full artist/album/track library (1hr cache) |
| `POST /api/scan-b2-music/refresh` | Force clears cache and rescans |
| `GET /stream?file=PATH&quality=flac` | Proxies B2 audio (CORS fix) |
| `GET /img?file=PATH` | Proxies B2 cover art images (CORS fix) |
| `GET /api/b2-file-text?filePath=PATH` | Fetches CUE sheet text from B2 |
| `GET/POST /api/playlists` | Read/write playlists.json on server |
| `GET/POST/DELETE /favorites` | Liked tracks (favorites.json) |

---

## ⚠️ iOS Web App Gotchas

**Read this before touching mobile layout or doing another iOS web deploy.**

### 0. Screenshot source for app debugging

When the user says there is a screenshot uploaded for the iPhone/web app,
**prefer the B2 screenshot location first** instead of searching local photos.

Current convention:
- Screenshot location: `crowbox` in B2
- Do **not** guess from similarly numbered local `IMG_####` files
- If the exact object key is unclear, ask for the exact B2 filename/prefix rather
  than opening local personal photos
- This project-specific rule is also mirrored in the global Codex note at
  `C:\Users\adamm\.codex\memories\global-debugging-notes.md`

### 1. mobile.css MUST be the last stylesheet in `<head>`

The Win app's `index.html` has all CSS in an inline `<style>` block.
`mobile.css` is an external stylesheet. **CSS cascade: when two rules have the
same specificity, the one that appears later in the document wins.**

If `<link rel="stylesheet" href="/mobile.css">` appears **before** the `<style>`
block, the inline styles silently clobber all your mobile overrides — no errors,
everything just looks wrong and you'll spend an hour wondering why.

**Rule:** Always inject `mobile.css` just before `</head>`, never at the top of `<head>`.

The deploy script does this correctly now:
```powershell
# meta tags / scripts → injected after <title> (fine to be early)
$html = $html -replace '(<title>AtomicBlast</title>)', "`$1`n$headTop"

# mobile.css → injected LAST, just before </head>
$html = $html -replace '</head>', "  <link rel=`"stylesheet`" href=`"/mobile.css`">`n</head>"
```

### 2. `env(safe-area-inset-top)` only works with `viewport-fit=cover`

The Dynamic Island / notch on iPhone sits in the "safe area". Without
`viewport-fit=cover` in the viewport meta, the browser constrains the viewport
for you and `env(safe-area-inset-top)` returns `0` — your padding does nothing.

We set it in the deploy script:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

With `viewport-fit=cover`, content draws edge-to-edge and you're responsible for
padding the notch area yourself. The `.topnav` rule in `mobile.css` handles this:
```css
.topnav {
  padding-top: max(env(safe-area-inset-top), 0px) !important;
  height: auto !important;
  min-height: calc(60px + env(safe-area-inset-top)) !important;
}
```

The `!important` flags are required because of gotcha #1 (inline styles override
without them even if the file order is correct, as a belt-and-suspenders measure).

### 3. Safari blocks direct B2 download URLs (CORS)

Safari enforces strict CORS on `<audio src>` and `<img src>`. Backblaze B2
download URLs do not include `Access-Control-Allow-Origin` headers that satisfy
Safari. **Neither Chrome nor Firefox have this problem — Safari only.**

**Fix:** Route all audio and images through the Node.js proxy:
- Audio  → `GET /stream?file=PATH&quality=flac`
- Images → `GET /img?file=PATH`

This is done by overriding `b2CoverUrl()` and `b2TrackObj()` in the web deploy
script (injected as a `<script>` block before `</body>`). Never try to use direct
B2 URLs in the web/iOS version.

### 4. Inline `<style>` blocks override same-specificity external CSS

Corollary to gotcha #1, but worth restating: adding `!important` to critical
mobile overrides is a good practice as defence-in-depth, especially for layout
properties that the inline `<style>` block explicitly sets (like `height: 60px`
on `.topnav`). If the load order ever gets messed up again, `!important` saves you.

### 5. `body { height: 100vh; overflow: hidden; }` causes iPhone scroll issues

The Win app locks the body to 100vh and handles scrolling in sub-panels. This
works fine on desktop but on iPhone `100vh` can include the browser chrome height,
causing layout to be taller than the visible area. If content gets clipped at the
bottom, check whether the player bar's `bottom: 0` + `env(safe-area-inset-bottom)`
is being applied correctly.

### 6. Mobile sidebar can look open but still close on every tap

Symptom:
- Tap hamburger
- Drawer appears dimmed/greyed as expected
- Any tap inside the visible sidebar closes it and drops back to the music view

What fixed it:
- The drawer backdrop must **not cover the drawer area itself**
- In `mobile.css`, the active overlay should start to the right of the drawer:

```css
#sidebar-overlay.active {
  display: block;
  pointer-events: auto;
  left: min(80vw, 300px);
}
```

Why:
- On iPhone, even when the drawer is visually above the content, taps can still
  effectively hit the backdrop/close layer if the overlay spans the full screen
  behind the visible panel
- Restricting the overlay to the area right of the drawer is more reliable than
  relying on stopPropagation alone

Extra hardening that also helps:
- Toggle `body.sidebar-open` alongside the panel state
- Disable pointer events on the main content while the sidebar is open
- Re-bind sidebar event guards after `renderMusic()` because the panel DOM is rebuilt

### 7. Live web fixes may be deployed directly, not via the normal web-deploy flow

Normal source of truth for the hosted web PWA is still:
- `AtomicBlast-Win/index.html`
- `AtomicBlast-Win/web-deploy/`

But during live iPhone debugging, fixes may be applied directly to:
- `AtomicBlast-Web/public/index.html`
- `AtomicBlast-Web/public/mobile.css`

and then SCP'd straight to:
- `/opt/pulse-proxy/public/index.html`
- `/opt/pulse-proxy/public/mobile.css`

If the user says "you didn't deploy" or the phone behavior doesn't match the local
edit, verify the server copies directly before assuming the change is live.

---

## Node.js v10 Compatibility (server.js)

The server runs Node **10**. Several modern JS features are unavailable:

| Don't use | Use instead |
|---|---|
| `obj?.prop` (optional chaining) | `obj && obj.prop` |
| `obj ?? fallback` (nullish coalescing) | `obj !== null && obj !== undefined ? obj : fallback` |
| `str.matchAll(regex)` | `while loop + regex.exec(str)` |
| `Array.flat()` | `.reduce((a, b) => a.concat(b), [])` |
| `Object.fromEntries()` | manual loop |

---

## Deploy Automation

A Claude Code PostToolUse hook is configured in
`.claude/settings.local.json` (project root). Any time Claude edits a file
inside `web-deploy/`, the deploy script runs automatically.

The hook uses the `racknerd-atomicblast` SSH alias for passwordless deploys.
If you're running deploys manually make sure to use the alias too, not the bare IP.
