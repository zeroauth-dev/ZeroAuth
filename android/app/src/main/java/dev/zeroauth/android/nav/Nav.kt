package dev.zeroauth.android.nav

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dev.zeroauth.android.ui.DoneScreen
import dev.zeroauth.android.ui.EnrollScreen
import dev.zeroauth.android.ui.SplashScreen
import dev.zeroauth.android.ui.reg.RegistrationScreen
import dev.zeroauth.android.ui.scan.ScanScreen

/**
 * Navigation graph. Sealed class describes the destinations, with the
 * route-string templates that Nav Compose's NavHost expects.
 *
 * The Done destination carries a payload (the decoded QR string). Nav
 * Compose's StringType supports any UTF-8 string but `/` is reserved as
 * the route segment delimiter, so the payload is URI-encoded by the
 * caller and decoded inside DoneScreen. The scan-side QR format
 * ("za:pair:1:<sessionId>:<nonceHex>:<tenantDomain>:<integrityTag>")
 * does not contain `/` but the encode step keeps us safe if the
 * format ever evolves.
 */
sealed class Screen(val route: String) {
    data object Splash : Screen("splash")
    data object Enroll : Screen("enroll")
    data object Scan   : Screen("scan")
    /** ADR 0023 three-QR end-user signup ceremony. */
    data object Registration : Screen("registration")

    data object Done : Screen("done?payload={payload}") {
        const val ARG_PAYLOAD = "payload"
        fun build(payload: String): String =
            "done?payload=${Uri.encode(payload)}"
    }
}

@Composable
fun ZeroAuthNavHost() {
    val navController = rememberNavController()

    NavHost(
        navController    = navController,
        startDestination = Screen.Splash.route,
    ) {
        composable(Screen.Splash.route) {
            SplashScreen(
                // Primary "Sign in (scan QR)" CTA — funnels straight
                // into the proof-pairing ScanScreen. We pop the splash
                // off the back-stack so the system-back from Scan exits
                // the app rather than landing the user back on the
                // launcher screen they already left.
                onSignIn = {
                    navController.navigate(Screen.Scan.route) {
                        popUpTo(Screen.Splash.route) { inclusive = true }
                    }
                },
                // Secondary link — registration ceremony (ADR 0023).
                // We don't pop the splash here so the user can hit back
                // and try sign-in again without re-launching the app.
                onCreateAccount = {
                    navController.navigate(Screen.Registration.route)
                },
            )
        }

        composable(Screen.Registration.route) {
            RegistrationScreen(
                onDone = {
                    navController.navigate(Screen.Splash.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.Enroll.route) {
            EnrollScreen(
                onEnrolled = {
                    navController.navigate(Screen.Scan.route) {
                        popUpTo(Screen.Enroll.route) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.Scan.route) {
            ScanScreen(
                onQrDecoded = { payload ->
                    navController.navigate(Screen.Done.build(payload))
                },
            )
        }

        composable(
            route     = Screen.Done.route,
            arguments = listOf(
                navArgument(Screen.Done.ARG_PAYLOAD) {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            ),
        ) { backStackEntry ->
            val raw = backStackEntry.arguments?.getString(Screen.Done.ARG_PAYLOAD)
            val payload = raw?.let { Uri.decode(it) }
            DoneScreen(
                payload = payload,
                onDone = {
                    navController.navigate(Screen.Splash.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
    }
}
