'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function eventSource() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    async emit(...args) {
      await Promise.all(listeners.map(listener => listener(...args)));
    },
  };
}

const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
let nextTimerId = 1;
const pendingTimers = new Map();
global.setTimeout = (callback, delay) => {
  const timerId = nextTimerId++;
  pendingTimers.set(timerId, { callback, delay });
  return timerId;
};
global.clearTimeout = timerId => pendingTimers.delete(timerId);

const events = {
  runtimeMessage: eventSource(),
  installed: eventSource(),
  startup: eventSource(),
  storageChanged: eventSource(),
  created: eventSource(),
  removed: eventSource(),
  updated: eventSource(),
  replaced: eventSource(),
  moved: eventSource(),
  attached: eventSource(),
  detached: eventSource(),
};

const dispatchCalls = [];
const builderCalls = [];
const sentMessages = [];
const liveTabs = [];
const nativeGroupsByWindow = new Map();
const storageState = {
  chromeTabGroupsEnabled: false,
  chromeTabGroupsCleanupPending: false,
  automaticTabGroupRuleOverrides: {
    version: 1,
    backgroundSafe: true,
    landingPagePatterns: [],
    customGroups: [],
  },
  sessionGroups: { groups: [], assignments: {} },
  groupLabelOverrides: {},
  groupTabOrder: {},
  languagePreference: 'en',
};
let failTabQueryWindowId = null;
let failGetStateWindowId = null;
let coordinatorDispatchHook = null;
let runtimeMessageFailure = null;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function defaultBuildSnapshot(options) {
  const groupsByKey = new Map();
  for (const tab of options.tabs || []) {
    if (tab.pinned || !tab.url) continue;
    let groupKey;
    try {
      groupKey = new URL(tab.url).hostname;
    } catch {
      continue;
    }
    if (!groupKey) continue;
    if (!groupsByKey.has(groupKey)) {
      groupsByKey.set(groupKey, {
        groupKey,
        title: options.labelOverrides?.[groupKey] || groupKey,
        color: 'grey',
        collapsed: true,
        tabIds: [],
      });
    }
    groupsByKey.get(groupKey).tabIds.push(Number(tab.id));
  }
  return {
    windowId: options.windowId,
    preserveGroupKeys: [],
    groups: [...groupsByKey.values()],
    analysis: {},
  };
}

globalThis.TabHarborAutomaticTabGroups = {
  buildAutomaticChromeSyncSnapshot(options) {
    builderCalls.push(options);
    return defaultBuildSnapshot(options);
  },
  normalizeStoredAutomaticGroupingRuleOverrides(value) {
    if (!value || value.version !== 1 || typeof value.backgroundSafe !== 'boolean' ||
        !Array.isArray(value.landingPagePatterns) || !Array.isArray(value.customGroups)) {
      return null;
    }
    return clone(value);
  },
};

globalThis.TabHarborChromeTabGroupsCoordinator = {
  createChromeTabGroupsCoordinator() {
    return {
      async dispatch(payload) {
        dispatchCalls.push(clone(payload));
        if (coordinatorDispatchHook) {
          const hooked = await coordinatorDispatchHook(payload);
          if (hooked !== undefined) return hooked;
        }
        if (payload.action === 'get-state') {
          if (Number(payload.windowId) === Number(failGetStateWindowId)) {
            return {
              ok: false,
              action: 'get-state',
              error: { code: 'GLOBAL_QUERY_FAILED', message: 'native group query failed' },
            };
          }
          const nativeGroups = clone(nativeGroupsByWindow.get(Number(payload.windowId)) || []);
          return {
            ok: true,
            action: 'get-state',
            state: {
              sessionMap: {},
              liveGroups: nativeGroups,
              windows: [{ windowId: Number(payload.windowId), nativeGroups }],
            },
          };
        }
        return { ok: true, action: payload.action, payload: clone(payload), conflicts: [] };
      },
    };
  },
};

function storageGet(keys) {
  const requested = Array.isArray(keys) ? keys : [keys];
  const result = {};
  for (const key of requested) {
    if (Object.prototype.hasOwnProperty.call(storageState, key)) {
      result[key] = clone(storageState[key]);
    }
  }
  return result;
}

