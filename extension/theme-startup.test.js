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
  for (const file of ['theme-palettes.js', 'theme-startup.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
  }
  return { context, properties, resolveStorage, cache: () => cache };
}

// @lat: [[startup#Theme before dashboard initialization]]
test('startup theme precedes redirect and screen styles in both extension pages', () => {
  for (const file of ['index.html', 'popup/popup.html']) {
    const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(html.indexOf('theme-palettes.js') < html.indexOf('theme-startup.js'));
    assert.ok(html.indexOf('theme-startup.js') < html.indexOf('rel="stylesheet"'));
    assert.ok(html.indexOf('theme-startup.js') < html.indexOf('theme-controls.js'));
    if (file === 'index.html') {
      assert.ok(html.indexOf('theme-startup.js') < html.indexOf('focus-redirect.js'));
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
  assert.deepEqual(JSON.parse(state.cache()), { mode: 'dark', paletteId: 'mist' });
});

test('late startup reads cannot override a runtime theme change', async () => {
  const state = boot();
  state.context.TabHarborThemeStartup.sync({ mode: 'dark', paletteId: 'blush' });
  state.resolveStorage({ themePreferences: { mode: 'light', paletteId: 'paper' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.properties['--paper'], state.context.TabHarborThemePalettes.families.blush.dark['--paper']);
  assert.deepEqual(JSON.parse(state.cache()), { mode: 'dark', paletteId: 'blush' });
});
