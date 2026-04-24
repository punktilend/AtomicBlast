const { app, BrowserWindow, ipcMain, shell, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const { spawn } = require('child_process')
const mm = require('music-metadata')

// ============================================
// CONFIGURATION
// ============================================
const configFilePath = path.join(__dirname, 'config.json')

function loadUserConfig() {
  try {
    if (fs.existsSync(configFilePath)) return JSON.parse(fs.readFileSync(configFilePath, 'utf8'))
  } catch (e) { console.error('Error loading config.json:', e) }
  return {}
}

function saveUserConfig(config) {
  try { fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8'); return true }
  catch (e) { console.error('Error saving config.json:', e); return false }
}

const userConfig = loadUserConfig()

const B2_SOURCE = {
  id:        'b2-spatomify',
  name:      'SpAtomify',
  provider:  'b2',
  b2KeyId:   '0055a9c537f296d0000000014',
  b2AppKey:  'K005XUecoGa52VpCS6Hb2qx45iGZ/jc',
  b2Bucket:  'SpAtomify',
  b2Prefix:  'Music/',
}

const CONFIG = {
  musicPaths:   userConfig.musicPaths || [],
  ytdlpPath:    userConfig.ytdlpPath  || 'yt-dlp',
  cloudSources: [B2_SOURCE],
}

// ============================================
// ELECTRON WINDOW
// ============================================
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, fullscreen: true, title: 'AtomicBlast', backgroundColor: '#080c08',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  mainWindow = win
  win.loadFile('index.html')
  win.setMenuBarVisibility(false)
  startApiServer()
  const mediaKeys = {
    MediaPlayPause: 'playpause', MediaNextTrack: 'next',
    MediaPreviousTrack: 'prev', MediaStop: 'stop'
  }
  Object.entries(mediaKeys).forEach(([key, cmd]) => {
    try { globalShortcut.register(key, () => win.webContents.send('media-key', cmd)) } catch (e) {}
  })
  win.on('closed', () => globalShortcut.unregisterAll())
}

// ============================================
// IPC — CORE
// ============================================
ipcMain.handle('get-config', () => CONFIG)
ipcMain.handle('open-folder', (_, folderPath) => { shell.openPath(folderPath); return { success: true } })
ipcMain.handle('open-url',    (_, url)        => { shell.openExternal(url);    return { success: true } })
ipcMain.handle('toggle-fullscreen', () => {
  const w = BrowserWindow.getFocusedWindow(); if (w) w.setFullScreen(!w.isFullScreen())
})
ipcMain.handle('quit-app', () => app.quit())

ipcMain.handle('save-config', (_, newConfig) => {
  const merged = { ...loadUserConfig(), ...newConfig }
  const saved = saveUserConfig(merged)
  if (saved) {
    if (newConfig.musicPaths !== undefined) CONFIG.musicPaths = newConfig.musicPaths
    if (newConfig.ytdlpPath  !== undefined) CONFIG.ytdlpPath  = newConfig.ytdlpPath
    // cloudSources is always the hard-coded B2_SOURCE — ignore any overwrite
  }
  return { success: saved }
})

// ============================================
// PLAYLISTS
// ============================================
ipcMain.handle('get-playlists', () => {
  const f = path.join(app.getPath('userData'), 'playlists.json')
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) }
  catch { return { liked: [], playlists: [] } }
})
ipcMain.handle('save-playlists', (_, data) => {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'playlists.json'), JSON.stringify(data))
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

// ============================================
// MUSIC LIBRARY
// ============================================
const AUDIO_EXTS = new Set(['.mp3','.flac','.m4a','.wav','.aac','.ogg','.opus','.wma','.ape','.aiff','.alac','.webm'])
const VIDEO_EXTS = new Set(['.mp4','.mkv','.avi','.mov','.m4v','.flv'])
const COVER_NAMES = ['folder.jpg','cover.jpg','album.jpg','artwork.jpg','front.jpg',
                     'folder.png','cover.png','album.png','artwork.png','front.png']

function getMusicUserData() {
  const base = app.getPath('userData')
  const coversDir = path.join(base, 'music-covers')
  const cacheFile = path.join(base, 'music-cache.json')
  if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true })
  return { coversDir, cacheFile }
}

async function scanMusicDir(dir, tracks) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await scanMusicDir(full, tracks)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (!AUDIO_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) continue
      const isVideo = VIDEO_EXTS.has(ext)
      let meta = { title: path.basename(entry.name, ext), artist: 'Unknown Artist', album: 'Unknown Album', albumArtist: '', trackNo: 0, year: 0, duration: 0 }
      let coverData = null
      if (!isVideo) {
        try {
          const parsed = await mm.parseFile(full, { duration: true, skipCovers: false })
          const t = parsed.common
          if (t.title)       meta.title       = t.title
          if (t.artist)      meta.artist      = t.artist
          if (t.album)       meta.album       = t.album
          if (t.albumartist) meta.albumArtist = t.albumartist
          if (t.year)        meta.year        = t.year
          if (t.track?.no)   meta.trackNo     = t.track.no
          if (parsed.format?.duration) meta.duration = parsed.format.duration
          if (t.picture?.length) coverData = t.picture[0]
        } catch (e) { /* skip bad files */ }
      }
      if (!meta.albumArtist) meta.albumArtist = meta.artist
      tracks.push({ ...meta, ext, isVideo, path: full, coverData })
    }
  }
}