globalThis.chrome = {
  runtime: {
    id: 'tab-harbor-test',
    getURL: path => `chrome-extension://tab-harbor-test/${path}`,
    onMessage: events.runtimeMessage,
    onInstalled: events.installed,
    onStartup: events.startup,
    async sendMessage(message) {
      sentMessages.push(clone(message));
      if (runtimeMessageFailure) throw runtimeMessageFailure;
    },
  },
  tabs: {
    async query(queryInfo = {}) {
      if (queryInfo.windowId != null &&
          Number(queryInfo.windowId) === Number(failTabQueryWindowId)) {
        throw new Error('tabs.query failed');
      }
      return clone(liveTabs.filter(tab =>
        queryInfo.windowId == null || Number(tab.windowId) === Number(queryInfo.windowId)
      ));
    },
    async get(tabId) {
      const tab = liveTabs.find(entry => Number(entry.id) === Number(tabId));
      if (!tab) throw new Error('No tab with id');
      return clone(tab);
    },
    async remove() {},
    onCreated: events.created,
    onRemoved: events.removed,
    onUpdated: events.updated,
    onReplaced: events.replaced,
    onMoved: events.moved,
    onAttached: events.attached,
    onDetached: events.detached,
  },
  storage: {
    local: {
      async get(keys) { return storageGet(keys); },
      async set(items) { Object.assign(storageState, clone(items)); },
    },
    onChanged: events.storageChanged,
  },
  action: { async setBadgeText() {} },
};

require('./background.js');

const background = globalThis.TabHarborBackground;
const trustedSender = {
  id: 'tab-harbor-test',
  url: 'chrome-extension://tab-harbor-test/index.html',
};

test.beforeEach(() => {
  background._resetAutomaticChromeGroupSync();
  background._resetPendingChromeTabGroupCleanup();
  background._resetDuplicateCloseGuard();
  dispatchCalls.length = 0;
  builderCalls.length = 0;
  sentMessages.length = 0;
  liveTabs.length = 0;
  nativeGroupsByWindow.clear();
  pendingTimers.clear();
  storageState.chromeTabGroupsEnabled = false;
  storageState.chromeTabGroupsCleanupPending = false;
  storageState.automaticTabGroupRuleOverrides = {
    version: 1,
    backgroundSafe: true,
    landingPagePatterns: [],
    customGroups: [],
  };
  storageState.sessionGroups = { groups: [], assignments: {} };
  storageState.groupLabelOverrides = {};
  storageState.groupTabOrder = {};
  storageState.languagePreference = 'en';
  failTabQueryWindowId = null;
  failGetStateWindowId = null;
  coordinatorDispatchHook = null;
  runtimeMessageFailure = null;
});

test.after(() => {
  background._resetAutomaticChromeGroupSync();
  background._resetPendingChromeTabGroupCleanup();
  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;
});

test('background maps the three dashboard message names to coordinator actions', async () => {
  const cases = [
    ['sync-chrome-tab-groups', 'sync'],
    ['merge-chrome-tab-groups', 'merge'],
    ['get-chrome-tab-group-state', 'get-state'],
  ];

  for (const [messageAction, coordinatorAction] of cases) {
    const response = await background.handleChromeTabGroupsMessage({
      action: messageAction,
      source: 'dashboard',
      payload: { windowId: 7 },
    }, trustedSender);
    assert.equal(response.ok, true);
    assert.deepEqual(dispatchCalls.at(-1), {
      action: coordinatorAction,
      windowId: 7,
    });
  }
});

test('background rejects wrong extension identities, page URLs, and message sources', async () => {
  const message = {
    action: 'sync-chrome-tab-groups',
    source: 'dashboard',
    payload: { windowId: 7 },
  };
  const wrongId = await background.handleChromeTabGroupsMessage(message, {
    id: 'another-extension',
    url: trustedSender.url,
  });
  const wrongUrl = await background.handleChromeTabGroupsMessage(message, {
    id: 'tab-harbor-test',
    url: 'https://example.com/',
  });
  const wrongSource = await background.handleChromeTabGroupsMessage({
    ...message,
    source: 'popup',
  }, trustedSender);

  for (const result of [wrongId, wrongUrl, wrongSource]) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'UNTRUSTED_SOURCE');
  }
  assert.deepEqual(dispatchCalls, []);
});

test('background ignores unrelated runtime messages', async () => {
  assert.equal(await background.handleChromeTabGroupsMessage(
    { action: 'tabs-changed' },
    trustedSender,
  ), null);
  assert.deepEqual(dispatchCalls, []);
});

