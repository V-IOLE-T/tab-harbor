'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Track calls to chrome.tabs.remove
let removedTabIds = [];
let removeCalls = 0;
let storageData = {};

// Controlled timers: background.js schedules a one-shot post-grace check for
// every created tab. Real setTimeout would keep the test process alive for
// NEW_TAB_GRACE_PERIOD_MS; record callbacks instead so tests can fire them
// deterministically (or leave them pending).
const pendingTimers = new Map(); // id -> { fn, delay }
let nextTimerId = 1;
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
global.setTimeout = (fn, delay) => {
  const id = nextTimerId++;
  pendingTimers.set(id, { fn, delay });
  return id;
};
global.clearTimeout = (id) => {
  pendingTimers.delete(id);
};
// Some tests still need a real macrotask boundary (e.g. awaiting an
// un-awaited cleanup pass). The controlled timer above only records
// callbacks, so a real delay must bypass it.
const scheduleRealMacrotask = () => new Promise(resolve => { realSetTimeout(resolve, 0); });
function firePendingTimers() {
  const snapshot = [...pendingTimers.values()];
  pendingTimers.clear();
  for (const { fn } of snapshot) fn();
}

globalThis.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL: path => `chrome-extension://test-extension-id/${path}`,
  },
  tabs: {
    query: async () => [],
    remove: async ids => {
      removeCalls += 1;
      removedTabIds = removedTabIds.concat(ids);
    },
  },
  storage: {
    local: {
      get: async key => ({ [key]: storageData[key] || {} }),
    },
  },
  action: {
    setBadgeText: async () => {},
  },
  runtime: {
    id: 'test-extension-id',
    getURL: path => `chrome-extension://test-extension-id/${path}`,
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
  },
  tabs: {
    query: async () => [],
    remove: async ids => { removedTabIds = removedTabIds.concat(ids); },
    onCreated: { addListener: (fn) => { globalThis.__tabHarborOnCreated = fn; } },
    onRemoved: { addListener: (fn) => { globalThis.__tabHarborOnRemoved = fn; } },
    onUpdated: { addListener: (fn) => { globalThis.__tabHarborOnUpdated = fn; } },
    onReplaced: { addListener: (fn) => { globalThis.__tabHarborOnReplaced = fn; } },
  },
  action: {
    setBadgeText: async () => {},
  },
  runtime: {
    id: 'test-extension-id',
    getURL: path => `chrome-extension://test-extension-id/${path}`,
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    sendMessage: async () => {},
  },
};

require('./background.js');

const {
  isNewTabBlank,
  closeDuplicateNewTabs,
  runPostGraceReconcileForTest,
  _resetDuplicateCloseGuard,
} = globalThis.TabHarborBackground;

// ─── isNewTabBlank ────────────────────────────────────────────────────────

const EXT_URL = 'chrome-extension://test-extension-id/index.html';
const ROOT_MANIFEST_EXT_URL = 'chrome-extension://test-extension-id/extension/index.html';

test('isNewTabBlank matches chrome://newtab/', () => {
  assert.equal(isNewTabBlank({ url: 'chrome://newtab/' }, EXT_URL), true);
});

test('isNewTabBlank matches edge://newtab/ (Edge maps the overridden new tab there)', () => {
  // On Edge the auto-focus-off tab keeps edge://newtab/ as its URL; the
  // duplicate cleanup must treat it exactly like chrome://newtab/.
  assert.equal(isNewTabBlank({ url: 'edge://newtab/' }, EXT_URL), true);
  assert.equal(isNewTabBlank({ url: undefined, pendingUrl: 'edge://newtab/', status: 'loading' }, EXT_URL), true);
});

test('isNewTabBlank matches extension index.html', () => {
  assert.equal(isNewTabBlank({ url: EXT_URL }, EXT_URL), true);
});

test('isNewTabBlank matches extension page with the focus-redirect query', () => {
  // focus-redirect.js appends ?focus=1 to the new-tab URL; the blank-tab
  // cleanup must still recognize the page.
  assert.equal(isNewTabBlank({ url: `${EXT_URL}?focus=1` }, EXT_URL), true);
  assert.equal(isNewTabBlank({ url: `${ROOT_MANIFEST_EXT_URL}?focus=1` }, [EXT_URL, ROOT_MANIFEST_EXT_URL]), true);
});

