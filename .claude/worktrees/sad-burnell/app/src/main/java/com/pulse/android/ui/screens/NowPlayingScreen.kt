package com.pulse.android.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PauseCircleFilled
import androidx.compose.material.icons.filled.PlayCircleFilled
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pulse.android.data.PlayerState
import com.pulse.android.ui.theme.PulseBg
import com.pulse.android.ui.theme.PulseGreen
import com.pulse.android.ui.theme.PulseGreenFaint
import com.pulse.android.ui.theme.PulseTextDim
import com.pulse.android.ui.theme.PulseTextMuted
import com.pulse.android.ui.theme.PulseTextPrimary
import com.pulse.android.viewmodel.PlayerViewModel
import kotlinx.coroutines.delay

@Composable
fun NowPlayingScreen(vm: PlayerViewModel, onBack: () -> Unit) {
    val np by vm.nowPlaying.collectAsState()
    val track = np.track

    var positionMs by remember { mutableLongStateOf(0L) }
    var durationMs by remember { mutableLongStateOf(0L) }
    var isSeeking by remember { mutableFloatStateOf(-1f) }

    LaunchedEffect(np.state) {
        while (np.state == PlayerState.Playing) {
            positionMs = vm.currentPosition()
            durationMs = vm.currentDuration()
            delay(500)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PulseBg)
            .padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(16.dp))

        // Back button
        Row(modifier = Modifier.fillMaxWidth()) {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = PulseTextMuted)
            }
        }

        Spacer(Modifier.height(32.dp))

        // Album art placeholder
        Box(
            modifier = Modifier
                .size(240.dp)
                .background(PulseGreenFaint, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Default.MusicNote, contentDescription = null, tint = PulseGreen, modifier = Modifier.size(80.dp))
        }

        Spacer(Modifier.height(36.dp))

        // Track info
        Text(
            text = track?.title ?: "Nothing Playing",
            color = PulseTextPrimary,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = track?.artist ?: "—",
            color = PulseTextMuted,
            fontSize = 15.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            text = track?.album ?: "",
            color = PulseTextDim,
            fontSize = 13.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )

        Spacer(Modifier.height(32.dp))

        // Seek bar
        val sliderValue = if (isSeeking >= 0) isSeeking else if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f

        Slider(
            value = sliderValue,
            onValueChange = { isSeeking = it },
            onValueChangeFinished = {
                vm.seekTo((isSeeking * durationMs).toLong())
                positionMs = (isSeeking * durationMs).toLong()
                isSeeking = -1f
            },
            modifier = Modifier.fillMaxWidth(),
            colors = SliderDefaults.colors(
                thumbColor = PulseGreen,
                activeTrackColor = PulseGreen,
                inactiveTrackColor = PulseGreenFaint,
            )
        )

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(formatMs(positionMs), color = PulseTextDim, fontSize = 11.sp)
            Text(formatMs(durationMs), color = PulseTextDim, fontSize = 11.sp)
        }

        Spacer(Modifier.height(24.dp))

        // Controls
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            IconButton(onClick = { vm.skipPrev() }, modifier = Modifier.size(56.dp)) {
                Icon(Icons.Default.SkipPrevious, contentDescription = "Previous", tint = PulseTextMuted, modifier = Modifier.size(36.dp))
            }
            IconButton(
                onClick = { vm.playPause() },
                modifier = Modifier.size(72.dp).background(PulseGreen, CircleShape)
            ) {
                Icon(
                    imageVector = if (np.state == PlayerState.Playing) Icons.Default.PauseCircleFilled else Icons.Default.PlayCircleFilled,
                    contentDescription = "Play/Pause",
                    tint = Color.Black,
                    modifier = Modifier.size(40.dp)
                )
            }
            IconButton(onClick = { vm.skipNext() }, modifier = Modifier.size(56.dp)) {
                Icon(Icons.Default.SkipNext, contentDescription = "Next", tint = PulseTextMuted, modifier = Modifier.size(36.dp))
            }
        }

        Spacer(Modifier.height(16.dp))

        // Queue info
        if (np.queue.size > 1) {
            Text(
                "Track ${np.queueIndex + 1} of ${np.queue.size}",
                color = PulseTextDim,
                fontSize = 12.sp
            )
        }
    }
}

private fun formatMs(ms: Long): String {
    val totalSec = ms / 1000
    val min = totalSec / 60
    val sec = totalSec % 60
    return "%d:%02d".format(min, sec)
}