test('setting transitions clean up on disable and schedule every live window on enable', async () => {
  const disabled = await background.handleChromeTabGroupsSettingChanged({
    chromeTabGroupsEnabled: { oldValue: true, newValue: false },
  }, 'local');
  assert.equal(disabled.ok, true);
  assert.equal(storageState.chromeTabGroupsCleanupPending, false);
  assert.deepEqual(dispatchCalls, [{
    action: 'sync',
    windowId: 0,
    enabled: false,
    allWindows: true,
    preserveGroupKeys: [],
    groups: [],
  }]);

  dispatchCalls.length = 0;
  storageState.chromeTabGroupsEnabled = true;
  liveTabs.push(
    { id: 1, windowId: 4, url: 'https://one.example/', groupId: -1 },
    { id: 2, windowId: 9, url: 'https://two.example/', groupId: -1 },
  );
  const enabled = await background.handleChromeTabGroupsSettingChanged({
    chromeTabGroupsEnabled: { oldValue: false, newValue: true },
  }, 'local');
  assert.deepEqual(enabled, {
    ok: true,
    action: 'automatic-sync-scheduled',
    windowIds: [4, 9],
  });
  await Promise.all([
    background._flushAutomaticChromeGroupSync(4),
    background._flushAutomaticChromeGroupSync(9),
  ]);
  assert.deepEqual(
    dispatchCalls.filter(call => call.action === 'sync').map(call => call.windowId).sort(),
    [4, 9],
  );
});

// @lat: [[tests#Chrome 标签组验收#查询失败与关闭同步]]
test('failed disable cleanup stays pending and succeeds on the backed-off retry', async () => {
  storageState.chromeTabGroupsEnabled = false;
  let cleanupAttempts = 0;
  coordinatorDispatchHook = async payload => {
    if (payload.action !== 'sync' || payload.enabled !== false) return undefined;
    cleanupAttempts += 1;
    if (cleanupAttempts === 1) {
      return {
        ok: false,
        action: 'sync',
        error: { code: 'GLOBAL_QUERY_FAILED', message: 'temporary query failure' },
      };
    }
    return { ok: true, action: 'sync', enabled: false, conflicts: [] };
  };

  const failed = await background.handleChromeTabGroupsSettingChanged({
    chromeTabGroupsEnabled: { oldValue: true, newValue: false },
  }, 'local');

  assert.equal(failed.ok, false);
  assert.equal(storageState.chromeTabGroupsCleanupPending, true);
  assert.equal(background._getPendingChromeTabGroupCleanupState().retryPending, true);

  const retried = await background._flushPendingChromeTabGroupCleanup();

  assert.equal(retried.ok, true);
  assert.equal(cleanupAttempts, 2);
  assert.equal(storageState.chromeTabGroupsCleanupPending, false);
  assert.deepEqual(background._getPendingChromeTabGroupCleanupState(), {
    pending: false,
    enabled: false,
    inFlight: false,
    retryPending: false,
    retryAttempt: 0,
  });
});

test('startup resumes a persisted pending cleanup after worker memory is reset', async () => {
  storageState.chromeTabGroupsEnabled = false;
  storageState.chromeTabGroupsCleanupPending = true;
  background._resetPendingChromeTabGroupCleanup();

  await events.startup.emit();
  await new Promise(resolve => setImmediate(resolve));

  const cleanupCalls = dispatchCalls.filter(call =>
    call.action === 'sync' && call.enabled === false && call.allWindows === true
  );
  assert.equal(cleanupCalls.length, 1);
  assert.equal(storageState.chromeTabGroupsCleanupPending, false);
  assert.equal(background._getPendingChromeTabGroupCleanupState().pending, false);
});

test('successful cleanup prevents later disabled tab wakes from querying the coordinator again', async () => {
  storageState.chromeTabGroupsEnabled = false;
  const cleaned = await background.handleChromeTabGroupsSettingChanged({
    chromeTabGroupsEnabled: { oldValue: true, newValue: false },
  }, 'local');
  assert.equal(cleaned.ok, true);
  assert.equal(storageState.chromeTabGroupsCleanupPending, false);
  dispatchCalls.length = 0;

  liveTabs.push({
    id: 301,
    windowId: 31,
    url: 'https://disabled.example/after-cleanup',
    groupId: -1,
    pinned: false,
  });
  await events.updated.emit(301, { url: liveTabs[0].url }, clone(liveTabs[0]));
  const wake = await background._flushAutomaticChromeGroupSync(31);

  assert.equal(wake.ok, true);
  assert.equal(wake.skipped, 'disabled');
  assert.deepEqual(dispatchCalls, []);
  assert.equal(background._getPendingChromeTabGroupCleanupState().retryPending, false);
});

