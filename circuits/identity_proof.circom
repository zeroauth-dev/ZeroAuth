pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

/**
 * IdentityProof — Patent Module 216 (ZKP Verification)
 *
 * Proves: "I know a biometricSecret and salt such that
 *          Poseidon(biometricSecret, salt) == commitment
 *          AND Poseidon(biometricSecret, didHash) == identityBinding"
 *
 * Private inputs:
 *   - biometricSecret: derived from SHA-256(biometric) via Poseidon in app layer
 *   - salt: random value given to user at registration
 *
 * Public inputs:
 *   - commitment: Poseidon(biometricSecret, salt) — registered on-chain
 *   - didHash: Poseidon hash of the DID — binds proof to specific identity
 *   - identityBinding: Poseidon(biometricSecret, didHash) — proves DID ownership
 *
 * The verifier checks that the prover knows the preimage of the commitment
 * AND that it is bound to the correct DID, without learning the secret.
 */
template IdentityProof() {
    // Private inputs (known only to the prover)
    signal input biometricSecret;
    signal input salt;

    // Public inputs (known to verifier)
    signal input commitment;
    signal input didHash;
    signal input identityBinding;

    // 1. Verify commitment = Poseidon(biometricSecret, salt)
    component commitHasher = Poseidon(2);
    commitHasher.inputs[0] <== biometricSecret;
    commitHasher.inputs[1] <== salt;
    commitment === commitHasher.out;

    // 2. Verify identityBinding = Poseidon(biometricSecret, didHash)
    component bindingHasher = Poseidon(2);
    bindingHasher.inputs[0] <== biometricSecret;
    bindingHasher.inputs[1] <== didHash;
    identityBinding === bindingHasher.out;
}

component main {public [commitment, didHash, identityBinding]} = IdentityProof();
