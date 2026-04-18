const express = require('express');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// B2 config
const B2_BUCKET_URL = process.env.B2_BUCKET_URL || 'https://s3.us-east-005.backblazeb2.com/aharveyGoogleDriveBackup';
const B2_KEY_ID     = process.env.B2_KEY_ID  || '0055a9c537f296d0000000014';
const B2_APP_KEY    = process.env.B2_APP_KEY || 'K005XUecoGa52VpCS6Hb2qx45iGZ/jc';
const B2_BUCKET     = process.env.B2_BUCKET  || 'aharveyGoogleDriveBackup';
const B2_PREFIX     = process.env.B2_PREFIX  || 'Music/';

// Quality presets
const QUALITY_PRESETS = {
  flac:   null,
  high:   '320k',
  medium: '192k',
  low:    '128k',
};

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
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

// ── Playback state (pause-on-disconnect / cross-device resume) ────────────────
const PLAYBACK_STATE_FILE = path.join(__dirname, 'playback-state.json');
app.get('/api/playback-state', (req, res) => {
  try {
    const state = fs.existsSync(PLAYBACK_STATE_FILE)
      ? JSON.parse(fs.readFileSync(PLAYBACK_STATE_FILE, 'utf8'))
      : null;
    res.json(state || {});
  } catch (e) { res.json({}); }
});
app.post('/api/playback-state', (req, res) => {
  try {
    fs.writeFileSync(PLAYBACK_STATE_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});
app.delete('/api/playback-state', (req, res) => {
  try { fs.existsSync(PLAYBACK_STATE_FILE) && fs.unlinkSync(PLAYBACK_STATE_FILE); } catch {}
  res.json({ success: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Genre cache (iTunes Search API) ──────────────────────────────────────────
const GENRES_FILE = path.join(__dirname, 'genres.json');
function loadGenresCache() {
  try { return JSON.parse(fs.readFileSync(GENRES_FILE, 'utf8')); } catch { return {}; }
}
function saveGenresCache(data) {
  try { fs.writeFileSync(GENRES_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}

function httpsGetText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'AtomicBlast/1.0', ...headers } }, res => {
      let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function httpsGetJSON(url, headers = {}) {
  return httpsGetText(url, headers).then(t => JSON.parse(t));
}

function httpsPostForm(url, formBody, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = formBody;
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'AtomicBlast/1.0',
        ...headers,
      },
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

// ── Spotify client credentials auth ──────────────────────────────────────────
const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID     || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const LASTFM_API_KEY        = process.env.LASTFM_API_KEY        || '';

let _spotifyToken    = null;
let _spotifyTokenExp = 0;

async function getSpotifyToken() {
  if (_spotifyToken && Date.now() < _spotifyTokenExp - 30000) return _spotifyToken;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) throw new Error('Spotify credentials not configured (set SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)');
  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await httpsPostForm('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', { Authorization: `Basic ${creds}` });
  if (!res.access_token) throw new Error('Spotify token error: ' + JSON.stringify(res));
  _spotifyToken    = res.access_token;
  _spotifyTokenExp = Date.now() + res.expires_in * 1000;
  return _spotifyToken;
}

async function spotifyGet(path) {
  const token = await getSpotifyToken();
  return httpsGetJSON('https://api.spotify.com/v1' + path, { Authorization: `Bearer ${token}` });
}

async function spotifySearch(type, query) {
  return spotifyGet(`/search?q=${encodeURIComponent(query)}&type=${type}&limit=3`);
}

// In-memory artist/album meta caches (TTL: 6h)
const _artistMetaCache = new Map(); // name → { data, exp }
const _albumMetaCache  = new Map(); // `artist\0album` → { data, exp }
const META_CACHE_TTL   = 6 * 60 * 60 * 1000;

async function fetchItunesGenre(artistName) {
  try {
    const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(artistName) + '&entity=album&limit=5&media=music';
    const text = await httpsGetText(url);
    const data = JSON.parse(text);
    if (!data.results?.length) return null;
    // Find the most common genre across results
    const genres = {};
    for (const r of data.results) {
      const g = r.primaryGenreName;
      if (g && g !== 'Music') genres[g] = (genres[g] || 0) + 1;
    }
    const top = Object.entries(genres).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  } catch { return null; }
}

app.get('/api/genres', async (req, res) => {
  try {
    const lib = await scanB2Music();
    const cached = loadGenresCache();
    const artistGenres = { ...cached };

    // Find artists not yet cached
    const missing = lib.artists.map(a => a.name).filter(n => !(n in artistGenres));
    if (missing.length > 0) {
      // Fetch in batches of 5 to avoid rate limits
      for (let i = 0; i < missing.length; i += 5) {
        const batch = missing.slice(i, i + 5);
        const results = await Promise.all(batch.map(name => fetchItunesGenre(name)));
        batch.forEach((name, j) => { artistGenres[name] = results[j] || 'Other'; });
        if (i + 5 < missing.length) await new Promise(r => setTimeout(r, 300));
      }
      saveGenresCache(artistGenres);
    }

    // Build genre → artist list map
    const genreMap = {};
    for (const artist of lib.artists) {
      const genre = artistGenres[artist.name] || 'Other';
      if (!genreMap[genre]) genreMap[genre] = [];
      genreMap[genre].push(artist.name);
    }
    res.json({ genreMap, artistGenres });
  } catch (e) {
    console.error('[api/genres]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Force re-fetch genres (clear cache)
app.post('/api/genres/refresh', (req, res) => {
  try { fs.unlinkSync(GENRES_FILE); } catch {}
  res.json({ ok: true });
});

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

// ── CUE sheet parser ──────────────────────────────────────────────────────────
function parseCueSheet(text) {
  const src = text.replace(/^\uFEFF/, ''); // strip BOM
  let albumTitle = '', albumPerformer = '';
  let fileCount = 0;
  const chapters = [];
  let curTrackNo = -1, curTitle = null, curPerformer = null, curStartMs = -1;

  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^FILE /i.test(line))                       { fileCount++; }
    else if (/^TRACK /i.test(line)) {
      if (curTrackNo >= 0 && curStartMs >= 0)
        chapters.push({ trackNo: curTrackNo, title: curTitle || `Track ${curTrackNo}`, performer: curPerformer || null, startMs: curStartMs });
      curTrackNo  = parseInt(line.replace(/^TRACK\s+/i, '').split(/\s+/)[0], 10) || -1;
      curTitle = null; curPerformer = null; curStartMs = -1;
    }
    else if (/^TITLE /i.test(line)) {
      const t = line.replace(/^TITLE\s+/i, '').replace(/^"|"$/g, '');
      if (curTrackNo < 0) albumTitle = t; else curTitle = t;
    }
    else if (/^PERFORMER /i.test(line)) {
      const p = line.replace(/^PERFORMER\s+/i, '').replace(/^"|"$/g, '');
      if (curTrackNo < 0) albumPerformer = p; else curPerformer = p;
    }
    else if (/^INDEX 01 /i.test(line)) {
      const parts = line.replace(/^INDEX 01\s+/i, '').trim().split(':');
      const mm = parseInt(parts[0] || '0', 10);
      const ss = parseInt(parts[1] || '0', 10);
      const ff = parseInt(parts[2] || '0', 10);
      curStartMs = mm * 60000 + ss * 1000 + Math.round(ff * 1000 / 75);
    }
  }
  if (curTrackNo >= 0 && curStartMs >= 0)
    chapters.push({ trackNo: curTrackNo, title: curTitle || `Track ${curTrackNo}`, performer: curPerformer || null, startMs: curStartMs });

  // Attach endMs = next chapter's startMs (last track gets null = play to end)
  for (let i = 0; i < chapters.length; i++)
    chapters[i].endMs = chapters[i + 1]?.startMs ?? null;

  if (chapters.length === 0) return null;
  return { albumTitle, albumPerformer, chapters, isSingleFile: fileCount <= 1 };
}

// ── Download a small B2 text file (CUE sheets, NFO, etc.) ─────────────────────
function fetchB2TextRaw(filePath, dlUrl, dlToken) {
  return new Promise((resolve) => {
    const encoded = filePath.split('/').map(encodeURIComponent).join('/');
    const url = `${dlUrl}/file/${B2_BUCKET}/${encoded}?Authorization=${dlToken}`;
    https.get(url, { headers: { 'User-Agent': 'AtomicBlast/1.0' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve(d));
    }).on('error', () => resolve(null));
  });
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
  let prev;
  do { prev = s; s = s.replace(/\s*[\(\[][^\)\]]{1,80}[\)\]]\s*$/, '').trim(); } while (s !== prev);
  s = s.replace(/\s*[-–]\s*(FLAC|MP3|AAC|OGG|WMA|WAV|ALAC|320|V0|V2)\s*$/i, '').trim();
  return s.trim() || name;
}

function isBareYear(s) { return /^\d{4}$/.test(s.trim()); }

function parseArtistAlbumFolder(folderName) {
  let s = stripFolderTags(folderName);

  // Handle "Artist -YEAR- Album" (compact year flanked by dashes, no surrounding spaces)
  // e.g. "AFI -1999- Black Sails In The Sunset" → artist="AFI", album="Black Sails In The Sunset"
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
  if (parts.length === 4 && isBareYear(folder1)) {
    const { artist, album } = parseArtistAlbumFolder(parts[2]);
    return { artistName: artist, albumName: album, filename: parts[3] };
  }
  if (parts.length === 4) {
    const { artist: a1, album: al1 } = parseArtistAlbumFolder(folder1);
    const { album: al2 } = parseArtistAlbumFolder(parts[2]);
    if (isBareYear(folder1)) {
      const { artist: a2, album: alb2 } = parseArtistAlbumFolder(parts[2]);
      return { artistName: a2, albumName: alb2, filename: parts[3] };
    }
    // If the sub-folder is a disc/cd/bonus segment, use the artist folder as the album name
    if (SKIP_SEGMENTS.test(parts[2])) {
      return { artistName: a1, albumName: al1 || a1, filename: parts[3] };
    }
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

  // ── Download and parse all CUE files (in parallel, 8 at a time) ─────────────
  const cueDataMap = new Map(); // folderPath → ParsedCue
  const cueEntries = [...cueMap.entries()]; // [folderPath, cuePath]
  const CUE_BATCH  = 8;
  for (let i = 0; i < cueEntries.length; i += CUE_BATCH) {
    const batch = cueEntries.slice(i, i + CUE_BATCH);
    await Promise.all(batch.map(async ([folderPath, cuePath]) => {
      const text = await fetchB2TextRaw(cuePath, dlUrl, dlToken);
      if (!text) return;
      const parsed = parseCueSheet(text);
      if (parsed) cueDataMap.set(folderPath, parsed);
    }));
  }
  console.log(`[scan-b2-music] parsed ${cueDataMap.size}/${cueEntries.length} CUE sheets`);

  const artistMap   = new Map();
  const artistNames = new Map();

  for (const f of audioEntries) {
    const { artistName, albumName, filename } = f._parsed;
    const ext      = path.extname(filename).toLowerCase();
    const baseName = path.basename(filename, ext);

    // Filename-based fallback track number / title
    let trackNo = 0, title = baseName;
    const trackMatch = baseName.match(/^(\d+)\s*[-–.]\s+(.+)$/);
    if (trackMatch) { trackNo = parseInt(trackMatch[1], 10); title = trackMatch[2]; }

    const artistKey = artistName.toLowerCase();
    if (!artistNames.has(artistKey)) artistNames.set(artistKey, artistName);
    if (!artistMap.has(artistKey)) artistMap.set(artistKey, new Map());
    const albumMap = artistMap.get(artistKey);
    if (!albumMap.has(albumName)) albumMap.set(albumName, []);
    albumMap.get(albumName).push({
      title, path: f.fileName, fileId: f.fileId, size: f.contentLength, ext, trackNo,
    });
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
    for (const [albumName, rawTracks] of [...albumMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      rawTracks.sort((a, b) => (a.trackNo || 999) - (b.trackNo || 999) || a.path.localeCompare(b.path));
      const coverKey  = artistName + '\x00' + albumName;
      const coverKey2 = artistKey  + '\x00' + albumName;
      const coverPath = coverMap.get(coverKey) || coverMap.get(coverKey2) || null;
      const folderPath = rawTracks[0] ? rawTracks[0].path.substring(0, rawTracks[0].path.lastIndexOf('/')) : '';
      const cuePath    = cueMap.get(folderPath) || null;
      const cueData    = cueDataMap.get(folderPath) || null;

      let tracks = rawTracks;
      let resolvedAlbumName = albumName;

      if (cueData) {
        // Use CUE album title if it looks real (non-empty, doesn't duplicate the folder name)
        if (cueData.albumTitle && cueData.albumTitle.trim()) resolvedAlbumName = cueData.albumTitle.trim();

        if (cueData.isSingleFile && rawTracks.length === 1) {
          // ── Single-file FLAC + CUE: expand into virtual chapter tracks ──────
          const audioFile = rawTracks[0];
          tracks = cueData.chapters.map(ch => ({
            title:       ch.title,
            performer:   ch.performer || cueData.albumPerformer || null,
            path:        audioFile.path,
            fileId:      audioFile.fileId,
            size:        audioFile.size,
            ext:         audioFile.ext,
            trackNo:     ch.trackNo,
            cueStartMs:  ch.startMs,
            cueEndMs:    ch.endMs,
            isCueChapter: true,
          }));
        } else {
          // ── Multi-file + CUE: use CUE metadata to name/annotate tracks ──────
          // Build a map of trackNo → CUE chapter
          const cueByNo = new Map(cueData.chapters.map(ch => [ch.trackNo, ch]));
          tracks = rawTracks.map(t => {
            const ch = cueByNo.get(t.trackNo);
            if (!ch) return t;
            return {
              ...t,
              title:      ch.title || t.title,
              performer:  ch.performer || cueData.albumPerformer || null,
            };
          });
        }
      }

      albums.push({ name: resolvedAlbumName, coverPath, tracks, cuePath });
    }
    // Propagate cover art: albums without art (e.g. bare Disc 1/2 folders) borrow from siblings
    const fallbackCover = albums.find(a => a.coverPath)?.coverPath || null;
    if (fallbackCover) {
      for (const album of albums) { if (!album.coverPath) album.coverPath = fallbackCover; }
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

// ── Stream endpoint ───────────────────────────────────────────────────────────
app.get('/stream', async (req, res) => {
  const { file, quality = 'high' } = req.query;
  if (!file) return res.status(400).json({ error: 'Missing file param' });

  const preset = QUALITY_PRESETS[quality];
  const fileUrl = `${B2_BUCKET_URL}/${encodeURIComponent(file)}`;
  const authString = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64');
  const headers = { Authorization: `Basic ${authString}` };

  if (quality === 'flac' || preset === null) {
    res.setHeader('Content-Type', 'audio/flac');
    res.setHeader('Transfer-Encoding', 'chunked');
    fetchStream(fileUrl, headers, (err, stream) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch from B2' });
      stream.pipe(res);
    });
    return;
  }

  const isLow = quality === 'low';
  const codec = isLow ? 'aac' : 'libmp3lame';
  const mimeType = isLow ? 'audio/aac' : 'audio/mpeg';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Transfer-Encoding', 'chunked');

  fetchStream(fileUrl, headers, (err, stream) => {
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
  proto.get(url, { headers }, (response) => {
    if (response.statusCode !== 200) return cb(new Error(`B2 returned ${response.statusCode}`));
    cb(null, response);
  }).on('error', cb);
}

// ── Spotify status ────────────────────────────────────────────────────────────
app.get('/api/spotify/status', (req, res) => {
  res.json({
    configured: !!(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET),
    lastfm:     !!LASTFM_API_KEY,
  });
});

// ── Artist metadata (Spotify + optional Last.fm bio) ─────────────────────────
// Returns: { image, genres, followers, popularity, similar, spotifyUrl,
//            bio, tags, formed, country, lastfmUrl }
app.get('/api/artist-meta', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  const cacheKey = name.toLowerCase();
  const cached = _artistMetaCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return res.json(cached.data);

  const result = {};

  // ── Spotify ──────────────────────────────────────────────────────────────
  try {
    const sr = await spotifySearch('artist', name);
    const artist = sr?.artists?.items?.[0];
    if (artist) {
      // Pick best image (largest)
      const images = (artist.images || []).sort((a, b) => (b.width || 0) - (a.width || 0));
      result.image      = images[0]?.url || null;
      result.genres     = artist.genres || [];
      result.followers  = artist.followers?.total ?? null;
      result.popularity = artist.popularity ?? null;
      result.spotifyId  = artist.id;
      result.spotifyUrl = artist.external_urls?.spotify || null;
      result.listeners  = result.followers != null
        ? result.followers.toLocaleString() + ' followers'
        : null;

      // Related artists
      if (artist.id) {
        try {
          const relRes = await spotifyGet(`/artists/${artist.id}/related-artists`);
          result.similar = (relRes?.artists || []).slice(0, 8).map(a => a.name);
        } catch { result.similar = []; }
      }
    }
  } catch (e) {
    if (e.message.includes('not configured')) {
      return res.status(503).json({ error: e.message });
    }
    console.error('[api/artist-meta] Spotify error:', e.message);
  }

  // ── Last.fm (bio, tags, formed, country) ──────────────────────────────────
  if (LASTFM_API_KEY) {
    try {
      const lfUrl = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${LASTFM_API_KEY}&format=json&autocorrect=1`;
      const lf = await httpsGetJSON(lfUrl);
      const a = lf?.artist;
      if (a) {
        // Bio — strip Last.fm boilerplate link
        const bioContent = a.bio?.content || '';
        const bioClean = bioContent.replace(/<a href="https?:\/\/www\.last\.fm[^"]*">[^<]*<\/a>/gi, '').replace(/<[^>]+>/g, '').trim();
        if (bioClean.length > 20) result.bio = bioClean;

        // Tags
        const lfTags = (a.tags?.tag || []).map(t => t.name).filter(Boolean);
        if (lfTags.length) result.tags = lfTags;

        // Stats
        result.lastfmListeners = a.stats?.listeners ? parseInt(a.stats.listeners, 10).toLocaleString() + ' Last.fm listeners' : null;
        result.lastfmUrl = a.url || null;

        // Use Last.fm similar if Spotify didn't give any
        if (!result.similar?.length) {
          result.similar = (a.similar?.artist || []).slice(0, 8).map(s => s.name);
        }

        // Merge tags into genres if Spotify didn't supply genres
        if (!result.genres?.length && lfTags.length) result.genres = lfTags.slice(0, 5);
      }
    } catch (e) {
      console.error('[api/artist-meta] Last.fm error:', e.message);
    }
  }

  // Use Last.fm listener count as display string if Spotify followers not available
  if (!result.listeners && result.lastfmListeners) result.listeners = result.lastfmListeners;
  // Expose genres as tags array if not separately set
  if (!result.tags?.length && result.genres?.length) result.tags = result.genres;

  _artistMetaCache.set(cacheKey, { data: result, exp: Date.now() + META_CACHE_TTL });
  res.json(result);
});

// ── Album metadata (Spotify) ──────────────────────────────────────────────────
// Returns: { name, releaseDate, releaseYear, label, totalTracks, spotifyUrl,
//            image, upc, popularity }
app.get('/api/album-meta', async (req, res) => {
  const { artist, album } = req.query;
  if (!artist || !album) return res.status(400).json({ error: 'artist and album required' });

  const cacheKey = artist.toLowerCase() + '\x00' + album.toLowerCase();
  const cached = _albumMetaCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return res.json(cached.data);

  try {
    const query = `album:${album} artist:${artist}`;
    const sr = await spotifySearch('album', query);
    const alb = sr?.albums?.items?.[0];
    if (!alb) return res.json({});

    // Fetch full album for label + popularity
    let full = null;
    try { full = await spotifyGet(`/albums/${alb.id}`); } catch {}

    const images = ((full || alb).images || []).sort((a, b) => (b.width || 0) - (a.width || 0));
    const result = {
      name:        (full || alb).name,
      releaseDate: (full || alb).release_date || null,
      releaseYear: ((full || alb).release_date || '').slice(0, 4) || null,
      label:       full?.label || null,
      totalTracks: (full || alb).total_tracks || null,
      popularity:  full?.popularity ?? null,
      spotifyUrl:  (full || alb).external_urls?.spotify || null,
      image:       images[0]?.url || null,
      upc:         full?.external_ids?.upc || null,
    };

    _albumMetaCache.set(cacheKey, { data: result, exp: Date.now() + META_CACHE_TTL });
    res.json(result);
  } catch (e) {
    if (e.message.includes('not configured')) return res.status(503).json({ error: e.message });
    console.error('[api/album-meta]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Track audio features (Spotify) ───────────────────────────────────────────
// Returns: { bpm, key, mode, energy, danceability, valence, acousticness,
//            instrumentalness, liveness, loudness, speechiness, duration_ms,
//            spotifyUrl, previewUrl }
const KEY_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];

app.get('/api/track-features', async (req, res) => {
  const { artist, title } = req.query;
  if (!artist || !title) return res.status(400).json({ error: 'artist and title required' });

  try {
    const query = `track:${title} artist:${artist}`;
    const sr = await spotifySearch('track', query);
    const track = sr?.tracks?.items?.[0];
    if (!track) return res.json({});

    // Fetch audio features for the track
    let features = null;
    try { features = await spotifyGet(`/audio-features/${track.id}`); } catch {}

    const result = {
      spotifyUrl:        track.external_urls?.spotify || null,
      previewUrl:        track.preview_url || null,
      popularity:        track.popularity  ?? null,
      explicit:          track.explicit    ?? null,
      duration_ms:       track.duration_ms ?? null,
    };

    if (features) {
      result.bpm             = features.tempo            != null ? Math.round(features.tempo) : null;
      result.key             = features.key != null && features.key >= 0 ? KEY_NAMES[features.key % 12] : null;
      result.mode            = features.mode != null ? (features.mode === 1 ? 'Major' : 'Minor') : null;
      result.energy          = features.energy          != null ? Math.round(features.energy          * 100) : null;
      result.danceability    = features.danceability    != null ? Math.round(features.danceability    * 100) : null;
      result.valence         = features.valence         != null ? Math.round(features.valence         * 100) : null;
      result.acousticness    = features.acousticness    != null ? Math.round(features.acousticness    * 100) : null;
      result.instrumentalness= features.instrumentalness!= null ? Math.round(features.instrumentalness* 100) : null;
      result.liveness        = features.liveness        != null ? Math.round(features.liveness        * 100) : null;
      result.loudness        = features.loudness        != null ? +features.loudness.toFixed(1) : null;
      result.speechiness     = features.speechiness     != null ? Math.round(features.speechiness     * 100) : null;
    }

    res.json(result);
  } catch (e) {
    if (e.message.includes('not configured')) return res.status(503).json({ error: e.message });
    console.error('[api/track-features]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Clear artist/album meta caches
app.post('/api/artist-meta/refresh', (req, res) => {
  _artistMetaCache.clear();
  _albumMetaCache.clear();
  res.json({ ok: true });
});

// ── Artist top tracks (Spotify) ───────────────────────────────────────────────
// Returns: [ { title, durationMs, popularity, explicit, previewUrl, spotifyUrl,
//              trackNumber, albumName, albumImage, isrc } ]
// Query: ?name=<artist name>  OR  ?spotifyId=<spotify artist id>
//        &market=US  (optional, defaults to US)
const _topTracksCache = new Map(); // spotifyId → { data, exp }

app.get('/api/artist-top-tracks', async (req, res) => {
  const { name, spotifyId, market = 'US' } = req.query;
  if (!name && !spotifyId) return res.status(400).json({ error: 'name or spotifyId required' });

  try {
    let artistId = spotifyId;

    if (!artistId) {
      // Resolve name → id (check artist meta cache first)
      const cacheKey = name.toLowerCase();
      const cached = _artistMetaCache.get(cacheKey);
      if (cached?.data?.spotifyId) {
        artistId = cached.data.spotifyId;
      } else {
        const sr = await spotifySearch('artist', name);
        const artist = sr?.artists?.items?.[0];
        if (!artist) return res.json([]);
        artistId = artist.id;
      }
    }

    const cacheKey = artistId + ':' + market;
    const cached = _topTracksCache.get(cacheKey);
    if (cached && Date.now() < cached.exp) return res.json(cached.data);

    const result = await spotifyGet(`/artists/${artistId}/top-tracks?market=${encodeURIComponent(market)}`);
    const tracks = (result?.tracks || []).map(t => ({
      title:       t.name,
      durationMs:  t.duration_ms ?? null,
      popularity:  t.popularity  ?? null,
      explicit:    t.explicit    ?? null,
      previewUrl:  t.preview_url || null,
      spotifyUrl:  t.external_urls?.spotify || null,
      trackNumber: t.track_number ?? null,
      discNumber:  t.disc_number  ?? null,
      albumName:   t.album?.name  || null,
      albumImage:  (t.album?.images || []).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null,
      isrc:        t.external_ids?.isrc || null,
    }));

    _topTracksCache.set(cacheKey, { data: tracks, exp: Date.now() + META_CACHE_TTL });
    res.json(tracks);
  } catch (e) {
    if (e.message.includes('not configured')) return res.status(503).json({ error: e.message });
    console.error('[api/artist-top-tracks]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Spotify recommendations ───────────────────────────────────────────────────
// Seed params (up to 5 combined): seed_artists, seed_tracks, seed_genres (CSV)
// Optional tuning: target_energy, target_tempo, target_valence, target_danceability (0-1 or BPM)
// Returns: [ { title, artist, albumName, albumImage, durationMs, popularity, explicit,
//              previewUrl, spotifyUrl, isrc } ]
app.get('/api/recommendations', async (req, res) => {
  const {
    seed_artists = '', seed_tracks = '', seed_genres = '',
    target_energy, target_tempo, target_valence, target_danceability,
    limit = '20', market = 'US',
  } = req.query;

  if (!seed_artists && !seed_tracks && !seed_genres) {
    return res.status(400).json({ error: 'At least one of seed_artists, seed_tracks, or seed_genres required' });
  }

  const params = new URLSearchParams({ limit: Math.min(parseInt(limit, 10) || 20, 100).toString(), market });
  if (seed_artists) params.set('seed_artists', seed_artists);
  if (seed_tracks)  params.set('seed_tracks',  seed_tracks);
  if (seed_genres)  params.set('seed_genres',  seed_genres);
  if (target_energy     != null) params.set('target_energy',      target_energy);
  if (target_tempo      != null) params.set('target_tempo',       target_tempo);
  if (target_valence    != null) params.set('target_valence',     target_valence);
  if (target_danceability != null) params.set('target_danceability', target_danceability);

  try {
    const result = await spotifyGet(`/recommendations?${params.toString()}`);
    const tracks = (result?.tracks || []).map(t => ({
      title:      t.name,
      artist:     (t.artists || []).map(a => a.name).join(', '),
      artistId:   t.artists?.[0]?.id || null,
      albumName:  t.album?.name || null,
      albumImage: (t.album?.images || []).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null,
      durationMs: t.duration_ms ?? null,
      popularity: t.popularity  ?? null,
      explicit:   t.explicit    ?? null,
      previewUrl: t.preview_url || null,
      spotifyUrl: t.external_urls?.spotify || null,
      spotifyId:  t.id,
      isrc:       t.external_ids?.isrc || null,
    }));
    res.json(tracks);
  } catch (e) {
    if (e.message.includes('not configured')) return res.status(503).json({ error: e.message });
    console.error('[api/recommendations]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── New releases (Spotify) ────────────────────────────────────────────────────
// Returns: [ { name, artists, releaseDate, image, spotifyUrl, totalTracks, albumType } ]
// Query: ?limit=20&country=US
const _newReleasesCache = { data: null, exp: 0 };
const NEW_RELEASES_TTL = 3 * 60 * 60 * 1000; // 3 hours

app.get('/api/new-releases', async (req, res) => {
  const { limit = '20', country = 'US' } = req.query;

  if (_newReleasesCache.data && Date.now() < _newReleasesCache.exp) {
    return res.json(_newReleasesCache.data);
  }

  try {
    const result = await spotifyGet(`/browse/new-releases?limit=${Math.min(parseInt(limit, 10) || 20, 50)}&country=${encodeURIComponent(country)}`);
    const albums = (result?.albums?.items || []).map(a => ({
      name:        a.name,
      spotifyId:   a.id,
      artists:     (a.artists || []).map(x => x.name).join(', '),
      artistIds:   (a.artists || []).map(x => x.id),
      releaseDate: a.release_date || null,
      image:       (a.images || []).sort((x, y) => (y.width || 0) - (x.width || 0))[0]?.url || null,
      spotifyUrl:  a.external_urls?.spotify || null,
      totalTracks: a.total_tracks ?? null,
      albumType:   a.album_type  || null,
    }));

    _newReleasesCache.data = albums;
    _newReleasesCache.exp  = Date.now() + NEW_RELEASES_TTL;
    res.json(albums);
  } catch (e) {
    if (e.message.includes('not configured')) return res.status(503).json({ error: e.message });
    console.error('[api/new-releases]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Generic Spotify search proxy ──────────────────────────────────────────────
// Mirrors the Spotify /search endpoint but strips auth details from client.
// Query: ?q=<query>&type=track,artist,album&limit=10&market=US&offset=0
// Returns raw Spotify search result shaped per type:
//   artists: [ { name, id, genres, popularity, followers, image, spotifyUrl } ]
//   albums:  [ { name, id, artists, releaseDate, image, spotifyUrl, totalTracks, albumType } ]
//   tracks:  [ { title, id, artist, artistId, albumName, albumImage, durationMs,
//                popularity, explicit, previewUrl, spotifyUrl, isrc } ]
app.get('/api/spotify/search', async (req, res) => {
  const { q, type = 'track,artist,album', limit = '10', market, offset = '0' } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });

  const params = new URLSearchParams({
    q,
    type,
    limit:  Math.min(parseInt(limit,  10) || 10, 50).toString(),
    offset: Math.max(parseInt(offset, 10) || 0, 0).toString(),
  });
  if (market) params.set('market', market);

  try {
    const raw = await spotifyGet(`/search?${params.toString()}`);

    const out = {};

    if (raw.artists) {
      out.artists = (raw.artists.items || []).map(a => ({
        name:       a.name,
        spotifyId:  a.id,
        genres:     a.genres || [],
        popularity: a.popularity ?? null,
        followers:  a.followers?.total ?? null,
        image:      (a.images || []).sort((x, y) => (y.width || 0) - (x.width || 0))[0]?.url || null,
        spotifyUrl: a.external_urls?.spotify || null,
      }));
    }

    if (raw.albums) {
      out.albums = (raw.albums.items || []).map(a => ({
        name:        a.name,
        spotifyId:   a.id,
        artists:     (a.artists || []).map(x => x.name).join(', '),
        artistIds:   (a.artists || []).map(x => x.id),
        releaseDate: a.release_date || null,
        image:       (a.images || []).sort((x, y) => (y.width || 0) - (x.width || 0))[0]?.url || null,
        spotifyUrl:  a.external_urls?.spotify || null,
        totalTracks: a.total_tracks ?? null,
        albumType:   a.album_type  || null,
      }));
    }

    if (raw.tracks) {
      out.tracks = (raw.tracks.items || []).map(t => ({
        title:      t.name,
        spotifyId:  t.id,
        artist:     (t.artists || []).map(a => a.name).join(', '),
        artistId:   t.artists?.[0]?.id || null,
        albumName:  t.album?.name || null,
        albumImage: (t.album?.images || []).sort((x, y) => (y.width || 0) - (x.width || 0))[0]?.url || null,
        durationMs: t.duration_ms ?? null,
        popularity: t.popularity  ?? null,
        explicit:   t.explicit    ?? null,
        previewUrl: t.preview_url || null,
        spotifyUrl: t.external_urls?.spotify || null,
        isrc:       t.external_ids?.isrc    || null,
      }));
    }

    res.json(out);
  } catch (e) {
    if (e.message.includes('not configured')) return res.status(503).json({ error: e.message });
    console.error('[api/spotify/search]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`AtomicBlast proxy running on port ${PORT}`));