test('isNewTabBlank matches extension/index.html from root manifest entry', () => {
  assert.equal(isNewTabBlank({ url: ROOT_MANIFEST_EXT_URL }, [EXT_URL, ROOT_MANIFEST_EXT_URL]), true);
});

test('isNewTabBlank does not match an unknown tab with an empty url', () => {
  // A tab whose url is empty and that carries no pendingUrl is in an unknown
  // state — most likely a restore-batch tab whose navigation has not been
  // reported yet. Closing it on a guess would kill restored tabs, so it is
  // deliberately not treated as a blank new-tab page.
  assert.equal(isNewTabBlank({ url: '' }, EXT_URL), false);
});

test('isNewTabBlank does not match a loading tab with no url and no pendingUrl', () => {
  // Same unknown-state reasoning as the empty-url case: without a pendingUrl
  // there is no evidence about where this tab is heading.
  assert.equal(isNewTabBlank({ url: undefined, status: 'loading' }, EXT_URL), false);
});

test('isNewTabBlank does not match loading restored tab with normal pendingUrl', () => {
  assert.equal(isNewTabBlank({ url: undefined, pendingUrl: 'https://example.com', status: 'loading' }, EXT_URL), false);
});

test('isNewTabBlank matches loading new tab with new-tab pendingUrl', () => {
  assert.equal(isNewTabBlank({ url: undefined, pendingUrl: ROOT_MANIFEST_EXT_URL, status: 'loading' }, [EXT_URL, ROOT_MANIFEST_EXT_URL]), true);
});

test('isNewTabBlank does not match normal url', () => {
  assert.equal(isNewTabBlank({ url: 'https://example.com' }, EXT_URL), false);
});

test('isNewTabBlank does not match loading tab with url', () => {
  assert.equal(isNewTabBlank({ url: 'https://example.com', status: 'loading' }, EXT_URL), false);
});

// ─── closeDuplicateNewTabs ────────────────────────────────────────────────

test('closeDuplicateNewTabs does nothing when feature is disabled', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: false } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: true },
    { id: 2, url: 'chrome://newtab/', active: false },
  ];
  await closeDuplicateNewTabs();
  assert.deepEqual(removedTabIds, []);
});

test('closeDuplicateNewTabs does nothing when preference is missing', async () => {
  storageData = { themePreferences: {} };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: true },
    { id: 2, url: 'chrome://newtab/', active: false },
  ];
  await closeDuplicateNewTabs();
  assert.deepEqual(removedTabIds, []);
});

test('closeDuplicateNewTabs closes duplicate blank tabs when enabled', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: false },
    { id: 2, url: 'chrome://newtab/', active: true },
    { id: 3, url: 'https://example.com', active: false },
  ];
  await closeDuplicateNewTabs();
  assert.deepEqual(removedTabIds, [1]);
});

test('closeDuplicateNewTabs keeps active tab', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 10, url: EXT_URL, active: false },
    { id: 20, url: 'chrome://newtab/', active: true },
    { id: 30, url: 'chrome://newtab/', active: false },
  ];
  await closeDuplicateNewTabs();
  // Should keep id=20 (active), close 10 and 30
  assert.deepEqual(removedTabIds, [10, 30]);
});

test('closeDuplicateNewTabs keeps newest tab when none is active', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 5, url: 'chrome://newtab/', active: false },
    { id: 15, url: 'chrome://newtab/', active: false },
  ];
  await closeDuplicateNewTabs();
  // Should keep id=15 (largest), close id=5
  assert.deepEqual(removedTabIds, [5]);
});

test('closeDuplicateNewTabs does nothing with a single blank tab', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: true },
    { id: 2, url: 'https://example.com', active: false },
  ];
  await closeDuplicateNewTabs();
  assert.deepEqual(removedTabIds, []);
});

test('closeDuplicateNewTabs handles mixed blank tab types', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: false },
    { id: 2, url: EXT_URL, active: true },
    { id: 3, url: ROOT_MANIFEST_EXT_URL, active: false },
  ];
  await closeDuplicateNewTabs();
  // Keep id=2 (active), close 1 and 3
  assert.deepEqual(removedTabIds, [1, 3]);
});

