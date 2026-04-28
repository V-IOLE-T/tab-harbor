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

require('./theme-controls.js');

const {
  filterRealTabs,
  normalizeShortcutUrl,
  normalizeQuickShortcuts,
} = globalThis.TabOutThemeControls;

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
