package dev.zeroauth.android.nav

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dev.zeroauth.android.ui.DoneScreen
import dev.zeroauth.android.ui.EnrollScreen
import dev.zeroauth.android.ui.SplashScreen
import dev.zeroauth.android.ui.hasRegisteredIdentity
import dev.zeroauth.android.ui.attendance.AttendanceScreen
import dev.zeroauth.android.ui.home.HomeScreen
import dev.zeroauth.android.ui.identity.IdentityDetailsScreen
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

    /** UPI-style hub — the returning user's landing surface. */
    data object Home : Screen("home")

    /** Attendance check-in / check-out ceremony. Carries the punch type. */
    data object Attendance : Screen("attendance/{type}") {
        const val ARG_TYPE = "type"
        fun build(type: String): String = "attendance/$type"
    }

    /**
     * Read-only identity diagnostic surface. Reachable from the splash
     * "View my identity" affordance once a registration has run on
     * the device, and from the post-registration Completed state. The
     * screen takes no arguments — it re-derives (did, commitment)
     * from the persisted [dev.zeroauth.android.ui.reg.PerInstallStableSecret]
     * so a deep-link entry without state still renders correctly.
     */
    data object Identity : Screen("identity")

    data object Done : Screen("done?payload={payload}") {
        const val ARG_PAYLOAD = "payload"
        fun build(payload: String): String =
            "done?payload=${Uri.encode(payload)}"
    }
}

@Composable
fun ZeroAuthNavHost() {
    val navController = rememberNavController()
    val context = LocalContext.current
    // First launch (no on-device identity) → Splash → create identity. A
    // returning user with an identity lands straight on the Home hub.
    val startDestination = remember {
        if (hasRegisteredIdentity(context)) Screen.Home.route else Screen.Splash.route
    }

    NavHost(
        navController    = navController,
        startDestination = startDestination,
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
                // Tertiary affordance — diagnostic identity view. The
                // splash hides this if no registration has run on the
                // device yet (see SplashScreen.hasIdentity gating). We
                // do NOT pop the splash so back from Identity lands
                // here, not on a blank back-stack.
                onViewIdentity = {
                    navController.navigate(Screen.Identity.route)
                },
            )
        }

        composable(Screen.Registration.route) {
            RegistrationScreen(
                onDone = {
                    // Identity now exists on-device → land on the hub, and
                    // clear the back-stack so system-back exits the app.
                    navController.navigate(Screen.Home.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onViewIdentity = {
                    navController.navigate(Screen.Identity.route) {
                        // Pop the registration ceremony off the back-stack
                        // so back-from-Identity lands on Splash, not on
                        // the just-completed registration form. Identity
                        // is a leaf in the post-registration flow.
                        popUpTo(Screen.Registration.route) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.Identity.route) {
            IdentityDetailsScreen(
                onBack = {
                    // Prefer popping the back-stack — if Identity was
                    // reached from Splash via the "View my identity"
                    // affordance, popBackStack lands the user back on
                    // Splash without rebuilding it. If popBackStack
                    // returns false (deep-link / direct entry), fall
                    // back to navigate(Splash) clearing the stack.
                    if (!navController.popBackStack()) {
                        navController.navigate(Screen.Splash.route) {
                            popUpTo(0) { inclusive = true }
                        }
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

        composable(Screen.Home.route) {
            HomeScreen(
                onCheckInOut = { type ->
                    navController.navigate(Screen.Attendance.build(type))
                },
                onScan = {
                    navController.navigate(Screen.Scan.route)
                },
                onViewIdentity = {
                    navController.navigate(Screen.Identity.route)
                },
            )
        }

        composable(
            route     = Screen.Attendance.route,
            arguments = listOf(
                navArgument(Screen.Attendance.ARG_TYPE) {
                    type = NavType.StringType
                }
            ),
        ) { backStackEntry ->
            val punchType = backStackEntry.arguments
                ?.getString(Screen.Attendance.ARG_TYPE) ?: "check_in"
            AttendanceScreen(
                type = punchType,
                onDone = { navController.popBackStack() },
                onCancel = { navController.popBackStack() },
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
