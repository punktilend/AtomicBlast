package com.pulse.android.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
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
import com.pulse.android.ui.theme.LocalPulseColors
import com.pulse.android.viewmodel.PlayerViewModel

@Composable
fun SettingsScreen(vm: PlayerViewModel) {
    val colors = LocalPulseColors.current
    val isConnected by vm.isConnected.collectAsState()
    val error by vm.error.collectAsState()
    val isDark by vm.isDarkTheme.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Settings", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = colors.textPrimary)

        // Theme toggle
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = colors.surface)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Icon(
                        imageVector = if (isDark) Icons.Default.DarkMode else Icons.Default.LightMode,
                        contentDescription = null,
                        tint = colors.green,
                    )
                    Column {
                        Text("Theme", color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text(if (isDark) "Dark" else "Light", color = colors.textMuted, fontSize = 12.sp)
                    }
                }
                Switch(
                    checked = isDark,
                    onCheckedChange = { vm.toggleTheme() },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = colors.green,
                        checkedTrackColor = colors.greenDim,
                        uncheckedThumbColor = colors.textMuted,
                        uncheckedTrackColor = colors.surface2,
                    )
                )
            }
        }

        // B2 source
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = colors.surface)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Backblaze B2 Source", color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                SettingRow("Bucket", "aharveyGoogleDriveBackup", colors)
                SettingRow("Prefix", "Music/", colors)
                SettingRow("Status", if (isConnected) "Connected" else "Disconnected", colors)
                if (error != null) {
                    Text(error!!, color = Color(0xFFFF6B6B), fontSize = 12.sp)
                }
                Button(
                    onClick = { vm.connectToB2() },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.greenDim, contentColor = colors.green),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Reconnect", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        // App info
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = colors.surface)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("About", color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                SettingRow("App", "Pulse Android", colors)
                SettingRow("Version", "1.0.0", colors)
            }
        }
    }
}

@Composable
private fun SettingRow(label: String, value: String, colors: com.pulse.android.ui.theme.PulseColors) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = colors.textDim, fontSize = 13.sp)
        Text(value, color = colors.textMuted, fontSize = 13.sp)
    }
}
