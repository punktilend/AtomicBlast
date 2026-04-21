package com.pulse.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.pulse.android.ui.theme.PulseBg
import com.pulse.android.ui.theme.PulseTextMuted
import com.pulse.android.viewmodel.PlayerViewModel

@Composable
fun LibraryScreen(vm: PlayerViewModel, navController: NavController) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PulseBg)
            .padding(20.dp)
    ) {
        Text("Library", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = androidx.compose.ui.graphics.Color.White)
        // TODO: browse artists / albums loaded from B2
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Browse your B2 music library here.", color = PulseTextMuted, fontSize = 14.sp)
        }
    }
}
