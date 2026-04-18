package com.atomicblast.android.ui.screens

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Storage
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.res.painterResource
import com.atomicblast.android.R
import com.atomicblast.android.data.PlayerState
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import coil.compose.SubcomposeAsyncImage
import com.atomicblast.android.data.B2File
import com.atomicblast.android.data.Track
import com.atomicblast.android.ui.theme.LocalAtomicBlastColors
import com.atomicblast.android.viewmodel.PlayerViewModel
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
fun DashboardScreen(vm: PlayerViewModel, navController: NavController) {
    val colors = LocalAtomicBlastColors.current
    val isConnected by vm.isConnected.collectAsState()
    val scope = rememberCoroutineScope()

    var artists by remember { mutableStateOf<List<B2File>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var isShuffleLoading by remember { mutableStateOf(false) }

    LaunchedEffect(isConnected) {
        if (isConnected && artists.isEmpty()) {
            scope.launch {
                isLoading = true
                loadError = null
                vm.b2.listFiles("Music/").onSuccess { files ->
                    artists = files.filter { it.isFolder }
                }.onFailure {
                    loadError = it.message
                }
                isLoading = false
            }
        }
    }

    val artistMetaMap by vm.artistMeta.collectAsState()

    LaunchedEffect(artists) {
        artists.forEach { artist ->
            val name = artist.name.removePrefix("Music/").trimEnd('/')
            vm.loadArtistMeta(name)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
    ) {
        // Topnav bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(60.dp)
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                painter = painterResource(id = R.drawable.ic_logo),
                contentDescription = "AtomicBlast Logo",
                tint = Color.Unspecified,
                modifier = Modifier.size(32.dp)
            )
            Spacer(Modifier.width(14.dp))
            Text(
                "ARTISTS",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = colors.textPrimary,
                letterSpacing = 1.sp
            )
            Spacer(Modifier.weight(1f))
            if (isConnected) {
                Icon(Icons.Default.CloudDone, null, tint = colors.green, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("B2", color = colors.green, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(12.dp))
            }
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
                modifier = Modifier.height(36.dp),
                enabled = artists.isNotEmpty() && !isShuffleLoading,
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.greenDim,
                    contentColor = colors.green,
                ),
                shape = RoundedCornerShape(20.dp),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 0.dp),
            ) {
                if (isShuffleLoading) {
                    CircularProgressIndicator(color = colors.green, modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Default.Shuffle, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Shuffle All", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
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
                Text(
                    "Error: $loadError",
                    color = Color(0xFFFF6B6B),
                    fontSize = 16.sp,
                    modifier = Modifier.padding(32.dp)
                )
            }
            else -> LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 150.dp),
                contentPadding = PaddingValues(horizontal = 24.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.fillMaxSize()
            ) {

                items(artists) { artist ->
                    val name = artist.name.removePrefix("Music/").trimEnd('/')
                    val artUrl = vm.b2.getStreamUrl("${artist.name}artist.jpg")
                    val fallbackArtUrl = artistMetaMap[name]?.image
                    ArtistCard(
                        name = name,
                        artUrl = artUrl,
                        fallbackArtUrl = fallbackArtUrl,
                        onClick = {
                            val encoded = Uri.encode(artist.name)
                            navController.navigate("cloud_prefix?p=$encoded")
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun StatusCard(
    modifier: Modifier = Modifier,
    icon: ImageVector,
    title: String,
    subtitle: String,
    statusColor: Color
) {
    val colors = LocalAtomicBlastColors.current
    Row(
        modifier = modifier
            .background(colors.surface2, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .background(colors.bg, RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = null, tint = statusColor, modifier = Modifier.size(24.dp))
        }
        Column {
            Text(title, color = colors.textMuted, fontSize = 14.sp)
            Text(
                subtitle,
                color = colors.textPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun ArtistCard(name: String, artUrl: String, fallbackArtUrl: String? = null, onClick: () -> Unit) {
    val colors = LocalAtomicBlastColors.current
    var currentUrl by remember(artUrl) { mutableStateOf<String?>(artUrl) }
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .background(colors.surface, RoundedCornerShape(8.dp))
                .clip(RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center
        ) {
            SubcomposeAsyncImage(
                model = currentUrl,
                contentDescription = name,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
                error = {
                    if (currentUrl != fallbackArtUrl && fallbackArtUrl != null) {
                        SideEffect { currentUrl = fallbackArtUrl }
                    } else {
                        Icon(
                            Icons.Default.Person,
                            contentDescription = null,
                            tint = colors.textDim,
                            modifier = Modifier.size(48.dp)
                        )
                    }
                }
            )
        }
        Text(
            text = name,
            color = colors.textPrimary,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth()
        )
    }
}


