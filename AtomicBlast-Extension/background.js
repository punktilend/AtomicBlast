'use strict'

// ── B2 Config (from AtomicBlast Android local.properties) ─────────────────────
const B2_KEY_ID  = '0055a9c537f296d0000000014'
const B2_APP_KEY = 'K005XUecoGa52VpCS6Hb2qx45iGZ/jc'
const B2_BUCKET  = 'SpAtomify'
const B2_PREFIX  = 'Music/'
const PROXY_URL  = 'http://23.95.216.131:3000'

const AUDIO_EXTS   = new Set(['mp3','flac','aac','ogg','wav','m4a','opus','wma'])
const ART_FOLDERS  = new Set(['artwork','scans','covers','images','art','booklet','extras'])

// ── Auth state ────────────────────────────────────────────────────────────────
// auth = { authToken, apiUrl, downloadUrl, accountId, bucketId, dlToken }
let auth = null

// ── Player ────────────────────────────────────────────────────────────────────
const player   = new Audio()
player.preload = 'auto'

let queue    = []      // Array<TrackObj>
let queueIdx = -1
let shuffle  = false
let quality  = 'flac'  // 'flac' | 'high' | 'medium' | 'low'
let status   = 'idle'  // 'idle' | 'loading' | 'playing' | 'paused' | 'error'
let errMsg   = null

// TrackObj: { title, artist, album, format, filePath, streamUrl, coverUrl,
//             cueStartMs?, cueEndMs?, _needsUrl? }
// cueStartMs/cueEndMs: chapter boundaries in ms for CUE sheet tracks.
// cueEndMs omitted on the last chapter (plays to audio file end).

// Guard flag: prevents double-advance when timeupdate AND ended both fire
// at a CUE chapter boundary.
let cueAdvancing = false

// ── Player event wiring ───────────────────────────────────────────────────────
player.addEventListener('play',    () => { status = 'playing'; broadcast() })
player.addEventListener('pause',   () => { status = 'paused';  broadcast() })
player.addEventListener('waiting', () => { status = 'loading'; broadcast() })
player.addEventListener('playing', () => { status = 'playing'; broadcast() })
player.addEventListener('ended',   () => {
  if (!cueAdvancing) advanceQueue()
  cueAdvancing = false
})
player.addEventListener('error',   () => {
  errMsg = player.error ? player.error.message : 'Playback error'
  status = 'error'
  broadcast()
})

// CUE chapter end detection: advance queue when currentTime reaches cueEndMs.
player.addEventListener('timeupdate', () => {
  const track = queueIdx >= 0 ? queue[queueIdx] : null
  if (track && track.cueEndMs != null && !cueAdvancing) {
    if (player.currentTime >= track.cueEndMs / 1000 - 0.15) {
      cueAdvancing = true
      advanceQueue()
    }
  }
})

// ── Playback helpers ──────────────────────────────────────────────────────────
function getTrackUrl(track) {
  if (quality === 'flac' || !track.filePath) {
    return track.streamUrl || buildStreamUrl(track.filePath)
  }
  const encoded = track.filePath.split('/').map(encodeURIComponent).join('/')
  return `${PROXY_URL}/stream?file=${encoded}&quality=${quality}`
}

function buildStreamUrl(filePath) {
  if (!auth || !filePath) return ''
  const encoded = filePath.split('/').map(encodeURIComponent).join('/')
  return `${auth.downloadUrl}/file/${B2_BUCKET}/${encoded}?Authorization=${encodeURIComponent(auth.dlToken)}`
}

function buildCoverUrl(filePath) {
  if (!auth || !filePath) return null
  const folder = filePath.split('/').slice(0, -1).join('/')
  return buildStreamUrl(folder + '/cover.jpg')
}

function resolveTrack(track) {
  // Fill in streamUrl / coverUrl if missing (needs auth to be available)
  if (track._needsUrl && auth) {
    track.streamUrl = buildStreamUrl(track.filePath)
    track.coverUrl  = buildCoverUrl(track.filePath)
    delete track._needsUrl
  }
  return track
}

