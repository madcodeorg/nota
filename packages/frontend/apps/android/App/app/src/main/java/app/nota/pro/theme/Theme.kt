package app.nota.pro.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable

object NotaTheme {
    val colors: NotaColorScheme
        @ReadOnlyComposable
        @Composable
        get() = LocalNotaColors.current

    val typography: NotaTypography
        @ReadOnlyComposable
        @Composable
        get() = LocalNotaTypography.current
}

@Composable
fun NotaTheme(
    mode: ThemeMode = ThemeMode.System,
    content: @Composable () -> Unit
) {
    val colors = when (mode) {
        ThemeMode.Light -> notaLightScheme
        ThemeMode.Dark -> notaDarkScheme
        ThemeMode.System -> if (isSystemInDarkTheme()) notaDarkScheme else notaLightScheme
    }

    CompositionLocalProvider(LocalNotaColors provides colors) {
        MaterialTheme {
            content()
        }
    }
}

enum class ThemeMode(name: String) {
    Light("light"),
    Dark("dark"),
    System("system");

    fun of(name: String) = when (name) {
        "light" -> Light
        "dark" -> Dark
        else -> System
    }
}