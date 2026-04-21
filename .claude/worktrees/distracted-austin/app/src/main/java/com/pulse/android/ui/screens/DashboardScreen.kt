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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import androidx.navigation.NavController
import com.pulse.android.data.PlayerState
import com.pulse.android.ui.theme.LocalPulseColors
import com.pulse.android.ui.theme.PulseColors
import com.pulse.android.viewmodel.PlayerViewModel

@Composable
fun DashboardScreen(vm: PlayerViewModel, navController: NavController) {
    val colors = LocalPulseColors.current
    val np by vm.nowPlaying.collectAsState()
    val isConnected by vm.isConnected.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Header
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Pulse", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = colors.green)
            Spacer(Modifier.weight(1f))
            Icon(
                imageVector = if (isConnected) Icons.Default.Cloud else Icons.Default.CloudOff,
                contentDescription = "B2 status",
                tint = if (isConnected) colors.green else colors.textDim,
                modifier = Modifier.size(20.dp)
            )
            Text(
                text = if (isConnected) " Connected" else " Offline",
                color = if (isConnected) colors.green else colors.textDim,
                fontSize = 12.sp,
                modifier = Modifier.padding(start = 4.dp)
            )
        }

        // Now Playing card
        val track = np.track
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { navController.navigate("nowplaying") },
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = colors.surface),
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(56.dp)
                        .background(colors.greenFaint, RoundedCornerShape(8.dp))
                        .clip(RoundedCornerShape(8.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    val artUrl = track?.albumArtUrl
                    if (artUrl != null) {
                        SubcomposeAsyncImage(
                            model = artUrl,
                            contentDescription = null,
                            modifier = Modifier.fillMaxSize(),
                            contentScale = ContentScale.Crop,
                            error = {
                                Icon(Icons.Default.MusicNote, contentDescription = null, tint = colors.green, modifier = Modifier.size(28.dp))
                            }
                        )
                    } else {
                        Icon(Icons.Default.MusicNote, contentDescription = null, tint = colors.green, modifier = Modifier.size(28.dp))
                    }
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = if (track != null) "Now Playing" else "Nothing Playing",
                        color = colors.textDim, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                        letterSpacing = 0.08.sp
                    )
                    Text(
                        text = track?.title ?: "—",
                        color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold
                    )
                    if (track != null) {
                        Text(text = track.artist, color = colors.textMuted, fontSize = 12.sp)
                    }
                }
                if (np.state == PlayerState.Playing) {
                    Icon(Icons.Default.GraphicEq, contentDescription = "Playing", tint = colors.green, modifier = Modifier.size(22.dp))
                }
            }
        }

        // Stat chips
        Text("Source", color = colors.textDim, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.08.sp)
        StatRow(
            StatCard("B2 Bucket", "aharveyGoogleDriveBackup", Icons.Default.Cloud, colors.green),
            StatCard("Prefix", "Music/", Icons.Default.MusicNote, colors.textMuted),
            colors = colors
        )

        // Quick links
        Text("Quick Access", color = colors.textDim, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.08.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            QuickChip("Library",  Modifier.weight(1f), colors) { navController.navigate("library") }
            QuickChip("Cloud",    Modifier.weight(1f), colors) { navController.navigate("cloud") }
            QuickChip("Settings", Modifier.weight(1f), colors) { navController.navigate("settings") }
        }
    }
}

data class StatCard(val label: String, val value: String, val icon: ImageVector, val color: Color)

@Composable
private fun StatRow(vararg cards: StatCard, colors: PulseColors) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        cards.forEach { card ->
            Card(
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(10.dp),
                colors = CardDefaults.cardColors(containerColor = colors.surface),
            ) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(card.icon, contentDescription = null, tint = card.color, modifier = Modifier.size(16.dp))
                    Text(card.label, color = colors.textDim, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(card.value, color = colors.textPrimary, fontSize = 11.sp, maxLines = 2)
                }
            }
        }
    }
}

@Composable
private fun QuickChip(label: String, modifier: Modifier = Modifier, colors: PulseColors, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .background(colors.surface2, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = colors.green, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}