function playAt(idx) {
  if (idx < 0 || idx >= queue.length) return
  cueAdvancing = false   // reset chapter-end guard for the new chapter
  queueIdx = idx
  const track = resolveTrack(queue[idx])
  errMsg  = null
  status  = 'loading'
  broadcast()

  const url = getTrackUrl(track)

  if (track.cueStartMs != null) {
    // CUE chapter: seek to the chapter start position.
    // If we're already playing the same audio file (adjacent chapters), skip
    // re-loading the src — just seek to avoid rebuffering.
    const startSec = track.cueStartMs / 1000
    if (player.src === url && player.readyState >= 2) {
      player.currentTime = startSec
      if (player.paused) {
        player.play().catch(e => { errMsg = e.message || 'Playback failed'; status = 'error'; broadcast() })
      }
    } else {
      player.src = url
      player.addEventListener('canplay', () => {
        player.currentTime = startSec
        player.play().catch(e => { errMsg = e.message || 'Playback failed'; status = 'error'; broadcast() })
      }, { once: true })
    }
  } else {
    // Normal (non-CUE) track
    player.src = url
    player.play().catch(e => {
      errMsg = e.message || 'Playback failed'
      status = 'error'
      broadcast()
    })
  }
  broadcast()
}

function advanceQueue() {
  if (!queue.length) return
  const next = shuffle
    ? Math.floor(Math.random() * queue.length)
    : (queueIdx + 1) % queue.length
  playAt(next)
}

// ── CUE sheet parsing ─────────────────────────────────────────────────────────
// Parses a CUE sheet string into { audioFileName, albumTitle, albumPerformer, chapters }.
// Each chapter: { number, title, performer, startMs }.
// Returns null if the sheet is malformed or has no tracks.

function parseCueTime(time) {
  const parts = time.split(':').map(Number)
  const mm = parts[0] || 0
  const ss = parts[1] || 0
  const ff = parts[2] || 0
  return mm * 60000 + ss * 1000 + Math.round(ff * 1000 / 75)
}

function parseCue(text) {
  text = text.replace(/^\uFEFF/, '')  // strip BOM

  let audioFileName  = null
  let albumTitle     = ''
  let albumPerformer = null
  const chapters     = []
  let fileCount      = 0

  let trackNum       = -1
  let trackTitle     = null
  let trackPerformer = null
  let trackStartMs   = -1

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (/^FILE /i.test(line)) {
      fileCount++
      const after = line.slice(5).trim()
      audioFileName = after.startsWith('"')
        ? after.slice(1, after.lastIndexOf('"'))
        : after.split(' ').slice(0, -1).join(' ')  // strip trailing type token

    } else if (/^TRACK /i.test(line)) {
      if (trackNum >= 0 && trackStartMs >= 0) {
        chapters.push({ number: trackNum, title: trackTitle || `Track ${trackNum}`, performer: trackPerformer, startMs: trackStartMs })
      }
      trackNum       = parseInt(line.slice(6).trim().split(/\s+/)[0], 10) || -1
      trackTitle     = null
      trackPerformer = null
      trackStartMs   = -1

    } else if (/^TITLE /i.test(line)) {
      const t = line.slice(6).trim().replace(/^"|"$/g, '')
      if (trackNum < 0) albumTitle = t; else trackTitle = t

    } else if (/^PERFORMER /i.test(line)) {
      const p = line.slice(10).trim().replace(/^"|"$/g, '')
      if (trackNum < 0) albumPerformer = p; else trackPerformer = p

    } else if (/^INDEX 01 /i.test(line)) {
      trackStartMs = parseCueTime(line.slice(9).trim())
    }
  }

  // Flush last track
  if (trackNum >= 0 && trackStartMs >= 0) {
    chapters.push({ number: trackNum, title: trackTitle || `Track ${trackNum}`, performer: trackPerformer, startMs: trackStartMs })
  }

  if (!audioFileName || !chapters.length || fileCount > 1) return null
  return { audioFileName, albumTitle, albumPerformer, chapters }
}

// ── B2 API ────────────────────────────────────────────────────────────────────
async function ensureAuth() {
  if (!auth) await b2Authorize()
}

