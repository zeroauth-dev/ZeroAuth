package dev.zeroauth

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented smoke test for the Pramaan banking app scaffold.
 *
 * Runs against a real Android runtime — either an emulator or a
 * connected device on the CI device farm. The only thing it asserts
 * at C-101 is that the host application context resolves and reports
 * the package name expected from `applicationId = "dev.zeroauth.banking"`
 * in app/build.gradle.kts.
 *
 * As feature commits land, this test grows into the canonical
 * "did the APK install and start?" canary for the device fleet. C-104
 * extends it with a prover-init assertion.
 */
@RunWith(AndroidJUnit4::class)
class SmokeInstrumentedTest {

    @Test
    fun applicationPackageNameMatchesApplicationId() {
        val ctx = ApplicationProvider.getApplicationContext<ZeroAuthApplication>()
        // The debug variant appends `.debug` to applicationId via
        // applicationIdSuffix; the instrumented runner installs the
        // debug variant by default, so the resolved package is
        // `dev.zeroauth.banking.debug`. We assert on both prefixes
        // so the same test works whether someone runs it against the
        // debug or release variant.
        val pkg = ctx.packageName
        val ok = pkg == "dev.zeroauth.banking" || pkg == "dev.zeroauth.banking.debug"
        assertEquals(
            "Application package should be dev.zeroauth.banking[.debug] but was '$pkg'",
            true,
            ok,
        )
    }
}
