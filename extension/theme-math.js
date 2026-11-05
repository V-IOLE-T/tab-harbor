'use strict';

// Shared, dependency-free theme math. Loaded before theme-startup.js in the
// page <head>, so everything here must stay synchronous and DOM-free.
//
// Responsibilities:
//   - material (glass) token computation for the three material kinds
//   - wallpaper (Monet) cache structural validation shared by startup + runtime
//   - effective surface opacity computation (surface depth × material scale)
(function attachThemeMath(globalScope) {
  const WALLPAPER_THEME_VERSION = 1;

  const WALLPAPER_TOKEN_NAMES = [
    '--ink',
    '--paper',
    '--warm-gray',
    '--muted',
    '--accent-amber',
    '--accent-sage',
    '--accent-slate',
    '--accent-rose',
    '--workspace-accent',
    '--workspace-accent-soft',
    '--workspace-accent-border',
    '--workspace-accent-contrast',
    '--status-active',
    '--status-cooling',
    '--status-abandoned',
    '--card-bg',
  ];

  const MATERIAL_ORDER = ['default', 'frosted', 'clear'];
  const VALID_MATERIALS = new Set(MATERIAL_ORDER);
  const DEFAULT_MATERIAL_INTENSITY = 50;

  // Frosted fill endpoints, in percent. 0 strength is a legibility floor for
  // body text over a busy wallpaper; 100 stays translucent so the wallpaper
  // and the blur remain visible instead of turning into an opaque panel.
  // Endpoints: 45% at 0, 60% at 50, 75% at 100 (monotonic, 0.3 per step).
  const FROSTED_FILL_MIN = 45;
  const FROSTED_FILL_STEP = 0.3;
  const FROSTED_FILL_MAX = FROSTED_FILL_MIN + FROSTED_FILL_STEP * 100;


  function isHexColor(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  function clampNumber(value, min, max, fallback) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, raw));
  }

  function normalizeMaterial(input) {
    const value = String(input || 'default');
    return VALID_MATERIALS.has(value) ? value : 'default';
  }

  function normalizeMaterialIntensity(input) {
    return Math.round(clampNumber(input, 0, 100, DEFAULT_MATERIAL_INTENSITY));
  }

  // Missing overlay values are from the old image wash + material scrim.
  // Fold both into one opacity once; explicit values never depend on glass.
  function normalizeWallpaperOverlay(input = {}) {
    const value = input.wallpaperOverlay;
    if (value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))) {
      return Math.round(clampNumber(value, 0, 100, 26));
    }
    const intensity = normalizeMaterialIntensity(input.materialIntensity);
    const scrim = input.material === 'clear' ? 0.1 + intensity * 0.004
      : input.material === 'frosted' ? 0.05 + intensity * 0.001 : 0;
    const image = input.backgroundType === 'image' || (!input.backgroundType && input.customBackground);
    const toneScale = input.mode === 'dark' ? 0.5 : 1;
    return Math.round(100 * (image ? 0.26 + scrim * toneScale * 0.74 : scrim * toneScale));
  }

  function normalizeWallpaperOverlayTint(input = {}) {
    if (Number.isFinite(Number(input.wallpaperOverlayTint)) && input.wallpaperOverlayTint != null) {
      return clampNumber(input.wallpaperOverlayTint, 0, 100, 0);
    }
    // Preserve the old image's paper wash as a single composite tint. Once
    // persisted, this tint and the overlay opacity are independent of material.
    const legacyImage = input.wallpaperOverlay == null && (input.backgroundType === 'image'
      || (!input.backgroundType && input.customBackground));
    if (!legacyImage) return 0;
    const intensity = normalizeMaterialIntensity(input.materialIntensity);
    const scrim = (input.material === 'clear' ? 0.1 + intensity * 0.004
      : input.material === 'frosted' ? 0.05 + intensity * 0.001 : 0) * (input.mode === 'dark' ? 0.5 : 1);
    return Number((100 * 0.26 * (1 - scrim) / (0.26 + scrim * 0.74)).toFixed(3));
  }

  function computeWallpaperOverlayVars(input = {}) {
    return {
      '--wallpaper-overlay-opacity': String(normalizeWallpaperOverlay(input) / 100),
      '--wallpaper-overlay-paper-share': `${normalizeWallpaperOverlayTint(input)}%`,
    };
  }

  // Structural validation for the cached wallpaper theme. Full semantic
  // regeneration lives in monet-theme.js; this guard only decides whether a
  // persisted cache is shaped well enough to paint with. A version mismatch
  // returns null so callers fall back to preset palettes and regenerate.
  function normalizeWallpaperThemeCache(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    if (input.version !== WALLPAPER_THEME_VERSION) return null;
    const seedHue = clampNumber(input.seedHue, 0, 360, NaN);
    const seedChroma = clampNumber(input.seedChroma, 0, 150, NaN);
    if (!Number.isFinite(seedHue) || !Number.isFinite(seedChroma)) return null;
    for (const tone of ['light', 'dark']) {
      const map = input[tone];
      if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
      for (const name of WALLPAPER_TOKEN_NAMES) {
        if (!isHexColor(map[name])) return null;
      }
    }
    return {
      version: WALLPAPER_THEME_VERSION,
      seedHue,
      seedChroma,
      source: input.source === 'video' ? 'video' : 'image',
      sourceHash: typeof input.sourceHash === 'string' ? input.sourceHash : '',
      light: Object.fromEntries(WALLPAPER_TOKEN_NAMES.map(name => [name, input.light[name]])),
      // v1 caches originally used a light label on the light dark-mode
      // accent. Repair that token at every read, including popup/first paint,
      // without discarding the user's extracted colors or adjusted seed.
      dark: { ...Object.fromEntries(WALLPAPER_TOKEN_NAMES.map(name => [name, input.dark[name]])),
        '--workspace-accent-contrast': input.dark['--paper'] },
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
    };
  }

  // Material (glass) tokens. All values feed the unified --glass-* custom
  // properties consumed by style.css; the @supports fallback there forces
  // near-opaque surfaces when backdrop-filter is unavailable.
  function computeMaterialVars({ material = 'default', materialIntensity = DEFAULT_MATERIAL_INTENSITY } = {}) {
    const kind = normalizeMaterial(material);
    const intensity = normalizeMaterialIntensity(materialIntensity);

    if (kind === 'frosted') {
      return {
        material: kind,
        materialIntensity: intensity,
        '--glass-blur': `${1 + Math.round(intensity * 0.32)}px`,
        '--glass-content-filter': `blur(${1 + Math.round(intensity * 0.32)}px) saturate(${100 + Math.round(intensity * 0.5)}%)`,
        // The fill floor is legibility, not a decorative "thin glass" look:
        // even at 0 the body text must stay readable on a busy wallpaper, and
        // the top of the range still lets the wallpaper read through (76%).
        '--glass-frosted-fill': `${FROSTED_FILL_MIN + intensity * FROSTED_FILL_STEP}%`,
        '--glass-saturate': `${100 + Math.round(intensity * 0.5)}%`,
        '--glass-surface-scale': (1 - intensity * 0.002).toFixed(3),
        '--glass-control-scale': '1',
        '--glass-floating-min': '78%',
        '--glass-panel-min': '70%',
        '--glass-scrim-opacity': '0',
      };
    }

    if (kind === 'clear') {
      return {
        material: kind,
        materialIntensity: intensity,
        '--glass-blur': '0px',
        '--glass-content-filter': 'none',
        '--glass-frosted-fill': 'initial',
        '--glass-saturate': '100%',
        '--glass-surface-scale': (1 - intensity * 0.009).toFixed(3),
        '--glass-control-scale': (1 - intensity * 0.009).toFixed(3),
        '--glass-floating-min': `${(82 * (1 - intensity * 0.009)).toFixed(3)}%`,
        '--glass-panel-min': `${(74 * (1 - intensity * 0.009)).toFixed(3)}%`,
        '--glass-scrim-opacity': '0',
      };
    }

    return {
      material: 'default',
      materialIntensity: intensity,
      '--glass-blur': '10px',
      '--glass-content-filter': 'none',
      '--glass-frosted-fill': 'initial',
      '--glass-saturate': '100%',
      '--glass-surface-scale': '1',
      '--glass-control-scale': '1',
      '--glass-floating-min': '82%',
      '--glass-panel-min': '74%',
      '--glass-scrim-opacity': '0',
    };
  }

  function computeMaterialGlassVars(preferences) {
    const vars = computeMaterialVars(preferences);
    const result = {};
    for (const [key, value] of Object.entries(vars)) {
      if (key.startsWith('--')) result[key] = value;
    }
    return result;
  }

  // Effective surface opacity: the user's surface depth scaled by the active
  // material. Kept here (not in theme-controls) so first paint matches the
  // runtime exactly.
  function computeEffectiveOpacityVars(surfaceOpacity, materialVarsInput) {
    const base = clampNumber(surfaceOpacity, 2, 60, 14);
    const materialVars = materialVarsInput && typeof materialVarsInput === 'object'
      ? materialVarsInput
      : computeMaterialVars();
    const scale = clampNumber(materialVars['--glass-surface-scale'], 0.1, 1, 1);
    // Content can be clear without blur. Controls scale their own fills with the same clear strength.
    const effective = materialVars['--glass-blur'] === '0px'
      ? Number((base * scale).toFixed(2)) : Math.max(2, Math.round(base * scale));
    return {
      // Surface depth still nudges the frosted fill, so the existing depth
      // preference keeps meaning. The nudge itself is clamped (not the final
      // value) so fill stays strictly monotonic in strength for every depth and
      // can never reach an opaque panel or drop under the legibility floor.
      ...(materialVars['--glass-frosted-fill'] && materialVars['--glass-frosted-fill'] !== 'initial'
        ? { '--glass-frosted-fill': `${Number((parseFloat(materialVars['--glass-frosted-fill'])
          + clampNumber((base - 14) * 0.25, -2, 2, 0)).toFixed(2))}%` } : {}),
      '--custom-surface-opacity': `${effective}%`,
      '--custom-border-opacity': `${Math.max(8, effective)}%`,
      '--custom-badge-opacity': `${Math.max(3, Math.round(effective * 0.28))}%`,
      '--custom-fallback-opacity': `${Math.max(4, Math.round(effective * 0.36))}%`,
    };
  }

  const api = {
    MATERIAL_ORDER,
    VALID_MATERIALS,
    WALLPAPER_THEME_VERSION,
    WALLPAPER_TOKEN_NAMES,
    computeEffectiveOpacityVars,
    computeWallpaperOverlayVars,
    normalizeWallpaperOverlay,
    normalizeWallpaperOverlayTint,
    computeMaterialGlassVars,
    computeMaterialVars,
    isHexColor,
    normalizeMaterial,
    normalizeMaterialIntensity,
    normalizeWallpaperThemeCache,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabHarborThemeMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
