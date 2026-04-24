package com.atomicblast.android.data

enum class StreamQuality(val label: String, val param: String) {
    FLAC("FLAC (Direct)", "flac"),
    HIGH("High · 320k MP3", "high"),
    MEDIUM("Medium · 192k MP3", "medium"),
    LOW("Low · 128k AAC", "low"),
}

data class Track(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val duration: Long,       // ms
    val format: String,
    val streamUrl: String,
    val filePath: String = "",  // raw B2 path for proxy streaming
    val albumArtUrl: String? = null,
    val trackNumber: Int = 0,
    val cueStartMs: Long? = null,  // chapter start for CUE sheet tracks (ms)
    val cueEndMs: Long? = null,    // chapter end for CUE sheet tracks (ms, null = play to end of file)
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

data class CollectionArtistPopularity(
    val name: String,
    val albums: Int = 0,
    val tracks: Int = 0,
    val localScore: Double = 0.0,
    val listenersRaw: Long = 0L,
    val playcountRaw: Long = 0L,
    val listeners: String? = null,
    val image: String? = null,
    val popularityScore: Double = 0.0,
)

data class B2Config(
    val keyId: String  = com.atomicblast.android.BuildConfig.B2_KEY_ID,
    val appKey: String = com.atomicblast.android.BuildConfig.B2_APP_KEY,
    val bucket: String = com.atomicblast.android.BuildConfig.B2_BUCKET,
    val prefix: String = com.atomicblast.android.BuildConfig.B2_PREFIX,
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

data class Favorite(
    val filePath: String,
    val title: String,
    val artist: String,
    val album: String,
    val format: String,
    val addedAt: String = "",
)

