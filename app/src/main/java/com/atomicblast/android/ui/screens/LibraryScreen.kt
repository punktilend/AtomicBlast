package com.atomicblast.android.ui.screens

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
import com.atomicblast.android.ui.theme.LocalAtomicBlastColors
import com.atomicblast.android.viewmodel.PlayerViewModel

@Composable
fun LibraryScreen(vm: PlayerViewModel, navController: NavController) {
    val colors = LocalAtomicBlastColors.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
            .padding(32.dp)
    ) {
        Text("Library", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = colors.textPrimary)
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Local device music — coming soon. Use Cloud to stream from Backblaze B2.", color = colors.textMuted, fontSize = 18.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }

}

