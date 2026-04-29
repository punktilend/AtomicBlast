#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const args = new Set(process.argv.slice(2));
const COMMIT = args.has('--commit');
const QUIET = args.has('--quiet');

const ENV_FILE = path.join(__dirname, '..', '.env');
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
} catch (err) {
  console.error('[startup] Failed to load .env:', err.message);
}

const B2_KEY_ID = process.env.B2_KEY_ID || '';
const B2_APP_KEY = process.env.B2_APP_KEY || '';
const B2_BUCKET = process.env.B2_BUCKET || 'SpAtomify';
const B2_PREFIX = process.env.B2_PREFIX || 'Music/';
const LOG_DIR = process.env.B2_ORGANIZER_LOG_DIR || path.join(__dirname, '..', 'logs');
const REPORT_FILE = path.join(LOG_DIR, 'b2-normalize-music-report.json');
const LOG_FILE = path.join(LOG_DIR, 'b2-normalize-music.log');

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  if (!QUIET) console.log(line);
}

function requestJson(method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'User-Agent': 'AtomicBlast-B2Normalizer/1.0',
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
        ...headers,
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Invalid JSON from ${url}: ${data.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function b2Auth() {
  return requestJson('GET', 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account', null, {
    Authorization: 'Basic ' + Buffer.from(B2_KEY_ID + ':' + B2_APP_KEY).toString('base64'),
  });
}

async function b2GetBucketId(auth, bucketName) {
  const res = await requestJson('POST', auth.apiUrl + '/b2api/v2/b2_list_buckets', {
    accountId: auth.accountId,
    bucketName,
  }, {
    Authorization: auth.authorizationToken,
  });
  const bucket = res.buckets && res.buckets[0];
  if (!bucket) throw new Error('B2 bucket not found: ' + bucketName);
  return bucket.bucketId;
}

async function b2ListAllFiles(auth, bucketId, prefix) {
  const files = [];
  let startFileName = null;
  do {
    const body = { bucketId, prefix, maxFileCount: 1000 };
    if (startFileName) body.startFileName = startFileName;
    const page = await requestJson('POST', auth.apiUrl + '/b2api/v2/b2_list_file_names', body, {
      Authorization: auth.authorizationToken,
    });
    if (page.status && page.status !== 200) {
      throw new Error('B2 list error: ' + (page.message || page.code));
    }
    files.push(...(page.files || []));
    startFileName = page.nextFileName || null;
  } while (startFileName);
  return files;
}

async function b2CopyFile(auth, bucketId, sourceFileId, fileName) {
  return requestJson('POST', auth.apiUrl + '/b2api/v2/b2_copy_file', {
    sourceFileId,
    fileName,
    destinationBucketId: bucketId,
  }, {
    Authorization: auth.authorizationToken,
  });
}

async function b2DeleteFileVersion(auth, fileId, fileName) {
  return requestJson('POST', auth.apiUrl + '/b2api/v2/b2_delete_file_version', {
    fileId,
    fileName,
  }, {
    Authorization: auth.authorizationToken,
  });
}

function normalizeKey(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function cleanupName(input) {
  return String(input || '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFolderTags(name) {
  let s = cleanupName(name);
  s = s.replace(/^[\(\[]\d{4}[\)\]]\s*[-–]?\s*/, '');
  s = s.replace(/^\d{4}\.\s+/, '');
  let prev;
  do {
    prev = s;
    s = s.replace(/\s*[\(\[][^\)\]]{1,80}[\)\]]\s*$/, '').trim();
  } while (s !== prev);
  s = s.replace(/\s*[-–]\s*(FLAC|MP3|AAC|OGG|WMA|WAV|ALAC|320|V0|V2)\s*$/i, '').trim();
  return s.trim() || cleanupName(name);
}

function sanitizePathSegment(name) {
  return stripFolderTags(name)
    .replace(/[<>:"\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
}

function parseArtistAlbumFolder(folderName) {
  let s = stripFolderTags(folderName);
  const compactYear = s.match(/^(.+?)\s+-(\d{4})-\s+(.+)$/);
  if (compactYear) {
    return {
      artist: sanitizePathSegment(compactYear[1].trim()),
      album: sanitizePathSegment(compactYear[3].trim()),
    };
  }
  const dashIdx = s.search(/\s+[-_]\s+/);
  if (dashIdx === -1) return { artist: sanitizePathSegment(s), album: sanitizePathSegment(s) };
  const artist = sanitizePathSegment(s.slice(0, dashIdx).trim());
  let album = s.slice(dashIdx).replace(/^\s*[-_]\s*/, '').trim();
  album = album.replace(/^\d{4}\s*[-–]\s+/, '').trim();
  return { artist, album: sanitizePathSegment(album || artist) };
}

function extractYear(text) {
  const match = String(text || '').match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  return match ? match[1] : null;
}

function parseYearArtist(folderName) {
  const match = cleanupName(folderName).match(/^(\d{4})[.\s_-]+(.+)$/);
  if (!match) return null;
  return { year: match[1], artist: sanitizePathSegment(match[2]) };
}

function parseYearAlbum(folderName) {
  const match = cleanupName(folderName).match(/^(\d{4})\s*[-–]\s+(.+)$/);
  if (!match) return null;
  return { year: match[1], album: sanitizePathSegment(match[2]) };
}

function parseCombinedArtistYearAlbum(folderName) {
  const cleaned = stripFolderTags(folderName);
  let match = cleaned.match(/^(.+?)\s*-(\d{4})-\s*(.+)$/);
  if (match) {
    return {
      artist: sanitizePathSegment(match[1]),
      year: match[2],
      album: sanitizePathSegment(match[3]),
    };
  }
  match = cleaned.match(/^(\d{4})[.\s_-]+(.+?)\s*[-_]\s*(.+)$/);
  if (match) {
    return {
      artist: sanitizePathSegment(match[2]),
      year: match[1],
      album: sanitizePathSegment(match[3]),
    };
  }
  return null;
}

function isArtistSidecarName(fileName) {
  return /^artist\.(jpg|jpeg|png|webp|nfo|txt)$/i.test(fileName);
}

function isAlbumCompanionName(fileName) {
  return /\.(cue|log|m3u|m3u8)$/i.test(fileName);
}

function sidecarStem(fileName) {
  return cleanupName(String(fileName || '').replace(/\.[^.]+$/, ''));
}

function isRedundantAlbumFolder(folderName, artistName, albumName) {
  const normalizedFolder = normalizeKey(stripFolderTags(folderName));
  if (!normalizedFolder) return false;
  const options = [
    albumName,
    `${artistName} ${albumName}`,
    `${artistName}-${albumName}`,
    `${artistName} ${extractYear(folderName) || ''} ${albumName}`,
  ].map(normalizeKey);
  return options.includes(normalizedFolder);
}

function analyzeFile(fileName) {
  const parts = fileName.split('/').filter(Boolean);
  if (parts[0] !== B2_PREFIX.replace(/\/$/, '')) return null;
  const rel = parts.slice(1);
  if (rel.length < 2) return null;
  const basename = rel[rel.length - 1];

  if (rel.length === 2 && isArtistSidecarName(basename)) {
    const artist = sanitizePathSegment(parseArtistAlbumFolder(rel[0]).artist);
    return {
      kind: 'artistSidecar',
      sourcePath: fileName,
      basename,
      artistRaw: artist,
      artistKey: normalizeKey(artist),
      targetPath: `${B2_PREFIX}${artist}/${basename}`,
    };
  }

  if (rel.length === 2 && isAlbumCompanionName(basename)) {
    const artist = sanitizePathSegment(parseArtistAlbumFolder(rel[0]).artist);
    return {
      kind: 'albumCompanion',
      sourcePath: fileName,
      basename,
      artistRaw: artist,
      artistKey: normalizeKey(artist),
      sidecarStem: sidecarStem(basename),
    };
  }

  if (rel.length === 3 && isAlbumCompanionName(rel[1]) && isAlbumCompanionName(rel[2])) {
    const artist = sanitizePathSegment(parseArtistAlbumFolder(rel[0]).artist);
    return {
      kind: 'albumCompanion',
      sourcePath: fileName,
      basename: rel[2],
      artistRaw: artist,
      artistKey: normalizeKey(artist),
      sidecarStem: sidecarStem(rel[1]),
    };
  }

  let artistRaw = null;
  let albumRaw = null;
  let year = null;
  let extraDirs = [];

  const combined = parseCombinedArtistYearAlbum(rel[0]);
  if (combined) {
    artistRaw = combined.artist;
    albumRaw = combined.album;
    year = combined.year;
    let startIdx = 1;
    if (rel.length > 2 && isRedundantAlbumFolder(rel[1], artistRaw, albumRaw)) startIdx = 2;
    extraDirs = rel.slice(startIdx, -1).map(sanitizePathSegment).filter(Boolean);
  } else {
    const yearArtist = parseYearArtist(rel[0]);
    if (yearArtist) {
      artistRaw = yearArtist.artist;
      const yearAlbum = parseYearAlbum(rel[1]);
      albumRaw = yearAlbum ? yearAlbum.album : sanitizePathSegment(rel[1]);
      year = yearAlbum ? yearAlbum.year : yearArtist.year;
      extraDirs = rel.slice(2, -1).map(sanitizePathSegment).filter(Boolean);
    } else {
      artistRaw = sanitizePathSegment(parseArtistAlbumFolder(rel[0]).artist);
      const yearAlbum = parseYearAlbum(rel[1]);
      albumRaw = yearAlbum ? yearAlbum.album : sanitizePathSegment(parseArtistAlbumFolder(rel[1]).album);
      year = yearAlbum ? yearAlbum.year : extractYear(rel[1]);
      extraDirs = rel.slice(2, -1).map(sanitizePathSegment).filter(Boolean);
    }
  }

  if (!artistRaw || !albumRaw) return null;

  return {
    kind: 'albumItem',
    sourcePath: fileName,
    basename,
    artistRaw,
    albumRaw,
    year,
    extraDirs,
    artistKey: normalizeKey(artistRaw),
    albumKey: normalizeKey(albumRaw),
  };
}

function scoreName(name) {
  const text = String(name || '');
  let score = 0;
  if (text && !/^\d{4}/.test(text)) score += 4;
  if (!/_/.test(text)) score += 3;
  if (!/\[[^\]]+\]/.test(text)) score += 2;
  if (!/\s{2,}/.test(text)) score += 1;
  score -= (text.match(/_/g) || []).length * 2;
  score -= text.length * 0.001;
  return score;
}

function choosePreferred(values) {
  return [...values].sort((a, b) => scoreName(b) - scoreName(a) || a.length - b.length || a.localeCompare(b))[0];
}

function choosePreferredYear(years) {
  const counts = new Map();
  for (const year of years) {
    if (!year) continue;
    counts.set(year, (counts.get(year) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
}

function findMatchingAlbumGroup(albumGroupKeys, preferredAlbums, stem) {
  const target = normalizeKey(stem);
  if (!target) return null;

  const exact = [];
  const fuzzy = [];
  for (const albumGroupKey of albumGroupKeys || []) {
    const albumName = preferredAlbums.get(albumGroupKey);
    const albumKey = normalizeKey(albumName);
    if (!albumKey) continue;
    if (albumKey === target) exact.push(albumGroupKey);
    else if (albumKey.includes(target) || target.includes(albumKey)) fuzzy.push(albumGroupKey);
  }

  if (exact.length === 1) return exact[0];
  if (fuzzy.length === 1) return fuzzy[0];
  if (exact.length > 1) return exact.sort()[0];
  if (fuzzy.length > 1) return fuzzy.sort()[0];
  return null;
}

async function main() {
  if (!B2_KEY_ID || !B2_APP_KEY) throw new Error('B2 credentials are missing');

  log(`Starting B2 music normalization in ${COMMIT ? 'commit' : 'analysis'} mode`);
  const auth = await b2Auth();
  const bucketId = await b2GetBucketId(auth, B2_BUCKET);
  const files = await b2ListAllFiles(auth, bucketId, B2_PREFIX);
  log(`Loaded ${files.length} visible files from ${B2_BUCKET}/${B2_PREFIX}`);

  const existingPaths = new Set(files.map(f => f.fileName));
  const artistCandidates = new Map();
  const albumCandidates = new Map();
  const albumYears = new Map();
  const records = [];

  for (const file of files) {
    if (file.action === 'folder') continue;
    const record = analyzeFile(file.fileName);
    if (!record) continue;
    record.fileId = file.fileId;
    records.push(record);

    if (!artistCandidates.has(record.artistKey)) artistCandidates.set(record.artistKey, new Set());
    artistCandidates.get(record.artistKey).add(record.artistRaw);

    if (record.kind === 'albumItem') {
      const albumGroupKey = record.artistKey + '\0' + record.albumKey;
      if (!albumCandidates.has(albumGroupKey)) albumCandidates.set(albumGroupKey, new Set());
      albumCandidates.get(albumGroupKey).add(record.albumRaw);
      if (!albumYears.has(albumGroupKey)) albumYears.set(albumGroupKey, []);
      albumYears.get(albumGroupKey).push(record.year);
    }
  }

  const preferredArtists = new Map();
  for (const [artistKey, values] of artistCandidates.entries()) {
    preferredArtists.set(artistKey, choosePreferred(values));
  }

  const preferredAlbums = new Map();
  const preferredAlbumYears = new Map();
  const artistAlbumGroups = new Map();
  for (const [albumGroupKey, values] of albumCandidates.entries()) {
    preferredAlbums.set(albumGroupKey, choosePreferred(values));
    preferredAlbumYears.set(albumGroupKey, choosePreferredYear(albumYears.get(albumGroupKey) || []));
    const artistKey = albumGroupKey.split('\0', 1)[0];
    if (!artistAlbumGroups.has(artistKey)) artistAlbumGroups.set(artistKey, []);
    artistAlbumGroups.get(artistKey).push(albumGroupKey);
  }

  let unchanged = 0;
  let alreadyPresent = 0;
  let scheduled = 0;
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  let deleted = 0;
  const failures = [];
  const samples = [];

  for (const record of records) {
    if (record.kind === 'artistSidecar') {
      record.targetPath = `${B2_PREFIX}${preferredArtists.get(record.artistKey)}/${record.basename}`;
    } else if (record.kind === 'albumCompanion') {
      const artistName = preferredArtists.get(record.artistKey) || record.artistRaw;
      const albumGroupKey = findMatchingAlbumGroup(
        artistAlbumGroups.get(record.artistKey),
        preferredAlbums,
        record.sidecarStem
      );
      if (albumGroupKey) {
        const albumName = preferredAlbums.get(albumGroupKey) || record.sidecarStem;
        const year = preferredAlbumYears.get(albumGroupKey) || null;
        const albumFolder = sanitizePathSegment(year ? `${year} - ${albumName}` : albumName);
        record.targetPath = `${B2_PREFIX}${artistName}/${albumFolder}/${record.basename}`;
      } else {
        record.targetPath = `${B2_PREFIX}${artistName}/${record.basename}`;
      }
    } else {
      const albumGroupKey = record.artistKey + '\0' + record.albumKey;
      const artistName = preferredArtists.get(record.artistKey) || record.artistRaw;
      const albumName = preferredAlbums.get(albumGroupKey) || record.albumRaw;
      const year = preferredAlbumYears.get(albumGroupKey) || record.year;
      const albumFolder = sanitizePathSegment(year ? `${year} - ${albumName}` : albumName);
      const extraDirs = record.extraDirs && record.extraDirs.length ? '/' + record.extraDirs.join('/') : '';
      record.targetPath = `${B2_PREFIX}${artistName}/${albumFolder}${extraDirs}/${record.basename}`;
    }

    if (record.sourcePath === record.targetPath) {
      unchanged += 1;
      continue;
    }
    if (existingPaths.has(record.targetPath)) {
      alreadyPresent += 1;
      if (COMMIT && record.kind === 'albumCompanion') {
        try {
          await b2DeleteFileVersion(auth, record.fileId, record.sourcePath);
          deleted += 1;
        } catch (err) {
          failed += 1;
          failures.push({ from: record.sourcePath, to: record.targetPath, error: `delete failed: ${err.message}` });
          log(`DELETE FAILED: ${record.sourcePath} :: ${err.message}`);
        }
      }
      continue;
    }

    scheduled += 1;
    if (samples.length < 25) {
      samples.push({ from: record.sourcePath, to: record.targetPath });
    }

    if (!COMMIT) continue;

    try {
      const copyRes = await b2CopyFile(auth, bucketId, record.fileId, record.targetPath);
      if (copyRes.status && copyRes.status !== 200) {
        throw new Error(copyRes.message || copyRes.code || 'copy failed');
      }
      existingPaths.add(record.targetPath);
      copied += 1;
      if (record.kind === 'albumCompanion') {
        await b2DeleteFileVersion(auth, record.fileId, record.sourcePath);
        deleted += 1;
      }
      if (copied % 100 === 0) log(`Copied ${copied}/${scheduled} files so far`);
    } catch (err) {
      failed += 1;
      failures.push({ from: record.sourcePath, to: record.targetPath, error: err.message });
      log(`COPY FAILED: ${record.sourcePath} -> ${record.targetPath} :: ${err.message}`);
    }
  }

  if (COMMIT) skipped = alreadyPresent + unchanged;
  const report = {
    mode: COMMIT ? 'commit' : 'analysis',
    bucket: B2_BUCKET,
    prefix: B2_PREFIX,
    scannedFiles: files.length,
    parsedRecords: records.length,
    unchanged,
    alreadyPresent,
    scheduled,
    copied,
    skipped,
    failed,
    deleted,
    samples,
    failures: failures.slice(0, 200),
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');

  log(
    `Finished: scanned=${report.scannedFiles}`,
    `parsed=${report.parsedRecords}`,
    `unchanged=${unchanged}`,
    `alreadyPresent=${alreadyPresent}`,
    `scheduled=${scheduled}`,
    `copied=${copied}`,
    `deleted=${deleted}`,
    `failed=${failed}`
  );
  log(`Report written to ${REPORT_FILE}`);
}

main().catch(err => {
  log(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
