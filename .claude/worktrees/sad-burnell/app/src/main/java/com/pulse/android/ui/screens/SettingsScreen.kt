package com.pulse.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pulse.android.ui.theme.PulseBg
import com.pulse.android.ui.theme.PulseGreen
import com.pulse.android.ui.theme.PulseGreenDim
import com.pulse.android.ui.theme.PulseSurface
import com.pulse.android.ui.theme.PulseTextDim
import com.pulse.android.ui.theme.PulseTextMuted
import com.pulse.android.ui.theme.PulseTextPrimary
import com.pulse.android.viewmodel.PlayerViewModel

@Composable
fun SettingsScreen(vm: PlayerViewModel) {
    val isConnected by vm.isConnected.collectAsState()
    val error by vm.error.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PulseBg)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Settings", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White)

        // B2 source
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = PulseSurface)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Backblaze B2 Source", color = PulseTextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                SettingRow("Bucket", "aharveyGoogleDriveBackup")
                SettingRow("Prefix", "Music/")
                SettingRow("Status", if (isConnected) "Connected" else "Disconnected")
                if (error != null) {
                    Text(error!!, color = Color(0xFFFF6B6B), fontSize = 12.sp)
                }
                Button(
                    onClick = { vm.connectToB2() },
                    colors = ButtonDefaults.buttonColors(containerColor = PulseGreenDim, contentColor = PulseGreen),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Reconnect", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        // App info
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = PulseSurface)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("About", color = PulseTextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                SettingRow("App", "Pulse Android")
                SettingRow("Version", "1.0.0")
            }
        }
    }
}

@Composable
private fun SettingRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = PulseTextDim, fontSize = 13.sp)
        Text(value, color = PulseTextMuted, fontSize = 13.sp)
    }
}
