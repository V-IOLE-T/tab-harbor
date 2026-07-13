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

test('exportConfig returns JSON with version, exportedAt, and all three keys', async () => {
  const initial = {
    themePreferences: { mode: 'dark', paletteId: 'sage' },
    quickShortcuts: [{ id: 's1', url: 'https://example.com', label: 'Example' }],
    savedTabSessions: [],
  };

  await withMockStorage(initial, async () => {
    const json = await exportConfig();
    const parsed = JSON.parse(json);

    assert.equal(parsed.version, CONFIG_VERSION);
    assert.ok(typeof parsed.exportedAt === 'string');
    assert.deepEqual(parsed.themePreferences, initial.themePreferences);
    assert.deepEqual(parsed.quickShortcuts, initial.quickShortcuts);
    assert.deepEqual(parsed.savedTabSessions, initial.savedTabSessions);
  });
});

test('exportConfig works with empty/missing data', async () => {
  await withMockStorage({}, async () => {
    const json = await exportConfig();
    const parsed = JSON.parse(json);

    assert.equal(parsed.version, CONFIG_VERSION);
    assert.ok('themePreferences' in parsed);
    assert.ok('quickShortcuts' in parsed);
    assert.ok('savedTabSessions' in parsed);
  });
});

test('importConfig writes valid data to storage', async () => {
  const incoming = {
    themePreferences: { mode: 'light', paletteId: 'mist' },
    quickShortcuts: [{ id: 's2', url: 'https://test.dev', label: 'Test' }],
    savedTabSessions: [{
      id: 'tab-session-123',
      name: 'My tabs',
      savedAt: '2026-01-01T00:00:00.000Z',
      source: 'manual',
      tabs: [{ url: 'https://example.com', title: 'Example' }],
      groups: [],
    }],
  };
  const jsonString = JSON.stringify(incoming);

  await withMockStorage({}, async (store) => {
    const result = await importConfig(jsonString);

    assert.deepEqual(result.importedKeys.sort(), ['quickShortcuts', 'savedTabSessions', 'themePreferences']);
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
