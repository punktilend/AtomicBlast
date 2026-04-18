package com.atomicblast.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import coil.compose.SubcomposeAsyncImage
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.atomicblast.android.data.B2File
import com.atomicblast.android.data.CueParser
import com.atomicblast.android.data.Track
import com.atomicblast.android.ui.Screen
import com.atomicblast.android.ui.theme.LocalAtomicBlastColors
import com.atomicblast.android.viewmodel.PlayerViewModel
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
fun CloudScreen(vm: PlayerViewModel, navController: NavController, startPrefix: String = "Music/") {
    val colors = LocalAtomicBlastColors.current
    val isConnected by vm.isConnected.collectAsState()
    val scope = rememberCoroutineScope()

    val initialBreadcrumbs = remember(startPrefix) {
        if (startPrefix == "Music/") listOf("Music")
        else {
            val parts = startPrefix.removePrefix("Music/").trimEnd('/').split("/")
            listOf("Music") + parts.filter { it.isNotEmpty() }
        }
    }

    var currentPrefix by remember(startPrefix) { mutableStateOf(startPrefix) }
    var breadcrumbs by remember(startPrefix) { mutableStateOf(initialBreadcrumbs) }
    var files by remember { mutableStateOf<List<B2File>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var isShuffleLoading by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }

    // CUE sheet expansion state — non-null when the current folder has a CUE + single audio file
    var expandedTracks by remember { mutableStateOf<List<Track>?>(null) }
    var isCueLoading by remember { mutableStateOf(false) }

    fun loadPrefix(prefix: String) {
        scope.launch {
            isLoading = true
            loadError = null
            expandedTracks = null  // reset CUE tracks when entering a new folder
            vm.b2.listFiles(prefix).onSuccess { files = it }.onFailure { loadError = it.message }
            isLoading = false
        }
    }

    LaunchedEffect(isConnected) {
        if (isConnected) loadPrefix(currentPrefix)
    }

    // When the file list changes, check for a CUE sheet and expand it into chapter tracks.
    LaunchedEffect(files) {
        val cueFile = files.firstOrNull { !it.isFolder && it.name.endsWith(".cue", ignoreCase = true) }
        if (cueFile == null) {
            expandedTracks = null
            isCueLoading = false
            return@LaunchedEffect
        }
        isCueLoading = true
        vm.b2.fetchFileText(cueFile.name).onSuccess { content ->
            val parsed = CueParser.parse(content)
            if (parsed != null) {
                // Find the audio file referenced in the CUE FILE directive (case-insensitive)
                val audioB2File = files.firstOrNull { f ->
                    !f.isFolder &&
                        f.name.substringAfterLast("/").equals(parsed.audioFileName, ignoreCase = true)
                } ?: files.firstOrNull { f ->
                    // Fallback: any audio file in the folder (covers CUE files with odd filename references)
                    !f.isFolder && f.name.substringAfterLast(".").lowercase() in
                        setOf("flac", "wav", "mp3", "ogg", "m4a", "aac")
                }
                if (audioB2File != null) {
                    val albumFolder = audioB2File.name.substringBeforeLast("/")
                    val artist = parsed.albumPerformer ?: (breadcrumbs.getOrNull(1) ?: "Unknown")
                    val album = if (breadcrumbs.size >= 3) breadcrumbs.last()
                                else parsed.albumTitle.ifEmpty { breadcrumbs.lastOrNull() ?: "" }
                    val artUrl = vm.b2.getStreamUrl("$albumFolder/cover.jpg")
                    val format = parsed.audioFileName.substringAfterLast(".").uppercase()

                    expandedTracks = parsed.chapters.mapIndexed { i, chapter ->
                        val endMs = parsed.chapters.getOrNull(i + 1)?.startMs
                        Track(
                            id = UUID.randomUUID().toString(),
                            title = chapter.title,
                            artist = chapter.performer ?: artist,
                            album = album,
                            duration = if (endMs != null) endMs - chapter.startMs else 0L,
                            format = format,
                            streamUrl = vm.b2.getStreamUrl(audioB2File.name),
                            filePath = audioB2File.name,
                            albumArtUrl = artUrl,
                            trackNumber = chapter.number,
                            cueStartMs = chapter.startMs,
                            cueEndMs = endMs,
                        )
                    }
                }
            }
        }
        isCueLoading = false
    }

    val favorites by vm.favorites.collectAsState()

    val audioExtensions = setOf("mp3", "flac", "aac", "ogg", "wav", "m4a", "opus", "wma")
    val artworkFolderNames = setOf("artwork", "scans", "covers", "images", "art", "booklet", "extras")
    val trackFiles = files.filter { !it.isFolder && it.name.substringAfterLast(".").lowercase() in audioExtensions }
    val folderFiles = files.filter { it.isFolder }.filterNot { f ->
        val folderName = f.name.trimEnd('/').substringAfterLast("/").lowercase()
        artworkFolderNames.any { folderName.contains(it) }
    }
    val coverArtUrl = vm.b2.getStreamUrl("${currentPrefix}cover.jpg")
    val tracks = remember(trackFiles, currentPrefix, breadcrumbs) {
        trackFiles.map { makeTrack(it, currentPrefix, breadcrumbs, vm) }
    }

    // CUE tracks override raw audio file listing when present
    val displayTracks: List<Track> = expandedTracks ?: tracks
    val isFromCue = expandedTracks != null

    Column(
        modifier = Modifier.fillMaxSize().background(colors.bg)
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp, vertical = 24.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                breadcrumbs.forEachIndexed { idx, crumb ->
                    val label = if (idx == 0) "Artists" else crumb
                    Text(
                        text = label,
                        color = if (idx == breadcrumbs.lastIndex) colors.green else colors.textDim,
                        fontSize = 24.sp,
                        fontWeight = if (idx == breadcrumbs.lastIndex) FontWeight.SemiBold else FontWeight.Normal,
                        modifier = Modifier.clickable {
                            if (idx == 0) {
                                navController.navigate(Screen.Dashboard.route) {
                                    popUpTo(Screen.Dashboard.route) { inclusive = true }
                                    launchSingleTop = true
                                }
                            } else if (idx < breadcrumbs.lastIndex) {
                                val newCrumbs = breadcrumbs.take(idx + 1)
                                breadcrumbs = newCrumbs
                                currentPrefix = "Music/" + newCrumbs.drop(1).joinToString("/") + "/"
                                loadPrefix(currentPrefix)
                            }
                        }
                    )
                    if (idx < breadcrumbs.lastIndex) {
                        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = colors.textDim, modifier = Modifier.size(24.dp))
                    }
                }
            }
            IconButton(onClick = { loadPrefix(currentPrefix) }, modifier = Modifier.size(56.dp)) {
                Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = colors.textMuted, modifier = Modifier.size(32.dp))
            }
        }

        HorizontalDivider(color = colors.border, thickness = 1.dp)

        when {
            !isConnected -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Not connected to B2", color = colors.textMuted, fontSize = 18.sp)
            }
            isLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = colors.green, modifier = Modifier.size(48.dp), strokeWidth = 4.dp)
            }
            loadError != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Error: $loadError", color = Color(0xFFFF6B6B), fontSize = 16.sp, modifier = Modifier.padding(32.dp))
            }
            else -> LazyColumn {
                // Shuffle All button
                if (expandedTracks != null || trackFiles.isNotEmpty() || folderFiles.isNotEmpty()) {
                    item {
                        Button(
                            onClick = {
                                scope.launch {
                                    isShuffleLoading = true
                                    val cueQueue = expandedTracks
                                    if (cueQueue != null) {
                                        // CUE folder: shuffle the chapters we already have
                                        val shuffled = cueQueue.shuffled()
                                        vm.playTrack(shuffled[0], shuffled, 0)
                                        navController.navigate("nowplaying")
                                    } else {
                                        vm.b2.listAllFiles(currentPrefix).onSuccess { allFiles ->
                                            val queue = allFiles.map { f ->
                                                val fileName = f.name.substringAfterLast("/")
                                                val albumFolder = f.name.substringBeforeLast("/")
                                                val parts = f.name.removePrefix("Music/").split("/")
                                                val artist = if (parts.size > 1) parts[0] else "Unknown"
                                                val album = if (parts.size > 2) parts[1] else ""
                                                Track(
                                                    id = UUID.randomUUID().toString(),
                                                    title = cleanTitle(fileName.substringBeforeLast(".")),
                                                    artist = artist,
                                                    album = album,
                                                    duration = 0L,
                                                    format = fileName.substringAfterLast(".").uppercase(),
                                                    streamUrl = vm.b2.getStreamUrl(f.name),
                                                    filePath = f.name,
                                                    albumArtUrl = vm.b2.getStreamUrl("$albumFolder/cover.jpg"),
                                                )
                                            }.shuffled()
                                            if (queue.isNotEmpty()) {
                                                vm.playTrack(queue[0], queue, 0)
                                                navController.navigate("nowplaying")
                                            }
                                        }
                                    }
                                    isShuffleLoading = false
                                }
                            },
                            enabled = !isShuffleLoading,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 24.dp, vertical = 16.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = colors.greenDim,
                                contentColor = colors.green,
                            ),
                            shape = RoundedCornerShape(12.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 24.dp, vertical = 12.dp)
                        ) {
                            if (isShuffleLoading) {
                                CircularProgressIndicator(color = colors.green, modifier = Modifier.size(24.dp), strokeWidth = 3.dp)
                                Spacer(Modifier.width(12.dp))
                                Text("Loading all tracks…", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                            } else {
                                Icon(Icons.Default.Shuffle, contentDescription = null, modifier = Modifier.size(24.dp))
                                Spacer(Modifier.width(12.dp))
                                Text("Shuffle All", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }

                // Folders
                if (folderFiles.isNotEmpty()) {
                    item {
                        Text(
                            "FOLDERS",
                            color = colors.textDim,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp,
                            modifier = Modifier.padding(horizontal = 32.dp, vertical = 12.dp)
                        )
                    }
                    itemsIndexed(folderFiles) { _, folder ->
                        val name = folder.name.removePrefix(currentPrefix).trimEnd('/')
                        val folderArtFile = if (breadcrumbs.size == 1) "artist.jpg" else "cover.jpg"
                        val folderArtUrl = vm.b2.getStreamUrl("${folder.name}$folderArtFile")
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    breadcrumbs = breadcrumbs + name
                                    currentPrefix = folder.name
                                    loadPrefix(folder.name)
                                }
                                .padding(horizontal = 32.dp, vertical = 16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(20.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(72.dp)
                                    .background(colors.greenFaint, RoundedCornerShape(12.dp))
                                    .clip(RoundedCornerShape(12.dp)),
                                contentAlignment = Alignment.Center
                            ) {
                                SubcomposeAsyncImage(
                                    model = folderArtUrl,
                                    contentDescription = null,
                                    modifier = Modifier.fillMaxSize(),
                                    contentScale = ContentScale.Crop,
                                    error = {
                                        Icon(Icons.Default.Folder, contentDescription = null, tint = colors.green, modifier = Modifier.size(36.dp))
                                    }
                                )
                            }
                            Text(name, color = colors.textPrimary, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = colors.textDim, modifier = Modifier.size(28.dp))
                        }
                        HorizontalDivider(color = colors.border, thickness = 1.dp)
                    }
                }

                // Tracks (regular files or CUE chapters)
                when {
                    isCueLoading -> item {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator(color = colors.green, modifier = Modifier.size(36.dp), strokeWidth = 3.dp)
                        }
                    }
                    displayTracks.isNotEmpty() -> {
                        item {
                            Text(
                                if (isFromCue) "TRACKS (CUE)" else "TRACKS",
                                color = colors.textDim,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 1.sp,
                                modifier = Modifier.padding(start = 32.dp, end = 32.dp, top = 24.dp, bottom = 12.dp)
                            )
                        }
                        itemsIndexed(displayTracks) { idx, track ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        vm.playTrack(track, displayTracks, idx)
                                        navController.navigate("nowplaying")
                                    }
                                    .padding(horizontal = 32.dp, vertical = 16.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(20.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(64.dp)
                                        .background(colors.surface, RoundedCornerShape(8.dp))
                                        .clip(RoundedCornerShape(8.dp)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    SubcomposeAsyncImage(
                                        model = track.albumArtUrl ?: coverArtUrl,
                                        contentDescription = null,
                                        modifier = Modifier.fillMaxSize(),
                                        contentScale = ContentScale.Crop,
                                        error = {
                                            Icon(Icons.Default.AudioFile, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(32.dp))
                                        }
                                    )
                                }
                                Column(modifier = Modifier.weight(1f)) {
                                    val displayTitle = if (isFromCue && track.trackNumber > 0)
                                        "${track.trackNumber}. ${track.title}"
                                    else
                                        track.title
                                    Text(
                                        displayTitle,
                                        color = colors.textPrimary,
                                        fontSize = 22.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                    )
                                }
                                // Duration for CUE chapters
                                if (isFromCue && track.duration > 0L) {
                                    Text(
                                        formatDuration(track.duration),
                                        color = colors.textDim,
                                        fontSize = 16.sp,
                                    )
                                }
                                // File size for regular tracks
                                if (!isFromCue) {
                                    val b2File = trackFiles.getOrNull(idx)
                                    if (b2File != null && b2File.size > 0) {
                                        Text(formatSize(b2File.size), color = colors.textDim, fontSize = 16.sp)
                                    }
                                }
                                Text(
                                    track.format,
                                    color = if (track.format == "FLAC") colors.green else colors.textDim,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier
                                        .background(
                                            if (track.format == "FLAC") colors.greenFaint else colors.surface2,
                                            RoundedCornerShape(6.dp)
                                        )
                                        .padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                                val isFav = favorites.any { it.filePath == track.filePath }
                                IconButton(
                                    onClick = { vm.toggleFavorite(track) },
                                    modifier = Modifier.size(56.dp)
                                ) {
                                    Icon(
                                        if (isFav) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                                        contentDescription = if (isFav) "Remove favorite" else "Add favorite",
                                        tint = if (isFav) Color(0xFFEF4444) else colors.textDim,
                                        modifier = Modifier.size(32.dp)
                                    )
                                }
                            }
                            HorizontalDivider(color = colors.border, thickness = 1.dp)
                        }
                    }
                }
            }
        }

    }
}

