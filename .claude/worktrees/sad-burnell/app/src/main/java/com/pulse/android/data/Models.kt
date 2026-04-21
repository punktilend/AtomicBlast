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
    val keyId: String  = "0055a9c537f296d000000000d",
    val appKey: String = "K005VSqefUNvhByF8qlJiokNLAGIBm0",
    val bucket: String = "aharveyGoogleDriveBackup",
    val prefix: String = "Music/",
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
