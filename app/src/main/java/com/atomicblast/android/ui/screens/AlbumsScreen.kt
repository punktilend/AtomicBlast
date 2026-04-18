package com.atomicblast.android.ui.screens

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import coil.compose.SubcomposeAsyncImage
import com.atomicblast.android.data.Track
import com.atomicblast.android.ui.theme.LocalAtomicBlastColors
import com.atomicblast.android.viewmodel.PlayerViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.util.UUID

private data class AlbumEntry(
    val name: String,
    val artist: String,
    val prefix: String,
    val coverUrl: String,
)

private val artworkFolderNames = setOf("artwork", "scans", "covers", "images", "art", "booklet", "extras")

@Composable
fun AlbumsScreen(vm: PlayerViewModel, navController: NavController) {
    val colors = LocalAtomicBlastColors.current
    val isConnected by vm.isConnected.collectAsState()
    val scope = rememberCoroutineScope()

    var albums by remember { mutableStateOf<List<AlbumEntry>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var isShuffleLoading by remember { mutableStateOf(false) }

    LaunchedEffect(isConnected) {
        if (isConnected && albums.isEmpty()) {
            isLoading = true
            loadError = null
            try {
                vm.b2.listFiles("Music/").onSuccess { artistFolders ->
                    val all = mutableListOf<AlbumEntry>()
                    coroutineScope {
                        artistFolders.filter { it.isFolder }.map { artist ->
                            async {
                                vm.b2.listFiles(artist.name).onSuccess { children ->
                                    val artistName = artist.name.removePrefix("Music/").trimEnd('/')
                                    children.filter { it.isFolder }.forEach { album ->
                                        val albumName = album.name.removePrefix(artist.name).trimEnd('/')
                                        if (artworkFolderNames.none { albumName.lowercase().contains(it) }) {
                                            synchronized(all) {
                                                all.add(
                                                    AlbumEntry(
                                                        name = albumName,
                                                        artist = artistName,
                                                        prefix = album.name,
                                                        coverUrl = vm.b2.getStreamUrl("${album.name}cover.jpg"),
                                                    )
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }.awaitAll()
                    }
                    albums = all.sortedWith(compareBy({ it.name.lowercase() }, { it.artist.lowercase() }))
                }.onFailure {
                    loadError = it.message
                }
            } catch (e: Exception) {
                loadError = e.message
            }
            isLoading = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp, vertical = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            Text("Albums", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = colors.textPrimary)
            if (albums.isNotEmpty()) {
                Text("${albums.size} Albums", fontSize = 18.sp, color = colors.textMuted)
            }
            Spacer(Modifier.weight(1f))
            Button(
                onClick = {
                    scope.launch {
                        isShuffleLoading = true
                        vm.b2.listAllFiles("Music/").onSuccess { allFiles ->
                            val queue = allFiles.map { f ->
                                val fileName = f.name.substringAfterLast("/")
                                val albumFolder = f.name.substringBeforeLast("/")
                                val parts = f.name.removePrefix("Music/").split("/")
                                Track(
                                    id = UUID.randomUUID().toString(),
                                    title = fileName.substringBeforeLast(".").replace(Regex("^\\d+[.\\-\\s]+"), "").trim(),
                                    artist = if (parts.size > 1) parts[0] else "Unknown",
                                    album = if (parts.size > 2) parts[1] else "",
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
                        isShuffleLoading = false
                    }
                },
                enabled = albums.isNotEmpty() && !isShuffleLoading,
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.greenDim,
                    contentColor = colors.green,
                ),
                shape = RoundedCornerShape(12.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 10.dp),
            ) {
                if (isShuffleLoading) {
                    CircularProgressIndicator(color = colors.green, modifier = Modifier.size(24.dp), strokeWidth = 3.dp)
                } else {
                    Icon(Icons.Default.Shuffle, contentDescription = null, modifier = Modifier.size(24.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("Shuffle All", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        HorizontalDivider(color = colors.border, thickness = 1.dp)

        when {
            !isConnected -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Not connected to B2", color = colors.textMuted, fontSize = 18.sp)
            }
            isLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    CircularProgressIndicator(color = colors.green, modifier = Modifier.size(48.dp), strokeWidth = 4.dp)
                    Text("Loading albums…", color = colors.textMuted, fontSize = 16.sp)
                }
            }
            loadError != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Error: $loadError", color = Color(0xFFFF6B6B), fontSize = 16.sp, modifier = Modifier.padding(32.dp))
            }
            else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(albums) { album ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                val encoded = Uri.encode(album.prefix)
                                navController.navigate("cloud_prefix?p=$encoded")
                            }
                            .padding(horizontal = 32.dp, vertical = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(20.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(72.dp)
                                .background(colors.surface, RoundedCornerShape(10.dp))
                                .clip(RoundedCornerShape(10.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            SubcomposeAsyncImage(
                                model = album.coverUrl,
                                contentDescription = null,
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Crop,
                                error = {
                                    Icon(Icons.Default.Album, contentDescription = null, tint = colors.textDim, modifier = Modifier.size(32.dp))
                                }
                            )
                        }
                        Column(modifier = Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Center) {
                            Text(album.name, color = colors.textPrimary, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                            Text(album.artist, color = colors.textMuted, fontSize = 18.sp, maxLines = 1)
                        }
                        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = colors.textDim, modifier = Modifier.size(28.dp))
                    }
                    HorizontalDivider(color = colors.border, thickness = 1.dp)
                }
            }
        }

    }
}

