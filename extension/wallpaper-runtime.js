'use strict';

// Wallpaper runtime (dashboard only): owns the fixed wallpaper layer behind
// the dashboard, the video player lifecycle, Monet theme extraction from the
// active wallpaper, and missing-media recovery notices.
//
// Responsibilities and boundaries:
//   - theme-controls.js owns the preference model and CSS token application;
//     it calls TabHarborWallpaperRuntime.sync(prefs) after every apply.
//   - video-wallpaper-store.js owns the IndexedDB blob; this module never
//     touches IndexedDB directly.
//   - monet-theme.js owns quantize/score/HCT math; this module only feeds it
//     drawable sources (image data URLs, video posters).
//
// Replacement safety: importVideoWallpaper writes the new blob to IndexedDB
// first and only returns preference updates afterwards, so the caller switches
// backgroundType to 'video' strictly after the media is durably stored.
(function attachWallpaperRuntime(globalScope) {
  const PENDING_NOTICE_KEY = 'tabHarborPendingVideoNotice';
  const LAYER_ID = 'wallpaperLayer';

  let layer = null;
  let player = null;
  let playerKey = '';
  let syncToken = 0;
  let hidden = false;
  let reducedMotion = false;
  let missingNoticeShown = false;
  let initialized = false;

  function getStore() {
    return globalScope.TabHarborVideoWallpaperStore || null;
  }

  function getVideoWallpaper() {
    return globalScope.TabHarborVideoWallpaper || null;
  }

  function getMonet() {
    return globalScope.TabHarborMonetTheme || null;
  }

  function notify(message) {
    if (typeof globalScope.showToast === 'function' && message) {
      globalScope.showToast(message);
    }
  }

  function notifyText(key, fallback) {
    const t = globalScope.TabHarborI18n?.t;
    notify(t ? t(key) : fallback);
  }

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    const doc = globalScope.document;
    if (!doc?.body) return null;
    layer = doc.getElementById(LAYER_ID);
    if (!layer) {
      layer = doc.createElement('div');
      layer.id = LAYER_ID;
      layer.className = 'wallpaper-layer';
      layer.setAttribute('aria-hidden', 'true');
      doc.body.insertBefore(layer, doc.body.firstChild);
    }
    return layer;
  }

  // A stable identity for the currently loaded source so re-applying the same
  // preferences (e.g. an unrelated settings change) never reloads the video.
  function computeSourceKey(preferences, record) {
    const meta = preferences?.videoMeta || {};
    return [
      preferences?.backgroundType || 'none',
      meta.resourceId || '',
      meta.savedAt || '',
      meta.size || 0,
      record?.meta?.savedAt || '',
    ].join('|');
  }

  function syncPlayerState(preferences) {
    if (!player) return;
    player.setPlayback(preferences.videoPlayback === 'paused' ? 'paused' : 'playing');
    player.setReducedMotion(reducedMotion);
    player.setHidden(hidden);
  }

  function showPosterOnly(poster) {
    const host = ensureLayer();
    if (!host) return;
    if (player) player.setSource(null);
    playerKey = '';
    host.style.backgroundImage = poster ? `url("${poster}")` : '';
  }

  function announceMissingMedia() {
    if (missingNoticeShown) return;
    missingNoticeShown = true;
    notifyText('toastVideoWallpaperMissing',
      'The video file is not stored on this device — showing its poster. Re-import the video to restore motion.');
  }

  // Applies the wallpaper side of the theme preferences. Image backgrounds are
  // painted by theme-controls on <body>; this owns the video layer and the
  // poster fallback. Returns 'video' | 'missing' | 'cleared'.
  async function sync(preferences) {
    if (!initialized) init();
    const prefs = preferences && typeof preferences === 'object' ? preferences : {};
    const token = ++syncToken;

    if (prefs.backgroundType !== 'video') {
      playerKey = '';
      if (player) player.setSource(null);
      if (layer) layer.style.backgroundImage = '';
      return 'cleared';
    }

    const store = getStore();
    const videoWallpaper = getVideoWallpaper();
    const poster = typeof prefs.videoPoster === 'string' ? prefs.videoPoster : '';
    if (!store || !videoWallpaper) {
      showPosterOnly(poster);
      return 'missing';
    }

    const resourceId = prefs.videoMeta?.resourceId;
    // A portable backup has no local identity. Never fall back to the
    // database's legacy "current" pointer, even if a video exists locally.
    if (typeof resourceId !== 'string' || !resourceId) {
      showPosterOnly(poster);
      announceMissingMedia();
      return 'missing';
    }
    let record = null;
    try {
      record = await store.getVideoRecord(resourceId);
    } catch {
      record = null;
    }
    if (token !== syncToken) return 'stale';

    if (!record || !record.blob || resourceId !== record.meta?.resourceId
      || (prefs.videoMeta.size > 0 && prefs.videoMeta.size !== record.blob.size)
      || (prefs.videoMeta.savedAt && prefs.videoMeta.savedAt !== record.meta?.savedAt)) {
      // Import/restore on a device without the blob: degrade to the poster.
      showPosterOnly(poster);
      announceMissingMedia();
      return 'missing';
    }

    const host = ensureLayer();
    if (!host) return 'missing';
    if (!player) {
      player = videoWallpaper.createVideoWallpaperPlayer(host, {
        onError: () => {
          // Playback decode failure: keep the poster, tell the user once.
          notifyText('toastVideoWallpaperUnreadable', 'Could not play the video wallpaper — showing its poster.');
        },
      });
    }
    // Set motion/visibility before assigning a source: setSource itself can
    // start playback, so reduced-motion and hidden pages must be gated first.
    syncPlayerState(prefs);
    const nextKey = computeSourceKey(prefs, record);
    if (nextKey !== playerKey) {
      player.setSource(record.blob, poster);
      playerKey = nextKey;
    }
    return 'video';
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const doc = globalScope.document;
      if (!doc) {
        reject(new Error('toastVideoWallpaperUnreadable'));
        return;
      }
      const image = doc.createElement('img');
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('toastVideoWallpaperUnreadable'));
      image.src = dataUrl;
    });
  }

  // Samples a drawable image source through the Monet pipeline. Returns null
  // (never throws) when extraction is impossible so uploads can still proceed
  // without a generated theme.
  async function extractThemeFromImageDataUrl(dataUrl, source = 'image') {
    const monet = getMonet();
    if (!monet || !dataUrl) return null;
    try {
      const image = await loadImageFromDataUrl(dataUrl);
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const pixels = monet.sampleDrawableToPixels(image, width, height);
      return monet.buildWallpaperThemeFromPixels(pixels, {
        source,
        sourceHash: monet.hashSourceId(dataUrl),
      });
    } catch {
      return null;
    }
  }

  // Rebuilds the cached wallpaper theme from a user-adjusted seed hue. The
  // caller persists the result together with wallpaperSeedHue.
  function regenerateWallpaperTheme(currentCache, seedHue) {
    const monet = getMonet();
    if (!monet || !currentCache) return null;
    try {
      return monet.regenerateWithSeed(currentCache, seedHue);
    } catch {
      return null;
    }
  }

  // Full video import: validate → decode-probe (real metadata + poster) →
  // persist blob → extract a Monet theme from the poster. Throws Error with
  // an i18n key message on validation/probe/storage failure; callers catch and
  // toast it. Preference updates are returned, not applied, so the caller can
  // switch backgroundType only after the blob is durably saved.
  async function importVideoWallpaper(file) {
    const videoWallpaper = getVideoWallpaper();
    const store = getStore();
    if (!videoWallpaper || !store) {
      throw new Error('toastVideoWallpaperUnavailable');
    }
    const info = videoWallpaper.validateVideoFile(file);
    const probed = await videoWallpaper.probeVideoFile(file);
    const videoMeta = await store.saveVideoBlob(file, {
      name: info.name,
      type: info.type,
      width: probed.width,
      height: probed.height,
      duration: probed.duration,
    });
    const wallpaperTheme = await extractThemeFromImageDataUrl(probed.poster, 'video');
    return {
      backgroundType: 'video',
      videoPoster: probed.poster,
      videoMeta,
      videoPlayback: 'playing',
      wallpaperTheme,
      wallpaperSeedHue: wallpaperTheme?.seedHue ?? null,
    };
  }

  function markPendingVideoNotice() {
    try {
      globalScope.sessionStorage?.setItem(PENDING_NOTICE_KEY, '1');
    } catch { /* sessionStorage may be blocked; the fallback poster still works. */ }
  }

  function consumePendingVideoNotice() {
    try {
      const storage = globalScope.sessionStorage;
      if (!storage || !storage.getItem(PENDING_NOTICE_KEY)) return false;
      storage.removeItem(PENDING_NOTICE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function handleVisibilityChange() {
    hidden = Boolean(globalScope.document?.hidden);
    if (player) player.setHidden(hidden);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const doc = globalScope.document;
    hidden = Boolean(doc?.hidden);
    reducedMotion = Boolean(globalScope.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    doc?.addEventListener?.('visibilitychange', handleVisibilityChange);
    const motionQuery = globalScope.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (motionQuery) {
      const onMotionChange = event => {
        reducedMotion = Boolean(event?.matches);
        if (player) {
          player.setReducedMotion(reducedMotion);
        }
      };
      if (typeof motionQuery.addEventListener === 'function') {
        motionQuery.addEventListener('change', onMotionChange);
      } else if (typeof motionQuery.addListener === 'function') {
        motionQuery.addListener(onMotionChange);
      }
    }
    if (consumePendingVideoNotice()) {
      announceMissingMedia();
    }
  }

  const api = {
    PENDING_NOTICE_KEY,
    computeSourceKey,
    consumePendingVideoNotice,
    extractThemeFromImageDataUrl,
    importVideoWallpaper,
    init,
    markPendingVideoNotice,
    regenerateWallpaperTheme,
    sync,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabHarborWallpaperRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
