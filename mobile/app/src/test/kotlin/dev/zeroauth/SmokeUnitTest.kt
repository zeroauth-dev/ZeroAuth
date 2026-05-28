package dev.zeroauth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * Trivial JVM-only smoke test for the Pramaan banking app scaffold.
 *
 * The whole point of this test at C-101 is to prove that the Kotlin
 * source set under `app/src/test/` is discovered by Gradle and runs on
 * the JVM without requiring a connected emulator. Real coverage lands
 * with C-104 (prover smoke) and beyond.
 *
 * If this test ever fails the most likely cause is a misconfigured
 * Kotlin/JVM target — see kotlinOptions { jvmTarget = "17" } in
 * app/build.gradle.kts.
 */
class SmokeUnitTest {

    @Test
    fun applicationClassExists() {
        // Application class is reachable as a Class<*> without
        // actually instantiating Android. We don't call Application()
        // here because that would need the Android framework on the
        // classpath (which we deliberately keep out of unit tests so
        // the JVM-side suite stays fast).
        assertNotNull(
            "ZeroAuthApplication must be resolvable from the JVM test set",
            ZeroAuthApplication::class.java,
        )
    }

    @Test
    fun applicationClassNameIsStable() {
        // Cross-check the FQCN that AndroidManifest.xml references.
        // If someone renames the class without updating the manifest
        // the app fails to launch; this catches it in unit tests
        // rather than at install time on a device.
        assertEquals(
            "dev.zeroauth.ZeroAuthApplication",
            ZeroAuthApplication::class.java.name,
        )
    }
}
