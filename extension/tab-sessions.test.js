'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addSavedTabSession,
  appendSavedTabSessionTabs,
  buildSessionSnapshot,
  createSavedTabSessionFromTab,
  createRestoredSessionGroups,
  getSavedTabSessions,
  normalizeSavedTabSessions,
  renameSavedTabSession,
  updateSavedTabSessionTabs,
} = require('./tab-sessions.js');

test('buildSessionSnapshot captures selected tabs with canonical urls and manual group metadata', () => {
  const snapshot = buildSessionSnapshot({
    tabs: [
      {
        id: 11,
        url: 'extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#ttl=Issue%20Thread&uri=https%3A%2F%2Fgithub.com%2FV-IOLE-T%2Ftab-harbor%2Fissues%2F25',
        title: 'Suspended tab',
        favIconUrl: 'https://github.com/favicon.ico',
        windowId: 1,
      },
      {
        id: 12,
        url: 'chrome://settings',
        title: 'Settings',
        windowId: 1,
      },
    ],
    groupLookup: new Map([
      ['11', { key: '__session_group__:research', label: 'Research', manualGroupId: 'research' }],
    ]),
    selectedTabIds: ['11', '12'],
    source: 'selected',
    now: '2026-05-22T08:00:00.000Z',
  });

  assert.equal(snapshot.tabs.length, 1);
  assert.equal(snapshot.tabs[0].url, 'https://github.com/V-IOLE-T/tab-harbor/issues/25');
  assert.equal(snapshot.tabs[0].title, 'Issue Thread');
  assert.deepEqual(snapshot.groups, [
    { key: '__session_group__:research', label: 'Research', manualGroupId: 'research', chromeGroupColor: '', tabUrls: ['https://github.com/V-IOLE-T/tab-harbor/issues/25'] },
  ]);
});

test('buildSessionSnapshot records chrome group membership with color and tab order', () => {
  const snapshot = buildSessionSnapshot({
    tabs: [
      { id: 21, url: 'https://a.test/1', title: 'A1', windowId: 1 },
      { id: 22, url: 'https://b.test/1', title: 'B1', windowId: 1 },
    ],
    groupLookup: new Map([
      ['21', { key: '__chrome_group__:77', label: 'Work', manualGroupId: '', chromeGroupColor: 'blue' }],
      ['22', { key: '__chrome_group__:77', label: 'Work', manualGroupId: '', chromeGroupColor: 'blue' }],
    ]),
    selectedTabIds: ['21', '22'],
    source: 'selected',
    now: '2026-05-22T08:00:00.000Z',
  });

  assert.equal(snapshot.tabs.length, 2);
  assert.deepEqual(snapshot.groups, [
    { key: '__chrome_group__:77', label: 'Work', manualGroupId: '', chromeGroupColor: 'blue', tabUrls: ['https://a.test/1', 'https://b.test/1'] },
  ]);
});

test('buildSessionSnapshot partial selection keeps the group identity with only the selected members', () => {
  const snapshot = buildSessionSnapshot({
    tabs: [
      { id: 31, url: 'https://x.test/1', title: 'X1', windowId: 1 },
      { id: 32, url: 'https://x.test/2', title: 'X2', windowId: 1 },
      { id: 33, url: 'https://x.test/3', title: 'X3', windowId: 1 },
    ],
    groupLookup: new Map([
      ['31', { key: '__session_group__:g1', label: 'G1', manualGroupId: 'g1' }],
      ['32', { key: '__session_group__:g1', label: 'G1', manualGroupId: 'g1' }],
      ['33', { key: '__session_group__:g1', label: 'G1', manualGroupId: 'g1' }],
    ]),
    selectedTabIds: ['31'],
    source: 'selected',
    now: '2026-05-22T08:00:00.000Z',
  });

  assert.equal(snapshot.tabs.length, 1);
  assert.deepEqual(snapshot.groups, [
    { key: '__session_group__:g1', label: 'G1', manualGroupId: 'g1', chromeGroupColor: '', tabUrls: ['https://x.test/1'] },
  ]);
});

