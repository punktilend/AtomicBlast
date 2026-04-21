package com.pulse.android.data

data class Track(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val duration: Long,       // ms
    val format: String,
    val streamUrl: String,
    val albumArtUrl: String? = null,
    val trackNumber: Int = 0,
)

data class Album(
    val name: String,
    val artist: String,
    val tracks: List<Track>,
    val artUrl: String? = null,
)

data class Artist(
    val name: String,
    val albums: List<Album>,
)

data class B2Config(
    val keyId: String  = com.pulse.android.BuildConfig.B2_KEY_ID,
    val appKey: String = com.pulse.android.BuildConfig.B2_APP_KEY,
    val bucket: String = com.pulse.android.BuildConfig.B2_BUCKET,
    val prefix: String = com.pulse.android.BuildConfig.B2_PREFIX,
)

sealed class PlayerState {
    object Idle    : PlayerState()
    object Loading : PlayerState()
    object Playing : PlayerState()
    object Paused  : PlayerState()
    data class Error(val message: String) : PlayerState()
}

data class NowPlaying(
    val track: Track? = null,
    val state: PlayerState = PlayerState.Idle,
    val positionMs: Long = 0L,
    val queue: List<Track> = emptyList(),
    val queueIndex: Int = 0,
)
