'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SESSION_MAP_KEY,
  LEGACY_LOCAL_META_KEY,
  createChromeTabGroupsCoordinator,
} = require('./chrome-tab-groups-coordinator.js');
const {
  buildAutomaticChromeSyncSnapshot,
} = require('./automatic-tab-groups.js');

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createChromeMock({
  groups = [],
  tabs = [],
  sessionMap = {},
  legacyMeta = undefined,
  nextGroupId = 100,
} = {}) {
  const state = {
    groups: groups.map(group => ({ collapsed: false, shared: false, color: 'grey', ...group })),
    tabs: tabs.map(tab => ({ pinned: false, groupId: -1, ...tab })),
    session: { [SESSION_MAP_KEY]: deepClone(sessionMap) },
    local: legacyMeta === undefined ? {} : { [LEGACY_LOCAL_META_KEY]: deepClone(legacyMeta) },
    failGlobalGroupQuery: false,
    failGlobalTabQuery: false,
    failGroupQueries: new Set(),
    groupQueryOverrides: new Map(),
    queryDelayMs: 0,
    activeGlobalQueries: 0,
    maxActiveGlobalQueries: 0,
  };
  const calls = {
    sessionGet: [],
    sessionSet: [],
    localRemove: [],
    groupQuery: [],
    tabQuery: [],
    group: [],
    update: [],
    ungroup: [],
    move: [],
  };

  function removeEmptyGroups() {
    const populated = new Set(state.tabs.filter(tab => tab.groupId >= 0).map(tab => tab.groupId));
    state.groups = state.groups.filter(group => populated.has(group.id));
  }

  const chromeApi = {
    storage: {
      session: {
        async get(key) {
          calls.sessionGet.push(key);
          return { [key]: deepClone(state.session[key]) };
        },
        async set(items) {
          calls.sessionSet.push(deepClone(items));
          Object.assign(state.session, deepClone(items));
        },
      },
      local: {
        async remove(key) {
          calls.localRemove.push(key);
          delete state.local[key];
        },
      },
    },
    tabGroups: {
      async query(queryInfo = {}) {
        calls.groupQuery.push(deepClone(queryInfo));
        state.activeGlobalQueries += 1;
        state.maxActiveGlobalQueries = Math.max(state.maxActiveGlobalQueries, state.activeGlobalQueries);
        try {
          if (state.queryDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, state.queryDelayMs));
          }
          if (state.failGlobalGroupQuery) throw new Error('tabGroups.query failed');
          return state.groups
            .filter(group => queryInfo.windowId == null || Number(group.windowId) === Number(queryInfo.windowId))
            .map(deepClone);
        } finally {
          state.activeGlobalQueries -= 1;
        }
      },
      async update(groupId, props) {
        calls.update.push({ groupId, props: deepClone(props) });
        const group = state.groups.find(item => item.id === groupId);
        if (!group) throw new Error('No group with id');
        Object.assign(group, props);
        return deepClone(group);
      },
    },
    tabs: {
      async query(queryInfo = {}) {
        calls.tabQuery.push(deepClone(queryInfo));
        if (queryInfo.groupId != null) {
          if (state.failGroupQueries.has(Number(queryInfo.groupId))) {
            throw new Error(`tabs.query failed for ${queryInfo.groupId}`);
          }
          if (state.groupQueryOverrides.has(Number(queryInfo.groupId))) {
            return deepClone(state.groupQueryOverrides.get(Number(queryInfo.groupId)));
          }
          return state.tabs
            .filter(tab => Number(tab.groupId) === Number(queryInfo.groupId))
            .map(deepClone);
        }
        if (state.failGlobalTabQuery) throw new Error('tabs.query window failed');
        return state.tabs
          .filter(tab => queryInfo.windowId == null || Number(tab.windowId) === Number(queryInfo.windowId))
          .map(deepClone);
      },
      async group(options) {
        calls.group.push(deepClone(options));
        const tabIds = [].concat(options.tabIds || []).map(Number);
        const targetId = options.groupId == null ? nextGroupId++ : Number(options.groupId);
        if (options.groupId == null) {
          const firstTab = state.tabs.find(tab => tabIds.includes(tab.id));
          state.groups.push({
            id: targetId,
            windowId: Number(options.createProperties?.windowId ?? firstTab?.windowId ?? 0),
            title: '',
            color: 'grey',
            collapsed: false,
            shared: false,
          });
        }
        for (const tab of state.tabs) {
          if (tabIds.includes(tab.id)) tab.groupId = targetId;
        }
        removeEmptyGroups();
        return targetId;
      },
      async ungroup(tabIds) {
        const ids = [].concat(tabIds || []).map(Number);
        calls.ungroup.push(ids);
        for (const tab of state.tabs) {
          if (ids.includes(tab.id)) tab.groupId = -1;
        }
        removeEmptyGroups();
      },
      async move(tabId, moveProperties) {
        calls.move.push({ tabId, ...deepClone(moveProperties) });
        const tab = state.tabs.find(item => item.id === Number(tabId));
        if (tab) tab.index = Number(moveProperties.index);
        return tab ? deepClone(tab) : null;
      },
    },
  };

  return { chromeApi, state, calls };
}

function desired(groupKey, title, tabIds, extra = {}) {
  return { groupKey, title, tabIds, color: 'green', collapsed: true, ...extra };
}