async function b2Authorize() {
  const creds = btoa(B2_KEY_ID + ':' + B2_APP_KEY)

  // 1. Authorise account
  const authRes  = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: 'Basic ' + creds },
  })
  const authData = await authRes.json()
  if (authData.status) throw new Error('B2 auth: ' + authData.message)
  const { authorizationToken: authToken, apiUrl, downloadUrl, accountId } = authData

  // 2. Resolve bucket ID
  const buckRes  = await fetch(`${apiUrl}/b2api/v2/b2_list_buckets`, {
    method: 'POST',
    headers: { Authorization: authToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, bucketName: B2_BUCKET }),
  })
  const buckData = await buckRes.json()
  if (buckData.status) throw new Error('B2 bucket: ' + buckData.message)
  const bucketId = buckData.buckets?.[0]?.bucketId
  if (!bucketId) throw new Error(`Bucket "${B2_BUCKET}" not found`)

  // 3. Get 24-hour download auth token (non-fatal fallback)
  let dlToken = authToken
  try {
    const dlRes  = await fetch(`${apiUrl}/b2api/v2/b2_get_download_authorization`, {
      method: 'POST',
      headers: { Authorization: authToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketId, fileNamePrefix: '', validDurationInSeconds: 86400 }),
    })
    const dlData = await dlRes.json()
    if (!dlData.status) dlToken = dlData.authorizationToken
  } catch (_) { /* fall back to authToken */ }

  auth = { authToken, apiUrl, downloadUrl, accountId, bucketId, dlToken }
}

async function b2ListFiles(prefix, useDelimiter = true) {
  await ensureAuth()
  const files = []
  let startFileName = null
  do {
    const body = { bucketId: auth.bucketId, prefix, maxFileCount: 1000 }
    if (useDelimiter) body.delimiter = '/'
    if (startFileName) body.startFileName = startFileName

    const res  = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: 'POST',
      headers: { Authorization: auth.authToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.status) throw new Error('B2 list: ' + data.message)
    // Normalize: B2 returns `fileName` but popup expects `name`
    for (const f of (data.files || [])) {
      files.push({ name: f.fileName, contentLength: f.contentLength || 0 })
    }
    startFileName = data.nextFileName || null
  } while (startFileName)
  return files
}

/** Fetch a text file from B2 (e.g. a CUE sheet). */
async function fetchFileText(filePath) {
  await ensureAuth()
  const url = buildStreamUrl(filePath)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  return res.text()
}

// ── Favorites API ─────────────────────────────────────────────────────────────
const PROXY = 'http://23.95.216.131:3000'

async function getFavorites() {
  const res = await fetch(`${PROXY}/favorites`)
  if (!res.ok) throw new Error('favorites fetch failed')
  return res.json()
}

