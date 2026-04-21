const express = require('express');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load /opt/pulse-proxy/.env when present so PM2 restarts keep B2 credentials.
const ENV_FILE = path.join(__dirname, '.env');
try {
  if (fs.existsSync(ENV_FILE)) {
    const envText = fs.readFileSync(ENV_FILE, 'utf8');
    envText.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] == null) process.env[key] = value;
    });
  }
} catch (e) {
  console.error('[startup] Failed to load .env:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// B2 config
const B2_BUCKET_URL = process.env.B2_BUCKET_URL || 'https://s3.us-east-005.backblazeb2.com/SpAtomify';
const B2_KEY_ID     = process.env.B2_KEY_ID  || '';
const B2_APP_KEY    = process.env.B2_APP_KEY || '';
const B2_BUCKET     = process.env.B2_BUCKET  || 'SpAtomify';
const B2_PREFIX     = process.env.B2_PREFIX  || 'Music/';

// Quality presets
const QUALITY_PRESETS = {
  flac:   null,
  high:   '320k',
  medium: '192k',
  low:    '128k',
};

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve web app static files
app.use(express.static(path.join(__dirname, 'public')));

// ── Favorites storage ─────────────────────────────────────────────────────────
const FAVORITES_FILE = path.join(__dirname, 'favorites.json');
function loadFavorites() {
  try { return JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8')); } catch { return []; }
}
function saveFavorites(favorites) {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2), 'utf8');
}

app.get('/favorites', (req, res) => res.json(loadFavorites()));
app.post('/favorites', (req, res) => {
  const { filePath, title, artist, album, format } = req.body || {};
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  const favorites = loadFavorites();
  if (favorites.some(f => f.filePath === filePath)) return res.json({ ok: true, already: true, favorites });
  favorites.push({ filePath, title: title||'', artist: artist||'', album: album||'', format: format||'', addedAt: new Date().toISOString() });
  saveFavorites(favorites);
  res.json({ ok: true, favorites });
});
app.delete('/favorites', (req, res) => {
  const { filePath } = req.body || {};
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  saveFavorites(loadFavorites().filter(f => f.filePath !== filePath));
  res.json({ ok: true });
});

// ── Playlists storage (web app) ───────────────────────────────────────────────
const PLAYLISTS_FILE = path.join(__dirname, 'playlists.json');
function loadPlaylists() {
  try { return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf8')); } catch { return { liked: [], playlists: [] }; }
}
app.get('/api/playlists', (req, res) => res.json(loadPlaylists()));
app.post('/api/playlists', (req, res) => {
  try {
    fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── B2 native API helpers ─────────────────────────────────────────────────────
function b2Get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'AtomicBlast/1.0', ...headers } }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 300))); } });
    }).on('error', reject);
  });
}

function b2Post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
                 'User-Agent': 'AtomicBlast/1.0', ...headers }
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 300))); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function b2Auth() {
  const auth = await b2Get('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    Authorization: 'Basic ' + Buffer.from(B2_KEY_ID + ':' + B2_APP_KEY).toString('base64')
  });
  if (auth.status && auth.status !== 200) throw new Error('B2 auth failed: ' + (auth.message || auth.code));
  return auth;
}

async function b2GetBucketId(auth, bucketName) {
  const res = await b2Post(auth.apiUrl + '/b2api/v2/b2_list_buckets',
    { accountId: auth.accountId, bucketName },
    { Authorization: auth.authorizationToken });
  const bucket = res.buckets && res.buckets[0];
  if (!bucket) throw new Error('B2 bucket not found: ' + bucketName);
  return bucket.bucketId;
}

// ── B2 library scanner (ported from Electron main.js) ────────────────────────
const AUDIO_EXTS = new Set(['.mp3','.flac','.m4a','.wav','.aac','.ogg','.opus','.wma','.ape','.aiff','.alac','.webm']);
const VIDEO_EXTS = new Set(['.mp4','.mkv','.avi','.mov','.m4v','.flv']);
const COVER_FILE_NAMES_SET = new Set(['cover.jpg','folder.jpg','cover.png','folder.png','artwork.jpg','album.jpg','front.jpg']);

