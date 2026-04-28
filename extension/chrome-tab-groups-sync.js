'use strict';

(function attachChromeTabGroups(globalScope) {

  const STORAGE_KEY = 'chromeTabGroupsEnabled';
  const META_PERSIST_KEY = 'chromeTabGroupsMeta';

  let cachedEnabled = false;
  let chromeGroupMap = {};
  let importMode = false;
  let chromeEventMuteUntil = 0;
  let chromeListenersAttached = false;
  const chromeGroupSubscribers = new Set();

  const GROUP_COLORS = ['grey', 'red', 'green', 'pink', 'purple', 'cyan', 'orange'];

  function muteChromeGroupEvents(durationMs = 250) {
    chromeEventMuteUntil = Math.max(chromeEventMuteUntil, Date.now() + durationMs);
  }

  function shouldIgnoreChromeEvent() {
    return !cachedEnabled || Date.now() < chromeEventMuteUntil;
  }

  function notifyChromeGroupSubscribers(event) {
    if (shouldIgnoreChromeEvent()) return;
    for (const subscriber of chromeGroupSubscribers) {
      try {
        subscriber(event);
      } catch {}
    }
  }

  function shouldNotifyChromeGroupUpdate(changeInfo) {
    if (!changeInfo || typeof changeInfo !== 'object') return false;
    const changedKeys = Object.keys(changeInfo);
    if (changedKeys.length === 0) return false;
    return changedKeys.some(key => key !== 'collapsed');
  }

  function attachChromeListeners() {
    if (chromeListenersAttached || typeof chrome === 'undefined') return;

    const eventBindings = [
      [chrome.tabGroups?.onCreated, group => notifyChromeGroupSubscribers({ source: 'tabGroups.onCreated', group })],
      [chrome.tabGroups?.onUpdated, (groupId, changeInfo) => {
        // Collapsing or expanding a group should not trigger a full import cycle.
        if (!shouldNotifyChromeGroupUpdate(changeInfo)) return;
        notifyChromeGroupSubscribers({ source: 'tabGroups.onUpdated', groupId, changeInfo });
      }],
      [chrome.tabGroups?.onRemoved, group => notifyChromeGroupSubscribers({ source: 'tabGroups.onRemoved', group })],
      [chrome.tabs?.onAttached, (tabId, attachInfo) => notifyChromeGroupSubscribers({ source: 'tabs.onAttached', tabId, attachInfo })],
      [chrome.tabs?.onCreated, tab => notifyChromeGroupSubscribers({ source: 'tabs.onCreated', tab })],
      [chrome.tabs?.onDetached, (tabId, detachInfo) => notifyChromeGroupSubscribers({ source: 'tabs.onDetached', tabId, detachInfo })],
      [chrome.tabs?.onRemoved, (tabId, removeInfo) => notifyChromeGroupSubscribers({ source: 'tabs.onRemoved', tabId, removeInfo })],
      [chrome.tabs?.onUpdated, (tabId, changeInfo, tab) => {
        if (changeInfo?.groupId == null) return;
        notifyChromeGroupSubscribers({ source: 'tabs.onUpdated', tabId, changeInfo, tab });
      }],
    ];

    for (const [eventSource, listener] of eventBindings) {
      if (eventSource && typeof eventSource.addListener === 'function') {
        eventSource.addListener(listener);
      }
    }

    chromeListenersAttached = true;
  }

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
    await loadPersistedChromeGroupMap();
    return cachedEnabled;
  }

  async function saveChromeTabGroupsSetting(enabled) {
    cachedEnabled = Boolean(enabled);
    await chrome.storage.local.set({ [STORAGE_KEY]: cachedEnabled });
    return cachedEnabled;
  }

  async function persistChromeGroupMap() {
    try {
      // Save group metadata (title, color) instead of raw groupIds,
      // since Chrome tab group IDs are only stable within a session.
      const meta = {};
      for (const [groupKey, windowMap] of Object.entries(chromeGroupMap)) {
        for (const chromeGroupId of Object.values(windowMap)) {
          try {
            const group = await chrome.tabGroups.get(chromeGroupId);
            if (group && !meta[groupKey]) {
              meta[groupKey] = { title: group.title, color: group.color };
            }
          } catch {}
        }
      }
      await chrome.storage.local.set({ [META_PERSIST_KEY]: meta });
    } catch {}
  }

  async function loadPersistedChromeGroupMap() {
    try {
      const result = await chrome.storage.local.get(META_PERSIST_KEY);
      const meta = result[META_PERSIST_KEY];
      if (!meta || Object.keys(meta).length === 0) return;

      const currentGroups = await chrome.tabGroups.query({});
      const reconciled = {};

      for (const [groupKey, info] of Object.entries(meta)) {
        // Match by title + color — the values we control. After restart,
        // Chrome assigns new groupIds, but our groups retain their title/color.
        const match = currentGroups.find(g =>
          g.title === info.title && g.color === info.color
        );
        if (match) {
          if (!reconciled[groupKey]) reconciled[groupKey] = {};
          reconciled[groupKey][match.windowId] = match.id;
        }
      }

      chromeGroupMap = reconciled;
    } catch {}
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
    muteChromeGroupEvents();
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
    await persistChromeGroupMap();
  }

  async function syncChromeTabGroups(domainGroups) {
    muteChromeGroupEvents();
    await loadPersistedChromeGroupMap();

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
                if (chromeGroupId == null) {
                  chromeGroupId = await chrome.tabs.group({ tabIds: tabId });
                } else {
                  await chrome.tabs.group({ groupId: chromeGroupId, tabIds: tabId });
                }
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
    await persistChromeGroupMap();
  }

  async function resetChromeGroupState() {
    chromeGroupMap = {};
    cachedEnabled = false;
    importMode = false;
    chromeEventMuteUntil = 0;
    try {
      await chrome.storage.local.remove(META_PERSIST_KEY);
    } catch {}
  }

  function isChromeTabGroupsEnabled() {
    return cachedEnabled;
  }

  function getChromeGroupCount() {
    return Object.keys(chromeGroupMap).length;
  }

  async function populateChromeGroupMap(mappings) {
    for (const { virtualGroupKey, windowId, chromeGroupId } of mappings) {
      if (!chromeGroupMap[virtualGroupKey]) chromeGroupMap[virtualGroupKey] = {};
      chromeGroupMap[virtualGroupKey][windowId] = chromeGroupId;
    }
    await persistChromeGroupMap();
  }

  async function queryExistingChromeGroups() {
    try {
      return await chrome.tabGroups.query({});
    } catch {
      return [];
    }
  }

  async function syncChromeTabGroupExpansionForTab(tab) {
    if (!cachedEnabled || !isChromeApiAvailable()) return;

    const targetGroupId = Number(tab?.groupId);
    const targetWindowId = Number(tab?.windowId);
    if (!Number.isFinite(targetGroupId) || targetGroupId < 0) return;
    if (!Number.isFinite(targetWindowId)) return;

    let groups = [];
    try {
      groups = await chrome.tabGroups.query({});
    } catch {
      return;
    }

    const groupsInWindow = groups.filter(group => Number(group?.windowId) === targetWindowId);
    muteChromeGroupEvents();

    for (const group of groupsInWindow) {
      const nextCollapsed = group.id !== targetGroupId;
      if (Boolean(group.collapsed) === nextCollapsed) continue;
      try {
        await chrome.tabGroups.update(group.id, { collapsed: nextCollapsed });
      } catch {}
    }
  }

  function setImportMode(enabled) {
    importMode = Boolean(enabled);
  }

  function isImportMode() {
    return importMode;
  }

  function subscribeToChromeTabGroupChanges(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    attachChromeListeners();
    chromeGroupSubscribers.add(listener);
    return () => {
      chromeGroupSubscribers.delete(listener);
    };
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
    syncChromeTabGroupExpansionForTab,
    setImportMode,
    isImportMode,
    subscribeToChromeTabGroupChanges,
    STORAGE_KEY,
    assignGroupColor,
    getGroupTitle,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabOutChromeTabGroups = api;

})(typeof globalThis !== 'undefined' ? globalThis : window);
