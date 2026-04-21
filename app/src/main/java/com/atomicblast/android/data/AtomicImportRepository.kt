package com.atomicblast.android.data

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID

class AtomicImportRepository(
    private val contentResolver: ContentResolver,
    private val b2Repository: B2Repository,
) {

    suspend fun importPlaylist(uri: Uri): Result<ImportedPlaylistPreview> = withContext(Dispatchers.IO) {
        try {
            val jsonText = readText(uri)
            val imported = parseAtomicPlaylist(jsonText)
            val libraryFiles = b2Repository.listAllFiles("Music/").getOrElse { throw it }
            val indexedLibrary = libraryFiles.map { file -> IndexedLibraryTrack(file, toLibraryMetadata(file)) }

            val matchedTracks = mutableListOf<Track>()
            val unmatchedTracks = mutableListOf<ImportedPlaylistTrack>()
            val usedPaths = mutableSetOf<String>()

            for (track in imported.tracks) {
                val match = findBestMatch(track, indexedLibrary, usedPaths)
                if (match == null) {
                    unmatchedTracks += track
                    continue
                }

                usedPaths += match.file.name
                matchedTracks += toPlayableTrack(match.file, match.metadata)
            }

            Result.success(
                ImportedPlaylistPreview(
                    sourceFileName = queryDisplayName(uri) ?: uri.lastPathSegment ?: "playlist.json",
                    playlistName = imported.playlistName,
                    totalTracks = imported.tracks.size,
                    matchedTracks = matchedTracks,
                    unmatchedTracks = unmatchedTracks,
                )
            )
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    private fun readText(uri: Uri): String {
        val stream = contentResolver.openInputStream(uri)
            ?: throw IllegalArgumentException("Unable to open selected file.")
        return stream.bufferedReader().use { it.readText() }
    }

    private fun queryDisplayName(uri: Uri): String? {
        val projection = arrayOf(OpenableColumns.DISPLAY_NAME)
        contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return null
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index < 0) return null
            return cursor.getString(index)
        }
        return null
    }

    private fun parseAtomicPlaylist(raw: String): ImportedPlaylistFile {
        val json = JSONObject(raw)
        val playlist = json.optJSONObject("playlist")
            ?: throw IllegalArgumentException("Invalid Atomic export: missing playlist section.")
        val tracksArray = json.optJSONArray("tracks")
            ?: throw IllegalArgumentException("Invalid Atomic export: missing tracks array.")

        val tracks = buildList {
            for (index in 0 until tracksArray.length()) {
                val item = tracksArray.optJSONObject(index) ?: continue
                val artistsArray = item.optJSONArray("artists")
                val artists = buildList {
                    if (artistsArray != null) {
                        for (artistIndex in 0 until artistsArray.length()) {
                            val name = artistsArray.optString(artistIndex).trim()
                            if (name.isNotEmpty()) add(name)
                        }
                    }
                }

                add(
                    ImportedPlaylistTrack(
                        title = item.optString("title").trim(),
                        artists = artists,
                        album = item.optString("album").takeIf { it.isNotBlank() },
                    )
                )
            }
        }.filter { it.title.isNotBlank() }

        return ImportedPlaylistFile(
            playlistName = playlist.optString("name").ifBlank { "Imported Playlist" },
            tracks = tracks,
        )
    }

    private fun findBestMatch(
        imported: ImportedPlaylistTrack,
        library: List<IndexedLibraryTrack>,
        usedPaths: Set<String>,
    ): IndexedLibraryTrack? {
        val unused = library.filterNot { it.file.name in usedPaths }
        val importedTitle = normalizeText(imported.title)
        val importedAlbum = normalizeText(imported.album.orEmpty())
        val importedArtists = imported.artists.map(::normalizeText).filter { it.isNotBlank() }

        fun artistOverlap(candidate: LibraryTrackMetadata): Boolean {
            if (importedArtists.isEmpty()) return true
            return importedArtists.any { artist ->
                candidate.artist.contains(artist) || artist.contains(candidate.artist)
            }
        }

        val exact = unused.firstOrNull { candidate ->
            candidate.metadata.title == importedTitle &&
                artistOverlap(candidate.metadata) &&
                (importedAlbum.isBlank() || candidate.metadata.album == importedAlbum)
        }
        if (exact != null) return exact

        val relaxed = unused.firstOrNull { candidate ->
            candidate.metadata.title == importedTitle && artistOverlap(candidate.metadata)
        }
        if (relaxed != null) return relaxed

        return unused.firstOrNull { candidate ->
            candidate.metadata.rawFileName.contains(importedTitle) || importedTitle.contains(candidate.metadata.rawFileName)
        }
    }

    private fun toPlayableTrack(file: B2File, metadata: LibraryTrackMetadata): Track {
        val albumFolder = file.name.substringBeforeLast("/")
        return Track(
            id = UUID.randomUUID().toString(),
            title = metadata.displayTitle,
            artist = metadata.displayArtist,
            album = metadata.displayAlbum,
            duration = 0L,
            format = metadata.format,
            streamUrl = b2Repository.getStreamUrl(file.name),
            filePath = file.name,
            albumArtUrl = b2Repository.getStreamUrl("$albumFolder/cover.jpg"),
        )
    }

    private fun toLibraryMetadata(file: B2File): LibraryTrackMetadata {
        val fileName = file.name.substringAfterLast("/")
        val pathParts = file.name.removePrefix("Music/").split("/")
        val artist = pathParts.getOrNull(0)?.takeIf { it.isNotBlank() } ?: "Unknown"
        val album = pathParts.getOrNull(1)?.takeIf { it.isNotBlank() } ?: ""
        val title = cleanTitle(fileName.substringBeforeLast("."))

        return LibraryTrackMetadata(
            title = normalizeText(title),
            artist = normalizeText(artist),
            album = normalizeText(album),
            displayTitle = title,
            displayArtist = artist,
            displayAlbum = album,
            rawFileName = normalizeText(fileName.substringBeforeLast(".")),
            format = fileName.substringAfterLast(".").uppercase(),
        )
    }

    private fun cleanTitle(raw: String): String =
        raw.replace(Regex("^\\d+[.\\-\\s]+"), "").trim()

    private fun normalizeText(value: String): String {
        return value
            .lowercase()
            .replace(Regex("[^\\p{L}\\p{N}\\s]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }
}

data class ImportedPlaylistPreview(
    val sourceFileName: String,
    val playlistName: String,
    val totalTracks: Int,
    val matchedTracks: List<Track>,
    val unmatchedTracks: List<ImportedPlaylistTrack>,
)

data class ImportedPlaylistTrack(
    val title: String,
    val artists: List<String>,
    val album: String?,
)

private data class ImportedPlaylistFile(
    val playlistName: String,
    val tracks: List<ImportedPlaylistTrack>,
)

private data class IndexedLibraryTrack(
    val file: B2File,
    val metadata: LibraryTrackMetadata,
)

private data class LibraryTrackMetadata(
    val title: String,
    val artist: String,
    val album: String,
    val displayTitle: String,
    val displayArtist: String,
    val displayAlbum: String,
    val rawFileName: String,
    val format: String,
)
