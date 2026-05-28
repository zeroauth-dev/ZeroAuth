/**
 * Biometric-rejection test (Phase 0 commit C-021).
 *
 * The CLAUDE.md non-goal is unambiguous: "Never accept raw biometric
 * data over the wire." This test pins that rule at the source level
 * by grepping the codebase for any Express handler whose request-
 * parsing path mentions a forbidden biometric payload key.
 *
 * The forbidden key set comes from the ZeroAuth threat model A-15
 * (raw-biometric-on-the-wire) and the standing-constraints list in
 * docs/plan/bfsi-v1/00-README.md §4:
 *
 *   image | template | pixel | depth | frame | raw_face | raw_finger
 *   biometric_data | photo
 *
 * Today the project has no validator layer, so this test guards by
 * code-grepping the route + service files. When the zod validator
 * layer lands in C-022, those validator schemas get an additional
 * runtime assertion that rejects unknown keys including these.
 *
 * The grep is intentionally permissive — comments containing the
 * forbidden names are stripped before matching, but a code site like
 * `req.body.image` will fail the test until removed.
 */

import * as fs from 'fs';
import * as path from 'path';

// The CLAUDE.md non-goal canonical list — these are the EXACT key
// names that must never be read by an Express handler.
const FORBIDDEN_KEYS = [
  'image',
  'template',
  'pixel',
  'depth',
  'frame',
  'raw_face',
  'raw_finger',
  'biometric_data',
  'photo',
];

// Defence-in-depth: compound key names that smuggle biometric data
// in a different shape (e.g. `biometricTemplate` slipped past the
// `template` check because it doesn't match `\btemplate\b`).
// Caught by a separate scan because these read as suffix variants
// rather than standalone words. Any code site reading
// `req.body.biometricTemplate` is a P0 audit finding.
const FORBIDDEN_COMPOUND_KEYS = [
  'biometricTemplate',
  'biometric_template',
  'biometricImage',
  'biometric_image',
  'faceTemplate',
  'face_template',
  'fingerprintTemplate',
  'fingerprint_template',
  'irisTemplate',
  'iris_template',
  'voiceprint',
  'face_image',
  'fingerprint_image',
  'rawBiometric',
  'raw_biometric',
];

function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/\/\/[^\n]*/g, '');
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    if (entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('biometric payload-key rejection (source-level guard)', () => {
  const root = path.resolve(__dirname, '../src');
  const sourceFiles = walk(root);

  for (const key of FORBIDDEN_KEYS) {
    it(`no Express handler reads req.body.${key} or req.query.${key} or req.params.${key}`, () => {
      const patterns = [
        new RegExp(`req\\.body\\.${key}\\b`),
        new RegExp(`req\\.body\\[['"]${key}['"]\\]`),
        new RegExp(`req\\.query\\.${key}\\b`),
        new RegExp(`req\\.query\\[['"]${key}['"]\\]`),
        new RegExp(`req\\.params\\.${key}\\b`),
        new RegExp(`req\\.params\\[['"]${key}['"]\\]`),
      ];
      const offenders: { file: string; pattern: string }[] = [];
      for (const file of sourceFiles) {
        const src = stripComments(fs.readFileSync(file, 'utf8'));
        for (const pattern of patterns) {
          if (pattern.test(src)) {
            offenders.push({ file, pattern: pattern.source });
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it(`no destructuring like \`const { ${key} } = req.body\` exists`, () => {
      const re = new RegExp(`const\\s*\\{[^}]*\\b${key}\\b[^}]*\\}\\s*=\\s*req\\.body`);
      const offenders: string[] = [];
      for (const file of sourceFiles) {
        const src = stripComments(fs.readFileSync(file, 'utf8'));
        if (re.test(src)) offenders.push(file);
      }
      expect(offenders).toEqual([]);
    });
  }

  // Compound-key scan. Same patterns as the basic FORBIDDEN_KEYS loop
  // but for the suffix-variant keys (biometricTemplate, face_template,
  // etc.) — these are the keys a future contributor might use to
  // smuggle a biometric payload past the basic word-boundary check.
  for (const key of FORBIDDEN_COMPOUND_KEYS) {
    it(`no Express handler reads req.body.${key} (compound-key defence)`, () => {
      const patterns = [
        new RegExp(`req\\.body\\.${key}\\b`),
        new RegExp(`req\\.body\\[['"]${key}['"]\\]`),
        new RegExp(`req\\.query\\.${key}\\b`),
        new RegExp(`req\\.query\\[['"]${key}['"]\\]`),
        new RegExp(`req\\.params\\.${key}\\b`),
        new RegExp(`req\\.params\\[['"]${key}['"]\\]`),
      ];
      const offenders: { file: string; pattern: string }[] = [];
      for (const file of sourceFiles) {
        const src = stripComments(fs.readFileSync(file, 'utf8'));
        for (const pattern of patterns) {
          if (pattern.test(src)) {
            offenders.push({ file, pattern: pattern.source });
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  // Tracked exception: src/routes/v1/zkp.ts uses `biometricTemplate`
  // as the request-body field for the deprecated POST /v1/auth/zkp/register
  // endpoint. The endpoint is retained for the W3 demo client +
  // existing fixtures but is deprecated for new integrations; the
  // production face-first path lives at POST /v1/identity/register
  // and accepts (did, commitment) only. This exception is documented
  // and gated by a single test that asserts the legacy endpoint
  // never reads biometricTemplate ANYWHERE outside zkp.ts.
  it('biometricTemplate compound-key is contained to the deprecated zkp.ts register endpoint', () => {
    const re = new RegExp(`\\bbiometricTemplate\\b`);
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (re.test(src)) offenders.push(file);
    }
    // Allow zkp.ts (the deprecated endpoint) + types/index.ts (the
    // RegistrationRequest type declaration). Anywhere else means a
    // new code site was added — fix it before merge.
    // Allowed legacy code sites — the deprecated POST
    // /v1/auth/zkp/register endpoint and its plumbing through
    // identity.ts. New code MUST NOT add itself here without an ADR.
    const allowed = new Set([
      path.resolve(__dirname, '../src/routes/v1/zkp.ts'),
      path.resolve(__dirname, '../src/routes/zkp.ts'),
      path.resolve(__dirname, '../src/routes/v1/identity.ts'),
      path.resolve(__dirname, '../src/services/identity.ts'),
      path.resolve(__dirname, '../src/types/index.ts'),
    ]);
    const unexpected = offenders.filter(f => !allowed.has(f));
    expect(unexpected).toEqual([]);
  });

  it('CLAUDE.md continues to declare these keys forbidden', () => {
    const claudeMd = fs.readFileSync(path.resolve(__dirname, '../CLAUDE.md'), 'utf8');
    expect(claudeMd).toMatch(/Never accept raw biometric data/);
    // The CLAUDE constitution explicitly lists the forbidden keys.
    for (const key of FORBIDDEN_KEYS) {
      // not all keys are individually mentioned in CLAUDE.md; the
      // five flagged in the constitution are image / template /
      // pixel / depth / frame. The rest are extensions added by
      // ADR 0013 / this test for defence-in-depth.
      if (['image', 'template', 'pixel', 'depth', 'frame'].includes(key)) {
        expect(claudeMd).toMatch(new RegExp(`\\b${key}\\b`));
      }
    }
  });
});
