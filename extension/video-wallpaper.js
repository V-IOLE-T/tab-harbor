'use strict';

// Video wallpaper: validation, poster capture and the background player.
// The blob itself lives in video-wallpaper-store.js (IndexedDB); this module
// owns the <video> element lifecycle — object URLs, muted loop playback,
// hidden/reduced-motion pausing, poster fallback and error recovery.
(function attachVideoWallpaper(globalScope) {
  const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
  const MAX_VIDEO_SECONDS = 120;
  const MAX_VIDEO_EDGE = 3840;
  const POSTER_MAX_EDGE = 960;
  const POSTER_TYPE = 'image/webp';
  const POSTER_QUALITY = 0.72;
  const METADATA_TIMEOUT_MS = 15000;
  const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];

  // --- pure helpers (unit-tested in node) ---

  function validateVideoFile(file, { maxBytes = MAX_VIDEO_BYTES } = {}) {
    if (!file || typeof file !== 'object') {
      throw new Error('toastVideoWallpaperUnreadable');
    }
    const type = String(file.type || '');
    if (!type.startsWith('video/')) {
      throw new Error('toastVideoWallpaperInvalidType');
    }
    const size = Number(file.size) || 0;
    if (size <= 0) {
      throw new Error('toastVideoWallpaperUnreadable');
    }
    if (size > maxBytes) {
      throw new Error('toastVideoWallpaperTooLarge');
    }
    return { name: String(file.name || ''), type, size };
  }

  function isAcceptedVideoType(type) {
    return ACCEPTED_VIDEO_TYPES.includes(String(type || '').toLowerCase());
  }

  function pickPosterTime(duration) {
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.min(0.5, seconds * 0.1);
  }

  function checkVideoMetadata({ duration, width, height }, { maxSeconds = MAX_VIDEO_SECONDS, maxEdge = MAX_VIDEO_EDGE } = {}) {
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error('toastVideoWallpaperUnreadable');
    }
    if (seconds > maxSeconds) {
      throw new Error('toastVideoWallpaperTooLong');
    }
    const w = Math.round(Number(width) || 0);
    const h = Math.round(Number(height) || 0);
    if (w <= 0 || h <= 0) {
      throw new Error('toastVideoWallpaperUnreadable');
    }
    if (Math.max(w, h) > maxEdge) {
      throw new Error('toastVideoWallpaperTooLarge');
    }
    return { duration: seconds, width: w, height: h };
  }

  // Import/backup recovery: a config backup carries poster metadata but never
  // the video blob. When the blob is absent on this device, downgrade to the
  // poster as a static image background (or no wallpaper without a poster).
  function buildMissingVideoRecovery(preferences) {
    const prefs = preferences && typeof preferences === 'object' ? preferences : {};
    if (prefs.backgroundType !== 'video') return null;
    const poster = typeof prefs.videoPoster === 'string' ? prefs.videoPoster : '';
    if (poster) {
      return { backgroundType: 'image', customBackground: poster };
    }
    return { backgroundType: 'none' };
  }

  function shouldAutoplay({ playback = 'playing', reducedMotion = false, hidden = false } = {}) {
    return playback !== 'paused' && !reducedMotion && !hidden;
  }

  // --- DOM helpers (dashboard only) ---

  function capturePosterFromVideo(video, { maxEdge = POSTER_MAX_EDGE } = {}) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('toastVideoWallpaperUnreadable');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('toastVideoWallpaperUnreadable');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(POSTER_TYPE, POSTER_QUALITY);
  }

  // Real validation: actually decode the file in a <video> element, verify
  // duration/dimensions, then capture a poster frame. The object URL is
  // always revoked, including on failure.
  function probeVideoFile(file, { timeoutMs = METADATA_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      let settled = false;
      const timer = setTimeout(() => {
        finish(null, new Error('toastVideoWallpaperUnreadable'));
      }, timeoutMs);

      function finish(result, error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeAttribute('src');
        video.load?.();
        URL.revokeObjectURL(objectUrl);
        if (error) reject(error);
        else resolve(result);
      }

      video.muted = true;
      video.preload = 'auto';
      video.onerror = () => finish(null, new Error('toastVideoWallpaperUnreadable'));
      video.onloadedmetadata = () => {
        let meta;
        try {
          meta = checkVideoMetadata({
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
          });
        } catch (err) {
          finish(null, err);
          return;
        }
        video.currentTime = pickPosterTime(meta.duration);
      };
      video.onseeked = () => {
        try {
          const poster = capturePosterFromVideo(video);
          finish({
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            poster,
          }, null);
        } catch (err) {
          finish(null, err);
        }
      };
      video.src = objectUrl;
    });
  }

  // Player: owns one <video> inside a fixed layer behind the dashboard.
  // Object URLs are revoked on replace/unmount; playback follows the saved
  // preference, page visibility and prefers-reduced-motion.
  function createVideoWallpaperPlayer(layer, { onError } = {}) {
    let video = null;
    let objectUrl = null;
    let posterUrl = '';
    let playback = 'playing';
    let reducedMotion = false;
    let hidden = false;
    let failed = false;

    function syncLayer() {
      if (!layer) return;
      if (posterUrl) {
        layer.style.backgroundImage = `url("${posterUrl}")`;
      } else {
        layer.style.backgroundImage = '';
      }
      // Poster stays visible under the video so first paint and error states
      // never flash a bare background.
      if (video) {
        video.style.display = !objectUrl || failed || reducedMotion ? 'none' : '';
      }
    }

    function syncPlayback() {
      if (!video || !objectUrl) return;
      if (shouldAutoplay({ playback, reducedMotion, hidden }) && !failed) {
        const playAttempt = video.play();
        if (playAttempt && typeof playAttempt.catch === 'function') {
          playAttempt.catch(() => { /* Autoplay can be blocked; poster stays. */ });
        }
      } else {
        video.pause();
      }
    }

    function ensureVideo() {
      if (video || !layer) return;
      video = document.createElement('video');
      video.className = 'wallpaper-video-element';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-hidden', 'true');
      video.addEventListener('error', () => {
        failed = true;
        syncLayer();
        onError?.(new Error('video-playback-failed'));
      });
      layer.appendChild(video);
    }

    return {
      // Swap the source only after the caller has durably saved the new blob.
      // The old object URL is revoked once the new one is wired up.
      setSource(blob, poster = '') {
        if (!layer) return;
        const nextUrl = blob ? URL.createObjectURL(blob) : null;
        posterUrl = typeof poster === 'string' ? poster : '';
        failed = false;
        if (nextUrl) {
          ensureVideo();
          if (video) {
            video.poster = posterUrl;
            video.src = nextUrl;
            video.load();
          }
        } else if (video) {
          video.poster = '';
          video.removeAttribute('poster');
          video.removeAttribute('src');
          video.load();
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = nextUrl;
        syncLayer();
        syncPlayback();
      },
      setPlayback(next) {
        playback = next === 'paused' ? 'paused' : 'playing';
        syncPlayback();
      },
      setReducedMotion(next) {
        reducedMotion = Boolean(next);
        syncLayer();
        syncPlayback();
      },
      setHidden(next) {
        hidden = Boolean(next);
        syncPlayback();
      },
      isFailed() {
        return failed;
      },
      hasSource() {
        return Boolean(objectUrl);
      },
      unmount() {
        if (video) {
          video.removeAttribute('src');
          video.load();
          video.remove();
          video = null;
        }
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        posterUrl = '';
      },
    };
  }

  const api = {
    ACCEPTED_VIDEO_TYPES,
    MAX_VIDEO_BYTES,
    MAX_VIDEO_EDGE,
    MAX_VIDEO_SECONDS,
    METADATA_TIMEOUT_MS,
    POSTER_MAX_EDGE,
    POSTER_QUALITY,
    POSTER_TYPE,
    buildMissingVideoRecovery,
    capturePosterFromVideo,
    checkVideoMetadata,
    createVideoWallpaperPlayer,
    isAcceptedVideoType,
    pickPosterTime,
    probeVideoFile,
    shouldAutoplay,
    validateVideoFile,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabHarborVideoWallpaper = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
