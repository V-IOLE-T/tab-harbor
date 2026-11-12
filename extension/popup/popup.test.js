'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Mock chrome APIs used at module load time (initializePopup runs on require)
globalThis.chrome = {
  tabs: { query: async () => [] },
  tabGroups: { query: async () => [] },
  storage: {
    local: { get: async () => ({}) },
    session: { get: async () => ({}) },
  },
};

// Mock DOM globals before requiring popup.js
let rafCallbacks = [];
globalThis.requestAnimationFrame = fn => {
  const id = Math.random();
  rafCallbacks.push({ id, fn });
  return id;
};
globalThis.flushRaf = () => {
  const snapshot = [...rafCallbacks];
  rafCallbacks = [];
  snapshot.forEach(({ fn }) => fn());
};

// popup.js resolves the remembered view synchronously from localStorage at
// module load — mock it so the require-time read is safe and predictable.
globalThis.localStorage = {
  _store: {},
  getItem: key => (key in globalThis.localStorage._store ? globalThis.localStorage._store[key] : null),
  setItem: (key, value) => { globalThis.localStorage._store[key] = String(value); },
  removeItem: key => { delete globalThis.localStorage._store[key]; },
};

globalThis.document = {
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {} }),
  getElementById: () => null,
};
globalThis.window = { close: () => {} };

// Mock popup.js dependencies (empty — functions should fall back safely)
globalThis.TabOutThemeControls = { filterRealTabs: tabs => Array.isArray(tabs) ? tabs : [] };
globalThis.TabOutIconUtils = {
  escapeHtmlAttribute: v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  getIconSources: () => ({ sources: [], hostname: '' }),
  getFallbackLabel: (label, host) => (label || host || '').slice(0, 1).toUpperCase() || '?',
  getGroupIcon: () => ({ src: '', fallbackLabel: '?' }),
};
globalThis.TabOutListOrder = {
  reorderSubsetByIds: (items, orderIds, includeItem) => {
    if (!Array.isArray(items)) return [];
    const list = items.slice();
    const shouldInclude = typeof includeItem === 'function' ? includeItem : () => true;
    const subset = list.filter(shouldInclude);
    const normalizedOrder = Array.isArray(orderIds) ? orderIds.map(id => String(id)).filter(Boolean) : [];
    if (!subset.length || subset.length !== normalizedOrder.length) return list;
    const subsetMap = new Map(subset.map(item => [String(item.id), item]));
    if (subsetMap.size !== subset.length) return list;
    if (normalizedOrder.some(id => !subsetMap.has(id))) return list;
    let nextIndex = 0;
    return list.map(item => {
      if (!shouldInclude(item)) return item;
      const reorderedItem = subsetMap.get(normalizedOrder[nextIndex]);
      nextIndex += 1;
      return reorderedItem || item;
    });
  },
};
globalThis.TabOutSessionGroups = { normalizeSessionGroups: v => v || { groups: [], assignments: {} } };
globalThis.TabOutGroupOrder = { normalizeGroupOrderState: v => v || { sessionOrder: [], pinnedOrder: [], pinEnabled: false } };
globalThis.TabHarborI18n = { t: key => key };

// Use the real ui-helpers.js implementations instead of inline mocks
require('../ui-helpers.js');

// Prevent LOCAL_* globals from interfering
globalThis.LOCAL_LANDING_PAGE_PATTERNS = undefined;
globalThis.LOCAL_CUSTOM_GROUPS = undefined;

require('./popup.js');

const {
  escapeAttr,
  getTabLabel,
  isLandingPage,
  matchCustomGroup,
  getGroupDisplayLabel,
  buildPopupTabGroups,
  popupState,
  renderShortcutCard,
  renderTabGroup,
  renderGroupNav,
} = globalThis;

function resetPopupTestState(opts = {}) {
  globalThis.LOCAL_CUSTOM_GROUPS = opts.customGroups ?? [];
  globalThis.LOCAL_LANDING_PAGE_PATTERNS = opts.landingPatterns ?? undefined;
  // Mutate existing objects rather than replacing them — popup.js holds
  // local references captured at module-load time (popupSessionGroups, popupGroupOrder).
  globalThis.TabOutSessionGroups.normalizeSessionGroups = () => (opts.sessionGroups ?? { groups: [], assignments: {} });
  globalThis.TabOutGroupOrder.applyGroupOrder = (list) => list;
  globalThis.TabOutGroupOrder.normalizeGroupOrderState = () => (opts.groupOrder ?? { sessionOrder: [], pinnedOrder: [], pinEnabled: false });
  if (typeof globalThis._resetPopupState === 'function') {
    globalThis._resetPopupState();
  }
}

// ---- popup view persistence ----

test('loadPopupView restores the saved tabs view', async () => {
  resetPopupTestState();
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async key => (key === 'popupView' ? { popupView: 'tabs' } : {});
  try {
    const view = await loadPopupView();
    assert.equal(view, 'tabs');
    assert.equal(popupState.view, 'tabs');
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
  }
});

test('loadPopupView falls back to shortcuts for missing or invalid values', async () => {
  resetPopupTestState();
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({});
  try {
    assert.equal(await loadPopupView(), 'shortcuts');
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
  }
  globalThis.chrome.storage.local.get = async key => (key === 'popupView' ? { popupView: 'garbage' } : {});
  try {
    assert.equal(await loadPopupView(), 'shortcuts');
    assert.equal(popupState.view, 'shortcuts');
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
  }
});

test('refreshing popup state preserves the live view instead of resetting it', async () => {
  resetPopupTestState();
  popupState.view = 'tabs';
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({ popupView: 'shortcuts' });
  try {
    await loadPopupState();
    assert.equal(popupState.view, 'tabs');
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
  }
});