function buildLibrary(tracks, coversDir) {
  const folderCovers = new Map()
  const artistMap = new Map()
  for (const t of tracks) {
    const dir = path.dirname(t.path)
    if (!folderCovers.has(dir)) {
      const found = COVER_NAMES.map(n => path.join(dir, n)).find(p => fs.existsSync(p))
      folderCovers.set(dir, found ? 'file:///' + found.replace(/\\/g, '/') : null)
    }
    const key = (t.albumArtist || t.artist || 'Unknown Artist').trim()
    if (!artistMap.has(key)) artistMap.set(key, new Map())
    const albums = artistMap.get(key)
    const albumKey = (t.album || 'Unknown Album').trim()
    if (!albums.has(albumKey)) albums.set(albumKey, { name: albumKey, year: t.year, tracks: [], coverPath: null })
    albums.get(albumKey).tracks.push(t)
  }

  const artists = []
  for (const [artistName, albumMap] of [...artistMap.entries()].sort((a,b) => a[0].localeCompare(b[0]))) {
    const albums = []
    for (const [, album] of [...albumMap.entries()].sort((a,b) => (a[1].year||9999) - (b[1].year||9999))) {
      album.tracks.sort((a,b) => (a.trackNo||999) - (b.trackNo||999) || a.path.localeCompare(b.path))
      const dir = path.dirname(album.tracks[0].path)
      let coverPath = folderCovers.get(dir) || null
      if (!coverPath) {
        const firstWithCover = album.tracks.find(t => t.coverData)
        if (firstWithCover?.coverData) {
          const hash = Buffer.from(artistName + album.name).toString('base64').replace(/[/+=]/g,'').slice(0,16)
          const coverFile = path.join(coversDir, hash + '.jpg')
          if (!fs.existsSync(coverFile)) {
            try { fs.writeFileSync(coverFile, firstWithCover.coverData.data) } catch (e) {}
          }
          coverPath = 'file:///' + coverFile.replace(/\\/g, '/')
        }
      }
      album.coverPath = coverPath
      album.tracks = album.tracks.map(({ coverData: _, ...rest }) => rest)
      albums.push(album)
    }
    artists.push({ name: artistName, albums })
  }
  return { artists, allTracks: tracks.map(({ coverData: _, ...rest }) => rest) }
}

let musicScanCache = null

ipcMain.handle('scan-music', async () => {
  const { coversDir, cacheFile } = getMusicUserData()
  if (musicScanCache && JSON.stringify(musicScanCache.paths) === JSON.stringify(CONFIG.musicPaths)) {
    return musicScanCache.library
  }
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    if (JSON.stringify(cached.paths) === JSON.stringify(CONFIG.musicPaths)) {
      musicScanCache = cached; return cached.library
    }
  } catch (e) {}
  if (!CONFIG.musicPaths.length) return { artists: [], allTracks: [] }
  const allTracks = []
  for (const p of CONFIG.musicPaths) { if (fs.existsSync(p)) await scanMusicDir(p, allTracks) }
  const library = buildLibrary(allTracks, coversDir)
  musicScanCache = { paths: [...CONFIG.musicPaths], library }
  try { fs.writeFileSync(cacheFile, JSON.stringify(musicScanCache)) } catch (e) {}
  return library
})

ipcMain.handle('rescan-music', async () => {
  musicScanCache = null
  b2MusicCache = null  // also force fresh B2 scan on next cloud source open
  const { cacheFile, coversDir } = getMusicUserData()
  try { fs.unlinkSync(cacheFile) } catch (e) {}
  if (!CONFIG.musicPaths.length) return { artists: [], allTracks: [] }
  const allTracks = []
  for (const p of CONFIG.musicPaths) { if (fs.existsSync(p)) await scanMusicDir(p, allTracks) }
  const library = buildLibrary(allTracks, coversDir)
  musicScanCache = { paths: [...CONFIG.musicPaths], library }
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'music-cache.json'), JSON.stringify(musicScanCache)) } catch (e) {}
  return library
})

// ============================================
// STREAM RESOLUTION (yt-dlp / radio URLs)
// ============================================
ipcMain.handle('resolve-stream', (_, url) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(CONFIG.ytdlpPath, ['-f', 'bestaudio', '-g', '--no-playlist', url],
                       { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    proc.stdout.on('data', d => { out += d.toString() })
    proc.stderr.on('data', d => { err += d.toString() })
    proc.on('close', code => code === 0 ? resolve(out.trim().split('\n')[0]) : reject(err.trim() || 'yt-dlp failed'))
    proc.on('error', e => reject(e.message))
  })
})

// ============================================
// CLOUD STREAMING
// ============================================
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    require('https').get(url, { headers: { 'User-Agent': 'AtomicBlast/1.0', ...headers } }, res => {
      let d = ''
      res.on('data', c => { d += c })
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(d.slice(0, 300))) } })
    }).on('error', reject)
  })
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const u = new URL(url)
    const req = require('https').request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
                 'User-Agent': 'AtomicBlast/1.0', ...headers }
    }, res => {
      let d = ''
      res.on('data', c => { d += c })
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(d.slice(0, 300))) } })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function getB2BucketId(auth, bucketName) {
  const res = await httpsPost(auth.apiUrl + '/b2api/v2/b2_list_buckets',
    { accountId: auth.accountId, bucketName },
    { Authorization: auth.authorizationToken })
  const bucket = res.buckets?.[0]
  if (!bucket) throw new Error('B2 bucket not found: ' + bucketName)
  return bucket.bucketId
}

function isCloudMediaFile(name) {
  const ext = path.extname(name).toLowerCase()
  return AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)
}

// ── rclone serve http process pool ──────────────────────────────────────────
const rcloneServers = new Map() // sourceId → { process, port }
let nextRclonePort = 49152

async function startRcloneServer(src) {
  if (rcloneServers.has(src.id)) return rcloneServers.get(src.id).port
  const port = nextRclonePort++
  const prefix = (src.rclonePrefix || '').replace(/^\/+/, '').replace(/\/+$/, '')
  const remotePath = src.rcloneRemote + ':' + prefix
  const proc = spawn('rclone', ['serve', 'http', '--addr', '127.0.0.1:' + port, remotePath],
                     { stdio: 'ignore' })
  proc.on('exit', () => rcloneServers.delete(src.id))
  rcloneServers.set(src.id, { process: proc, port })
  // Give rclone a moment to bind the port
  await new Promise(r => setTimeout(r, 1000))
  return port
}

