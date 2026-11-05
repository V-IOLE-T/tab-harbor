'use strict';

// Monet wallpaper theming: samples a wallpaper image (or video poster frame),
// quantizes it with the vendored Material Color Utilities, scores a seed
// color, and maps the seed through HCT onto the existing theme token names.
// Extraction runs only on the dashboard; popup/startup paint from the cached
// result validated by theme-math.js.
(function attachMonetTheme(globalScope) {
  const themeMath = globalScope.TabHarborThemeMath || {};
  const WALLPAPER_THEME_VERSION = themeMath.WALLPAPER_THEME_VERSION || 1;
  const SAMPLE_EDGE = 64;
  const QUANTIZE_MAX_COLORS = 24;

  function getMCU() {
    const mcu = globalScope.TabHarborMCU;
    if (!mcu || !mcu.Hct || !mcu.QuantizerCelebi || !mcu.Score) {
      throw new Error('Material Color Utilities bundle is unavailable');
    }
    return mcu;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hctHex(hue, chroma, tone) {
    const mcu = getMCU();
    return mcu.hexFromArgb(mcu.Hct.from(hue, chroma, tone).toInt());
  }

  // Canvas ImageData bytes (RGBA) → ARGB int array for QuantizerCelebi.
  // Nearly transparent pixels are dropped so transparent wallpaper regions do
  // not drag the seed toward black.
  function argbPixelsFromRgbaBytes(bytes) {
    const pixels = [];
    const length = bytes ? bytes.length : 0;
    for (let i = 0; i + 3 < length; i += 4) {
      const a = bytes[i + 3];
      if (a < 200) continue;
      pixels.push((a << 24) | (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]);
    }
    return pixels;
  }

  // Quantize + score → the seed color. Returns null for empty/blank input so
  // callers can fall back instead of crashing on unreadable wallpapers.
  function extractSeedFromPixels(pixels) {
    const mcu = getMCU();
    if (!Array.isArray(pixels) || pixels.length === 0) return null;
    const quantized = mcu.QuantizerCelebi.quantize(pixels, QUANTIZE_MAX_COLORS);
    if (!quantized || quantized.size === 0) return null;
    const ranked = mcu.Score.score(quantized);
    if (!ranked || ranked.length === 0) return null;
    const argb = ranked[0];
    const hct = mcu.Hct.fromInt(argb);
    return { argb, hue: hct.hue, chroma: hct.chroma };
  }

  function normalizeHue(input, fallback = 25) {
    const raw = Number(input);
    if (!Number.isFinite(raw)) return fallback;
    return ((raw % 360) + 360) % 360;
  }

  // Algorithm v1 token mapping. Deterministic in (seedHue, seedChroma) so a
  // persisted cache can be regenerated exactly, and so tests can pin values.
  function buildTokenMaps(seedHueInput, seedChromaInput) {
    const h = normalizeHue(seedHueInput);
    const c0 = clamp(Number(seedChromaInput) || 0, 0, 150);
    const nC = clamp(c0 * 0.12, 2, 8);
    const aC = clamp(c0, 24, 48);
    const hAmber = (h + 30) % 360;
    const hSage = (h + 130) % 360;
    const hSlate = (h + 210) % 360;
    const hRose = (h + 335) % 360;

    const light = {
      '--paper': hctHex(h, nC, 96.5),
      '--card-bg': hctHex(h, nC * 0.75, 98.5),
      '--ink': hctHex(h, Math.min(nC + 4, 10), 20),
      '--warm-gray': hctHex(h, nC + 2, 87),
      '--muted': hctHex(h, nC + 2, 50),
      '--accent-amber': hctHex(hAmber, aC * 0.9, 46),
      '--accent-sage': hctHex(hSage, aC * 0.7, 44),
      '--accent-slate': hctHex(hSlate, aC * 0.7, 46),
      '--accent-rose': hctHex(hRose, aC * 0.8, 48),
      '--workspace-accent': hctHex(h, aC, 42),
      '--workspace-accent-soft': hctHex(h, aC * 0.35, 90),
      '--workspace-accent-border': hctHex(h, aC * 0.5, 72),
      '--workspace-accent-contrast': hctHex(h, nC, 99),
      '--status-active': hctHex(150, 36, 36),
      '--status-cooling': hctHex(75, 42, 48),
      '--status-abandoned': hctHex(25, 42, 46),
    };

    const dark = {
      '--paper': hctHex(h, nC + 2, 13),
      '--card-bg': hctHex(h, nC, 17),
      '--ink': hctHex(h, nC, 88),
      '--warm-gray': hctHex(h, nC + 2, 25),
      '--muted': hctHex(h, nC + 2, 58),
      '--accent-amber': hctHex(hAmber, aC * 0.85, 66),
      '--accent-sage': hctHex(hSage, aC * 0.65, 64),
      '--accent-slate': hctHex(hSlate, aC * 0.65, 66),
      '--accent-rose': hctHex(hRose, aC * 0.75, 68),
      '--workspace-accent': hctHex(h, aC, 68),
      '--workspace-accent-soft': hctHex(h, aC * 0.3, 22),
      '--workspace-accent-border': hctHex(h, aC * 0.45, 38),
      '--workspace-accent-contrast': hctHex(h, nC + 2, 13),
      '--status-active': hctHex(150, 32, 62),
      '--status-cooling': hctHex(80, 40, 66),
      '--status-abandoned': hctHex(25, 38, 64),
    };

    return { light, dark };
  }

  function buildWallpaperTheme({ seedHue, seedChroma, source = 'image', sourceHash = '' } = {}) {
    const hue = normalizeHue(seedHue);
    const rawChroma = Number(seedChroma);
    const chroma = clamp(Number.isFinite(rawChroma) ? rawChroma : 32, 0, 150);
    const { light, dark } = buildTokenMaps(hue, chroma);
    return {
      version: WALLPAPER_THEME_VERSION,
      seedHue: hue,
      seedChroma: chroma,
      source: source === 'video' ? 'video' : 'image',
      sourceHash: String(sourceHash || ''),
      light,
      dark,
      updatedAt: new Date().toISOString(),
    };
  }

  // Rebuild token maps from a user-adjusted seed hue, keeping the extracted
  // chroma so saturation still tracks the wallpaper.
  function regenerateWithSeed(cache, seedHue) {
    const normalized = themeMath.normalizeWallpaperThemeCache
      ? themeMath.normalizeWallpaperThemeCache(cache)
      : null;
    const base = normalized || (cache && typeof cache === 'object' ? cache : {});
    return buildWallpaperTheme({
      seedHue,
      seedChroma: Number.isFinite(Number(base.seedChroma)) ? Number(base.seedChroma) : 32,
      source: base.source,
      sourceHash: base.sourceHash,
    });
  }

  function buildWallpaperThemeFromPixels(pixels, meta = {}) {
    const seed = extractSeedFromPixels(pixels);
    if (!seed) return null;
    return buildWallpaperTheme({
      seedHue: seed.hue,
      seedChroma: seed.chroma,
      source: meta.source,
      sourceHash: meta.sourceHash,
    });
  }

  // djb2 — stable identity for a wallpaper source so re-uploading the same
  // image can reuse the cached extraction instead of re-quantizing.
  function hashSourceId(input) {
    const text = String(input || '');
    let hash = 5381;
    const step = Math.max(1, Math.floor(text.length / 4096));
    for (let i = 0; i < text.length; i += step) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16);
  }

  // --- DOM sampling helpers (dashboard only) ---

  function sampleDrawableToPixels(drawable, width, height, edge = SAMPLE_EDGE) {
    if (!drawable || !width || !height) return null;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, edge / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(drawable, 0, 0, canvas.width, canvas.height);
    try {
      return argbPixelsFromRgbaBytes(context.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch {
      return null;
    }
  }

  const api = {
    QUANTIZE_MAX_COLORS,
    SAMPLE_EDGE,
    WALLPAPER_THEME_VERSION,
    argbPixelsFromRgbaBytes,
    buildTokenMaps,
    buildWallpaperTheme,
    buildWallpaperThemeFromPixels,
    extractSeedFromPixels,
    hashSourceId,
    normalizeHue,
    regenerateWithSeed,
    sampleDrawableToPixels,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabHarborMonetTheme = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
