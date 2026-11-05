'use strict';

// @lat: [[startup#Theme before dashboard initialization]]
(function initializeStartupTheme() {
  const { families, legacyMigration } = globalThis.TabHarborThemePalettes;
  const themeMath = globalThis.TabHarborThemeMath || {};
  const normalizeWallpaperThemeCache = themeMath.normalizeWallpaperThemeCache || (() => null);
  const cacheKey = 'tabHarborStartupTheme';
  let runtimeThemeApplied = false;

  function resolveTokens(preferences, tone) {
    const colorSource = preferences.colorSource === 'wallpaper' ? 'wallpaper' : 'preset';
    if (colorSource === 'wallpaper') {
      const cached = normalizeWallpaperThemeCache(preferences.wallpaperTheme);
      if (cached) return cached[tone];
    }
    const paletteId = Object.hasOwn(families, preferences.paletteId) ? preferences.paletteId : 'paper';
    return families[paletteId][tone];
  }

  function applyMaterial(preferences) {
    if (!themeMath.computeMaterialVars) return;
    const root = document.documentElement;
    const materialVars = { ...themeMath.computeMaterialVars(preferences), ...themeMath.computeWallpaperOverlayVars(preferences) };
    Object.entries(materialVars).forEach(([name, value]) => {
      if (name.startsWith('--')) root.style.setProperty(name, value);
    });
    if (themeMath.computeEffectiveOpacityVars) {
      const opacityVars = themeMath.computeEffectiveOpacityVars(preferences.surfaceOpacity, materialVars);
      Object.entries(opacityVars).forEach(([name, value]) => {
        root.style.setProperty(name, value);
      });
    }
  }

  function apply(preferences) {
    const next = preferences && typeof preferences === 'object' ? preferences : {};
    const migrated = legacyMigration[next.themeId] || {};
    const rawMode = next.mode || migrated.mode;
    const mode = ['light', 'dark'].includes(rawMode) ? rawMode : 'system';
    const rawPalette = next.paletteId || migrated.paletteId;
    const paletteId = Object.hasOwn(families, rawPalette) ? rawPalette : 'paper';
    const tone = mode === 'system'
      ? (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    const root = document.documentElement;
    Object.entries(resolveTokens({ ...next, paletteId }, tone)).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });
    const overlayPreferences = { ...next, mode: tone };
    applyMaterial(overlayPreferences);
    root.style.colorScheme = tone;
    root.style.backgroundColor = 'var(--paper)';
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        mode,
        paletteId,
        colorSource: next.colorSource === 'wallpaper' ? 'wallpaper' : 'preset',
        wallpaperTheme: normalizeWallpaperThemeCache(next.wallpaperTheme),
        material: next.material,
        materialIntensity: next.materialIntensity,
        surfaceOpacity: next.surfaceOpacity,
        wallpaperOverlay: themeMath.normalizeWallpaperOverlay(overlayPreferences),
        wallpaperOverlayTint: themeMath.normalizeWallpaperOverlayTint(overlayPreferences),
      }));
    } catch { /* Theme rendering must work when local storage is unavailable. */ }
  }

  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(cacheKey));
  } catch { /* Use the system palette for missing or unreadable caches. */ }
  apply(cached);

  // Read authoritative settings early, including the first launch after upgrade.
  globalThis.chrome?.storage?.local?.get('themePreferences').then(stored => {
    if (!runtimeThemeApplied) apply(stored.themePreferences);
  }).catch(() => {});

  globalThis.TabHarborThemeStartup = {
    sync(preferences) {
      runtimeThemeApplied = true;
      apply(preferences);
    },
  };
})();