function expectedGroup(groupId, title, color, tabs) {
  return {
    groupId,
    title,
    color,
    tabs: tabs.map(tab => ({
      tabId: typeof tab === 'object' ? tab.id : tab,
      url: typeof tab === 'object' ? String(tab.url || '') : '',
    })),
  };
}

test('rejects malformed actions before reading or writing Chrome state', async () => {
  const mock = createChromeMock();
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.dispatch({ action: 'sync', windowId: 1, groups: 'bad' });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_PAYLOAD');
  assert.equal(mock.calls.sessionGet.length, 0);
  assert.equal(mock.calls.groupQuery.length, 0);
  assert.equal(mock.calls.group.length, 0);
});

test('rejects reserved logical group keys before reading Chrome state', async () => {
  const mock = createChromeMock();
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    groups: [desired('__proto__', 'Unsafe', [1])],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_PAYLOAD');
  assert.equal(mock.calls.sessionGet.length, 0);
  assert.equal(mock.calls.groupQuery.length, 0);
});

test('rejects reserved keys already present in session storage', async () => {
  const mock = createChromeMock({
    sessionMap: JSON.parse('{"__proto__":{"1":{"groupId":10,"origin":"adopted"}}}'),
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.getState({ windowId: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_STORED_STATE');
  assert.equal(mock.calls.groupQuery.length, 0);
  assert.equal(mock.calls.sessionSet.length, 0);
});

test('round-trips Object.prototype-named group keys and removes them as created groups', async () => {
  const mock = createChromeMock({
    tabs: [
      { id: 1, windowId: 1, index: 0, url: 'https://to-string.test/' },
      { id: 2, windowId: 1, index: 1, url: 'https://value-of.test/' },
    ],
  });
  const firstCoordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });
  const groups = [
    desired('toString', 'To string', [1]),
    desired('valueOf', 'Value of', [2]),
  ];

  const created = await firstCoordinator.sync({ windowId: 1, groups });

  assert.equal(created.ok, true);
  assert.deepEqual(created.results.map(result => result.status), ['created', 'created']);
  assert.equal(Object.getPrototypeOf(created.state.sessionMap), null);
  assert.equal(Object.getPrototypeOf(created.state.sessionMap.toString), null);
  for (const groupKey of ['toString', 'valueOf']) {
    assert.equal(Object.prototype.hasOwnProperty.call(created.state.sessionMap, groupKey), true);
    assert.equal(created.state.sessionMap[groupKey]['1'].origin, 'created');
    assert.equal(Object.prototype.hasOwnProperty.call(mock.state.session[SESSION_MAP_KEY], groupKey), true);
    assert.equal(mock.state.session[SESSION_MAP_KEY][groupKey]['1'].origin, 'created');
  }

  const reloadedCoordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });
  const reused = await reloadedCoordinator.sync({ windowId: 1, groups });

  assert.equal(reused.ok, true);
  assert.deepEqual(reused.results.map(result => result.status), ['reused', 'reused']);
  assert.equal(mock.calls.group.length, 2);
  for (const groupKey of ['toString', 'valueOf']) {
    assert.equal(reused.state.sessionMap[groupKey]['1'].origin, 'created');
  }

  const disabled = await reloadedCoordinator.sync({ windowId: 1, enabled: false, groups: [] });

  assert.equal(disabled.ok, true);
  assert.deepEqual(
    disabled.results.map(result => [result.groupKey, result.status]),
    [['toString', 'removed-created'], ['valueOf', 'removed-created']]
  );
  assert.deepEqual(mock.calls.ungroup, [[1], [2]]);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {});
});

test('rejects a session map that binds one native group to two logical groups', async () => {
  const mock = createChromeMock({
    tabs: [{ id: 1, windowId: 1, index: 0, groupId: 10 }],
    sessionMap: {
      one: { 1: { groupId: 10, origin: 'created' } },
      two: { 1: { groupId: 10, origin: 'adopted' } },
    },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    groups: [desired('one', 'One', [1])],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_STORED_STATE');
  assert.equal(mock.calls.groupQuery.length, 0);
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.sessionSet.length, 0);
});

test('coalesces queued syncs for one window to the latest snapshot', async () => {
  const mock = createChromeMock({
    tabs: [
      { id: 1, windowId: 1, index: 0 },
      { id: 2, windowId: 1, index: 1 },
    ],
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const first = coordinator.sync({
    windowId: 1,
    groups: [desired('work', 'Old snapshot', [1])],
  });
  const second = coordinator.sync({
    windowId: 1,
    groups: [desired('work', 'Latest snapshot', [2])],
  });
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(firstResult, secondResult);
  assert.equal(mock.calls.group.length, 1);
  assert.deepEqual(mock.calls.group[0], { tabIds: [2] });
  assert.equal(mock.calls.update[0].props.title, 'Latest snapshot');
});

test('serializes operations globally across windows', async () => {
  const mock = createChromeMock({
    tabs: [
      { id: 1, windowId: 1, index: 0 },
      { id: 2, windowId: 2, index: 0 },
    ],
  });
  mock.state.queryDelayMs = 8;
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  await Promise.all([
    coordinator.sync({ windowId: 1, groups: [desired('one', 'One', [1])] }),
    coordinator.sync({ windowId: 2, groups: [desired('two', 'Two', [2])] }),
  ]);

  assert.equal(mock.state.maxActiveGlobalQueries, 1);
  assert.equal(mock.calls.group.length, 2);
});

test('adopts the only safe candidate and preserves its appearance', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'Work', color: 'blue', collapsed: false },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 2, groupId: 10 },
      { id: 2, windowId: 1, index: 4, groupId: -1 },
    ],
    // A legacy fingerprint deliberately points elsewhere. It must be removed,
    // never used to choose a cross-restart group.
    legacyMeta: { work: { 999: { title: 'Wrong', color: 'red' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    groups: [desired('work', 'Work', [1, 2], { color: 'green', collapsed: true })],
  });

  assert.equal(result.ok, true);
  assert.equal(result.results[0].status, 'adopted');
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    work: { 1: { groupId: 10, origin: 'adopted' } },
  });
  assert.deepEqual(mock.calls.group, [{ groupId: 10, tabIds: [2] }], 'only the missing tab is joined');
  assert.equal(mock.calls.update.length, 0, 'adopted appearance/collapse is untouched');
  assert.equal(mock.state.groups[0].color, 'blue');
  assert.equal(mock.state.groups[0].collapsed, false);
  assert.deepEqual(result.state.liveGroups[0].tabIds, [1, 2], 'sync returns the refreshed live membership');
  assert.equal(result.state.liveGroups[0].mappings[0].origin, 'adopted');
  assert.deepEqual(mock.calls.localRemove, [LEGACY_LOCAL_META_KEY]);
  assert.equal(LEGACY_LOCAL_META_KEY in mock.state.local, false);
});

