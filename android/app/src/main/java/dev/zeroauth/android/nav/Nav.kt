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
import dev.zeroauth.android.ui.join.JoinScreen
import dev.zeroauth.android.ui.reg.RegistrationScreen
import dev.zeroauth.android.ui.scan.ScanScreen
import dev.zeroauth.android.ui.settings.SettingsScreen

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

    /**
     * QR scanner + proof-generation flow. The optional `challenge`
     * query param carries a pre-supplied `za:pair:1:...` challenge
     * payload (URI-encoded) — the bank-2FA approval inbox uses it to
     * enter the flow without a camera scan. No param = the classic
     * camera-first scan.
     */
    data object Scan : Screen("scan?challenge={challenge}") {
        const val ARG_CHALLENGE = "challenge"
        fun build(challenge: String? = null): String =
            if (challenge != null) "scan?challenge=${Uri.encode(challenge)}" else "scan"
    }
    /** ADR 0023 three-QR end-user signup ceremony. */
    data object Registration : Screen("registration")

    /** UPI-style hub — the returning user's landing surface. */
    data object Home : Screen("home")

    /**
     * Attendance check-in / check-out ceremony. Carries the punch type and
     * an optional companyId (a claimed pass); no companyId = the demo company.
     */
    data object Attendance : Screen("attendance/{type}?companyId={companyId}") {
        const val ARG_TYPE = "type"
        const val ARG_COMPANY = "companyId"
        fun build(type: String, companyId: String? = null): String =
            if (companyId != null) "attendance/$type?companyId=${Uri.encode(companyId)}" else "attendance/$type"
    }

    /** Join a company by scanning an HR invite QR (the Home Scan FAB). */
    data object Join : Screen("join")

    /** "Me" surface — passes, identity, web sign-in, app info. */
    data object Settings : Screen("settings")

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
                    navController.navigate(Screen.Scan.build()) {
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
                    navController.navigate(Screen.Scan.build()) {
                        popUpTo(Screen.Enroll.route) { inclusive = true }
                    }
                },
            )
        }

        composable(
            route     = Screen.Scan.route,
            arguments = listOf(
                navArgument(Screen.Scan.ARG_CHALLENGE) {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
        ) { backStackEntry ->
            // Pre-supplied challenge from the bank-2FA approval inbox.
            // Same decode convention as Screen.Done below.
            val rawChallenge = backStackEntry.arguments?.getString(Screen.Scan.ARG_CHALLENGE)
            ScanScreen(
                challenge = rawChallenge?.let { Uri.decode(it) },
                onQrDecoded = { payload ->
                    navController.navigate(Screen.Done.build(payload))
                },
                onClose = {
                    // Push-approval entry came from Home — land back
                    // there. Fall back to Home explicitly if the
                    // back-stack is empty (deep-link entry).
                    if (!navController.popBackStack()) {
                        navController.navigate(Screen.Home.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                },
            )
        }

        composable(Screen.Home.route) {
            HomeScreen(
                onCheckInOut = { type, companyId ->
                    navController.navigate(Screen.Attendance.build(type, companyId))
                },
                onJoin = {
                    navController.navigate(Screen.Join.route)
                },
                onViewIdentity = {
                    navController.navigate(Screen.Identity.route)
                },
                onOpenSettings = {
                    navController.navigate(Screen.Settings.route)
                },
                // Bank-2FA approval inbox: Approve routes the request's
                // za:pair challenge into the scan flow — no camera scan.
                onApproveRequest = { qrPayload ->
                    navController.navigate(Screen.Scan.build(challenge = qrPayload))
                },
            )
        }

        composable(
            route     = Screen.Attendance.route,
            arguments = listOf(
                navArgument(Screen.Attendance.ARG_TYPE) {
                    type = NavType.StringType
                },
                navArgument(Screen.Attendance.ARG_COMPANY) {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
        ) { backStackEntry ->
            val punchType = backStackEntry.arguments
                ?.getString(Screen.Attendance.ARG_TYPE) ?: "check_in"
            val companyId = backStackEntry.arguments?.getString(Screen.Attendance.ARG_COMPANY)
            AttendanceScreen(
                type = punchType,
                companyId = companyId,
                onDone = { navController.popBackStack() },
                onCancel = { navController.popBackStack() },
            )
        }

        composable(Screen.Join.route) {
            JoinScreen(
                // Back to Home, which refreshes on resume and shows the new
                // pass. Fall back to an explicit nav if the back-stack is empty.
                onJoined = {
                    if (!navController.popBackStack(Screen.Home.route, inclusive = false)) {
                        navController.navigate(Screen.Home.route) { popUpTo(0) { inclusive = true } }
                    }
                },
                onCancel = { navController.popBackStack() },
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                onViewIdentity = { navController.navigate(Screen.Identity.route) },
                onScanSignIn = { navController.navigate(Screen.Scan.build()) },
                onBack = { navController.popBackStack() },
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
