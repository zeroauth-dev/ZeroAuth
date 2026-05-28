import type { PairingSession } from '../../../lib/api';

export interface KioskTenantFixture {
  id: string;
  displayName: string;
}

export const ANCHOR_BANK_TENANT: KioskTenantFixture = {
  id: 'anchor-bank-demo',
  displayName: 'Anchor Bank',
};

export const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Build a deterministic-by-default PairingSession the kiosk tests can
 * thread through the mocked `api.pairing.createSession` resolution.
 * Tests that need a different expiry / nonce override the relevant
 * field through `overrides`.
 */
export function makeKioskSession(overrides: Partial<PairingSession> = {}): PairingSession {
  return {
    id: '1f0e2d3c-4b5a-6789-abcd-ef0123456789',
    nonce: 'b'.repeat(64),
    expiresAt: new Date(Date.now() + FIVE_MINUTES_MS).toISOString(),
    qrPayload: 'za:pair:1:1f0e2d3c:nonce:anchor-bank-demo:kiosk',
    streamUrl: '/api/console/proof-pairing/sessions/1f0e2d3c/stream',
    state: 'issued',
    ...overrides,
  };
}

/**
 * Convenience: second-fixture for the "expired → regenerate" test
 * path. Distinct session id so the test can assert that the kiosk
 * subscribes to the new session's stream after the expiry event.
 */
export function makeReissuedKioskSession(overrides: Partial<PairingSession> = {}): PairingSession {
  return makeKioskSession({
    id: '2c1b0a9e-8d7c-6b5a-4938-271605f4e3d2',
    nonce: 'c'.repeat(64),
    qrPayload: 'za:pair:1:2c1b0a9e:nonce:anchor-bank-demo:kiosk',
    streamUrl: '/api/console/proof-pairing/sessions/2c1b0a9e/stream',
    ...overrides,
  });
}