test('freezes and retains an adopted mapping when its live title no longer matches', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Renamed by user', color: 'blue' }],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10 },
      { id: 2, windowId: 1, index: 1, groupId: -1 },
    ],
    sessionMap: { work: { 1: { groupId: 10, origin: 'adopted' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    preserveGroupKeys: ['work'],
    groups: [desired('work', 'Work', [1, 2])],
  });

  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].reason, 'adopted-title-mismatch');
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    work: { 1: { groupId: 10, origin: 'adopted' } },
  });
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.update.length, 0);
  assert.equal(mock.calls.ungroup.length, 0);
});

test('creates and manages a group only when no candidate exists', async () => {
  const mock = createChromeMock({
    tabs: [{ id: 1, windowId: 1, index: 0 }],
    nextGroupId: 20,
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    groups: [desired('docs', 'Docs', [1], { color: 'purple', collapsed: false })],
  });

  assert.equal(result.ok, true);
  assert.equal(result.results[0].status, 'created');
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    docs: { 1: { groupId: 20, origin: 'created' } },
  });
  assert.deepEqual(mock.calls.group, [{ tabIds: [1] }]);
  assert.equal(mock.state.tabs[0].groupId, 20, 'tabs.group places the tab in the new native group');
  assert.deepEqual(mock.calls.update, [{
    groupId: 20,
    props: { title: 'Docs', color: 'purple', collapsed: false },
  }]);
  assert.equal(result.state.liveGroups[0].id, 20);
  assert.deepEqual(result.state.liveGroups[0].tabIds, [1]);
});

test('created groups apply collapsed only at creation and preserve later user changes', async () => {
  const mock = createChromeMock({
    tabs: [{ id: 1, windowId: 1, index: 0 }],
    nextGroupId: 20,
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const created = await coordinator.sync({
    windowId: 1,
    groups: [desired('docs', 'Docs', [1], { color: 'purple', collapsed: true })],
  });

  assert.equal(created.ok, true);
  assert.equal(created.results[0].status, 'created');
  assert.equal(mock.state.tabs[0].groupId, 20);
  assert.deepEqual(mock.calls.update[0], {
    groupId: 20,
    props: { title: 'Docs', color: 'purple', collapsed: true },
  });

  // Simulate the user expanding the native group in Chrome. A later desired
  // snapshot still carries the dashboard's default `collapsed: true`, but the
  // coordinator must not write that stale preference again.
  mock.state.groups[0].collapsed = false;
  const reused = await coordinator.sync({
    windowId: 1,
    groups: [desired('docs', 'Renamed Docs', [1], { color: 'yellow', collapsed: true })],
  });

  assert.equal(reused.ok, true);
  assert.equal(reused.results[0].status, 'reused');
  assert.deepEqual(mock.calls.group, [{ tabIds: [1] }], 'reuse does not recreate or regroup existing members');
  assert.deepEqual(mock.calls.update[1], {
    groupId: 20,
    props: { title: 'Renamed Docs', color: 'yellow' },
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(mock.calls.update[1].props, 'collapsed'),
    false,
  );
  assert.equal(mock.state.groups[0].collapsed, false, 'the user-expanded state survives routine sync');

  mock.state.groups[0].collapsed = true;
  const reusedAfterUserCollapse = await coordinator.sync({
    windowId: 1,
    groups: [desired('docs', 'Renamed Docs', [1], { color: 'yellow', collapsed: false })],
  });

  assert.equal(reusedAfterUserCollapse.ok, true);
  assert.equal(
    mock.calls.update.length,
    2,
    'an identical title/color snapshot does not emit a no-op tabGroups.update echo',
  );
  assert.equal(mock.state.groups[0].collapsed, true, 'the user-collapsed state also survives routine sync');
});

test('moves a drifted tab from a created group into a new domain group in one sync', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Alpha', color: 'green' }],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10 },
      { id: 2, windowId: 1, index: 1, groupId: 10 },
    ],
    sessionMap: { alpha: { 1: { groupId: 10, origin: 'created' } } },
    nextGroupId: 20,
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    preserveGroupKeys: ['alpha'],
    groups: [
      desired('alpha', 'Alpha', [1]),
      desired('beta', 'Beta', [2], { color: 'purple' }),
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(mock.calls.group, [{ tabIds: [2] }]);
  assert.equal(mock.state.tabs.find(tab => tab.id === 1).groupId, 10);
  assert.equal(mock.state.tabs.find(tab => tab.id === 2).groupId, 20);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    alpha: { 1: { groupId: 10, origin: 'created' } },
    beta: { 1: { groupId: 20, origin: 'created' } },
  });
  assert.equal(result.results.find(item => item.groupKey === 'alpha').status, 'reused');
  assert.equal(result.results.find(item => item.groupKey === 'beta').status, 'created');
});

