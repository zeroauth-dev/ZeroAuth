/**
 * Boot-time vkey hash check (Phase 0 commit C-018, ADR 0015).
 *
 * The verifier must refuse to boot if `verification_key.json` does
 * not hash to `EXPECTED_VKEY_SHA256`. Two execution paths are pinned:
 *
 *   (a) production: env var unset → throw on boot
 *   (b) production: env var set but mismatched → throw on boot
 *   (c) production: env var set and matching → boot succeeds
 *   (d) non-production with no env var → warn but continue (dev UX)
 *
 * The actual hash check lives in src/services/zkp.ts::initZKP.
 * Tests here import the function with a controlled environment and
 * a controlled on-disk vkey.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

describe('ADR 0015 boot-time vkey hash check', () => {
  let tempDir: string;
  let vkeyPath: string;
  let originalEnv: NodeJS.ProcessEnv;

  const sampleVkey = {
    protocol: 'groth16',
    curve: 'bn128',
    nPublic: 3,
    note: 'unit-test fixture',
  };

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-vkey-'));
    vkeyPath = path.join(tempDir, 'verification_key.json');
    fs.writeFileSync(vkeyPath, JSON.stringify(sampleVkey, null, 2), 'utf8');
  });

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function vkeyHash(): string {
    const data = fs.readFileSync(vkeyPath, 'utf8');
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  }

  function runInitInIsolatedModuleCtx(envOverrides: Record<string, string | undefined>): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Reset modules so config + zkp re-read env.
        jest.resetModules();
        for (const [k, v] of Object.entries(envOverrides)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
        process.env.ZKP_VERIFIER_MODE = 'inline';
        process.env.ZKP_VKEY_PATH = vkeyPath;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initZKP } = require('../src/services/zkp') as {
          initZKP: () => Promise<void>;
        };
        initZKP().then(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  it('boots when EXPECTED_VKEY_SHA256 matches the on-disk file', async () => {
    const sha = vkeyHash();
    await expect(
      runInitInIsolatedModuleCtx({
        NODE_ENV: 'production',
        EXPECTED_VKEY_SHA256: '0x' + sha,
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses to boot in production when EXPECTED_VKEY_SHA256 mismatches', async () => {
    await expect(
      runInitInIsolatedModuleCtx({
        NODE_ENV: 'production',
        EXPECTED_VKEY_SHA256: '0x' + '0'.repeat(64),
      }),
    ).rejects.toThrow(/SHA-256.*does not match EXPECTED_VKEY_SHA256/);
  });

  it('refuses to boot in production when EXPECTED_VKEY_SHA256 is missing', async () => {
    await expect(
      runInitInIsolatedModuleCtx({
        NODE_ENV: 'production',
        EXPECTED_VKEY_SHA256: undefined,
      }),
    ).rejects.toThrow(/EXPECTED_VKEY_SHA256 is not set/);
  });

  it('warns and continues in non-production when EXPECTED_VKEY_SHA256 is missing', async () => {
    // Should NOT throw.
    await expect(
      runInitInIsolatedModuleCtx({
        NODE_ENV: 'development',
        EXPECTED_VKEY_SHA256: undefined,
      }),
    ).resolves.toBeUndefined();
  });
});