ipcMain.handle('list-cloud-files', async (_, { sourceId, folderPath }) => {
  const src = CONFIG.cloudSources.find(s => s.id === sourceId)
  if (!src) throw new Error('Cloud source not found: ' + sourceId)

  // ── rclone ────────────────────────────────────────────────────────────────
  if (src.provider === 'rclone') {
    const prefix = (src.rclonePrefix || '').replace(/^\/+/, '')
    const base = folderPath != null ? folderPath : prefix
    const remotePath = src.rcloneRemote + ':' + base
    return new Promise((resolve, reject) => {
      const proc = spawn('rclone', ['lsjson', remotePath, '--max-depth', '1'],
                         { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = '', err = ''
      proc.stdout.on('data', d => { out += d })
      proc.stderr.on('data', d => { err += d })
      proc.on('close', code => {
        if (code !== 0) { reject(new Error('rclone: ' + err.trim())); return }
        try {
          const entries = JSON.parse(out || '[]')
          const basePrefix = base ? base + '/' : ''
          resolve({
            folders: entries.filter(e => e.IsDir).map(e => ({ name: e.Name, path: basePrefix + e.Name })),
            files: entries.filter(e => !e.IsDir && isCloudMediaFile(e.Name)).map(e => ({
              id: basePrefix + e.Name, name: e.Name, path: basePrefix + e.Name, size: e.Size
            }))
          })
        } catch (e) { reject(new Error('rclone parse error: ' + e.message)) }
      })
      proc.on('error', e => reject(new Error('rclone not found — is it installed and in PATH? ' + e.message)))
    })
  }

  // ── Backblaze B2 ─────────────────────────────────────────────────────────
  if (src.provider === 'b2') {
    const auth = await httpsGet('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
      Authorization: 'Basic ' + Buffer.from(src.b2KeyId + ':' + src.b2AppKey).toString('base64')
    })
    if (auth.status && auth.status !== 200) throw new Error('B2 auth failed: ' + (auth.message || auth.code))
    const bucketId = await getB2BucketId(auth, src.b2Bucket)
    const prefix = folderPath != null ? folderPath : (src.b2Prefix || '')
    const allEntries = []
    let startFileName = null
    do {
      const body = { bucketId, prefix, delimiter: '/', maxFileCount: 1000 }
      if (startFileName) body.startFileName = startFileName
      const page = await httpsPost(auth.apiUrl + '/b2api/v2/b2_list_file_names',
        body, { Authorization: auth.authorizationToken })
      if (page.status && page.status !== 200) throw new Error('B2 list error: ' + (page.message || page.code))
      allEntries.push(...(page.files || []))
      startFileName = page.nextFileName || null
    } while (startFileName)
    return {
      folders: allEntries.filter(f => f.action === 'folder').map(f => ({
        name: f.fileName.replace(prefix, '').replace(/\/$/, ''), path: f.fileName
      })),
      files: allEntries.filter(f => f.action !== 'folder' && isCloudMediaFile(f.fileName)).map(f => ({
        id: f.fileId, name: path.basename(f.fileName), path: f.fileName, size: f.contentLength
      })),
      _auth: { apiUrl: auth.apiUrl, token: auth.authorizationToken,
               dlUrl: auth.downloadUrl, accountId: auth.accountId, bucketId }
    }
  }

  // ── Dropbox ───────────────────────────────────────────────────────────────
  if (src.provider === 'dropbox') {
    const folderArg = folderPath != null ? folderPath : (src.dropboxPath || '')
    const res = await httpsPost('https://api.dropboxapi.com/2/files/list_folder',
      { path: folderArg || '', include_media_info: false, recursive: false },
      { Authorization: 'Bearer ' + src.dropboxToken })
    if (res.error) throw new Error(res.error_summary || JSON.stringify(res.error))
    return {
      folders: res.entries.filter(e => e['.tag'] === 'folder').map(e => ({ name: e.name, path: e.path_lower })),
      files: res.entries.filter(e => e['.tag'] === 'file' && isCloudMediaFile(e.name))
        .map(e => ({ id: e.id, name: e.name, path: e.path_lower, size: e.size }))
    }
  }

  // ── Google Drive ──────────────────────────────────────────────────────────
  if (src.provider === 'gdrive') {
    const parentId = folderPath != null ? folderPath : (src.gdriveFolderId || 'root')
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`)
    const fields = encodeURIComponent('files(id,name,mimeType,size)')
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&key=${src.gdriveApiKey}`
    const res = await httpsGet(url)
    if (res.error) throw new Error(res.error.message || JSON.stringify(res.error))
    return {
      folders: (res.files || []).filter(f => f.mimeType === 'application/vnd.google-apps.folder')
        .map(f => ({ name: f.name, path: f.id })),
      files: (res.files || []).filter(f => f.mimeType !== 'application/vnd.google-apps.folder' && isCloudMediaFile(f.name))
        .map(f => ({ id: f.id, name: f.name, path: f.id, size: f.size }))
    }
  }

  throw new Error('Unknown provider: ' + src.provider)
})

// ── B2 music library scanner ──────────────────────────────────────────────
const COVER_FILE_NAMES = new Set(['cover.jpg','folder.jpg','cover.png','folder.png','artwork.jpg','album.jpg','front.jpg'])
let b2MusicCache = null
let b2MusicCacheSourceId = null

// Strip leading year and trailing quality/format tags from a folder segment.
// e.g. "(1998) System Of A Down - Toxicity [16Bit-44.1kHz]" → "System Of A Down - Toxicity"
function stripFolderTags(name) {
  let s = name
  // Strip leading (YYYY) or [YYYY] optionally followed by dash/space
  s = s.replace(/^[\(\[]\d{4}[\)\]]\s*[-–]?\s*/, '')
  // Strip trailing bracketed/parenthetical quality tags (multiple passes)
  let prev
  do { prev = s; s = s.replace(/\s*[\(\[][^\)\]]{1,80}[\)\]]\s*$/, '').trim() } while (s !== prev)
  // Strip trailing standalone format word: " - FLAC", " - MP3", etc.
  s = s.replace(/\s*[-–]\s*(FLAC|MP3|AAC|OGG|WMA|WAV|ALAC|320|V0|V2)\s*$/i, '').trim()
  return s.trim() || name
}