test('automatic snapshot and coordinator converge a created cross-domain navigation end to end', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'alpha.test', color: 'grey' }],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10, url: 'https://alpha.test/stays' },
      { id: 2, windowId: 1, index: 1, groupId: 10, url: 'https://beta.test/navigated' },
    ],
    sessionMap: { 'alpha.test': { 1: { groupId: 10, origin: 'created' } } },
    nextGroupId: 20,
  });
  const snapshot = buildAutomaticChromeSyncSnapshot({
    windowId: 1,
    tabs: mock.state.tabs,
    nativeGroups: [{
      ...mock.state.groups[0],
      queryComplete: true,
      minIndex: 0,
      tabIds: [1, 2],
      mappings: [{ groupKey: 'alpha.test', origin: 'created' }],
    }],
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({ enabled: true, allWindows: false, ...snapshot });

  assert.deepEqual(snapshot.preserveGroupKeys, ['alpha.test']);
  assert.deepEqual(snapshot.groups.map(group => [group.groupKey, group.tabIds]), [
    ['alpha.test', [1]],
    ['beta.test', [2]],
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(mock.calls.group, [{ tabIds: [2] }]);
  assert.equal(mock.state.tabs.find(tab => tab.id === 1).groupId, 10);
  assert.equal(mock.state.tabs.find(tab => tab.id === 2).groupId, 20);
});

test('manual session assignment blocks a created cross-domain relocation end to end', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'alpha.test', color: 'grey' }],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10, url: 'https://alpha.test/stays' },
      { id: 2, windowId: 1, index: 1, groupId: 10, url: 'https://beta.test/navigated' },
    ],
    sessionMap: { 'alpha.test': { 1: { groupId: 10, origin: 'created' } } },
  });
  const snapshot = buildAutomaticChromeSyncSnapshot({
    windowId: 1,
    tabs: mock.state.tabs,
    nativeGroups: [{
      ...mock.state.groups[0],
      queryComplete: true,
      minIndex: 0,
      tabIds: [1, 2],
      mappings: [{ groupKey: 'alpha.test', origin: 'created' }],
    }],
    sessionGroups: {
      groups: [{ id: 'manual' }],
      assignments: { 2: 'manual' },
    },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({ enabled: true, allWindows: false, ...snapshot });

  assert.deepEqual(snapshot.preserveGroupKeys, ['alpha.test']);
  assert.deepEqual(snapshot.groups.map(group => [group.groupKey, group.tabIds]), [
    ['alpha.test', [1]],
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.conflicts.some(conflict =>
    conflict.groupKey === 'alpha.test' && conflict.reason === 'mapped-group-has-unrelated-tabs'
  ), true);
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.ungroup.length, 0);
  assert.equal(mock.calls.update.length, 0);
  assert.equal(mock.calls.move.length, 0);
  assert.equal(mock.state.tabs.every(tab => tab.groupId === 10), true);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    'alpha.test': { 1: { groupId: 10, origin: 'created' } },
  });
});

test('prunes an emptied created source mapping in the same relocation round', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Alpha', color: 'green' }],
    tabs: [{ id: 1, windowId: 1, index: 0, groupId: 10 }],
    sessionMap: { alpha: { 1: { groupId: 10, origin: 'created' } } },
    nextGroupId: 20,
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    preserveGroupKeys: ['alpha'],
    groups: [desired('beta', 'Beta', [1])],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(mock.calls.group, [{ tabIds: [1] }]);
  assert.equal(mock.state.groups.some(group => group.id === 10), false);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    beta: { 1: { groupId: 20, origin: 'created' } },
  });
  assert.deepEqual(deepClone(result.state.sessionMap), mock.state.session[SESSION_MAP_KEY]);
});

test('moves a drifted created tab into an existing mapped destination', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'Alpha', color: 'green' },
      { id: 20, windowId: 1, title: 'Beta', color: 'green' },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10 },
      { id: 2, windowId: 1, index: 1, groupId: 20 },
    ],
    sessionMap: {
      alpha: { 1: { groupId: 10, origin: 'created' } },
      beta: { 1: { groupId: 20, origin: 'created' } },
    },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    preserveGroupKeys: ['alpha'],
    groups: [desired('beta', 'Beta', [1, 2])],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(mock.calls.group, [{ groupId: 20, tabIds: [1] }]);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    beta: { 1: { groupId: 20, origin: 'created' } },
  });
  assert.equal(result.results.find(item => item.groupKey === 'beta').status, 'reused');
});