test('buildSessionSnapshot rejects empty selected tabs', () => {
  assert.throws(
    () => buildSessionSnapshot({
      tabs: [{ id: 1, url: 'chrome://newtab/', title: 'New tab' }],
      selectedTabIds: ['1'],
    }),
    /no restorable tabs/i
  );
});

test('normalizeSavedTabSessions drops invalid sessions and tabs', () => {
  const sessions = normalizeSavedTabSessions([
    {
      id: 'session-a',
      name: 'Morning research',
      savedAt: '2026-05-22T08:00:00.000Z',
      tabs: [
        { url: 'https://example.com/a', title: 'A' },
        { url: 'chrome://settings', title: 'Settings' },
      ],
      groups: [{ key: 'example.com', label: 'Example', tabUrls: ['https://example.com/a', 'chrome://settings'] }],
    },
    { id: 'empty', tabs: [] },
  ]);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].name, 'Morning research');
  assert.deepEqual(sessions[0].groups[0].tabUrls, ['https://example.com/a']);
});

test('createRestoredSessionGroups creates manual groups for restored manual session groups', () => {
  const restored = createRestoredSessionGroups({
    existingState: { groups: [], assignments: {} },
    session: {
      groups: [{ key: '__session_group__:research', label: 'Research', manualGroupId: 'research', tabUrls: ['https://a.test', 'https://b.test'] }],
    },
    restoredTabs: [
      { id: 101, url: 'https://a.test' },
      { id: 102, url: 'https://b.test' },
    ],
    now: '2026-05-22T08:00:00.000Z',
  });

  assert.equal(restored.state.groups.length, 1);
  assert.equal(restored.state.groups[0].name, 'Research');
  assert.equal(restored.state.assignments['101'], restored.state.groups[0].id);
  assert.equal(restored.state.assignments['102'], restored.state.groups[0].id);
  assert.deepEqual(restored.chromeGroupPlans, []);
});

test('createRestoredSessionGroups returns chrome group plans with ordered tab ids', () => {
  const restored = createRestoredSessionGroups({
    existingState: { groups: [], assignments: {} },
    session: {
      groups: [
        { key: '__chrome_group__:77', label: 'Work', manualGroupId: '', chromeGroupColor: 'blue', tabUrls: ['https://a.test/1', 'https://b.test/1'] },
        // Domain groups are derived automatically on restore and never planned.
        { key: 'example.com', label: 'Example', tabUrls: ['https://a.test/1'] },
      ],
    },
    restoredTabs: [
      { id: 201, url: 'https://a.test/1' },
      { id: 202, url: 'https://b.test/1' },
    ],
    now: '2026-05-22T08:00:00.000Z',
  });

  assert.equal(restored.state.groups.length, 0);
  assert.deepEqual(restored.chromeGroupPlans, [
    { title: 'Work', color: 'blue', tabIds: ['201', '202'] },
  ]);
});

test('createRestoredSessionGroups chrome plan skips tabs that were not restored', () => {
  const restored = createRestoredSessionGroups({
    existingState: { groups: [], assignments: {} },
    session: {
      groups: [
        { key: '__chrome_group__:77', label: 'Work', manualGroupId: '', chromeGroupColor: 'red', tabUrls: ['https://a.test/1', 'https://b.test/1', 'https://c.test/1'] },
      ],
    },
    restoredTabs: [
      { id: 301, url: 'https://a.test/1' },
      // https://b.test/1 and https://c.test/1 were not restored
    ],
    now: '2026-05-22T08:00:00.000Z',
  });

  assert.deepEqual(restored.chromeGroupPlans, [
    { title: 'Work', color: 'red', tabIds: ['301'] },
  ]);
});