test('closeDuplicateNewTabs treats root manifest new tab pages as blank tabs', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: ROOT_MANIFEST_EXT_URL, active: false },
    { id: 2, url: 'chrome://newtab/', active: true },
  ];
  await closeDuplicateNewTabs();
  assert.deepEqual(removedTabIds, [1]);
});

test('closeDuplicateNewTabs preserves restored tabs while their final URLs are pending', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: true },
    { id: 2, url: undefined, pendingUrl: 'https://example.com/a', status: 'loading', active: false },
    { id: 3, url: undefined, pendingUrl: 'https://example.com/b', status: 'loading', active: false },
  ];
  await closeDuplicateNewTabs();
  assert.deepEqual(removedTabIds, []);
});

test('isNewTabBlank never matches a discarded (sleeping) tab even with an empty url', () => {
  // Session restore discards freshly-created tabs so they start asleep; a
  // discarded tab may carry an empty/uncommitted url. It must not be treated
  // as an accidentally-opened blank new-tab page.
  assert.equal(isNewTabBlank({ url: '', discarded: true }, EXT_URL), false);
  assert.equal(isNewTabBlank({ url: undefined, status: 'loading', discarded: true }, EXT_URL), false);
  assert.equal(isNewTabBlank({ url: 'chrome://newtab/', discarded: true }, EXT_URL), false);
  // A discarded tab committed to a genuine new-tab page is still never closed.
  assert.equal(isNewTabBlank({ url: '', discarded: false }, EXT_URL), false);
  assert.equal(isNewTabBlank({ url: 'chrome://newtab/', discarded: false }, EXT_URL), true);
});

test('closeDuplicateNewTabs never closes discarded (sleeping) tabs', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: true },
    // Restore-created tabs that were discarded right away: asleep on a
    // committed new-tab page, which would otherwise look blank.
    { id: 2, url: 'chrome://newtab/', discarded: true, active: false },
    { id: 3, url: 'chrome://newtab/', discarded: true, active: false },
    { id: 4, url: EXT_URL, status: 'loading', discarded: true, active: false },
  ];
  await closeDuplicateNewTabs();
  // Only the genuine blank new-tab page (id 1, kept active) is in play; the
  // discarded tabs are never closed.
  assert.deepEqual(removedTabIds, []);
});

test('closeDuplicateNewTabs closes an explicit new-tab page beside an older blank even inside the grace window', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  // An explicitly-committed new-tab page is a real new tab: it is not exempt
  // from cleanup the way an uncommitted (empty-url) restore tab is. When the
  // batch registers the new tabs through onCreated and one of them already
  // committed chrome://newtab/, the duplicate blank is closed immediately.
  if (typeof globalThis.__tabHarborOnCreated === 'function') {
    globalThis.__tabHarborOnCreated({ id: 2, url: 'chrome://newtab/' });
    globalThis.__tabHarborOnCreated({ id: 3, url: 'chrome://newtab/' });
  }
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: true },
    { id: 2, url: 'chrome://newtab/', active: false },
    { id: 3, url: 'chrome://newtab/', active: false },
  ];
  await closeDuplicateNewTabs();
  // The onCreated listener armed its own un-awaited cleanup pass; drain the
  // microtask queue so any queued re-entrant pass settles before asserting.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  // chrome.tabs.remove is idempotent for already-closed ids, so a re-entrant
  // pass may re-issue the same removals; assert the set of closed tabs.
  assert.deepEqual([...new Set(removedTabIds)], [2, 3]);
});

test('recently-created tab state is released when a tab is removed or replaced', () => {
  const urls = [EXT_URL, ROOT_MANIFEST_EXT_URL];
  globalThis.__tabHarborOnCreated({ id: 44, url: '' });
  assert.equal(isNewTabBlank({ id: 44, url: '' }, urls), false, 'an uncommitted tab with no pendingUrl is never blank, so onRemoved does not need a grace record');
  globalThis.__tabHarborOnRemoved(44, { windowId: 1, isWindowClosing: false });
  assert.equal(isNewTabBlank({ id: 44, url: '' }, urls), false, 'removal does not change an uncommitted tab: still never blank');

  globalThis.__tabHarborOnCreated({ id: 45, url: '' });
  assert.equal(isNewTabBlank({ id: 45, url: '' }, urls), false);
  globalThis.__tabHarborOnReplaced(46, 45);
  assert.equal(isNewTabBlank({ id: 45, url: '' }, urls), false, 'replacement does not change an uncommitted tab: still never blank');
});

