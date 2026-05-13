'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyGroupOrder,
  createReorderedKeys,
  normalizeGroupOrderState,
  setPinEnabled,
} = require('./group-order.js');

test('normalizeGroupOrderState normalizes to a single durable order', () => {
  const state = normalizeGroupOrderState({
    sessionOrder: ['github.com', 'chatgpt.com'],
    pinnedOrder: ['chatgpt.com'],
    pinEnabled: true,
  });

  assert.deepEqual(state.sessionOrder, ['github.com', 'chatgpt.com']);
  assert.deepEqual(state.pinnedOrder, ['github.com', 'chatgpt.com']);
  assert.equal(state.pinEnabled, false);
});

test('applyGroupOrder prefers session order, then appends unseen groups', () => {
  const groups = [
    { domain: 'github.com' },
    { domain: 'chatgpt.com' },
    { domain: '__landing-pages__' },
  ];

  const ordered = applyGroupOrder(groups, {
    sessionOrder: ['chatgpt.com'],
    pinnedOrder: ['github.com'],
    pinEnabled: true,
  });

  assert.deepEqual(
    ordered.map(group => group.domain),
    ['chatgpt.com', 'github.com', '__landing-pages__']
  );
});

test('applyGroupOrder falls back to stored durable order when session order is empty', () => {
  const groups = [
    { domain: 'github.com' },
    { domain: 'chatgpt.com' },
    { domain: '__landing-pages__' },
  ];

  const ordered = applyGroupOrder(groups, {
    sessionOrder: [],
    pinnedOrder: ['__landing-pages__', 'github.com'],
    pinEnabled: true,
  });

  assert.deepEqual(
    ordered.map(group => group.domain),
    ['__landing-pages__', 'github.com', 'chatgpt.com']
  );
});

test('createReorderedKeys moves dragged group before target group', () => {
  const reordered = createReorderedKeys(
    ['github.com', 'chatgpt.com', '__landing-pages__'],
    '__landing-pages__',
    'github.com'
  );

  assert.deepEqual(reordered, ['__landing-pages__', 'github.com', 'chatgpt.com']);
});

test('createReorderedKeys can preview dropping after the hovered target', () => {
  const reordered = createReorderedKeys(
    ['github.com', 'chatgpt.com', '__landing-pages__'],
    '__landing-pages__',
    'github.com',
    true
  );

  assert.deepEqual(reordered, ['github.com', '__landing-pages__', 'chatgpt.com']);
});

test('setPinEnabled preserves the current durable order for legacy callers', () => {
  const nextState = setPinEnabled(
    {
      sessionOrder: ['chatgpt.com', 'github.com'],
      pinnedOrder: [],
      pinEnabled: false,
    },
    true,
    ['chatgpt.com', 'github.com']
  );

  assert.equal(nextState.pinEnabled, false);
  assert.deepEqual(nextState.sessionOrder, ['chatgpt.com', 'github.com']);
  assert.deepEqual(nextState.pinnedOrder, ['chatgpt.com', 'github.com']);
});
