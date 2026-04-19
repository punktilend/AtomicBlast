package com.atomicblast.android.viewmodel

import android.app.Application
import android.content.Context
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import com.atomicblast.android.data.AlbumMeta
import com.atomicblast.android.data.AtomicImportRepository
import com.atomicblast.android.data.ArtistMeta
import com.atomicblast.android.data.B2Config
import com.atomicblast.android.data.B2Repository
import com.atomicblast.android.data.Favorite
import com.atomicblast.android.data.FavoritesRepository
import com.atomicblast.android.data.ImportedPlaylistPreview
import com.atomicblast.android.data.MetadataRepository
import com.atomicblast.android.data.NowPlaying
import com.atomicblast.android.data.PlayerState
import com.atomicblast.android.data.StreamQuality
import com.atomicblast.android.data.Track
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

class PlayerViewModel(application: Application) : AndroidViewModel(application) {

    private val httpClient = OkHttpClient()
    val b2 = B2Repository(B2Config(), httpClient)
    private val favRepo = FavoritesRepository(client = httpClient)
    val metaRepo = MetadataRepository(httpClient)
    private val atomicImportRepository = AtomicImportRepository(application.contentResolver, b2)
    private val _artistMeta = MutableStateFlow<Map<String, ArtistMeta>>(emptyMap())
    val artistMeta: StateFlow<Map<String, ArtistMeta>> = _artistMeta.asStateFlow()
    private val _albumMeta = MutableStateFlow<Map<String, AlbumMeta>>(emptyMap())
    val albumMeta: StateFlow<Map<String, AlbumMeta>> = _albumMeta.asStateFlow()

    private val _favorites = MutableStateFlow<List<Favorite>>(emptyList())
    val favorites: StateFlow<List<Favorite>> = _favorites.asStateFlow()

    private val prefs = application.getSharedPreferences("atomicblast_prefs", Context.MODE_PRIVATE)
    private val _isDarkTheme = MutableStateFlow(prefs.getBoolean("dark_theme", true))
    val isDarkTheme: StateFlow<Boolean> = _isDarkTheme.asStateFlow()

    fun toggleTheme() {
        val new = !_isDarkTheme.value
        _isDarkTheme.value = new
        prefs.edit().putBoolean("dark_theme", new).apply()
    }

    private val _streamQuality = MutableStateFlow(
        StreamQuality.valueOf(prefs.getString("stream_quality", StreamQuality.FLAC.name) ?: StreamQuality.FLAC.name)
    )
    val streamQuality: StateFlow<StreamQuality> = _streamQuality.asStateFlow()

    fun setStreamQuality(quality: StreamQuality) {
        _streamQuality.value = quality
        prefs.edit().putString("stream_quality", quality.name).apply()
    }

    private val _nowPlaying = MutableStateFlow(NowPlaying())
    val nowPlaying: StateFlow<NowPlaying> = _nowPlaying.asStateFlow()

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _isImporting = MutableStateFlow(false)
    val isImporting: StateFlow<Boolean> = _isImporting.asStateFlow()
    private val _importError = MutableStateFlow<String?>(null)
    val importError: StateFlow<String?> = _importError.asStateFlow()
    private val _importPreview = MutableStateFlow<ImportedPlaylistPreview?>(null)
    val importPreview: StateFlow<ImportedPlaylistPreview?> = _importPreview.asStateFlow()

    private val _shuffleMode = MutableStateFlow(false)
    val shuffleMode: StateFlow<Boolean> = _shuffleMode.asStateFlow()

