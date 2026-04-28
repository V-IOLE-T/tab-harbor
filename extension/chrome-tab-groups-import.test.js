'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./session-groups.js');
require('./chrome-tab-groups-import.js');

const {
  reconcileChromeTabGroupImports,
} = globalThis.TabOutChromeTabGroupImport;

test('reconcileChromeTabGroupImports creates managed session groups for native Chrome groups', () => {
  const result = reconcileChromeTabGroupImports({
    currentState: { groups: [], assignments: {} },
    importedMeta: { entries: [] },
    nativeGroups: [
      {
        chromeGroupId: 101,
        windowId: 1,
        title: 'Work',
        color: 'blue',
        tabIds: [11, 12],
      },
    ],
  });

  assert.equal(result.state.groups.length, 1);
  assert.equal(result.state.groups[0].name, 'Work');
  assert.equal(result.state.assignments['11'], result.state.groups[0].id);
  assert.equal(result.state.assignments['12'], result.state.groups[0].id);
  assert.deepEqual(result.importedMeta.entries, [
    {
      sessionGroupId: result.state.groups[0].id,
      chromeGroupId: 101,
      windowId: 1,
      title: 'Work',
      color: 'blue',
    },
  ]);
  assert.deepEqual(result.mappings, [
    {
      virtualGroupKey: `__session_group__:${result.state.groups[0].id}`,
      windowId: 1,
      chromeGroupId: 101,
    },
  ]);
});

test('reconcileChromeTabGroupImports reuses existing managed group and updates its title', () => {
  const result = reconcileChromeTabGroupImports({
    currentState: {
      groups: [
        { id: 'session-1', name: 'Old Work', createdAt: '2026-04-28T00:00:00.000Z' },
      ],
      assignments: { '11': 'session-1' },
    },
    importedMeta: {
      entries: [
        {
          sessionGroupId: 'session-1',
          chromeGroupId: 101,
          windowId: 1,
          title: 'Old Work',
          color: 'blue',
        },
      ],
    },
    nativeGroups: [
      {
        chromeGroupId: 101,
        windowId: 1,
        title: 'Work',
        color: 'red',
        tabIds: [22],
      },
    ],
  });

  assert.equal(result.state.groups.length, 1);
  assert.equal(result.state.groups[0].id, 'session-1');
  assert.equal(result.state.groups[0].name, 'Work');
  assert.deepEqual(result.state.assignments, { '22': 'session-1' });
  assert.equal(result.importedMeta.entries[0].color, 'red');
});

test('reconcileChromeTabGroupImports removes stale managed groups when Chrome groups disappear', () => {
  const result = reconcileChromeTabGroupImports({
    currentState: {
      groups: [
        { id: 'managed-1', name: 'Imported', createdAt: '2026-04-28T00:00:00.000Z' },
        { id: 'manual-1', name: 'Manual', createdAt: '2026-04-28T00:00:00.000Z' },
      ],
      assignments: {
        '11': 'managed-1',
        '22': 'manual-1',
      },
    },
    importedMeta: {
      entries: [
        {
          sessionGroupId: 'managed-1',
          chromeGroupId: 101,
          windowId: 1,
          title: 'Imported',
          color: 'blue',
        },
      ],
    },
    nativeGroups: [],
  });

  assert.deepEqual(result.state.groups.map(group => group.id), ['manual-1']);
  assert.deepEqual(result.state.assignments, { '22': 'manual-1' });
  assert.deepEqual(result.importedMeta.entries, []);
});

test('reconcileChromeTabGroupImports matches persisted metadata when Chrome group ids change after restart', () => {
  const result = reconcileChromeTabGroupImports({
    currentState: {
      groups: [
        { id: 'session-1', name: 'Work', createdAt: '2026-04-28T00:00:00.000Z' },
      ],
      assignments: {},
    },
    importedMeta: {
      entries: [
        {
          sessionGroupId: 'session-1',
          chromeGroupId: 101,
          windowId: 3,
          title: 'Work',
          color: 'blue',
        },
      ],
    },
    nativeGroups: [
      {
        chromeGroupId: 808,
        windowId: 3,
        title: 'Work',
        color: 'blue',
        tabIds: [33],
      },
    ],
  });

  assert.equal(result.state.groups[0].id, 'session-1');
  assert.equal(result.state.assignments['33'], 'session-1');
  assert.equal(result.importedMeta.entries[0].chromeGroupId, 808);
});
