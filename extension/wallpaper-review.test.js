'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const root = __dirname;
const { context } = require(path.join(root, 'wallpaper-test-helpers.cjs'));

function controls(language) {
  const nodes = new Map();
  const writes = [];
  const document = {
    addEventListener() {}, getElementById() { return null; },
    documentElement: { style: { setProperty() {} } },
    body: { classList: { toggle() {}, remove() {}, add() {} }, style: { removeProperty() {} } },
  };
  const env = context({ document, window: { matchMedia: () => ({ matches: false }) },
    chrome: { storage: { local: { set: async value => { writes.push(value.themePreferences); } } } },
  });
  if (language) {
    document.readyState = 'loading';
    env.scope.navigator = { language };
    env.load('i18n.js');
  }
  // Load actual classic scripts and call the same save/render functions as UI events.
  for (const file of ['theme-palettes.js', 'theme-math.js', 'vendor/material-color-utilities.js', 'monet-theme.js', 'theme-controls.js']) env.load(file);
  env.scope.testPanel = {
    querySelectorAll: () => [], querySelector: selector => nodes.get(selector) || null,
  };
  return { ...env, nodes, writes,
    save: patch => { env.scope.testPatch = patch; return vm.runInContext('saveThemePreferences(testPatch)', env.scope); },
    sync: () => vm.runInContext('syncThemeMenuWallpaperControls(testPanel)', env.scope),
    prefs: () => env.scope.TabOutThemeControls.getThemePreferences(),
    set: patch => { env.scope.testPatch = patch; vm.runInContext('themePreferences = normalizeThemePreferences(testPatch)', env.scope); },
  };
}

for (const [language, labels] of [
  ['en', { frosted: 'Frosted strength', clear: 'Transparency strength', default: 'Glass strength' }],
  ['zh-CN', { frosted: '磨砂强度', clear: '透明强度', default: '玻璃强度' }],
  [null, { frosted: 'Frosted strength', clear: 'Transparency strength', default: 'Glass strength' }],
]) {
  test(`material labels follow initial render and saved switches (${language || 'fallback'})`, async () => {
    const env = controls(language);
    const source = require('node:fs').readFileSync(path.join(root, 'dashboard-runtime.js'), 'utf8');
    const start = source.indexOf('function renderWorkspaceThemeTools()');
    const end = source.indexOf('\nasync function handleExportConfig', start);
    Object.assign(env.scope, {
      chromeTabGroupsEnabled: true,
      sleepControlEnabled: true,
      runtimeT: env.scope.TabHarborI18n?.t,
      runtimeGetLanguagePreference: () => language || 'auto',
      runtimeEscapeHtmlAttribute: value => value,
    });
    vm.runInContext(source.slice(start, end), env.scope);
    const label = { textContent: '' };
    const section = { style: {} };
    const range = { value: '67' };
    env.nodes.set('#themeMaterialIntensityLabel', label);
    env.nodes.set('#materialIntensitySection', section);
    env.nodes.set('#themeMaterialIntensityRange', range);
    env.set({ material: 'frosted', materialIntensity: 67 });
    for (const material of ['frosted', 'clear', 'default', 'clear', 'frosted']) {
      await env.save({ material });
      env.sync();
      const html = vm.runInContext('renderWorkspaceThemeTools()', env.scope);
      assert.ok(html.includes(`id="themeMaterialIntensityLabel">${labels[material]}</div>`));
      assert.match(html, /id="themeMaterialIntensityRange"\s+type="range"\s+aria-labelledby="themeMaterialIntensityLabel"/);
      assert.equal(label.textContent, labels[material]);
      assert.equal(section.style.display, material === 'default' ? 'none' : '');
      assert.equal(html.includes('id="materialIntensitySection" style="display:none"'), material === 'default');
      assert.equal(range.value, '67');
      assert.equal(env.prefs().materialIntensity, 67);
    }
  });
}

test('Clear controls follow uploaded, cleared and externally replaced wallpaper preferences', async () => {
  const env = controls();
  const image = { disabled: true }; const video = { disabled: true };
  env.nodes.set('[data-action="clear-custom-background"]', image);
  env.nodes.set('[data-action="clear-video-wallpaper"]', video);
  env.sync(); assert.equal(image.disabled, true); assert.equal(video.disabled, true);
  await env.save({ customBackground: 'image', videoPoster: 'poster', videoMeta: { resourceId: 'video' } });
  env.sync(); assert.equal(image.disabled, false); assert.equal(video.disabled, false);
  await env.save({ customBackground: '', videoPoster: '', videoMeta: null });
  env.sync(); assert.equal(image.disabled, true); assert.equal(video.disabled, true);
  env.set({ videoMeta: { name: 'restored video' } });
  env.sync(); assert.equal(video.disabled, false, 'portable metadata still needs a Clear control');
});

