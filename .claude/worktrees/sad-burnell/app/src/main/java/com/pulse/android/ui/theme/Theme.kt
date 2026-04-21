package com.pulse.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Pulse color palette — mirrors the Electron desktop app
val PulseGreen        = Color(0xFF4ADE80)
val PulseGreenDim     = Color(0xFF233823)
val PulseGreenFaint   = Color(0xFF1A2E1A)
val PulseBg           = Color(0xFF080C08)
val PulseSurface      = Color(0xFF080F08)
val PulseSurface2     = Color(0xFF0D180D)
val PulseBorder       = Color(0xFF1A2E1A)
val PulseTextPrimary  = Color(0xFFE0E0E0)
val PulseTextMuted    = Color(0xFF666666)
val PulseTextDim      = Color(0xFF444444)

private val PulseDarkColorScheme = darkColorScheme(
    primary         = PulseGreen,
    onPrimary       = Color(0xFF000000),
    primaryContainer = PulseGreenDim,
    onPrimaryContainer = PulseGreen,
    background      = PulseBg,
    onBackground    = PulseTextPrimary,
    surface         = PulseSurface,
    onSurface       = PulseTextPrimary,
    surfaceVariant  = PulseSurface2,
    onSurfaceVariant = PulseTextMuted,
    outline         = PulseBorder,
    secondary       = PulseGreen,
    onSecondary     = Color(0xFF000000),
)

@Composable
fun PulseTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = PulseDarkColorScheme,
        typography = PulseTypography,
        content = content
    )
}
