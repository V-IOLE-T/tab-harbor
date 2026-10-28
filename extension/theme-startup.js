'use strict';

// @lat: [[startup#Theme before dashboard initialization]]
(function initializeStartupTheme() {
  const { families, legacyMigration } = globalThis.TabHarborThemePalettes;
  const cacheKey = 'tabHarborStartupTheme';
  let runtimeThemeApplied = false;

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
    Object.entries(families[paletteId][tone]).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });
    root.style.colorScheme = tone;
    root.style.backgroundColor = 'var(--paper)';
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ mode, paletteId }));
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
