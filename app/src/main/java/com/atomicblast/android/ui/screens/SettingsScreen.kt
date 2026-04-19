package com.atomicblast.android.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.atomicblast.android.data.StreamQuality
import com.atomicblast.android.ui.theme.LocalAtomicBlastColors
import com.atomicblast.android.viewmodel.PlayerViewModel

@Composable
fun SettingsScreen(vm: PlayerViewModel, onOpenNowPlaying: () -> Unit) {
    val colors = LocalAtomicBlastColors.current
    val isConnected by vm.isConnected.collectAsState()
    val error by vm.error.collectAsState()
    val isDark by vm.isDarkTheme.collectAsState()
    val streamQuality by vm.streamQuality.collectAsState()
    val isImporting by vm.isImporting.collectAsState()
    val importError by vm.importError.collectAsState()
    val importPreview by vm.importPreview.collectAsState()

    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            vm.importAtomicPlaylist(uri)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
            .padding(32.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(24.dp)
    ) {
        Text("Settings", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = colors.textPrimary)

        // Theme toggle
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = colors.surface)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Icon(
                        imageVector = if (isDark) Icons.Default.DarkMode else Icons.Default.LightMode,
                        contentDescription = null,
                        tint = colors.green,
                        modifier = Modifier.size(32.dp)
                    )
                    Column {
                        Text("Theme", color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
                        Text(if (isDark) "Dark" else "Light", color = colors.textMuted, fontSize = 16.sp)
                    }
                }
                Switch(
                    checked = isDark,
                    onCheckedChange = { vm.toggleTheme() },
                    modifier = Modifier.size(64.dp),
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = colors.green,
                        checkedTrackColor = colors.greenDim,
                        uncheckedThumbColor = colors.textMuted,
                        uncheckedTrackColor = colors.surface2,
                    )
                )
            }
        }

        // Stream quality
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = colors.surface)
        ) {
            Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Stream Quality", color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
                Text("FLAC streams direct from B2. Other qualities transcode via proxy.", color = colors.textMuted, fontSize = 16.sp)
                StreamQuality.entries.forEach { quality ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { vm.setStreamQuality(quality) }
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(quality.label, color = if (quality == streamQuality) colors.green else colors.textDim, fontSize = 18.sp)
                        if (quality == streamQuality) {
                            Text("✓", color = colors.green, fontSize = 18.sp)
                        }
                    }
                }
            }
        }

        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = colors.surface)
        ) {
            Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Atomic Playlist Import", color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
                Text(
                    "Open one of the Atomic Export playlist JSON files and match it against your Backblaze music library.",
                    color = colors.textMuted,
                    fontSize = 16.sp
                )
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(
                        onClick = { importLauncher.launch(arrayOf("application/json", "text/plain")) },
                        enabled = !isImporting,
                        colors = ButtonDefaults.buttonColors(containerColor = colors.greenDim, contentColor = colors.green),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text(if (isImporting) "Importing…" else "Pick Playlist JSON", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                    if (importPreview != null) {
                        OutlinedButton(
                            onClick = { vm.clearImportPreview() },
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text("Clear", fontSize = 16.sp)
                        }
                    }
                }

                if (importError != null) {
                    Text(importError!!, color = Color(0xFFFF6B6B), fontSize = 16.sp)
                }

                if (importPreview != null) {
                    SettingRow("File", importPreview!!.sourceFileName, colors)
                    SettingRow("Playlist", importPreview!!.playlistName, colors)
                    SettingRow("Tracks", importPreview!!.totalTracks.toString(), colors)
                    SettingRow("Matched", importPreview!!.matchedTracks.size.toString(), colors)
                    SettingRow("Unmatched", importPreview!!.unmatchedTracks.size.toString(), colors)

                    if (importPreview!!.matchedTracks.isNotEmpty()) {
                        Button(
                            onClick = {
                                if (vm.playImportedPreview()) {
                                    onOpenNowPlaying()
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = colors.greenDim, contentColor = colors.green),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text("Play Matched Playlist", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }

                    if (importPreview!!.unmatchedTracks.isNotEmpty()) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Unmatched Tracks", color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                            importPreview!!.unmatchedTracks.take(8).forEach { track ->
                                val artistText = track.artists.joinToString(", ").ifBlank { "Unknown Artist" }
                                val albumText = track.album?.takeIf { it.isNotBlank() } ?: "Unknown Album"
                                Text(
                                    "• ${track.title} — $artistText ($albumText)",
                                    color = colors.textDim,
                                    fontSize = 15.sp
                                )
                            }
                            if (importPreview!!.unmatchedTracks.size > 8) {
                                Text(
                                    "+${importPreview!!.unmatchedTracks.size - 8} more",
                                    color = colors.textMuted,
                                    fontSize = 14.sp
                                )
                            }
                        }
                    }
                }
            }
        }

        // B2 source
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = colors.surface)
        ) {
            Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Backblaze B2 Source", color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
                SettingRow("Status", if (isConnected) "Connected" else "Disconnected", colors)
                if (error != null) {
                    Text(error!!, color = Color(0xFFFF6B6B), fontSize = 16.sp)
                }
                Button(
                    onClick = { vm.connectToB2() },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.greenDim, contentColor = colors.green),
                    shape = RoundedCornerShape(12.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 24.dp, vertical = 12.dp)
                ) {
                    Text("Reconnect", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        // App info
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = colors.surface)
        ) {
            Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("About", color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
                SettingRow("App", "AtomicBlast Android", colors)
                SettingRow("Version", "1.0.0", colors)
            }
        }
    }
}

@Composable
private fun SettingRow(label: String, value: String, colors: com.atomicblast.android.ui.theme.AtomicBlastColors) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = colors.textDim, fontSize = 18.sp)
        Text(value, color = colors.textMuted, fontSize = 18.sp)
    }
}