// @lat: [[tests#Chrome 标签组验收#自定义规则快照]]
test('background reconciliation uses the declarative config.local rule snapshot', async () => {
  storageState.chromeTabGroupsEnabled = true;
  storageState.automaticTabGroupRuleOverrides = {
    version: 1,
    backgroundSafe: true,
    landingPagePatterns: [{ hostname: 'start.example', pathExact: ['/'] }],
    customGroups: [{
      hostnameEndsWith: '.example.com',
      groupKey: 'example-work',
      groupLabel: 'Example work',
    }],
  };
  liveTabs.push({
    id: 401,
    windowId: 41,
    url: 'https://docs.example.com/guide',
    groupId: -1,
    pinned: false,
  });

  const result = await background.runAutomaticChromeGroupSync(41);

  assert.equal(result.ok, true);
  assert.equal(builderCalls.length, 1);
  assert.deepEqual(
    builderCalls[0].landingPagePatterns,
    storageState.automaticTabGroupRuleOverrides.landingPagePatterns,
  );
  assert.deepEqual(
    builderCalls[0].customGroups,
    storageState.automaticTabGroupRuleOverrides.customGroups,
  );
  assert.deepEqual(dispatchCalls.map(call => call.action), ['get-state', 'sync']);
});

test('missing, invalid, and function-based rule snapshots stop background writes', async () => {
  storageState.chromeTabGroupsEnabled = true;
  liveTabs.push({
    id: 402,
    windowId: 42,
    url: 'https://safe.example/article',
    groupId: -1,
    pinned: false,
  });

  delete storageState.automaticTabGroupRuleOverrides;
  const uninitialized = await background.runAutomaticChromeGroupSync(42);
  assert.equal(uninitialized.ok, true);
  assert.equal(uninitialized.skipped, 'rule-overrides-uninitialized');

  storageState.automaticTabGroupRuleOverrides = {
    version: 1,
    backgroundSafe: false,
    landingPagePatterns: [{ hostname: 'safe.example' }],
    customGroups: [],
  };
  const dashboardOnly = await background.runAutomaticChromeGroupSync(42);
  assert.equal(dashboardOnly.ok, true);
  assert.equal(dashboardOnly.skipped, 'dashboard-only-rule-overrides');

  storageState.automaticTabGroupRuleOverrides = { version: 99 };
  const invalid = await background.runAutomaticChromeGroupSync(42);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_RULE_OVERRIDES');
  assert.deepEqual(dispatchCalls, []);
  assert.deepEqual(builderCalls, []);
});

test('tab creation syncs through background even when no Dashboard receives the broadcast', async () => {
  storageState.chromeTabGroupsEnabled = true;
  storageState.groupLabelOverrides = { 'work.example': 'Work' };
  liveTabs.push({
    id: 11,
    windowId: 7,
    url: 'https://work.example/board',
    groupId: -1,
    pinned: false,
  });
  runtimeMessageFailure = new Error(
    'Could not establish connection. Receiving end does not exist.',
  );

  await events.created.emit(liveTabs[0]);
  const result = await background._flushAutomaticChromeGroupSync(7);

  assert.equal(result.ok, true);
  assert.deepEqual(dispatchCalls.map(call => call.action), ['get-state', 'sync']);
  assert.deepEqual(dispatchCalls[1], {
    action: 'sync',
    windowId: 7,
    enabled: true,
    allWindows: false,
    preserveGroupKeys: [],
    groups: [{
      groupKey: 'work.example',
      title: 'Work',
      color: 'grey',
      collapsed: true,
      tabIds: [11],
    }],
  });
  assert.equal(builderCalls.length, 1);
  assert.deepEqual(builderCalls[0].sessionGroups, storageState.sessionGroups);
  assert.equal(builderCalls[0].labelOverrides['work.example'], 'Work');
  assert.equal(builderCalls[0].homepagesLabel, 'Homepages');
});

