/**
 * Unit tests for verifier/src/groth16.ts.
 *
 * No real snarkjs / vkey is loaded — initVerifier is called with a
 * non-existent path so the module operates in structural-fallback mode.
 * That's the meaningful test surface (the real cryptographic verify
 * lives behind snarkjs and is exercised by the API repo's zkp.test.ts
 * against a fixture).
 */

import { initVerifier, verifyProof, isVkeyLoaded } from '../src/groth16';

const fakeProof = {
  pi_a: ['12345678901234567890', '98765432109876543210', '1'] as [string, string, string],
  pi_b: [
    ['11111111111111111111', '22222222222222222222'],
    ['33333333333333333333', '44444444444444444444'],
    ['1', '0'],
  ] as [[string, string], [string, string], [string, string]],
  pi_c: ['55555555555555555555', '66666666666666666666', '1'] as [string, string, string],
  protocol: 'groth16' as const,
  curve: 'bn128' as const,
};

const signals: [string, string, string] = ['0x1', '0x2', '0x3'];

describe('verifier/groth16 — structural fallback path', () => {
  beforeAll(async () => {
    // Point at a path that doesn't exist → vkey-not-loaded → fallback mode
    await initVerifier('this/path/definitely/does/not/exist.json');
  });

  it('isVkeyLoaded() returns false when init found no key', () => {
    expect(isVkeyLoaded()).toBe(false);
  });

  it('verifyProof returns structuralFallback=true when no vkey is loaded', async () => {
    const result = await verifyProof(fakeProof, signals);
    expect(result.structuralFallback).toBe(true);
  });

  it('verifyProof accepts a well-shaped Groth16 envelope as verified (in fallback only)', async () => {
    const result = await verifyProof(fakeProof, signals);
    expect(result.verified).toBe(true);
  });

  it('verifyProof rejects when protocol is not "groth16"', async () => {
    const bad = { ...fakeProof, protocol: 'plonk' as any };
    const result = await verifyProof(bad, signals);
    expect(result.verified).toBe(false);
  });

  it('verifyProof rejects when curve is not "bn128"', async () => {
    const bad = { ...fakeProof, curve: 'bls12-381' as any };
    const result = await verifyProof(bad, signals);
    expect(result.verified).toBe(false);
  });

  it('verifyProof rejects when pi_a has wrong length', async () => {
    const bad = { ...fakeProof, pi_a: ['only', 'two'] as any };
    const result = await verifyProof(bad, signals);
    expect(result.verified).toBe(false);
  });

  it('verifyProof rejects when pi_a contains an empty string', async () => {
    const bad = { ...fakeProof, pi_a: ['', 'x', '1'] as [string, string, string] };
    const result = await verifyProof(bad, signals);
    expect(result.verified).toBe(false);
  });

  it('verifyProof rejects when pi_c contains a non-string', async () => {
    const bad = { ...fakeProof, pi_c: [123 as any, '2', '1'] as any };
    const result = await verifyProof(bad, signals);
    expect(result.verified).toBe(false);
  });

  it('verifyProof never throws on a totally malformed proof — returns verified:false', async () => {
    const result = await verifyProof({} as any, signals);
    expect(result.verified).toBe(false);
    expect(result.structuralFallback).toBe(true);
  });
});