test('closeDuplicateNewTabs never closes a tab Chrome has not described yet', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  // Restore-batch tabs whose navigation has not been reported: empty url and
  // no pendingUrl. Their state is unknown, so closing them on a guess is
  // never acceptable, even outside the creation grace period.
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: true },
    { id: 2, url: '', active: false },
    { id: 3, url: undefined, status: 'loading', active: false },
    { id: 4, url: 'chrome-error://chromewebdata/', active: false },
  ];
  await closeDuplicateNewTabs();
  assert.deepEqual(removedTabIds, []);
});

test('closeDuplicateNewTabs keeps the Tab Harbor page when no blank tab is active', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  // A window whose active tab is a real page: the fallback must keep the
  // dashboard instead of an arbitrary max-id blank new-tab page.
  globalThis.chrome.tabs.query = async () => [
    { id: 100, windowId: 1, url: 'https://example.com/page', active: true },
    { id: 101, windowId: 1, url: 'chrome://newtab/', active: false },
    { id: 130, windowId: 1, url: EXT_URL, active: false },
  ];
  await closeDuplicateNewTabs();
  assert.deepEqual(removedTabIds, [101], 'the dashboard page survives the fallback');
});

test('closeDuplicateNewTabs keeps one blank tab in every window', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    { id: 10, windowId: 1, url: 'chrome://newtab/', active: true },
    { id: 11, windowId: 1, url: 'chrome://newtab/', active: false },
    { id: 20, windowId: 2, url: 'chrome://newtab/', active: true },
  ];

  await closeDuplicateNewTabs();

  assert.deepEqual(removedTabIds, [11], 'the second window keeps its only blank tab instead of being closed');
});

test('an uncommitted freshly-created tab is never closed even after the grace expires (F2)', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  globalThis.chrome.tabs.query = async () => [
    // A single genuine blank tab: nothing to dedupe. The point of this test is
    // that the uncommitted restore tab (id 2, empty url) is never counted as a
    // blank — so it cannot turn a single-blank window into a "duplicate" and
    // cause the genuine blank to be closed. id 4 is a discarded restore tab.
    { id: 1, url: 'chrome://newtab/', active: false },
    { id: 2, url: '', active: true },
    { id: 4, url: '', discarded: true, active: false },
  ];
  // The onCreated listener arms the grace and fires its OWN un-awaited
  // cleanup pass. Drain it with a macrotask boundary before asserting, so no
  // in-flight pass can straddle the later reconciliation.
  globalThis.__tabHarborOnCreated({ id: 2, url: '' });
  await scheduleRealMacrotask();
  await closeDuplicateNewTabs();
  // Tab 2 is an uncommitted restore tab: never treated as blank, so the
  // window holds exactly one blank tab (id 1) and nothing closes.
  assert.deepEqual(removedTabIds, []);
  // Settle the armed post-grace reconciliation (test seam): registry is
  // cleared to simulate the grace having elapsed, then cleanup re-runs.
  await globalThis.TabHarborBackground.runPostGraceReconcileForTest();
  // Still the only blank tab; the uncommitted restore tab and the discarded
  // tab never count as blanks, so nothing is closed.
  assert.deepEqual(removedTabIds, []);
});

// ─── Grace-expiry re-check + onUpdated/onRemoved cleanup ─────────────────────