// Returns true if a folder segment is just a bare 4-digit year like "1994"
function isBareYear(s) { return /^\d{4}$/.test(s.trim()) }

// Given a folder name like any of these common patterns, return { artist, album }:
//   "Bad Religion - New Maps of Hell (2007) [Epitaph] - FLAC"
//   "Days N' Daze - 2017 - CRUSTFALL [WEB FLAC]"
//   "GBH - 1986 - Midnight Madness and Beyond"
//   "(1996) RENT"
//   "Dropkick Murphys - Do Or Die"
function parseArtistAlbumFolder(folderName) {
  let s = stripFolderTags(folderName)

  // Split on the FIRST " - " or " _ " separator
  const dashIdx = s.search(/\s+[-_]\s+/)
  if (dashIdx === -1) {
    // No standard separator — try to detect "HyphenatedArtist-AlbumWords" pattern
    // e.g. "Anti-Flag-Their System Doesn't Work For You" → artist "Anti-Flag", album "Their System..."
    if (s.includes(' ')) {
      const matches = [...s.matchAll(/-([A-Z])/g)]
      for (let i = matches.length - 1; i >= 0; i--) {
        const splitAt = matches[i].index
        const innerArtist = s.slice(0, splitAt).trim()
        const innerAlbum = s.slice(splitAt + 1).trim()
        if ((innerAlbum.includes(' ') || /\.[A-Za-z]/.test(innerAlbum)) && innerArtist.length > 0) {
          return { artist: innerArtist, album: stripFolderTags(innerAlbum) }
        }
      }
    }
    return { artist: s, album: s }
  }

  const artist = s.slice(0, dashIdx).trim()
  let album    = s.slice(dashIdx).replace(/^\s*[-_]\s*/, '').trim()

  // If the "artist" portion is a bare year (e.g. "1994 - Green Day - Dookie"),
  // treat the year as a date prefix and re-parse the remainder as "Artist - Album"
  if (isBareYear(artist)) {
    const innerDashIdx = album.search(/\s+[-_]\s+/)
    if (innerDashIdx !== -1) {
      const innerArtist = album.slice(0, innerDashIdx).trim()
      let innerAlbum = album.slice(innerDashIdx).replace(/^\s*[-_]\s*/, '').trim()
      innerAlbum = innerAlbum.replace(/^\d{4}\s*[-–]\s+/, '').trim()
      innerAlbum = stripFolderTags(innerAlbum)
      return { artist: innerArtist, album: innerAlbum || innerArtist }
    }
    // Only one segment after year — use it as both artist and album
    return { artist: album, album: album }
  }

  // If what's left starts with a bare year (e.g. "2017 - CRUSTFALL"), strip it
  album = album.replace(/^\d{4}\s*[-–]\s+/, '').trim()

  // Strip any remaining trailing tags from the album part
  album = stripFolderTags(album)

  return { artist, album: album || artist }
}

