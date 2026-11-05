'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { context, element } = require('./wallpaper-test-helpers.cjs');
const videoApi = require('./video-wallpaper.js');

function playerEnv() {
  const videos = []; const revoked = []; let serial = 0;
  const env = context({
    document: { createElement: tag => { const el = element(tag); videos.push(el); return el; } },
    URL: { createObjectURL: () => `blob:test-${++serial}`, revokeObjectURL: url => revoked.push(url) },
  });
  env.load('video-wallpaper.js');
  const layer = element();
  const errors = [];
  const player = env.scope.TabHarborVideoWallpaper.createVideoWallpaperPlayer(layer, { onError: e => errors.push(e) });
  return { env, player, layer, videos, revoked, errors };
}

test('video validation enforces type, nonempty size and 60 MiB limit', () => {
  assert.throws(() => videoApi.validateVideoFile({ type: 'image/png', size: 100 }), /InvalidType/);
  assert.throws(() => videoApi.validateVideoFile({ type: 'video/webm', size: 0 }), /Unreadable/);
  assert.throws(() => videoApi.validateVideoFile({ type: 'video/webm', size: videoApi.MAX_VIDEO_BYTES + 1 }), /TooLarge/);
  assert.equal(videoApi.validateVideoFile({ type: 'video/webm', size: videoApi.MAX_VIDEO_BYTES }).size, videoApi.MAX_VIDEO_BYTES);
});

test('decoded metadata rejects excessive duration, dimensions and invalid media', () => {
  assert.throws(() => videoApi.checkVideoMetadata({ duration: Infinity, width: 20, height: 20 }), /Unreadable/);
  assert.throws(() => videoApi.checkVideoMetadata({ duration: 121, width: 20, height: 20 }), /TooLong/);
  assert.throws(() => videoApi.checkVideoMetadata({ duration: 1, width: 4000, height: 20 }), /TooLarge/);
  assert.throws(() => videoApi.checkVideoMetadata({ duration: 1, width: 0, height: 20 }), /Unreadable/);
  assert.deepEqual(videoApi.checkVideoMetadata({ duration: 120, width: 3840, height: 2160 }), { duration: 120, width: 3840, height: 2160 });
  assert.equal(videoApi.pickPosterTime(1), .1);
  assert.equal(videoApi.pickPosterTime(120), .5);
});

test('wallpaper player mutes and loops, pauses hidden pages, and resumes only when allowed', () => {
  const { player, videos } = playerEnv();
  player.setHidden(true);
  player.setSource(new Blob(['media']), 'data:image/webp;base64,AA==');
  const video = videos[0];
  assert.equal(video.muted, true); assert.equal(video.loop, true); assert.equal(video.playsInline, true);
  assert.equal(video.playCalls, 0);
  player.setHidden(false); assert.equal(video.playCalls, 1);
  player.setPlayback('paused'); assert.ok(video.pauseCalls >= 2);
  player.setHidden(true); player.setHidden(false); assert.equal(video.playCalls, 1);
  player.setPlayback('playing'); assert.equal(video.playCalls, 2);
});

test('reduced motion and decode errors keep poster visible with no video motion', () => {
  const { player, videos, layer, errors } = playerEnv();
  player.setReducedMotion(true);
  player.setSource(new Blob(['media']), 'data:image/webp;base64,AA==');
  assert.equal(videos[0].playCalls, 0);
  assert.equal(videos[0].style.display, 'none');
  assert.match(layer.style.backgroundImage, /data:image\/webp/);
  player.setReducedMotion(false);
  assert.equal(videos[0].style.display, '');
  videos[0].dispatch('error');
  assert.equal(player.isFailed(), true);
  assert.equal(videos[0].style.display, 'none');
  assert.equal(errors.length, 1);
});

test('object URLs are revoked on source replacement, clear and unmount', () => {
  const { player, revoked, videos } = playerEnv();
  player.setSource(new Blob(['first']));
  player.setSource(new Blob(['second']));
  assert.deepEqual(revoked, ['blob:test-1']);
  player.setSource(null);
  assert.equal(player.hasSource(), false);
  player.setSource(new Blob(['third']));
  player.unmount(); player.unmount();
  assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2', 'blob:test-3']);
  assert.equal(videos[0].removed, true);
});

test('probe timeout and decode errors release temporary URLs', async () => {
  const { env, videos, revoked } = playerEnv();
  await assert.rejects(env.scope.TabHarborVideoWallpaper.probeVideoFile(new Blob(['bad']), { timeoutMs: 1 }), /Unreadable/);
  const pending = env.scope.TabHarborVideoWallpaper.probeVideoFile(new Blob(['bad']));
  videos[1].onerror();
  await assert.rejects(pending, /Unreadable/);
  assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2']);
});

test('missing video recovery is static and never manufactures local blob URLs', () => {
  assert.deepEqual(videoApi.buildMissingVideoRecovery({ backgroundType: 'video', videoPoster: 'poster' }), { backgroundType: 'image', customBackground: 'poster' });
  assert.deepEqual(videoApi.buildMissingVideoRecovery({ backgroundType: 'video' }), { backgroundType: 'none' });
  assert.equal(videoApi.buildMissingVideoRecovery({ backgroundType: 'image' }), null);
});


test('clearing a video removes and hides its poster before an image can paint', () => {
  const {player,videos,layer}=playerEnv();
  player.setSource(new Blob(['media']),'data:image/webp;base64,AA==');
  assert.ok(videos[0].poster);
  player.setSource(null);
  assert.equal(videos[0].poster,'');
  assert.equal(videos[0].style.display,'none');
  assert.equal(layer.style.backgroundImage,'');
  player.setReducedMotion(false);
  assert.equal(videos[0].style.display,'none');
  player.setSource(new Blob(['replacement']),'data:image/webp;base64,BB==');
  assert.equal(videos[0].style.display,'');
});
