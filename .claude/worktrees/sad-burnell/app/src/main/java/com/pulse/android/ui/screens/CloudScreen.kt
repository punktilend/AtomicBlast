package com.pulse.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.pulse.android.data.B2File
import com.pulse.android.data.Track
import com.pulse.android.ui.theme.PulseBg
import com.pulse.android.ui.theme.PulseBorder
import com.pulse.android.ui.theme.PulseGreen
import com.pulse.android.ui.theme.PulseSurface2
import com.pulse.android.ui.theme.PulseTextDim
import com.pulse.android.ui.theme.PulseTextMuted
import com.pulse.android.ui.theme.PulseTextPrimary
import com.pulse.android.viewmodel.PlayerViewModel
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
fun CloudScreen(vm: PlayerViewModel, navController: NavController) {
    val isConnected by vm.isConnected.collectAsState()
    val scope = rememberCoroutineScope()

    var currentPrefix by remember { mutableStateOf("Music/") }
    var breadcrumbs by remember { mutableStateOf(listOf("Music")) }
    var files by remember { mutableStateOf<List<B2File>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
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

    Column(
        modifier = Modifier.fillMaxSize().background(PulseBg).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Cloud Browser", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = androidx.compose.ui.graphics.Color.White)
            androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
            IconButton(onClick = { loadPrefix(currentPrefix) }) {
                Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = PulseTextMuted)
            }
        }

        // Breadcrumbs
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            breadcrumbs.forEachIndexed { idx, crumb ->
                Text(
                    text = crumb,
                    color = if (idx == breadcrumbs.lastIndex) PulseGreen else PulseTextDim,
                    fontSize = 12.sp,
                    modifier = Modifier.clickable {
                        if (idx < breadcrumbs.lastIndex) {
                            val newCrumbs = breadcrumbs.take(idx + 1)
                            breadcrumbs = newCrumbs
                            currentPrefix = if (idx == 0) "Music/" else "Music/" + newCrumbs.drop(1).joinToString("/") + "/"
                            loadPrefix(currentPrefix)
                        }
                    }
                )
                if (idx < breadcrumbs.lastIndex) Text("/", color = PulseTextDim, fontSize = 12.sp)
            }
        }

        when {
            !isConnected -> Text("Not connected to B2. Check settings.", color = PulseTextMuted)
            isLoading    -> CircularProgressIndicator(color = PulseGreen, modifier = Modifier.size(28.dp))
            loadError != null -> Text("Error: $loadError", color = androidx.compose.ui.graphics.Color(0xFFFF6B6B))
            else -> {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    items(files) { file ->
                        val displayName = file.name.removePrefix(currentPrefix).trimEnd('/')
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(PulseSurface2)
                                .clickable {
                                    if (file.isFolder) {
                                        breadcrumbs = breadcrumbs + displayName
                                        currentPrefix = file.name
                                        loadPrefix(file.name)
                                    } else {
                                        // Play the track
                                        val track = Track(
                                            id = UUID.randomUUID().toString(),
                                            title = displayName.substringBeforeLast("."),
                                            artist = "Unknown",
                                            album = breadcrumbs.lastOrNull() ?: "",
                                            duration = 0L,
                                            format = displayName.substringAfterLast(".").uppercase(),
                                            streamUrl = vm.b2.getStreamUrl(file.name),
                                        )
                                        vm.playTrack(track)
                                        navController.navigate("nowplaying")
                                    }
                                }
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Icon(
                                if (file.isFolder) Icons.Default.Folder else Icons.Default.AudioFile,
                                contentDescription = null,
                                tint = if (file.isFolder) PulseGreen else PulseTextMuted,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(displayName, color = PulseTextPrimary, fontSize = 13.sp, modifier = Modifier.weight(1f))
                            if (!file.isFolder && file.size > 0) {
                                Text(formatSize(file.size), color = PulseTextDim, fontSize = 11.sp)
                            }
                        }
                        HorizontalDivider(color = PulseBorder, thickness = 0.5.dp)
                    }
                }
            }
        }
    }
}

private fun formatSize(bytes: Long): String {
    return when {
        bytes >= 1_000_000 -> "%.1f MB".format(bytes / 1_000_000.0)
        bytes >= 1_000     -> "%.0f KB".format(bytes / 1_000.0)
        else               -> "$bytes B"
    }
}