test('loadPopupState unwraps suspended tabs to their original URL', async () => {
  resetPopupTestState();
  const originalGet = globalThis.chrome.storage.local.get;
  const originalUtils = globalThis.TabHarborTabUrlUtils;
  globalThis.chrome.storage.local.get = async () => ({});
  globalThis.TabHarborTabUrlUtils = {
    parseSuspendedTabUrl: url => {
      const raw = String(url || '');
      const uri = raw.includes('#uri=') ? decodeURIComponent(raw.split('#uri=')[1].split('&')[0]) : '';
      return raw.includes('/suspended.html') && uri ? { isSuspended: true, originalUrl: uri, title: 'Suspended title' } : { isSuspended: false, originalUrl: '', title: '' };
    },
    getCanonicalTabUrl: url => {
      const raw = String(url || '');
      const uri = raw.includes('#uri=') ? decodeURIComponent(raw.split('#uri=')[1].split('&')[0]) : '';
      return raw.includes('/suspended.html') && uri ? uri : raw;
    },
  };
  try {
    globalThis.chrome.tabs.query = async () => [
      { id: 1, url: 'chrome-extension://suspender/suspended.html#uri=https%3A%2F%2Fgithub.com%2Fissue%2F42', title: 'Suspended tab', windowId: 1, active: false },
      { id: 2, url: '', title: 'Loading', windowId: 1, active: false },
    ];
    await loadPopupState();
    const urls = popupState.openTabs.map(t => t.url);
    assert.ok(urls.includes('https://github.com/issue/42'), 'suspended tab unwraps to its original URL');
    assert.equal(popupState.openTabs.find(t => t.id === 1).title, 'Suspended title', 'suspended title is used');
    assert.ok(urls.includes(''), 'mid-load tab with empty URL stays visible');
  } finally {
    globalThis.chrome.tabs.query = async () => [];
    globalThis.chrome.storage.local.get = originalGet;
    globalThis.TabHarborTabUrlUtils = originalUtils;
  }
});

// ---- popup shortcuts column setting ----

test('renderPopupShortcuts applies the dashboard column setting to the grid', async () => {
  resetPopupTestState();
  const originalGetById = globalThis.document.getElementById;
  const originalGetCols = globalThis.TabOutThemeControls.getQuickShortcutCols;
  const toggles = {};
  const listEl = {
    classList: { add: () => {}, remove: () => {}, toggle: (cls, on) => { toggles[cls] = on; } },
    innerHTML: '',
    querySelectorAll: () => [],
  };
  const emptyEl = { hidden: true };
  globalThis.document.getElementById = id => (id === 'popupShortcutsList' ? listEl : id === 'popupShortcutsEmpty' ? emptyEl : null);
  try {
    globalThis.TabOutThemeControls.getQuickShortcutCols = () => '4';
    popupState.quickShortcuts = [{ id: 'a', url: 'https://a.com', label: 'A' }];
    renderPopupShortcuts();
    assert.equal(toggles['is-fixed-cols-4'], true);
    assert.equal(toggles['is-fixed-cols-5'], false);

    globalThis.TabOutThemeControls.getQuickShortcutCols = () => '5';
    renderPopupShortcuts();
    assert.equal(toggles['is-fixed-cols-4'], false);
    assert.equal(toggles['is-fixed-cols-5'], true);
  } finally {
    globalThis.document.getElementById = originalGetById;
    globalThis.TabOutThemeControls.getQuickShortcutCols = originalGetCols;
  }
});

test('renderPopupShortcuts falls back to auto when the setting getter is missing', async () => {
  resetPopupTestState();
  const originalGetById = globalThis.document.getElementById;
  const toggles = {};
  const listEl = {
    classList: { add: () => {}, remove: () => {}, toggle: (cls, on) => { toggles[cls] = on; } },
    innerHTML: '',
    querySelectorAll: () => [],
  };
  globalThis.document.getElementById = id => (id === 'popupShortcutsList' ? listEl : id === 'popupShortcutsEmpty' ? { hidden: true } : null);
  try {
    delete globalThis.TabOutThemeControls.getQuickShortcutCols;
    popupState.quickShortcuts = [];
    renderPopupShortcuts();
    assert.equal(toggles['is-fixed-cols-4'], false);
    assert.equal(toggles['is-fixed-cols-5'], false);
  } finally {
    globalThis.document.getElementById = originalGetById;
  }
});

test('renderPopupShortcuts skips re-render when shortcuts and columns are unchanged', async () => {
  resetPopupTestState();
  const originalGetById = globalThis.document.getElementById;
  const originalGetCols = globalThis.TabOutThemeControls.getQuickShortcutCols;
  const listEl = {
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    innerHTML: '',
    querySelectorAll: () => [],
  };
  globalThis.document.getElementById = id => (id === 'popupShortcutsList' ? listEl : id === 'popupShortcutsEmpty' ? { hidden: true } : null);
  globalThis.TabOutThemeControls.getQuickShortcutCols = () => 'auto';
  try {
    popupState.quickShortcuts = [{ id: 'a', url: 'https://a.com', label: 'A' }];
    renderPopupShortcuts();
    listEl.innerHTML = 'DIRTY';
    // Unchanged data + columns -> the render is skipped, DOM is preserved.
    renderPopupShortcuts();
    assert.equal(listEl.innerHTML, 'DIRTY');
    // Changed shortcuts -> the render runs again.
    popupState.quickShortcuts = [
      { id: 'a', url: 'https://a.com', label: 'A' },
      { id: 'b', url: 'https://b.com', label: 'B' },
    ];
    renderPopupShortcuts();
    assert.notEqual(listEl.innerHTML, 'DIRTY');
  } finally {
    globalThis.document.getElementById = originalGetById;
    globalThis.TabOutThemeControls.getQuickShortcutCols = originalGetCols;
  }
});

// ---- escapeAttr ----

test('escapeAttr escapes & < > "', () => {
  assert.equal(escapeAttr('A & B < C > D "quote"'), 'A &amp; B &lt; C &gt; D &quot;quote&quot;');
});

test('escapeAttr handles empty string', () => {
  assert.equal(escapeAttr(''), '');
});

test('escapeAttr handles non-string input', () => {
  assert.equal(escapeAttr(123), '123');
  assert.equal(escapeAttr(null), 'null');
});

// ---- getTabLabel ----

test('getTabLabel returns stripped title when suffix matches domain', () => {
  const tab = { title: 'My Page - example.com', url: 'https://www.example.com/page' };
  assert.equal(getTabLabel(tab), 'My Page');
});

test('getTabLabel strips suffix after | when it matches friendly domain', () => {
  // friendlyDomain('www.example.com') → 'Example' (strips TLD, capitalizes)
  const tab = { title: 'Dashboard | Example', url: 'https://www.example.com' };
  assert.equal(getTabLabel(tab), 'Dashboard');
});

