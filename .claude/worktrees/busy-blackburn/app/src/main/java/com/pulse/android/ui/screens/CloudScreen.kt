package com.pulse.android.ui.screens

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
import com.pulse.android.data.B2File
import com.pulse.android.data.Track
import com.pulse.android.ui.theme.LocalPulseColors
import com.pulse.android.viewmodel.PlayerViewModel
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
fun CloudScreen(vm: PlayerViewModel, navController: NavController) {
    val colors = LocalPulseColors.current
    val isConnected by vm.isConnected.collectAsState()
    val scope = rememberCoroutineScope()

    var currentPrefix by remember { mutableStateOf("Music/") }
    var breadcrumbs by remember { mutableStateOf(listOf("Music")) }
    var files by remember { mutableStateOf<List<B2File>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var isShuffleLoading by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }

    fun loadPrefix(prefix: String) {
        scope.launch {
            isLoading = true
            loadError = null
            vm.b2.listFiles(prefix).onSuccess { files = it }.onFailure { loadError = it.message }
            isLoading = false
        }
    }

    LaunchedEffect(isConnected) {
        if (isConnected) loadPrefix(currentPrefix)
    }

    fun makeTrack(f: B2File): Track {
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
            albumArtUrl = vm.b2.getStreamUrl("$albumFolder/cover.jpg"),
        )
    }

    val trackFiles = files.filter { !it.isFolder }
    val folderFiles = files.filter { it.isFolder }

    Column(
        modifier = Modifier.fillMaxSize().background(colors.bg)
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                breadcrumbs.forEachIndexed { idx, crumb ->
                    Text(
                        text = crumb,
                        color = if (idx == breadcrumbs.lastIndex) colors.green else colors.textDim,
                        fontSize = 13.sp,
                        fontWeight = if (idx == breadcrumbs.lastIndex) FontWeight.SemiBold else FontWeight.Normal,
                        modifier = Modifier.clickable {
                            if (idx < breadcrumbs.lastIndex) {
                                val newCrumbs = breadcrumbs.take(idx + 1)
                                breadcrumbs = newCrumbs
                                currentPrefix = if (idx == 0) "Music/" else "Music/" + newCrumbs.drop(1).joinToString("/") + "/"
                                loadPrefix(currentPrefix)
                            }
                        }
                    )
                    if (idx < breadcrumbs.lastIndex) {
                        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = colors.textDim, modifier = Modifier.size(14.dp))
                    }
                }
            }
            IconButton(onClick = { loadPrefix(currentPrefix) }, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = colors.textMuted, modifier = Modifier.size(18.dp))
            }
        }

        HorizontalDivider(color = colors.border, thickness = 0.5.dp)

        when {
            !isConnected -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Not connected to B2", color = colors.textMuted, fontSize = 14.sp)
            }
            isLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = colors.green, modifier = Modifier.size(32.dp))
            }
            loadError != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Error: $loadError", color = Color(0xFFFF6B6B), fontSize = 13.sp, modifier = Modifier.padding(24.dp))
            }
            else -> LazyColumn {
                // Shuffle All button
                if (trackFiles.isNotEmpty() || folderFiles.isNotEmpty()) {
                    item {
                        Button(
                            onClick = {
                                scope.launch {
                                    isShuffleLoading = true
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
                                                albumArtUrl = vm.b2.getStreamUrl("$albumFolder/cover.jpg"),
                                            )
                                        }.shuffled()
                                        if (queue.isNotEmpty()) {
                                            vm.playTrack(queue[0], queue, 0)
                                            navController.navigate("nowplaying")
                                        }
                                    }
                                    isShuffleLoading = false
                                }
                            },
                            enabled = !isShuffleLoading,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp, vertical = 12.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = colors.greenDim,
                                contentColor = colors.green,
                            ),
                            shape = RoundedCornerShape(10.dp),
                        ) {
                            if (isShuffleLoading) {
                                CircularProgressIndicator(color = colors.green, modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                                Text("Loading all tracks…", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            } else {
                                Icon(Icons.Default.Shuffle, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("Shuffle All", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
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
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)
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
                                .padding(horizontal = 20.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(48.dp)
                                    .background(colors.greenFaint, RoundedCornerShape(8.dp))
                                    .clip(RoundedCornerShape(8.dp)),
                                contentAlignment = Alignment.Center
                            ) {
                                SubcomposeAsyncImage(
                                    model = folderArtUrl,
                                    contentDescription = null,
                                    modifier = Modifier.fillMaxSize(),
                                    contentScale = ContentScale.Crop,
                                    error = {
                                        Icon(Icons.Default.Folder, contentDescription = null, tint = colors.green, modifier = Modifier.size(22.dp))
                                    }
                                )
                            }
                            Text(name, color = colors.textPrimary, fontSize = 14.sp, modifier = Modifier.weight(1f))
                            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = colors.textDim, modifier = Modifier.size(16.dp))
                        }
                        HorizontalDivider(color = colors.border, thickness = 0.5.dp)
                    }
                }

                // Tracks
                if (trackFiles.isNotEmpty()) {
                    item {
                        Text(
                            "TRACKS",
                            color = colors.textDim,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp,
                            modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 6.dp)
                        )
                    }
                    itemsIndexed(trackFiles) { idx, file ->
                        val name = file.name.removePrefix(currentPrefix).trimEnd('/')
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    val queue = trackFiles.map { makeTrack(it) }
                                    vm.playTrack(queue[idx], queue, idx)
                                    navController.navigate("nowplaying")
                                }
                                .padding(horizontal = 20.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Icon(Icons.Default.AudioFile, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(18.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    cleanTitle(name.substringBeforeLast(".")),
                                    color = colors.textPrimary,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                )
                            }
                            val fmt = name.substringAfterLast(".").uppercase()
                            Text(
                                fmt,
                                color = if (fmt == "FLAC") colors.green else colors.textDim,
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .background(
                                        if (fmt == "FLAC") colors.greenFaint else colors.surface2,
                                        RoundedCornerShape(4.dp)
                                    )
                                    .padding(horizontal = 5.dp, vertical = 2.dp)
                            )
                            if (file.size > 0) {
                                Text(formatSize(file.size), color = colors.textDim, fontSize = 11.sp)
                            }
                        }
                        HorizontalDivider(color = colors.border, thickness = 0.5.dp)
                    }
                }
            }
        }
    }
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
