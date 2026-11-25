#!/usr/bin/env node
/**
 * Vendors @material/material-color-utilities into extension/vendor/ as a
 * single classic script (no ESM — the extension loads ordered <script> tags).
 *
 * Reproducible build:
 *   node tools/vendor-material-color-utilities.mjs
 *
 * Pins:
 *   - upstream package version + sha512 integrity (fetched from the npm
 *     registry and verified against MCU_INTEGRITY below)
 *   - esbuild version used to bundle
 *
 * Outputs:
 *   extension/vendor/material-color-utilities.js          (IIFE, global TabHarborMCU)
 *   extension/vendor/material-color-utilities.LICENSE     (Apache-2.0, verbatim)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MCU_VERSION = '0.4.0';
const MCU_INTEGRITY_ALGO = 'sha512';
// npm registry integrity for @material/material-color-utilities@0.4.0
const MCU_INTEGRITY = 'sha512-dlq6VExJReb8dhjj3a/yTigr3ncNwoFmL5Iy2ENtbDX03EmNeOEdZ+vsaGrj7RTuO+mB7L58II4LCsl4NpM8uw==';
const ESBUILD_VERSION = '0.25.0';
const TARBALL_URL = `https://registry.npmjs.org/@material/material-color-utilities/-/material-color-utilities-${MCU_VERSION}.tgz`;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'extension', 'vendor');

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function integrityOf(buf) {
  return `${MCU_INTEGRITY_ALGO}-` + createHash(MCU_INTEGRITY_ALGO).update(buf).digest('base64');
}

const tmp = mkdtempSync(path.join(tmpdir(), 'mcu-vendor-'));
try {
  const tarball = await download(TARBALL_URL);
  const actual = integrityOf(tarball);
  if (actual !== MCU_INTEGRITY) {
    throw new Error(`integrity mismatch: expected ${MCU_INTEGRITY}, got ${actual}`);
  }
  const tgz = path.join(tmp, 'mcu.tgz');
  writeFileSync(tgz, tarball);
  execFileSync('tar', ['xzf', tgz, '-C', tmp], { stdio: 'inherit' });
  const pkgDir = path.join(tmp, 'package');

  // Entry module: re-export only the pieces the extension uses so esbuild
  // tree-shakes the dynamic-color/scheme machinery out of the bundle.
  const entry = path.join(tmp, 'entry.js');
  writeFileSync(entry, [
    `export { Hct } from '${pkgDir}/hct/hct.js';`,
    `export { QuantizerCelebi } from '${pkgDir}/quantize/quantizer_celebi.js';`,
    `export { Score } from '${pkgDir}/score/score.js';`,
    `export { hexFromArgb, argbFromHex } from '${pkgDir}/utils/string_utils.js';`,
    `export { redFromArgb, greenFromArgb, blueFromArgb, alphaFromArgb } from '${pkgDir}/utils/color_utils.js';`,
    `export { TonalPalette } from '${pkgDir}/palettes/tonal_palette.js';`,
    '',
  ].join('\n'));

  const outfile = path.join(tmp, 'bundle.js');
  execFileSync('npx', [
    '--yes', `esbuild@${ESBUILD_VERSION}`,
    entry,
    '--bundle',
    '--format=iife',
    '--global-name=TabHarborMCU',
    '--minify',
    '--legal-comments=eof',
    `--outfile=${outfile}`,
  ], { stdio: 'inherit' });

  const sha256 = createHash('sha256').update(tarball).digest('hex');
  const header = [
    '/*!',
    ' * @material/material-color-utilities ' + MCU_VERSION,
    ' * Source: ' + TARBALL_URL,
    ' * Tarball sha256: ' + sha256,
    ' * Bundled with esbuild ' + ESBUILD_VERSION + ' (IIFE, global: TabHarborMCU)',
    ' * License: Apache-2.0 (see material-color-utilities.LICENSE)',
    ' * Regenerate: node tools/vendor-material-color-utilities.mjs',
    ' */',
    '',
  ].join('\n');

  const bundle = header + readFileSync(outfile, 'utf8');
  const license = readFileSync(path.join(pkgDir, 'LICENSE'));
  if (process.argv.includes('--check')) {
    for (const [name, expected] of [
      ['material-color-utilities.js', Buffer.from(bundle)],
      ['material-color-utilities.LICENSE', license],
    ]) {
      if (!readFileSync(path.join(outDir, name)).equals(expected)) {
        throw new Error(`Vendored ${name} differs from the reproducible build`);
      }
    }
    console.log('MCU bundle and Apache-2.0 license reproduce byte-for-byte');
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'material-color-utilities.js'), bundle);
    cpSync(path.join(pkgDir, 'LICENSE'), path.join(outDir, 'material-color-utilities.LICENSE'));
    console.log('vendored @material/material-color-utilities@' + MCU_VERSION + ' -> extension/vendor/');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
