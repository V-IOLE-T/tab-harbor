'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const math = require('./theme-math.js');

function cache() {
  const tokens = Object.fromEntries(math.WALLPAPER_TOKEN_NAMES.map(name => [name, '#a1b2c3']));
  return { version: 1, seedHue: 30, seedChroma: 40, light: { ...tokens }, dark: { ...tokens } };
}

test('material ranges remain finite and default material preserves legacy glass', () => {
  const legacy = math.computeMaterialVars();
  assert.equal(legacy['--glass-blur'], '10px');
  assert.equal(legacy['--glass-floating-min'], '82%');
  assert.equal(legacy['--glass-surface-scale'], '1');
  for (const material of math.MATERIAL_ORDER) {
    for (const materialIntensity of [-1, 0, 50, 100, 101, NaN, Infinity]) {
      const vars = math.computeMaterialVars({ material, materialIntensity });
      assert.ok(vars.materialIntensity >= 0 && vars.materialIntensity <= 100);
      for (const [name, value] of Object.entries(vars)) {
        if (name.startsWith('--')) assert.ok(Number.isFinite(parseFloat(value)), name);
      }
    }
  }
  assert.equal(math.computeMaterialVars({ material: 'unknown' }).material, 'default');
});

test('frosted intensity increases blur and clear intensity keeps a readable opacity floor', () => {
  const frosted = n => math.computeMaterialVars({ material: 'frosted', materialIntensity: n });
  assert.ok(parseFloat(frosted(100)['--glass-blur']) > parseFloat(frosted(0)['--glass-blur']));
  const clear = math.computeMaterialVars({ material: 'clear', materialIntensity: 100 });
  assert.equal(clear['--glass-blur'], '0px');
  assert.equal(math.computeEffectiveOpacityVars(2, clear)['--custom-surface-opacity'], '26%');
  assert.equal(math.computeEffectiveOpacityVars(14)['--custom-surface-opacity'], '14%');
  assert.equal(math.computeEffectiveOpacityVars(999)['--custom-surface-opacity'], '60%');
});

test('wallpaper cache rejects missing tokens, invalid colors and unsupported versions', () => {
  for (const mutate of [c => { c.version = 2; }, c => { delete c.dark['--ink']; },
    c => { c.light['--paper'] = 'url(https://invalid)'; }, c => { c.seedHue = NaN; }]) {
    const value = cache(); mutate(value);
    assert.equal(math.normalizeWallpaperThemeCache(value), null);
  }
  assert.equal(math.normalizeWallpaperThemeCache(null), null);
  assert.equal(math.normalizeWallpaperThemeCache([]), null);
});

test('cache normalization copies known tokens only and cannot override material tokens', () => {
  const value = cache();
  value.light['--glass-blur'] = '999px';
  const normalized = math.normalizeWallpaperThemeCache(value);
  assert.ok(normalized);
  assert.equal(normalized.light['--glass-blur'], undefined);
  normalized.dark['--ink'] = '#000000';
  assert.equal(value.dark['--ink'], '#a1b2c3');
  assert.equal(Object.keys(normalized.light).length, 16);
});
