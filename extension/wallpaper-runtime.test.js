'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { context, element } = require('./wallpaper-test-helpers.cjs');

function runtimeEnv(overrides = {}) {
  const body = element('body'); const calls = []; const notices = [];
  const listeners = {}; const motion = { matches: false, addEventListener: (k, fn) => { listeners.motion = fn; } };
  const fakePlayer = {
    setSource: (...args) => calls.push(['source', ...args]),
    setHidden: value => calls.push(['hidden', value]),
    setReducedMotion: value => calls.push(['motion', value]),
    setPlayback: value => calls.push(['playback', value]),
  };
  const env = context({
    document: { body, hidden: false, getElementById: () => null, createElement: element,
      addEventListener: (key, fn) => { listeners[key] = fn; } },
    matchMedia: () => motion,
    showToast: msg => notices.push(msg),
    TabHarborVideoWallpaper: { createVideoWallpaperPlayer: () => fakePlayer },
    TabHarborVideoWallpaperStore: { getVideoRecord: async () => null },
    ...overrides,
  });
  env.load('wallpaper-runtime.js');
  return { ...env, api: env.scope.TabHarborWallpaperRuntime, body, calls, notices, motion, listeners };
}
const preferences = { backgroundType: 'video', videoPoster: 'poster', videoMeta: { resourceId: 'a', savedAt: 'today', size: 5 } };
const record = { blob: new Blob(['video']), meta: { resourceId: 'a', savedAt: 'today' } };

test('portable video configuration never reads local current and announces poster fallback once', async () => {
  let reads = 0;
  const env = runtimeEnv({ TabHarborVideoWallpaperStore: { getVideoRecord: async () => { reads++; return record; } } });
  assert.equal(await env.api.sync({ ...preferences, videoMeta: {} }), 'missing');
  assert.equal(await env.api.sync({ ...preferences, videoMeta: null }), 'missing');
  assert.equal(reads, 0); assert.equal(env.notices.length, 1);
  assert.equal(env.body.children[0].style.backgroundImage, 'url("poster")');
});

test('resource identity, saved timestamp and size mismatches refuse playback', async () => {
  for (const meta of [{ resourceId: 'b', savedAt: 'today', size: 5 },
    { resourceId: 'a', savedAt: 'yesterday', size: 5 }, { resourceId: 'a', savedAt: 'today', size: 6 }]) {
    const env = runtimeEnv({ TabHarborVideoWallpaperStore: { getVideoRecord: async () => record } });
    assert.equal(await env.api.sync({ ...preferences, videoMeta: meta }), 'missing');
    assert.equal(env.calls.filter(c => c[0] === 'source' && c[1]).length, 0);
  }
});

test('same resource does not reload, and motion state is applied before first source', async () => {
  const env = runtimeEnv({ TabHarborVideoWallpaperStore: { getVideoRecord: async () => record } });
  env.scope.document.hidden = true; env.motion.matches = true; env.api.init();
  assert.equal(await env.api.sync(preferences), 'video');
  assert.deepEqual(env.calls.slice(0, 3), [['playback', 'playing'], ['motion', true], ['hidden', true]]);
  await env.api.sync({ ...preferences, videoPlayback: 'paused' });
  assert.equal(env.calls.filter(c => c[0] === 'source').length, 1);
  env.scope.document.hidden = false; env.listeners.visibilitychange();
  env.listeners.motion({ matches: false });
  assert.deepEqual(env.calls.slice(-2), [['hidden', false], ['motion', false]]);
});

test('late IDB resolution cannot restart media after switching to an image', async () => {
  let resolve;
  const env = runtimeEnv({ TabHarborVideoWallpaperStore: { getVideoRecord: () => new Promise(r => { resolve = r; }) } });
  const pending = env.api.sync(preferences);
  assert.equal(await env.api.sync({ backgroundType: 'image' }), 'cleared');
  resolve(record);
  assert.equal(await pending, 'stale');
  assert.equal(env.calls.length, 0);
});

test('video import validates and probes before persisting and never changes preferences itself', async () => {
  const order = [];
  const env = runtimeEnv({
    TabHarborVideoWallpaper: {
      validateVideoFile: () => { order.push('validate'); return { name: 'clip', type: 'video/webm' }; },
      probeVideoFile: async () => { order.push('probe'); return { width: 640, height: 360, duration: 2, poster: 'poster' }; },
    },
    TabHarborVideoWallpaperStore: { saveVideoBlob: async () => { order.push('persist'); return { resourceId: 'new' }; } },
  });
  const updates = await env.api.importVideoWallpaper(new Blob(['video']));
  assert.deepEqual(order, ['validate', 'probe', 'persist']);
  assert.equal(updates.backgroundType, 'video');
  assert.equal(updates.videoMeta.resourceId, 'new');
  assert.equal(updates.videoPoster, 'poster');
  assert.equal(env.calls.length, 0);
});

test('probe and storage failures reject imports without producing a preference replacement', async () => {
  let writes = 0;
  const env = runtimeEnv({
    TabHarborVideoWallpaper: { validateVideoFile: () => ({}), probeVideoFile: async () => { throw new Error('decode'); } },
    TabHarborVideoWallpaperStore: { saveVideoBlob: async () => { writes++; throw new Error('quota'); } },
  });
  await assert.rejects(env.api.importVideoWallpaper({}), /decode/);
  assert.equal(writes, 0);
  env.scope.TabHarborVideoWallpaper.probeVideoFile = async () => ({ poster: '' });
  await assert.rejects(env.api.importVideoWallpaper({}), /quota/);
  assert.equal(writes, 1);
});

test('unreadable extraction falls back and seed regeneration preserves application availability', async () => {
  const env = runtimeEnv({ TabHarborMonetTheme: { regenerateWithSeed() { throw new Error('bad cache'); } } });
  assert.equal(env.api.regenerateWallpaperTheme({}, 20), null);
  assert.equal(await env.api.extractThemeFromImageDataUrl(''), null);
});