test('moves a drifted created tab into the only safe adopted destination', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'Alpha', color: 'green' },
      { id: 20, windowId: 1, title: 'Beta', color: 'blue', collapsed: true },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10 },
      { id: 2, windowId: 1, index: 1, groupId: 20 },
    ],
    sessionMap: { alpha: { 1: { groupId: 10, origin: 'created' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    preserveGroupKeys: ['alpha'],
    groups: [desired('beta', 'Beta', [1, 2])],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(mock.calls.group, [{ groupId: 20, tabIds: [1] }]);
  assert.equal(mock.calls.update.length, 0, 'the adopted destination appearance stays untouched');
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    beta: { 1: { groupId: 20, origin: 'adopted' } },
  });
  assert.equal(result.results.find(item => item.groupKey === 'beta').status, 'adopted');
  assert.equal(mock.state.groups.find(group => group.id === 20).color, 'blue');
  assert.equal(mock.state.groups.find(group => group.id === 20).collapsed, true);
});

test('never relocates a tab out of an adopted or incompletely queried source group', async () => {
  for (const source of [
    { name: 'adopted', origin: 'adopted', failQuery: false },
    { name: 'incomplete', origin: 'created', failQuery: true },
  ]) {
    const mock = createChromeMock({
      groups: [{ id: 10, windowId: 1, title: 'Alpha', color: 'blue' }],
      tabs: [
        { id: 1, windowId: 1, index: 0, groupId: 10 },
        { id: 2, windowId: 1, index: 1, groupId: 10 },
      ],
      sessionMap: { alpha: { 1: { groupId: 10, origin: source.origin } } },
      nextGroupId: 20,
    });
    if (source.failQuery) mock.state.failGroupQueries.add(10);
    const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

    const result = await coordinator.sync({
      windowId: 1,
      preserveGroupKeys: ['alpha'],
      groups: [
        desired('alpha', 'Alpha', [1]),
        desired('beta', 'Beta', [2]),
      ],
    });

    assert.equal(result.ok, false, source.name);
    assert.equal(mock.calls.group.length, 0, source.name);
    assert.equal(mock.calls.ungroup.length, 0, source.name);
    assert.equal(mock.calls.update.length, 0, source.name);
    assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
      alpha: { 1: { groupId: 10, origin: source.origin } },
    }, source.name);
    assert.equal(mock.state.tabs.every(tab => tab.groupId === 10), true, source.name);
  }
});

test('a failed relocation destination query cancels source and destination writes', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'Old Alpha', color: 'red' },
      { id: 20, windowId: 1, title: 'Beta', color: 'blue' },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10 },
      { id: 2, windowId: 1, index: 1, groupId: 10 },
      { id: 3, windowId: 1, index: 2, groupId: 20 },
    ],
    sessionMap: { alpha: { 1: { groupId: 10, origin: 'created' } } },
  });
  mock.state.failGroupQueries.add(20);
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    preserveGroupKeys: ['alpha'],
    groups: [
      desired('alpha', 'Alpha', [1], { color: 'green' }),
      desired('beta', 'Beta', [2, 3], { color: 'purple' }),
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.conflicts.some(conflict =>
    conflict.groupKey === 'beta' && conflict.reason === 'group-query-failed'
  ), true);
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.ungroup.length, 0);
  assert.equal(mock.calls.update.length, 0, 'the source appearance update is dependency-cancelled');
  assert.equal(mock.calls.move.length, 0);
  assert.equal(mock.state.tabs.every(tab => tab.groupId === (tab.id === 3 ? 20 : 10)), true);
  assert.equal(mock.state.groups.find(group => group.id === 10).title, 'Old Alpha');
  assert.equal(mock.state.groups.find(group => group.id === 10).color, 'red');
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    alpha: { 1: { groupId: 10, origin: 'created' } },
  });
});

test('returns a conflict with complete candidates instead of creating N+1', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'Work', color: 'blue' },
      { id: 11, windowId: 1, title: 'Work', color: 'red' },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 3, groupId: 10 },
      { id: 2, windowId: 1, index: 1, groupId: 11 },
    ],
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    groups: [desired('work', 'Work', [1, 2])],
  });

  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].reason, 'multiple-candidates');
  assert.deepEqual(
    result.conflicts[0].candidates.map(item => item.groupId),
    [11, 10],
    'candidate order follows the live tab strip rather than query order',
  );
  for (const candidate of result.conflicts[0].candidates) {
    assert.equal(typeof candidate.title, 'string');
    assert.equal(typeof candidate.color, 'string');
    assert.ok(Array.isArray(candidate.tabIds));
    assert.equal(candidate.queryComplete, true);
  }
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.update.length, 0);
});

test('an existing mapping still surfaces a second safe same-name group for explicit merge', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'Work', color: 'blue' },
      { id: 11, windowId: 1, title: 'Work', color: 'red' },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 4, groupId: 10 },
      { id: 2, windowId: 1, index: 1, groupId: 11 },
    ],
    sessionMap: { work: { 1: { groupId: 10, origin: 'created' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    groups: [desired('work', 'Work', [1, 2])],
  });

  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].reason, 'multiple-candidates');
  assert.deepEqual(result.conflicts[0].candidates.map(item => item.groupId), [11, 10]);
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.ungroup.length, 0);
  assert.equal(mock.calls.update.length, 0);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    work: { 1: { groupId: 10, origin: 'created' } },
  });
});