async function addFavorite(track) {
  const res = await fetch(`${PROXY}/favorites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath: track.filePath, title: track.title, artist: track.artist, album: track.album, format: track.format }),
  })
  return res.json()
}

async function removeFavorite(filePath) {
  const res = await fetch(`${PROXY}/favorites`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  })
  return res.json()
}

// ── State broadcast ───────────────────────────────────────────────────────────
function getState() {
  const track = (queueIdx >= 0 && queue[queueIdx]) ? queue[queueIdx] : null
  const isCue = track && track.cueStartMs != null

  let position = player.currentTime || 0
  let duration = (player.duration && isFinite(player.duration)) ? player.duration : 0

  if (isCue) {
    // Report position and duration relative to the chapter, not the whole file.
    const startSec = track.cueStartMs / 1000
    const endSec   = track.cueEndMs != null ? track.cueEndMs / 1000 : duration
    position = Math.max(0, player.currentTime - startSec)
    duration = endSec - startSec
  }

  return {
    type:     'state',
    status,
    errMsg,
    authed:   !!auth,
    shuffle,
    quality,
    queueIdx,
    queueLen: queue.length,
    track: track ? {
      title:    track.title    || '',
      artist:   track.artist   || '',
      album:    track.album    || '',
      format:   track.format   || '',
      coverUrl: track.coverUrl || null,
    } : null,
    position,
    duration,
  }
}

function broadcast() {
  browser.runtime.sendMessage(getState()).catch(() => {})
}

// ── Message handler ───────────────────────────────────────────────────────────
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.cmd) {

    case 'getState':
      sendResponse(getState())
      return true

    case 'play':
      if (!player.src && queue[queueIdx]) {
        playAt(queueIdx)
      } else if (player.paused) {
        player.play().catch(() => {})
      }
      break

    case 'pause':
      player.pause()
      break

    case 'stop':
      player.pause()
      player.currentTime = 0
      player.src = ''
      queue        = []
      queueIdx     = -1
      cueAdvancing = false
      status       = 'idle'
      errMsg       = null
      broadcast()
      break

    case 'next':
      advanceQueue()
      break

    case 'prev': {
      if (!queue.length) break
      const track     = queue[queueIdx]
      const chapterStart = track?.cueStartMs != null ? track.cueStartMs / 1000 : 0
      if (player.currentTime - chapterStart > 3) {
        // Restart the current chapter
        player.currentTime = chapterStart
      } else {
        playAt(Math.max(0, queueIdx - 1))
      }
      break
    }

    case 'shuffle':
      shuffle = !shuffle
      broadcast()
      break

    case 'setQuality': {
      const prevQ = quality
      quality = msg.quality
      if (queue[queueIdx] && player.src && prevQ !== quality) {
        const track    = queue[queueIdx]
        const isCue    = track?.cueStartMs != null
        const startSec = isCue ? track.cueStartMs / 1000 : 0
        // Preserve position relative to chapter start
        const relPos   = player.currentTime - startSec
        const wasPlaying = !player.paused
        player.src = getTrackUrl(track)
        player.addEventListener('canplay', () => {
          player.currentTime = startSec + Math.max(0, relPos)
          if (wasPlaying) player.play().catch(() => {})
        }, { once: true })
      }
      broadcast()
      break
    }

    case 'seek': {
      const track = queue[queueIdx]
      if (track?.cueStartMs != null) {
        // Map seek percentage to within chapter bounds
        const startSec = track.cueStartMs / 1000
        const endSec   = track.cueEndMs != null
          ? track.cueEndMs / 1000
          : (isFinite(player.duration) ? player.duration : startSec)
        player.currentTime = startSec + msg.pct * (endSec - startSec)
      } else if (isFinite(player.duration) && player.duration > 0) {
        player.currentTime = msg.pct * player.duration
      }
      break
    }

    case 'playQueue': {
      queue    = msg.queue
      queueIdx = msg.index || 0
      playAt(queueIdx)
      break
    }

    case 'authorize':
      auth = null  // force re-auth
      b2Authorize()
        .then(() => { broadcast(); sendResponse({ ok: true }) })
        .catch(e  => sendResponse({ ok: false, error: e.message }))
      return true

    case 'listFiles':
      b2ListFiles(msg.prefix, msg.useDelimiter !== false)
        .then(files => sendResponse({ ok: true, files }))
        .catch(e => {
          // Token expired? Re-auth once and retry
          if (e.message?.includes('401') || e.message?.includes('expired')) {
            auth = null
            return b2ListFiles(msg.prefix, msg.useDelimiter !== false)
              .then(files => sendResponse({ ok: true, files }))
              .catch(e2 => sendResponse({ ok: false, error: e2.message }))
          }
          sendResponse({ ok: false, error: e.message })
        })
      return true  // async

    case 'fetchFileText':
      fetchFileText(msg.filePath)
        .then(text => sendResponse({ ok: true, text }))
        .catch(e   => sendResponse({ ok: false, error: e.message }))
      return true  // async

    case 'getStreamUrl':
      if (!auth) { sendResponse({ ok: false, error: 'Not authorized' }); return true }
      sendResponse({ ok: true, url: buildStreamUrl(msg.filePath) })
      return true

    case 'getFavorites':
      getFavorites()
        .then(favs => sendResponse({ ok: true, favorites: favs }))
        .catch(e  => sendResponse({ ok: false, error: e.message }))
      return true

    case 'addFavorite':
      addFavorite(msg.track)
        .then(data => sendResponse({ ok: true, favorites: data.favorites }))
        .catch(e   => sendResponse({ ok: false, error: e.message }))
      return true

    case 'removeFavorite':
      removeFavorite(msg.filePath)
        .then(data => sendResponse({ ok: true, favorites: data.favorites }))
        .catch(e   => sendResponse({ ok: false, error: e.message }))
      return true
  }
})

// ── Startup auth ──────────────────────────────────────────────────────────────
b2Authorize()
  .then(() => broadcast())
  .catch(e => console.warn('[AtomicBlast] Startup auth failed:', e.message))