ipcMain.handle('scan-b2-music', async () => {
  const src = B2_SOURCE
  if (b2MusicCache && b2MusicCacheSourceId === src.id) return b2MusicCache

  const auth = await httpsGet('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    Authorization: 'Basic ' + Buffer.from(src.b2KeyId + ':' + src.b2AppKey).toString('base64')
  })
  if (auth.status && auth.status !== 200) throw new Error('B2 auth failed: ' + (auth.message || auth.code))
  const bucketId = await getB2BucketId(auth, src.b2Bucket)

  // List all files recursively under Music/ (no delimiter)
  const allFiles = []
  let startFileName = null
  do {
    const body = { bucketId, prefix: 'Music/', maxFileCount: 1000 }
    if (startFileName) body.startFileName = startFileName
    const page = await httpsPost(auth.apiUrl + '/b2api/v2/b2_list_file_names',
      body, { Authorization: auth.authorizationToken })
    if (page.status && page.status !== 200) throw new Error('B2 list error: ' + (page.message || page.code))
    allFiles.push(...(page.files || []))
    startFileName = page.nextFileName || null
  } while (startFileName)

  // Get a broad download authorization (empty prefix = all files in bucket)
  const dlAuthRes = await httpsPost(auth.apiUrl + '/b2api/v2/b2_get_download_authorization',
    { bucketId, fileNamePrefix: '', validDurationInSeconds: 86400 },
    { Authorization: auth.authorizationToken })
  const dlUrl   = auth.downloadUrl
  const dlToken = dlAuthRes.authorizationToken

  // Separate audio files from cover images
  const coverMap = new Map() // "Artist\x00Album" → b2 filePath
  const cueMap   = new Map() // folderPath       → b2 filePath for .cue
  const audioEntries = []

  // Segments that look like disc/artwork subfolders — skip when finding album name
  const SKIP_SEGMENTS = /^(cd\s*\d+|disc\s*\d+|disk\s*\d+|artwork|scans|extras?|bonus)$/i

  // Parse a B2 file path into { artistName, albumName, filename }.
  // parts[0] is always 'Music'. Handles all observed structures:
  //   3-level: Music/Artist - Album [tags]/track
  //   3-level: Music/(YEAR) Artist - Album [tags]/track
  //   3-level: Music/1994/Artist - Album/track  (bare year root folder)
  //   4-level: Music/Artist - Discography/(YEAR) Artist - Album [tags]/track
  //   5-level: Music/Artist/1994/Album/track  (year middle folder)
  //   6-level: Music/Artist - Discography/SubDir/AlbumDir/CD1/track
  function parseMusicPath(parts) {
    if (parts.length < 3) return null

    const folder1 = parts[1]

    // ── 3-level: Music/FolderName/track ────────────────────────────────────
    if (parts.length === 3) {
      const { artist, album } = parseArtistAlbumFolder(folder1)
      return { artistName: artist, albumName: album, filename: parts[2] }
    }

    // ── 3-level where folder1 is a bare year: Music/1994/Artist - Album/track
    if (parts.length === 4 && isBareYear(folder1)) {
      const { artist, album } = parseArtistAlbumFolder(parts[2])
      return { artistName: artist, albumName: album, filename: parts[3] }
    }

    // ── 4-level standard ────────────────────────────────────────────────────
    if (parts.length === 4) {
      // Music/folder1/folder2/track
      const { artist: a1, album: al1 } = parseArtistAlbumFolder(folder1)
      const { artist: a2, album: al2 } = parseArtistAlbumFolder(parts[2])
      // If folder1 is bare year, get everything from folder2
      if (isBareYear(folder1)) return { artistName: a2, albumName: al2, filename: parts[3] }
      // Otherwise folder1 → artist, folder2 → album
      // If folder2 also has an artist name, prefer album portion of folder2
      return { artistName: a1, albumName: al2, filename: parts[3] }
    }

    // ── 5+ level ─────────────────────────────────────────────────────────────
    // artist always comes from folder1 (parse artist portion)
    const { artist: artistName } = parseArtistAlbumFolder(folder1)

    // Walk remaining folder segments (parts[2..n-1]) to find the best album name.
    // Skip bare years and generic disc/artwork folders.
    // Iterate in REVERSE so we prefer the folder closest to the track file —
    // e.g. Music/Artist/Discography/1984 - Album/track.flac → "Album", not "Discography"
    const trackFile = parts[parts.length - 1]
    const folderSegs = parts.slice(2, parts.length - 1)
    let albumName = null
    for (let i = folderSegs.length - 1; i >= 0; i--) {
      const seg = folderSegs[i]
      if (isBareYear(seg) || SKIP_SEGMENTS.test(seg)) continue
      const { album } = parseArtistAlbumFolder(seg)
      albumName = album
      break // take the last meaningful one (closest to the track)
    }
    if (!albumName) albumName = parseArtistAlbumFolder(folder1).album

    return { artistName, albumName, filename: parts.slice(2).join('/') }
  }

  for (const f of allFiles) {
    if (f.action === 'folder') continue
    const filePath = f.fileName
    const parts = filePath.split('/')
    if (parts.length < 3) continue // need at least Music/Folder/track
    const baseName = parts[parts.length - 1].toLowerCase()

    const parsed = parseMusicPath(parts)
    if (!parsed) continue

    if (COVER_FILE_NAMES.has(baseName)) {
      const key = parsed.artistName + '\x00' + parsed.albumName
      if (!coverMap.has(key)) coverMap.set(key, filePath)
    } else if (path.extname(f.fileName).toLowerCase() === '.cue') {
      const folderPath = filePath.substring(0, filePath.lastIndexOf('/'))
      if (!cueMap.has(folderPath)) cueMap.set(folderPath, filePath)
    } else if (isCloudMediaFile(f.fileName)) {
      audioEntries.push({ ...f, _parsed: parsed })
    }
  }

  // Parse audio files into artist/album/track structure
  // artistMap key is lowercase for case-insensitive grouping
  const artistMap    = new Map() // lowercase key → albumMap
  const artistNames  = new Map() // lowercase key → best display name

  for (const f of audioEntries) {
    const { artistName, albumName, filename } = f._parsed
    const ext = path.extname(filename).toLowerCase()
    const baseName = path.basename(filename, ext)

    // Parse track number from leading pattern: "01 - ", "01. ", "1 - ", "1. "
    let trackNo = 0
    let title   = baseName
    const trackMatch = baseName.match(/^(\d+)\s*[-–.]\s+(.+)$/)
    if (trackMatch) {
      trackNo = parseInt(trackMatch[1], 10)
      title   = trackMatch[2]
    }

    const artistKey = artistName.toLowerCase()
    // Prefer the name that appears most (handled below) — for now store first seen
    if (!artistNames.has(artistKey)) artistNames.set(artistKey, artistName)
    if (!artistMap.has(artistKey)) artistMap.set(artistKey, new Map())
    const albumMap = artistMap.get(artistKey)
    if (!albumMap.has(albumName)) albumMap.set(albumName, [])
    albumMap.get(albumName).push({
      title,
      path:    f.fileName,
      fileId:  f.fileId,
      size:    f.contentLength,
      ext,
      trackNo,
    })
  }

  // For display name: pick the variant with the most albums (most complete name wins)
  for (const [key, albumMap] of artistMap.entries()) {
    const variants = [...audioEntries
      .filter(f => f._parsed.artistName.toLowerCase() === key)
      .reduce((m, f) => { m.set(f._parsed.artistName, (m.get(f._parsed.artistName) || 0) + 1); return m }, new Map())
      .entries()
    ].sort((a, b) => b[1] - a[1])
    if (variants.length > 0) artistNames.set(key, variants[0][0])
  }

  // Build sorted structure
  const artists = []
  for (const [artistKey, albumMap] of [...artistMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const artistName = artistNames.get(artistKey) || artistKey
    const albums = []
    for (const [albumName, tracks] of [...albumMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      tracks.sort((a, b) => (a.trackNo || 999) - (b.trackNo || 999) || a.path.localeCompare(b.path))
      // coverMap keys may use any casing variant — try all
      const coverKey  = artistName + '\x00' + albumName
      const coverKey2 = artistKey  + '\x00' + albumName
      const coverPath = coverMap.get(coverKey) || coverMap.get(coverKey2) || null
      const folderPath = tracks[0]?.path.substring(0, tracks[0].path.lastIndexOf('/')) || ''
      const cuePath    = cueMap.get(folderPath) || null
      albums.push({ name: albumName, coverPath, tracks, cuePath })
    }
    artists.push({ name: artistName, albums })
  }

  const result = { artists, dlUrl, dlToken, bucketName: src.b2Bucket }
  b2MusicCache = result
  b2MusicCacheSourceId = src.id
  return result
})

ipcMain.handle('get-cloud-stream-url', async (_, { sourceId, fileId, filePath, _auth }) => {
  const src = CONFIG.cloudSources.find(s => s.id === sourceId)
  if (!src) throw new Error('Cloud source not found: ' + sourceId)

  // ── rclone ────────────────────────────────────────────────────────────────
  if (src.provider === 'rclone') {
    const port = await startRcloneServer(src)
    const prefix = (src.rclonePrefix || '').replace(/^\/+/, '').replace(/\/+$/, '')
    let relPath = filePath
    if (prefix && relPath.startsWith(prefix + '/')) relPath = relPath.slice(prefix.length + 1)
    else if (prefix && relPath === prefix) relPath = ''
    const encoded = relPath.split('/').map(encodeURIComponent).join('/')
    return `http://127.0.0.1:${port}/${encoded}`
  }

  // ── Backblaze B2 ─────────────────────────────────────────────────────────
  if (src.provider === 'b2') {
    let auth = _auth, bucketId = _auth?.bucketId
    if (!auth) {
      const a = await httpsGet('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
        Authorization: 'Basic ' + Buffer.from(src.b2KeyId + ':' + src.b2AppKey).toString('base64')
      })
      bucketId = await getB2BucketId(a, src.b2Bucket)
      auth = { apiUrl: a.apiUrl, token: a.authorizationToken, dlUrl: a.downloadUrl, accountId: a.accountId, bucketId }
    }
    const dlAuth = await httpsPost(auth.apiUrl + '/b2api/v2/b2_get_download_authorization',
      { bucketId, fileNamePrefix: filePath, validDurationInSeconds: 3600 },
      { Authorization: auth.token })
    const encoded = filePath.split('/').map(encodeURIComponent).join('/')
    return `${auth.dlUrl}/file/${src.b2Bucket}/${encoded}?Authorization=${dlAuth.authorizationToken}`
  }

  // ── Dropbox ───────────────────────────────────────────────────────────────
  if (src.provider === 'dropbox') {
    const res = await httpsPost('https://api.dropboxapi.com/2/files/get_temporary_link',
      { path: filePath }, { Authorization: 'Bearer ' + src.dropboxToken })
    if (res.error) throw new Error(res.error_summary || JSON.stringify(res.error))
    return res.link
  }

  // ── Google Drive ──────────────────────────────────────────────────────────
  if (src.provider === 'gdrive') {
    return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${src.gdriveApiKey}`
  }

  throw new Error('Unknown provider: ' + src.provider)
})

// ============================================
// CUE SHEET TEXT FETCH
// ============================================
ipcMain.handle('fetch-b2-file-text', async (_, { filePath }) => {
  if (!b2MusicCache) throw new Error('B2 library not loaded — open Music first')
  const { dlUrl, dlToken } = b2MusicCache
  const bucket  = B2_SOURCE.b2Bucket
  const encoded = filePath.split('/').map(encodeURIComponent).join('/')
  const url     = dlUrl + '/file/' + bucket + '/' + encoded + '?Authorization=' + dlToken
  return new Promise((resolve, reject) => {
    require('https').get(url, { headers: { 'User-Agent': 'AtomicBlast/1.0' } }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' fetching ' + filePath)); return }
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
    }).on('error', reject)
  })
})

// ============================================
// LOCAL HTTP API (AtomicBlast Firefox extension)
// ============================================
let mainWindow = null
let playerState = { playing: false, title: '', artist: '', album: '', shuffle: false, queueIdx: 0, queueLen: 0 }
let apiServerStarted = false

ipcMain.on('player-state-update', (_, state) => { Object.assign(playerState, state) })

function startApiServer() {
  if (apiServerStarted) return
  apiServerStarted = true

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  const server = http.createServer((req, res) => {
    const send = (data, code = 200) => { res.writeHead(code, corsHeaders); res.end(JSON.stringify(data)) }

    if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders); res.end(); return }

    // GET /status
    if (req.method === 'GET' && req.url === '/status') {
      send(playerState)
      return
    }

    // POST /command — { cmd, ...args }
    if (req.method === 'POST' && req.url === '/command') {
      let body = ''
      req.on('data', d => { body += d })
      req.on('end', () => {
        try {
          const payload = JSON.parse(body)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('remote-cmd', payload)
            send({ ok: true })
          } else {
            send({ error: 'AtomicBlast window not available' }, 503)
          }
        } catch (e) {
          send({ error: 'Invalid JSON' }, 400)
        }
      })
      return
    }

    // GET /library — slim artist/album/track list from B2 cache
    if (req.method === 'GET' && req.url === '/library') {
      if (!b2MusicCache) {
        // Ask renderer to load it, extension should poll until available
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('remote-cmd', { cmd: 'load-b2-library' })
        }
        send({ loading: true, artists: [] })
      } else {
        const slim = b2MusicCache.artists.map(a => ({
          name: a.name,
          albums: a.albums.map(al => ({
            name: al.name,
            tracks: al.tracks.map(t => ({ title: t.title, path: t.path, ext: t.ext, trackNo: t.trackNo }))
          }))
        }))
        send({ loading: false, artists: slim })
      }
      return
    }

    send({ error: 'Not found' }, 404)
  })

  server.on('error', e => console.error('[AtomicBlast API]', e.message))
  server.listen(57832, '127.0.0.1', () => console.log('[AtomicBlast API] listening on http://127.0.0.1:57832'))
}

// ============================================
// METADATA AGGREGATOR
// Last.fm · MusicBrainz · Wikipedia · Deezer · Bandcamp
// ============================================
const LASTFM_KEY = 'd67dea9be32d3f2510ef5cde2db140fb'
const artistMetaCache = new Map()
const albumMetaCache  = new Map()

// ── HTTP helpers ────────────────────────────────────────────────────────────
function fetchHtml(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const mod  = url.startsWith('https') ? require('https') : require('http')
    const opts = new URL(url)
    mod.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept':          'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    }}, res => {
      if ([301,302,303].includes(res.statusCode) && res.headers.location && redirects > 0) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : opts.origin + res.headers.location
        res.resume(); return fetchHtml(next, redirects - 1).then(resolve).catch(reject)
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    }).on('error', reject)
  })
}

function fetchJson(url) {
  return new Promise(resolve => {
    const mod  = url.startsWith('https') ? require('https') : require('http')
    const opts = new URL(url)
    mod.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: {
      'User-Agent': 'AtomicBlast/1.0 (music player; github.com/punktilend/AtomicBlast)',
      'Accept':     'application/json',
    }}, res => {
      if ([301,302,303].includes(res.statusCode) && res.headers.location) {
        res.resume()
        const next = res.headers.location.startsWith('http') ? res.headers.location : opts.origin + res.headers.location
        return fetchJson(next).then(resolve)
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch(e) { resolve(null) } })
    }).on('error', () => resolve(null))
  })
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
}

function stripHtml(str) {
  return str ? decodeHtmlEntities(str.replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : ''
}

function mergeTags(a, b) {
  const seen = new Set()
  return [...a, ...b].filter(t => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 10)
}

// ── Source: Last.fm ─────────────────────────────────────────────────────────
async function fetchLastfmArtist(name) {
  try {
    const data = await fetchJson(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${LASTFM_KEY}&format=json&autocorrect=1`)
    if (!data?.artist) return null
    const a   = data.artist
    const img = (a.image || []).find(i => i.size === 'extralarge')?.['#text'] ||
                (a.image || []).find(i => i.size === 'large')?.['#text'] || null
    const bio = stripHtml(a.bio?.summary || a.bio?.content || '').replace(/Read more on Last\.fm\.?/gi, '').trim()
    return {
      image:     img && !img.includes('2a96cbd8b46e442fc41c2b86b821562f') ? img : null,
      bio:       bio.length > 20 ? bio : null,
      tags:      (a.tags?.tag  || []).slice(0, 8).map(t => t.name),
      similar:   (a.similar?.artist || []).slice(0, 6).map(s => s.name),
      listeners: a.stats?.listeners ? Number(a.stats.listeners).toLocaleString() : null,
    }
  } catch(e) { return null }
}

