'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Mock chrome APIs used at module load time (initializePopup runs on require)
globalThis.chrome = {
  tabs: { query: async () => [] },
  tabGroups: { query: async () => [] },
  storage: { local: { get: async () => ({}) } },
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
globalThis.TabOutListOrder = {};
globalThis.TabOutSessionGroups = { normalizeSessionGroups: v => v || { groups: [], assignments: {} } };
globalThis.TabOutGroupOrder = { normalizeGroupOrderState: v => v || { sessionOrder: [], pinnedOrder: [], pinEnabled: false } };
globalThis.TabHarborI18n = { t: key => key };

// Prevent LOCAL_* globals from interfering
globalThis.LOCAL_LANDING_PAGE_PATTERNS = undefined;
globalThis.LOCAL_CUSTOM_GROUPS = undefined;

require('./popup.js');

const {
  escapeAttr,
  friendlyDomain,
  stripTitleNoise,
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

// ---- friendlyDomain ----

test('friendlyDomain strips www. prefix then replaces dots with spaces', () => {
  assert.equal(friendlyDomain('www.github.com'), 'github com');
});

test('friendlyDomain replaces dots with spaces', () => {
  assert.equal(friendlyDomain('mail.google.com'), 'mail google com');
});

test('friendlyDomain handles empty/null input', () => {
  assert.equal(friendlyDomain(''), '');
  assert.equal(friendlyDomain(null), '');
  assert.equal(friendlyDomain(undefined), '');
});

test('friendlyDomain strips www then replaces dots with spaces then trims only ends', () => {
  // leading/trailing spaces trimmed, internal spaces preserved
  assert.equal(friendlyDomain('  www.example.org  '), 'www example org');
});

// ---- stripTitleNoise ----

test('stripTitleNoise removes noise after | or - separators', () => {
  assert.equal(stripTitleNoise('GitHub - Repository | org/repo'), 'GitHub');
  assert.equal(stripTitleNoise('Page Title - Site Name'), 'Page Title');
  assert.equal(stripTitleNoise('Title – Dash Variant'), 'Title');
  assert.equal(stripTitleNoise('Title — Em Dash Variant'), 'Title');
});

test('stripTitleNoise returns clean title unchanged', () => {
  assert.equal(stripTitleNoise('Clean Title'), 'Clean Title');
  assert.equal(stripTitleNoise('No noise here'), 'No noise here');
});

test('stripTitleNoise trims result including trailing noise with whitespace', () => {
  assert.equal(stripTitleNoise('Title |  '), 'Title');
  assert.equal(stripTitleNoise('Title -  '), 'Title');
});

test('stripTitleNoise handles empty string', () => {
  assert.equal(stripTitleNoise(''), '');
});

// ---- getTabLabel ----

test('getTabLabel returns stripped title when present', () => {
  const tab = { title: 'GitHub - awesome-org/awesome-repo', url: 'https://github.com' };
  assert.equal(getTabLabel(tab), 'GitHub');
});

test('getTabLabel falls back to hostname (friendly) for URL-only tabs', () => {
  const tab = { title: '', url: 'https://www.example.com/path' };
  assert.equal(getTabLabel(tab), 'example com');
});

test('getTabLabel falls back to URL hostname for unparseable-looking URLs', () => {
  const tab = { title: '', url: 'chrome://newtab' };
  assert.equal(getTabLabel(tab), 'newtab');
});

test('getTabLabel falls back to "Tab" for missing title and url', () => {
  assert.equal(getTabLabel({}), 'Tab');
  assert.equal(getTabLabel({ title: '' }), 'Tab');
});

test('getTabLabel strips www from hostname fallback via friendlyDomain', () => {
  const tab = { title: '', url: 'https://www.google.com/search' };
  assert.equal(getTabLabel(tab), 'google com');
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
  globalThis.LOCAL_CUSTOM_GROUPS = [
    { hostname: 'github.com', pathPrefix: null, groupKey: 'gh', groupLabel: 'GitHub' },
  ];
  const result = matchCustomGroup('https://github.com/user');
  assert.equal(typeof result, 'object', 'should return rule object');
  assert.equal(result.hostname, 'github.com');
  assert.ok(matchCustomGroup('https://github.com/notifications') !== null);
  assert.notEqual(matchCustomGroup('https://github.com/' + 'a'.repeat(100)), null);
  assert.equal(matchCustomGroup('https://gitlab.com/'), null);
});

test('matchCustomGroup matches hostnameEndsWith', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [
    { hostname: null, hostnameEndsWith: '.notion.site', pathPrefix: null, groupKey: 'notion', groupLabel: 'Notion' },
  ];
  assert.ok(matchCustomGroup('https://myworkspace.notion.site/') !== null, 'should match .notion.site');
  assert.ok(matchCustomGroup('https://github.com/') === null, 'should not match github.com');
});

test('matchCustomGroup matches pathPrefix when specified', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [
    { hostname: 'github.com', pathPrefix: '/orgs/', groupKey: 'gh-org', groupLabel: 'GitHub Orgs' },
  ];
  const result = matchCustomGroup('https://github.com/orgs/team');
  assert.ok(result !== null, 'should match /orgs/ path');
  assert.equal(result.hostname, 'github.com');
  assert.equal(matchCustomGroup('https://github.com/user/repo'), null, 'should not match user path');
});

