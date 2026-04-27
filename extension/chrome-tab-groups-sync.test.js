'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Mock chrome APIs before loading the module
const mockStorage = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const key = Array.isArray(keys) ? keys[0] : keys;
        return { [key]: mockStorage[key] ?? undefined };
      },
      set: async (items) => {
        Object.assign(mockStorage, items);
      },
    },
  },
  tabs: {
    group: async (opts) => 0,
    ungroup: async () => {},
    query: async (opts) => opts?.groupId != null ? [] : [],
  },
  tabGroups: {
    query: async () => [],
    update: async () => {},
    get: async () => null,
  },
};

require('./chrome-tab-groups-sync.js');

const {
  loadChromeTabGroupsSetting,
  saveChromeTabGroupsSetting,
  syncChromeTabGroups,
  resetChromeGroupState,
  isChromeTabGroupsEnabled,
  getChromeGroupCount,
  populateChromeGroupMap,
  queryExistingChromeGroups,
  setImportMode,
  assignGroupColor,
  getGroupTitle,
} = globalThis.TabOutChromeTabGroups;

test('assignGroupColor returns blue for session groups', () => {
  assert.equal(assignGroupColor('__session_group__:g1', 0), 'blue');
  assert.equal(assignGroupColor('__session_group__:g2', 5), 'blue');
});

test('assignGroupColor returns yellow for landing pages', () => {
  assert.equal(assignGroupColor('__landing-pages__', 0), 'yellow');
  assert.equal(assignGroupColor('__landing-pages__', 3), 'yellow');
});

test('assignGroupColor cycles through colors for domain groups', () => {
  const colors = ['grey', 'red', 'green', 'pink', 'purple', 'cyan', 'orange'];
  colors.forEach((expected, i) => {
    assert.equal(assignGroupColor('example.com', i), expected);
  });
  // Cycles back
  assert.equal(assignGroupColor('test.com', 7), colors[0]);
});

test('getGroupTitle returns friendly domain for regular groups', () => {
  const group = { domain: 'github.com', tabs: [] };
  const title = getGroupTitle(group);
  assert.equal(typeof title, 'string');
  assert.ok(title.length > 0);
});

test('getGroupTitle uses label for custom groups', () => {
  const group = { domain: 'custom-key', label: 'Work', tabs: [] };
  assert.equal(getGroupTitle(group), 'Work');
});

test('getGroupTitle returns Homepages for landing pages', () => {
  const group = { domain: '__landing-pages__', tabs: [] };
  assert.equal(getGroupTitle(group), 'Homepages');
});

test('loadChromeTabGroupsSetting returns false by default', async () => {
  resetChromeGroupState();
  delete mockStorage.chromeTabGroupsEnabled;
  const result = await loadChromeTabGroupsSetting();
  assert.equal(result, false);
  assert.equal(isChromeTabGroupsEnabled(), false);
});

test('saveChromeTabGroupsSetting persists and updates cached state', async () => {
  resetChromeGroupState();
  const saved = await saveChromeTabGroupsSetting(true);
  assert.equal(saved, true);
  assert.equal(isChromeTabGroupsEnabled(), true);
  assert.equal(mockStorage.chromeTabGroupsEnabled, true);

  const loaded = await loadChromeTabGroupsSetting();
  assert.equal(loaded, true);
});

test('saveChromeTabGroupsSetting toggles off correctly', async () => {
  resetChromeGroupState();
  await saveChromeTabGroupsSetting(true);
  assert.equal(isChromeTabGroupsEnabled(), true);
  await saveChromeTabGroupsSetting(false);
  assert.equal(isChromeTabGroupsEnabled(), false);
  assert.equal(mockStorage.chromeTabGroupsEnabled, false);
});

test('syncChromeTabGroups removes groups when disabled', async () => {
  resetChromeGroupState();
  await saveChromeTabGroupsSetting(false);

  const groups = [
    { domain: 'github.com', tabs: [{ id: 1, windowId: 1, url: 'https://github.com' }] },
  ];

  // Should not throw when disabled
  await syncChromeTabGroups(groups);
  assert.equal(getChromeGroupCount(), 0);
});

test('syncChromeTabGroups creates groups when enabled', async () => {
  resetChromeGroupState();
  let groupCallCount = 0;
  let updateCallArgs = [];

  globalThis.chrome.tabs.group = async (opts) => {
    groupCallCount++;
    return 100 + groupCallCount;
  };

  globalThis.chrome.tabGroups.update = async (id, opts) => {
    updateCallArgs.push({ id, ...opts });
  };

  globalThis.chrome.tabGroups.query = async () => [];
  globalThis.chrome.tabs.query = async (opts) => [];

  await saveChromeTabGroupsSetting(true);

  const groups = [
    { domain: 'github.com', tabs: [{ id: 1, windowId: 1, url: 'https://github.com' }] },
    { domain: 'example.com', tabs: [{ id: 2, windowId: 1, url: 'https://example.com' }] },
  ];

  await syncChromeTabGroups(groups);

  assert.equal(groupCallCount, 2);
  assert.equal(updateCallArgs.length, 2);
  assert.equal(updateCallArgs[0].color, 'grey');
  assert.equal(updateCallArgs[1].color, 'red');
  assert.equal(getChromeGroupCount(), 2);
});