test('stored background switches refresh colors and serialize extraction with later saves', async () => {
  const env = controls();
  const monet = env.scope.TabHarborMonetTheme;
  const cache = (source, hue) => monet.buildWallpaperTheme({ source, seedHue: hue, seedChroma: 48 });
  env.set({ backgroundType: 'video', customBackground: 'image-A', videoPoster: 'poster-B',
    colorSource: 'wallpaper', wallpaperTheme: cache('video', 240), wallpaperSeedHue: 240 });
  let release; const sampled = [];
  env.scope.TabHarborWallpaperRuntime = { extractThemeFromImageDataUrl: async (url, source) => {
    sampled.push([url, source]);
    if (source === 'image') await new Promise(resolve => { release = resolve; });
    return cache(source, source === 'image' ? 30 : 240);
  } };
  const image = env.save({ backgroundType: 'image' });
  const video = env.save({ backgroundType: 'video' });
  const material = env.save({ materialIntensity: 85 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sampled, [['image-A', 'image']]);
  release(); await Promise.all([image, video, material]);
  assert.deepEqual(sampled, [['image-A', 'image'], ['poster-B', 'video']]);
  assert.equal(env.writes[0].wallpaperSeedHue, 30);
  assert.equal(env.prefs().wallpaperTheme.source, 'video');
  assert.equal(env.prefs().wallpaperSeedHue, 240);
  assert.equal(env.prefs().materialIntensity, 85);
});

test('a hue change queued during extraction regenerates the selected background cache', async () => {
  const env = controls();
  const monet = env.scope.TabHarborMonetTheme;
  env.set({ backgroundType: 'video', customBackground: 'image-A', videoPoster: 'poster-B',
    colorSource: 'wallpaper', wallpaperTheme: monet.buildWallpaperTheme({ source: 'video', seedHue: 240, seedChroma: 48 }) });
  let release;
  env.scope.TabHarborWallpaperRuntime = {
    extractThemeFromImageDataUrl: async () => {
      await new Promise(resolve => { release = resolve; });
      return monet.buildWallpaperTheme({ source: 'image', seedHue: 30, seedChroma: 48 });
    },
    regenerateWallpaperTheme: monet.regenerateWithSeed,
  };
  const switching = env.save({ backgroundType: 'image' });
  await new Promise(resolve => setImmediate(resolve));
  const hue = env.save({ wallpaperSeedHue: 180 });
  release();
  await Promise.all([switching, hue]);
  assert.equal(env.prefs().wallpaperTheme.source, 'image');
  assert.equal(env.prefs().wallpaperSeedHue, 180);
  assert.equal(env.prefs().wallpaperTheme.seedHue, 180);
  assert.notEqual(env.writes[0].wallpaperTheme.light['--workspace-accent'],
    env.prefs().wallpaperTheme.light['--workspace-accent']);
});

test('failed extraction clears stale colors and failed persistence preserves the active background', async () => {
  const env = controls();
  const old = env.scope.TabHarborMonetTheme.buildWallpaperTheme({ source: 'video', seedHue: 200, seedChroma: 40 });
  env.set({ backgroundType: 'video', customBackground: 'image-A', wallpaperTheme: old, wallpaperSeedHue: 200 });
  env.scope.TabHarborWallpaperRuntime = { extractThemeFromImageDataUrl: async () => null };
  env.scope.chrome.storage.local.set = async () => { throw new Error('quota'); };
  await assert.rejects(env.save({ backgroundType: 'image' }), /quota/);
  assert.equal(env.prefs().backgroundType, 'video'); assert.equal(env.prefs().wallpaperSeedHue, 200);
  env.scope.chrome.storage.local.set = async () => {};
  await env.save({ backgroundType: 'image' });
  assert.equal(env.prefs().wallpaperTheme, null); assert.equal(env.prefs().wallpaperSeedHue, null);
});

test('Monet action labels meet 4.5:1 across hues, chromas and both tones including saved caches', () => {
  const env = controls();
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
      .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (let hue = 0; hue < 360; hue += 15) for (const chroma of [0, 24, 48, 100, 150]) {
    const cache = env.scope.TabHarborMonetTheme.buildWallpaperTheme({ seedHue: hue, seedChroma: chroma });
    const legacy = { ...cache, dark: { ...cache.dark, '--workspace-accent-contrast': '#f0f0f0' } };
    for (const theme of [cache, env.scope.TabHarborThemeMath.normalizeWallpaperThemeCache(legacy)]) {
      for (const tone of ['light', 'dark']) {
        const a = luminance(theme[tone]['--workspace-accent']);
        const b = luminance(theme[tone]['--workspace-accent-contrast']);
        assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05) >= 4.5, `${hue}/${chroma}/${tone}`);
      }
    }
  }
});
