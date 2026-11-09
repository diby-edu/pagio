package com.pagio.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pagio.app.data.ThemeMode

/** Identité visuelle Pagio : indigo profond, accent corail, surfaces douces. */
object Brand {
    val Indigo = Color(0xFF5B4BDB)
    val IndigoDark = Color(0xFF3B2FA8)
    val Coral = Color(0xFFFF6B57)
    val Teal = Color(0xFF14A37F)
    val Ink = Color(0xFF14152B)
    val heroGradient = Brush.linearGradient(listOf(Color(0xFF4535C9), Color(0xFF7A5CF0), Color(0xFFFF7A66)))
    val heroGradientDark = Brush.linearGradient(listOf(Color(0xFF221A6E), Color(0xFF3F2F99), Color(0xFF8C3B4A)))
}

private val Light = lightColorScheme(
    primary = Brand.Indigo, onPrimary = Color.White,
    primaryContainer = Color(0xFFE6E2FF), onPrimaryContainer = Color(0xFF1B1270),
    secondary = Brand.Coral, onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFE1DC), onSecondaryContainer = Color(0xFF5A1509),
    tertiary = Brand.Teal, onTertiary = Color.White,
    tertiaryContainer = Color(0xFFD2F5EA), onTertiaryContainer = Color(0xFF00382A),
    background = Color(0xFFF7F7FB), onBackground = Brand.Ink,
    surface = Color(0xFFFFFFFF), onSurface = Brand.Ink,
    surfaceVariant = Color(0xFFEEEEF6), onSurfaceVariant = Color(0xFF5A5B70),
    surfaceContainer = Color(0xFFF1F1F8), surfaceContainerHigh = Color(0xFFEAEAF3),
    surfaceContainerLow = Color(0xFFF7F7FC), surfaceContainerLowest = Color.White,
    outline = Color(0xFFC9CAD9), outlineVariant = Color(0xFFE3E3EE),
    error = Color(0xFFD92D20), errorContainer = Color(0xFFFEE4E2),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFB7AEFF), onPrimary = Color(0xFF221677),
    primaryContainer = Color(0xFF3B2FA8), onPrimaryContainer = Color(0xFFE6E2FF),
    secondary = Color(0xFFFFB4A8), onSecondary = Color(0xFF5A1509),
    secondaryContainer = Color(0xFF7A2A1C), onSecondaryContainer = Color(0xFFFFE1DC),
    tertiary = Color(0xFF7BDCC0), onTertiary = Color(0xFF00382A),
    background = Color(0xFF0F1020), onBackground = Color(0xFFE6E6F2),
    surface = Color(0xFF15162A), onSurface = Color(0xFFE6E6F2),
    surfaceVariant = Color(0xFF26283F), onSurfaceVariant = Color(0xFFB9BAD0),
    surfaceContainer = Color(0xFF1B1C31), surfaceContainerHigh = Color(0xFF23253B),
    surfaceContainerLow = Color(0xFF17182C), surfaceContainerLowest = Color(0xFF0C0D1A),
    outline = Color(0xFF55576F), outlineVariant = Color(0xFF34364E),
    error = Color(0xFFFFB4AB), errorContainer = Color(0xFF7A1C14),
)

private val AppTypography = Typography(
    displaySmall = TextStyle(fontSize = 30.sp, fontWeight = FontWeight.Bold, lineHeight = 36.sp, letterSpacing = (-0.5).sp),
    headlineMedium = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.Bold, lineHeight = 32.sp, letterSpacing = (-0.3).sp),
    headlineSmall = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold, lineHeight = 28.sp),
    titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold, lineHeight = 26.sp),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, lineHeight = 22.sp),
    titleSmall = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, lineHeight = 20.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, lineHeight = 20.sp),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium, lineHeight = 16.sp),
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(22.dp), extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun PagioTheme(mode: ThemeMode = ThemeMode.SYSTEM, dynamic: Boolean = false, content: @Composable () -> Unit) {
    val dark = when (mode) { ThemeMode.SYSTEM -> isSystemInDarkTheme(); ThemeMode.LIGHT -> false; ThemeMode.DARK -> true }
    val ctx = LocalContext.current
    val scheme = when {
        dynamic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        dark -> Dark
        else -> Light
    }
    MaterialTheme(colorScheme = scheme, typography = AppTypography, shapes = AppShapes, content = content)
}