test('matchCustomGroup returns null for empty groups', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [];
  assert.equal(matchCustomGroup('https://github.com/'), null);
});

test('matchCustomGroup handles invalid URLs gracefully', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [];
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
  assert.equal(getGroupDisplayLabel({ kind: 'domain', domain: 'www.google.com' }), 'google com');
  assert.equal(getGroupDisplayLabel({ kind: 'custom', domain: 'github.com' }), 'github com');
});

test('getGroupDisplayLabel uses label for chrome-group kind', () => {
  assert.equal(getGroupDisplayLabel({ kind: 'chrome-group', label: 'Research', domain: '__chrome_group__:1' }), 'Research');
});

test('getGroupDisplayLabel handles missing i18n by returning key', () => {
  globalThis.TabHarborI18n = {};
  globalThis.TabOutGroupOrder = { normalizeGroupOrderState: () => {} };
  assert.equal(getGroupDisplayLabel({ kind: 'ungrouped', domain: '__ungrouped__' }), 'ungroupedLabel');
});

// ---- buildPopupTabGroups integration ----

test('buildPopupTabGroups is exposed globally', () => {
  assert.equal(typeof globalThis.buildPopupTabGroups, 'function');
});

test('buildPopupTabGroups groups session-assigned tabs', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [];
  globalThis.LOCAL_LANDING_PAGE_PATTERNS = [];
  globalThis.TabOutSessionGroups = { normalizeSessionGroups: () => ({ groups: [], assignments: {} }) };
  globalThis.TabOutGroupOrder = { applyGroupOrder: (list) => list, normalizeGroupOrderState: () => ({ sessionOrder: [], pinnedOrder: [], pinEnabled: false }) };
  globalThis._resetPopupState();
  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://github.com', title: 'GitHub', windowId: 1, active: false, groupId: null },
  ];
  globalThis.popupState.tabGroups = [];
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

test('buildPopupTabGroups groups domain tabs', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [];
  globalThis.LOCAL_LANDING_PAGE_PATTERNS = undefined; // restore default landing patterns
  globalThis.TabOutSessionGroups = { normalizeSessionGroups: () => ({ groups: [], assignments: {} }) };
  globalThis.TabOutGroupOrder = { applyGroupOrder: (list) => list, normalizeGroupOrderState: () => ({ sessionOrder: [], pinnedOrder: [], pinEnabled: false }) };
  globalThis._resetPopupState();

  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://github.com/user', title: 'GitHub', windowId: 1, active: false, groupId: null },
    { id: 2, url: 'https://github.com/org/team', title: 'Team', windowId: 1, active: false, groupId: null },
    { id: 3, url: 'https://google.com/search', title: 'Search', windowId: 1, active: false, groupId: null },
  ];
  globalThis.popupState.tabGroups = [];

  const groups = globalThis.buildPopupTabGroups();
  const ghGroup = groups.find(g => g.domain === 'github.com');
  assert.ok(ghGroup, 'github.com group should exist');
  assert.equal(ghGroup.tabs.length, 2);
  const googleGroup = groups.find(g => g.domain === 'google.com');
  assert.ok(googleGroup, 'google.com group should exist');
  assert.equal(googleGroup.tabs.length, 1);
});