async function fetchLastfmAlbum(artist, album) {
  try {
    const data = await fetchJson(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&api_key=${LASTFM_KEY}&format=json&autocorrect=1`)
    if (!data?.album) return null
    const a   = data.album
    const img = (a.image || []).find(i => i.size === 'extralarge')?.['#text'] || null
    const wiki = stripHtml(a.wiki?.summary || '').replace(/Read more on Last\.fm\.?/gi, '').trim()
    return {
      image: img && !img.includes('2a96cbd8b46e442fc41c2b86b821562f') ? img : null,
      wiki:  wiki.length > 20 ? wiki : null,
    }
  } catch(e) { return null }
}

// ── Source: MusicBrainz ─────────────────────────────────────────────────────
async function fetchMusicBrainzArtist(name) {
  try {
    const data = await fetchJson(`https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(name)}&fmt=json&limit=3`)
    if (!data?.artists?.length) return null
    const artist = data.artists.sort((a,b) => (b.score||0)-(a.score||0))[0]
    if ((artist.score || 0) < 60) return null
    return {
      formed:  artist['life-span']?.begin?.slice(0, 4) || null,
      country: artist.country || artist.area?.name || null,
      tags:    (artist.tags || []).sort((a,b)=>b.count-a.count).slice(0,8).map(t=>t.name),
      type:    artist.type || null,
      mbid:    artist.id,
    }
  } catch(e) { return null }
}

async function fetchMusicBrainzRelease(artist, album) {
  try {
    const data = await fetchJson(`https://musicbrainz.org/ws/2/release-group/?query=artist:${encodeURIComponent(artist)}+releasegroup:${encodeURIComponent(album)}&fmt=json&limit=1`)
    const rg = data?.['release-groups']?.[0]
    if (!rg || (rg.score||0) < 60) return null
    return { mbid: rg.id, year: rg['first-release-date']?.slice(0,4) || null }
  } catch(e) { return null }
}