test('Ctrl+T new-tab page with an explicit URL closes the older duplicate immediately', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  // Existing Tab Harbor page in another tab; user Ctrl+T's a new one on top.
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: EXT_URL, active: false },
    { id: 2, url: 'chrome://newtab/', active: true }, // fresh, in grace
  ];
  // Simulate the onCreated hook firing for the new tab (records grace start +
  // schedules the expiry check).
  if (typeof globalThis.__tabHarborOnCreated === 'function') {
    globalThis.__tabHarborOnCreated({ id: 2, url: '' });
  }
  // A Ctrl+T'd new-tab page with an explicit new-tab URL is not exempt from
  // cleanup: the duplicate is closed immediately, not after the grace window.
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: EXT_URL, active: false },
    { id: 2, url: 'chrome://newtab/', active: true },
  ];
  // onCreated already triggered an async check; let it settle.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  // Drain any pending grace-expiry timer so it cannot leak into later tests.
  firePendingTimers();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  // The active new tab (2) is kept; the older duplicate page (1) closes.
  // chrome.tabs.remove is idempotent for already-closed ids, so repeated
  // removals of the same tab are harmless; assert the set of closed tabs.
  assert.deepEqual([...new Set(removedTabIds)], [1]);
});

test('onRemoved clears a created tab from bookkeeping so it is not double-checked', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  if (typeof globalThis.__tabHarborOnCreated === 'function') {
    // Simulate a tab that is created then quickly closed; firing its newly
    // pending grace expiry must not throw or close anything.
    globalThis.__tabHarborOnCreated({ id: 9, url: '' });
  }
  if (typeof globalThis.__tabHarborOnRemoved === 'function') {
    globalThis.__tabHarborOnRemoved(9);
  }
  firePendingTimers();
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: true },
  ];
  await closeDuplicateNewTabs();
  assert.deepEqual(removedTabIds, []);
});

test('onUpdated with a committed new-tab URL triggers the duplicate check', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  // Scenario: one Tab Harbor page exists; a new tab is created but its URL is
  // still empty (uncommitted). At onCreated the cleanup sees only the old page
  // (single blank) and does nothing.
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: EXT_URL, active: true },
    { id: 2, url: '', active: false },
  ];
  if (typeof globalThis.__tabHarborOnCreated === 'function') {
    globalThis.__tabHarborOnCreated({ id: 2, url: '' });
  }
  await closeDuplicateNewTabs();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  // The uncommitted tab 2 (empty url) is still in its grace window → the
  // cleanup keeps the only committed blank page and closes nothing.
  assert.deepEqual(removedTabIds, []);
  // Now the tab commits an explicit new-tab URL: it is a real new tab, so the
  // onUpdated hook re-runs the cleanup, which closes the older duplicate.
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: EXT_URL, active: false },
    { id: 2, url: 'chrome://newtab/', active: true },
  ];
  if (typeof globalThis.__tabHarborOnUpdated === 'function') {
    globalThis.__tabHarborOnUpdated(2, { url: 'chrome://newtab/' });
  }
  // Let the async check settle.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  // Drain any pending grace-expiry timer so it cannot leak into later tests.
  firePendingTimers();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  // The active new tab (2) is kept; the older duplicate page (1) closes.
  assert.deepEqual([...new Set(removedTabIds)], [1]);
});

test('concurrent duplicate-cleanup passes issue a single chrome.tabs.remove call (re-entrancy guard)', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  removeCalls = 0;
  _resetDuplicateCloseGuard();
  // A stateful tab mock: after chrome.tabs.remove runs, the removed tab is gone
  // from the next query, as in the real browser. Two duplicate blanks in the
  // same window. The re-entrancy guard must coalesce concurrent passes: the
  // second call is queued and, when it re-runs after the first, sees the tabs
  // already removed and closes nothing -> exactly one remove call. If the guard
  // were dropped, both passes would run in parallel against the pre-removal
  // state and issue two chrome.tabs.remove calls for the same id.
  let liveTabs = [
    { id: 1, url: 'chrome://newtab/', active: true },
    { id: 2, url: 'chrome://newtab/', active: false },
  ];
  globalThis.chrome.tabs.query = async () => liveTabs;
  globalThis.chrome.tabs.remove = async ids => {
    removeCalls += 1;
    removedTabIds = removedTabIds.concat(ids);
    liveTabs = liveTabs.filter(t => !ids.includes(t.id));
  };
  await Promise.all([closeDuplicateNewTabs(), closeDuplicateNewTabs()]);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(removeCalls, 1, 'the re-entrancy guard coalesces concurrent passes into one remove call');
  assert.deepEqual([...new Set(removedTabIds)], [2], 'the active blank (1) is kept, the duplicate (2) closes');
});

