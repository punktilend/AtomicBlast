package com.pulse.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

data class PulseColors(
    val bg: Color,
    val surface: Color,
    val surface2: Color,
    val border: Color,
    val textPrimary: Color,
    val textMuted: Color,
    val textDim: Color,
    val green: Color,
    val greenDim: Color,
    val greenFaint: Color,
)

val DarkPulseColors = PulseColors(
    bg          = Color(0xFF080C08),
    surface     = Color(0xFF080F08),
    surface2    = Color(0xFF0D180D),
    border      = Color(0xFF1A2E1A),
    textPrimary = Color(0xFFE0E0E0),
    textMuted   = Color(0xFF666666),
    textDim     = Color(0xFF444444),
    green       = Color(0xFF4ADE80),
    greenDim    = Color(0xFF233823),
    greenFaint  = Color(0xFF1A2E1A),
)

val LightPulseColors = PulseColors(
    bg          = Color(0xFFF2F7F2),
    surface     = Color(0xFFFFFFFF),
    surface2    = Color(0xFFE6F0E6),
    border      = Color(0xFFBDD5BD),
    textPrimary = Color(0xFF0D1A0D),
    textMuted   = Color(0xFF4A5E4A),
    textDim     = Color(0xFF7A917A),
    green       = Color(0xFF16A34A),
    greenDim    = Color(0xFFDCFCE7),
    greenFaint  = Color(0xFFBBF7D0),
)

val LocalPulseColors = staticCompositionLocalOf { DarkPulseColors }

private val PulseDarkColorScheme = darkColorScheme(
    primary             = DarkPulseColors.green,
    onPrimary           = Color(0xFF000000),
    primaryContainer    = DarkPulseColors.greenDim,
    onPrimaryContainer  = DarkPulseColors.green,
    background          = DarkPulseColors.bg,
    onBackground        = DarkPulseColors.textPrimary,
    surface             = DarkPulseColors.surface,
    onSurface           = DarkPulseColors.textPrimary,
    surfaceVariant      = DarkPulseColors.surface2,
    onSurfaceVariant    = DarkPulseColors.textMuted,
    outline             = DarkPulseColors.border,
    secondary           = DarkPulseColors.green,
    onSecondary         = Color(0xFF000000),
)

private val PulseLightColorScheme = lightColorScheme(
    primary             = LightPulseColors.green,
    onPrimary           = Color(0xFFFFFFFF),
    primaryContainer    = LightPulseColors.greenDim,
    onPrimaryContainer  = LightPulseColors.green,
    background          = LightPulseColors.bg,
    onBackground        = LightPulseColors.textPrimary,
    surface             = LightPulseColors.surface,
    onSurface           = LightPulseColors.textPrimary,
    surfaceVariant      = LightPulseColors.surface2,
    onSurfaceVariant    = LightPulseColors.textMuted,
    outline             = LightPulseColors.border,
    secondary           = LightPulseColors.green,
    onSecondary         = Color(0xFFFFFFFF),
)

@Composable
fun PulseTheme(isDark: Boolean = true, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isDark) PulseDarkColorScheme else PulseLightColorScheme,
        typography = PulseTypography,
        content = content
    )
}
