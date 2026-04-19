'use strict'

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id)

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtTime(s) {
  if (!s || !isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0')
}

function cleanTitle(raw) {
  return raw.replace(/^\d+[.\-\s]+/, '').trim()
}

function isAudio(name) {
  const ext = name.split('.').pop().toLowerCase()
  return ['mp3','flac','aac','ogg','wav','m4a','opus','wma'].includes(ext)
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB'
  return bytes + ' B'
}

// ── CUE sheet parsing (mirrors CueParser.kt) ──────────────────────────────────
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
        : after.split(' ').slice(0, -1).join(' ')

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

  if (trackNum >= 0 && trackStartMs >= 0) {
    chapters.push({ number: trackNum, title: trackTitle || `Track ${trackNum}`, performer: trackPerformer, startMs: trackStartMs })
  }

  if (!audioFileName || !chapters.length || fileCount > 1) return null
  return { audioFileName, albumTitle, albumPerformer, chapters }
}

/** Build chapter Track objects from a parsed CUE and its audio B2 file. */
function cueToTracks(parsed, audioFile, breadcrumbs) {
  const parts  = audioFile.name.replace(/^Music\//, '').split('/')
  const artist = parsed.albumPerformer || (parts.length > 1 ? parts[0] : 'Unknown')
  const album  = parts.length > 2 ? parts[1] : (parsed.albumTitle || (breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 1].label : ''))
  const format = audioFile.name.split('.').pop().toUpperCase()
  const folder = audioFile.name.split('/').slice(0, -1).join('/')

  return parsed.chapters.map((chapter, i) => {
    const endMs = parsed.chapters[i + 1]?.startMs  // undefined for last chapter
    return {
      title:      chapter.title,
      artist:     chapter.performer || artist,
      album,
      format,
      filePath:   audioFile.name,
      streamUrl:  null,
      coverUrl:   null,
      _needsUrl:  true,
      trackNumber: chapter.number,
      cueStartMs: chapter.startMs,
      cueEndMs:   endMs,         // undefined → plays to audio file end
      _cueDuration: endMs != null ? endMs - chapter.startMs : null,
    }
  })
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusDot   = $('status-dot')
const statusText  = $('status-text')
const npArt       = $('np-art')
const npTitle     = $('np-title')
const npArtist    = $('np-artist')
const npFormat    = $('np-format')
const seekBar     = $('seek-bar')
const seekFill    = $('seek-fill')
const npCur       = $('np-cur')
const npDur       = $('np-dur')
const btnPrev     = $('btn-prev')
const btnPlay     = $('btn-play')
const btnStop     = $('btn-stop')
const btnNext     = $('btn-next')
const btnShuffle  = $('btn-shuffle')
const qualBtns    = document.querySelectorAll('.quality-btn')
const browseToggle  = $('browse-toggle')
const browseBody    = $('browse-body')
const browseCrumbs  = $('browse-crumbs')
const shuffleAllBtn = $('shuffle-all-btn')
const browseSearch  = $('browse-search')
const browseList    = $('browse-list')
const favToggle     = $('fav-toggle')
const favBody       = $('fav-body')
const favList       = $('fav-list')

// ── Local state ───────────────────────────────────────────────────────────────
let state      = null   // latest state from background
let browseOpen = false
let favOpen    = false
let favorites  = []     // cached from server

// crumbs: [{ label, prefix }]  prefix always ends with '/'
let crumbs      = [{ label: 'Artists', prefix: 'Music/' }]
let rawFiles    = []   // raw B2 file objects for current level
let loadingBrowse = false
// When a CUE sheet is present, this holds the expanded chapter Track objects.
// null means the current folder uses normal file listing.
let cueTrackCache = null

const ART_SKIP = new Set(['artwork','scans','covers','images','art','booklet','extras'])

// ── Metadata aggregator ────────────────────────────────────────────────────────
const LASTFM_KEY      = 'd67dea9be32d3f2510ef5cde2db140fb'
const PLACEHOLDER_IMG = '2a96cbd8b46e442fc41c2b86b821562f'
const artistMetaCache = new Map()
const albumMetaCache  = new Map()

function metaStripHtml(str) {
  if (!str) return ''
  return str.replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
}

async function metaFetch(url) {
  try { const r = await fetch(url); return r.ok ? r.json() : null } catch(e) { return null }
}

async function metaLastfmArtist(name) {
  try {
    const d = await metaFetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${LASTFM_KEY}&format=json&autocorrect=1`)
    if (!d?.artist) return null
    const a   = d.artist
    const img = (a.image||[]).find(i=>i.size==='extralarge')||{};
    const url = img['#text']
    const bio = metaStripHtml(a.bio?.summary||'').replace(/Read more on Last\.fm\.?/gi,'').trim()
    return {
      image:     url && !url.includes(PLACEHOLDER_IMG) ? url : null,
      bio:       bio.length > 20 ? bio : null,
      tags:      (a.tags?.tag||[]).slice(0,8).map(t=>t.name),
      similar:   (a.similar?.artist||[]).slice(0,5).map(s=>s.name),
      listeners: a.stats?.listeners ? Number(a.stats.listeners).toLocaleString() : null,
    }
  } catch(e) { return null }
}

async function metaWikipedia(name) {
  try {
    const d = await metaFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`)
    if (!d || d.type==='disambiguation' || !d.extract) return null
    return { bio: d.extract.slice(0,500), image: d.thumbnail?.source||null }
  } catch(e) { return null }
}

