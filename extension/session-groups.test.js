'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addSessionGroup,
  assignTabToSessionGroup,
  clearTabSessionGroup,
  pruneSessionGroups,
  renameSessionGroup,
} = require('./session-groups.js');

test('addSessionGroup creates a named group and keeps names unique', () => {
  const initialState = { groups: [], assignments: {} };
  const { state, group } = addSessionGroup(initialState, 'Work');

  assert.equal(group.name, 'Work');
  assert.equal(state.groups.length, 1);
  assert.throws(() => addSessionGroup(state, 'Work'), /already exists/i);
});

test('assignTabToSessionGroup stores a single active assignment per tab', () => {
  const initialState = {
    groups: [{ id: 'g1', name: 'Work', createdAt: '2026-04-16T00:00:00.000Z' }],
    assignments: {},
  };

  const assigned = assignTabToSessionGroup(initialState, 101, 'g1');
  assert.equal(assigned.assignments['101'], 'g1');

  const cleared = clearTabSessionGroup(assigned, 101);
  assert.equal(cleared.assignments['101'], undefined);
});

test('pruneSessionGroups removes closed tabs and empty groups', () => {
  const initialState = {
    groups: [
      { id: 'g1', name: 'Work', createdAt: '2026-04-16T00:00:00.000Z' },
      { id: 'g2', name: 'Research', createdAt: '2026-04-16T00:01:00.000Z' },
    ],
    assignments: {
      '101': 'g1',
      '102': 'g2',
    },
  };

  const pruned = pruneSessionGroups(initialState, [101]);

  assert.deepEqual(pruned.assignments, { '101': 'g1' });
  assert.deepEqual(pruned.groups.map(group => group.id), ['g1']);
});

test('renameSessionGroup updates the target name and preserves uniqueness', () => {
  const initialState = {
    groups: [
      { id: 'g1', name: 'Work', createdAt: '2026-04-16T00:00:00.000Z' },
      { id: 'g2', name: 'Research', createdAt: '2026-04-16T00:01:00.000Z' },
    ],
    assignments: {
      '101': 'g1',
    },
  };

  const renamed = renameSessionGroup(initialState, 'g1', 'Reading desk');
  assert.equal(renamed.groups[0].name, 'Reading desk');
  assert.equal(renamed.assignments['101'], 'g1');
  assert.throws(() => renameSessionGroup(renamed, 'g1', 'Research'), /already exists/i);
});
