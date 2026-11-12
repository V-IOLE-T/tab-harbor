'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const BACKGROUND_PATH = path.join(__dirname, 'background.js');

// background.js schedules a 5s post-grace timer for every created tab; real
// setTimeout would keep the test process alive. Stub it out (record, never
// fire) so these broadcast tests run fast.
const pendingTimers = new Map();
let nextTimerId = 1;
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
global.setTimeout = (fn, delay) => { const id = nextTimerId++; pendingTimers.set(id, fn); return id; };
global.clearTimeout = (id) => { pendingTimers.delete(id); };

// background.js registers listeners at top level and caches its module, so we
// flush the cache and re-evaluate it for each scenario.
function loadBackground(chrome) {
  global.chrome = chrome;
  delete require.cache[require.resolve(BACKGROUND_PATH)];
  require(BACKGROUND_PATH);
}

function buildChrome() {
  const captured = {};
  const state = {
    sendMessageCalls: [],
    warnCalls: [],
  };

  const chrome = {
    runtime: {
      id: 'test-ext-id',
      getURL: (p) => `chrome-extension://test-ext-id/${p}`,
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      sendMessage: async () => {},
    },
    action: {
      setBadgeText: async () => {},
    },
    tabs: {
      query: async () => [],
      remove: async () => {},
      onCreated: { addListener: (cb) => { captured.onCreated = cb; } },
      onRemoved: { addListener: (cb) => { captured.onRemoved = cb; } },
      onUpdated: { addListener: (cb) => { captured.onUpdated = cb; } },
      onReplaced: { addListener: (cb) => { captured.onReplaced = cb; } },
    },
    storage: {
      local: { get: async () => ({}) },
    },
  };

  return { chrome, captured, state };
}

test('tab events broadcast via chrome.runtime.sendMessage, not content-script channel', async () => {
  const { chrome, captured, state } = buildChrome();
  chrome.runtime.sendMessage = async (msg) => {
    state.sendMessageCalls.push(msg);
  };
  loadBackground(chrome);
  assert.ok(captured.onCreated, 'background should register a tabs.onCreated listener');

  await captured.onCreated({ id: 99 });

  assert.strictEqual(state.sendMessageCalls.length, 1);
  assert.deepStrictEqual(state.sendMessageCalls[0], {
    action: 'tabs-changed',
    source: 'tabs.onCreated',
    triggerTabId: 99,
  });

  await captured.onRemoved(42);
  const last = state.sendMessageCalls[state.sendMessageCalls.length - 1];
  assert.deepStrictEqual(last, {
    action: 'tabs-changed',
    source: 'tabs.onRemoved',
    triggerTabId: 42,
  });
});

test('"Receiving end does not exist" rejection is swallowed silently', async () => {
  const { chrome, captured, state } = buildChrome();
  chrome.runtime.sendMessage = async () => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };

  const originalWarn = console.warn;
  console.warn = (...args) => { state.warnCalls.push(args); };
  try {
    loadBackground(chrome);
    await captured.onCreated({ id: 7 });
  } finally {
    console.warn = originalWarn;
  }

  assert.strictEqual(state.warnCalls.length, 0);
});

test('non-connection errors from sendMessage are surfaced via console.warn', async () => {
  const { chrome, captured, state } = buildChrome();
  chrome.runtime.sendMessage = async () => {
    throw new Error('unexpected broadcast failure');
  };

  const originalWarn = console.warn;
  console.warn = (...args) => { state.warnCalls.push(args); };
  try {
    loadBackground(chrome);
    await captured.onCreated({ id: 7 });
  } finally {
    console.warn = originalWarn;
  }

  assert.strictEqual(state.warnCalls.length, 1);
  assert.match(state.warnCalls[0].join(' '), /unexpected broadcast failure/);
});

test('tab replacement broadcasts via chrome.runtime.sendMessage', async () => {
  const { chrome, captured, state } = buildChrome();
  chrome.tabs.get = async (id) => ({ id, windowId: 7 });
  chrome.runtime.sendMessage = async (msg) => {
    state.sendMessageCalls.push(msg);
  };
  loadBackground(chrome);
  assert.ok(captured.onReplaced, 'background should register a tabs.onReplaced listener');

  await captured.onReplaced(123, 122);

  assert.strictEqual(state.sendMessageCalls.length, 1);
  assert.deepStrictEqual(state.sendMessageCalls[0], {
    action: 'tabs-changed',
    source: 'tabs.onReplaced',
    triggerTabId: 123,
    replacedTabId: 122,
    windowId: 7,
  });
});