test('global query failure makes the whole sync round zero-write', async () => {
  const mock = createChromeMock({
    tabs: [{ id: 1, windowId: 1, index: 0 }],
    sessionMap: { old: { 1: { groupId: 10, origin: 'created' } } },
    legacyMeta: { old: { title: 'Old', color: 'grey' } },
  });
  mock.state.failGlobalGroupQuery = true;
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    groups: [desired('docs', 'Docs', [1])],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'GLOBAL_QUERY_FAILED');
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.update.length, 0);
  assert.equal(mock.calls.ungroup.length, 0);
  assert.equal(mock.calls.sessionSet.length, 0);
  assert.equal(mock.calls.localRemove.length, 0);
});

test('global tab snapshot failure also makes the whole sync round zero-write', async () => {
  const mock = createChromeMock({
    tabs: [{ id: 1, windowId: 1, index: 0 }],
    sessionMap: { old: { 1: { groupId: 10, origin: 'created' } } },
    legacyMeta: { old: { title: 'Old', color: 'grey' } },
  });
  mock.state.failGlobalTabQuery = true;
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    groups: [desired('docs', 'Docs', [1])],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'GLOBAL_QUERY_FAILED');
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.update.length, 0);
  assert.equal(mock.calls.ungroup.length, 0);
  assert.equal(mock.calls.sessionSet.length, 0);
  assert.equal(mock.calls.localRemove.length, 0);
});

test('a failed group query freezes only related logical groups', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Work', color: 'blue' }],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10 },
      { id: 2, windowId: 1, index: 2, groupId: -1 },
    ],
    nextGroupId: 20,
  });
  mock.state.failGroupQueries.add(10);
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    groups: [
      desired('work', 'Work', [1]),
      desired('docs', 'Docs', [2]),
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].groupKey, 'work');
  assert.equal(result.conflicts[0].reason, 'group-query-failed');
  assert.equal(result.conflicts[0].candidates[0].queryComplete, false);
  assert.deepEqual(mock.calls.group, [{ tabIds: [2] }]);
  assert.equal(result.results.find(item => item.groupKey === 'docs').status, 'created');
});

test('an inconsistent member snapshot is treated like a failed group query and never creates a replacement', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Work', color: 'blue' }],
    tabs: [{ id: 1, windowId: 1, index: 0, groupId: 10 }],
  });
  mock.state.groupQueryOverrides.set(10, []);
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    groups: [desired('work', 'Work', [1])],
  });

  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].reason, 'group-query-failed');
  assert.match(result.conflicts[0].candidates[0].tabQueryError, /inconsistent/);
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.update.length, 0);
});

test('enabled false dismantles created groups but preserves adopted groups and mappings', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'Created', color: 'green' },
      { id: 11, windowId: 1, title: 'Adopted', color: 'blue' },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10 },
      { id: 2, windowId: 1, index: 1, groupId: 11 },
    ],
    sessionMap: {
      created: { 1: { groupId: 10, origin: 'created' } },
      adopted: { 1: { groupId: 11, origin: 'adopted' } },
    },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({ windowId: 1, enabled: false });

  assert.equal(result.ok, true);
  assert.deepEqual(mock.calls.ungroup, [[1]]);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    adopted: { 1: { groupId: 11, origin: 'adopted' } },
  });
  assert.equal(mock.state.tabs.find(tab => tab.id === 2).groupId, 11);
  assert.equal(mock.calls.update.length, 0);
  assert.deepEqual(result.state.liveGroups.map(group => group.id), [11]);
});

test('all-window disable dismantles created groups in every mapped window', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'One', color: 'green' },
      { id: 20, windowId: 2, title: 'Two', color: 'purple' },
      { id: 21, windowId: 2, title: 'Kept', color: 'blue' },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10 },
      { id: 2, windowId: 2, index: 0, groupId: 20 },
      { id: 3, windowId: 2, index: 1, groupId: 21 },
    ],
    sessionMap: {
      one: { 1: { groupId: 10, origin: 'created' } },
      two: { 2: { groupId: 20, origin: 'created' } },
      kept: { 2: { groupId: 21, origin: 'adopted' } },
    },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({ windowId: 1, enabled: false, allWindows: true });

  assert.equal(result.ok, true);
  assert.deepEqual(mock.calls.ungroup, [[1], [2]]);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    kept: { 2: { groupId: 21, origin: 'adopted' } },
  });
  assert.deepEqual(result.state.windows.map(windowState => windowState.windowId), [1, 2]);
});

test('the background setting turns a stale enabled request into an all-window disable', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Work', color: 'green' }],
    tabs: [{ id: 1, windowId: 1, index: 0, groupId: 10 }],
    sessionMap: { work: { 1: { groupId: 10, origin: 'created' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({
    chromeApi: mock.chromeApi,
    readSyncEnabled: async () => false,
  });

  const result = await coordinator.sync({
    windowId: 1,
    enabled: true,
    groups: [desired('work', 'Work', [1])],
  });

  assert.equal(result.ok, true);
  assert.equal(result.enabled, false);
  assert.equal(result.allWindows, true);
  assert.deepEqual(mock.calls.ungroup, [[1]]);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {});
});

test('all-window disable prunes mappings for closed windows without querying them', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Open', color: 'green' }],
    tabs: [{ id: 1, windowId: 1, index: 0, groupId: 10 }],
    sessionMap: {
      open: { 1: { groupId: 10, origin: 'created' } },
      closed: { 2: { groupId: 20, origin: 'created' } },
    },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({ windowId: 1, enabled: false, allWindows: true });

  assert.equal(result.ok, true);
  assert.deepEqual(mock.calls.ungroup, [[1]]);
  assert.ok(!mock.calls.groupQuery.some(query => Number(query.windowId) === 2));
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {});
});

