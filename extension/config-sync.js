'use strict';

(function attachTabHarborConfigSync(globalScope) {
  const {
    normalizeQuickShortcuts: apiNormalizeQuickShortcuts,
  } = globalScope.TabOutThemeControls || {};

  const {
    normalizeSavedTabSessions: apiNormalizeSavedTabSessions,
  } = globalScope.TabHarborTabSessions || {};

  const CONFIG_VERSION = 1;
  const STORAGE_KEYS = [
    'themePreferences',
    'quickShortcuts',
    'savedTabSessions',
    'languagePreference',
    'todos',
    'sessionGroups',
    'groupOrder',
    'groupTabOrder',
    'groupLabelOverrides',
    'savedTabSessionOrder',
    'savedTabSessionCollapsedState',
    'chromeTabGroupsEnabled',
    'importedChromeSessionGroups',
    'deferredTriggerPosition',
    'popupView',
  ];

  const STORAGE_DEFAULTS = {
    themePreferences: null,
    quickShortcuts: [],
    savedTabSessions: [],
    languagePreference: 'auto',
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
    popupView: 'shortcuts',
  };

  function isValidConfigObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  async function exportConfig() {
    const data = await chrome.storage.local.get(STORAGE_KEYS);
    const config = {
      version: CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
    };
    for (const key of STORAGE_KEYS) {
      // chrome.storage.local.get(keys[]) resolves every requested key — unset
      // keys come back as undefined, not absent. Serialize those as explicit
      // null so importConfig can reset them to defaults on the target device
      // (a missing key would be skipped by the importer instead).
      const value = data[key];
      config[key] = value === undefined ? null : value;
    }
    return JSON.stringify(config, null, 2);
  }

  function getDefaultValue(key) {
    const value = STORAGE_DEFAULTS[key];
    if (Array.isArray(value)) return [];
    if (value && typeof value === 'object') return structuredClone(value);
    return value;
  }

  function isValidImportValue(key, value) {
    if (value === null || value === undefined) return true;
    if (key === 'quickShortcuts' || key === 'savedTabSessions' || key === 'todos' || key === 'savedTabSessionOrder') {
      return Array.isArray(value);
    }
    if (key === 'languagePreference') return typeof value === 'string';
    if (key === 'popupView') return typeof value === 'string';
    if (key === 'chromeTabGroupsEnabled') return typeof value === 'boolean';
    return isValidConfigObject(value);
  }

  function validateImportData(parsed) {
    if (!isValidConfigObject(parsed)) {
      throw new Error('Invalid config: root must be an object');
    }
    const version = parsed.version == null ? CONFIG_VERSION : parsed.version;
    if (version !== CONFIG_VERSION) {
      throw new Error(`Invalid config: unsupported config version ${version}`);
    }
    const hasKey = STORAGE_KEYS.some(key => key in parsed);
    if (!hasKey) {
      throw new Error('Invalid config: missing recognized data keys');
    }
    for (const key of STORAGE_KEYS) {
      if (key in parsed && !isValidImportValue(key, parsed[key])) {
        const arrayKeys = ['quickShortcuts', 'savedTabSessions', 'todos', 'savedTabSessionOrder'];
        const message = arrayKeys.includes(key)
          ? `${key} must be an array`
          : `${key} has an invalid value`;
        throw new Error(`Invalid config: ${message}`);
      }
    }
  }

  function normalizeImportValue(key, value) {
    if (value === null || value === undefined) return getDefaultValue(key);
    if (key === 'quickShortcuts') {
      return apiNormalizeQuickShortcuts ? apiNormalizeQuickShortcuts(value) : value;
    }
    if (key === 'savedTabSessions') {
      return apiNormalizeSavedTabSessions ? apiNormalizeSavedTabSessions(value) : value;
    }
    return value;
  }

  async function importConfig(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      throw new Error('Invalid file: not valid JSON');
    }

    validateImportData(parsed);

    const storagePayload = {};
    for (const key of STORAGE_KEYS) {
      if (key in parsed) storagePayload[key] = normalizeImportValue(key, parsed[key]);
    }

    if (Object.keys(storagePayload).length === 0) {
      throw new Error('Invalid config: no valid data to import');
    }

    await chrome.storage.local.set(storagePayload);
    // chromeTabGroupsMeta was a session-local Chrome id cache accidentally
    // exported by older builds. Never import it across devices; removing it
    // also prevents an old config from being mistaken for durable ownership.
    try {
      await chrome.storage.local.remove?.('chromeTabGroupsMeta');
    } catch {}

    return { importedKeys: Object.keys(storagePayload) };
  }

  const api = {
    CONFIG_VERSION,
    STORAGE_KEYS,
    exportConfig,
    importConfig,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabHarborConfigSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
