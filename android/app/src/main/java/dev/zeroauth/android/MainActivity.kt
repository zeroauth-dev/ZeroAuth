package dev.zeroauth.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dev.zeroauth.android.nav.ZeroAuthNavHost
import dev.zeroauth.android.ui.theme.ZeroAuthTheme

/**
 * Single-activity host. Compose owns every pixel inside; the only thing
 * MainActivity itself does is configure edge-to-edge + apply the theme.
 *
 * The activity is declared with android:configChanges so Compose's own
 * config-change handling kicks in instead of activity recreation — this
 * matters once the CameraX preview is bound, because recreating the
 * activity tears down the camera session and re-binding can take ~600 ms
 * on mid-range hardware.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ZeroAuthTheme {
                ZeroAuthNavHost()
            }
        }
    }
}
