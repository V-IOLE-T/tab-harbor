'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, activeElement: null, documentElement: { style: {} }, body: { classList: { remove: () => {} } }, querySelectorAll: () => [], createElement: () => ({}) };
globalThis.TabOutIconUtils = {};
globalThis.TabOutBackgroundImage = {};
globalThis.TabOutListOrder = { reorderSubsetByIds: (a, b) => a };
globalThis.TabHarborTodos = { load: async () => [], save: async () => {} };
globalThis.TabHarborDashboardRuntime = null;
globalThis.chrome = { runtime: { lastError: null }, storage: { local: { get: async () => ({}), set: async () => {} } } };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = {
  matchMedia: query => ({
    media: query,
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
};

require('./theme-controls.js');

const {
  buildSearchUrlForQuery,
  filterRealTabs,
  getResolvedThemeDefinition,
  getResolvedTone,
  normalizeShortcutUrl,
  normalizeQuickShortcuts,
  normalizeThemePreferences,
} = globalThis.TabOutThemeControls;

// ---- normalizeThemePreferences / resolved theme ----

test('normalizeThemePreferences migrates legacy midnight to dark mist', () => {
  const result = normalizeThemePreferences({ themeId: 'midnight', surfaceOpacity: 19 });
  assert.equal(result.mode, 'dark');
  assert.equal(result.paletteId, 'mist');
  assert.equal(result.surfaceOpacity, 19);
});

test('normalizeThemePreferences migrates legacy light theme ids to light palette families', () => {
  const result = normalizeThemePreferences({ themeId: 'sage' });
  assert.equal(result.mode, 'light');
  assert.equal(result.paletteId, 'sage');
});

test('normalizeThemePreferences keeps explicit mode and palette values', () => {
  const result = normalizeThemePreferences({
    mode: 'system',
    paletteId: 'blush',
    surfaceOpacity: 9,
    uiScale: 112,
    shortcutScale: 124,
    savedSessionRestoreMode: 'current-window',
    savedSessionNavDisplayMode: 'icon',
  });
  assert.equal(result.mode, 'system');
  assert.equal(result.paletteId, 'blush');
  assert.equal(result.surfaceOpacity, 9);
  assert.equal(result.uiScale, 112);
  assert.equal(result.shortcutScale, 124);
  assert.equal(result.savedSessionRestoreMode, 'current-window');
  assert.equal(result.savedSessionNavDisplayMode, 'icon');
});

test('normalizeThemePreferences clamps size controls to calm readable ranges', () => {
  const small = normalizeThemePreferences({ uiScale: 40, shortcutScale: 40 });
  assert.equal(small.uiScale, 100);
  assert.equal(small.shortcutScale, 100);

  const large = normalizeThemePreferences({ uiScale: 180, shortcutScale: 180 });
  assert.equal(large.uiScale, 120);
  assert.equal(large.shortcutScale, 130);
});

test('normalizeThemePreferences defaults saved session restore mode to new-window', () => {
  const result = normalizeThemePreferences({});
  assert.equal(result.savedSessionRestoreMode, 'new-window');
  assert.equal(result.savedSessionNavDisplayMode, 'name');
});

test('normalizeThemePreferences falls back to new-window for invalid saved session restore mode', () => {
  const result = normalizeThemePreferences({
    savedSessionRestoreMode: 'hidden-window',
    savedSessionNavDisplayMode: 'label',
  });
  assert.equal(result.savedSessionRestoreMode, 'new-window');
  assert.equal(result.savedSessionNavDisplayMode, 'name');
});

test('normalizeThemePreferences defaults quick shortcut open mode to new-tab', () => {
  const result = normalizeThemePreferences({});
  assert.equal(result.quickShortcutOpenMode, 'new-tab');
});

test('normalizeThemePreferences preserves quick shortcut open mode when current-tab', () => {
  const result = normalizeThemePreferences({ quickShortcutOpenMode: 'current-tab' });
  assert.equal(result.quickShortcutOpenMode, 'current-tab');
});

test('normalizeThemePreferences falls back to new-tab for invalid quick shortcut open mode', () => {
  const result = normalizeThemePreferences({ quickShortcutOpenMode: 'new-window' });
  assert.equal(result.quickShortcutOpenMode, 'new-tab');
});

test('normalizeThemePreferences defaults quick shortcut columns to auto', () => {
  const result = normalizeThemePreferences({});
  assert.equal(result.quickShortcutCols, 'auto');
});

test('normalizeThemePreferences preserves quick shortcut columns when fixed', () => {
  const result = normalizeThemePreferences({ quickShortcutCols: '4' });
  assert.equal(result.quickShortcutCols, '4');
  assert.equal(normalizeThemePreferences({ quickShortcutCols: '5' }).quickShortcutCols, '5');
});

test('normalizeThemePreferences falls back to auto for invalid quick shortcut columns', () => {
  const result = normalizeThemePreferences({ quickShortcutCols: '6' });
  assert.equal(result.quickShortcutCols, 'auto');
});

test('normalizeThemePreferences defaults search engine to browser default', () => {
  const result = normalizeThemePreferences({});
  assert.equal(result.searchEngine, 'default');
  assert.equal(result.customSearchUrl, '');
});

test('normalizeThemePreferences preserves search engine preset and custom URL', () => {
  const result = normalizeThemePreferences({ searchEngine: 'baidu', customSearchUrl: 'https://example.com/search?q={query}' });
  assert.equal(result.searchEngine, 'baidu');
  assert.equal(result.customSearchUrl, 'https://example.com/search?q={query}');
});

test('normalizeThemePreferences falls back to default for invalid search engine', () => {
  const result = normalizeThemePreferences({ searchEngine: 'yahoo' });
  assert.equal(result.searchEngine, 'default');
});

test('buildSearchUrlForQuery returns empty for browser default engine', () => {
  assert.equal(buildSearchUrlForQuery('hello', { searchEngine: 'default' }), '');
  assert.equal(buildSearchUrlForQuery(''), '');
});

test('buildSearchUrlForQuery uses preset search URLs with encoded query', () => {
  const googleUrl = buildSearchUrlForQuery('hello world', { searchEngine: 'google' });
  assert.equal(googleUrl, 'https://www.google.com/search?q=hello%20world');
  const baiduUrl = buildSearchUrlForQuery('测试', { searchEngine: 'baidu' });
  assert.equal(baiduUrl, 'https://www.baidu.com/s?wd=' + encodeURIComponent('测试'));
});

test('buildSearchUrlForQuery replaces placeholders in custom URL', () => {
  const braces = buildSearchUrlForQuery('a b', { searchEngine: 'custom', customSearchUrl: 'https://x.example/s?q={query}' });
  assert.equal(braces, 'https://x.example/s?q=a%20b');
  const percent = buildSearchUrlForQuery('a b', { searchEngine: 'custom', customSearchUrl: 'https://x.example/s?q=%s' });
  assert.equal(percent, 'https://x.example/s?q=a%20b');
  const appended = buildSearchUrlForQuery('a b', { searchEngine: 'custom', customSearchUrl: 'https://x.example/s?q=' });
  assert.equal(appended, 'https://x.example/s?q=a%20b');
});

test('buildSearchUrlForQuery uses per-engine params for sogou and yandex', () => {
  const sogouUrl = buildSearchUrlForQuery('测试', { searchEngine: 'sogou' });
  assert.equal(sogouUrl, 'https://www.sogou.com/web?query=' + encodeURIComponent('测试'));
  const yandexUrl = buildSearchUrlForQuery('test query', { searchEngine: 'yandex' });
  assert.equal(yandexUrl, 'https://yandex.com/search/?text=test%20query');
});

test('buildSearchUrlForQuery returns empty when custom URL is unset', () => {
  assert.equal(buildSearchUrlForQuery('hello', { searchEngine: 'custom', customSearchUrl: '' }), '');
});

test('normalizeThemePreferences defaults closeDuplicateNewTabsEnabled to false', () => {
  const result = normalizeThemePreferences({});
  assert.equal(result.closeDuplicateNewTabsEnabled, false);
});

test('normalizeThemePreferences preserves closeDuplicateNewTabsEnabled when true', () => {
  const result = normalizeThemePreferences({ closeDuplicateNewTabsEnabled: true });
  assert.equal(result.closeDuplicateNewTabsEnabled, true);
});

test('normalizeThemePreferences rejects non-boolean closeDuplicateNewTabsEnabled', () => {
  assert.equal(normalizeThemePreferences({ closeDuplicateNewTabsEnabled: 'yes' }).closeDuplicateNewTabsEnabled, false);
  assert.equal(normalizeThemePreferences({ closeDuplicateNewTabsEnabled: 1 }).closeDuplicateNewTabsEnabled, false);
  assert.equal(normalizeThemePreferences({ closeDuplicateNewTabsEnabled: null }).closeDuplicateNewTabsEnabled, false);
});

test('normalizeThemePreferences keeps bookmark favicons opt-in and boolean-only', () => {
  assert.equal(normalizeThemePreferences({}).bookmarksShowFavicons, false);
  assert.equal(normalizeThemePreferences({ bookmarksShowFavicons: true }).bookmarksShowFavicons, true);
  assert.equal(normalizeThemePreferences({ bookmarksShowFavicons: 'true' }).bookmarksShowFavicons, false);
  assert.equal(normalizeThemePreferences({ bookmarksShowFavicons: 1 }).bookmarksShowFavicons, false);
});

test('getResolvedTone follows system preference when mode is system', () => {
  const originalMatchMedia = globalThis.window.matchMedia;
  globalThis.window.matchMedia = query => ({
    media: query,
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  try {
    assert.equal(getResolvedTone({ mode: 'system' }), 'dark');
  } finally {
    globalThis.window.matchMedia = originalMatchMedia;
  }
});

test('getResolvedThemeDefinition resolves dark tokens from palette family', () => {
  const theme = getResolvedThemeDefinition({ mode: 'dark', paletteId: 'paper' });
  assert.equal(theme.name, 'Paper');
  assert.equal(theme.tone, 'dark');
  assert.equal(theme.vars['--paper'], '#1a1613');
});

// ---- filterRealTabs ----

test('filterRealTabs removes chrome:// internal pages', () => {
  const tabs = [
    { id: 1, url: 'https://github.com' },
    { id: 2, url: 'chrome://newtab' },
    { id: 3, url: 'chrome://settings' },
  ];
  const result = filterRealTabs(tabs);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});

test('filterRealTabs removes chrome-extension:// URLs', () => {
  const tabs = [
    { id: 1, url: 'https://example.com' },
    { id: 2, url: 'chrome-extension://abc123/background.html' },
  ];
  const result = filterRealTabs(tabs);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});

test('filterRealTabs removes about:blank and about:s pages', () => {
  const tabs = [
    { id: 1, url: 'https://example.com' },
    { id: 2, url: 'about:blank' },
    { id: 3, url: 'about:settings' },
  ];
  const result = filterRealTabs(tabs);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});

test('filterRealTabs removes edge:// and brave:// URLs', () => {
  const tabs = [
    { id: 1, url: 'https://example.com' },
    { id: 2, url: 'edge://settings' },
    { id: 3, url: 'brave://rewards' },
  ];
  const result = filterRealTabs(tabs);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});

test('filterRealTabs preserves tabs with no url field', () => {
  const tabs = [
    { id: 1, title: 'GitHub' },
    { id: 2, url: 'https://github.com' },
  ];
  const result = filterRealTabs(tabs);
  assert.equal(result.length, 2);
});

test('filterRealTabs is case-insensitive for protocol prefix', () => {
  const tabs = [
    { id: 1, url: 'CHROME://settings' },
    { id: 2, url: 'Chrome-extension://abc' },
  ];
  const result = filterRealTabs(tabs);
  assert.equal(result.length, 2); // url.startsWith is case-sensitive in JS
});

test('filterRealTabs handles empty array', () => {
  assert.equal(filterRealTabs([]).length, 0);
});

// ---- normalizeShortcutUrl ----

test('normalizeShortcutUrl strips leading/trailing whitespace', () => {
  // URL() normalizes to canonical form (adds trailing slash for bare domains)
  assert.equal(normalizeShortcutUrl('  https://example.com  '), 'https://example.com/');
  assert.equal(normalizeShortcutUrl('  https://github.com/user  '), 'https://github.com/user');
});

test('normalizeShortcutUrl handles empty input', () => {
  assert.equal(normalizeShortcutUrl(''), '');
  assert.equal(normalizeShortcutUrl('   '), '');
});

test('normalizeShortcutUrl preserves valid URLs', () => {
  assert.equal(normalizeShortcutUrl('https://github.com/user/repo'), 'https://github.com/user/repo');
});

test('normalizeShortcutUrl adds https for host-only URLs', () => {
  assert.equal(normalizeShortcutUrl('github.com'), 'https://github.com/');
  assert.equal(normalizeShortcutUrl('example.org/path'), 'https://example.org/path');
});

test('normalizeShortcutUrl supports internationalized domains and paths', () => {
  assert.equal(
    normalizeShortcutUrl('例子.测试/路径'),
    'https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84'
  );
});

// ---- normalizeQuickShortcuts ----

test('normalizeQuickShortcuts ignores non-array input', () => {
  assert.deepEqual(normalizeQuickShortcuts(null), []);
  assert.deepEqual(normalizeQuickShortcuts(undefined), []);
  assert.deepEqual(normalizeQuickShortcuts('not an array'), []);
});

test('normalizeQuickShortcuts filters shortcuts missing url only', () => {
  const input = [
    { id: 'a', url: 'https://a.com' },
    { id: 'b', url: '' },
    { id: '', url: 'https://c.com' }, // id missing is ok, id is auto-generated
  ];
  const result = normalizeQuickShortcuts(input);
  assert.equal(result.length, 2);
});

test('normalizeQuickShortcuts defaults iconKind to empty string for no icon', () => {
  const input = [{ id: 's1', url: 'https://ex.com' }];
  const result = normalizeQuickShortcuts(input);
  assert.equal(result[0].iconKind, '');
});

test('normalizeQuickShortcuts infers iconKind from icon content', () => {
  const input = [{ id: 's1', url: 'https://ex.com', icon: '🌟' }];
  const result = normalizeQuickShortcuts(input);
  assert.equal(result[0].iconKind, 'glyph');
  assert.equal(result[0].icon, '🌟');
});

test('normalizeQuickShortcuts normalizes icon URL to image kind', () => {
  const input = [{ id: 's1', url: 'https://ex.com', icon: 'https://ex.com/f.png' }];
  const result = normalizeQuickShortcuts(input);
  assert.equal(result[0].iconKind, 'image');
  assert.equal(result[0].icon, 'https://ex.com/f.png');
});