test('createRestoredSessionGroups chrome plan includes every restored tab sharing a recorded url', () => {
  const restored = createRestoredSessionGroups({
    existingState: { groups: [], assignments: {} },
    session: {
      groups: [
        { key: '__chrome_group__:77', label: 'Work', manualGroupId: '', chromeGroupColor: 'blue', tabUrls: ['https://a.test/1'] },
      ],
    },
    restoredTabs: [
      { id: 401, url: 'https://a.test/1' },
      { id: 402, url: 'https://a.test/1' },
    ],
    now: '2026-05-22T08:00:00.000Z',
  });

  assert.deepEqual(restored.chromeGroupPlans, [
    { title: 'Work', color: 'blue', tabIds: ['401', '402'] },
  ]);
});

test('createRestoredSessionGroups keeps identical URLs in different Chrome groups attached to their saved instances', () => {
  const restored = createRestoredSessionGroups({
    existingState: { groups: [], assignments: {} },
    session: {
      tabs: [
        { url: 'https://example.test/article', groupKey: '__chrome_group__:work' },
        { url: 'https://example.test/article', groupKey: '__chrome_group__:reading' },
      ],
      groups: [
        { key: '__chrome_group__:work', label: 'Work', chromeGroupColor: 'blue', tabUrls: ['https://example.test/article'] },
        { key: '__chrome_group__:reading', label: 'Reading', chromeGroupColor: 'red', tabUrls: ['https://example.test/article'] },
      ],
    },
    restoredTabs: [
      { id: 501, url: 'https://example.test/article', sourceIndex: 0 },
      { id: 502, url: 'https://example.test/article', sourceIndex: 1 },
    ],
  });

  assert.deepEqual(restored.chromeGroupPlans, [
    { title: 'Work', color: 'blue', tabIds: ['501'] },
    { title: 'Reading', color: 'red', tabIds: ['502'] },
  ]);
});

test('createRestoredSessionGroups keeps repeated identical URLs in one manual group', () => {
  const restored = createRestoredSessionGroups({
    existingState: { groups: [], assignments: {} },
    session: {
      tabs: [
        { url: 'https://example.test/article', groupKey: '__session_group__:research' },
        { url: 'https://example.test/article', groupKey: '__session_group__:research' },
      ],
      groups: [
        { key: '__session_group__:research', label: 'Research', manualGroupId: 'research', tabUrls: ['https://example.test/article', 'https://example.test/article'] },
      ],
    },
    restoredTabs: [
      { id: 601, url: 'https://example.test/article', sourceIndex: 0 },
      { id: 602, url: 'https://example.test/article', sourceIndex: 1 },
    ],
    now: '2026-08-17T00:00:00.000Z',
  });

  assert.equal(restored.state.groups.length, 1);
  const groupId = restored.state.groups[0].id;
  assert.equal(restored.state.assignments['601'], groupId);
  assert.equal(restored.state.assignments['602'], groupId);
});

test('chrome group colors survive the save to reload storage round-trip', async () => {
  const store = {};
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(next) {
          Object.assign(store, next);
        },
      },
    },
  };

  const snapshot = buildSessionSnapshot({
    tabs: [
      { id: 51, url: 'https://a.test/1', title: 'A1', windowId: 1 },
      { id: 52, url: 'https://b.test/1', title: 'B1', windowId: 1 },
    ],
    groupLookup: new Map([
      ['51', { key: '__chrome_group__:88', label: 'Pink', manualGroupId: '', chromeGroupColor: 'pink' }],
      ['52', { key: '__chrome_group__:88', label: 'Pink', manualGroupId: '', chromeGroupColor: 'pink' }],
    ]),
    selectedTabIds: ['51', '52'],
    source: 'selected',
    now: '2026-05-22T08:00:00.000Z',
  });

  const [saved] = await addSavedTabSession(snapshot);
  const reloaded = await getSavedTabSessions();

  assert.equal(saved.groups[0].chromeGroupColor, 'pink');
  assert.equal(reloaded[0].groups[0].chromeGroupColor, 'pink');
});