test('getTabLabel strips suffix after — when it matches domain without TLD', () => {
  const tab = { title: 'Welcome — example', url: 'https://example.com/home' };
  assert.equal(getTabLabel(tab), 'Welcome');
});

test('getTabLabel keeps title unchanged when suffix does not match domain', () => {
  const tab = { title: 'GitHub - awesome-org/awesome-repo', url: 'https://github.com' };
  assert.equal(getTabLabel(tab), 'GitHub - awesome-org/awesome-repo');
});

test('getTabLabel uses URL as title when original title is empty', () => {
  const tab = { title: '', url: 'https://www.example.com/path' };
  assert.equal(getTabLabel(tab), 'https://www.example.com/path');
});

test('getTabLabel returns chrome:// URL when title is empty and URL is unparseable', () => {
  const tab = { title: '', url: 'chrome://newtab' };
  assert.equal(getTabLabel(tab), 'chrome://newtab');
});

test('getTabLabel falls back to "Tab" for missing title and url', () => {
  assert.equal(getTabLabel({}), 'Tab');
  assert.equal(getTabLabel({ title: '' }), 'Tab');
});

test('getTabLabel uses URL when title empty with www URL', () => {
  const tab = { title: '', url: 'https://www.google.com/search' };
  assert.equal(getTabLabel(tab), 'https://www.google.com/search');
});

// ---- isLandingPage ----

test('isLandingPage filters out Gmail inbox/sent/search URLs by hash', () => {
  // base URL has no hash — passes
  assert.equal(isLandingPage('https://mail.google.com/mail/u/0/'), true);
  // URL contains #inbox/ — filtered by hash check
  assert.equal(isLandingPage('https://mail.google.com/mail/u/0/#inbox/'), false);
  // URL contains #sent/ — filtered by hash check
  assert.equal(isLandingPage('https://mail.google.com/mail/u/0/#sent/'), false);
});

test('isLandingPage matches x.com home timeline', () => {
  assert.equal(isLandingPage('https://x.com/home'), true);
  assert.equal(isLandingPage('https://x.com/explore'), false);
});

test('isLandingPage matches GitHub root', () => {
  assert.equal(isLandingPage('https://github.com/'), true);
  assert.equal(isLandingPage('https://github.com/user/repo'), false);
});

test('isLandingPage matches LinkedIn root', () => {
  assert.equal(isLandingPage('https://www.linkedin.com/'), true);
  assert.equal(isLandingPage('https://www.linkedin.com/feed/'), false);
});

test('isLandingPage matches YouTube root', () => {
  assert.equal(isLandingPage('https://www.youtube.com/'), true);
  assert.equal(isLandingPage('https://www.youtube.com/watch?v=abc'), false);
});

test('isLandingPage returns false for non-landing URLs', () => {
  assert.equal(isLandingPage('https://github.com/notifications'), false);
  assert.equal(isLandingPage('https://example.com/page'), false);
});

test('isLandingPage handles invalid URLs gracefully', () => {
  assert.equal(isLandingPage(''), false);
  assert.equal(isLandingPage('not-a-url'), false);
});

// ---- matchCustomGroup ----

test('matchCustomGroup matches exact hostname and returns the rule object', () => {
  resetPopupTestState({
    customGroups: [
      { hostname: 'github.com', pathPrefix: null, groupKey: 'gh', groupLabel: 'GitHub' },
    ],
  });
  const result = matchCustomGroup('https://github.com/user');
  assert.equal(typeof result, 'object', 'should return rule object');
  assert.equal(result.hostname, 'github.com');
  assert.ok(matchCustomGroup('https://github.com/notifications') !== null);
  assert.notEqual(matchCustomGroup('https://github.com/' + 'a'.repeat(100)), null);
  assert.equal(matchCustomGroup('https://gitlab.com/'), null);
});

test('matchCustomGroup matches hostnameEndsWith', () => {
  resetPopupTestState({
    customGroups: [
      { hostname: null, hostnameEndsWith: '.notion.site', pathPrefix: null, groupKey: 'notion', groupLabel: 'Notion' },
    ],
  });
  assert.ok(matchCustomGroup('https://myworkspace.notion.site/') !== null, 'should match .notion.site');
  assert.ok(matchCustomGroup('https://github.com/') === null, 'should not match github.com');
});

test('matchCustomGroup matches pathPrefix when specified', () => {
  resetPopupTestState({
    customGroups: [
      { hostname: 'github.com', pathPrefix: '/orgs/', groupKey: 'gh-org', groupLabel: 'GitHub Orgs' },
    ],
  });
  const result = matchCustomGroup('https://github.com/orgs/team');
  assert.ok(result !== null, 'should match /orgs/ path');
  assert.equal(result.hostname, 'github.com');
  assert.equal(matchCustomGroup('https://github.com/user/repo'), null, 'should not match user path');
});

test('matchCustomGroup returns null for empty groups', () => {
  resetPopupTestState();
  assert.equal(matchCustomGroup('https://github.com/'), null);
});

test('matchCustomGroup handles invalid URLs gracefully', () => {
  resetPopupTestState();
  assert.equal(matchCustomGroup(''), null);
  assert.equal(matchCustomGroup('://invalid'), null);
});

// ---- getGroupDisplayLabel ----

test('getGroupDisplayLabel returns translated labels for special kinds', () => {
  globalThis.TabHarborI18n = { t: key => ({ homepagesLabel: 'Homepages', ungroupedLabel: 'Ungrouped' }[key] || key) };
  assert.equal(getGroupDisplayLabel({ kind: 'landing', domain: '__landing-pages__' }), 'Homepages');
  assert.equal(getGroupDisplayLabel({ kind: 'ungrouped', domain: '__ungrouped__' }), 'Ungrouped');
});

test('getGroupDisplayLabel returns group name for session kind', () => {
  assert.equal(getGroupDisplayLabel({ kind: 'session', label: 'Work Tabs' }), 'Work Tabs');
});