// ── Source: Cover Art Archive ────────────────────────────────────────────────
async function fetchCoverArt(mbid) {
  try {
    const data = await fetchJson(`https://coverartarchive.org/release-group/${mbid}`)
    const img = data?.images?.find(i => i.front) || data?.images?.[0]
    return img?.thumbnails?.['500'] || img?.image || null
  } catch(e) { return null }
}

// ── Source: Wikipedia ────────────────────────────────────────────────────────
async function fetchWikipedia(name) {
  try {
    const data = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`)
    if (!data || data.type === 'disambiguation' || !data.extract) return null
    return {
      bio:   data.extract.slice(0, 800),
      image: data.thumbnail?.source?.replace(/\/\d+px-/, '/500px-') || null,
      url:   data.content_urls?.desktop?.page || null,
    }
  } catch(e) { return null }
}

// ── Source: Deezer ───────────────────────────────────────────────────────────
async function fetchDeezerArtist(name) {
  try {
    const data = await fetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=3`)
    if (!data?.data?.length) return null
    const lower = name.toLowerCase()
    const match = data.data.find(a => a.name.toLowerCase() === lower) || data.data[0]
    return {
      image: match.picture_xl || match.picture_big || null,
      fans:  match.nb_fan ? Number(match.nb_fan).toLocaleString() : null,
      link:  match.link || null,
    }
  } catch(e) { return null }
}

