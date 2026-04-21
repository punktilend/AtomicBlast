// AtomicBlast Web — browser shim for Electron ipcRenderer
// Maps ipcRenderer.invoke() calls to HTTP fetch calls against the proxy API.
// Loaded by index.html before the main app script.

window.ipcRenderer = {
  invoke: async (channel, args) => {
    try {
      switch (channel) {

        case 'scan-b2-music': {
          const r = await fetch('/api/scan-b2-music');
          if (!r.ok) throw new Error('scan-b2-music: HTTP ' + r.status);
          return r.json();
        }

        case 'get-config':
          return {
            cloudSources: [{ id: 'b2-atomicblast', name: 'SpAtomify', provider: 'b2',
                             b2Bucket: 'SpAtomify', b2Prefix: 'Music/' }],
            musicPaths: [],
          };

        case 'get-playlists': {
          const r = await fetch('/api/playlists');
          return r.ok ? r.json() : { liked: [], playlists: [] };
        }

        case 'save-playlists': {
          const r = await fetch('/api/playlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          return r.ok ? r.json() : { success: false };
        }

        case 'fetch-b2-file-text': {
          const r = await fetch('/api/b2-file-text?filePath=' + encodeURIComponent(args.filePath));
          if (!r.ok) throw new Error('b2-file-text: HTTP ' + r.status);
          return r.text();
        }

        case 'get-cloud-stream-url': {
          // Route through proxy stream endpoint
          const filePath = args.filePath || args.fileId || '';
          return '/stream?file=' + encodeURIComponent(filePath) + '&quality=flac';
        }

        case 'list-cloud-files': {
          const params = new URLSearchParams({
            sourceId:   args.sourceId   || '',
            folderPath: args.folderPath != null ? args.folderPath : '',
          });
          const r = await fetch('/api/scan-b2-music'); // return full lib for cloud tab
          if (!r.ok) return { folders: [], files: [] };
          // Cloud tab uses this for B2 folder browsing; stub as empty since we use the artist view
          return { folders: [], files: [] };
        }

        // Artist / album metadata — stubbed (no bios in web mode)
        case 'fetch-artist-meta':
        case 'fetch-album-meta':
          return null;

        // Local music library — not available in web mode
        case 'scan-music':
        case 'rescan-music':
          return { artists: [], allTracks: [] };

        // Settings — server-side only, ignore from browser
        case 'save-config':
          return { success: false };

        // Shell actions
        case 'open-url':
          window.open(typeof args === 'string' ? args : args[0], '_blank', 'noopener,noreferrer');
          return { success: true };

        case 'toggle-fullscreen':
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
            document.documentElement.requestFullscreen().catch(() => {});
          }
          return null;

        case 'quit-app':
        case 'open-folder':
          return { success: false };

        case 'resolve-stream':
          throw new Error('yt-dlp not available in web mode');

        default:
          console.warn('[ipc-shim] unhandled channel:', channel, args);
          return null;
      }
    } catch (e) {
      console.error('[ipc-shim] ' + channel + ':', e.message);
      throw e;
    }
  },

  on: (channel, fn) => {
    if (channel === 'media-key') window.__ipcMediaKeyHandler = fn;
    if (channel === 'remote-cmd') window.__ipcRemoteCmdHandler = fn;
  },

  send: () => {},
};

// Wire up Media Session API (headphone buttons, lock screen controls)
if ('mediaSession' in navigator) {
  const sendKey = (cmd) => {
    if (window.__ipcMediaKeyHandler) window.__ipcMediaKeyHandler(null, cmd);
  };
  navigator.mediaSession.setActionHandler('play',          () => sendKey('playpause'));
  navigator.mediaSession.setActionHandler('pause',         () => sendKey('playpause'));
  navigator.mediaSession.setActionHandler('nexttrack',     () => sendKey('next'));
  navigator.mediaSession.setActionHandler('previoustrack', () => sendKey('prev'));
  navigator.mediaSession.setActionHandler('stop',          () => sendKey('stop'));
}
