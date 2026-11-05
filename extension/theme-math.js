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
      dark: Object.fromEntries(WALLPAPER_TOKEN_NAMES.map(name => [name, input.dark[name]])),
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
        '--glass-blur': `${10 + Math.round(intensity * 0.22)}px`,
        '--glass-saturate': `${100 + Math.round(intensity * 0.5)}%`,
        '--glass-surface-scale': (1 - intensity * 0.002).toFixed(3),
        '--glass-floating-min': '78%',
        '--glass-panel-min': '70%',
        '--glass-scrim-opacity': (0.05 + intensity * 0.001).toFixed(3),
      };
    }

    if (kind === 'clear') {
      return {
        material: kind,
        materialIntensity: intensity,
        '--glass-blur': '0px',
        '--glass-saturate': '100%',
        '--glass-surface-scale': (1 - intensity * 0.006).toFixed(3),
        '--glass-floating-min': `${Math.round(78 - intensity * 0.36)}%`,
        '--glass-panel-min': `${Math.round(74 - intensity * 0.34)}%`,
        '--glass-scrim-opacity': (0.1 + intensity * 0.004).toFixed(3),
      };
    }

    return {
      material: 'default',
      materialIntensity: intensity,
      '--glass-blur': '10px',
      '--glass-saturate': '100%',
      '--glass-surface-scale': '1',
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
    const scale = clampNumber(materialVars['--glass-surface-scale'], 0.2, 1, 1);
    // A material with no blur cannot rely on backdrop-filter for legibility,
    // so its surfaces keep a readable opacity floor even at high intensity.
    const blur = String(materialVars['--glass-blur'] || '10px');
    const hasBlur = blur !== '0px';
    const floor = hasBlur ? 2 : 26;
    const effective = Math.max(floor, Math.round(base * scale));
    return {
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
