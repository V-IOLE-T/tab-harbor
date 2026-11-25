'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./wallpaper-test-helpers.cjs');
const env = context();
env.load('theme-math.js');
env.load('vendor/material-color-utilities.js');
env.load('monet-theme.js');
const monet = env.scope.TabHarborMonetTheme;
const mcu = env.scope.TabHarborMCU;

test('Monet uses the local MCU quantizer and scores a saturated wallpaper seed', () => {
  const red = mcu.argbFromHex('#ff0000');
  const seed = monet.extractSeedFromPixels(Array(400).fill(red));
  assert.ok(seed);
  assert.ok(Math.abs(seed.hue - mcu.Hct.fromInt(red).hue) < 1);
  assert.ok(seed.chroma > 80);
  assert.equal(monet.extractSeedFromPixels([]), null);
});

test('RGBA sampling ignores transparent pixels and preserves opaque channels', () => {
  const pixels = monet.argbPixelsFromRgbaBytes(new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 199]));
  assert.equal(pixels.length, 1);
  assert.equal(mcu.hexFromArgb(pixels[0]), '#ff0000');
});

test('Monet caches complete deterministic light and dark HCT maps', () => {
  const theme = monet.buildWallpaperTheme({ seedHue: 140, seedChroma: 48, source: 'video', sourceHash: 'poster' });
  assert.ok(env.scope.TabHarborThemeMath.normalizeWallpaperThemeCache(theme));
  const repeated = monet.buildTokenMaps(140, 48);
  assert.deepEqual(theme.light, repeated.light);
  assert.deepEqual(theme.dark, repeated.dark);
  assert.equal(theme.source, 'video');
  assert.equal(theme.sourceHash, 'poster');
  assert.ok(mcu.Hct.fromInt(mcu.argbFromHex(theme.light['--paper'])).tone > 95);
  assert.ok(mcu.Hct.fromInt(mcu.argbFromHex(theme.dark['--paper'])).tone < 15);
  // Text contrast must survive both tone maps, beyond merely producing hex.
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
      .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const tone of ['light', 'dark']) {
    const a = luminance(theme[tone]['--ink']); const b = luminance(theme[tone]['--paper']);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 7);
  }
});

test('seed adjustment wraps hue and preserves zero chroma and source identity', () => {
  const original = monet.buildWallpaperTheme({ seedHue: 30, seedChroma: 0, sourceHash: 'image' });
  const adjusted = monet.regenerateWithSeed(original, -30);
  assert.equal(adjusted.seedHue, 330);
  assert.equal(adjusted.seedChroma, 0);
  assert.equal(adjusted.sourceHash, 'image');
  assert.notDeepEqual(adjusted.light, original.light);
});

test('wallpaper pixels generate a validated reusable cache without any network API', () => {
  const cache = monet.buildWallpaperThemeFromPixels(Array(64).fill(mcu.argbFromHex('#2288cc')), { source: 'image' });
  assert.ok(env.scope.TabHarborThemeMath.normalizeWallpaperThemeCache(cache));
  assert.equal(env.scope.fetch, undefined);
  assert.equal(monet.buildWallpaperThemeFromPixels([]), null);
  assert.equal(monet.hashSourceId('poster'), monet.hashSourceId('poster'));
  assert.notEqual(monet.hashSourceId('poster'), monet.hashSourceId('image'));
});