test('onUpdated with a committed new-tab URL closes the duplicate without relying on the grace timer', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  removeCalls = 0;
  _resetDuplicateCloseGuard();
  // One Tab Harbor page plus a freshly-created tab that has not committed.
  // onCreated records the new tab and schedules a grace timer, but the test
  // deliberately never fires that timer: only the onUpdated URL-commit re-check
  // can close the older duplicate. If the onUpdated trigger were removed, the
  // duplicate would stay open and this assertion fails.
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: EXT_URL, active: false },
    { id: 2, url: '', active: true },
  ];
  if (typeof globalThis.__tabHarborOnCreated === 'function') {
    globalThis.__tabHarborOnCreated({ id: 2, url: '' });
  }
  await closeDuplicateNewTabs();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  // Uncommitted tab 2 is shielded; nothing closes yet.
  assert.deepEqual(removedTabIds, []);
  // Tab 2 commits an explicit new-tab URL. The onUpdated hook is the ONLY
  // trigger that can close the older page now (the grace timer is never fired).
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: EXT_URL, active: false },
    { id: 2, url: 'chrome://newtab/', active: true },
  ];
  if (typeof globalThis.__tabHarborOnUpdated === 'function') {
    globalThis.__tabHarborOnUpdated(2, { url: 'chrome://newtab/' });
  }
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.deepEqual([...new Set(removedTabIds)], [1], 'the onUpdated URL-commit re-check closes the older duplicate');
  // Drain any pending grace timer so it cannot leak into later tests.
  firePendingTimers();
  for (let i = 0; i < 8; i++) await Promise.resolve();
});

test('removing a freshly-created tab clears its grace bookkeeping and timer', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  removeCalls = 0;
  _resetDuplicateCloseGuard();
  // Drain any timers left over from earlier tests so the count is exact.
  firePendingTimers();
  const baseline = pendingTimers.size;
  if (typeof globalThis.__tabHarborOnCreated === 'function') {
    globalThis.__tabHarborOnCreated({ id: 9, url: '' });
  }
  // onCreated records the tab and schedules its grace-expiry timer (plus the
  // shared post-grace reconcile). The per-tab timer is the observable surface
  // for the bookkeeping cleanup.
  assert.ok(pendingTimers.size > baseline, 'onCreated schedules a grace timer for the new tab');
  const withTab = pendingTimers.size;
  if (typeof globalThis.__tabHarborOnRemoved === 'function') {
    globalThis.__tabHarborOnRemoved(9);
  }
  // onRemoved must clear exactly the removed tab's grace timer. If the
  // bookkeeping cleanup were removed, its timer would stay pending and fire a
  // stale cleanup pass later. The shared post-grace reconcile timer is not
  // owned by any single tab, so it stays; assert the per-tab timer is gone.
  assert.equal(pendingTimers.size, withTab - 1, 'onRemoved clears the grace timer for the removed tab');
  // A single genuine blank remains; firing any (nonexistent) stale timer must
  // not close anything.
  globalThis.chrome.tabs.query = async () => [
    { id: 1, url: 'chrome://newtab/', active: true },
  ];
  firePendingTimers();
  await closeDuplicateNewTabs();
  assert.deepEqual(removedTabIds, []);
});

test('closeDuplicateNewTabs keeps a ?focus=1 dashboard over a genuinely blank new-tab page', async () => {
  storageData = { themePreferences: { closeDuplicateNewTabsEnabled: true } };
  removedTabIds = [];
  removeCalls = 0;
  _resetDuplicateCloseGuard();
  // focus-redirect.js appends ?focus=1 to every production dashboard URL. The
  // keep-dashboard fallback must recognize the normalized URL and preserve the
  // dashboard even when it is not active and sits next to a genuinely blank
  // new-tab page. Regression for F1: before the fix this closed the dashboard.
  globalThis.chrome.tabs.query = async () => [
    { id: 100, url: 'https://example.com/page', active: true },
    { id: 101, url: `${EXT_URL}?focus=1`, active: false },
    { id: 130, url: 'chrome://newtab/', active: false },
  ];
  await closeDuplicateNewTabs();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.ok(!removedTabIds.includes(101), 'the ?focus=1 dashboard is preserved');
  assert.deepEqual(removedTabIds, [130], 'the genuinely blank new-tab page is closed instead');
});