test('updateSavedTabSessionTabs rebuilds groups keeping chrome group colors', async () => {
  const store = {
    savedTabSessions: [
      {
        id: 'session-a',
        name: 'Session',
        savedAt: '2026-05-22T08:00:00.000Z',
        source: 'manual',
        tabs: [
          { url: 'https://a.test', title: 'A', groupKey: '__chrome_group__:77', groupLabel: 'Work', chromeGroupColor: 'blue' },
        ],
        groups: [
          { key: '__chrome_group__:77', label: 'Work', manualGroupId: '', chromeGroupColor: 'blue', tabUrls: ['https://a.test'] },
        ],
      },
    ],
  };
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(next) {
          Object.assign(store, next);
        },
      },
    },
  };

  const updated = await updateSavedTabSessionTabs('session-a', [
    { url: 'https://b.test', title: 'B', groupKey: '__chrome_group__:77', groupLabel: 'Work', chromeGroupColor: 'blue' },
    { url: 'https://a.test', title: 'A', groupKey: '__chrome_group__:77', groupLabel: 'Work', chromeGroupColor: 'blue' },
  ]);

  assert.deepEqual(updated[0].groups, [
    { key: '__chrome_group__:77', label: 'Work', manualGroupId: '', chromeGroupColor: 'blue', tabUrls: ['https://b.test', 'https://a.test'] },
  ]);
});

test('renameSavedTabSession updates the matching session name', async () => {
  const store = {
    savedTabSessions: [
      {
        id: 'session-a',
        name: 'Before',
        savedAt: '2026-05-22T08:00:00.000Z',
        source: 'manual',
        tabs: [{ url: 'https://example.com', title: 'Example' }],
        groups: [],
      },
    ],
  };
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(next) {
          Object.assign(store, next);
        },
      },
    },
  };

  const renamed = await renameSavedTabSession('session-a', 'After');
  assert.equal(renamed[0].name, 'After');
  assert.equal(store.savedTabSessions[0].name, 'After');
});

test('updateSavedTabSessionTabs reorders tabs and rebuilds groups', async () => {
  const store = {
    savedTabSessions: [
      {
        id: 'session-a',
        name: 'Session',
        savedAt: '2026-05-22T08:00:00.000Z',
        source: 'manual',
        tabs: [
          { url: 'https://a.test', title: 'A', groupKey: 'group-a', groupLabel: 'Group A' },
          { url: 'https://b.test', title: 'B', groupKey: 'group-b', groupLabel: 'Group B' },
        ],
        groups: [
          { key: 'group-a', label: 'Group A', manualGroupId: '', tabUrls: ['https://a.test'] },
          { key: 'group-b', label: 'Group B', manualGroupId: '', tabUrls: ['https://b.test'] },
        ],
      },
    ],
  };
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(next) {
          Object.assign(store, next);
        },
      },
    },
  };

  const updated = await updateSavedTabSessionTabs('session-a', [
    { url: 'https://b.test', title: 'B', groupKey: 'group-b', groupLabel: 'Group B' },
    { url: 'https://a.test', title: 'A', groupKey: 'group-a', groupLabel: 'Group A' },
  ]);
  assert.deepEqual(updated[0].tabs.map(tab => tab.url), ['https://b.test', 'https://a.test']);
  assert.deepEqual(updated[0].groups.map(group => group.key), ['group-b', 'group-a']);
});

test('updateSavedTabSessionTabs removes the session when no tabs remain', async () => {
  const store = {
    savedTabSessions: [
      {
        id: 'session-a',
        name: 'Session',
        savedAt: '2026-05-22T08:00:00.000Z',
        source: 'manual',
        tabs: [{ url: 'https://a.test', title: 'A' }],
        groups: [],
      },
    ],
  };
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(next) {
          Object.assign(store, next);
        },
      },
    },
  };

  const updated = await updateSavedTabSessionTabs('session-a', []);
  assert.equal(updated.length, 0);
});

