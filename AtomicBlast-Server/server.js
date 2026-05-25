const express = require('express');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const STATE_DIR = process.env.STATE_DIR || __dirname;
const B2_HTTP_AGENT = new https.Agent({ keepAlive: true, maxSockets: 64 });
fs.mkdirSync(STATE_DIR, { recursive: true });
function stateFile(name) {
  return path.join(STATE_DIR, name);
}
function envValue(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.startsWith('TODO_SET_') || trimmed === '__unset__') return fallback;
  return trimmed;
}

// B2 config
const B2_BUCKET_URL = envValue('B2_BUCKET_URL', 'https://s3.us-east-005.backblazeb2.com/SpAtomify');
const B2_KEY_ID     = envValue('B2_KEY_ID', '0055a9c537f296d0000000014');
const B2_APP_KEY    = envValue('B2_APP_KEY', 'K005XUecoGa52VpCS6Hb2qx45iGZ/jc');
const B2_BUCKET     = envValue('B2_BUCKET', 'SpAtomify');
const B2_PREFIX     = envValue('B2_PREFIX', 'Music/');

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
  const host = String(req.headers.host || '').toLowerCase();
  if (host === '23.95.216.131:3000' || host === '23.95.216.131') {
    return res.redirect(308, PUBLIC_ORIGIN + req.originalUrl);
  }
  next();
});
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Account auth ─────────────────────────────────────────────────────────────
const AUTH_SUPPORT_EMAIL = envValue('AUTH_SUPPORT_EMAIL', 'adammharvey+AtomicBlast@gmail.com');
const GOOGLE_CLIENT_ID   = envValue('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = envValue('GOOGLE_CLIENT_SECRET');
const PUBLIC_ORIGIN = envValue('PUBLIC_ORIGIN', 'https://blast.atomicradius.app').replace(/\/+$/, '');
const GOOGLE_REDIRECT_URI = envValue('GOOGLE_REDIRECT_URI', `${PUBLIC_ORIGIN}/api/auth/google/callback`);
const ACCOUNTS_FILE      = stateFile('accounts.json');
const PASSWORD_ITERATIONS = 210000;
const googleOAuthStates = new Map();

function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch { return { users: [] }; }
}
function saveAccounts(accounts) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
}
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name || '',
    provider: user.provider || 'email',
    picture: user.picture || '',
  };
}
function normalizeEmail(email) {
  return String(email || '').trim();
}
function normalizePassword(password) {
  return String(password || '');
}
function validatePassword(password) {
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}
function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  const [, , salt, expected] = parts;
  if (!Number.isFinite(iterations) || iterations < 100000 || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function upsertAccount(profile) {
  const accounts = loadAccounts();
  const email = normalizeEmail(profile.email);
  if (!email || !email.includes('@')) throw new Error('Valid email required');
  const now = new Date().toISOString();
  let user = accounts.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    user = {
      id: 'usr_' + Buffer.from(email.toLowerCase()).toString('base64url').slice(0, 22),
      email,
      createdAt: now,
    };
    accounts.users.push(user);
  }
  Object.assign(user, {
    name: profile.name || user.name || email.split('@')[0],
    provider: profile.provider || user.provider || 'email',
    picture: profile.picture || user.picture || '',
    lastLoginAt: now,
  });
  saveAccounts(accounts);
  return publicUser(user);
}
function emailPasswordLogin({ email, password, name }) {
  const accounts = loadAccounts();
  email = normalizeEmail(email);
  password = normalizePassword(password);
  if (!email || !email.includes('@')) throw new Error('Valid email required');
  validatePassword(password);

  const now = new Date().toISOString();
  let user = accounts.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (user?.passwordHash) {
    if (!verifyPassword(password, user.passwordHash)) throw new Error('Incorrect email or password.');
  } else if (user) {
    user.passwordHash = hashPassword(password);
  } else {
    user = {
      id: 'usr_' + Buffer.from(email.toLowerCase()).toString('base64url').slice(0, 22),
      email,
      createdAt: now,
      passwordHash: hashPassword(password),
    };
    accounts.users.push(user);
  }

  Object.assign(user, {
    name: name || user.name || email.split('@')[0],
    provider: user.provider || 'email',
    picture: user.picture || '',
    lastLoginAt: now,
  });
  saveAccounts(accounts);
  return publicUser(user);
}

app.get('/api/auth/config', (req, res) => {
  const googleRedirectConfigured = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
  res.json({
    googleClientId: GOOGLE_CLIENT_ID,
    googleRedirectUri: GOOGLE_REDIRECT_URI,
    supportEmail: AUTH_SUPPORT_EMAIL,
    providers: {
      google: googleRedirectConfigured,
      apple: false,
      microsoft: false,
      email: true,
      emailPassword: true,
    },
  });
});

