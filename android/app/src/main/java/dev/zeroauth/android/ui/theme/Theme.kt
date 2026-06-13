package dev.zeroauth.android.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * ZeroAuth root theme. The brand is monochrome ink — the app is always
 * dark. No system-following toggle. Light theme is a deliberate non-goal
 * to keep the design surface coherent with the dashboard + landing page.
 *
 * Dynamic color is also OFF: the brand identity is the white-on-black
 * palette and a Material You teal tint on a Pixel would dilute it.
 */
private val ZeroAuthColorScheme = darkColorScheme(
    primary             = InkPrimary,
    onPrimary           = InkOnPrimary,
    primaryContainer    = InkPrimaryContainer,
    onPrimaryContainer  = InkOnPrimaryContainer,
    secondary           = InkSecondary,
    onSecondary         = InkOnSecondary,
    background          = InkBackground,
    onBackground        = InkOnSurface,
    surface             = InkSurface,
    onSurface           = InkOnSurface,
    surfaceVariant      = InkSurfaceVariant,
    onSurfaceVariant    = InkOnSurfaceVariant,
    outline             = InkOutline,
    outlineVariant      = InkOutline,
    error               = InkError,
    onError             = InkOnError,
)

@Composable
fun ZeroAuthTheme(
    content: @Composable () -> Unit
) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            window.statusBarColor = InkBackground.toArgb()
            window.navigationBarColor = InkBackground.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
            // Suppress unused warning on older platforms.
            @Suppress("DEPRECATION")
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                // No-op — min-SDK is 30 so this branch is unreachable.
            }
        }
    }
    MaterialTheme(
        colorScheme = ZeroAuthColorScheme,
        typography  = ZeroAuthTypography,
        content     = content,
    )
}