test('buildPopupTabGroups places landing pages group at top', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [];
  globalThis.LOCAL_LANDING_PAGE_PATTERNS = undefined; // use default landing patterns
  globalThis.TabOutSessionGroups = { normalizeSessionGroups: () => ({ groups: [], assignments: {} }) };
  globalThis.TabOutGroupOrder = { applyGroupOrder: (list) => list, normalizeGroupOrderState: () => ({ sessionOrder: [], pinnedOrder: [], pinEnabled: false }) };
  globalThis._resetPopupState();

  globalThis.popupState.openTabs = [
    { id: 1, url: 'https://github.com/', title: 'GitHub', windowId: 1, active: false, groupId: null },
    { id: 2, url: 'https://www.youtube.com/', title: 'YouTube', windowId: 1, active: false, groupId: null },
  ];
  globalThis.popupState.tabGroups = [];

  const groups = globalThis.buildPopupTabGroups();
  assert.equal(groups[0].kind, 'landing', 'landing group should be first');
  assert.equal(groups[0].tabs.length, 2);
});

test('buildPopupTabGroups groups file:// URLs under local-files domain', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [];
  globalThis.LOCAL_LANDING_PAGE_PATTERNS = undefined; // use default landing patterns
  globalThis.TabOutSessionGroups = { normalizeSessionGroups: () => ({ groups: [], assignments: {} }) };
  globalThis.TabOutGroupOrder = { applyGroupOrder: (list) => list, normalizeGroupOrderState: () => ({ sessionOrder: [], pinnedOrder: [], pinEnabled: false }) };
  globalThis._resetPopupState();

  globalThis.popupState.openTabs = [
    { id: 1, url: 'file:///path/to/file', title: 'Local File', windowId: 1, active: false, groupId: null },
  ];
  globalThis.popupState.tabGroups = [];

  const groups = globalThis.buildPopupTabGroups();
  const localGroup = groups.find(g => g.domain === 'local-files');
  assert.ok(localGroup, 'local-files group should exist');
  assert.equal(localGroup.tabs.length, 1);
  assert.equal(localGroup.tabs[0].id, 1);
});

test('buildPopupTabGroups puts chrome tab group tabs into chrome-group kind', () => {
  globalThis.LOCAL_CUSTOM_GROUPS = [];
  globalThis.LOCAL_LANDING_PAGE_PATTERNS = undefined; // use default landing patterns
  globalThis.TabOutSessionGroups = { normalizeSessionGroups: () => ({ groups: [], assignments: {} }) };
  globalThis.TabOutGroupOrder = { applyGroupOrder: (list) => list, normalizeGroupOrderState: () => ({ sessionOrder: [], pinnedOrder: [], pinEnabled: false }) };
  globalThis._skipLoadPopupState = true;
  globalThis._resetPopupState();

  // Tabs with unparseable URLs bypass domain grouping and reach chrome-group logic
  const tabA = { id: 1, url: '', title: 'Tab A', windowId: 1, active: false, groupId: 10 };
  const tabB = { id: 2, url: '', title: 'Tab B', windowId: 1, active: false, groupId: 10 };
  globalThis.popupState.openTabs = [tabA, tabB];
  globalThis.popupState.tabGroups = [
    { id: 10, title: 'Research', color: 'blue', collapsed: false, tabs: [tabA, tabB] },
  ];

  const groups = globalThis.buildPopupTabGroups();
  const cg = groups.find(g => g.kind === 'chrome-group');
  assert.ok(cg, 'chrome-group should exist');
  assert.equal(cg.color, 'blue');
  assert.equal(cg.tabs.length, 2);
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
  assert.ok(html.includes('aria-label="github com"'));
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