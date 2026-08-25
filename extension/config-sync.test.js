'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  exportConfig,
  importConfig,
  CONFIG_VERSION,
  STORAGE_KEYS,
} = require('./config-sync.js');

function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    chrome: {
      storage: {
        local: {
          get: async (keys) => {
            const result = {};
            for (const key of keys) {
              if (key in store) result[key] = store[key];
            }
            return result;
          },
          set: async (payload) => {
            Object.assign(store, payload);
          },
        },
      },
    },
  };
}

async function withMockStorage(initial, fn) {
  const mock = createMockStorage(initial);
  const originalChrome = mock.chrome;
  globalThis.chrome = originalChrome;
  try {
    await fn(mock.store);
  } finally {
    delete globalThis.chrome;
  }
}

test('STORAGE_KEYS includes popupView so popup view memory survives export/import', () => {
  assert.ok(STORAGE_KEYS.includes('popupView'), 'popupView must round-trip through config export/import');
});

test('STORAGE_KEYS excludes session-only Chrome group identity metadata', () => {
  assert.ok(!STORAGE_KEYS.includes('chromeTabGroupsMeta'));
  assert.ok(!STORAGE_KEYS.includes('automaticTabGroupRuleOverrides'));
  assert.ok(!STORAGE_KEYS.includes('chromeTabGroupsCleanupPending'));
});

test('exportConfig returns the complete versioned configuration with custom icons', async () => {
  const initial = {
    themePreferences: { mode: 'dark', paletteId: 'sage' },
    quickShortcuts: [{ id: 's1', url: 'https://example.com', label: 'Example', icon: '🔥', iconKind: 'glyph' }],
    savedTabSessions: [],
    languagePreference: 'zh-CN',
    todos: [{ id: 'todo-1', title: 'Read' }],
    sessionGroups: { groups: [], assignments: {} },
    groupOrder: { sessionOrder: ['g1'], pinnedOrder: [], pinEnabled: true },
    groupTabOrder: { g1: ['tab-1'] },
    groupLabelOverrides: { g1: 'Work' },
    savedTabSessionOrder: ['session-1'],
    savedTabSessionCollapsedState: { 'session-1': true },
    chromeTabGroupsEnabled: true,
    importedChromeSessionGroups: { entries: [] },
    deferredTriggerPosition: { top: 120 },
  };

  await withMockStorage(initial, async () => {
    const json = await exportConfig();
    const parsed = JSON.parse(json);

    assert.equal(parsed.version, CONFIG_VERSION);
    assert.ok(typeof parsed.exportedAt === 'string');
    assert.deepEqual(parsed.themePreferences, initial.themePreferences);
    assert.deepEqual(parsed.quickShortcuts, initial.quickShortcuts);
    assert.deepEqual(parsed.savedTabSessions, initial.savedTabSessions);
    for (const key of STORAGE_KEYS) assert.ok(key in parsed, `missing ${key}`);
    assert.deepEqual(parsed, { ...parsed, ...initial });
  });
});

test('exportConfig works with empty/missing data', async () => {
  await withMockStorage({}, async () => {
    const json = await exportConfig();
    const parsed = JSON.parse(json);

    assert.equal(parsed.version, CONFIG_VERSION);
    for (const key of STORAGE_KEYS) {
      assert.ok(key in parsed, `missing ${key}`);
      assert.equal(parsed[key], null);
    }
  });
});