test('a stale disable request cannot dismantle groups after the setting is enabled again', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Work', color: 'green' }],
    tabs: [{ id: 1, windowId: 1, index: 0, groupId: 10 }],
    sessionMap: { work: { 1: { groupId: 10, origin: 'created' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({
    chromeApi: mock.chromeApi,
    readSyncEnabled: async () => true,
  });

  const result = await coordinator.sync({ windowId: 1, enabled: false, allWindows: true });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'STALE_SYNC_SETTING');
  assert.equal(mock.calls.groupQuery.length, 0);
  assert.equal(mock.calls.ungroup.length, 0);
  assert.equal(mock.calls.sessionSet.length, 0);
});

test('preserveGroupKeys keeps an unsafe mapping that is absent from the logical snapshot', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Mixed', color: 'green' }],
    tabs: [{ id: 1, windowId: 1, index: 0, groupId: 10 }],
    sessionMap: { work: { 1: { groupId: 10, origin: 'created' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({
    windowId: 1,
    enabled: true,
    preserveGroupKeys: ['work'],
    groups: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.results[0].status, 'frozen-preserved');
  assert.equal(mock.calls.ungroup.length, 0);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    work: { 1: { groupId: 10, origin: 'created' } },
  });
});

test('enabled false freezes a created mapping if its live group became shared', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Shared', color: 'green', shared: true }],
    tabs: [{ id: 1, windowId: 1, index: 0, groupId: 10 }],
    sessionMap: { shared: { 1: { groupId: 10, origin: 'created' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.sync({ windowId: 1, enabled: false });

  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].reason, 'shared-group');
  assert.deepEqual(result.conflicts[0].candidates[0].tabIds, [1]);
  assert.equal(mock.calls.ungroup.length, 0);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    shared: { 1: { groupId: 10, origin: 'created' } },
  });
});

test('merge keeps target appearance and orders all tabs by their original strip positions', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'Target', color: 'purple', collapsed: true },
      { id: 11, windowId: 1, title: 'Source', color: 'red', collapsed: false },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 5, groupId: 10 },
      { id: 2, windowId: 1, index: 2, groupId: 11 },
      { id: 3, windowId: 1, index: 7, groupId: 11 },
    ],
    sessionMap: { work: { 1: { groupId: 11, origin: 'created' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.merge({
    windowId: 1,
    targetGroupId: 10,
    sourceGroupIds: [11],
    groupKey: 'work',
    expectedGroups: [
      expectedGroup(10, 'Target', 'purple', [1]),
      expectedGroup(11, 'Source', 'red', [2, 3]),
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(mock.calls.group, [{ groupId: 10, tabIds: [2, 3] }]);
  assert.deepEqual(mock.calls.move, [
    { tabId: 2, windowId: 1, index: 2 },
    { tabId: 1, windowId: 1, index: 3 },
    { tabId: 3, windowId: 1, index: 4 },
  ]);
  assert.equal(mock.calls.update.length, 0);
  assert.equal(mock.calls.ungroup.length, 0);
  assert.equal(mock.state.groups.find(group => group.id === 10).title, 'Target');
  assert.equal(mock.state.groups.find(group => group.id === 10).color, 'purple');
  assert.equal(mock.state.groups.find(group => group.id === 10).collapsed, true);
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], {
    work: { 1: { groupId: 10, origin: 'adopted' } },
  });
  assert.deepEqual(result.state.liveGroups.map(group => group.id), [10]);
  assert.deepEqual(result.state.liveGroups[0].tabIds, [2, 1, 3]);
});

test('merge freezes before writes when one selected group member query fails', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'Target', color: 'purple' },
      { id: 11, windowId: 1, title: 'Source', color: 'red' },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 1, groupId: 10 },
      { id: 2, windowId: 1, index: 2, groupId: 11 },
    ],
  });
  mock.state.failGroupQueries.add(11);
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.merge({
    windowId: 1,
    targetGroupId: 10,
    sourceGroupIds: [11],
    expectedGroups: [
      expectedGroup(10, 'Target', 'purple', [1]),
      expectedGroup(11, 'Source', 'red', [2]),
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'GROUP_QUERY_FAILED');
  assert.equal(result.error.details.groups[0].groupId, 11);
  assert.equal(result.error.details.groups[0].queryComplete, false);
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.move.length, 0);
  assert.equal(mock.calls.sessionSet.length, 0);
});

