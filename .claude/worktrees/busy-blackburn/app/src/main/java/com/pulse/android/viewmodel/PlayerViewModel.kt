package com.pulse.android.viewmodel

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.pulse.android.data.B2Config
import com.pulse.android.data.B2Repository
import com.pulse.android.data.NowPlaying
import com.pulse.android.data.PlayerState
import com.pulse.android.data.Track
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class PlayerViewModel(application: Application) : AndroidViewModel(application) {

    val b2 = B2Repository(B2Config())

    private val prefs = application.getSharedPreferences("pulse_prefs", Context.MODE_PRIVATE)
    private val _isDarkTheme = MutableStateFlow(prefs.getBoolean("dark_theme", true))
    val isDarkTheme: StateFlow<Boolean> = _isDarkTheme.asStateFlow()

    fun toggleTheme() {
        val new = !_isDarkTheme.value
        _isDarkTheme.value = new
        prefs.edit().putBoolean("dark_theme", new).apply()
    }

    private val _nowPlaying = MutableStateFlow(NowPlaying())
    val nowPlaying: StateFlow<NowPlaying> = _nowPlaying.asStateFlow()

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _shuffleMode = MutableStateFlow(false)
    val shuffleMode: StateFlow<Boolean> = _shuffleMode.asStateFlow()

    private val player: ExoPlayer = ExoPlayer.Builder(application).build().apply {
        addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                _nowPlaying.update { it.copy(state = if (isPlaying) PlayerState.Playing else PlayerState.Paused) }
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) skipNext()
            }
            override fun onPlayerError(error: PlaybackException) {
                _error.value = "Playback error: ${error.message}"
                _nowPlaying.update { it.copy(state = PlayerState.Error(error.message ?: "Unknown error")) }
            }
        })
    }

    init {
        connectToB2()
    }

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
        val uri = android.net.Uri.parse(track.streamUrl)
        val item = MediaItem.Builder()
            .setUri(uri)
            .setMediaId(track.id)
            .build()
        player.setMediaItem(item)
        player.prepare()
        player.play()
    }

    fun playPause() {
        if (player.isPlaying) player.pause() else player.play()
    }

    fun toggleShuffle() { _shuffleMode.update { !it } }

    fun skipNext() {
        val np = _nowPlaying.value
        if (_shuffleMode.value && np.queue.size > 1) {
            val nextIndex = (np.queue.indices - np.queueIndex).random()
            playTrack(np.queue[nextIndex], np.queue, nextIndex)
        } else {
            val nextIndex = np.queueIndex + 1
            if (nextIndex < np.queue.size) {
                playTrack(np.queue[nextIndex], np.queue, nextIndex)
            }
        }
    }

    fun skipPrev() {
        val np = _nowPlaying.value
        if (player.currentPosition > 3000) {
            player.seekTo(0)
            return
        }
        val prevIndex = np.queueIndex - 1
        if (prevIndex >= 0) {
            playTrack(np.queue[prevIndex], np.queue, prevIndex)
        }
    }

    fun seekTo(ms: Long) = player.seekTo(ms)

    fun currentPosition() = player.currentPosition
    fun currentDuration() = player.duration.takeIf { it > 0 } ?: 0L

    fun clearError() { _error.value = null }

    override fun onCleared() {
        player.release()
        super.onCleared()
    }
}