function isCoverFile(name) { return COVER_FILE_NAMES_SET.has(name.toLowerCase()); }
function isAudioFile(name) { return AUDIO_EXTS.has(path.extname(name).toLowerCase()); }

function stripFolderTags(name) {
  let s = name;
  s = s.replace(/^[\(\[]\d{4}[\)\]]\s*[-–]?\s*/, '');
  s = s.replace(/^\d{4}\.\s+/, '');
  let prev;
  do { prev = s; s = s.replace(/\s*[\(\[][^\)\]]{1,80}[\)\]]\s*$/, '').trim(); } while (s !== prev);
  s = s.replace(/\s*[-–]\s*(FLAC|MP3|AAC|OGG|WMA|WAV|ALAC|320|V0|V2)\s*$/i, '').trim();
  return s.trim() || name;
}

function isBareYear(s) { return /^\d{4}$/.test(s.trim()); }
function isYearDotPrefix(s) { return /^\d{4}\.\s+\S/.test(s.trim()); }

function parseArtistAlbumFolder(folderName) {
  let s = stripFolderTags(folderName);

  // "Artist -YEAR- Album" e.g. "AFI -1999- Black Sails In The Sunset"
  const compactYear = s.match(/^(.+?)\s+-(\d{4})-\s+(.+)$/);
  if (compactYear) {
    return { artist: compactYear[1].trim(), album: stripFolderTags(compactYear[3].trim()) };
  }

  const dashIdx = s.search(/\s+[-_]\s+/);
  if (dashIdx === -1) {
    if (s.includes(' ')) {
      const matches = [];
      const _re = /-([A-Z])/g; let _m;
      while ((_m = _re.exec(s)) !== null) matches.push(_m);
      for (let i = matches.length - 1; i >= 0; i--) {
        const splitAt = matches[i].index;
        const innerArtist = s.slice(0, splitAt).trim();
        const innerAlbum  = s.slice(splitAt + 1).trim();
        if ((innerAlbum.includes(' ') || /\.[A-Za-z]/.test(innerAlbum)) && innerArtist.length > 0)
          return { artist: innerArtist, album: stripFolderTags(innerAlbum) };
      }
    }
    return { artist: s, album: s };
  }
  const artist = s.slice(0, dashIdx).trim();
  let album = s.slice(dashIdx).replace(/^\s*[-_]\s*/, '').trim();
  if (isBareYear(artist)) {
    const innerDashIdx = album.search(/\s+[-_]\s+/);
    if (innerDashIdx !== -1) {
      const innerArtist = album.slice(0, innerDashIdx).trim();
      let innerAlbum = album.slice(innerDashIdx).replace(/^\s*[-_]\s*/, '').trim();
      innerAlbum = innerAlbum.replace(/^\d{4}\s*[-–]\s+/, '').trim();
      innerAlbum = stripFolderTags(innerAlbum);
      return { artist: innerArtist, album: innerAlbum || innerArtist };
    }
    return { artist: album, album };
  }
  album = album.replace(/^\d{4}\s*[-–]\s+/, '').trim();
  album = stripFolderTags(album);
  return { artist, album: album || artist };
}

const SKIP_SEGMENTS = /^(cd\s*\d+|disc\s*\d+|disk\s*\d+|artwork|scans|extras?|bonus)$/i;

