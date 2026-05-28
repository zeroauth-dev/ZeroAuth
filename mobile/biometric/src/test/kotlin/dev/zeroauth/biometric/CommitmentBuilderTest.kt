package dev.zeroauth.biometric

import android.graphics.Bitmap
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.math.sqrt
import kotlin.test.assertFailsWith

/**
 * CommitmentBuilderTest — end-to-end wiring with mocks.
 *
 * The pipeline currently terminates at the [Poseidon.hash2] stub. This
 * test asserts that everything *upstream* of Poseidon (quantising,
 * hashing, salt-fetch) is correctly wired by checking that
 * [CommitmentBuilder.buildFromEmbedding] reaches the Poseidon stub
 * and surfaces its NotImplementedError. When the real Poseidon lands,
 * this test upgrades from "throws NotImplementedError" to "produces a
 * valid commitment matching the circomlibjs reference vector".
 *
 * We exercise [CommitmentBuilder.buildFromEmbedding] rather than
 * [CommitmentBuilder.build] because the latter requires a real
 * [android.graphics.Bitmap] which can't be instantiated outside the
 * Android runtime. The bitmap-bearing variant is covered by the
 * instrumented test that lands with the FaceCapture commit (per
 * ADR-0018's deferred work table).
 */
class CommitmentBuilderTest {

    /** Build a 128-dim L2-normalised embedding from a seed. */
    private fun fixtureEmbedding(seed: Int = 17): FloatArray {
        var state = seed.toLong() and 0xFFFFFFFFL
        val raw = FloatArray(128) {
            state = (state * 0x5DEECE66DL + 0xBL) and ((1L shl 48) - 1)
            ((state shr 16).toInt() and 0xFFFF).toFloat() / 32768.0f - 1.0f
        }
        var sumSq = 0.0
        for (e in raw) sumSq += (e * e).toDouble()
        val norm = sqrt(sumSq).toFloat()
        return FloatArray(128) { raw[it] / norm }
    }

    private class MockFaceEmbedder(private val output: FloatArray) : FaceEmbedder {
        var called = 0
            private set

        override suspend fun embed(bitmap: Bitmap): FloatArray {
            called += 1
            return output
        }
    }

    private class MockSaltProvider(private val salt: ByteArray) : SaltProvider {
        var called = 0
            private set

        override suspend fun salt(): ByteArray {
            called += 1
            return salt
        }
    }

    @Test
    fun `pipeline reaches Poseidon and surfaces the stub error`() = runTest {
        val embedder = MockFaceEmbedder(fixtureEmbedding())
        val saltProvider = MockSaltProvider(ByteArray(32) { 0x11 })
        val builder = CommitmentBuilder(embedder, saltProvider)

        // We use buildFromEmbedding so the JVM unit test doesn't need
        // a real Bitmap (which can't be instantiated outside the
        // Android runtime). The bitmap-bearing build() variant is
        // exercised by the instrumented test in the FaceCapture
        // commit; this test asserts the rest of the pipeline is
        // wired correctly.
        assertFailsWith<NotImplementedError> {
            builder.buildFromEmbedding(fixtureEmbedding())
        }

        // Sanity: the salt provider was called exactly once (the
        // pipeline reached Stage 4). If a future refactor reorders
        // stages, this catches it. The mock embedder isn't called
        // because buildFromEmbedding skips the embedding stage.
        kotlin.test.assertEquals(0, embedder.called)
        kotlin.test.assertEquals(1, saltProvider.called)
    }

    @Test
    fun `pipeline rejects oversized salt from a misbehaving SaltProvider`() = runTest {
        val embedder = MockFaceEmbedder(fixtureEmbedding())
        val badSaltProvider = MockSaltProvider(ByteArray(31)) // wrong size
        val builder = CommitmentBuilder(embedder, badSaltProvider)
        assertFailsWith<IllegalStateException> {
            builder.buildFromEmbedding(fixtureEmbedding())
        }
    }

    @Test
    fun `Commitment construction asserts byte-length invariants`() {
        // Each field must be 32 bytes; mismatched lengths must throw
        // before the value reaches any downstream consumer.
        assertFailsWith<IllegalArgumentException> {
            Commitment(
                did = "did:zeroauth:abcd",
                value = ByteArray(16),
                salt = ByteArray(32),
                secret = ByteArray(32),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            Commitment(
                did = "did:zeroauth:abcd",
                value = ByteArray(32),
                salt = ByteArray(31),
                secret = ByteArray(32),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            Commitment(
                did = "did:zeroauth:abcd",
                value = ByteArray(32),
                salt = ByteArray(32),
                secret = ByteArray(64),
            )
        }
    }

    @Test
    fun `Commitment construction requires the did_zeroauth prefix`() {
        assertFailsWith<IllegalArgumentException> {
            Commitment(
                did = "did:other:abcd",
                value = ByteArray(32),
                salt = ByteArray(32),
                secret = ByteArray(32),
            )
        }
    }

    @Test
    fun `Commitment_clearSensitive zeroes secret and salt but not value or did`() {
        val c = Commitment(
            did = "did:zeroauth:abcd",
            value = ByteArray(32) { 0x42 },
            salt = ByteArray(32) { 0x55 },
            secret = ByteArray(32) { 0x77 },
        )
        c.clearSensitive()
        // secret + salt must be all-zero now.
        for (i in c.secret.indices) {
            kotlin.test.assertEquals(0.toByte(), c.secret[i])
        }
        for (i in c.salt.indices) {
            kotlin.test.assertEquals(0.toByte(), c.salt[i])
        }
        // value (the public commitment) is untouched.
        for (i in c.value.indices) {
            kotlin.test.assertEquals(0x42.toByte(), c.value[i])
        }
        // did is untouched.
        kotlin.test.assertEquals("did:zeroauth:abcd", c.did)
    }

    @Test
    fun `clearSensitive is idempotent`() {
        val c = Commitment(
            did = "did:zeroauth:abcd",
            value = ByteArray(32),
            salt = ByteArray(32) { 0x11 },
            secret = ByteArray(32) { 0x22 },
        )
        c.clearSensitive()
        c.clearSensitive() // Second call must not throw.
        for (b in c.secret) kotlin.test.assertEquals(0.toByte(), b)
        for (b in c.salt) kotlin.test.assertEquals(0.toByte(), b)
    }
}