private fun makeTrack(f: B2File, currentPrefix: String, breadcrumbs: List<String>, vm: PlayerViewModel): Track {
    val name = f.name.removePrefix(currentPrefix).trimEnd('/')
    val fileName = name.substringAfterLast("/")
    val albumFolder = f.name.substringBeforeLast("/")
    return Track(
        id = UUID.randomUUID().toString(),
        title = cleanTitle(fileName.substringBeforeLast(".")),
        artist = breadcrumbs.getOrNull(1) ?: "Unknown",
        album = breadcrumbs.lastOrNull() ?: "",
        duration = 0L,
        format = fileName.substringAfterLast(".").uppercase(),
        streamUrl = vm.b2.getStreamUrl(f.name),
        filePath = f.name,
        albumArtUrl = vm.b2.getStreamUrl("$albumFolder/cover.jpg"),
    )
}

private fun cleanTitle(raw: String): String =
    raw.replace(Regex("^\\d+[.\\-\\s]+"), "").trim()

private fun formatSize(bytes: Long): String {
    return when {
        bytes >= 1_000_000 -> "%.1f MB".format(bytes / 1_000_000.0)
        bytes >= 1_000     -> "%.0f KB".format(bytes / 1_000.0)
        else               -> "$bytes B"
    }
}

private fun formatDuration(ms: Long): String {
    val totalSec = ms / 1000
    val min = totalSec / 60
    val sec = totalSec % 60
    return "%d:%02d".format(min, sec)
}

