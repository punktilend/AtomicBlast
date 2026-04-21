package com.pulse.android.ui

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PauseCircleFilled
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pulse.android.ui.theme.DarkPulseColors
import com.pulse.android.ui.theme.LocalPulseColors
import com.pulse.android.ui.theme.PulseTheme

private const val ATOTO = "spec:width=1024dp,height=600dp,dpi=160,orientation=landscape"

// ─────────────────────────────────────────────────────────────────────────────
// Shared shell: bottom nav + now-playing bar
// ─────────────────────────────────────────────────────────────────────────────

@Composable
private fun PreviewShell(activeRoute: String, content: @Composable () -> Unit) {
    val c = DarkPulseColors
    data class NavItem(val route: String, val label: String, val icon: ImageVector)
    val navItems = listOf(
        NavItem("dashboard", "Dashboard", Icons.Default.Home),
        NavItem("library",   "Library",   Icons.Default.LibraryMusic),
        NavItem("cloud",     "Cloud",     Icons.Default.Cloud),
        NavItem("settings",  "Settings",  Icons.Default.Settings),
    )

    CompositionLocalProvider(LocalPulseColors provides c) {
        PulseTheme {
            Scaffold(
                containerColor = c.bg,
                bottomBar = {
                    Column {
                        // Mini now-playing bar
                        Column(
                            modifier = Modifier.fillMaxWidth().background(c.bg)
                        ) {
                            LinearProgressIndicator(
                                progress = { 0.38f },
                                modifier = Modifier.fillMaxWidth(),
                                color = c.green,
                                trackColor = c.greenFaint,
                            )
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Bohemian Rhapsody", color = c.textPrimary, fontSize = 13.sp,
                                        fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("Queen", color = c.textMuted, fontSize = 11.sp, maxLines = 1)
                                }
                                Icon(Icons.Default.SkipPrevious, null, tint = c.textMuted, modifier = Modifier.size(24.dp))
                                Icon(Icons.Default.PauseCircleFilled, null, tint = c.green, modifier = Modifier.size(36.dp))
                                Icon(Icons.Default.SkipNext, null, tint = c.textMuted, modifier = Modifier.size(24.dp))
                            }
                        }

                        NavigationBar(containerColor = c.bg, tonalElevation = 0.dp) {
                            navItems.forEach { item ->
                                NavigationBarItem(
                                    selected = item.route == activeRoute,
                                    onClick = {},
                                    icon = { Icon(item.icon, item.label) },
                                    label = { Text(item.label) },
                                    colors = NavigationBarItemDefaults.colors(
                                        selectedIconColor = c.green,
                                        selectedTextColor = c.green,
                                        unselectedIconColor = c.textMuted,
                                        unselectedTextColor = c.textMuted,
                                        indicatorColor = c.greenDim,
                                    )
                                )
                            }
                        }
                    }
                }
            ) { padding ->
                Box(Modifier.fillMaxSize().padding(padding)) { content() }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Dashboard Preview
// ─────────────────────────────────────────────────────────────────────────────

@Preview(name = "ATOTO S8 — Dashboard", device = ATOTO, showBackground = true)
@Composable
fun PreviewDashboard() {
    val c = DarkPulseColors
    PreviewShell("dashboard") {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(c.bg)
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Pulse", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = c.green)
                Spacer(Modifier.weight(1f))
                Icon(Icons.Default.Cloud, null, tint = c.green, modifier = Modifier.size(18.dp))
                Text(" Connected", color = c.green, fontSize = 12.sp)
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = c.surface),
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Box(
                        modifier = Modifier.size(56.dp).background(c.greenFaint, RoundedCornerShape(8.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.MusicNote, null, tint = c.green, modifier = Modifier.size(28.dp))
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text("NOW PLAYING", color = c.textDim, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.08.sp)
                        Text("Bohemian Rhapsody", color = c.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        Text("Queen", color = c.textMuted, fontSize = 12.sp)
                    }
                    Icon(Icons.Default.GraphicEq, null, tint = c.green, modifier = Modifier.size(22.dp))
                }
            }

            Text("SOURCE", color = c.textDim, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.08.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                listOf("B2 Bucket" to "aharveyGoogleDriveBackup", "Prefix" to "Music/").forEach { (label, value) ->
                    Card(
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                        colors = CardDefaults.cardColors(containerColor = c.surface),
                    ) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(Icons.Default.Cloud, null, tint = c.green, modifier = Modifier.size(16.dp))
                            Text(label, color = c.textDim, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            Text(value, color = c.textPrimary, fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cloud Browser Preview
// ─────────────────────────────────────────────────────────────────────────────

@Preview(name = "ATOTO S8 — Cloud", device = ATOTO, showBackground = true)
@Composable
fun PreviewCloud() {
    val c = DarkPulseColors
    val folders = listOf("Rock/", "Jazz/", "Electronic/", "Classical/")
    val tracks  = listOf(
        Triple("Bohemian Rhapsody", "FLAC", "42.1 MB"),
        Triple("Hotel California",  "FLAC", "38.7 MB"),
        Triple("Stairway to Heaven","MP3",  "8.2 MB"),
        Triple("Comfortably Numb",  "FLAC", "51.3 MB"),
    )

    PreviewShell("cloud") {
        Column(Modifier.fillMaxSize().background(c.bg)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Music", color = c.textDim, fontSize = 13.sp)
                    Icon(Icons.Default.ChevronRight, null, tint = c.textDim, modifier = Modifier.size(14.dp))
                    Text("Rock", color = c.green, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            HorizontalDivider(color = c.border, thickness = 0.5.dp)

            LazyColumn {
                item {
                    Button(
                        onClick = {},
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = c.greenDim, contentColor = c.green),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Icon(Icons.Default.Shuffle, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Shuffle All", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    }
                }

                item { Text("FOLDERS", color = c.textDim, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) }
                itemsIndexed(folders) { _, folder ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(Icons.Default.Folder, null, tint = c.green, modifier = Modifier.size(20.dp))
                        Text(folder.trimEnd('/'), color = c.textPrimary, fontSize = 14.sp, modifier = Modifier.weight(1f))
                        Icon(Icons.Default.ChevronRight, null, tint = c.textDim, modifier = Modifier.size(16.dp))
                    }
                    HorizontalDivider(color = c.border, thickness = 0.5.dp)
                }

                item { Text("TRACKS", color = c.textDim, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
                    modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 6.dp)) }
                itemsIndexed(tracks) { _, (title, fmt, size) ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(Icons.Default.AudioFile, null, tint = c.textMuted, modifier = Modifier.size(18.dp))
                        Text(title, color = c.textPrimary, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        Text(
                            fmt,
                            color = if (fmt == "FLAC") c.green else c.textDim,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .background(if (fmt == "FLAC") c.greenFaint else c.surface2, RoundedCornerShape(4.dp))
                                .padding(horizontal = 5.dp, vertical = 2.dp)
                        )
                        Text(size, color = c.textDim, fontSize = 11.sp)
                    }
                    HorizontalDivider(color = c.border, thickness = 0.5.dp)
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Now Playing Preview
// ─────────────────────────────────────────────────────────────────────────────

@Preview(name = "ATOTO S8 — Now Playing", device = ATOTO, showBackground = true)
@Composable
fun PreviewNowPlaying() {
    val c = DarkPulseColors
    CompositionLocalProvider(LocalPulseColors provides c) {
        PulseTheme {
            Column(
                modifier = Modifier.fillMaxSize().background(c.bg).padding(horizontal = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Spacer(Modifier.height(12.dp))

                Row(modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Home, null, tint = c.textMuted, modifier = Modifier.size(24.dp))
                }

                Spacer(Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxSize(),
                    horizontalArrangement = Arrangement.spacedBy(32.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(160.dp)
                            .background(c.greenFaint, RoundedCornerShape(16.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.MusicNote, null, tint = c.green, modifier = Modifier.size(64.dp))
                    }

                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Column {
                            Text("Bohemian Rhapsody", color = c.textPrimary, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                            Text("Queen", color = c.textMuted, fontSize = 15.sp)
                            Text("Greatest Hits", color = c.textDim, fontSize = 13.sp)
                        }

                        Slider(
                            value = 0.38f,
                            onValueChange = {},
                            modifier = Modifier.fillMaxWidth(),
                            colors = SliderDefaults.colors(
                                thumbColor = c.green,
                                activeTrackColor = c.green,
                                inactiveTrackColor = c.greenFaint,
                            )
                        )

                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("2:14", color = c.textDim, fontSize = 11.sp)
                            Text("5:55", color = c.textDim, fontSize = 11.sp)
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            Icon(Icons.Default.SkipPrevious, null, tint = c.textMuted, modifier = Modifier.size(36.dp))
                            Box(
                                modifier = Modifier.size(64.dp).background(c.green, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.PauseCircleFilled, null, tint = Color.Black, modifier = Modifier.size(36.dp))
                            }
                            Icon(Icons.Default.SkipNext, null, tint = c.textMuted, modifier = Modifier.size(36.dp))
                        }

                        Text("Track 1 of 12", color = c.textDim, fontSize = 12.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
                    }
                }
            }
        }
    }
}
