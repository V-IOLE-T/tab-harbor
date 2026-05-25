'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionManifestPath = path.join(__dirname, 'manifest.json');
const rootManifestPath = path.join(__dirname, '..', 'manifest.json');

const extensionManifest = JSON.parse(fs.readFileSync(extensionManifestPath, 'utf8'));
const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'));

const PATH_PREFIX = 'extension/';

const SHARED_LITERAL_FIELDS = [
  'manifest_version',
  'name',
  'version',
  'description',
];

test('root manifest mirrors extension manifest on literal metadata fields', () => {
  for (const field of SHARED_LITERAL_FIELDS) {
    assert.deepEqual(
      rootManifest[field],
      extensionManifest[field],
      `manifest field "${field}" must match between extension/manifest.json and root manifest.json`,
    );
  }
});

test('root manifest mirrors extension manifest on permissions array', () => {
  assert.deepEqual(
    rootManifest.permissions,
    extensionManifest.permissions,
    'permissions array must match between extension/manifest.json and root manifest.json',
  );
});

test('root manifest mirrors extension manifest on icon sizes', () => {
  assert.deepEqual(
    Object.keys(rootManifest.icons || {}).sort(),
    Object.keys(extensionManifest.icons || {}).sort(),
    'icons sizes must match between extension/manifest.json and root manifest.json',
  );
  assert.deepEqual(
    Object.keys(rootManifest.action?.default_icon || {}).sort(),
    Object.keys(extensionManifest.action?.default_icon || {}).sort(),
    'action.default_icon sizes must match between extension/manifest.json and root manifest.json',
  );
});

test('root manifest paths prefix extension manifest paths with "extension/"', () => {
  const pathPairs = [
    {
      label: 'chrome_url_overrides.newtab',
      ext: extensionManifest.chrome_url_overrides?.newtab,
      root: rootManifest.chrome_url_overrides?.newtab,
    },
    {
      label: 'background.service_worker',
      ext: extensionManifest.background?.service_worker,
      root: rootManifest.background?.service_worker,
    },
    {
      label: 'action.default_popup',
      ext: extensionManifest.action?.default_popup,
      root: rootManifest.action?.default_popup,
    },
  ];

  for (const size of Object.keys(extensionManifest.icons || {})) {
    pathPairs.push({
      label: `icons.${size}`,
      ext: extensionManifest.icons[size],
      root: rootManifest.icons?.[size],
    });
  }

  for (const size of Object.keys(extensionManifest.action?.default_icon || {})) {
    pathPairs.push({
      label: `action.default_icon.${size}`,
      ext: extensionManifest.action.default_icon[size],
      root: rootManifest.action?.default_icon?.[size],
    });
  }

  for (const { label, ext, root } of pathPairs) {
    assert.equal(typeof ext, 'string', `${label} missing in extension manifest`);
    assert.equal(typeof root, 'string', `${label} missing in root manifest`);
    assert.equal(
      root,
      `${PATH_PREFIX}${ext}`,
      `root manifest ${label} must equal "${PATH_PREFIX}${ext}" to stay in sync with extension manifest`,
    );
  }
});