test('appendSavedTabSessionTabs appends new tabs, skips duplicate urls, and rebuilds groups', async () => {
  const store = {
    savedTabSessions: [
      {
        id: 'session-a',
        name: 'Session',
        savedAt: '2026-05-22T08:00:00.000Z',
        source: 'manual',
        tabs: [
          { url: 'https://a.test', title: 'A', groupKey: 'group-a', groupLabel: 'Group A' },
        ],
        groups: [
          { key: 'group-a', label: 'Group A', manualGroupId: '', tabUrls: ['https://a.test'] },
        ],
      },
    ],
  };
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(next) {
          Object.assign(store, next);
        },
      },
    },
  };

  const result = await appendSavedTabSessionTabs('session-a', [
    {
      url: 'extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#ttl=Duplicate%20A&uri=https%3A%2F%2Fa.test',
      title: 'Duplicate A',
      groupKey: 'group-a',
      groupLabel: 'Group A',
    },
    { url: 'https://b.test', title: 'B', groupKey: 'group-b', groupLabel: 'Group B' },
  ]);

  assert.equal(result.appendedCount, 1);
  assert.equal(result.skippedDuplicateCount, 1);
  assert.deepEqual(result.session.tabs.map(tab => tab.url), ['https://a.test', 'https://b.test']);
  assert.deepEqual(result.session.groups.map(group => group.key), ['group-a', 'group-b']);
  assert.equal(result.session.id, 'session-a');
  assert.equal(result.session.name, 'Session');
  assert.equal(result.session.savedAt, '2026-05-22T08:00:00.000Z');
  assert.equal(result.session.source, 'manual');
});

test('appendSavedTabSessionTabs rejects missing target sessions and invalid tabs', async () => {
  const store = {
    savedTabSessions: [
      {
        id: 'session-a',
        name: 'Session',
        savedAt: '2026-05-22T08:00:00.000Z',
        source: 'manual',
        tabs: [{ url: 'https://a.test', title: 'A' }],
        groups: [],
      },
    ],
  };
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(next) {
          Object.assign(store, next);
        },
      },
    },
  };

  await assert.rejects(
    () => appendSavedTabSessionTabs('missing', [{ url: 'https://b.test', title: 'B' }]),
    /session not found/i
  );
  await assert.rejects(
    () => appendSavedTabSessionTabs('session-a', [{ url: 'chrome://settings', title: 'Settings' }]),
    /no restorable tabs selected/i
  );
});

test('createSavedTabSessionFromTab derives name, source, savedAt, tabs, and groups from one dragged tab', () => {
  const created = createSavedTabSessionFromTab({
    sourceSession: {
      id: 'session-a',
      name: 'Original',
      source: 'window',
    },
    tab: {
      url: 'https://github.com/openai/openai-node/issues/123',
      title: 'SDK issue - GitHub',
      favIconUrl: 'https://github.com/favicon.ico',
      groupKey: '__session_group__:bugs',
      groupLabel: 'Bugs',
      manualGroupId: 'bugs',
    },
    existingSessions: [],
    now: '2026-05-22T09:30:00.000Z',
  });

  assert.equal(created.name, 'SDK issue');
  assert.equal(created.source, 'window');
  assert.equal(created.savedAt, '2026-05-22T09:30:00.000Z');
  assert.equal(created.tabs.length, 1);
  assert.deepEqual(created.groups, [
    {
      key: '__session_group__:bugs',
      label: 'Bugs',
      manualGroupId: 'bugs',
      chromeGroupColor: '',
      tabUrls: ['https://github.com/openai/openai-node/issues/123'],
    },
  ]);
});

test('createSavedTabSessionFromTab falls back to friendly domain and de-duplicates duplicate session names', () => {
  const created = createSavedTabSessionFromTab({
    sourceSession: {
      id: 'session-a',
      name: 'Original',
      source: '',
    },
    tab: {
      url: 'https://docs.github.com/en/actions',
      title: '',
      favIconUrl: '',
      groupKey: '',
      groupLabel: '',
      manualGroupId: '',
    },
    existingSessions: [
      {
        id: 'session-b',
        name: 'Docs',
        savedAt: '2026-05-22T08:00:00.000Z',
        source: 'manual',
        tabs: [{ url: 'https://example.com', title: 'Example' }],
        groups: [],
      },
    ],
    now: '2026-05-22T09:30:00.000Z',
  });

  assert.equal(created.name, 'Docs 2');
  assert.equal(created.source, 'manual');
});
