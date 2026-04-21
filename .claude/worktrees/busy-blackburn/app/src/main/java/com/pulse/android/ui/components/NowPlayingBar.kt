package com.pulse.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pulse.android.data.PlayerState
import com.pulse.android.ui.theme.LocalPulseColors
import com.pulse.android.viewmodel.PlayerViewModel
import kotlinx.coroutines.delay

@Composable
fun NowPlayingBar(vm: PlayerViewModel, onClick: () -> Unit) {
    val colors = LocalPulseColors.current
    val np by vm.nowPlaying.collectAsState()
    val track = np.track ?: return

    var positionMs by remember { mutableLongStateOf(0L) }
    var durationMs by remember { mutableLongStateOf(0L) }
    LaunchedEffect(np.state) {
        while (np.state == PlayerState.Playing) {
            positionMs = vm.currentPosition()
            durationMs = vm.currentDuration()
            delay(500)
        }
    }

    val progress = if (durationMs > 0) positionMs.toFloat() / durationMs else 0f

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.bg)
            .clickable(onClick = onClick)
    ) {
        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier.fillMaxWidth(),
            color = colors.green,
            trackColor = colors.greenFaint,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = track.title,
                    color = colors.textPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = track.artist,
                    color = colors.textMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            IconButton(onClick = { vm.skipPrev() }) {
                Icon(Icons.Default.SkipPrevious, contentDescription = "Previous", tint = colors.textMuted, modifier = Modifier.size(24.dp))
            }
            IconButton(onClick = { vm.playPause() }) {
                Icon(
                    imageVector = if (np.state == PlayerState.Playing) Icons.Default.PauseCircle else Icons.Default.PlayCircle,
                    contentDescription = "Play/Pause",
                    tint = colors.green,
                    modifier = Modifier.size(36.dp)
                )
            }
            IconButton(onClick = { vm.skipNext() }) {
                Icon(Icons.Default.SkipNext, contentDescription = "Next", tint = colors.textMuted, modifier = Modifier.size(24.dp))
            }
        }
    }
}