async function fetchDeezerAlbum(artist, album) {
  try {
    const data = await fetchJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(artist + ' ' + album)}&limit=3`)
    if (!data?.data?.length) return null
    const lower = album.toLowerCase()
    const match = data.data.find(a => a.title.toLowerCase().includes(lower)) || data.data[0]
    return { image: match.cover_xl || match.cover_big || null }
  } catch(e) { return null }
}

// ── Source: Bandcamp ─────────────────────────────────────────────────────────
async function fetchBandcampAlbum(artist, album) {
  try {
    const q = encodeURIComponent(artist + ' ' + album)
    const searchHtml = await fetchHtml(`https://bandcamp.com/search?q=${q}&item_type=a`)
    // Get first album result URL
    const urlMatch = searchHtml.match(/class="searchresult album"[\s\S]{1,2000}?<div class="heading">\s*<a href="([^"?#]+)/)
    if (!urlMatch) return null
    const albumUrl  = urlMatch[1].replace(/\?.*$/, '')
    const albumHtml = await fetchHtml(albumUrl)
    // Cover art — try tralbumArt img first, then ld+json image
    const imgMatch =
      albumHtml.match(/<div[^>]+id="tralbumArt"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/) ||
      albumHtml.match(/<img[^>]+class="[^"]*art[^"]*"[^>]+src="(https:\/\/f4\.bcbits\.com[^"]+)"/)
    if (imgMatch) {
      // Bandcamp serves small images — request _10 (1200px) variant
      return imgMatch[1].replace(/_\d+\.jpg/, '_10.jpg').split('?')[0]
    }
    // Fallback: ld+json image
    const ldMatch = albumHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    if (ldMatch) {
      try { const ld = JSON.parse(ldMatch[1]); if (ld.image) return ld.image } catch(e) {}
    }
    return null
  } catch(e) { return null }
}

async function fetchBandcampArtist(name) {
  try {
    const searchHtml = await fetchHtml(`https://bandcamp.com/search?q=${encodeURIComponent(name)}&item_type=b`)
    const urlMatch = searchHtml.match(/class="searchresult band"[\s\S]{1,2000}?<div class="heading">\s*<a href="([^"?#]+)/)
    if (!urlMatch) return null
    const bandUrl  = urlMatch[1].replace(/\?.*$/, '')
    const bandHtml = await fetchHtml(bandUrl)
    const result   = { image: null, bio: null, url: bandUrl }
    const photoMatch =
      bandHtml.match(/<img[^>]+class="[^"]*band-photo[^"]*"[^>]+src="([^"]+)"/) ||
      bandHtml.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*band-photo[^"]*"/)
    if (photoMatch) result.image = photoMatch[1].split('?')[0]
    const ldMatch = bandHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    if (ldMatch) { try { const ld = JSON.parse(ldMatch[1]); if (ld.description) result.bio = ld.description } catch(e) {} }
    if (!result.bio) {
      const bioMatch = bandHtml.match(/<p class="bio"[^>]*>([\s\S]*?)<\/p>/) ||
                       bandHtml.match(/<div[^>]+id="bio-text"[^>]*>([\s\S]*?)<\/div>/)
      if (bioMatch) result.bio = stripHtml(bioMatch[1])
    }
    if (result.bio && result.bio.length < 10) result.bio = null
    return result
  } catch(e) { return null }
}

// ── IPC: fetch-artist-meta ───────────────────────────────────────────────────
ipcMain.handle('fetch-artist-meta', async (_, { artistName }) => {
  if (artistMetaCache.has(artistName)) return artistMetaCache.get(artistName)

  const [lfm, mb, wiki, deezer, bc] = await Promise.all([
    fetchLastfmArtist(artistName),
    fetchMusicBrainzArtist(artistName),
    fetchWikipedia(artistName),
    fetchDeezerArtist(artistName),
    fetchBandcampArtist(artistName),
  ])

  const merged = {
    image:       lfm?.image || wiki?.image || deezer?.image || bc?.image || null,
    bio:         lfm?.bio   || wiki?.bio   || bc?.bio       || null,
    tags:        mergeTags(lfm?.tags || [], mb?.tags || []),
    similar:     lfm?.similar   || [],
    listeners:   lfm?.listeners || null,
    formed:      mb?.formed     || null,
    country:     mb?.country    || null,
    type:        mb?.type       || null,
    fans:        deezer?.fans   || null,
    bandcampUrl: bc?.url        || null,
    wikiUrl:     wiki?.url      || null,
    deezerUrl:   deezer?.link   || null,
  }

  console.log(`[Meta] ${artistName}: img=${!!merged.image} bio=${!!merged.bio} tags=${merged.tags.length} similar=${merged.similar.length}`)
  artistMetaCache.set(artistName, merged)
  return merged
})

// ── IPC: fetch-album-meta ────────────────────────────────────────────────────
ipcMain.handle('fetch-album-meta', async (_, { artistName, albumName }) => {
  const key = artistName + '\x00' + albumName
  if (albumMetaCache.has(key)) return albumMetaCache.get(key)

  const [lfm, mb, deezer] = await Promise.all([
    fetchLastfmAlbum(artistName, albumName),
    fetchMusicBrainzRelease(artistName, albumName),
    fetchDeezerAlbum(artistName, albumName),
  ])

  let coverArt = lfm?.image || deezer?.image || null
  if (!coverArt && mb?.mbid) coverArt = await fetchCoverArt(mb.mbid)
  if (!coverArt) coverArt = await fetchBandcampAlbum(artistName, albumName)

  const merged = { coverArt, wiki: lfm?.wiki || null, year: mb?.year || null }

  console.log(`[AlbumMeta] ${artistName} - ${albumName}: cover=${!!merged.coverArt} wiki=${!!merged.wiki}`)
  albumMetaCache.set(key, merged)
  return merged
})

// ============================================
// APP LIFECYCLE
// ============================================
app.whenReady().then(createWindow)

app.on('will-quit', () => {
  for (const { process: proc } of rcloneServers.values()) {
    try { proc.kill() } catch (e) {}
  }
})
