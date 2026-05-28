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
