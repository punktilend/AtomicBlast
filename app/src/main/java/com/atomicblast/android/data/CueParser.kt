package com.atomicblast.android.data

data class CueChapter(
    val number: Int,
    val title: String,
    val performer: String?,
    val startMs: Long,
)

data class ParsedCue(
    val audioFileName: String,   // filename from FILE directive
    val albumTitle: String,
    val albumPerformer: String?,
    val chapters: List<CueChapter>,
)

object CueParser {
    /** Parse a CUE sheet string. Returns null if the sheet is malformed or has no tracks. */
    fun parse(content: String): ParsedCue? {
        // Strip BOM (UTF-8, UTF-16 LE/BE)
        val text = content.trimStart('\uFEFF', '\uFFFE')

        var audioFileName: String? = null
        var albumTitle = ""
        var albumPerformer: String? = null
        val chapters = mutableListOf<CueChapter>()
        var fileCount = 0

        var currentTrackNum = -1
        var currentTitle: String? = null
        var currentPerformer: String? = null
        var currentStartMs = -1L

        for (rawLine in text.lines()) {
            val line = rawLine.trim()
            when {
                line.startsWith("FILE ", ignoreCase = true) -> {
                    fileCount++
                    val after = line.substring(5).trim()
                    audioFileName = if (after.startsWith("\"")) {
                        after.substringAfter("\"").substringBefore("\"")
                    } else {
                        // No quotes: strip the trailing type token (WAVE, MP3, etc.)
                        after.substringBeforeLast(" ").trim()
                    }
                }
                line.startsWith("TRACK ", ignoreCase = true) -> {
                    if (currentTrackNum >= 0 && currentStartMs >= 0) {
                        chapters += CueChapter(
                            number = currentTrackNum,
                            title = currentTitle ?: "Track $currentTrackNum",
                            performer = currentPerformer,
                            startMs = currentStartMs,
                        )
                    }
                    currentTrackNum = line.substring(6).trim()
                        .split(Regex("\\s+")).firstOrNull()?.toIntOrNull() ?: -1
                    currentTitle = null
                    currentPerformer = null
                    currentStartMs = -1L
                }
                line.startsWith("TITLE ", ignoreCase = true) -> {
                    val t = line.substring(6).trim().removeSurrounding("\"")
                    if (currentTrackNum < 0) albumTitle = t else currentTitle = t
                }
                line.startsWith("PERFORMER ", ignoreCase = true) -> {
                    val p = line.substring(10).trim().removeSurrounding("\"")
                    if (currentTrackNum < 0) albumPerformer = p else currentPerformer = p
                }
                line.startsWith("INDEX 01 ", ignoreCase = true) -> {
                    currentStartMs = parseCueTime(line.substring(9).trim())
                }
            }
        }
        // Flush last track
        if (currentTrackNum >= 0 && currentStartMs >= 0) {
            chapters += CueChapter(
                number = currentTrackNum,
                title = currentTitle ?: "Track $currentTrackNum",
                performer = currentPerformer,
                startMs = currentStartMs,
            )
        }

        return if (audioFileName.isNullOrBlank() || chapters.isEmpty() || fileCount > 1) null
        else ParsedCue(audioFileName!!, albumTitle, albumPerformer, chapters)
    }

    /** Convert CUE time string (MM:SS:FF, 75 frames/sec) to milliseconds. */
    private fun parseCueTime(time: String): Long {
        val parts = time.split(":")
        val mm = parts.getOrNull(0)?.toLongOrNull() ?: 0L
        val ss = parts.getOrNull(1)?.toLongOrNull() ?: 0L
        val ff = parts.getOrNull(2)?.toLongOrNull() ?: 0L
        return mm * 60_000L + ss * 1_000L + ff * 1_000L / 75L
    }
}

