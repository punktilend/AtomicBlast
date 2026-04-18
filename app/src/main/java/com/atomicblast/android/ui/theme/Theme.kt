package com.atomicblast.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

data class AtomicBlastColors(
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

val DarkAtomicBlastColors = AtomicBlastColors(
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

val LightAtomicBlastColors = AtomicBlastColors(
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

val LocalAtomicBlastColors = staticCompositionLocalOf { DarkAtomicBlastColors }

private val AtomicBlastDarkColorScheme = darkColorScheme(
    primary             = DarkAtomicBlastColors.green,
    onPrimary           = Color(0xFF000000),
    primaryContainer    = DarkAtomicBlastColors.greenDim,
    onPrimaryContainer  = DarkAtomicBlastColors.green,
    background          = DarkAtomicBlastColors.bg,
    onBackground        = DarkAtomicBlastColors.textPrimary,
    surface             = DarkAtomicBlastColors.surface,
    onSurface           = DarkAtomicBlastColors.textPrimary,
    surfaceVariant      = DarkAtomicBlastColors.surface2,
    onSurfaceVariant    = DarkAtomicBlastColors.textMuted,
    outline             = DarkAtomicBlastColors.border,
    secondary           = DarkAtomicBlastColors.green,
    onSecondary         = Color(0xFF000000),
)

private val AtomicBlastLightColorScheme = lightColorScheme(
    primary             = LightAtomicBlastColors.green,
    onPrimary           = Color(0xFFFFFFFF),
    primaryContainer    = LightAtomicBlastColors.greenDim,
    onPrimaryContainer  = LightAtomicBlastColors.green,
    background          = LightAtomicBlastColors.bg,
    onBackground        = LightAtomicBlastColors.textPrimary,
    surface             = LightAtomicBlastColors.surface,
    onSurface           = LightAtomicBlastColors.textPrimary,
    surfaceVariant      = LightAtomicBlastColors.surface2,
    onSurfaceVariant    = LightAtomicBlastColors.textMuted,
    outline             = LightAtomicBlastColors.border,
    secondary           = LightAtomicBlastColors.green,
    onSecondary         = Color(0xFFFFFFFF),
)

@Composable
fun AtomicBlastTheme(isDark: Boolean = true, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isDark) AtomicBlastDarkColorScheme else AtomicBlastLightColorScheme,
        typography = AtomicBlastTypography,
        content = content
    )
}