test('getGroupDisplayLabel falls back to friendlyDomain for domain kind', () => {
  assert.equal(getGroupDisplayLabel({ kind: 'domain', domain: 'www.google.com' }), 'Google');
  assert.equal(getGroupDisplayLabel({ kind: 'custom', domain: 'github.com' }), 'GitHub');
});

test('getGroupDisplayLabel uses label for chrome-group kind', () => {
  assert.equal(getGroupDisplayLabel({ kind: 'chrome-group', label: 'Research', domain: '__chrome_group__:1' }), 'Research');
});

test('getGroupDisplayLabel handles missing i18n by returning key', () => {
  globalThis.TabHarborI18n = {};
  globalThis.TabOutGroupOrder.normalizeGroupOrderState = () => ({});
  assert.equal(getGroupDisplayLabel({ kind: 'ungrouped', domain: '__ungrouped__' }), 'ungroupedLabel');
});

// ---- buildPopupTabGroups integration ----

test('buildPopupTabGroups is exposed globally', () => {
  assert.equal(typeof globalThis.buildPopupTabGroups, 'function');
});

test('buildPopupTabGroups groups session-assigned tabs', () => {
  resetPopupTestState({ landingPatterns: [] });
  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://github.com', title: 'GitHub', windowId: 1, active: false, groupId: null },
  ];
  globalThis.popupState.sessionGroups = {
    groups: [{ id: 's1', name: 'Work' }],
    assignments: { '1': 's1' },
  };

  const groups = globalThis.buildPopupTabGroups();
  const sessionGroup = groups.find(g => g.kind === 'session');
  assert.ok(sessionGroup, 'session group should exist');
  assert.equal(sessionGroup.tabs.length, 1);
  assert.equal(sessionGroup.tabs[0].id, 1);
});

test('buildPopupTabGroups keeps an unmanaged native Chrome group intact before URL grouping', () => {
  resetPopupTestState({ landingPatterns: [] });
  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://github.com/issues', title: 'Issues', windowId: 1, index: 4, active: false, groupId: 55 },
    { id: 2, url: 'https://docs.example.com/guide', title: 'Guide', windowId: 1, index: 2, active: false, groupId: 55 },
    { id: 3, url: 'https://github.com/pulls', title: 'Pulls', windowId: 1, index: 5, active: false, groupId: 66 },
  ];
  globalThis.popupState.chromeGroupsById = {
    55: { id: 55, title: 'Research', color: 'blue', windowId: 1 },
    66: { id: 66, title: 'Managed mirror', color: 'grey', windowId: 1 },
  };
  globalThis.popupState.managedChromeGroupIds = new Set([66]);

  const groups = globalThis.buildPopupTabGroups();
  const nativeGroup = groups.find(group => group.kind === 'chrome-group');
  assert.deepEqual(nativeGroup && {
    domain: nativeGroup.domain,
    label: nativeGroup.label,
    color: nativeGroup.chromeGroupColor,
    tabIds: nativeGroup.tabs.map(tab => tab.id),
  }, {
    domain: '__chrome_group__:55',
    label: 'Research',
    color: 'blue',
    tabIds: [2, 1],
  });
  assert.equal(groups.filter(group => group.kind === 'chrome-group').length, 1, 'managed mirrors do not masquerade as user groups');
  assert.ok(groups.some(group => group.domain === 'github.com'), 'managed mirror continues through normal domain grouping');
});

test('buildPopupTabGroups orders session groups by createdAt like the dashboard', () => {
  resetPopupTestState({ landingPatterns: [] });
  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://a.com', title: 'A', windowId: 1, active: false, groupId: null },
    { id: 2, url: 'https://b.com', title: 'B', windowId: 1, active: false, groupId: null },
  ];
  globalThis.popupState.sessionGroups = {
    // Listed newest-first on purpose: only the createdAt sort (not insertion
    // order) can produce the expected [older, newer] output.
    groups: [
      { id: 'newer', name: 'Newer', createdAt: '2026-02-01T00:00:00.000Z' },
      { id: 'older', name: 'Older', createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    assignments: { '1': 'newer', '2': 'older' },
  };

  const groups = globalThis.buildPopupTabGroups();
  const sessionGroupsOrdered = groups.filter(g => g.kind === 'session');
  assert.equal(sessionGroupsOrdered.length, 2, 'both session groups present');
  assert.equal(sessionGroupsOrdered[0].manualGroupId, 'older', 'oldest session group comes first');
  assert.equal(sessionGroupsOrdered[1].manualGroupId, 'newer', 'newest session group comes second');
});

test('buildPopupTabGroups groups domain tabs', () => {
  resetPopupTestState();

  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://github.com/user', title: 'GitHub', windowId: 1, active: false, groupId: null },
    { id: 2, url: 'https://github.com/org/team', title: 'Team', windowId: 1, active: false, groupId: null },
    { id: 3, url: 'https://google.com/search', title: 'Search', windowId: 1, active: false, groupId: null },
  ];

  const groups = globalThis.buildPopupTabGroups();
  const ghGroup = groups.find(g => g.domain === 'github.com');
  assert.ok(ghGroup, 'github.com group should exist');
  assert.equal(ghGroup.tabs.length, 2);
  const googleGroup = groups.find(g => g.domain === 'google.com');
  assert.ok(googleGroup, 'google.com group should exist');
  assert.equal(googleGroup.tabs.length, 1);
});

test('buildPopupTabGroups places landing pages group at top', () => {
  resetPopupTestState();

  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://github.com/', title: 'GitHub', windowId: 1, active: false, groupId: null },
    { id: 2, url: 'https://www.youtube.com/', title: 'YouTube', windowId: 1, active: false, groupId: null },
  ];

  const groups = globalThis.buildPopupTabGroups();
  assert.equal(groups[0].kind, 'landing', 'landing group should be first');
  assert.equal(groups[0].tabs.length, 2);
});

test('buildPopupTabGroups groups file:// URLs under local-files domain', () => {
  resetPopupTestState();

  globalThis.popupState.openTabs = [
    { id: 1, url: 'file:///path/to/file', title: 'Local File', windowId: 1, active: false, groupId: null },
  ];

  const groups = globalThis.buildPopupTabGroups();
  const localGroup = groups.find(g => g.domain === 'local-files');
  assert.ok(localGroup, 'local-files group should exist');
  assert.equal(localGroup.tabs.length, 1);
  assert.equal(localGroup.tabs[0].id, 1);
});