test('exportConfig serializes unset keys as null under real Chrome get semantics', async () => {
  // Real chrome.storage.local.get(keys[]) resolves EVERY requested key —
  // unset keys come back as undefined (not absent). exportConfig must turn
  // those into explicit null so a later import resets them to defaults on the
  // target device; a missing key would be skipped by the importer instead.
  const store = { themePreferences: { mode: 'dark' } };
  const chromeLike = {
    storage: {
      local: {
        async get(keys) {
          const result = {};
          for (const key of keys) result[key] = key in store ? store[key] : undefined;
          return result;
        },
        async set(payload) {
          Object.assign(store, payload);
        },
      },
    },
  };
  const originalChrome = globalThis.chrome;
  globalThis.chrome = chromeLike;
  try {
    const json = await exportConfig();
    const parsed = JSON.parse(json);

    assert.deepEqual(parsed.themePreferences, { mode: 'dark' });
    assert.equal(parsed.quickShortcuts, null);
    assert.equal(parsed.savedTabSessions, null);
    assert.equal(parsed.popupView, null);
    for (const key of STORAGE_KEYS) assert.ok(key in parsed, `missing ${key}`);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('importConfig writes the complete configuration to storage', async () => {
  const incoming = {
    version: CONFIG_VERSION,
    themePreferences: { mode: 'light', paletteId: 'mist' },
    quickShortcuts: [{ id: 's2', url: 'https://test.dev', label: 'Test', icon: '🔥', iconKind: 'glyph' }],
    savedTabSessions: [{
      id: 'tab-session-123',
      name: 'My tabs',
      savedAt: '2026-01-01T00:00:00.000Z',
      source: 'manual',
      tabs: [{ url: 'https://example.com', title: 'Example' }],
      groups: [],
    }],
    languagePreference: 'en',
    todos: [],
    sessionGroups: { groups: [], assignments: {} },
    groupOrder: { sessionOrder: [], pinnedOrder: [], pinEnabled: false },
    groupTabOrder: {},
    groupLabelOverrides: {},
    savedTabSessionOrder: [],
    savedTabSessionCollapsedState: {},
    chromeTabGroupsEnabled: false,
    importedChromeSessionGroups: { entries: [] },
    deferredTriggerPosition: { top: null },
    popupView: 'tabs',
  };
  const jsonString = JSON.stringify(incoming);

  await withMockStorage({}, async (store) => {
    const result = await importConfig(jsonString);

    assert.deepEqual(result.importedKeys.sort(), [...STORAGE_KEYS].sort());
    assert.ok(store.themePreferences);
    assert.ok(Array.isArray(store.quickShortcuts));
    assert.ok(Array.isArray(store.savedTabSessions));
  });
});

test('importConfig rejects invalid JSON', async () => {
  await withMockStorage({}, async () => {
    await assert.rejects(
      importConfig('{ broken json'),
      /not valid JSON/,
    );
  });
});

test('importConfig treats null values as explicit resets', async () => {
  const incoming = {
    themePreferences: null,
    quickShortcuts: null,
    savedTabSessions: null,
  };
  const initial = {
    themePreferences: { mode: 'dark' },
    quickShortcuts: [{ id: 'old', url: 'https://old.example' }],
    savedTabSessions: [{ id: 'old' }],
  };

  await withMockStorage(initial, async (store) => {
    const result = await importConfig(JSON.stringify(incoming));

    assert.deepEqual(result.importedKeys.sort(), ['quickShortcuts', 'savedTabSessions', 'themePreferences']);
    assert.equal(store.themePreferences, null);
    assert.deepEqual(store.quickShortcuts, []);
    assert.deepEqual(store.savedTabSessions, []);
  });
});

test('importConfig rejects unsupported versions', async () => {
  await withMockStorage({}, async () => {
    await assert.rejects(
      importConfig(JSON.stringify({ version: CONFIG_VERSION + 1, quickShortcuts: [] })),
      /unsupported config version/,
    );
  });
});

test('importConfig rejects non-object root', async () => {
  await withMockStorage({}, async () => {
    await assert.rejects(importConfig('[1,2,3]'), /root must be an object/);
    await assert.rejects(importConfig('"string"'), /root must be an object/);
    await assert.rejects(importConfig('42'), /root must be an object/);
  });
});

test('importConfig rejects object with no recognized keys', async () => {
  await withMockStorage({}, async () => {
    await assert.rejects(
      importConfig(JSON.stringify({ foo: 'bar', baz: 123 })),
      /missing recognized data keys/,
    );
  });
});

test('importConfig rejects wrong types for known keys', async () => {
  await withMockStorage({}, async () => {
    await assert.rejects(
      importConfig(JSON.stringify({ quickShortcuts: 'not-an-array' })),
      /quickShortcuts must be an array/,
    );
    await assert.rejects(
      importConfig(JSON.stringify({ savedTabSessions: { bad: true } })),
      /savedTabSessions must be an array/,
    );
  });
});

test('importConfig does not corrupt existing data on failure', async () => {
  const initial = {
    themePreferences: { mode: 'dark', paletteId: 'paper' },
  };

  await withMockStorage(initial, async (store) => {
    await assert.rejects(importConfig('not json'));
    assert.deepEqual(store.themePreferences, initial.themePreferences);
  });
});

test('importConfig skips keys not present in the file', async () => {
  const incoming = {
    themePreferences: { mode: 'system', paletteId: 'blush' },
  };

  await withMockStorage({}, async (store) => {
    const result = await importConfig(JSON.stringify(incoming));

    assert.deepEqual(result.importedKeys, ['themePreferences']);
    assert.deepEqual(store.themePreferences, incoming.themePreferences);
    assert.ok(!('quickShortcuts' in store));
    assert.ok(!('savedTabSessions' in store));
  });
});
