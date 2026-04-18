package com.atomicblast.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PauseCircleFilled
import androidx.compose.material.icons.filled.PlayCircleFilled
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import com.atomicblast.android.data.PlayerState
import com.atomicblast.android.data.Track
import com.atomicblast.android.ui.theme.LocalAtomicBlastColors
import com.atomicblast.android.viewmodel.PlayerViewModel
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NowPlayingScreen(vm: PlayerViewModel, onBack: () -> Unit) {
    val colors = LocalAtomicBlastColors.current
    val np by vm.nowPlaying.collectAsState()
    val shuffleMode by vm.shuffleMode.collectAsState()
    val favorites by vm.favorites.collectAsState()
    val track = np.track

    var positionMs by remember { mutableLongStateOf(0L) }
    var durationMs by remember { mutableLongStateOf(0L) }
    var isSeeking by remember { mutableFloatStateOf(-1f) }
    var showQueue by remember { mutableStateOf(false) }

    LaunchedEffect(np.state, np.track?.id) {
        while (np.state == PlayerState.Playing) {
            positionMs = vm.currentPosition()
            durationMs = vm.currentDuration()
            delay(250)
        }
    }

    // Queue bottom sheet
    if (showQueue) {
        ModalBottomSheet(
            onDismissRequest = { showQueue = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = colors.surface,
        ) {
            Text(
                "Queue",
                color = colors.textPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 14.dp)
            )
            LazyColumn {
                itemsIndexed(np.queue) { idx, t ->
                    val isCurrent = t.id == track?.id
                    val isFav = favorites.any { it.filePath == t.filePath }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                vm.playTrack(t, np.queue, idx)
                                showQueue = false
                            }
                            .background(if (isCurrent) colors.greenFaint else Color.Transparent)
                            .padding(horizontal = 20.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        if (isCurrent) {
                            Icon(Icons.Default.GraphicEq, null, tint = colors.green, modifier = Modifier.size(20.dp))
                        } else {
                            Text("${idx + 1}", color = colors.textDim, fontSize = 12.sp, modifier = Modifier.size(20.dp))
                        }
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                t.title,
                                color = if (isCurrent) colors.green else colors.textPrimary,
                                fontSize = 13.sp,
                                fontWeight = if (isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(t.artist, color = colors.textMuted, fontSize = 11.sp, maxLines = 1)
                        }
                        IconButton(
                            onClick = { vm.toggleFavorite(t) },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                if (isFav) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                                contentDescription = if (isFav) "Remove favorite" else "Add favorite",
                                tint = if (isFav) Color(0xFFEF4444) else colors.textDim,
                                modifier = Modifier.size(22.dp)
                            )
                        }
                    }
                    HorizontalDivider(color = colors.border, thickness = 0.5.dp)
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(12.dp))

        // Back button
        Row(modifier = Modifier.fillMaxWidth()) {
            IconButton(onClick = onBack, modifier = Modifier.size(56.dp)) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = colors.textMuted, modifier = Modifier.size(32.dp))
            }
        }

        Spacer(Modifier.height(12.dp))

        // Album art — tap to open queue
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .background(colors.greenFaint, RoundedCornerShape(12.dp))
                .clip(RoundedCornerShape(12.dp))
                .clickable(enabled = np.queue.isNotEmpty()) { showQueue = true },
            contentAlignment = Alignment.Center
        ) {
            val artUrl = track?.albumArtUrl
            if (artUrl != null) {
                SubcomposeAsyncImage(
                    model = artUrl,
                    contentDescription = "Album art",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                    loading = {
                        CircularProgressIndicator(
                            color = colors.green,
                            modifier = Modifier.size(48.dp),
                            strokeWidth = 3.dp
                        )
                    },
                    error = {
                        Icon(Icons.Default.MusicNote, contentDescription = null, tint = colors.green, modifier = Modifier.size(100.dp))
                    }
                )
            } else {
                Icon(Icons.Default.MusicNote, contentDescription = null, tint = colors.green, modifier = Modifier.size(100.dp))
            }
        }

        Spacer(Modifier.height(24.dp))

        // Track info
        Text(
            text = track?.title ?: "Nothing Playing",
            color = colors.textPrimary,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
        Spacer(Modifier.height(5.dp))
        Text(
            text = track?.artist ?: "—",
            color = colors.textMuted,
            fontSize = 14.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            text = track?.album ?: "",
            color = colors.textDim,
            fontSize = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )

        Spacer(Modifier.height(24.dp))

        // Seek bar
        val sliderValue = if (isSeeking >= 0) isSeeking else if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
        val green = colors.green
        val greenFaint = colors.greenFaint

        Slider(
            value = sliderValue,
            onValueChange = { isSeeking = it },
            onValueChangeFinished = {
                vm.seekTo((isSeeking * durationMs).toLong())
                positionMs = (isSeeking * durationMs).toLong()
                isSeeking = -1f
            },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            colors = SliderDefaults.colors(
                activeTrackColor = green,
                inactiveTrackColor = greenFaint,
                thumbColor = Color.Transparent,
            ),
            thumb = { Spacer(Modifier.size(8.dp)) }
        )

        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(formatMs(positionMs), color = colors.textDim, fontSize = 11.sp)
            Text(formatMs(durationMs), color = colors.textDim, fontSize = 11.sp)
        }

        Spacer(Modifier.height(24.dp))

        // Controls: Shuffle | Prev | Play/Pause | Next | Heart
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            IconButton(onClick = { vm.toggleShuffle() }, modifier = Modifier.size(44.dp)) {
                Icon(
                    Icons.Default.Shuffle,
                    contentDescription = "Shuffle",
                    tint = if (shuffleMode) colors.green else colors.textMuted,
                    modifier = Modifier.size(24.dp)
                )
            }
            IconButton(onClick = { vm.skipPrev() }, modifier = Modifier.size(56.dp)) {
                Icon(Icons.Default.SkipPrevious, contentDescription = "Previous", tint = colors.textMuted, modifier = Modifier.size(36.dp))
            }
            IconButton(
                onClick = { vm.playPause() },
                modifier = Modifier.size(72.dp).background(colors.green, CircleShape)
            ) {
                Icon(
                    imageVector = if (np.state == PlayerState.Playing) Icons.Default.PauseCircleFilled else Icons.Default.PlayCircleFilled,
                    contentDescription = "Play/Pause",
                    tint = Color.Black,
                    modifier = Modifier.size(48.dp)
                )
            }
            IconButton(onClick = { vm.skipNext() }, modifier = Modifier.size(56.dp)) {
                Icon(Icons.Default.SkipNext, contentDescription = "Next", tint = colors.textMuted, modifier = Modifier.size(36.dp))
            }
            val isFav = track != null && favorites.any { it.filePath == track.filePath }
            IconButton(
                onClick = { track?.let { vm.toggleFavorite(it) } },
                modifier = Modifier.size(44.dp),
                enabled = track != null
            ) {
                Icon(
                    if (isFav) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                    contentDescription = if (isFav) "Remove favorite" else "Add favorite",
                    tint = if (isFav) Color(0xFFEF4444) else colors.textMuted,
                    modifier = Modifier.size(24.dp)
                )
            }
        }
        Spacer(Modifier.height(32.dp))
    }

}

private fun formatMs(ms: Long): String {
    val totalSec = ms / 1000
    val min = totalSec / 60
    val sec = totalSec % 60
    return "%d:%02d".format(min, sec)
}

