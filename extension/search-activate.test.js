'use strict';

// Smoke tests for the search-suggestion activation path against the REAL
// dashboard-runtime.js. activateSearchSuggestion is async and depends on
// closeSearchSuggestions (DOM), getTabIdValue, and chrome.* — we stub those
// and assert the exact chrome call sequence for each suggestion type.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimeJs = fs.readFileSync(path.join(__dirname, 'dashboard-runtime.js'), 'utf8');

function extractFn(source, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(source);
  if (!m) throw new Error(`function ${name} not found`);
  const closeParen = source.indexOf(')', m.index);
  let i = source.indexOf('{', closeParen);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  // m.index already points at 'async ' when present; the slice keeps the
  // keyword so the extracted function remains async (its body uses await).
  return source.slice(m.index, i + 1);
}

// -- shared stubs ----------------------------------------------------------
const calls = [];
const documentStub = {
  getElementById: () => ({
    setAttribute() {},
    focus() {},
  }),
  querySelector: () => null,
  querySelectorAll: () => [],
  activeElement: null,
};

const chromeStub = {
  tabs: {
    get: async (id) => ({ id, windowId: 7 }),
    update: async (id, props) => { calls.push(['tabs.update', id, props]); return {}; },
    create: async (props) => { calls.push(['tabs.create', props]); return {}; },
  },
  windows: {
    update: async (id, props) => { calls.push(['windows.update', id, props]); return {}; },
  },
};

function makeEnv() {
  calls.length = 0;
  const sandbox = {
    document: documentStub,
    chrome: chromeStub,
    console,
    Date,
    getTabIdValue: (v) => Number(v),
    closeSearchSuggestions: () => { calls.push(['closeSearchSuggestions']); },
    syncChromeTabGroupExpansionForTab: async () => {},
    openOrFocusUrl: async (url) => { calls.push(['openOrFocusUrl', url]); },
    isExtensionContextInvalidated: () => false,
    recoverFromInvalidatedExtensionContext: () => {},
  };
  const fn = new Function(
    'document', 'chrome', 'getTabIdValue', 'closeSearchSuggestions',
    'syncChromeTabGroupExpansionForTab', 'openOrFocusUrl',
    'isExtensionContextInvalidated', 'recoverFromInvalidatedExtensionContext',
    'chromeTabGroupSyncGroups',
    `${extractFn(runtimeJs, 'activateSearchSuggestion')}\nreturn activateSearchSuggestion;`
  )(sandbox.document, sandbox.chrome, sandbox.getTabIdValue, sandbox.closeSearchSuggestions,
    sandbox.syncChromeTabGroupExpansionForTab, sandbox.openOrFocusUrl,
    sandbox.isExtensionContextInvalidated, sandbox.recoverFromInvalidatedExtensionContext, []);
  return fn;
}

test('activateSearchSuggestion: open-tab row switches to that tab', async () => {
  const fn = makeEnv();
  const row = {
    dataset: { suggestionType: 'tab', suggestionUrl: 'https://t.example/', suggestionTabId: '42' },
  };
  await fn(row, { openInNewTab: false });
  assert.deepEqual(calls, [
    ['closeSearchSuggestions'],
    ['tabs.update', 42, { active: true }],
    ['windows.update', 7, { focused: true }],
  ]);
});

test('activateSearchSuggestion: open-tab row with Ctrl opens duplicate in new tab', async () => {
  const fn = makeEnv();
  const row = {
    dataset: { suggestionType: 'tab', suggestionUrl: 'https://t.example/', suggestionTabId: '42' },
  };
  await fn(row, { openInNewTab: true });
  assert.deepEqual(calls, [
    ['closeSearchSuggestions'],
    ['tabs.create', { url: 'https://t.example/', active: false }],
  ]);
});

test('activateSearchSuggestion: history row opens URL in new tab (openOrFocusUrl)', async () => {
  const fn = makeEnv();
  const row = {
    dataset: { suggestionType: 'history', suggestionUrl: 'https://h.example/', suggestionTabId: '' },
  };
  await fn(row, { openInNewTab: false });
  assert.deepEqual(calls, [
    ['closeSearchSuggestions'],
    ['openOrFocusUrl', 'https://h.example/'],
  ]);
});

test('activateSearchSuggestion: stale tab falls through to URL open', async () => {
  const callsLocal = [];
  const doc = documentStub;
  const chromeLocal = {
    tabs: {
      get: async () => { throw new Error('no tab'); },
      update: async () => {},
      create: async (props) => { callsLocal.push(['tabs.create', props]); return {}; },
    },
    windows: { update: async () => {} },
  };
  const sandbox = {
    document: doc,
    chrome: chromeLocal,
    console,
    Date,
    getTabIdValue: (v) => Number(v),
    closeSearchSuggestions: () => { callsLocal.push(['closeSearchSuggestions']); },
    syncChromeTabGroupExpansionForTab: async () => {},
    openOrFocusUrl: async (url) => { callsLocal.push(['openOrFocusUrl', url]); },
    isExtensionContextInvalidated: () => false,
    recoverFromInvalidatedExtensionContext: () => {},
  };
  const fn = new Function(
    'document', 'chrome', 'getTabIdValue', 'closeSearchSuggestions',
    'syncChromeTabGroupExpansionForTab', 'openOrFocusUrl',
    'isExtensionContextInvalidated', 'recoverFromInvalidatedExtensionContext',
    'chromeTabGroupSyncGroups',
    `${extractFn(runtimeJs, 'activateSearchSuggestion')}\nreturn activateSearchSuggestion;`
  )(sandbox.document, sandbox.chrome, sandbox.getTabIdValue, sandbox.closeSearchSuggestions,
    sandbox.syncChromeTabGroupExpansionForTab, sandbox.openOrFocusUrl,
    sandbox.isExtensionContextInvalidated, sandbox.recoverFromInvalidatedExtensionContext, []);

  const row = {
    dataset: { suggestionType: 'tab', suggestionUrl: 'https://t.example/', suggestionTabId: '99' },
  };
  await fn(row, { openInNewTab: false });
  // Stale tab: falls through to URL open. closeSearchSuggestions is idempotent
  // and may be called once (tab path) or twice (tab path + URL fallthrough).
  assert.ok(callsLocal.some(call => call[0] === 'openOrFocusUrl' && call[1] === 'https://t.example/'));
  assert.ok(callsLocal.some(call => call[0] === 'closeSearchSuggestions'));
  assert.ok(!callsLocal.some(call => call[0] === 'tabs.update'), 'must not try to switch a dead tab');
});
