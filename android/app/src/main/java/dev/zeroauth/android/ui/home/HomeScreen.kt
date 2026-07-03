package dev.zeroauth.android.ui.home

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.zeroauth.android.R
import dev.zeroauth.android.net.ApiFactory
import dev.zeroauth.android.sec.DidStore
import kotlinx.coroutines.delay
import java.time.Instant

/** Approval-inbox poll cadence while the Home hub is STARTED. */
private const val PENDING_POLL_MS = 3_000L

/**
 * Home — the ZeroAuth authenticator's landing surface. Its one job is to
 * sign you in: scan the QR shown by NeoBank or the ZeroAuth console, verify
 * with your face, done. When a login is pushed to this device (UPI-collect
 * style) it surfaces as a "Verification requests" card you approve in place.
 * Monochrome black-and-white; no attendance, no passes.
 */
@Composable
fun HomeScreen(
    onScan: () -> Unit,
    onViewIdentity: () -> Unit,
    onOpenSettings: () -> Unit,
    onApproveRequest: (qrPayload: String) -> Unit,
    viewModel: HomeViewModel = viewModel(
        factory = HomeViewModel.Factory(
            demoPortalApi = ApiFactory.createDemoPortalApi(),
            didProvider = LocalContext.current.applicationContext.let { appContext ->
                { DidStore.getOrDerive(appContext) }
            },
        ),
    ),
) {
    val pendingApprovals by viewModel.pendingApprovals.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current

    // Approval-inbox poll loop. Runs only while STARTED — backgrounding the
    // app stops the network chatter; foregrounding restarts it.
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                viewModel.pollPending()
                delay(PENDING_POLL_MS)
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = { HomeBottomBar(onOpenSettings = onOpenSettings) },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 16.dp),
        ) {
            BrandHeader(onViewIdentity = onViewIdentity)

            if (pendingApprovals.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                PendingApprovalsSection(approvals = pendingApprovals, onApprove = onApproveRequest)
            }

            // Centered sign-in hero between the header and the bottom CTA.
            Column(
                modifier = Modifier.fillMaxWidth().weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Image(
                    painter = painterResource(R.drawable.zeroauth_mark),
                    contentDescription = stringResource(R.string.brand_wordmark),
                    modifier = Modifier.size(64.dp),
                )
                Spacer(Modifier.height(24.dp))
                Text(
                    "Sign in with your face",
                    style = MaterialTheme.typography.headlineSmall,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "Scan the sign-in QR shown by NeoBank or the ZeroAuth console, then verify with your face. Your biometric never leaves this phone.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Button(
                onClick = onScan,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                contentPadding = PaddingValues(horizontal = 24.dp),
            ) {
                Text("Scan to sign in", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun HomeBottomBar(onOpenSettings: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 3.dp) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 28.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = {}) {
                Text("Home", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            }
            TextButton(onClick = onOpenSettings) {
                Text("Me", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun BrandHeader(onViewIdentity: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(
            painter = painterResource(R.drawable.zeroauth_mark),
            contentDescription = stringResource(R.string.brand_wordmark),
            modifier = Modifier.size(36.dp),
        )
        TextButton(onClick = onViewIdentity) {
            Text("My identity", style = MaterialTheme.typography.labelLarge)
        }
    }
}

// ─── Verification requests (pushed login/payment approvals) ──────────

/**
 * "Verification requests" section — pending DID-pinned approvals pushed to
 * this device (a NeoBank login, or a high-value payment step-up). Collapses
 * to nothing when the inbox is empty. Each card's Approve routes the
 * request's `za:pair:1:...` challenge into the scan→face→prove→authorize
 * flow, no camera scan needed.
 */
@Composable
private fun PendingApprovalsSection(
    approvals: List<PendingApproval>,
    onApprove: (String) -> Unit,
) {
    if (approvals.isEmpty()) return

    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(approvals) {
        while (true) {
            nowMs = System.currentTimeMillis()
            delay(1_000L)
        }
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            stringResource(R.string.home_requests_title),
            style = MaterialTheme.typography.titleMedium,
        )
        Spacer(Modifier.height(12.dp))
        approvals.forEach { approval ->
            PendingApprovalCard(approval = approval, nowMs = nowMs, onApprove = onApprove)
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun PendingApprovalCard(
    approval: PendingApproval,
    nowMs: Long,
    onApprove: (String) -> Unit,
) {
    val expiresInMs = approval.expiresAt?.let { parseIsoMs(it) }?.minus(nowMs)
    val expired = expiresInMs != null && expiresInMs <= 0L

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val browser = friendlyDeviceHint(approval.deviceHint)
                ?: stringResource(R.string.home_request_unknown_device)
            if (approval.isPayment) {
                // Payment approval: "Payment approval" title + the server's
                // contextLabel ("Pay ₹5,000 to Priya") as the prominent line.
                // Monochrome — a filled white dot marks a payment vs a login.
                Text(
                    stringResource(R.string.home_request_payment_title),
                    style = MaterialTheme.typography.headlineSmall,
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.onSurface),
                    )
                    Text(
                        text = approval.contextLabel
                            ?: stringResource(R.string.home_request_payment_generic),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                Text(
                    text = stringResource(R.string.home_request_via_device, browser),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                // Login approval.
                Text(approval.bank, style = MaterialTheme.typography.headlineSmall)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.onSurfaceVariant),
                    )
                    Text(
                        text = stringResource(R.string.home_request_kind_device, browser),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            val requestedAgo = approval.requestedAt?.let { parseIsoMs(it) }
                ?.let { friendlyAgo(nowMs - it) }
            Text(
                text = listOfNotNull(
                    requestedAgo?.let { stringResource(R.string.home_request_requested_ago, it) },
                    when {
                        expired -> stringResource(R.string.home_request_expired)
                        expiresInMs != null ->
                            stringResource(R.string.home_request_expires_in, friendlyCountdown(expiresInMs))
                        else -> null
                    },
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
                color = if (expired) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            Button(
                onClick = { onApprove(approval.qrPayload) },
                enabled = !expired,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                contentPadding = PaddingValues(horizontal = 24.dp),
            ) {
                Text(
                    text = stringResource(R.string.home_request_approve_cta),
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

/** ISO-8601 → epoch millis; null when the string doesn't parse. */
private fun parseIsoMs(iso: String): Long? =
    runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()

/** "Just now" / "42s ago" / "3m ago" relative-time label. */
private fun friendlyAgo(deltaMs: Long): String {
    val s = deltaMs / 1_000L
    return when {
        s < 10 -> "just now"
        s < 60 -> "${s}s ago"
        else -> "${s / 60}m ago"
    }
}

/** "1m 42s" / "42s" countdown label. */
private fun friendlyCountdown(remainingMs: Long): String {
    val total = (remainingMs / 1_000L).coerceAtLeast(0L)
    val m = total / 60
    val s = total % 60
    return if (m > 0) "${m}m ${s}s" else "${s}s"
}

/**
 * Collapse the truncated desktop User-Agent into a human browser name.
 * Order matters — Chrome's UA contains "Safari", Edge's contains both.
 */
private fun friendlyDeviceHint(userAgent: String?): String? {
    val ua = userAgent?.takeIf { it.isNotBlank() } ?: return null
    return when {
        ua.contains("Edg", ignoreCase = true) -> "Microsoft Edge"
        ua.contains("OPR", ignoreCase = true) || ua.contains("Opera", ignoreCase = true) -> "Opera"
        ua.contains("Firefox", ignoreCase = true) -> "Firefox"
        ua.contains("Chrome", ignoreCase = true) -> "Chrome"
        ua.contains("Safari", ignoreCase = true) -> "Safari"
        else -> ua.take(40)
    }
}