test('merge fails closed when a member navigates after the confirmation snapshot', async () => {
  const mock = createChromeMock({
    groups: [
      { id: 10, windowId: 1, title: 'Work', color: 'blue' },
      { id: 11, windowId: 1, title: 'Work', color: 'red' },
    ],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10, url: 'https://work.example/a' },
      { id: 2, windowId: 1, index: 1, groupId: 11, url: 'https://changed.example/' },
    ],
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.merge({
    windowId: 1,
    targetGroupId: 10,
    sourceGroupIds: [11],
    groupKey: 'work.example',
    expectedGroups: [
      expectedGroup(10, 'Work', 'blue', [{ id: 1, url: 'https://work.example/a' }]),
      expectedGroup(11, 'Work', 'red', [{ id: 2, url: 'https://work.example/b' }]),
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'LIVE_STATE_CONFLICT');
  assert.equal(mock.calls.group.length, 0);
  assert.equal(mock.calls.move.length, 0);
  assert.equal(mock.calls.sessionSet.length, 0);
});

test('get-state returns live group fields, query completeness, mappings, and removes legacy meta once', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Work', color: 'cyan', collapsed: true }],
    tabs: [{ id: 1, windowId: 1, index: 6, groupId: 10 }],
    sessionMap: { work: { 1: { groupId: 10, origin: 'adopted' } } },
    legacyMeta: { work: { 1: { title: 'Work', color: 'cyan' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const first = await coordinator.getState({ windowId: 1 });
  const second = await coordinator.dispatch({ action: 'get-state', windowId: 1 });

  assert.equal(first.ok, true);
  const live = first.state.windows[0].nativeGroups[0];
  assert.deepEqual({
    id: live.id,
    windowId: live.windowId,
    title: live.title,
    color: live.color,
    collapsed: live.collapsed,
    shared: live.shared,
    minIndex: live.minIndex,
    tabIds: live.tabIds,
    queryComplete: live.queryComplete,
  }, {
    id: 10,
    windowId: 1,
    title: 'Work',
    color: 'cyan',
    collapsed: true,
    shared: false,
    minIndex: 6,
    tabIds: [1],
    queryComplete: true,
  });
  assert.deepEqual(live.mappings, [{ groupKey: 'work', origin: 'adopted' }]);
  assert.deepEqual(deepClone(first.state.sessionMap), mock.state.session[SESSION_MAP_KEY]);
  assert.equal(second.ok, true);
  assert.deepEqual(mock.calls.localRemove, [LEGACY_LOCAL_META_KEY]);
});

test('get-state retains mappings for live shared groups so sync can freeze them', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Shared', color: 'cyan', shared: true }],
    tabs: [{ id: 1, windowId: 1, index: 0, groupId: 10 }],
    sessionMap: { shared: { 1: { groupId: 10, origin: 'created' } } },
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.getState({ windowId: 1 });

  assert.equal(result.ok, true);
  assert.deepEqual(deepClone(result.state.sessionMap), {
    shared: { 1: { groupId: 10, origin: 'created' } },
  });
  assert.deepEqual(result.state.windows[0].nativeGroups[0].mappings, [{ groupKey: 'shared', origin: 'created' }]);
});

test('global get-state rejects malformed groups without pruning session mappings', async () => {
  const sessionMap = { work: { 1: { groupId: 10, origin: 'adopted' } } };
  const mock = createChromeMock({ sessionMap });
  mock.state.groups.push({ id: 'bad', windowId: 1, title: 'Incomplete' });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.getState({});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'GLOBAL_QUERY_FAILED');
  assert.deepEqual(mock.state.session[SESSION_MAP_KEY], sessionMap);
  assert.equal(mock.calls.sessionSet.length, 0);
  assert.equal(mock.calls.localRemove.length, 0);
});

test('manual create mutation validates live tabs and owns the Chrome write in background', async () => {
  const mock = createChromeMock({
    tabs: [
      { id: 1, windowId: 4, index: 3 },
      { id: 2, windowId: 4, index: 4, pinned: true },
    ],
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const result = await coordinator.merge({
    operation: 'create',
    windowId: 4,
    tabIds: [1, 2, 999],
    orderedTabIds: [1, 2, 999],
    title: 'Reading',
    color: 'blue',
  });

  assert.equal(result.ok, true);
  assert.equal(result.groupId, 100);
  assert.deepEqual(result.mergedTabIds, [1]);
  assert.deepEqual(result.skippedTabIds, [2, 999]);
  assert.deepEqual(mock.calls.group, [{ tabIds: [1], createProperties: { windowId: 4 } }]);
  assert.deepEqual(mock.calls.update, [{ groupId: 100, props: { title: 'Reading', color: 'blue' } }]);
});

test('manual join, update, reorder, and ungroup mutations stay serialized in the coordinator', async () => {
  const mock = createChromeMock({
    groups: [{ id: 10, windowId: 1, title: 'Target', color: 'grey' }],
    tabs: [
      { id: 1, windowId: 1, index: 0, groupId: 10 },
      { id: 2, windowId: 1, index: 2, groupId: -1 },
    ],
  });
  const coordinator = createChromeTabGroupsCoordinator({ chromeApi: mock.chromeApi });

  const joined = await coordinator.merge({
    operation: 'join',
    windowId: 1,
    targetGroupId: 10,
    tabIds: [2],
    orderedTabIds: [2, 1],
  });
  const updated = await coordinator.merge({
    operation: 'update',
    windowId: 1,
    targetGroupId: 10,
    changes: { title: 'Kept', color: 'green' },
  });
  const reordered = await coordinator.merge({
    operation: 'reorder',
    windowId: 1,
    targetGroupId: 10,
    tabIds: [1, 2],
  });
  const ungrouped = await coordinator.merge({
    operation: 'ungroup',
    windowId: 1,
    tabIds: [2],
  });

  assert.equal(joined.ok, true);
  assert.equal(updated.ok, true);
  assert.equal(reordered.ok, true);
  assert.equal(ungrouped.ok, true);
  assert.deepEqual(mock.calls.group[0], { groupId: 10, tabIds: [2] });
  assert.deepEqual(mock.calls.update[0], { groupId: 10, props: { title: 'Kept', color: 'green' } });
  assert.deepEqual(mock.calls.ungroup.at(-1), [2]);
});