test('buildPopupTabGroups keeps tabs with unparseable URLs in an ungrouped bucket', () => {
  globalThis._skipLoadPopupState = true;
  resetPopupTestState();

  // Tabs with empty URLs can't be parsed — they stay visible in an ungrouped bucket.
  const tabA = { id: 1, url: '', title: 'Tab A', windowId: 1, active: false, groupId: 10 };
  const tabB = { id: 2, url: '', title: 'Tab B', windowId: 1, active: false, groupId: 10 };
  globalThis.popupState.openTabs = [tabA, tabB];

  const groups = globalThis.buildPopupTabGroups();
  assert.equal(groups.length, 1, 'unparseable tabs form a single ungrouped bucket');
  assert.equal(groups[0].kind, 'ungrouped');
  assert.equal(groups[0].tabs.length, 2);
});

test('buildPopupTabGroups groups by primary domain so www and bare variants merge', () => {
  globalThis._skipLoadPopupState = true;
  resetPopupTestState();

  const originalPrimaryDomain = globalThis.TabOutIconUtils.getPrimaryDomain;
  globalThis.TabOutIconUtils.getPrimaryDomain = hostname => String(hostname || '').replace(/^www\./, '').toLowerCase();
  try {
    globalThis.popupState.openTabs = [
      { id: 1, url: 'https://www.github.com/a', title: 'A', windowId: 1, active: false },
      { id: 2, url: 'https://github.com/b', title: 'B', windowId: 1, active: false },
    ];

    const groups = globalThis.buildPopupTabGroups();
    assert.equal(groups.length, 1, 'www and bare variants share one group');
    assert.equal(groups[0].domain, 'github.com');
    assert.equal(groups[0].tabs.length, 2);
  } finally {
    globalThis.TabOutIconUtils.getPrimaryDomain = originalPrimaryDomain;
  }
});

test('getGroupDisplayLabel honors persisted group label overrides', () => {
  globalThis._skipLoadPopupState = true;
  resetPopupTestState();

  globalThis.popupState.groupLabelOverrides = { 'github.com': '工作代码', '__landing-pages__': '主页' };
  const domainGroup = { domain: 'github.com', label: '', tabs: [], kind: 'domain' };
  const landingGroup = { domain: '__landing-pages__', label: '__landing-pages__', tabs: [], kind: 'landing' };
  assert.equal(globalThis.getGroupDisplayLabel(domainGroup), '工作代码');
  assert.equal(globalThis.getGroupDisplayLabel(landingGroup), '主页');
});

test('getGroupDisplayLabel prefers the custom group label over the derived domain', () => {
  globalThis._skipLoadPopupState = true;
  resetPopupTestState();

  const group = { domain: 'gh-org', label: 'GitHub Orgs', tabs: [], kind: 'custom' };
  assert.equal(globalThis.getGroupDisplayLabel(group), 'GitHub Orgs');
});

test('renderPopupTabs updates content without replaying the entry animation', () => {
  globalThis._skipLoadPopupState = true;
  resetPopupTestState();

  const classes = { nav: new Set(), list: new Set() };
  const makeEl = (name) => ({
    innerHTML: '',
    classList: {
      add: cls => classes[name].add(cls),
      remove: cls => classes[name].delete(cls),
      contains: cls => classes[name].has(cls),
    },
  });
  const originalGet = globalThis.document.getElementById;
  const originalBody = globalThis.document.body;
  globalThis.document.body = { classList: { add: () => {} } };
  globalThis.document.getElementById = id => {
    if (id === 'popupTabsList') return makeEl('list');
    if (id === 'popupGroupNav') return makeEl('nav');
    if (id === 'popupTabsEmpty') return { hidden: false };
    return null;
  };
  try {
    // Drain any double-rAF callbacks queued by earlier tests.
    flushRaf(); flushRaf(); flushRaf(); flushRaf();
    globalThis.popupState.openTabs = [
      { id: 1, url: 'https://example.com/', title: 'Example', windowId: 1, active: false },
    ];
    globalThis.renderPopupTabs();
    // Background refreshes must not hide the list: is-entering is only added
    // by syncPopupView on an actual view switch.
    assert.ok(!classes.list.has('is-entering'), 'content refresh must not add is-entering');
    assert.ok(!classes.nav.has('is-entering'), 'nav refresh must not add is-entering');
    flushRaf();
    flushRaf();
    assert.ok(classes.list.has('is-ready'), 'is-ready applied');
  } finally {
    globalThis.document.getElementById = originalGet;
    globalThis.document.body = originalBody;
  }
});

test('syncPopupView adds is-entering to the incoming panel only on view switch', () => {
  globalThis._skipLoadPopupState = true;
  resetPopupTestState();

  const classes = { shortcuts: new Set(), tabs: new Set(), nav: new Set() };
  const makeEl = (name) => ({
    innerHTML: '',
    hidden: false,
    classList: {
      add: cls => classes[name].add(cls),
      remove: cls => classes[name].delete(cls),
      toggle: (cls, on) => { classes[name][on ? 'add' : 'delete'](cls); },
      contains: cls => classes[name].has(cls),
    },
    setAttribute: () => {},
  });
  const originalGet = globalThis.document.getElementById;
  const originalBody = globalThis.document.body;
  globalThis.document.body = { classList: { add: () => {} } };
  globalThis.document.getElementById = id => {
    const map = {
      popupShortcutsTab: 'shortcuts',
      popupTabsTab: 'tabs',
      popupShortcutsPanel: 'shortcuts',
      popupTabsPanel: 'tabs',
      popupShortcutsList: 'shortcuts',
      popupTabsList: 'tabs',
      popupGroupNav: 'nav',
    };
    return map[id] ? makeEl(map[id]) : null;
  };
  try {
    flushRaf(); flushRaf(); flushRaf(); flushRaf();
    globalThis.popupState.view = 'tabs';
    globalThis.syncPopupView();
    assert.ok(classes.tabs.has('is-entering'), 'incoming tabs panel is hidden until its animation starts');
    assert.ok(classes.nav.has('is-entering'), 'incoming nav is hidden until its animation starts');
    assert.ok(!classes.shortcuts.has('is-entering'), 'outgoing shortcuts panel is not hidden');
    flushRaf();
    flushRaf();
    assert.ok(classes.tabs.has('is-entering'), 'is-entering stays while the entrance animation plays');
    assert.ok(classes.tabs.has('is-ready'), 'is-ready applied to the tabs panel');

    // Same-view sync (background refresh) clears is-entering so replaced
    // content never replays the entrance animation.
    globalThis.syncPopupView();
    assert.ok(!classes.tabs.has('is-entering'), 'same-view sync clears is-entering');
    assert.ok(!classes.nav.has('is-entering'), 'same-view sync clears nav is-entering');
    assert.ok(classes.tabs.has('is-ready'), 'is-ready is preserved across refreshes');
  } finally {
    globalThis.document.getElementById = originalGet;
    globalThis.document.body = originalBody;
    resetPopupTestState();
  }
});

