'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function boot({ cached = null, dark = false, unavailable = false } = {}) {
  const properties = {};
  let resolveStorage;
  let cache = cached;
  const context = vm.createContext({
    document: { documentElement: { style: {
      setProperty: (name, value) => { properties[name] = value; },
    } } },
    matchMedia: () => ({ matches: dark }),
    localStorage: {
      getItem() { if (unavailable) throw new Error('blocked'); return cache; },
      setItem(key, value) { if (unavailable) throw new Error('blocked'); cache = value; },
    },
    chrome: { storage: { local: {
      get: () => new Promise(resolve => { resolveStorage = resolve; }),
    } } },
  });
  for (const file of ['theme-math.js', 'theme-palettes.js', 'theme-startup.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
  }
  return { context, properties, resolveStorage, cache: () => cache };
}

// Locate a <script src="..."> tag by its src suffix so a preceding HTML
// comment that merely mentions the filename never shadows the real tag order.
function scriptSrcIndex(html, src) {
  const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<script[^>]*src=["'][^"']*${escaped}["']`));
  return match ? match.index : -1;
}

// @lat: [[startup#Theme before dashboard initialization]]
test('startup theme precedes redirect and screen styles in both extension pages', () => {
  for (const file of ['index.html', 'popup/popup.html']) {
    const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(scriptSrcIndex(html, 'theme-math.js') < scriptSrcIndex(html, 'theme-startup.js'));
    assert.ok(scriptSrcIndex(html, 'theme-palettes.js') < scriptSrcIndex(html, 'theme-startup.js'));
    assert.ok(scriptSrcIndex(html, 'theme-startup.js') < html.indexOf('rel="stylesheet"'));
    assert.ok(scriptSrcIndex(html, 'theme-startup.js') < scriptSrcIndex(html, 'theme-controls.js'));
    if (file === 'index.html') {
      assert.ok(scriptSrcIndex(html, 'theme-startup.js') < scriptSrcIndex(html, 'focus-redirect.js'));
    }
  }
});

test('cached explicit themes paint before asynchronous settings resolve', () => {
  for (const mode of ['light', 'dark']) {
    const state = boot({ cached: JSON.stringify({ mode, paletteId: 'sage' }), dark: mode === 'light' });
    assert.equal(state.context.document.documentElement.style.colorScheme, mode);
    assert.equal(state.properties['--paper'], state.context.TabHarborThemePalettes.families.sage[mode]['--paper']);
    assert.equal(state.context.document.documentElement.style.backgroundColor, 'var(--paper)');
  }
});

test('system mode resolves the current OS tone instead of the previously resolved tone', () => {
  const cached = JSON.stringify({ mode: 'system', paletteId: 'mist' });
  for (const dark of [true, false]) {
    const state = boot({ cached, dark });
    assert.equal(state.context.document.documentElement.style.colorScheme, dark ? 'dark' : 'light');
  }
});

test('missing, damaged and blocked caches fall back to system paper', () => {
  for (const options of [{}, { cached: '{broken' }, { unavailable: true }, { cached: 'null' },
    { cached: '{"mode":"invalid","paletteId":"toString"}' }]) {
    const state = boot({ ...options, dark: true });
    assert.equal(state.properties['--paper'], '#1a1613');
    assert.equal(state.context.document.documentElement.style.colorScheme, 'dark');
  }
});

test('early authoritative read migrates legacy themes and refreshes the cache', async () => {
  const state = boot();
  state.resolveStorage({ themePreferences: { themeId: 'midnight' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.context.document.documentElement.style.colorScheme, 'dark');
  assert.equal(state.properties['--paper'], state.context.TabHarborThemePalettes.families.mist.dark['--paper']);
  assert.deepEqual(JSON.parse(state.cache()), {
    mode: 'dark',
    paletteId: 'mist',
    colorSource: 'preset',
    wallpaperTheme: null,
    wallpaperOverlay: 0,
    wallpaperOverlayTint: 0,
  });
});

test('cached Monet maps and glass paint both tones before storage resolves', () => {
  const paletteState = boot();
  const maps = paletteState.context.TabHarborThemePalettes.families.sage;
  const wallpaperTheme = { version: 1, seedHue: 120, seedChroma: 40,
    light: { ...maps.light, '--paper': '#f0fff0' }, dark: { ...maps.dark, '--paper': '#102010' } };
  for (const dark of [true, false]) {
    const state = boot({ dark, cached: JSON.stringify({ mode: 'system', colorSource: 'wallpaper',
      wallpaperTheme, material: 'frosted', materialIntensity: 80, surfaceOpacity: 20 }) });
    assert.equal(state.properties['--paper'], dark ? '#102010' : '#f0fff0');
    assert.equal(state.properties['--glass-blur'], '27px');
    assert.equal(state.properties['--custom-surface-opacity'], '17%');
  }
});

test('outdated Monet cache falls back to the saved preset at first paint', () => {
  const state = boot({ cached: JSON.stringify({ mode: 'dark', paletteId: 'blush',
    colorSource: 'wallpaper', wallpaperTheme: { version: 999 } }) });
  assert.equal(state.properties['--paper'], state.context.TabHarborThemePalettes.families.blush.dark['--paper']);
});

test('late startup reads cannot override a runtime theme change', async () => {
  const state = boot();
  state.context.TabHarborThemeStartup.sync({ mode: 'dark', paletteId: 'blush' });
  state.resolveStorage({ themePreferences: { mode: 'light', paletteId: 'paper' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.properties['--paper'], state.context.TabHarborThemePalettes.families.blush.dark['--paper']);
  assert.deepEqual(JSON.parse(state.cache()), {
    mode: 'dark',
    paletteId: 'blush',
    colorSource: 'preset',
    wallpaperTheme: null,
    wallpaperOverlay: 0,
    wallpaperOverlayTint: 0,
  });
});


test('clear opacity and independent overlay match shared runtime math before storage resolves', () => {
  const math = require('./theme-math.js');
  for (const mode of ['light','dark']) for (const materialIntensity of [0,50,100]) {
    const prefs = {mode,material:'clear',materialIntensity,surfaceOpacity:14,wallpaperOverlay:39,wallpaperOverlayTint:0};
    const state = boot({cached:JSON.stringify(prefs)});
    const expected = {...math.computeMaterialGlassVars(prefs), ...math.computeEffectiveOpacityVars(14,math.computeMaterialVars(prefs)), ...math.computeWallpaperOverlayVars(prefs)};
    for (const [key,value] of Object.entries(expected)) assert.equal(state.properties[key],value,key);
    assert.equal(JSON.parse(state.cache()).wallpaperOverlay,39);
  }
});

test('frosted cached first paint matches runtime at all endpoints and legacy depths', () => {
  const math = require('./theme-math.js');
  for (const mode of ['light','dark']) for (const materialIntensity of [0,50,100]) for (const surfaceOpacity of [2,14,60]) {
    const prefs = {mode,material:'frosted',materialIntensity,surfaceOpacity,wallpaperOverlay:37,wallpaperOverlayTint:0};
    const state = boot({cached:JSON.stringify(prefs)});
    const vars = math.computeMaterialVars(prefs);
    const expected = {...math.computeMaterialGlassVars(prefs),...math.computeEffectiveOpacityVars(surfaceOpacity,vars),...math.computeWallpaperOverlayVars(prefs)};
    for (const [key,value] of Object.entries(expected)) assert.equal(state.properties[key],value,key);
  }
});

test('legacy image overlay cache retains its migrated tint on the next boot', () => {
  const state=boot({cached:JSON.stringify({backgroundType:'image',customBackground:'image',material:'clear',materialIntensity:50})});
  const next=boot({cached:state.cache()});
  assert.equal(next.properties['--wallpaper-overlay-opacity'],state.properties['--wallpaper-overlay-opacity']);
  assert.equal(next.properties['--wallpaper-overlay-paper-share'],state.properties['--wallpaper-overlay-paper-share']);
});


test('legacy overlay first paint resolves system dark mode consistently', () => {
  const state=boot({dark:true,cached:JSON.stringify({mode:'system',backgroundType:'image',material:'clear',materialIntensity:50})});
  assert.equal(state.properties['--wallpaper-overlay-opacity'],'0.37');
  assert.equal(JSON.parse(state.cache()).wallpaperOverlay,37);
});
