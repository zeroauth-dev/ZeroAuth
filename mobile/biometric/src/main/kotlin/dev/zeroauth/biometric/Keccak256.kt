package dev.zeroauth.biometric

import org.bouncycastle.jcajce.provider.digest.Keccak

/**
 * Keccak-256 (EVM-compatible, NOT NIST SHA3-256) wrapper.
 *
 * Used for DID derivation: the first 20 bytes of `keccak256(commitment)`
 * become the DID suffix, mimicking Ethereum's address-from-pubkey
 * convention so that the same identity primitive can be re-anchored
 * on any EVM-compatible chain. This is the on-chain layer of ADR-0017
 * (blockchain-agnostic posture) — the platform's identity primitive is
 * the Poseidon commitment, and the DID is just a stable, EVM-shaped
 * label over that commitment.
 *
 * # Why Keccak and not SHA3-256?
 *
 * Pre-NIST padding differs. The two algorithms diverge on the padding
 * byte: original Keccak (the one Ethereum uses) appends 0x01 then 0x80,
 * NIST SHA3 appends 0x06 then 0x80. The on-chain DIDRegistry contract
 * (Solidity `keccak256(...)`) uses original Keccak; if the on-device
 * derivation used NIST SHA3, the DIDs derived in the app would never
 * collide with the on-chain ones for the same commitment.
 *
 * Android's built-in `MessageDigest` exposes `SHA3-256` but not the
 * original Keccak flavour, so we route through BouncyCastle's
 * `Keccak.Digest256` engine.
 */
object Keccak256 {

    /** Output length in bytes. */
    const val DIGEST_LENGTH: Int = 32

    /**
     * Compute the EVM-compatible Keccak-256 digest of [input].
     *
     * Input is NOT mutated — the Bitmap-derived bytes were already
     * zeroed in [Sha256.digest] upstream; by the time we get here the
     * input is the Poseidon commitment (a public value).
     *
     * @param input Bytes to hash. Length is unconstrained.
     * @return A fresh 32-byte digest.
     */
    fun digest(input: ByteArray): ByteArray {
        val engine = Keccak.Digest256()
        engine.update(input)
        return engine.digest()
    }
}