test('empty onCreated URL and final URL update coalesce into one final snapshot', async () => {
  storageState.chromeTabGroupsEnabled = true;
  liveTabs.push({ id: 21, windowId: 3, url: '', groupId: -1, pinned: false });

  await events.created.emit(clone(liveTabs[0]));
  liveTabs[0].url = 'https://final.example/article';
  await events.updated.emit(21, { url: liveTabs[0].url }, clone(liveTabs[0]));
  await background._flushAutomaticChromeGroupSync(3);

  assert.equal(builderCalls.length, 1);
  assert.equal(builderCalls[0].tabs[0].url, 'https://final.example/article');
  const sync = dispatchCalls.find(call => call.action === 'sync');
  assert.deepEqual(sync.groups[0].tabIds, [21]);
  assert.equal(sync.groups[0].groupKey, 'final.example');
});

// @lat: [[tests#Chrome 标签组验收#Background 导航快照触发]]
test('grouped URL update submits the latest cross-domain snapshot without a Dashboard page', async () => {
  const windowId = 15;
  const tabId = 101;
  const oldGroupId = 701;
  const oldUrl = 'https://hellogithub.com/repository/JOYCEQL/magic-resume';
  const nextUrl = 'https://github.com/JOYCEQL/magic-resume';
  storageState.chromeTabGroupsEnabled = true;
  storageState.groupLabelOverrides = { 'github.com': 'GitHub' };
  runtimeMessageFailure = new Error(
    'Could not establish connection. Receiving end does not exist.',
  );
  liveTabs.push({
    id: tabId,
    windowId,
    index: 0,
    url: oldUrl,
    groupId: oldGroupId,
    pinned: false,
  });
  const oldNativeGroup = {
    id: oldGroupId,
    windowId,
    title: 'Hellogithub',
    color: 'grey',
    collapsed: true,
    shared: false,
    queryComplete: true,
    minIndex: 0,
    tabIds: [tabId],
    mappings: [{ groupKey: 'hellogithub.com', origin: 'created' }],
  };
  nativeGroupsByWindow.set(windowId, [oldNativeGroup]);

  liveTabs[0].url = nextUrl;
  await events.updated.emit(tabId, { url: nextUrl }, clone(liveTabs[0]));
  const result = await background._flushAutomaticChromeGroupSync(windowId);

  assert.equal(result.ok, true);
  assert.deepEqual(dispatchCalls.map(call => call.action), ['get-state', 'sync']);
  assert.equal(builderCalls.length, 1);
  assert.equal(builderCalls[0].tabs.length, 1);
  assert.equal(builderCalls[0].tabs[0].url, nextUrl);
  assert.equal(builderCalls[0].tabs[0].groupId, oldGroupId);
  assert.deepEqual(builderCalls[0].nativeGroups, [oldNativeGroup]);

  const sync = dispatchCalls[1];
  assert.deepEqual(sync.groups, [{
    groupKey: 'github.com',
    title: 'GitHub',
    color: 'grey',
    collapsed: true,
    tabIds: [tabId],
  }]);
  assert.equal(sync.groups.some(group => group.groupKey === 'hellogithub.com'), false);
  assert.deepEqual(sentMessages, [{
    action: 'tabs-changed',
    source: 'tabs.onUpdated',
    triggerTabId: tabId,
    windowId,
  }]);
});

test('disabled automatic sync performs no coordinator read or write', async () => {
  liveTabs.push({ id: 31, windowId: 5, url: 'https://disabled.example/', groupId: -1 });

  await events.updated.emit(31, { url: liveTabs[0].url }, clone(liveTabs[0]));
  const result = await background._flushAutomaticChromeGroupSync(5);

  assert.equal(result.ok, true);
  assert.equal(result.skipped, 'disabled');
  assert.deepEqual(dispatchCalls, []);
  assert.deepEqual(builderCalls, []);
});

test('window event slots build isolated full-window snapshots', async () => {
  storageState.chromeTabGroupsEnabled = true;
  liveTabs.push(
    { id: 41, windowId: 1, url: 'https://one.example/a', groupId: -1 },
    { id: 42, windowId: 1, url: 'https://one.example/b', groupId: -1 },
    { id: 51, windowId: 2, url: 'https://two.example/', groupId: -1 },
  );

  await Promise.all([
    events.detached.emit(41, { oldWindowId: 1, oldPosition: 0 }),
    events.attached.emit(51, { newWindowId: 2, newPosition: 0 }),
  ]);
  await Promise.all([
    background._flushAutomaticChromeGroupSync(1),
    background._flushAutomaticChromeGroupSync(2),
  ]);

  const syncByWindow = new Map(
    dispatchCalls.filter(call => call.action === 'sync').map(call => [call.windowId, call]),
  );
  assert.deepEqual(syncByWindow.get(1).groups[0].tabIds, [41, 42]);
  assert.deepEqual(syncByWindow.get(2).groups[0].tabIds, [51]);
  assert.deepEqual(
    sentMessages.filter(message => message.source.startsWith('tabs.on')).map(message => message.windowId).sort(),
    [1, 2],
  );
});

