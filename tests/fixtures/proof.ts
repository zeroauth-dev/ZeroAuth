import { v4 as uuidv4 } from 'uuid';

/**
 * Test fixture: a structurally valid Groth16 proof.
 * In tests, the ZKP service uses structural validation (fallback mode)
 * since the verification key isn't loaded during unit tests.
 */
export function createValidProof() {
  return {
    pi_a: [
      '12345678901234567890123456789012345678901234567890',
      '98765432109876543210987654321098765432109876543210',
      '1',
    ] as [string, string, string],
    pi_b: [
      ['12345678901234567890', '98765432109876543210'],
      ['11111111111111111111', '22222222222222222222'],
      ['1', '0'],
    ] as [[string, string], [string, string], [string, string]],
    pi_c: [
      '55555555555555555555555555555555555555555555555555',
      '66666666666666666666666666666666666666666666666666',
      '1',
    ] as [string, string, string],
    protocol: 'groth16' as const,
    curve: 'bn128' as const,
  };
}

export function createValidPublicSignals(): [string, string, string] {
  return [
    '12345678901234567890', // commitment
    '98765432109876543210', // didHash
    '55555555555555555555', // identityBinding
  ];
}

export function createValidVerifyRequest() {
  return {
    proof: createValidProof(),
    publicSignals: createValidPublicSignals(),
    nonce: uuidv4(),
    timestamp: new Date().toISOString(),
  };
}