function parseMusicPath(parts) {
  if (parts.length < 3) return null;
  const folder1 = parts[1];
  if (parts.length === 3) {
    const { artist, album } = parseArtistAlbumFolder(folder1);
    return { artistName: artist, albumName: album, filename: parts[2] };
  }
  if (parts.length === 4 && (isBareYear(folder1) || isYearDotPrefix(folder1))) {
    const { artist, album } = parseArtistAlbumFolder(parts[2]);
    return { artistName: artist, albumName: album, filename: parts[3] };
  }
  if (parts.length === 4) {
    const { artist: a1 } = parseArtistAlbumFolder(folder1);
    const { album: al2 } = parseArtistAlbumFolder(parts[2]);
    return { artistName: a1, albumName: al2, filename: parts[3] };
  }
  const { artist: artistName } = parseArtistAlbumFolder(folder1);
  const trackFile = parts[parts.length - 1];
  const folderSegs = parts.slice(2, parts.length - 1);
  let albumName = null;
  for (let i = folderSegs.length - 1; i >= 0; i--) {
    const seg = folderSegs[i];
    if (isBareYear(seg) || SKIP_SEGMENTS.test(seg)) continue;
    const { album } = parseArtistAlbumFolder(seg);
    albumName = album;
    break;
  }
  if (!albumName) albumName = parseArtistAlbumFolder(folder1).album;
  return { artistName, albumName, filename: parts.slice(2).join('/') };
}