async function metaDeezerArtist(name) {
  try {
    const d = await metaFetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=3`)
    if (!d?.data?.length) return null
    const m = d.data.find(a=>a.name.toLowerCase()===name.toLowerCase()) || d.data[0]
    return { image: m.picture_xl || m.picture_big || null }
  } catch(e) { return null }
}

async function metaLastfmAlbum(artist, album) {
  try {
    const d = await metaFetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&api_key=${LASTFM_KEY}&format=json&autocorrect=1`)
    if (!d?.album) return null
    const a   = d.album
    const img = (a.image||[]).find(i=>i.size==='extralarge')||{}
    const url = img['#text']
    const wiki = metaStripHtml(a.wiki?.summary||'').replace(/Read more on Last\.fm\.?/gi,'').trim()
    return {
      image: url && !url.includes(PLACEHOLDER_IMG) ? url : null,
      wiki:  wiki.length > 20 ? wiki : null,
    }
  } catch(e) { return null }
}

async function metaDeezerAlbum(artist, album) {
  try {
    const d = await metaFetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(artist+' '+album)}&limit=3`)
    if (!d?.data?.length) return null
    const m = d.data.find(a=>a.title.toLowerCase().includes(album.toLowerCase())) || d.data[0]
    return { image: m.cover_xl || m.cover_big || null }
  } catch(e) { return null }
}

async function fetchArtistMeta(name) {
  if (artistMetaCache.has(name)) return artistMetaCache.get(name)
  const [lfm, wiki, deezer] = await Promise.all([metaLastfmArtist(name), metaWikipedia(name), metaDeezerArtist(name)])
  const merged = {
    image:     lfm?.image   || wiki?.image  || deezer?.image || null,
    bio:       lfm?.bio     || wiki?.bio    || null,
    tags:      lfm?.tags    || [],
    similar:   lfm?.similar || [],
    listeners: lfm?.listeners || null,
  }
  artistMetaCache.set(name, merged)
  return merged
}

async function fetchAlbumMeta(artist, album) {
  const key = artist + '\x00' + album
  if (albumMetaCache.has(key)) return albumMetaCache.get(key)
  const [lfm, deezer] = await Promise.all([metaLastfmAlbum(artist, album), metaDeezerAlbum(artist, album)])
  const merged = { coverArt: lfm?.image || deezer?.image || null, wiki: lfm?.wiki || null }
  albumMetaCache.set(key, merged)
  return merged
}

function renderMeta(data, type) {
  const el = $('browse-meta')
  if (!el) return
  if (!data) { el.innerHTML = ''; return }

  const hasImage = data.image || data.coverArt
  const bio      = data.bio || data.wiki
  const tags     = data.tags   || []
  const similar  = data.similar || []

  let html = '<div class="meta-row">'
  if (hasImage) html += `<img class="meta-art" src="${esc(hasImage)}" onerror="this.style.display='none'">`
  html += '<div class="meta-info">'
  if (bio) {
    const short = bio.length > 220 ? bio.slice(0, 220) + '…' : bio
    html += `<div class="meta-bio">${esc(short)}</div>`
  }
  if (tags.length) {
    html += '<div class="meta-tags">' + tags.map(t => `<span class="meta-tag">${esc(t)}</span>`).join('') + '</div>'
  }
  if (similar.length) {
    html += '<div class="meta-similar">' + similar.map(s => `<span class="meta-chip">${esc(s)}</span>`).join('') + '</div>'
  }
  if (data.listeners) html += `<div class="meta-stat">👥 ${esc(data.listeners)} listeners</div>`
  html += '</div></div>'
  el.innerHTML = html
}

// ── Messaging ─────────────────────────────────────────────────────────────────
function send(msg) { return browser.runtime.sendMessage(msg) }

browser.runtime.onMessage.addListener(msg => {
  if (msg.type === 'state') applyState(msg)
})

// ── State → UI ────────────────────────────────────────────────────────────────
function applyState(s) {
  state = s

  // Connection dot
  if (!s.authed) {
    statusDot.className = 'status-dot connecting'
    statusText.textContent = 'Connecting to B2…'
  } else if (s.status === 'error') {
    statusDot.className = 'status-dot error'
    statusText.textContent = s.errMsg || 'Error'
  } else {
    statusDot.className = 'status-dot connected'
    statusText.textContent = 'B2 Connected'
  }

  // Controls
  const hasQ = s.queueLen > 0
  btnPrev.disabled  = !hasQ
  btnPlay.disabled  = !s.authed
  btnStop.disabled  = s.status === 'idle'
  btnNext.disabled  = !hasQ
  btnPlay.textContent = (s.status === 'playing') ? '⏸' : '▶'
  btnShuffle.classList.toggle('active', s.shuffle)

  // Quality buttons
  qualBtns.forEach(b => b.classList.toggle('active', b.dataset.q === s.quality))

  // Now Playing
  if (s.track) {
    npTitle.textContent  = s.track.title  || '—'
    npArtist.textContent = [s.track.artist, s.track.album].filter(Boolean).join(' · ')
    npFormat.textContent = s.track.format || ''
    npFormat.className   = 'np-format' + (s.track.format === 'FLAC' ? ' flac' : '')

    if (s.track.coverUrl) {
      const img = document.createElement('img')
      img.src = s.track.coverUrl
      img.onerror = () => { npArt.innerHTML = ''; npArt.textContent = '♪' }
      npArt.innerHTML = ''
      npArt.appendChild(img)
    } else {
      npArt.innerHTML = ''
      npArt.textContent = '♪'
    }
  } else {
    npTitle.textContent  = s.status === 'idle' ? 'Nothing playing' : s.status === 'loading' ? 'Loading…' : '—'
    npArtist.textContent = ''
    npFormat.textContent = ''
    npArt.innerHTML      = ''
    npArt.textContent    = '♪'
  }

  // Progress
  const pct = (s.duration > 0) ? (s.position / s.duration * 100) : 0
  seekFill.style.width = Math.min(100, pct) + '%'
  npCur.textContent = fmtTime(s.position)
  npDur.textContent = fmtTime(s.duration)

  // Mark playing track in browse list
  if (s.track) markPlayingInList(s.track.title)
}

function markPlayingInList(title) {
  browseList.querySelectorAll('.browse-track').forEach(el => {
    el.classList.toggle('playing', el.dataset.title === title)
  })
}

// ── Controls ──────────────────────────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
  if (!state) return
  send({ cmd: state.status === 'playing' ? 'pause' : 'play' })
})
btnStop.addEventListener('click',   () => send({ cmd: 'stop' }))
btnPrev.addEventListener('click',   () => send({ cmd: 'prev' }))
btnNext.addEventListener('click',   () => send({ cmd: 'next' }))
btnShuffle.addEventListener('click',() => send({ cmd: 'shuffle' }))

seekBar.addEventListener('click', e => {
  const r = seekBar.getBoundingClientRect()
  send({ cmd: 'seek', pct: (e.clientX - r.left) / r.width })
})

qualBtns.forEach(btn => {
  btn.addEventListener('click', () => send({ cmd: 'setQuality', quality: btn.dataset.q }))
})

// ── Browse toggle ─────────────────────────────────────────────────────────────
browseToggle.addEventListener('click', () => {
  browseOpen = !browseOpen
  browseToggle.classList.toggle('open', browseOpen)
  browseBody.classList.toggle('open', browseOpen)
  if (browseOpen && rawFiles.length === 0) loadLevel(crumbs[crumbs.length - 1].prefix)
})

browseSearch.addEventListener('input', () => {
  const q = browseSearch.value.trim().toLowerCase()
  if (cueTrackCache) {
    // Filter CUE chapter list
    const filtered = q ? cueTrackCache.filter(t => t.title.toLowerCase().includes(q)) : cueTrackCache
    renderCueTracks(filtered, cueTrackCache)
  } else {
    renderFiles(q ? rawFiles.filter(f => {
      const name = f.name.split('/').filter(Boolean).pop() || ''
      return name.toLowerCase().includes(q)
    }) : rawFiles)
  }
})

// ── Shuffle All ───────────────────────────────────────────────────────────────
shuffleAllBtn.addEventListener('click', async () => {
  shuffleAllBtn.disabled    = true
  shuffleAllBtn.textContent = '⟳ Loading…'
  try {
    // If the current folder is a CUE folder, shuffle its chapters directly.
    if (cueTrackCache && cueTrackCache.length) {
      const q = [...cueTrackCache]
      for (let i = q.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q[i], q[j]] = [q[j], q[i]]
      }
      await send({ cmd: 'playQueue', queue: q, index: 0 })
      return
    }

    const prefix = crumbs[crumbs.length - 1].prefix
    const res = await send({ cmd: 'listFiles', prefix, useDelimiter: false })
    if (!res.ok) throw new Error(res.error)

    const audioFiles = res.files.filter(f => !f.name.endsWith('/') && isAudio(f.name))
    if (!audioFiles.length) { alert('No audio files found here.'); return }

    const queue = audioFiles.map(f => fileToTrack(f))

    // Fisher-Yates shuffle
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]]
    }

    await send({ cmd: 'playQueue', queue, index: 0 })
  } catch (e) {
    alert('Shuffle failed: ' + e.message)
  } finally {
    shuffleAllBtn.disabled    = false
    shuffleAllBtn.textContent = '⇄ Shuffle All'
  }
})

// ── File → Track object ───────────────────────────────────────────────────────
function fileToTrack(f) {
  const parts    = f.name.replace(/^Music\//, '').split('/')
  const artist   = parts.length > 1 ? parts[0] : 'Unknown'
  const album    = parts.length > 2 ? parts[1] : ''
  const fileName = parts[parts.length - 1]
  const ext      = fileName.split('.').pop().toUpperCase()
  return {
    title:    cleanTitle(fileName.replace(/\.[^.]+$/, '')),
    artist,
    album,
    format:   ext,
    filePath: f.name,
    streamUrl: null,
    coverUrl:  null,
    _needsUrl: true,
  }
}

// ── Load a B2 prefix level ────────────────────────────────────────────────────
async function loadLevel(prefix) {
  if (loadingBrowse) return
  loadingBrowse = true
  cueTrackCache = null   // clear CUE cache for the new folder
  renderMeta(null)       // clear metadata panel while loading new folder
  browseList.innerHTML = '<div class="browse-loading"><div class="browse-spinner"></div> Loading…</div>'
  renderCrumbs()
  try {
    const res = await send({ cmd: 'listFiles', prefix, useDelimiter: true })
    if (!res.ok) throw new Error(res.error)
    rawFiles = res.files

    // Check if this folder has a CUE sheet
    const cueFile = rawFiles.find(f => !f.name.endsWith('/') && f.name.toLowerCase().endsWith('.cue'))
    if (cueFile) {
      await tryExpandCue(cueFile)
    } else {
      renderFiles(rawFiles)
    }

    // Load metadata based on navigation depth
    if (crumbs.length === 2) {
      // Inside an artist folder — load artist bio/tags/similar
      const artistName = crumbs[1].label
      fetchArtistMeta(artistName).then(data => renderMeta(data, 'artist'))
    } else if (crumbs.length === 3) {
      // Inside an album folder — load album cover/wiki
      const artistName = crumbs[1].label
      const albumName  = crumbs[2].label
      fetchAlbumMeta(artistName, albumName).then(data => renderMeta(data, 'album'))
    }
  } catch (e) {
    browseList.innerHTML = `<div class="browse-msg error">Error: ${esc(e.message)}</div>`
  } finally {
    loadingBrowse = false
  }
}

/** Fetch and parse a CUE file. On success renders CUE chapters; on failure falls back to normal listing. */
async function tryExpandCue(cueFile) {
  try {
    const res = await send({ cmd: 'fetchFileText', filePath: cueFile.name })
    if (!res.ok) throw new Error(res.error)

    const parsed = parseCue(res.text)
    if (!parsed) throw new Error('CUE parse failed')

    // Find the audio file referenced in the CUE FILE directive (case-insensitive)
    const audioFile = rawFiles.find(f =>
      !f.name.endsWith('/') &&
      f.name.split('/').pop().toLowerCase() === parsed.audioFileName.toLowerCase()
    ) || rawFiles.find(f =>
      !f.name.endsWith('/') && ['flac','wav','mp3'].includes(f.name.split('.').pop().toLowerCase())
    )

    if (!audioFile) throw new Error('Audio file not found in folder')

    const tracks = cueToTracks(parsed, audioFile, crumbs)
    cueTrackCache = tracks
    renderCueTracks(tracks, tracks)
  } catch (e) {
    console.warn('[AtomicBlast] CUE expansion failed:', e.message)
    cueTrackCache = null
    renderFiles(rawFiles)
  }
}

// ── Render CUE chapter list ───────────────────────────────────────────────────
function renderCueTracks(displayTracks, allTracks) {
  if (!displayTracks.length) {
    browseList.innerHTML = '<div class="browse-msg">No tracks in CUE sheet.</div>'
    return
  }

  let html = '<div class="browse-section-label">TRACKS (CUE)</div>'
  displayTracks.forEach((track, i) => {
    const dur    = track._cueDuration != null ? fmtTime(track._cueDuration / 1000) : ''
    const isFav  = favorites.some(fv => fv.filePath === track.filePath && fv.title === track.title)
    html += `
      <div class="browse-track" data-idx="${i}" data-title="${esc(track.title)}" data-path="${esc(track.filePath)}">
        <span class="browse-track-num">${esc(String(track.trackNumber || i + 1))}</span>
        <span class="browse-track-name">${esc(track.title)}</span>
        ${dur ? `<span class="browse-track-dur">${esc(dur)}</span>` : ''}
        <span class="browse-track-ext${track.format === 'FLAC' ? ' flac' : ''}">${esc(track.format)}</span>
        <button class="fav-btn${isFav ? ' fav-active' : ''}" data-path="${esc(track.filePath)}" data-title="${esc(track.title)}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">♥</button>
      </div>`
  })
  browseList.innerHTML = html

  // Track click: play full allTracks queue from this chapter
  browseList.querySelectorAll('.browse-track').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('fav-btn')) return
      const idx = displayTracks.indexOf(displayTracks[parseInt(el.dataset.idx)])
      // Find the index in the full allTracks list for the queue
      const fullIdx = allTracks.findIndex(t => t === displayTracks[parseInt(el.dataset.idx)])
      send({ cmd: 'playQueue', queue: allTracks, index: Math.max(0, fullIdx) })
    })
  })

  // ♥ button: toggle favorite
  browseList.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation()
      const filePath  = btn.dataset.path
      const trackTitle = btn.dataset.title
      const isFav     = btn.classList.contains('fav-active')
      btn.disabled    = true
      const track = displayTracks[parseInt(btn.closest('.browse-track').dataset.idx)]
      if (isFav) {
        const res = await send({ cmd: 'removeFavorite', filePath })
        if (res.ok) { favorites = res.favorites; btn.classList.remove('fav-active'); btn.title = 'Add to favorites' }
      } else {
        const res = await send({ cmd: 'addFavorite', track })
        if (res.ok) { favorites = res.favorites; btn.classList.add('fav-active'); btn.title = 'Remove from favorites' }
      }
      btn.disabled = false
      if (favOpen) renderFavorites()
    })
  })

  if (state?.track) markPlayingInList(state.track.title)
}

// ── Render file list ──────────────────────────────────────────────────────────
function renderFiles(files) {
  const prefix  = crumbs[crumbs.length - 1].prefix
  const atRoot  = crumbs.length === 1   // root = artist level

  const folders = files
    .filter(f => f.name.endsWith('/'))
    .filter(f => {
      const n = f.name.trimEnd('/').split('/').pop().toLowerCase()
      return !ART_SKIP.has(n)
    })

  const tracks = files.filter(f => !f.name.endsWith('/') && isAudio(f.name))

  let html = ''

  if (folders.length) {
    html += '<div class="browse-section-label">FOLDERS</div>'
    for (const f of folders) {
      const label = f.name.replace(prefix, '').trimEnd('/')
      html += `
        <div class="browse-folder" data-prefix="${esc(f.name)}" data-label="${esc(label)}">
          <span class="browse-item-icon">${atRoot ? '🎤' : '💿'}</span>
          <span class="browse-item-name">${esc(label)}</span>
          <span class="browse-item-arrow">›</span>
        </div>`
    }
  }

  if (tracks.length) {
    html += '<div class="browse-section-label">TRACKS</div>'
    tracks.forEach((f, i) => {
      const fileName = f.name.split('/').pop()
      const ext      = fileName.split('.').pop().toUpperCase()
      const title    = cleanTitle(fileName.replace(/\.[^.]+$/, ''))
      const isFav    = favorites.some(fv => fv.filePath === f.name)
      html += `
        <div class="browse-track" data-idx="${i}" data-title="${esc(title)}" data-path="${esc(f.name)}">
          <span class="browse-track-num">${i + 1}</span>
          <span class="browse-track-name">${esc(title)}</span>
          <span class="browse-track-ext${ext === 'FLAC' ? ' flac' : ''}">${esc(ext)}</span>
          <button class="fav-btn${isFav ? ' fav-active' : ''}" data-path="${esc(f.name)}" data-title="${esc(title)}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">♥</button>
        </div>`
    })
  }

  if (!folders.length && !tracks.length) {
    html = '<div class="browse-msg">No music found at this level.</div>'
  }

  browseList.innerHTML = html

  // Folder click: navigate deeper
  browseList.querySelectorAll('.browse-folder').forEach(el => {
    el.addEventListener('click', () => {
      crumbs.push({ label: el.dataset.label, prefix: el.dataset.prefix })
      rawFiles = []
      loadLevel(el.dataset.prefix)
    })
  })

  // Track click: play from that track in the album queue
  const trackObjects = tracks.map(f => fileToTrack(f))
  browseList.querySelectorAll('.browse-track').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('fav-btn')) return  // handled below
      const idx = parseInt(el.dataset.idx)
      send({ cmd: 'playQueue', queue: trackObjects, index: idx })
    })
  })

  // ♥ button: toggle favorite
  browseList.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation()
      const filePath = btn.dataset.path
      const isFav    = btn.classList.contains('fav-active')
      btn.disabled   = true
      if (isFav) {
        const res = await send({ cmd: 'removeFavorite', filePath })
        if (res.ok) { favorites = res.favorites; btn.classList.remove('fav-active'); btn.title = 'Add to favorites' }
      } else {
        const trackIdx = parseInt(btn.closest('.browse-track').dataset.idx)
        const track    = trackObjects[trackIdx]
        const res      = await send({ cmd: 'addFavorite', track })
        if (res.ok) { favorites = res.favorites; btn.classList.add('fav-active'); btn.title = 'Remove from favorites' }
      }
      btn.disabled = false
      if (favOpen) renderFavorites()
    })
  })

  // Mark current playing track
  if (state?.track) markPlayingInList(state.track.title)
}

// ── Render breadcrumbs ────────────────────────────────────────────────────────
function renderCrumbs() {
  let html = ''
  crumbs.forEach((c, i) => {
    const isLast  = i === crumbs.length - 1
    const label   = i === 0 ? 'Artists' : c.label
    html += `<span class="crumb${isLast ? ' active' : ''}" data-idx="${i}">${esc(label)}</span>`
    if (!isLast) html += '<span class="crumb-sep">›</span>'
  })
  browseCrumbs.innerHTML = html

  browseCrumbs.querySelectorAll('.crumb').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx)
      if (idx < crumbs.length - 1) {
        crumbs = crumbs.slice(0, idx + 1)
        rawFiles = []
        loadLevel(crumbs[idx].prefix)
      }
    })
  })
}

// ── Favorites ─────────────────────────────────────────────────────────────────
favToggle.addEventListener('click', () => {
  favOpen = !favOpen
  favToggle.classList.toggle('open', favOpen)
  favBody.classList.toggle('open', favOpen)
  if (favOpen) loadFavorites()
})

async function loadFavorites() {
  favList.innerHTML = '<div class="browse-loading"><div class="browse-spinner"></div> Loading…</div>'
  try {
    const res = await send({ cmd: 'getFavorites' })
    if (!res.ok) throw new Error(res.error)
    favorites = res.favorites
    renderFavorites()
  } catch (e) {
    favList.innerHTML = `<div class="browse-msg error">Error: ${esc(e.message)}</div>`
  }
}

function renderFavorites() {
  if (!favorites.length) {
    favList.innerHTML = '<div class="browse-msg">No favorites yet — click ♥ on any track.</div>'
    return
  }
  let html = ''
  favorites.forEach((fv, i) => {
    html += `
      <div class="browse-track" data-idx="${i}" data-title="${esc(fv.title)}" data-path="${esc(fv.filePath)}">
        <span class="browse-track-num">${i + 1}</span>
        <span class="browse-track-name">${esc(fv.title)}</span>
        <span class="browse-track-artist">${esc(fv.artist)}</span>
        <span class="browse-track-ext${fv.format === 'FLAC' ? ' flac' : ''}">${esc(fv.format)}</span>
        <button class="fav-btn fav-active" data-path="${esc(fv.filePath)}" title="Remove from favorites">♥</button>
      </div>`
  })
  favList.innerHTML = html

  // Play on click
  favList.querySelectorAll('.browse-track').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('fav-btn')) return
      const track = favorites[parseInt(el.dataset.idx)]
      send({ cmd: 'playQueue', queue: favorites.map(fv => ({
        title: fv.title, artist: fv.artist, album: fv.album,
        format: fv.format, filePath: fv.filePath, _needsUrl: true,
      })), index: parseInt(el.dataset.idx) })
    })
  })

  // Remove on ♥ click
  favList.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation()
      btn.disabled = true
      const res = await send({ cmd: 'removeFavorite', filePath: btn.dataset.path })
      if (res.ok) { favorites = res.favorites; renderFavorites() }
      else btn.disabled = false
    })
  })
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const s = await send({ cmd: 'getState' })
    applyState(s)
    if (!s.authed) send({ cmd: 'authorize' })
  } catch (e) {
    statusDot.className  = 'status-dot error'
    statusText.textContent = 'Background error'
  }
}

// Poll every second for position updates (background only broadcasts on state changes)
setInterval(async () => {
  try { applyState(await send({ cmd: 'getState' })) } catch (_) {}
}, 1000)

init()
