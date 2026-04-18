package com.atomicblast.android.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Optimized for 1024x600 ATOTO S8 head unit
val AtomicBlastTypography = Typography(
    headlineLarge = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 32.sp, // Enlarged from 28
        letterSpacing = 0.sp
    ),
    headlineMedium = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp, // Enlarged from 20
        letterSpacing = 0.sp
    ),
    titleLarge = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp, // Enlarged from 18 (Target 22sp)
        letterSpacing = 0.sp
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp, // Enlarged from 14 (Target 18sp)
        letterSpacing = 0.sp
    ),
    bodyLarge = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 18.sp // Enlarged from 14
    ),
    bodyMedium = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp // Enlarged from 13
    ),
    labelSmall = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 12.sp, // Enlarged from 10
        letterSpacing = 0.06.sp
    )
)
