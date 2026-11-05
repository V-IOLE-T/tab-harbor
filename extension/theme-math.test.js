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
        if (name.startsWith('--') && name !== '--glass-content-filter' && value !== 'initial') assert.ok(Number.isFinite(parseFloat(value)), name);
      }
    }
  }
  assert.equal(math.computeMaterialVars({ material: 'unknown' }).material, 'default');
});

test('frosted intensity increases blur and clear intensity allows transparent content', () => {
  const frosted = n => math.computeMaterialVars({ material: 'frosted', materialIntensity: n });
  assert.ok(parseFloat(frosted(100)['--glass-blur']) > parseFloat(frosted(0)['--glass-blur']));
  const clear = math.computeMaterialVars({ material: 'clear', materialIntensity: 100 });
  assert.equal(clear['--glass-blur'], '0px');
  assert.equal(math.computeEffectiveOpacityVars(2, clear)['--custom-surface-opacity'], '0.2%');
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


test('clear content opacity strictly decreases across the entire strength range', () => {
  for (const base of [2, 14, 60]) {
    let previous = Infinity;
    for (let materialIntensity = 0; materialIntensity <= 100; materialIntensity++) {
      const vars = math.computeMaterialVars({ material: 'clear', materialIntensity });
      const opacity = parseFloat(math.computeEffectiveOpacityVars(base, vars)['--custom-surface-opacity']);
      assert.ok(opacity < previous, `${base} at ${materialIntensity}`);
      assert.equal(vars['--glass-blur'], '0px');
      previous = opacity;
    }
  }
});

test('clear control fills and floors decrease together and reset when changing material', () => {
  let previous = Infinity;
  for (let materialIntensity = 0; materialIntensity <= 100; materialIntensity++) {
    const vars = math.computeMaterialVars({ material: 'clear', materialIntensity });
    const scale = Number(vars['--glass-control-scale']);
    assert.ok(scale < previous);
    assert.equal(scale, Number(vars['--glass-surface-scale']));
    assert.ok(Math.abs(parseFloat(vars['--glass-panel-min']) - 74 * scale) < .001);
    assert.ok(Math.abs(parseFloat(vars['--glass-floating-min']) - 82 * scale) < .001);
    assert.equal(vars['--glass-blur'], '0px');
    assert.equal(vars['--glass-saturate'], '100%');
    previous = scale;
  }
  assert.equal(math.computeMaterialVars({material:'clear',materialIntensity:19})['--glass-control-scale'], '0.829');
  assert.equal(math.computeMaterialVars({material:'clear',materialIntensity:100})['--glass-control-scale'], '0.100');
  for (const material of ['default', 'frosted']) {
    assert.equal(math.computeMaterialVars({material})['--glass-control-scale'], '1');
  }
});

test('explicit wallpaper overlay clamps and stays independent of material and media', () => {
  for (const backgroundType of ['image', 'video', 'none']) {
    for (const material of math.MATERIAL_ORDER) for (const materialIntensity of [0, 50, 100]) {
      for (const [input, expected] of [[-1,0], [0,0], [50,50], [100,100], [101,100], ['31.7',32]]) {
        const prefs = {backgroundType, material, materialIntensity, wallpaperOverlay: input};
        assert.equal(math.normalizeWallpaperOverlay(prefs), expected);
        assert.equal(math.computeWallpaperOverlayVars(prefs)['--wallpaper-overlay-opacity'], String(expected / 100));
        assert.equal(math.computeMaterialVars(prefs)['--glass-scrim-opacity'], '0');
      }
    }
  }
});

test('legacy image wash and scrim migrate into one nearly identical composite', () => {
  for (const mode of ['light', 'dark']) for (const material of math.MATERIAL_ORDER) {
    for (const materialIntensity of [0,50,100]) {
      const legacy = {mode, material, materialIntensity, customBackground: 'data:image/png;base64,AA=='};
      const scrim = (material === 'clear' ? .1 + materialIntensity * .004
        : material === 'frosted' ? .05 + materialIntensity * .001 : 0) * (mode === 'dark' ? .5 : 1);
      const alpha = math.normalizeWallpaperOverlay(legacy) / 100;
      const share = math.normalizeWallpaperOverlayTint(legacy) / 100;
      for (const paper of [.1,.9]) for (const wallpaper of [0,.5,1]) {
        const before = (.26 * paper + .74 * wallpaper) * (1 - scrim);
        const after = paper * share * alpha + wallpaper * (1 - alpha);
        assert.ok(Math.abs(before - after) < .006, `${mode}/${material}/${materialIntensity}`);
      }
      const migrated = {...legacy, wallpaperOverlay: alpha * 100, wallpaperOverlayTint: share * 100};
      assert.ok(Math.abs(math.normalizeWallpaperOverlay({...migrated, materialIntensity: 100}) - migrated.wallpaperOverlay) < 1e-9);
      assert.equal(math.normalizeWallpaperOverlayTint({...migrated, materialIntensity: 100}), migrated.wallpaperOverlayTint);
    }
  }
  assert.equal(math.normalizeWallpaperOverlay({backgroundType:'video', material:'clear', materialIntensity:50}), 30);
  assert.equal(math.normalizeWallpaperOverlay({wallpaperOverlay:NaN, customBackground:'image'}), 26);
});