// ---- renderShortcutCard ----

test('renderShortcutCard renders image icon when iconKind is image', () => {
  const shortcut = {
    label: 'GitHub',
    url: 'https://github.com',
    iconKind: 'image',
    icon: 'https://github.com/favicon.ico',
  };
  const html = renderShortcutCard(shortcut, 0);
  assert.ok(html.includes('data-action="open-popup-url"'));
  assert.ok(html.includes('data-url="https://github.com"'));
  assert.ok(html.includes('quick-shortcut-icon-custom'));
  assert.ok(html.includes('src="https://github.com/favicon.ico"'));
  assert.ok(html.includes('<span class="quick-shortcut-label">GitHub</span>'));
});

test('renderShortcutCard renders svg icon when iconKind is svg', () => {
  const shortcut = {
    label: 'Dashboard',
    url: 'https://dashboard.example.com',
    iconKind: 'svg',
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
  };
  const html = renderShortcutCard(shortcut, 0);
  assert.ok(html.includes('data:image/svg+xml;charset=utf-8,'));
  assert.ok(html.includes('quick-shortcut-icon'));
  assert.ok(html.includes('quick-shortcut-label'));
});

test('renderShortcutCard renders glyph icon when iconKind is glyph', () => {
  const shortcut = {
    label: 'Bookmarks',
    url: 'chrome://bookmarks',
    iconKind: 'glyph',
    icon: '★',
  };
  const html = renderShortcutCard(shortcut, 0);
  assert.ok(html.includes('quick-shortcut-custom-glyph'));
  assert.ok(html.includes('>★</span>'));
  assert.ok(html.includes('quick-shortcut-fallback'));
});

test('renderShortcutCard renders fallback label when no icon', () => {
  const shortcut = {
    label: 'Example',
    url: 'https://www.example.com',
  };
  const html = renderShortcutCard(shortcut, 0);
  assert.ok(html.includes('quick-shortcut-fallback'));
  assert.ok(!html.includes('quick-shortcut-icon"'), 'no quick-shortcut-icon img should be present');
});

test('renderShortcutCard escapes url and label in attributes', () => {
  const shortcut = {
    label: 'Test & "quoted" <label>',
    url: 'https://example.com/path?a=1&b=2',
    iconKind: '',
  };
  const html = renderShortcutCard(shortcut, 0);
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&quot;'));
  assert.ok(html.includes('&lt;'));
});

// ---- renderTabGroup ----

test('renderTabGroup renders tab rows with favicon img', () => {
  const group = {
    domain: 'github.com',
    label: 'GitHub',
    kind: 'domain',
    tabs: [
      { id: 1, url: 'https://github.com', title: 'GitHub Home', favIconUrl: 'https://github.com/favicon.ico' },
    ],
  };
  const html = renderTabGroup(group, 0);
  assert.ok(html.includes('popup-tab-group'));
  assert.ok(html.includes('data-group-id="github.com"'));
  assert.ok(html.includes('popup-tab-group-title'));
  assert.ok(html.includes('data-action="open-popup-url"'));
  assert.ok(html.includes('data-tab-id="1"'));
  assert.ok(html.includes('data-action="close-popup-tab"'));
});

test('renderTabGroup renders fallback favicon when no faviconUrl', () => {
  const group = {
    domain: 'example.com',
    label: 'Example',
    kind: 'domain',
    tabs: [{ id: 2, url: 'https://example.com', title: 'Example' }],
  };
  const html = renderTabGroup(group, 0);
  assert.ok(html.includes('popup-tab-favicon-fallback'));
});

test('renderTabGroup includes fallback queue on favicon images', () => {
  _restorePopupIcons();
  try {
    globalThis._popupIcons.getIconSources = () => ({
      sources: [
        'chrome-extension://abc/_favicon/?pageUrl=https%3A%2F%2Fexample.com&size=16',
        'https://example.com/favicon.ico',
        'https://fallback.example.com/favicon.ico',
      ],
      hostname: 'example.com',
    });
    const group = {
      domain: 'example.com',
      label: 'Example',
      kind: 'domain',
      tabs: [{ id: 3, url: 'https://example.com', title: 'Example' }],
    };
    const html = renderTabGroup(group, 0);
    assert.ok(html.includes('data-fallback-src="https://example.com/favicon.ico"'));
    assert.ok(html.includes('data-fallback-srcset="[&quot;https://fallback.example.com/favicon.ico&quot;]"'));
  } finally {
    _restorePopupIcons();
  }
});

test('renderTabGroup sets correct CSS custom properties', () => {
  const group = {
    domain: 'test.com',
    label: 'Test',
    kind: 'domain',
    tabs: [
      { id: 10, url: 'https://test.com/a', title: 'A' },
      { id: 11, url: 'https://test.com/b', title: 'B' },
    ],
  };
  const html = renderTabGroup(group, 2);
  assert.ok(html.includes('style="--g:2;--r:0"'));
  assert.ok(html.includes('style="--g:2;--r:1"'));
});

test('renderTabGroup escapes title and url', () => {
  const group = {
    domain: 'example.com',
    label: 'Example',
    kind: 'domain',
    tabs: [{ id: 3, url: 'https://example.com?q="x"&y=1', title: 'Title & noise | Site' }],
  };
  const html = renderTabGroup(group, 0);
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&quot;'));
});

