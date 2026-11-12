'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function createEventEmitter() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    hasListener(listener) { return listeners.has(listener); },
    emit(...args) {
      for (const listener of listeners) listener(...args);
    },
  };
}

const mockStorage = {};
const runtimeMessages = [];
const directMutations = { group: [], ungroup: [], update: [] };
let runtimeHandler = async (message) => ({
  ok: true,
  action: message.action === 'get-chrome-tab-group-state' ? 'get-state' : 'sync',
  state: { sessionMap: {}, liveGroups: [], windows: [] },
});

globalThis.friendlyDomain = hostname => `Friendly ${hostname}`;
globalThis.chrome = {
  runtime: {
    async sendMessage(message) {
      runtimeMessages.push(JSON.parse(JSON.stringify(message)));
      return runtimeHandler(message);
    },
  },
  storage: {
    onChanged: createEventEmitter(),
    local: {
      async get(keys) {
        const key = Array.isArray(keys) ? keys[0] : keys;
        return { [key]: mockStorage[key] };
      },
      async set(items) {
        Object.assign(mockStorage, items);
      },
      async remove(keys) {
        for (const key of [].concat(keys)) delete mockStorage[key];
      },
    },
  },
  tabs: {
    async group(options) {
      directMutations.group.push(options);
      throw new Error('page must not group tabs');
    },
    async ungroup(tabIds) {
      directMutations.ungroup.push(tabIds);
      throw new Error('page must not ungroup tabs');
    },
    async get() { return { id: 0, groupId: -1, windowId: 0 }; },
    async move() {},
    async query() { return []; },
    onAttached: createEventEmitter(),
    onCreated: createEventEmitter(),
    onDetached: createEventEmitter(),
    onMoved: createEventEmitter(),
    onRemoved: createEventEmitter(),
    onUpdated: createEventEmitter(),
  },
  tabGroups: {
    async query() { return []; },
    async update(groupId, props) {
      directMutations.update.push({ groupId, props });
      throw new Error('page must not update groups');
    },
    onCreated: createEventEmitter(),
    onRemoved: createEventEmitter(),
    onUpdated: createEventEmitter(),
  },
};

require('./chrome-tab-groups-sync.js');

const {
  loadChromeTabGroupsSetting,
  saveChromeTabGroupsSetting,
  loadChromeTabGroupState,
  syncChromeTabGroups,
  mergeChromeTabGroups,
  resetChromeGroupState,
  isChromeTabGroupsEnabled,
  getChromeGroupCount,
  getManagedChromeGroupIds,
  queryUserChromeGroups,
  getChromeGroupsLastError,
  populateChromeGroupMap,
  queryExistingChromeGroups,
  setImportMode,
  isImportMode,
  subscribeToChromeTabGroupChanges,
  loadPersistedChromeGroupMap,
  persistChromeGroupMap,
  reorderGroupedTabs,
  assignGroupColor,
  getGroupTitle,
  isGroupIdentityFree,
  pickUncollidingGroupColor,
  currentMappingCandidates,
  applyCoordinatorState,
  STORAGE_KEY,
} = globalThis.TabOutChromeTabGroups;

function stateFor(sessionMap = {}, liveGroups = []) {
  const windowIds = [...new Set(liveGroups.map(group => group.windowId))];
  return {
    sessionMap,
    mapping: sessionMap,
    liveGroups,
    windows: windowIds.map(windowId => ({
      windowId,
      nativeGroups: liveGroups.filter(group => group.windowId === windowId),
    })),
  };
}

function mappedGroup({
  id,
  windowId = 1,
  groupKey,
  origin = 'created',
  title = groupKey,
  color = 'grey',
  collapsed = false,
  tabIds = [id],
  queryComplete = true,
}) {
  return {
    id,
    groupId: id,
    windowId,
    title,
    color,
    collapsed,
    shared: false,
    minIndex: 0,
    tabIds,
    queryComplete,
    mappings: [{ groupKey, origin }],
  };
}

