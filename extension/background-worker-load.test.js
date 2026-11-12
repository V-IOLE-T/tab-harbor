'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function chromeEvent() {
  return { addListener() {} };
}

function loadBackgroundWorker({ unavailableScripts = [] } = {}) {
  const extensionDir = __dirname;
  const importedScripts = [];
  const unavailable = new Set(unavailableScripts);
  const sandbox = {
    URL,
    URLSearchParams,
    console,
    navigator: { language: 'en-US' },
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: {
        id: 'worker-load-test',
        getURL: relativePath => `chrome-extension://worker-load-test/${relativePath}`,
        onInstalled: chromeEvent(),
        onStartup: chromeEvent(),
        onMessage: chromeEvent(),
        async sendMessage() {},
      },
      action: { async setBadgeText() {} },
      tabs: {
        onCreated: chromeEvent(),
        onRemoved: chromeEvent(),
        onUpdated: chromeEvent(),
        onReplaced: chromeEvent(),
        onMoved: chromeEvent(),
        onAttached: chromeEvent(),
        onDetached: chromeEvent(),
        async query() { return []; },
        async get() { throw new Error('not used'); },
        async group() { return 1; },
        async ungroup() {},
        async move() {},
        async remove() {},
      },
      tabGroups: {
        async query() { return []; },
        async get() { throw new Error('not used'); },
        async update() {},
      },
      windows: {
        async getAll() { return []; },
      },
      storage: {
        local: {
          async get() { return { chromeTabGroupsEnabled: false }; },
          async set() {},
          async remove() {},
        },
        session: {
          async get() { return {}; },
          async set() {},
          async remove() {},
        },
        onChanged: chromeEvent(),
      },
    },
  };
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...relativePaths) => {
    for (const relativePath of relativePaths) {
      importedScripts.push(relativePath);
      if (unavailable.has(relativePath)) {
        throw new Error(`missing packaged worker script: ${relativePath}`);
      }
      const filename = path.join(extensionDir, relativePath);
      if (!fs.existsSync(filename)) {
        throw new Error(`missing packaged worker script: ${relativePath}`);
      }
      vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    }
  };

  vm.runInContext(
    fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8'),
    context,
    { filename: path.join(extensionDir, 'background.js') },
  );

  return { importedScripts, sandbox };
}

test('service worker imports only packaged scripts and has no global binding collisions', () => {
  const { importedScripts, sandbox } = loadBackgroundWorker();

  assert.deepEqual(importedScripts, [
    'config.js',
    'icon-utils.js',
    'tab-url-utils.js',
    'automatic-tab-groups.js',
    'chrome-tab-groups-coordinator.js',
  ]);
  assert.equal(typeof sandbox.TabHarborAutomaticTabGroups?.buildAutomaticChromeSyncSnapshot, 'function');
  assert.equal(typeof sandbox.TabHarborChromeTabGroupsCoordinator?.createChromeTabGroupsCoordinator, 'function');
  assert.equal(typeof sandbox.TabHarborBackground?.runAutomaticChromeGroupSync, 'function');
});

test('a missing required worker dependency fails the startup smoke test', () => {
  assert.throws(
    () => loadBackgroundWorker({ unavailableScripts: ['automatic-tab-groups.js'] }),
    /missing packaged worker script: automatic-tab-groups\.js/,
  );
});