test('renderTabGroup handles empty tabs array', () => {
  const group = {
    domain: 'empty.com',
    label: 'Empty',
    kind: 'domain',
    tabs: [],
  };
  const html = renderTabGroup(group, 0);
  assert.ok(html.includes('popup-tab-group-list'));
  assert.ok(!html.includes('popup-tab-row'));
});

// ---- renderGroupNav ----

// Restore _popupIcons to known state before each group of tests
const _origPopupIcons = { ...globalThis._popupIcons };
const _restorePopupIcons = () => { Object.assign(globalThis._popupIcons, _origPopupIcons); };

// ---- renderGroupNav ----

test('renderGroupNav renders button with label', () => {
  _restorePopupIcons();
  globalThis._popupIcons.getGroupIcon = () => ({ src: '', fallbackLabel: '?' });
  const group = { domain: 'github.com', label: 'GitHub', kind: 'domain' };
  const html = renderGroupNav(group, 0);
  assert.ok(html.includes('group-nav-button'));
  assert.ok(html.includes('data-action="jump-popup-group"'));
  assert.ok(html.includes('data-group-id="github.com"'));
  // getGroupDisplayLabel transforms domain kind label via friendlyDomain
  assert.ok(html.includes('aria-label="GitHub"'));
  assert.ok(html.includes('style="--s:0"'));
});

test('renderGroupNav renders icon img when provided', () => {
  _restorePopupIcons();
  globalThis._popupIcons.getGroupIcon = () => ({ src: 'https://example.com/icon.png', fallbackLabel: 'EX' });
  const group = { domain: 'example.com', label: 'Example', kind: 'domain' };
  const html = renderGroupNav(group, 1);
  assert.ok(html.includes('group-nav-icon'));
  assert.ok(html.includes('src="https://example.com/icon.png"'));
});

test('renderGroupNav uses fallback when no icon', () => {
  _restorePopupIcons();
  globalThis._popupIcons.getGroupIcon = () => ({ src: '', fallbackLabel: '?' });
  const group = { domain: 'another.com', label: 'Another', kind: 'domain' };
  const html = renderGroupNav(group, 0);
  assert.ok(!html.includes('group-nav-icon'));
});

test('renderGroupNav escapes label in aria-label', () => {
  _restorePopupIcons();
  globalThis._popupIcons.getGroupIcon = () => ({ src: '', fallbackLabel: '?' });
  // Use chrome-group kind so label is NOT run through friendlyDomain (which would drop special chars)
  const group = { domain: '__chrome_group__:1', label: 'Test & "Special" <Label>', kind: 'chrome-group' };
  const html = renderGroupNav(group, 0);
  assert.ok(html.includes('aria-label="Test &amp; &quot;Special&quot; &lt;Label&gt;"'));
});

// ---- popupState exposure ----

test('popupState is exposed globally', () => {
  assert.equal(typeof globalThis.popupState, 'object');
  assert.equal(typeof globalThis.popupState.view, 'string');
  assert.ok(Array.isArray(globalThis.popupState.openTabs));
  assert.ok(Array.isArray(globalThis.popupState.quickShortcuts));
});

test('popupState.view defaults to shortcuts', () => {
  assert.equal(globalThis.popupState.view, 'shortcuts');
});

// ---- getTabLabel: additional edge cases ----

test('getTabLabel handles file:// URLs by falling back to URL path', () => {
  const tab = { title: '', url: 'file:///Users/local/doc.pdf' };
  const label = getTabLabel(tab);
  assert.ok(label.length > 0);
});

test('getTabLabel handles youtube watch page with URL-like title', () => {
  const tab = { title: 'https://www.youtube.com/watch?v=abc', url: 'https://www.youtube.com/watch?v=abc' };
  const label = getTabLabel(tab);
  assert.equal(label, 'YouTube Video');
});

test('getTabLabel uses title over URL for youtube watch when title is meaningful', () => {
  const tab = { title: 'Cool Video - YouTube', url: 'https://www.youtube.com/watch?v=abc' };
  const label = getTabLabel(tab);
  assert.ok(label.length > 0);
});

// ---- matchCustomGroup: additional edge cases ----

test('matchCustomGroup returns null for file:// URLs', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [
    { hostname: 'example.com', pathPrefix: null, groupKey: 'ex', groupLabel: 'Example' },
  ];
  assert.equal(matchCustomGroup('file:///Users/test/index.html'), null);
});

test('matchCustomGroup matches hostname without pathPrefix when pathPrefix is null', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [
    { hostname: 'example.com', pathPrefix: null, groupKey: 'ex', groupLabel: 'Example' },
  ];
  assert.ok(matchCustomGroup('https://example.com/any/path') !== null);
  assert.ok(matchCustomGroup('https://example.com/') !== null);
});

// ---- buildPopupTabGroups: additional integration tests ----

test('buildPopupTabGroups groups tabs by custom group rules', () => {
  resetPopupTestState({
    customGroups: [
      { hostname: 'github.com', pathPrefix: null, groupKey: 'github', groupLabel: 'GitHub' },
      { hostname: 'gitlab.com', pathPrefix: null, groupKey: 'gitlab', groupLabel: 'GitLab' },
    ],
    landingPatterns: [],
  });

  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://github.com/user', title: 'GitHub', windowId: 1, active: false, groupId: null },
    { id: 2, url: 'https://gitlab.com/project', title: 'GitLab', windowId: 1, active: false, groupId: null },
    { id: 3, url: 'https://other.com/page', title: 'Other', windowId: 1, active: false, groupId: null },
  ];

  const groups = globalThis.buildPopupTabGroups();
  const gh = groups.find(g => g.kind === 'custom' && g.domain === 'github');
  const gl = groups.find(g => g.kind === 'custom' && g.domain === 'gitlab');
  const other = groups.find(g => g.kind === 'domain' && g.domain === 'other.com');
  assert.ok(gh, 'github custom group should exist');
  assert.equal(gh.tabs.length, 1);
  assert.ok(gl, 'gitlab custom group should exist');
  assert.equal(gl.tabs.length, 1);
  assert.ok(other, 'other.com domain group should exist');
  assert.equal(other.tabs.length, 1);
});