    private val player: ExoPlayer = ExoPlayer.Builder(application)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build(),
            /* handleAudioFocus= */ true
        )
        .setHandleAudioBecomingNoisy(true)
        .build()
        .apply {
            addListener(object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    _nowPlaying.update { it.copy(state = if (isPlaying) PlayerState.Playing else PlayerState.Paused) }
                }
                // ExoPlayer handles mid-queue transitions automatically; we just sync state.
                override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                    val idx = currentMediaItemIndex
                    val queue = _nowPlaying.value.queue
                    if (idx in queue.indices) {
                        _nowPlaying.update { it.copy(track = queue[idx], queueIndex = idx) }
                    }
                }
                override fun onPlayerError(error: PlaybackException) {
                    _error.value = "Playback error: ${error.message}"
                    _nowPlaying.update { it.copy(state = PlayerState.Error(error.message ?: "Unknown error")) }
                }
            })
        }

    // Exposes the player to the Android media system so car controls (AVRCP),
    // notification controls, and headset buttons all work.
    private val mediaSession: MediaSession = MediaSession.Builder(application, player).build()

    init {
        connectToB2()
        loadFavorites()
    }

    fun loadFavorites() {
        viewModelScope.launch {
            favRepo.getFavorites().onSuccess { _favorites.value = it }
        }
    }

    fun toggleFavorite(track: Track) {
        viewModelScope.launch {
            val isFav = _favorites.value.any { it.filePath == track.filePath }
            if (isFav) {
                favRepo.removeFavorite(track.filePath).onSuccess { _favorites.value = it }
            } else {
                favRepo.addFavorite(track).onSuccess { _favorites.value = it }
            }
        }
    }

    fun isFavorite(filePath: String) = _favorites.value.any { it.filePath == filePath }

    fun connectToB2() {
        viewModelScope.launch {
            _nowPlaying.update { it.copy(state = PlayerState.Loading) }
            b2.authorize().onSuccess {
                _isConnected.value = true
                _nowPlaying.update { it.copy(state = PlayerState.Idle) }
            }.onFailure { e ->
                _error.value = "B2 connection failed: ${e.message}"
                _nowPlaying.update { it.copy(state = PlayerState.Idle) }
            }
        }
    }

    fun playTrack(track: Track, queue: List<Track> = listOf(track), queueIndex: Int = 0) {
        _nowPlaying.update { it.copy(track = track, queue = queue, queueIndex = queueIndex, state = PlayerState.Loading) }
        val quality = _streamQuality.value
        // Load the entire queue into ExoPlayer so native skip (including car controls) works.
        val mediaItems = queue.map { t ->
            val url = if (quality == StreamQuality.FLAC || t.filePath.isEmpty()) {
                t.streamUrl
            } else {
                b2.getProxyStreamUrl(t.filePath, quality.param)
            }
            val builder = MediaItem.Builder()
                .setUri(android.net.Uri.parse(url))
                .setMediaId(t.id)
            // For CUE sheet chapters, clip ExoPlayer to the chapter's time range so that
            // the seek bar, duration, and auto-advance all work correctly per chapter.
            if (t.cueStartMs != null || t.cueEndMs != null) {
                builder.setClippingConfiguration(
                    MediaItem.ClippingConfiguration.Builder()
                        .apply {
                            t.cueStartMs?.let { setStartPositionMs(it) }
                            t.cueEndMs?.let { setEndPositionMs(it) }
                        }
                        .build()
                )
            }
            builder.build()
        }
        player.setMediaItems(mediaItems, queueIndex, /* startPositionMs= */ 0L)
        player.prepare()
        player.play()
    }

    fun playPause() {
        if (player.isPlaying) player.pause() else player.play()
    }

    fun toggleShuffle() {
        val new = !_shuffleMode.value
        _shuffleMode.value = new
        player.shuffleModeEnabled = new
    }

    fun skipNext() {
        if (player.hasNextMediaItem()) player.seekToNextMediaItem()
    }

    fun skipPrev() {
        if (player.currentPosition > 3000) {
            player.seekTo(0)
            return
        }
        if (player.hasPreviousMediaItem()) player.seekToPreviousMediaItem()
    }

    fun seekTo(ms: Long) = player.seekTo(ms)

    fun currentPosition() = player.currentPosition
    fun currentDuration() = player.duration.takeIf { it > 0 } ?: 0L

    fun clearError() { _error.value = null }

    fun importAtomicPlaylist(uri: Uri) {
        viewModelScope.launch {
            _isImporting.value = true
            _importError.value = null

            if (!_isConnected.value) {
                b2.authorize()
                    .onSuccess { _isConnected.value = true }
                    .onFailure { error ->
                        _importError.value = "Atomic import failed: could not connect to B2 (${error.message})"
                        _isImporting.value = false
                        return@launch
                    }
            }

            atomicImportRepository.importPlaylist(uri)
                .onSuccess { preview ->
                    _importPreview.value = preview
                }
                .onFailure { error ->
                    _importError.value = "Atomic import failed: ${error.message}"
                }

            _isImporting.value = false
        }
    }

    fun playImportedPreview(): Boolean {
        val preview = _importPreview.value ?: return false
        if (preview.matchedTracks.isEmpty()) return false
        playTrack(preview.matchedTracks.first(), preview.matchedTracks, 0)
        return true
    }

    fun clearImportPreview() {
        _importPreview.value = null
        _importError.value = null
    }

    fun loadArtistMeta(name: String) {
        if (_artistMeta.value.containsKey(name)) return
        viewModelScope.launch {
            try {
                val meta = metaRepo.fetchArtistMeta(name)
                _artistMeta.update { it + (name to meta) }
            } catch (_: Exception) {}
        }
    }

    fun loadAlbumMeta(artist: String, album: String) {
        val key = "$artist\u0000$album"
        if (_albumMeta.value.containsKey(key)) return
        viewModelScope.launch {
            try {
                val meta = metaRepo.fetchAlbumMeta(artist, album)
                _albumMeta.update { it + (key to meta) }
            } catch (_: Exception) {}
        }
    }

    override fun onCleared() {
        mediaSession.release()
        player.release()
        httpClient.dispatcher.executorService.shutdown()
        httpClient.connectionPool.evictAll()
        super.onCleared()
    }
}