async function resetHarness() {
  await resetChromeGroupState();
  runtimeMessages.length = 0;
  directMutations.group.length = 0;
  directMutations.ungroup.length = 0;
  directMutations.update.length = 0;
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  globalThis.chrome.tabs.query = async () => [];
  globalThis.chrome.tabs.get = async () => ({ id: 0, groupId: -1, windowId: 0 });
  globalThis.chrome.tabs.move = async () => {};
  globalThis.chrome.tabGroups.query = async () => [];
  runtimeHandler = async (message) => ({
    ok: true,
    action: message.action === 'get-chrome-tab-group-state' ? 'get-state' :
      (message.action === 'merge-chrome-tab-groups' ? 'merge' : 'sync'),
    state: stateFor(),
  });
}

test('pure title and color helpers remain compatible', () => {
  assert.equal(assignGroupColor('__session_group__:g1', 5), 'blue');
  assert.equal(assignGroupColor('__landing-pages__', 3), 'yellow');
  assert.deepEqual(
    Array.from({ length: 8 }, (_, index) => assignGroupColor('example.com', index)),
    ['grey', 'red', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey']
  );
  assert.equal(getGroupTitle({ domain: 'example.com' }), 'Friendly example.com');
  assert.equal(getGroupTitle({ domain: 'example.com', label: 'Focus' }), 'Focus');
  assert.equal(getGroupTitle({ domain: '__landing-pages__' }), 'Homepages');
});

test('identity helpers stay pure for legacy dashboard callers', async () => {
  await resetHarness();
  const groups = [
    { id: 10, windowId: 1, title: 'Work', color: 'grey' },
    { id: 11, windowId: 2, title: 'Work', color: 'grey' },
  ];
  assert.equal(isGroupIdentityFree('Work', 'grey', 1, groups), false);
  assert.equal(isGroupIdentityFree('Work', 'red', 1, groups), true);
  assert.equal(pickUncollidingGroupColor('Work', 'grey', 1, groups), 'red');
  applyCoordinatorState(stateFor({ work: { 1: { groupId: 10, origin: 'adopted' } } }));
  assert.deepEqual(currentMappingCandidates('work', '1', groups), [{ windowId: 1, id: 10 }]);
});

test('setting storage stays local while initial ownership state loads from the coordinator', async () => {
  await resetHarness();
  const liveState = stateFor({ work: { 1: { groupId: 10, origin: 'created' } } });
  runtimeHandler = async () => ({ ok: true, action: 'get-state', state: liveState });

  assert.equal(await loadChromeTabGroupsSetting(), false);
  assert.equal(runtimeMessages[0].action, 'get-chrome-tab-group-state');
  assert.deepEqual([...getManagedChromeGroupIds()], [10]);
  assert.equal(getChromeGroupCount(), 1);

  assert.equal(await saveChromeTabGroupsSetting(true), true);
  assert.equal(mockStorage[STORAGE_KEY], true);
  assert.equal(isChromeTabGroupsEnabled(), true);
});

test('state compatibility aliases only request coordinator state and never persist page metadata', async () => {
  await resetHarness();
  const liveState = stateFor({ docs: { 2: { groupId: 20, origin: 'adopted' } } });
  runtimeHandler = async () => ({ ok: true, action: 'get-state', state: liveState });

  assert.deepEqual(await loadChromeTabGroupState(2), liveState);
  assert.deepEqual(await loadPersistedChromeGroupMap(), liveState);
  assert.equal(await persistChromeGroupMap(), liveState);
  await populateChromeGroupMap([{ virtualGroupKey: 'wrong', windowId: 9, chromeGroupId: 99 }]);

  assert.deepEqual([...getManagedChromeGroupIds()], [20]);
  assert.ok(runtimeMessages.every(message => message.action === 'get-chrome-tab-group-state'));
  assert.deepEqual(Object.keys(mockStorage), []);
});

test('an invalid coordinator ownership state is rejected without replacing the last good mapping', async () => {
  await resetHarness();
  applyCoordinatorState(stateFor({ safe: { 1: { groupId: 10, origin: 'created' } } }));
  runtimeHandler = async () => ({
    ok: true,
    action: 'get-state',
    state: stateFor({
      first: { 1: { groupId: 20, origin: 'created' } },
      second: { 1: { groupId: 20, origin: 'adopted' } },
    }),
  });

  assert.equal(await loadChromeTabGroupState(1), null);
  assert.deepEqual([...getManagedChromeGroupIds()], [10]);
  assert.match(getChromeGroupsLastError(), /invalid ownership state/);
});

test('automatic sync sends one desired payload per window through runtime messaging', async () => {
  await resetHarness();
  await saveChromeTabGroupsSetting(true);
  const liveState = stateFor({ mapped: { 1: { groupId: 50, origin: 'created' } } });
  runtimeHandler = async (message) => ({
    ok: true,
    action: message.action === 'get-chrome-tab-group-state' ? 'get-state' : 'sync',
    state: liveState,
    conflicts: [],
  });

  const result = await syncChromeTabGroups([
    { domain: 'github.com', tabs: [
      { id: 1, windowId: 1, groupId: -1 },
      { id: 2, windowId: 1, groupId: 99 },
    ] },
    { domain: 'mapped', label: 'Mapped', tabs: [{ id: 3, windowId: 1, groupId: 50 }] },
    { domain: '__manual_group__:x', isManual: true, tabs: [{ id: 4, windowId: 2, groupId: -1 }] },
    { domain: '__chrome_group__:77', isChromeGroup: true, tabs: [{ id: 5, windowId: 2, groupId: 77 }] },
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(runtimeMessages.map(message => message.action), [
    'get-chrome-tab-group-state',
    'sync-chrome-tab-groups',
    'sync-chrome-tab-groups',
  ]);
  assert.deepEqual(runtimeMessages[1], {
    action: 'sync-chrome-tab-groups',
    source: 'dashboard',
    payload: {
      windowId: 1,
      enabled: true,
      groups: [
        { groupKey: 'github.com', title: 'Friendly github.com', color: 'grey', collapsed: true, tabIds: [1] },
        { groupKey: 'mapped', title: 'Mapped', color: 'red', collapsed: true, tabIds: [3] },
      ],
    },
  });
  assert.deepEqual(runtimeMessages[2].payload, { windowId: 2, enabled: true, groups: [] });
  assert.deepEqual(directMutations, { group: [], ungroup: [], update: [] });
});

test('turning sync off asks the coordinator to dismantle every mapped window', async () => {
  await resetHarness();
  await saveChromeTabGroupsSetting(false);
  const liveState = stateFor({
    one: { 1: { groupId: 10, origin: 'created' } },
    two: { 2: { groupId: 20, origin: 'adopted' } },
  });
  runtimeHandler = async (message) => ({
    ok: true,
    action: message.action === 'get-chrome-tab-group-state' ? 'get-state' : 'sync',
    state: liveState,
    conflicts: [],
  });

  await syncChromeTabGroups([]);

  assert.deepEqual(runtimeMessages.slice(1).map(message => message.payload), [
    { windowId: 1, enabled: false, groups: [] },
    { windowId: 2, enabled: false, groups: [] },
  ]);
  assert.deepEqual(directMutations, { group: [], ungroup: [], update: [] });
});

test('sync preserves coordinator conflicts and diagnostics for the dashboard', async () => {
  await resetHarness();
  await saveChromeTabGroupsSetting(true);
  runtimeHandler = async (message) => message.action === 'get-chrome-tab-group-state'
    ? ({ ok: true, action: 'get-state', state: stateFor() })
    : ({
      ok: false,
      action: 'sync',
      conflicts: [{ groupKey: 'work', reason: 'multiple-candidates', candidates: [] }],
      state: stateFor(),
    });

  const result = await syncChromeTabGroups([
    { domain: 'work', tabs: [{ id: 1, windowId: 1, groupId: -1 }] },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].reason, 'multiple-candidates');
  assert.equal(getChromeGroupsLastError(), 'Chrome tab-group request failed');
});

test('merge is a thin coordinator client and applies returned ownership state', async () => {
  await resetHarness();
  const mergedState = stateFor({ work: { 1: { groupId: 10, origin: 'adopted' } } });
  runtimeHandler = async () => ({ ok: true, action: 'merge', state: mergedState });

  const result = await mergeChromeTabGroups({
    windowId: 1,
    targetGroupId: 10,
    sourceGroupIds: [11, 12],
    groupKey: 'work',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(runtimeMessages[0], {
    action: 'merge-chrome-tab-groups',
    source: 'dashboard',
    payload: { windowId: 1, targetGroupId: 10, sourceGroupIds: [11, 12], groupKey: 'work' },
  });
  assert.deepEqual([...getManagedChromeGroupIds()], [10]);
});

test('queryExistingChromeGroups remains a read-only compatibility helper', async () => {
  await resetHarness();
  globalThis.chrome.tabGroups.query = async () => [{ id: 1 }, { id: 2 }];
  assert.deepEqual(await queryExistingChromeGroups(), [{ id: 1 }, { id: 2 }]);
  globalThis.chrome.tabGroups.query = async () => { throw new Error('denied'); };
  assert.deepEqual(await queryExistingChromeGroups(), []);
});

test('queryUserChromeGroups excludes mapped groups and sorts remaining groups by strip position', async () => {
  await resetHarness();
  applyCoordinatorState(stateFor({ managed: { 1: { groupId: 10, origin: 'created' } } }));
  globalThis.chrome.tabGroups.query = async () => [
    { id: 10, windowId: 1, title: 'Managed', color: 'grey' },
    { id: 11, windowId: 1, title: 'Later', color: 'red', collapsed: true },
    { id: 12, windowId: 1, title: 'Earlier', color: 'blue', collapsed: false },
  ];
  globalThis.chrome.tabs.query = async ({ groupId }) => ({
    10: [{ id: 1, index: 0 }],
    11: [{ id: 2, index: 8 }],
    12: [{ id: 3, index: 3 }],
  }[groupId] || []);

  const result = await queryUserChromeGroups(1);

  assert.deepEqual(result.map(group => group.id), [12, 11]);
  assert.deepEqual(result[0].tabIds, [3]);
  assert.equal(result[0].minIndex, 3);
  assert.equal(getChromeGroupsLastError(), '');
});

test('queryUserChromeGroups retains other groups and a diagnostic after one member query fails', async () => {
  await resetHarness();
  globalThis.chrome.tabGroups.query = async () => [
    { id: 11, windowId: 1, title: 'Broken', color: 'red' },
    { id: 12, windowId: 1, title: 'Good', color: 'blue' },
  ];
  globalThis.chrome.tabs.query = async ({ groupId }) => {
    if (groupId === 11) throw new Error('member denied');
    return [{ id: 3, index: 2 }];
  };

  const originalWarn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = await queryUserChromeGroups(1);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(result.map(group => group.id), [12]);
  assert.match(getChromeGroupsLastError(), /member denied/);
});

test('queryUserChromeGroups distinguishes a global query failure from an empty result', async () => {
  await resetHarness();
  globalThis.chrome.tabGroups.query = async () => { throw new Error('groups denied'); };
  const originalWarn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = await queryUserChromeGroups(1);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(result, []);
  assert.match(getChromeGroupsLastError(), /groups denied/);
});

test('reorderGroupedTabs normalizes ids and delegates ordering to the coordinator', async () => {
  await resetHarness();

  const result = await reorderGroupedTabs(10, ['1', '2'], 7);

  assert.equal(result.ok, true);
  assert.deepEqual(runtimeMessages[0], {
    action: 'merge-chrome-tab-groups',
    source: 'dashboard',
    payload: {
      operation: 'reorder',
      windowId: 7,
      targetGroupId: 10,
      tabIds: [1, 2],
    },
  });
});

test('reorderGroupedTabs leaves live-member filtering to the serialized coordinator', async () => {
  await resetHarness();

  await reorderGroupedTabs(10, [2, 99, 1], 1);

  assert.deepEqual(runtimeMessages[0].payload.tabIds, [2, 99, 1]);
  assert.equal(runtimeMessages[0].payload.targetGroupId, 10);
});

test('event subscription forwards group changes with the full one-argument payload', async () => {
  await resetHarness();
  const events = [];
  const unsubscribe = subscribeToChromeTabGroupChanges(event => events.push(event));
  const group = { id: 10, windowId: 1, title: 'Work', collapsed: true };

  globalThis.chrome.tabGroups.onUpdated.emit(group);

  assert.equal(events[0].source, 'tabGroups.onUpdated');
  assert.deepEqual(events[0].group, group);
  unsubscribe();
});

test('event subscription keeps read-only created and membership notifications', async () => {
  await resetHarness();
  const events = [];
  const unsubscribe = subscribeToChromeTabGroupChanges(event => events.push(event));

  globalThis.chrome.tabGroups.onCreated.emit({ id: 10, windowId: 1, title: 'Work' });
  globalThis.chrome.tabs.onUpdated.emit(1, { groupId: 10 }, { id: 1, groupId: 10, windowId: 1 });

  assert.deepEqual(events.map(event => event.source), [
    'tabGroups.onCreated',
    'tabs.onUpdated',
  ]);
  unsubscribe();
});

test('storage setting changes update stale dashboard clients and notify subscribers', async () => {
  await resetHarness();
  await saveChromeTabGroupsSetting(true);
  const events = [];
  const unsubscribe = subscribeToChromeTabGroupChanges(event => events.push(event));

  globalThis.chrome.storage.onChanged.emit({
    [STORAGE_KEY]: { oldValue: true, newValue: false },
  }, 'local');

  assert.equal(isChromeTabGroupsEnabled(), false);
  assert.deepEqual(events.at(-1), { source: 'storage.onChanged', enabled: false });
  unsubscribe();
});

test('event subscription only forwards moved tabs that are currently grouped', async () => {
  await resetHarness();
  const events = [];
  const unsubscribe = subscribeToChromeTabGroupChanges(event => events.push(event));
  globalThis.chrome.tabs.get = async id => ({ id, groupId: id === 1 ? 10 : -1, windowId: 1 });

  globalThis.chrome.tabs.onMoved.emit(1, { windowId: 1, fromIndex: 1, toIndex: 2 });
  globalThis.chrome.tabs.onMoved.emit(2, { windowId: 1, fromIndex: 2, toIndex: 3 });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(events.map(event => event.tabId), [1]);
  unsubscribe();
});

test('import-mode compatibility state remains local', async () => {
  await resetHarness();
  setImportMode(true);
  assert.equal(isImportMode(), true);
  setImportMode(false);
  assert.equal(isImportMode(), false);
});

test('page client contains no legacy metadata or direct group ownership mutations', () => {
  const source = fs.readFileSync(path.join(__dirname, 'chrome-tab-groups-sync.js'), 'utf8');
  assert.doesNotMatch(source, /chromeTabGroupsMeta/);
  assert.doesNotMatch(source, /chrome\.tabs\.(?:group|ungroup)\s*\(/);
  assert.doesNotMatch(source, /chrome\.tabs\.move\s*\(/);
  assert.doesNotMatch(source, /chrome\.tabGroups\.update\s*\(/);
  assert.match(source, /chrome\.runtime\.sendMessage\s*\(/);
});

test('dashboard lifecycle never auto-collapses native Chrome groups', () => {
  const clientSource = fs.readFileSync(path.join(__dirname, 'chrome-tab-groups-sync.js'), 'utf8');
  const runtimeSource = fs.readFileSync(path.join(__dirname, 'dashboard-runtime.js'), 'utf8');
  for (const source of [clientSource, runtimeSource]) {
    assert.doesNotMatch(source, /collapseChromeGroupsForCurrentTabHarborTab/);
    assert.doesNotMatch(source, /collapseChromeTabGroupsInWindow/);
    assert.doesNotMatch(source, /syncChromeTabGroupExpansionForTab/);
  }
});
