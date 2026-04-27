'use strict';

(function attachChromeTabGroups(globalScope) {

  const STORAGE_KEY = 'chromeTabGroupsEnabled';

  let cachedEnabled = false;
  let chromeGroupMap = {};
  let importMode = false;

  const GROUP_COLORS = ['grey', 'red', 'green', 'pink', 'purple', 'cyan', 'orange'];

  function getGroupTitle(group) {
    if (group.domain === '__landing-pages__') return 'Homepages';
    if (group.label) return group.label;
    try {
      const hostname = group.domain.replace(/^__session_group__:/, '');
      return friendlyDomain(hostname);
    } catch {
      return group.domain;
    }
  }

  function assignGroupColor(groupKey, index) {
    if (groupKey.startsWith('__session_group__:')) return 'blue';
    if (groupKey === '__landing-pages__') return 'yellow';
    return GROUP_COLORS[index % GROUP_COLORS.length];
  }

  async function loadChromeTabGroupsSetting() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      cachedEnabled = Boolean(stored[STORAGE_KEY]);
    } catch {
      cachedEnabled = false;
    }
    return cachedEnabled;
  }

  async function saveChromeTabGroupsSetting(enabled) {
    cachedEnabled = Boolean(enabled);
    await chrome.storage.local.set({ [STORAGE_KEY]: cachedEnabled });
    return cachedEnabled;
  }

  function isChromeApiAvailable() {
    return typeof chrome !== 'undefined' &&
      chrome.tabs && typeof chrome.tabs.group === 'function' &&
      chrome.tabGroups && typeof chrome.tabGroups.update === 'function';
  }

  async function ungroupTabs(tabIds) {
    if (!tabIds || tabIds.length === 0) return;
    try {
      await chrome.tabs.ungroup(tabIds);
    } catch {
      // Tab may have been closed already
    }
  }

  async function removeAllChromeGroups() {
    const allTrackedTabIds = [];
    for (const windowMap of Object.values(chromeGroupMap)) {
      for (const chromeGroupId of Object.values(windowMap)) {
        try {
          const group = await chrome.tabGroups.get(chromeGroupId);
          if (group) {
            const tabs = await chrome.tabs.query({ groupId: chromeGroupId });
            allTrackedTabIds.push(...tabs.map(t => t.id).filter(Boolean));
          }
        } catch {
          // Group may have been removed externally
        }
      }
    }
    if (allTrackedTabIds.length > 0) {
      await ungroupTabs(allTrackedTabIds);
    }
    chromeGroupMap = {};
  }

  async function syncChromeTabGroups(domainGroups) {
    if (!cachedEnabled) {
      await removeAllChromeGroups();
      return;
    }

    if (!isChromeApiAvailable()) return;

    // Build desired state: { groupKey: { windowId: [tabIds] } }
    const desired = {};
    for (const group of domainGroups) {
      const groupKey = group.domain;
      for (const tab of (group.tabs || [])) {
        if (tab.id == null) continue;
        const windowId = tab.windowId != null ? tab.windowId : 0;
        if (!desired[groupKey]) desired[groupKey] = {};
        if (!desired[groupKey][windowId]) desired[groupKey][windowId] = [];
        desired[groupKey][windowId].push(tab.id);
      }
    }

    // Collect current Chrome tab groups to check existence
    let currentGroups = [];
    try {
      currentGroups = await chrome.tabGroups.query({});
    } catch {}

    const validGroupIds = new Set(currentGroups.map(g => g.id));

    // Remove orphaned Chrome groups (tracked but no longer needed)
    const neededKeys = new Set(Object.keys(desired));
    for (const [groupKey, windowMap] of Object.entries(chromeGroupMap)) {
      if (!neededKeys.has(groupKey)) {
        for (const chromeGroupId of Object.values(windowMap)) {
          if (validGroupIds.has(chromeGroupId)) {
            try {
              const tabs = await chrome.tabs.query({ groupId: chromeGroupId });
              await ungroupTabs(tabs.map(t => t.id).filter(Boolean));
            } catch {}
          }
        }
        delete chromeGroupMap[groupKey];
      }
    }

    // Process each virtual group
    let colorIndex = 0;
    for (const [groupKey, windowMap] of Object.entries(desired)) {
      const groupColor = assignGroupColor(groupKey, colorIndex);
      const group = domainGroups.find(g => g.domain === groupKey);
      const title = group ? getGroupTitle(group) : groupKey;
      if (!groupKey.startsWith('__session_group__:')) {
        colorIndex++;
      }

      for (const [windowIdStr, tabIds] of Object.entries(windowMap)) {
        if (tabIds.length === 0) continue;

        const windowId = Number(windowIdStr);
        let chromeGroupId = chromeGroupMap[groupKey]?.[windowId];

        // Reuse existing Chrome group if still valid
        if (chromeGroupId != null && !validGroupIds.has(chromeGroupId)) {
          chromeGroupId = null;
        }

        if (chromeGroupId == null) {
          // In import mode, only reuse existing groups — don't create new ones
          if (importMode) continue;

          // Create new group
          try {
            chromeGroupId = await chrome.tabs.group({ tabIds });
          } catch {
            // Some tabs may have valid IDs but fail grouping; try one by one
            for (const tabId of tabIds) {
              try {
                const gid = await chrome.tabs.group({ tabIds: tabId });
                if (chromeGroupId == null) chromeGroupId = gid;
              } catch {}
            }
          }

          if (chromeGroupId != null) {
            try {
              await chrome.tabGroups.update(chromeGroupId, { title, color: groupColor });
            } catch {}
          }
        } else {
          // Move tabs into existing group
          try {
            await chrome.tabs.group({ groupId: chromeGroupId, tabIds });
          } catch {}
        }

        // Track the mapping
        if (chromeGroupId != null) {
          if (!chromeGroupMap[groupKey]) chromeGroupMap[groupKey] = {};
          chromeGroupMap[groupKey][windowId] = chromeGroupId;
        }
      }
    }
  }

  function resetChromeGroupState() {
    chromeGroupMap = {};
    cachedEnabled = false;
  }

  function isChromeTabGroupsEnabled() {
    return cachedEnabled;
  }

  function getChromeGroupCount() {
    return Object.keys(chromeGroupMap).length;
  }

  function populateChromeGroupMap(mappings) {
    for (const { virtualGroupKey, windowId, chromeGroupId } of mappings) {
      if (!chromeGroupMap[virtualGroupKey]) chromeGroupMap[virtualGroupKey] = {};
      chromeGroupMap[virtualGroupKey][windowId] = chromeGroupId;
    }
  }

  async function queryExistingChromeGroups() {
    try {
      return await chrome.tabGroups.query({});
    } catch {
      return [];
    }
  }

  function setImportMode(enabled) {
    importMode = Boolean(enabled);
  }

  function isImportMode() {
    return importMode;
  }

  const api = {
    loadChromeTabGroupsSetting,
    saveChromeTabGroupsSetting,
    syncChromeTabGroups,
    resetChromeGroupState,
    isChromeTabGroupsEnabled,
    getChromeGroupCount,
    populateChromeGroupMap,
    queryExistingChromeGroups,
    setImportMode,
    isImportMode,
    STORAGE_KEY,
    assignGroupColor,
    getGroupTitle,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabOutChromeTabGroups = api;

})(typeof globalThis !== 'undefined' ? globalThis : window);
