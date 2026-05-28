/**
 * Source-level guard for the blockchain-agnostic platform posture
 * (ADR 0017). The platform default — `did_provider='off-chain'`,
 * `verifier_provider='off-chain'`, `audit_anchor_provider='none'` —
 * means a tenant whose security_policy is null/empty MUST work
 * without any chain RPC, deploy key, or contract address.
 *
 * These tests grep the relevant services for the gate symbol
 * `resolveProviders` and assert the on-chain code paths are wrapped
 * in the appropriate provider check.
 *
 * The runtime behaviour (boot without BLOCKCHAIN_PRIVATE_KEY,
 * anchor-job skips default tenants, identity register skips chain
 * for off-chain provider) is exercised by:
 *   - tests/tenant-providers.test.ts (resolver)
 *   - tests/anchor-job.test.ts (skip behaviour)
 *   - tests/identity.test.ts (off-chain enrollment)
 *
 * This file is the static guard against re-introduction of a
 * mandatory chain dependency.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../src');

function read(file: string): string {
  return fs.readFileSync(path.join(SRC, file), 'utf8');
}

function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/\/\/[^\n]*/g, '');
  return out;
}

describe('blockchain-agnostic posture (ADR 0017)', () => {
  it('src/services/identity.ts gates registerIdentityOnChain behind resolveProviders', () => {
    const src = stripComments(read('services/identity.ts'));
    // The call to registerIdentityOnChain must appear AFTER a
    // resolveProviders() invocation in the same scope.
    const hasResolve = /resolveProviders\s*\(/.test(src);
    const hasChainCall = /registerIdentityOnChain\s*\(/.test(src);
    expect(hasResolve).toBe(true);
    expect(hasChainCall).toBe(true);
    // The chain call must be inside an if-branch keyed on a
    // provider value other than 'off-chain'. The cheap source-level
    // check: the literal string 'off-chain' or didProvider check
    // appears within ~40 lines of the chain call.
    const chainCallIdx = src.search(/registerIdentityOnChain\s*\(/);
    const window = src.slice(Math.max(0, chainCallIdx - 2000), chainCallIdx + 200);
    expect(window).toMatch(/off-chain|didProvider|did_provider/);
  });

  it('src/services/anchor-job.ts skips tenants whose auditAnchorProvider is none', () => {
    const src = stripComments(read('services/anchor-job.ts'));
    expect(src).toMatch(/resolveProviders\s*\(/);
    // The skip clause must appear textually — either by checking the
    // resolved provider or by gating the per-tenant work.
    expect(src).toMatch(/auditAnchorProvider|audit_anchor_provider/);
    expect(src).toMatch(/['"]none['"]/);
  });

  it('src/services/blockchain.ts exports an isBlockchainReady boot-tolerant check', () => {
    const src = stripComments(read('services/blockchain.ts'));
    // The platform must expose a non-throwing boot-tolerant flag so
    // the rest of the codebase can gate chain-touching code paths
    // without try/catch boilerplate. ADR 0017 requires this surface.
    expect(src).toMatch(/export\s+function\s+isBlockchainReady/);
  });

  it('src/services/blockchain.ts does NOT call process.exit anywhere', () => {
    const src = stripComments(read('services/blockchain.ts'));
    // A boot-tolerant init never exits the process on missing config.
    // The whole point of ADR 0017 is that the default platform boots
    // without any chain dependency — process.exit() during the
    // chain-init path violates that contract.
    expect(src).not.toMatch(/process\.exit\s*\(/);
  });

  it('boot path does NOT require BLOCKCHAIN_PRIVATE_KEY in production', () => {
    // The config layer must not throw when BLOCKCHAIN_PRIVATE_KEY is
    // unset. Read the config source and grep for any `throw` near a
    // BLOCKCHAIN_PRIVATE_KEY reference.
    const configDir = path.join(SRC, 'config');
    if (!fs.existsSync(configDir)) return;
    const files = fs.readdirSync(configDir).filter(f => f.endsWith('.ts'));
    for (const f of files) {
      const src = stripComments(fs.readFileSync(path.join(configDir, f), 'utf8'));
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/BLOCKCHAIN_PRIVATE_KEY/.test(lines[i])) {
          // Look in a +/- 5 line window for a throw or process.exit.
          const window = lines.slice(Math.max(0, i - 5), i + 5).join('\n');
          expect(window).not.toMatch(/process\.exit/);
          expect(window).not.toMatch(/throw\s+new\s+Error/);
        }
      }
    }
  });

  it('ADR 0017 is referenced from CLAUDE.md or the plan tree', () => {
    const candidates = [
      path.resolve(__dirname, '../CLAUDE.md'),
      path.resolve(__dirname, '../docs/plan/bfsi-v1/00-README.md'),
      path.resolve(__dirname, '../docs/plan/bfsi-v1/01-pain-points.md'),
      path.resolve(__dirname, '../adr/0017-blockchain-agnostic-posture.md'),
    ];
    let cited = false;
    for (const c of candidates) {
      if (fs.existsSync(c) && /ADR 0017|0017-blockchain-agnostic/.test(fs.readFileSync(c, 'utf8'))) {
        cited = true;
        break;
      }
    }
    expect(cited).toBe(true);
  });
});