test('tab and native-group query failures fail closed before sync dispatch', async () => {
  storageState.chromeTabGroupsEnabled = true;
  liveTabs.push({ id: 61, windowId: 6, url: 'https://safe.example/', groupId: -1 });

  failTabQueryWindowId = 6;
  void background.scheduleAutomaticChromeGroupSync(6);
  const tabFailure = await background._flushAutomaticChromeGroupSync(6);
  assert.equal(tabFailure.ok, false);
  assert.equal(tabFailure.error.code, 'TABS_QUERY_FAILED');
  assert.deepEqual(dispatchCalls, []);

  dispatchCalls.length = 0;
  failTabQueryWindowId = null;
  failGetStateWindowId = 6;
  void background.scheduleAutomaticChromeGroupSync(6);
  const stateFailure = await background._flushAutomaticChromeGroupSync(6);
  assert.equal(stateFailure.ok, false);
  assert.equal(stateFailure.error.code, 'GLOBAL_QUERY_FAILED');
  assert.deepEqual(dispatchCalls.map(call => call.action), ['get-state']);
  assert.deepEqual(builderCalls, []);
});

test('events received during a write coalesce into one bounded trailing sync', async () => {
  storageState.chromeTabGroupsEnabled = true;
  liveTabs.push({ id: 71, windowId: 8, url: 'https://echo.example/', groupId: -1 });
  let syncCount = 0;
  coordinatorDispatchHook = async payload => {
    if (payload.action !== 'sync') return undefined;
    syncCount += 1;
    if (syncCount === 1) {
      assert.equal(background._getAutomaticChromeGroupSyncSlot(8).running, true);
      liveTabs[0].groupId = 700;
      await Promise.all([
        events.updated.emit(71, { groupId: 700 }, clone(liveTabs[0])),
        events.moved.emit(71, { windowId: 8, fromIndex: 0, toIndex: 1 }),
        events.updated.emit(71, { groupId: 700 }, clone(liveTabs[0])),
      ]);
    }
    return { ok: true, action: 'sync', conflicts: [] };
  };

  void background.scheduleAutomaticChromeGroupSync(8);
  const result = await background._flushAutomaticChromeGroupSync(8);

  assert.equal(result.ok, true);
  assert.equal(syncCount, 2);
  assert.deepEqual(dispatchCalls.map(call => call.action), [
    'get-state',
    'sync',
    'get-state',
    'sync',
  ]);
  assert.equal(builderCalls.length, 2);
  assert.equal(background._getAutomaticChromeGroupSyncSlot(8), null);
});

test('startup discovers and schedules every window without a Dashboard page', async () => {
  storageState.chromeTabGroupsEnabled = true;
  liveTabs.push(
    { id: 81, windowId: 12, url: 'https://startup-one.example/', groupId: -1 },
    { id: 82, windowId: 13, url: 'https://startup-two.example/', groupId: -1 },
  );
  runtimeMessageFailure = new Error('Receiving end does not exist');

  await events.startup.emit();
  await new Promise(resolve => setImmediate(resolve));
  await Promise.all([
    background._flushAutomaticChromeGroupSync(12),
    background._flushAutomaticChromeGroupSync(13),
  ]);

  assert.deepEqual(
    dispatchCalls.filter(call => call.action === 'sync').map(call => call.windowId).sort(),
    [12, 13],
  );
});

test('extension install or update reconciles tabs that were already open', async () => {
  storageState.chromeTabGroupsEnabled = true;
  liveTabs.push({
    id: 91,
    windowId: 14,
    url: 'https://already-open.example/',
    groupId: -1,
  });

  await events.installed.emit({ reason: 'update' });
  await new Promise(resolve => setImmediate(resolve));
  await background._flushAutomaticChromeGroupSync(14);

  assert.deepEqual(
    dispatchCalls.filter(call => call.action === 'sync').map(call => call.windowId),
    [14],
  );
});