test('syncChromeTabGroups handles tabs in different windows', async () => {
  resetChromeGroupState();
  let groupCallCount = 0;

  globalThis.chrome.tabs.group = async (opts) => {
    groupCallCount++;
    return 200 + groupCallCount;
  };

  globalThis.chrome.tabGroups.update = async () => {};
  globalThis.chrome.tabGroups.query = async () => [];
  globalThis.chrome.tabs.query = async (opts) => [];

  await saveChromeTabGroupsSetting(true);

  const groups = [
    {
      domain: 'github.com',
      tabs: [
        { id: 1, windowId: 1, url: 'https://github.com' },
        { id: 3, windowId: 2, url: 'https://github.com/other' },
      ],
    },
  ];

  await syncChromeTabGroups(groups);

  // Should create 1 group for each window → 2 total chrome.tabs.group calls
  assert.equal(groupCallCount, 2);
});

test('syncChromeTabGroups cleans up when disabled after being enabled', async () => {
  resetChromeGroupState();
  let ungroupCalls = [];

  globalThis.chrome.tabs.ungroup = async (tabIds) => {
    ungroupCalls.push(tabIds);
  };

  globalThis.chrome.tabs.group = async (opts) => 300;
  globalThis.chrome.tabGroups.update = async () => {};
  globalThis.chrome.tabGroups.query = async () => [];
  globalThis.chrome.tabs.query = async (opts) => [];

  await saveChromeTabGroupsSetting(true);

  const groups = [
    { domain: 'test.com', tabs: [{ id: 10, windowId: 1, url: 'https://test.com' }] },
  ];

  await syncChromeTabGroups(groups);
  assert.ok(getChromeGroupCount() > 0);

  // Now disable
  await saveChromeTabGroupsSetting(false);
  await syncChromeTabGroups(groups);

  assert.equal(getChromeGroupCount(), 0);
});

test('syncChromeTabGroups handles empty tabs gracefully', async () => {
  resetChromeGroupState();
  await saveChromeTabGroupsSetting(true);
  await syncChromeTabGroups([]);
  assert.equal(getChromeGroupCount(), 0);
});

test('syncChromeTabGroups handles groups with no tabs', async () => {
  resetChromeGroupState();
  await saveChromeTabGroupsSetting(true);
  await syncChromeTabGroups([{ domain: 'empty.com', tabs: [] }]);
  assert.equal(getChromeGroupCount(), 0);
});

test('populateChromeGroupMap adds mappings to internal state', () => {
  resetChromeGroupState();
  populateChromeGroupMap([
    { virtualGroupKey: 'github.com', windowId: 1, chromeGroupId: 101 },
    { virtualGroupKey: 'github.com', windowId: 2, chromeGroupId: 102 },
  ]);
  assert.equal(getChromeGroupCount(), 1);
});

test('queryExistingChromeGroups returns groups from chrome.tabGroups.query', async () => {
  globalThis.chrome.tabGroups.query = async () => [
    { id: 1, title: 'Work', color: 'blue' },
    { id: 2, title: 'Research', color: 'red' },
  ];
  const groups = await queryExistingChromeGroups();
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, 'Work');
});

test('syncChromeTabGroups reuses chromeGroupMap populated by populateChromeGroupMap', async () => {
  resetChromeGroupState();
  let lastGroupCall = null;

  globalThis.chrome.tabs.group = async (opts) => {
    lastGroupCall = opts;
    return 500;
  };
  globalThis.chrome.tabGroups.update = async () => {};
  globalThis.chrome.tabGroups.query = async () => [{ id: 500, title: 'GitHub', color: 'grey' }];
  globalThis.chrome.tabs.query = async (opts) => [];

  await saveChromeTabGroupsSetting(true);

  // Pre-populate the mapping (simulating "pull from Chrome groups" scenario)
  populateChromeGroupMap([
    { virtualGroupKey: 'github.com', windowId: 1, chromeGroupId: 500 },
  ]);

  const groups = [
    { domain: 'github.com', tabs: [{ id: 10, windowId: 1, url: 'https://github.com' }] },
  ];

  await syncChromeTabGroups(groups);

  // Should have reused the existing group — called with groupId (reuse path), not tabIds (create path)
  assert.equal(lastGroupCall.groupId, 500);
  assert.deepEqual(lastGroupCall.tabIds, [10]);
});

test('syncChromeTabGroups in import mode skips creating new groups for ungrouped tabs', async () => {
  resetChromeGroupState();
  let createCalls = 0;
  let reuseCalls = 0;

  globalThis.chrome.tabs.group = async (opts) => {
    if (opts.groupId != null) {
      reuseCalls++;
      return opts.groupId;
    }
    createCalls++;
    return 600 + createCalls;
  };
  globalThis.chrome.tabGroups.update = async () => {};
  globalThis.chrome.tabGroups.query = async () => [{ id: 500, title: 'Work', color: 'blue' }];
  globalThis.chrome.tabs.query = async (opts) => [];

  await saveChromeTabGroupsSetting(true);

  // Simulate import: populate chromeGroupMap with existing Chrome groups
  populateChromeGroupMap([
    { virtualGroupKey: '__session_group__:g1', windowId: 1, chromeGroupId: 500 },
  ]);

  // Enable import mode: only reuse, don't create
  setImportMode(true);

  const groups = [
    { domain: '__session_group__:g1', label: 'Work', tabs: [{ id: 1, windowId: 1, url: 'https://a.com' }] },
    { domain: 'github.com', tabs: [{ id: 5, windowId: 1, url: 'https://github.com' }] },
  ];

  await syncChromeTabGroups(groups);

  // Work group reused existing Chrome group
  assert.equal(reuseCalls, 1);
  // github.com was SKIPPED (import mode, no matching Chrome group)
  assert.equal(createCalls, 0);

  // Disable import mode and sync again — now github.com should get a new group
  setImportMode(false);
  await syncChromeTabGroups(groups);
  assert.equal(createCalls, 1);
});