app.post('/api/auth/email-login', (req, res) => {
  try {
    const user = emailPasswordLogin({
      email: req.body?.email,
      password: req.body?.password,
      name: req.body?.name || 'AtomicBlast',
    });
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

function htmlResponse(res, body) {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.send(body);
}

function authReturnPage({ user, error, returnMode }) {
  const payload = JSON.stringify({ type: 'atomicblast-google-auth', user: user || null, error: error || null });
  const bodyText = error ? 'Google sign-in could not finish.' : 'Google sign-in complete. You can return to AtomicBlast.';
  const shouldClose = returnMode === 'popup';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AtomicBlast Sign In</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#050806; color:#eef7ef; font:16px system-ui,-apple-system,Segoe UI,sans-serif; }
    main { max-width:460px; padding:28px; text-align:center; }
    h1 { font-size:24px; margin:0 0 10px; }
    p { color:#a8b4aa; line-height:1.5; }
    button { margin-top:18px; min-height:44px; border:0; border-radius:8px; background:#4ade80; color:#041006; font-weight:800; padding:0 18px; }
  </style>
</head>
<body>
  <main>
    <h1>${error ? 'Sign-in failed' : 'Signed in'}</h1>
    <p>${bodyText}</p>
    ${error ? `<p>${String(error).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</p>` : ''}
    <button type="button" onclick="${shouldClose ? 'window.close()' : `location.href='${PUBLIC_ORIGIN}'`}">${shouldClose ? 'Close this page' : 'Open AtomicBlast'}</button>
  </main>
  <script>
    const payload = ${payload};
    try {
      if (payload.user) localStorage.setItem('atomicblast.user', JSON.stringify(payload.user));
      localStorage.setItem('atomicblast.googleAuthResult', JSON.stringify({ payload, ts: Date.now() }));
      if (window.opener) window.opener.postMessage(payload, '${PUBLIC_ORIGIN}');
      try {
        const channel = new BroadcastChannel('atomicblast-auth');
        channel.postMessage(payload);
        channel.close();
      } catch (_) {}
    } catch (_) {}
    setTimeout(() => {
      try {
        if (${shouldClose ? 'true' : 'false'}) {
          window.close();
          document.querySelector('p').textContent = 'You are signed in. Close this page and return to AtomicBlast.';
        } else {
          location.replace('${PUBLIC_ORIGIN}');
        }
      } catch (_) {}
    }, 900);
  </script>
</body>
</html>`;
}

app.get('/api/auth/google/start', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return htmlResponse(res, authReturnPage({ error: 'Google OAuth is not fully configured on the server.', returnMode: req.query.return }));
  }
  const state = crypto.randomBytes(18).toString('base64url');
  const nonce = crypto.randomBytes(18).toString('base64url');
  googleOAuthStates.set(state, {
    returnMode: req.query.return === 'popup' ? 'popup' : '',
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  res.cookie?.('atomicblast_google_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: PUBLIC_ORIGIN.startsWith('https://'),
    maxAge: 10 * 60 * 1000,
  });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

app.get('/api/auth/google/callback', async (req, res) => {
  const stateInfo = googleOAuthStates.get(String(req.query.state || '')) || {};
  googleOAuthStates.delete(String(req.query.state || ''));
  const returnMode = stateInfo.expiresAt && stateInfo.expiresAt > Date.now() ? stateInfo.returnMode : '';
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth is not fully configured on the server.');
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const code = String(req.query.code || '');
    if (!code) throw new Error('Google did not return an authorization code.');
    const tokenRes = await httpsPostForm('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString());
    if (!tokenRes.id_token) throw new Error('Google did not return an ID token.');
    const tokenInfo = await httpsGetJSON('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tokenRes.id_token));
    if (tokenInfo.aud !== GOOGLE_CLIENT_ID) throw new Error('Google audience mismatch');
    if (tokenInfo.email_verified !== 'true' && tokenInfo.email_verified !== true) throw new Error('Google email is not verified');
    const user = upsertAccount({
      email: tokenInfo.email,
      name: tokenInfo.name,
      picture: tokenInfo.picture,
      provider: 'google',
    });
    htmlResponse(res, authReturnPage({ user, returnMode }));
  } catch (e) {
    htmlResponse(res, authReturnPage({ error: e.message || 'Google sign-in failed', returnMode }));
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) return res.status(501).json({ ok: false, error: 'GOOGLE_CLIENT_ID is not configured' });
    const credential = req.body?.credential;
    if (!credential) return res.status(400).json({ ok: false, error: 'Google credential required' });
    const tokenInfo = await httpsGetJSON('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (tokenInfo.aud !== GOOGLE_CLIENT_ID) return res.status(401).json({ ok: false, error: 'Google audience mismatch' });
    if (tokenInfo.email_verified !== 'true' && tokenInfo.email_verified !== true) return res.status(401).json({ ok: false, error: 'Google email is not verified' });
    const user = upsertAccount({
      email: tokenInfo.email,
      name: tokenInfo.name,
      picture: tokenInfo.picture,
      provider: 'google',
    });
    res.json({ ok: true, user });
  } catch (e) {
    res.status(401).json({ ok: false, error: e.message || 'Google sign-in failed' });
  }
});

const WINDOWS_DOWNLOAD_FILE = path.join(__dirname, 'public', 'downloads', 'install-atomicblast-windows.ps1');

app.get(['/download', '/download/windows'], (req, res) => {
  if (!fs.existsSync(WINDOWS_DOWNLOAD_FILE)) return res.status(404).send('Windows download is not available.');
  res.download(WINDOWS_DOWNLOAD_FILE, 'install-atomicblast-windows.ps1');
});

// Serve web app static files
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/\.(?:html)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));

// ── Favorites storage ─────────────────────────────────────────────────────────
const FAVORITES_FILE = stateFile('favorites.json');
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
const PLAYLISTS_FILE = stateFile('playlists.json');
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
const PLAYBACK_STATE_FILE = stateFile('playback-state.json');
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

// ── Genre cache/database ─────────────────────────────────────────────────────
const GENRES_FILE = stateFile('genres.json');
const GENRE_DB_FILE = stateFile('genre-db.json');
const GENRE_LOOKUP_BATCH_SIZE = Math.max(1, Math.min(parseInt(envValue('GENRE_LOOKUP_BATCH_SIZE', '5'), 10) || 5, 10));
const GENRE_LOOKUP_LIMIT = Math.max(0, parseInt(envValue('GENRE_LOOKUP_LIMIT', '80'), 10) || 80);
const GENRE_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const GENRE_UNRESOLVED_TTL_MS = 14 * 24 * 60 * 60 * 1000;
function loadGenresCache() {
  try { return JSON.parse(fs.readFileSync(GENRES_FILE, 'utf8')); } catch { return {}; }
}
function saveGenresCache(data) {
  try { fs.writeFileSync(GENRES_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}
function emptyGenreDb() {
  return {
    schema: 1,
    updatedAt: null,
    artists: {},
    albums: {},
    tracks: {},
    manual: { artists: {}, albums: {}, tracks: {} },
  };
}
function loadGenreDb() {
  try {
    const db = JSON.parse(fs.readFileSync(GENRE_DB_FILE, 'utf8'));
    return {
      ...emptyGenreDb(),
      ...db,
      artists: db.artists || {},
      albums: db.albums || {},
      tracks: db.tracks || {},
      manual: {
        artists: db.manual?.artists || {},
        albums: db.manual?.albums || {},
        tracks: db.manual?.tracks || {},
      },
    };
  } catch {
    return emptyGenreDb();
  }
}
function saveGenreDb(db) {
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(GENRE_DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}
function genreKey(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function albumGenreKey(artist, album) {
  return genreKey(artist) + '\x00' + genreKey(album);
}
function trackGenreKey(filePath) {
  return String(filePath || '').trim();
}
function normalizeGenreName(value) {
  let g = String(value || '').replace(/\s+/g, ' ').trim();
  if (!g || /^music$/i.test(g)) return '';
  g = g.replace(/\b(escape room|grave wave|permanent wave|metropopolis|stomp and holler)\b/ig, '').replace(/\s+/g, ' ').trim();
  if (!g) return '';
  return g.split(' ').map(part => {
    if (/^(r&b|edm|emo|oi!|uk|us|idm)$/i.test(part)) return part.toUpperCase();
    if (/^(and|or|the|of)$/i.test(part)) return part.toLowerCase();
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join(' ');
}
function simplifyGenreName(value) {
  const g = String(value || '').toLowerCase();
  const rules = [
    ['Punk', /\b(punk|hardcore|emo|skate punk|pop punk|post-hardcore)\b/],
    ['Metal', /\b(metal|grindcore|deathcore|metalcore|doom|blackgaze|thrash)\b/],
    ['Hip-Hop/Rap', /\b(hip hop|rap|trap|boom bap)\b/],
    ['Electronic', /\b(electronic|edm|techno|house|trance|dubstep|drum and bass|ambient|idm|synth)\b/],
    ['R&B/Soul', /\b(r&b|soul|funk|motown)\b/],
    ['Reggae', /\b(reggae|ska|dub|dancehall|rocksteady)\b/],
    ['Country', /\b(country|americana|bluegrass|honky tonk)\b/],
    ['Jazz', /\b(jazz|bebop|swing|fusion)\b/],
    ['Classical', /\b(classical|orchestra|chamber|baroque|opera)\b/],
    ['Folk', /\b(folk|singer-songwriter)\b/],
    ['Pop', /\b(pop|dance pop|synthpop)\b/],
    ['Alternative', /\b(alternative|indie|shoegaze|post-rock|noise pop|britpop)\b/],
    ['Rock', /\b(rock|grunge|garage|psychedelic|post-punk|new wave)\b/],
  ];
  for (const [name, re] of rules) if (re.test(g)) return name;
  return normalizeGenreName(value);
}
function genreRecord(genre, source, confidence, extra = {}) {
  const normalized = simplifyGenreName(genre);
  return {
    genre: normalized || 'Other',
    genres: normalized ? [normalized] : [],
    source,
    confidence,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}
function genreRecordIsFresh(record) {
  if (!record?.updatedAt) return false;
  const ttl = record.genre === 'Other' ? GENRE_UNRESOLVED_TTL_MS : GENRE_CACHE_TTL_MS;
  return Date.now() - Date.parse(record.updatedAt) < ttl;
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
const SPOTIFY_CLIENT_ID     = envValue('SPOTIFY_CLIENT_ID');
const SPOTIFY_CLIENT_SECRET = envValue('SPOTIFY_CLIENT_SECRET');
const LASTFM_API_KEY        = envValue('LASTFM_API_KEY');

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

async function fetchSpotifyArtistGenres(artistName) {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return [];
  const sr = await spotifySearch('artist', artistName);
  const artist = sr?.artists?.items?.[0];
  return (artist?.genres || []).filter(Boolean);
}

async function fetchLastFmArtistGenres(artistName) {
  if (!LASTFM_API_KEY) return [];
  const lfUrl = `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&artist=${encodeURIComponent(artistName)}&api_key=${LASTFM_API_KEY}&format=json&autocorrect=1`;
  const lf = await httpsGetJSON(lfUrl);
  return (lf?.toptags?.tag || [])
    .filter(t => Number(t.count || 0) > 0 || t.name)
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
    .map(t => t.name)
    .filter(Boolean);
}

function pickGenreCandidate(candidates) {
  for (const candidate of candidates || []) {
    const normalized = simplifyGenreName(candidate);
    if (normalized) return normalized;
  }
  return '';
}

async function resolveArtistGenre(artistName) {
  const spotifyGenres = await fetchSpotifyArtistGenres(artistName).catch(e => {
    console.error('[genres] Spotify genre lookup failed for', artistName + ':', e.message);
    return [];
  });
  const spotifyPick = pickGenreCandidate(spotifyGenres);
  if (spotifyPick) return genreRecord(spotifyPick, 'spotify', 0.9, { rawGenres: spotifyGenres.slice(0, 8) });

  const lastFmGenres = await fetchLastFmArtistGenres(artistName).catch(e => {
    console.error('[genres] Last.fm genre lookup failed for', artistName + ':', e.message);
    return [];
  });
  const lastFmPick = pickGenreCandidate(lastFmGenres);
  if (lastFmPick) return genreRecord(lastFmPick, 'lastfm', 0.75, { rawGenres: lastFmGenres.slice(0, 8) });

  const itunesGenre = await fetchItunesGenre(artistName);
  if (itunesGenre) return genreRecord(itunesGenre, 'itunes', 0.55, { rawGenres: [itunesGenre] });

  return genreRecord('Other', 'unresolved', 0);
}

function flattenLibraryAlbums(lib) {
  const albums = [];
  for (const artist of lib.artists || []) {
    for (const album of artist.albums || []) albums.push({ artist, album });
  }
  return albums;
}

function flattenLibraryTracks(lib) {
  const tracks = [];
  for (const artist of lib.artists || []) {
    for (const album of artist.albums || []) {
      for (const track of album.tracks || []) tracks.push({ artist, album, track });
    }
  }
  return tracks;
}

function manualGenreRecord(value, source = 'manual') {
  if (!value) return null;
  return genreRecord(value.genre || value, source, 1, {
    updatedAt: value.updatedAt || new Date().toISOString(),
    note: value.note || undefined,
  });
}

function resolveStoredGenreForTrack(db, artist, album, track) {
  const trackManual = manualGenreRecord(db.manual.tracks[trackGenreKey(track.path)]);
  if (trackManual) return trackManual;
  const albumManual = manualGenreRecord(db.manual.albums[albumGenreKey(artist.name, album.name)]);
  if (albumManual) return albumManual;
  const artistManual = manualGenreRecord(db.manual.artists[genreKey(artist.name)]);
  if (artistManual) return artistManual;
  return db.tracks[trackGenreKey(track.path)]
    || db.albums[albumGenreKey(artist.name, album.name)]
    || db.artists[genreKey(artist.name)]
    || genreRecord('Other', 'unresolved', 0);
}

async function updateGenreDbForLibrary(lib, options = {}) {
  const force = !!options.force;
  const lookupLimit = Number.isFinite(options.lookupLimit) ? options.lookupLimit : GENRE_LOOKUP_LIMIT;
  const db = options.db || loadGenreDb();
  const artists = lib.artists || [];
  const missing = artists.filter(artist => {
    const key = genreKey(artist.name);
    if (db.manual.artists[key]) return false;
    return force || !genreRecordIsFresh(db.artists[key]);
  });
  const selected = lookupLimit < 0 ? missing : missing.slice(0, lookupLimit);

  for (let i = 0; i < selected.length; i += GENRE_LOOKUP_BATCH_SIZE) {
    const batch = selected.slice(i, i + GENRE_LOOKUP_BATCH_SIZE);
    const records = await Promise.all(batch.map(artist => resolveArtistGenre(artist.name)));
    batch.forEach((artist, index) => {
      db.artists[genreKey(artist.name)] = { ...records[index], name: artist.name };
    });
    saveGenreDb(db);
    if (i + GENRE_LOOKUP_BATCH_SIZE < selected.length) await new Promise(r => setTimeout(r, 250));
  }

  for (const { artist, album } of flattenLibraryAlbums(lib)) {
    const key = albumGenreKey(artist.name, album.name);
    if (!db.albums[key]) {
      const artistRecord = db.artists[genreKey(artist.name)];
      if (artistRecord?.genre && artistRecord.genre !== 'Other') {
        db.albums[key] = {
          genre: artistRecord.genre,
          genres: artistRecord.genres || [artistRecord.genre],
          source: 'artist-inferred',
          confidence: Math.max(0, Number(artistRecord.confidence || 0) - 0.1),
          artist: artist.name,
          album: album.name,
          updatedAt: new Date().toISOString(),
        };
      }
    }
  }

  saveGenreDb(db);
  return {
    db,
    stats: {
      artists: artists.length,
      missing: missing.length,
      lookedUp: selected.length,
      pending: Math.max(0, missing.length - selected.length),
      lookupLimit: lookupLimit < 0 ? 'all' : lookupLimit,
      updatedAt: db.updatedAt,
    },
  };
}

function buildGenreResponse(lib, db, stats = {}) {
  const genreMap = {};
  const artistGenres = {};
  const albumGenres = {};
  const trackGenres = {};
  const genreTracks = {};

  for (const artist of lib.artists || []) {
    const artistRecord = db.manual.artists[genreKey(artist.name)]
      ? manualGenreRecord(db.manual.artists[genreKey(artist.name)])
      : db.artists[genreKey(artist.name)];
    artistGenres[artist.name] = artistRecord?.genre || 'Other';
    if (!genreMap[artistGenres[artist.name]]) genreMap[artistGenres[artist.name]] = [];
    genreMap[artistGenres[artist.name]].push(artist.name);
  }

  for (const { artist, album, track } of flattenLibraryTracks(lib)) {
    const record = resolveStoredGenreForTrack(db, artist, album, track);
    const genre = record.genre || 'Other';
    const albumKey = artist.name + '\x00' + album.name;
    albumGenres[albumKey] = albumGenres[albumKey] || genre;
    trackGenres[track.path] = {
      genre,
      genres: record.genres || [genre],
      source: record.source || 'unknown',
      confidence: record.confidence || 0,
    };
    if (!genreTracks[genre]) genreTracks[genre] = [];
    genreTracks[genre].push(track.path);
  }

  for (const list of Object.values(genreMap)) list.sort((a, b) => a.localeCompare(b));
  return {
    schema: 2,
    genreMap,
    artistGenres,
    albumGenres,
    trackGenres,
    genreTracks,
    stats: {
      ...stats,
      genres: Object.keys(genreMap).length,
      tracks: Object.keys(trackGenres).length,
      dbUpdatedAt: db.updatedAt,
    },
  };
}

app.get('/api/genres', async (req, res) => {
  try {
    const lib = await scanB2Music();
    const force = req.query.force === '1' || req.query.refresh === '1';
    const lookupLimit = req.query.limit !== undefined
      ? Math.max(0, parseInt(req.query.limit, 10) || 0)
      : GENRE_LOOKUP_LIMIT;
    const { db, stats } = await updateGenreDbForLibrary(lib, { force, lookupLimit });
    res.json(buildGenreResponse(lib, db, stats));
  } catch (e) {
    console.error('[api/genres]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Force re-fetch genres (clear cache)
app.post('/api/genres/refresh', async (req, res) => {
  try {
    try { fs.unlinkSync(GENRES_FILE); } catch {}
    try { fs.unlinkSync(GENRE_DB_FILE); } catch {}
    const lib = await scanB2Music();
    const lookupLimit = req.query.limit !== undefined
      ? Math.max(0, parseInt(req.query.limit, 10) || 0)
      : -1;
    const { db, stats } = await updateGenreDbForLibrary(lib, { force: true, lookupLimit });
    res.json({ ok: true, ...buildGenreResponse(lib, db, stats) });
  } catch (e) {
    console.error('[api/genres/refresh]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/genres/manual', async (req, res) => {
  try {
    const { scope, key, artist, album, filePath, genre, note } = req.body || {};
    const cleanGenre = simplifyGenreName(genre);
    if (!cleanGenre) return res.status(400).json({ error: 'genre required' });
    const db = loadGenreDb();
    const record = { genre: cleanGenre, note: note || '', updatedAt: new Date().toISOString() };
    if (scope === 'track') db.manual.tracks[trackGenreKey(filePath || key)] = record;
    else if (scope === 'album') db.manual.albums[albumGenreKey(artist, album) || key] = record;
    else if (scope === 'artist') db.manual.artists[genreKey(artist || key)] = record;
    else return res.status(400).json({ error: 'scope must be artist, album, or track' });
    saveGenreDb(db);
    res.json({ ok: true, record });
  } catch (e) {
    console.error('[api/genres/manual]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── B2 native API helpers ─────────────────────────────────────────────────────
const B2_REQUEST_TIMEOUT_MS = 20 * 1000;

function b2Get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'AtomicBlast/1.0', ...headers },
      timeout: B2_REQUEST_TIMEOUT_MS,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 300))); } });
    });
    req.on('timeout', () => req.destroy(new Error('B2 request timed out')));
    req.on('error', reject);
  });
}

function b2Post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
                 'User-Agent': 'AtomicBlast/1.0', ...headers },
      timeout: B2_REQUEST_TIMEOUT_MS,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 300))); } });
    });
    req.on('timeout', () => req.destroy(new Error('B2 request timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── CUE disk cache — avoids re-downloading 800+ CUE files on every scan ──────
const CUE_CACHE_FILE = stateFile('cue-cache.json');
let _cueCache = null;
function loadCueCache() {
  if (_cueCache) return _cueCache;
  try { _cueCache = JSON.parse(fs.readFileSync(CUE_CACHE_FILE, 'utf8')); }
  catch { _cueCache = {}; }
  return _cueCache;
}
function saveCueCache() {
  try { fs.writeFileSync(CUE_CACHE_FILE, JSON.stringify(_cueCache)); }
  catch (e) { console.error('[cue-cache] save failed:', e.message); }
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
const COVER_FILE_NAMES_SET = new Set(['cover.jpg','folder.jpg','cover.png','folder.png','artwork.jpg','album.jpg','front.jpg','front.png']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const LOW_PRIORITY_ART_RE = /\b(back|booklet|inlay|disc|cd|media|tray|matrix|obi|sticker|label)\b/i;

function isCoverFile(name) { return COVER_FILE_NAMES_SET.has(name.toLowerCase()); }
function isAudioFile(name) { return AUDIO_EXTS.has(path.extname(name).toLowerCase()); }

function normalizeCoverText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_\W]+/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(flac|mp3|aac|ogg|wav|alac|webp|jpg|jpeg|png|cover|folder|front|artwork|album|va)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coverCandidateRank(filePath, baseName, parsed) {
  const ext = path.extname(baseName).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return 0;

  const lowerBase = baseName.toLowerCase();
  const pathParts = filePath.split('/');
  const parent = (pathParts[pathParts.length - 2] || '').toLowerCase();
  const exactName = COVER_FILE_NAMES_SET.has(lowerBase);
  if (exactName && !LOW_PRIORITY_ART_RE.test(baseName)) return parent === 'art' ? 90 : 100;

  if (LOW_PRIORITY_ART_RE.test(baseName)) return 0;

  const baseText = normalizeCoverText(baseName);
  const albumText = normalizeCoverText(parsed.albumName);
  const artistText = normalizeCoverText(parsed.artistName);
  if (albumText && baseText.includes(albumText)) return 80;
  if (artistText && albumText && baseText.includes(artistText) && baseText.split(' ').some(part => albumText.includes(part))) return 70;
  return 0;
}

function isGenericAlbumCoverKey(albumName) {
  return /^(greatest hits|best of|the best of|collection|anthology|live|unreleased|disc \d+|cd \d+)$/i.test(String(albumName || '').trim());
}

const AUDIO_QUALITY_RANK = {
  '.flac': 1000,
  '.alac': 980,
  '.ape': 960,
  '.wav': 940,
  '.aiff': 930,
  '.m4a': 700,
  '.opus': 620,
  '.ogg': 600,
  '.mp3': 520,
  '.aac': 500,
  '.wma': 430,
  '.webm': 350,
};

function normalizeDuplicateTrackTitle(title) {
  return cleanDisplayTrackTitle(title)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—]\s*(flac|wav|mp3|aac|ogg|opus|alac|aiff|ape|webm|wma)\s*$/i, '')
    .trim();
}

function cleanDisplayTrackTitle(title, expectedTrackNo = 0) {
  let cleaned = String(title || '')
    .replace(/^\s*[a-h]\d{1,2}\s*[-–—._]\s+/i, '')
    .replace(/^\s*\d{1,3}\s*[-–—._]\s+/, '')
    .replace(/^\s*0\d{1,2}\s+/, '')
    .trim();
  const trackNo = Number(expectedTrackNo || 0);
  if (trackNo > 0) {
    const repeated = new RegExp('^0*' + trackNo + '\\s+(.+)$');
    cleaned = cleaned.replace(repeated, '$1').trim();
  }
  return cleaned;
}

function compareTrackQuality(a, b) {
  const aq = AUDIO_QUALITY_RANK[String(a.ext || '').toLowerCase()] || 0;
  const bq = AUDIO_QUALITY_RANK[String(b.ext || '').toLowerCase()] || 0;
  if (aq !== bq) return aq - bq;
  const as = Number(a.size || 0);
  const bs = Number(b.size || 0);
  if (as !== bs) return as - bs;
  return String(b.path || '').localeCompare(String(a.path || ''));
}

function dedupeAlbumTracks(tracks, albumName) {
  const bestByTitle = new Map();
  for (const track of tracks) {
    const key = normalizeDuplicateTrackTitle(track.title);
    if (!key) continue;
    const existing = bestByTitle.get(key);
    if (!existing || compareTrackQuality(track, existing) > 0) bestByTitle.set(key, track);
  }

  if (bestByTitle.size === tracks.length) return tracks;

  const seen = new Set();
  const deduped = [];
  for (const track of tracks) {
    const key = normalizeDuplicateTrackTitle(track.title);
    if (!key || seen.has(key)) continue;
    const best = bestByTitle.get(key) || track;
    deduped.push(best);
    seen.add(key);
  }

  const removed = tracks.length - deduped.length;
  if (removed > 0) console.log(`[scan-b2-music] deduped ${removed} duplicate track(s) in album "${albumName}"`);
  return deduped;
}

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

const SKIP_SEGMENTS = /^(cd\s*\d+|disc\s*\d+|disk\s*\d+|art|artwork|scans|extras?|bonus)$/i;

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
let b2ScanPromise = null;
const B2_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const B2_DISK_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const B2_STALE_DISK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const B2_DOWNLOAD_AUTH_REFRESH_MS = 23 * 60 * 60 * 1000; // B2 tokens are issued for 24 hours
const B2_LIBRARY_CACHE_FILE = stateFile('b2-library-cache.json');

function loadB2LibraryCacheFromDisk() {
  try {
    const cached = JSON.parse(fs.readFileSync(B2_LIBRARY_CACHE_FILE, 'utf8'));
    if (!cached || !cached.lib || !Array.isArray(cached.lib.artists)) return null;
    return cached;
  } catch {
    return null;
  }
}

function saveB2LibraryCacheToDisk(lib) {
  try {
    fs.writeFileSync(B2_LIBRARY_CACHE_FILE, JSON.stringify({ savedAt: Date.now(), lib }));
  } catch (e) {
    console.error('[scan-b2-music] disk cache save failed:', e.message);
  }
}

function useB2DiskCacheIfAvailable(maxAgeMs = Infinity) {
  const cached = loadB2LibraryCacheFromDisk();
  if (!cached) return null;
  const age = Date.now() - Number(cached.savedAt || 0);
  if (age > maxAgeMs) return null;
  b2Cache = cached.lib;
  b2CacheTime = Number(cached.savedAt || Date.now());
  return b2Cache;
}

async function refreshB2DownloadAuthForCachedLibrary(lib) {
  const auth = await b2Auth();
  const bucketId = await b2GetBucketId(auth, B2_BUCKET);
  const dlAuthRes = await b2Post(auth.apiUrl + '/b2api/v2/b2_get_download_authorization',
    { bucketId, fileNamePrefix: '', validDurationInSeconds: 86400 },
    { Authorization: auth.authorizationToken });
  const refreshed = {
    ...lib,
    dlUrl: auth.downloadUrl,
    dlToken: dlAuthRes.authorizationToken,
    bucketName: B2_BUCKET,
  };
  b2Cache = refreshed;
  b2CacheTime = Date.now();
  saveB2LibraryCacheToDisk(refreshed);
  return refreshed;
}

function refreshB2MusicLibraryInBackground() {
  if (b2ScanPromise) return;
  b2ScanPromise = buildB2MusicLibrary()
    .then(lib => {
      b2Cache = lib;
      b2CacheTime = Date.now();
      saveB2LibraryCacheToDisk(lib);
      return lib;
    })
    .catch(e => {
      console.error('[scan-b2-music] background refresh failed:', e.message);
      return null;
    })
    .finally(() => { b2ScanPromise = null; });
}

async function buildB2MusicLibrary() {
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

    const coverRank = coverCandidateRank(filePath, baseName, parsed);
    if (coverRank > 0) {
      const key = parsed.artistName + '\x00' + parsed.albumName;
      const existing = coverMap.get(key);
      if (!existing || coverRank > existing.rank) coverMap.set(key, { path: filePath, rank: coverRank });
    } else if (ext === '.cue') {
      const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
      if (!cueMap.has(folderPath)) cueMap.set(folderPath, { path: filePath, ts: f.uploadTimestamp });
    } else if (AUDIO_EXTS.has(ext)) {
      audioEntries.push({ ...f, _parsed: parsed });
    }
  }

  const uniqueCoverByAlbum = new Map();
  for (const [key, cover] of coverMap.entries()) {
    const albumName = key.split('\x00')[1] || '';
    if (isGenericAlbumCoverKey(albumName)) continue;
    const albumKey = normalizeCoverText(albumName);
    if (!albumKey || albumKey.length < 8) continue;
    const existing = uniqueCoverByAlbum.get(albumKey);
    if (!existing) {
      uniqueCoverByAlbum.set(albumKey, { path: cover.path, ambiguous: false });
    } else if (existing.path !== cover.path) {
      existing.ambiguous = true;
    }
  }

  // ── Download and parse CUE files — disk-cached by B2 upload timestamp ────────
  const cueDataMap = new Map(); // folderPath → ParsedCue
  const cueEntries = [...cueMap.entries()]; // [folderPath, { path, ts }]
  const CUE_BATCH  = 20;
  const diskCache  = loadCueCache();
  let   cacheHits  = 0, cacheMisses = 0;
  for (let i = 0; i < cueEntries.length; i += CUE_BATCH) {
    const batch = cueEntries.slice(i, i + CUE_BATCH);
    await Promise.all(batch.map(async ([folderPath, { path: cuePath, ts }]) => {
      const cached = diskCache[cuePath];
      let text;
      if (cached && cached.ts === ts) {
        text = cached.content;
        cacheHits++;
      } else {
        text = await fetchB2TextRaw(cuePath, dlUrl, dlToken);
        if (text) { diskCache[cuePath] = { ts, content: text }; _cueCache = diskCache; }
        cacheMisses++;
      }
      if (!text) return;
      const parsed = parseCueSheet(text);
      if (parsed) cueDataMap.set(folderPath, parsed);
    }));
  }
  if (cacheMisses > 0) saveCueCache();
  console.log(`[scan-b2-music] CUE sheets: ${cueDataMap.size} parsed, ${cacheHits} cached / ${cacheMisses} fetched`);

  const artistMap   = new Map();
  const artistNames = new Map();

  for (const f of audioEntries) {
    const { artistName, albumName, filename } = f._parsed;
    const ext      = path.extname(filename).toLowerCase();
    const baseName = path.basename(filename, ext);

    // Filename-based fallback track number / title
    let trackNo = 0, title = baseName;
    const trackMatch = baseName.match(/^(?:(\d{1,3})\s*[-–—._]\s*|(\d{1,3})\s+|([a-h](\d{1,2}))\s*[-–—._]\s*)(\S.*)$/i);
    if (trackMatch) { trackNo = parseInt(trackMatch[1] || trackMatch[2] || trackMatch[4], 10); title = trackMatch[5]; }
    title = cleanDisplayTrackTitle(title, trackNo);

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
      const directCover = (coverMap.get(coverKey) || coverMap.get(coverKey2) || {}).path || null;
      const albumCover = uniqueCoverByAlbum.get(normalizeCoverText(albumName));
      const coverPath = directCover || (!albumCover?.ambiguous ? albumCover?.path : null) || null;
      const folderPath = rawTracks[0] ? rawTracks[0].path.substring(0, rawTracks[0].path.lastIndexOf('/')) : '';
      const cuePath    = (cueMap.get(folderPath) || {}).path || null;
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
            title:       cleanDisplayTrackTitle(ch.title, ch.trackNo),
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
              title:      cleanDisplayTrackTitle(ch.title || t.title, ch.trackNo || t.trackNo),
              performer:  ch.performer || cueData.albumPerformer || null,
            };
          });
        }
      }

      tracks = dedupeAlbumTracks(tracks, resolvedAlbumName);
      albums.push({ name: resolvedAlbumName, coverPath, tracks, cuePath });
    }
    artists.push({ name: artistName, albums });
  }

  const lib = { artists, dlUrl, dlToken, bucketName: B2_BUCKET };
  console.log(`[scan-b2-music] done: ${artists.length} artists`);
  return lib;
}

async function scanB2Music() {
  const now = Date.now();
  if (b2Cache && (now - b2CacheTime) < B2_CACHE_TTL_MS) return b2Cache;
  const diskCache = useB2DiskCacheIfAvailable(B2_DISK_CACHE_TTL_MS);
  if (diskCache) return diskCache;

  const staleDiskCache = useB2DiskCacheIfAvailable(B2_STALE_DISK_CACHE_TTL_MS);
  if (staleDiskCache) {
    console.error('[scan-b2-music] serving stale disk cache while refreshing in background');
    refreshB2MusicLibraryInBackground();
    return staleDiskCache;
  }

  if (b2ScanPromise) return b2ScanPromise;
  b2ScanPromise = buildB2MusicLibrary()
    .then(lib => {
      b2Cache = lib;
      b2CacheTime = Date.now();
      saveB2LibraryCacheToDisk(lib);
      return lib;
    })
    .catch(e => {
      const stale = b2Cache || useB2DiskCacheIfAvailable();
      if (stale) {
        console.error('[scan-b2-music] using stale cache after error:', e.message);
        return stale;
      }
      throw e;
    })
    .finally(() => { b2ScanPromise = null; });
  return b2ScanPromise;
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
  b2ScanPromise = null;
  try {
    const lib = await buildB2MusicLibrary();
    b2Cache = lib;
    b2CacheTime = Date.now();
    saveB2LibraryCacheToDisk(lib);
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
    https.get(url, { agent: B2_HTTP_AGENT, headers: { 'User-Agent': 'AtomicBlast/1.0' } }, (b2res) => {
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
// Build a B2 native download URL using the cached auth token
function b2DownloadUrl(filePath, dlUrl, dlToken) {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return `${dlUrl}/file/${B2_BUCKET}/${encoded}?Authorization=${dlToken}`;
}

async function b2CacheFetch() {
  const lib = await scanB2Music();
  if ((Date.now() - b2CacheTime) > B2_DOWNLOAD_AUTH_REFRESH_MS) {
    return refreshB2DownloadAuthForCachedLibrary(lib).then(refreshed => ({
      dlUrl: refreshed.dlUrl,
      dlToken: refreshed.dlToken,
    }));
  }
  return { dlUrl: lib.dlUrl, dlToken: lib.dlToken };
}

app.get('/stream', async (req, res) => {
  const { file, quality = 'high' } = req.query;
  if (!file) return res.status(400).json({ error: 'Missing file param' });

  let dlUrl, dlToken;
  try { ({ dlUrl, dlToken } = await b2CacheFetch()); }
  catch (e) { return res.status(503).json({ error: 'B2 unavailable' }); }

  const fileUrl = b2DownloadUrl(file, dlUrl, dlToken);
  const preset = QUALITY_PRESETS[quality];

  if (quality === 'flac' || preset === null) {
    const reqHeaders = { 'User-Agent': 'AtomicBlast/1.0' };
    if (req.headers.range) reqHeaders['Range'] = req.headers.range;
    const upstreamReq = https.get(fileUrl, { agent: B2_HTTP_AGENT, headers: reqHeaders }, (b2res) => {
      if (b2res.statusCode !== 200 && b2res.statusCode !== 206) {
        b2res.resume();
        return res.status(502).json({ error: `B2 returned ${b2res.statusCode}` });
      }
      res.setHeader('Content-Type', 'audio/flac');
      res.setHeader('Accept-Ranges', 'bytes');
      if (b2res.headers['content-length']) res.setHeader('Content-Length', b2res.headers['content-length']);
      if (b2res.headers['content-range']) res.setHeader('Content-Range', b2res.headers['content-range']);
      res.status(b2res.statusCode);
      b2res.pipe(res);
      res.on('close', () => b2res.destroy());
      b2res.on('error', e => {
        if (e.code !== 'ERR_STREAM_PREMATURE_CLOSE' && e.code !== 'EPIPE') console.error('B2 stream error:', e.message);
        if (!res.headersSent) res.status(500).end();
      });
      res.on('error', e => {
        if (e.code !== 'EPIPE') console.error('client stream error:', e.message);
        b2res.destroy();
      });
    });
    upstreamReq.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'Fetch failed' }); });
    req.on('close', () => upstreamReq.destroy());
    return;
  }

  const isLow = quality === 'low';
  const codec = isLow ? 'aac' : 'libmp3lame';
  const mimeType = isLow ? 'audio/aac' : 'audio/mpeg';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Transfer-Encoding', 'chunked');

  fetchStream(fileUrl, { 'User-Agent': 'AtomicBlast/1.0' }, (err, stream) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch from B2' });
    const ffmpeg = spawn('ffmpeg', ['-nostdin','-hide_banner','-loglevel','error','-analyzeduration','128k','-probesize','128k','-i','pipe:0','-vn','-acodec',codec,'-b:a',preset,'-f',isLow?'adts':'mp3','pipe:1']);
    stream.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('error', err => { console.error('ffmpeg error:', err); if (!res.headersSent) res.status(500).end(); });
    req.on('close', () => {
      stream.destroy();
      ffmpeg.kill('SIGKILL');
    });
  });
});

app.get('/img', async (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: 'Missing file param' });

  let dlUrl, dlToken;
  try { ({ dlUrl, dlToken } = await b2CacheFetch()); }
  catch (e) { return res.status(503).end(); }

  const fileUrl = b2DownloadUrl(file, dlUrl, dlToken);
  https.get(fileUrl, { agent: B2_HTTP_AGENT, headers: { 'User-Agent': 'AtomicBlast/1.0' } }, (b2res) => {
    if (b2res.statusCode !== 200) { b2res.resume(); return res.status(b2res.statusCode).end(); }
    res.setHeader('Content-Type', b2res.headers['content-type'] || 'image/jpeg');
    if (b2res.headers['content-length']) res.setHeader('Content-Length', b2res.headers['content-length']);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    b2res.pipe(res);
  }).on('error', () => { if (!res.headersSent) res.status(500).end(); });
});

function fetchStream(url, headers, cb) {
  const proto = url.startsWith('https') ? https : http;
  proto.get(url, { agent: url.startsWith('https') ? B2_HTTP_AGENT : undefined, headers }, (response) => {
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