// ── B2 music cache ────────────────────────────────────────────────────────────
let b2Cache = null;
let b2CacheTime = 0;
const B2_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function scanB2Music() {
  const now = Date.now();
  if (b2Cache && (now - b2CacheTime) < B2_CACHE_TTL_MS) return b2Cache;

  console.log('[scan-b2-music] starting...');
  const auth = await b2Auth();
  const bucketId = await b2GetBucketId(auth, B2_BUCKET);

  // List all files under Music/
  const allFiles = [];
  let startFileName = null;
  do {
    const body = { bucketId, prefix: B2_PREFIX, maxFileCount: 1000 };
    if (startFileName) body.startFileName = startFileName;
    const page = await b2Post(auth.apiUrl + '/b2api/v2/b2_list_file_names',
      body, { Authorization: auth.authorizationToken });
    if (page.status && page.status !== 200) throw new Error('B2 list error: ' + (page.message || page.code));
    allFiles.push(...(page.files || []));
    startFileName = page.nextFileName || null;
  } while (startFileName);

  // Download auth token (24hr) for direct streaming from browser
  const dlAuthRes = await b2Post(auth.apiUrl + '/b2api/v2/b2_get_download_authorization',
    { bucketId, fileNamePrefix: '', validDurationInSeconds: 86400 },
    { Authorization: auth.authorizationToken });
  const dlUrl   = auth.downloadUrl;
  const dlToken = dlAuthRes.authorizationToken;

  // Classify files
  const coverMap = new Map();
  const cueMap   = new Map();
  const audioEntries = [];

  for (const f of allFiles) {
    if (f.action === 'folder') continue;
    const filePath = f.fileName;
    const parts = filePath.split('/');
    if (parts.length < 3) continue;
    const baseName = parts[parts.length - 1];
    const ext = path.extname(baseName).toLowerCase();

    const parsed = parseMusicPath(parts);
    if (!parsed) continue;

    if (isCoverFile(baseName)) {
      const key = parsed.artistName + '\x00' + parsed.albumName;
      if (!coverMap.has(key)) coverMap.set(key, filePath);
    } else if (ext === '.cue') {
      const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
      if (!cueMap.has(folderPath)) cueMap.set(folderPath, filePath);
    } else if (AUDIO_EXTS.has(ext)) {
      audioEntries.push({ ...f, _parsed: parsed });
    }
  }

  const artistMap   = new Map();
  const artistNames = new Map();

  for (const f of audioEntries) {
    const { artistName, albumName, filename } = f._parsed;
    const ext = path.extname(filename).toLowerCase();
    const baseName = path.basename(filename, ext);
    let trackNo = 0, title = baseName;
    const trackMatch = baseName.match(/^(\d+)\s*[-–.]\s+(.+)$/);
    if (trackMatch) { trackNo = parseInt(trackMatch[1], 10); title = trackMatch[2]; }

    const artistKey = artistName.toLowerCase();
    if (!artistNames.has(artistKey)) artistNames.set(artistKey, artistName);
    if (!artistMap.has(artistKey)) artistMap.set(artistKey, new Map());
    const albumMap = artistMap.get(artistKey);
    if (!albumMap.has(albumName)) albumMap.set(albumName, []);
    albumMap.get(albumName).push({ title, path: f.fileName, fileId: f.fileId, size: f.contentLength, ext, trackNo });
  }

  // Pick canonical artist name (most files)
  for (const [key] of artistMap.entries()) {
    const variants = [...audioEntries
      .filter(f => f._parsed.artistName.toLowerCase() === key)
      .reduce((m, f) => { m.set(f._parsed.artistName, (m.get(f._parsed.artistName) || 0) + 1); return m; }, new Map())
      .entries()
    ].sort((a, b) => b[1] - a[1]);
    if (variants.length > 0) artistNames.set(key, variants[0][0]);
  }

  const artists = [];
  for (const [artistKey, albumMap] of [...artistMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const artistName = artistNames.get(artistKey) || artistKey;
    const albums = [];
    for (const [albumName, tracks] of [...albumMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      tracks.sort((a, b) => (a.trackNo || 999) - (b.trackNo || 999) || a.path.localeCompare(b.path));
      const coverKey  = artistName + '\x00' + albumName;
      const coverKey2 = artistKey  + '\x00' + albumName;
      const coverPath = coverMap.get(coverKey) || coverMap.get(coverKey2) || null;
      const folderPath = tracks[0] ? tracks[0].path.substring(0, tracks[0].path.lastIndexOf('/')) : '';
      const cuePath    = cueMap.get(folderPath) || null;
      albums.push({ name: albumName, coverPath, tracks, cuePath });
    }
    artists.push({ name: artistName, albums });
  }

  b2Cache = { artists, dlUrl, dlToken, bucketName: B2_BUCKET };
  b2CacheTime = now;
  console.log(`[scan-b2-music] done: ${artists.length} artists`);
  return b2Cache;
}

// ── API: scan B2 music library ────────────────────────────────────────────────
app.get('/api/scan-b2-music', async (req, res) => {
  try {
    const lib = await scanB2Music();
    res.json(lib);
  } catch (e) {
    console.error('[api/scan-b2-music]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Force re-scan (clears cache)
app.post('/api/scan-b2-music/refresh', async (req, res) => {
  b2Cache = null;
  b2CacheTime = 0;
  try {
    const lib = await scanB2Music();
    res.json({ ok: true, artists: lib.artists.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: fetch B2 file text (CUE sheets etc) ──────────────────────────────────
app.get('/api/b2-file-text', async (req, res) => {
  const { filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  try {
    // Use cached auth if available, otherwise re-auth
    if (!b2Cache) await scanB2Music();
    const { dlUrl, dlToken } = b2Cache;
    const encoded = filePath.split('/').map(encodeURIComponent).join('/');
    const url = `${dlUrl}/file/${B2_BUCKET}/${encoded}?Authorization=${dlToken}`;
    https.get(url, { headers: { 'User-Agent': 'AtomicBlast/1.0' } }, (b2res) => {
      if (b2res.statusCode !== 200) {
        return res.status(b2res.statusCode).json({ error: 'B2 returned ' + b2res.statusCode });
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      b2res.pipe(res);
    }).on('error', e => res.status(500).json({ error: e.message }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function b2FileUrl(filePath) {
  if (!b2Cache) return null;
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return `${b2Cache.dlUrl}/file/${B2_BUCKET}/${encoded}?Authorization=${b2Cache.dlToken}`;
}

// ── Image proxy (cover art from B2 — avoids CORS in Safari) ─────────────────
app.get('/img', async (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).end();
  if (!b2Cache) { try { await scanB2Music(); } catch (e) { return res.status(503).end(); } }
  const fileUrl = b2FileUrl(file);
  https.get(fileUrl, { headers: { 'User-Agent': 'AtomicBlast/1.0' } }, (b2res) => {
    if (b2res.statusCode !== 200) return res.status(b2res.statusCode).end();
    res.setHeader('Content-Type', b2res.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    b2res.pipe(res);
  }).on('error', () => res.status(500).end());
});

// ── Stream endpoint ───────────────────────────────────────────────────────────
app.get('/stream', async (req, res) => {
  const { file, quality = 'high' } = req.query;
  if (!file) return res.status(400).json({ error: 'Missing file param' });
  if (!b2Cache) { try { await scanB2Music(); } catch (e) { return res.status(503).json({ error: 'B2 not ready' }); } }

  const preset = QUALITY_PRESETS[quality];
  const fileUrl = b2FileUrl(file);

  // Safari requires Range request support to play audio.
  // Forward the Range header to B2 and relay the 206 response + headers back.
  if (quality === 'flac' || preset === null) {
    const b2Headers = { 'User-Agent': 'AtomicBlast/1.0' };
    if (req.headers['range']) b2Headers['Range'] = req.headers['range'];
    const proto = fileUrl.startsWith('https') ? https : http;
    const b2req = proto.get(fileUrl, { headers: b2Headers }, (b2res) => {
      if (b2res.statusCode !== 200 && b2res.statusCode !== 206) {
        console.error('[stream] B2 returned', b2res.statusCode, file);
        return res.status(b2res.statusCode || 500).end();
      }
      const ext = file.split('.').pop().toLowerCase();
      const mime = ext === 'flac' ? 'audio/flac' : ext === 'mp3' ? 'audio/mpeg' :
                   ext === 'm4a' ? 'audio/mp4'  : ext === 'ogg'  ? 'audio/ogg'  : 'audio/flac';
      res.setHeader('Content-Type', mime);
      res.setHeader('Accept-Ranges', 'bytes');
      if (b2res.headers['content-length'])  res.setHeader('Content-Length',  b2res.headers['content-length']);
      if (b2res.headers['content-range'])   res.setHeader('Content-Range',   b2res.headers['content-range']);
      if (b2res.headers['last-modified'])   res.setHeader('Last-Modified',   b2res.headers['last-modified']);
      res.status(b2res.statusCode);
      b2res.pipe(res);
    });
    b2req.on('error', e => { console.error('[stream] B2 error:', e.message); if (!res.headersSent) res.status(500).end(); });
    req.on('close', () => b2req.destroy());
    return;
  }

  const isLow = quality === 'low';
  const codec = isLow ? 'aac' : 'libmp3lame';
  const mimeType = isLow ? 'audio/aac' : 'audio/mpeg';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Transfer-Encoding', 'chunked');

  fetchStream(fileUrl, {}, (err, stream) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch from B2' });
    const ffmpeg = spawn('ffmpeg', ['-i','pipe:0','-vn','-acodec',codec,'-b:a',preset,'-f',isLow?'adts':'mp3','pipe:1']);
    stream.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('error', err => { console.error('ffmpeg error:', err); if (!res.headersSent) res.status(500).end(); });
    req.on('close', () => ffmpeg.kill('SIGKILL'));
  });
});

function fetchStream(url, headers, cb) {
  const proto = url.startsWith('https') ? https : http;
  proto.get(url, { headers: { 'User-Agent': 'AtomicBlast/1.0', ...headers } }, (response) => {
    if (response.statusCode !== 200 && response.statusCode !== 206) return cb(new Error(`B2 returned ${response.statusCode}`));
    cb(null, response);
  }).on('error', cb);
}

app.listen(PORT, () => console.log(`AtomicBlast proxy running on port ${PORT}`));