test('buildPopupTabGroups places landing pages before domain groups', () => {
  resetPopupTestState();

  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://github.com/', title: 'GitHub Home', windowId: 1, active: false, groupId: null },
    { id: 2, url: 'https://other.com/page', title: 'Other', windowId: 1, active: false, groupId: null },
  ];

  const groups = globalThis.buildPopupTabGroups();
  assert.equal(groups[0].kind, 'landing', 'landing group should be first');
  const otherIdx = groups.findIndex(g => g.domain === 'other.com');
  assert.ok(otherIdx > 0, 'domain group should come after landing');
});

test('buildPopupTabGroups handles custom landing page patterns', () => {
  resetPopupTestState({
    landingPatterns: [
      { hostname: 'news.ycombinator.com', pathExact: ['/news'] },
    ],
  });

  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://news.ycombinator.com/news', title: 'HN', windowId: 1, active: false, groupId: null },
  ];

  const groups = globalThis.buildPopupTabGroups();
  const landing = groups.find(g => g.kind === 'landing');
  assert.ok(landing, 'custom landing group should exist');
  assert.equal(landing.tabs.length, 1);
  assert.equal(landing.tabs[0].id, 1);
});

test('renderTabGroup reorders tabs by stored groupTabOrder', () => {
  resetPopupTestState({ landingPatterns: [] });

  globalThis.popupState.groupTabOrder = {
    'example.com': ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
  };

  const group = {
    domain: 'example.com',
    label: 'Example',
    kind: 'domain',
    tabs: [
      { id: 1, url: 'https://example.com/b', title: 'B' },
      { id: 2, url: 'https://example.com/a', title: 'A' },
      { id: 3, url: 'https://example.com/c', title: 'C' },
    ],
  };
  const html = renderTabGroup(group, 0);
  const idxA = html.indexOf('https://example.com/a');
  const idxB = html.indexOf('https://example.com/b');
  const idxC = html.indexOf('https://example.com/c');
  assert.ok(idxA < idxB, 'A should appear before B');
  assert.ok(idxB < idxC, 'B should appear before C');
});

test('renderTabGroup shows duplicate URLs as separate rows', () => {
  resetPopupTestState({ landingPatterns: [] });

  const group = {
    domain: 'example.com',
    label: 'Example',
    kind: 'domain',
    tabs: [
      { id: 1, url: 'https://example.com/page', title: 'First' },
      { id: 2, url: 'https://example.com/page', title: 'Duplicate' },
    ],
  };
  const html = renderTabGroup(group, 0);
  // Each tab row has data-tab-id in both the row <div> and the close <button>
  const rowCount = (html.match(/popup-tab-row/g) || []).length;
  assert.equal(rowCount, 2, 'duplicate URL tabs stay visible as separate rows');
});

// ---- isLandingPage: additional edge cases ----

test('isLandingPage treats bare Gmail inbox and sent hashes as content tabs', () => {
  resetPopupTestState({ landingPatterns: [] });
  assert.equal(isLandingPage('https://mail.google.com/mail/u/0/#inbox'), false, 'bare #inbox is a content tab');
  assert.equal(isLandingPage('https://mail.google.com/mail/u/0/#inbox/12345'), false, 'open conversation is a content tab');
  assert.equal(isLandingPage('https://mail.google.com/mail/u/0/#sent'), false, 'bare #sent is a content tab');
  assert.equal(isLandingPage('https://mail.google.com/mail/u/0/'), true, 'Gmail front page without a view is a landing');
  assert.equal(isLandingPage('https://mail.google.com/mail/u/0/#label/work'), true, 'label views stay landing');
});

test('isLandingPage matches custom landing patterns', () => {
  resetPopupTestState({
    landingPatterns: [
      { hostname: 'news.ycombinator.com', pathExact: ['/news'] },
    ],
  });
  assert.equal(isLandingPage('https://news.ycombinator.com/news'), true);
  assert.equal(isLandingPage('https://news.ycombinator.com/item?id=123'), false);
});

test('isLandingPage handles hostnameEndsWith in patterns', () => {
  resetPopupTestState({
    landingPatterns: [
      { hostnameEndsWith: '.notion.site', pathExact: ['/'] },
    ],
  });
  assert.equal(isLandingPage('https://myworkspace.notion.site/'), true);
  assert.equal(isLandingPage('https://myworkspace.notion.site/page'), false);
});

// ---- renderTabGroup: additional edge cases ----

test('renderTabGroup includes close button with correct data attributes', () => {
  const group = {
    domain: 'example.com',
    label: 'Example',
    kind: 'domain',
    tabs: [{ id: 5, url: 'https://example.com', title: 'Example' }],
  };
  const html = renderTabGroup(group, 0);
  assert.ok(html.includes('data-action="close-popup-tab"'));
  assert.ok(html.includes('data-tab-id="5"'));
});

test('renderTabGroup renders tab title attribute for tooltip', () => {
  const group = {
    domain: 'example.com',
    label: 'Example',
    kind: 'domain',
    tabs: [{ id: 1, url: 'https://example.com', title: 'Page & Title' }],
  };
  const html = renderTabGroup(group, 0);
  assert.ok(html.includes('title="Page &amp; Title"'));
});

// ---- renderShortcutCard: additional edge cases ----

test('renderShortcutCard handles index 0 with correct CSS var', () => {
  const shortcut = { label: 'Home', url: 'https://home.com' };
  const html = renderShortcutCard(shortcut, 0);
  assert.ok(html.includes('--s:0'));
});

test('renderShortcutCard uses url as label fallback', () => {
  const shortcut = { url: 'https://no-label.com' };
  const html = renderShortcutCard(shortcut, 0);
  assert.ok(html.includes('https://no-label.com'));
});

// ---- renderGroupNav: additional edge cases ----

test('renderGroupNav includes fallback src on img', () => {
  _restorePopupIcons();
  globalThis._popupIcons.getGroupIcon = () => ({
    src: 'https://example.com/icon.png',
    fallbackLabel: 'EX',
    fallbackSrc: 'https://example.com/fallback.png',
  });
  const group = { domain: 'example.com', label: 'Example', kind: 'domain' };
  const html = renderGroupNav(group, 0);
  assert.ok(html.includes('data-fallback-src="https://example.com/fallback.png"'));
});
