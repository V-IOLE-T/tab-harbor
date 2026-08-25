'use strict';

(function attachChromeTabGroups(globalScope) {

  const STORAGE_KEY = 'chromeTabGroupsEnabled';
  const COORDINATOR_ACTIONS = Object.freeze({
    sync: 'sync-chrome-tab-groups',
    merge: 'merge-chrome-tab-groups',
    getState: 'get-chrome-tab-group-state',
  });

  let cachedEnabled = false;
  let chromeGroupMap = {};
  let lastCoordinatorState = null;
  let importMode = false;
  let chromeEventMuteUntil = 0;
  let chromeListenersAttached = false;
  let chromeGroupsLastError = '';
  const chromeGroupSubscribers = new Set();

  const GROUP_COLORS = ['grey', 'red', 'green', 'pink', 'purple', 'cyan', 'orange'];

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function applyCoordinatorState(state) {
    if (!isRecord(state)) return false;
    const sessionMap = isRecord(state.sessionMap)
      ? state.sessionMap
      : (isRecord(state.mapping) ? state.mapping : null);
    if (!sessionMap) return false;

    const nextMap = {};
    const seenBindings = new Set();
    for (const [groupKey, windowMap] of Object.entries(sessionMap)) {
      if (!groupKey || !isRecord(windowMap)) return false;
      for (const [windowId, entry] of Object.entries(windowMap)) {
        if (!/^\d+$/.test(windowId) || !isRecord(entry) ||
            !Number.isInteger(entry.groupId) || entry.groupId < 0 ||
            (entry.origin !== 'created' && entry.origin !== 'adopted')) return false;
        const bindingKey = `${windowId}:${entry.groupId}`;
        if (seenBindings.has(bindingKey)) return false;
        seenBindings.add(bindingKey);
        if (!nextMap[groupKey]) nextMap[groupKey] = {};
        nextMap[groupKey][windowId] = entry.groupId;
      }
    }
    chromeGroupMap = nextMap;
    lastCoordinatorState = state;
    return true;
  }

  function getCoordinatorErrorMessage(response, fallback) {
    return response?.error?.message || fallback;
  }

  async function sendCoordinatorRequest(kind, payload = {}) {
    const messageAction = COORDINATOR_ACTIONS[kind];
    if (!messageAction || typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') {
      chromeGroupsLastError = 'Chrome tab-group coordinator unavailable';
      return {
        ok: false,
        action: kind === 'getState' ? 'get-state' : kind,
        error: { code: 'COORDINATOR_UNAVAILABLE', message: chromeGroupsLastError },
      };
    }
    try {
      const response = await chrome.runtime.sendMessage({
        action: messageAction,
        source: 'dashboard',
        payload,
      });
      if (!isRecord(response) || typeof response.ok !== 'boolean') {
        throw new Error('Chrome tab-group coordinator returned an invalid response');
      }
      if (response.state && !applyCoordinatorState(response.state)) {
        throw new Error('Chrome tab-group coordinator returned invalid ownership state');
      }
      if (response.ok) {
        chromeGroupsLastError = '';
      } else {
        chromeGroupsLastError = getCoordinatorErrorMessage(response, 'Chrome tab-group request failed');
      }
      return response;
    } catch (error) {
      chromeGroupsLastError = error?.message || String(error || 'Chrome tab-group request failed');
      return {
        ok: false,
        action: kind === 'getState' ? 'get-state' : kind,
        error: { code: 'MESSAGE_FAILED', message: chromeGroupsLastError },
      };
    }
  }

  async function loadChromeTabGroupState(windowId) {
    const payload = Number.isInteger(Number(windowId)) && Number(windowId) >= 0
      ? { windowId: Number(windowId) }
      : {};
    const response = await sendCoordinatorRequest('getState', payload);
    return response.ok ? response.state : null;
  }

  function muteChromeGroupEvents(durationMs = 250) {
    chromeEventMuteUntil = Math.max(chromeEventMuteUntil, Date.now() + durationMs);
  }

  function shouldIgnoreChromeEvent() {
    // Only the short echo-mute window suppresses notifications. Whether the
    // sync PUSH is enabled is a separate concern — live card recognition
    // listens to Chrome group events even when the push toggle is off.
    return Date.now() < chromeEventMuteUntil;
  }

  function notifyChromeGroupSubscribers(event, { force = false } = {}) {
    if (!force && shouldIgnoreChromeEvent()) return;
    for (const subscriber of chromeGroupSubscribers) {
      try {
        subscriber(event);
      } catch {}
    }
  }

  function attachChromeListeners() {
    if (chromeListenersAttached || typeof chrome === 'undefined') return;

    const eventBindings = [
      [chrome.tabGroups?.onCreated, group => notifyChromeGroupSubscribers({ source: 'tabGroups.onCreated', group })],
      [chrome.tabGroups?.onUpdated, (group) => {
        // Chrome passes the full updated TabGroup object (there is no separate
        // changeInfo parameter). Collapse-only updates also arrive here; the
        // dashboard side debounces the re-render, so a full notify is safe.
        notifyChromeGroupSubscribers({ source: 'tabGroups.onUpdated', group });
      }],
      [chrome.tabGroups?.onRemoved, group => notifyChromeGroupSubscribers({ source: 'tabGroups.onRemoved', group })],
      [chrome.tabs?.onAttached, (tabId, attachInfo) => notifyChromeGroupSubscribers({ source: 'tabs.onAttached', tabId, attachInfo })],
      [chrome.tabs?.onCreated, tab => notifyChromeGroupSubscribers({ source: 'tabs.onCreated', tab })],
      [chrome.tabs?.onDetached, (tabId, detachInfo) => notifyChromeGroupSubscribers({ source: 'tabs.onDetached', tabId, detachInfo })],
      [chrome.tabs?.onMoved, async (tabId, moveInfo) => {
        try {
          const movedTab = await chrome.tabs.get(tabId);
          if (movedTab?.groupId == null || Number(movedTab.groupId) < 0) return;
          notifyChromeGroupSubscribers({ source: 'tabs.onMoved', tabId, moveInfo, tab: movedTab });
        } catch {}
      }],
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

    if (chrome.storage?.onChanged && typeof chrome.storage.onChanged.addListener === 'function') {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        const settingChange = areaName === 'local' ? changes?.[STORAGE_KEY] : null;
        if (!settingChange) return;
        cachedEnabled = settingChange.newValue === true;
        notifyChromeGroupSubscribers({
          source: 'storage.onChanged',
          enabled: cachedEnabled,
        }, { force: true });
      });
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

  // Session groups and the landing-pages card keep dedicated colors (blue /
  // yellow); regular domain mirrors cycle through the shared palette. Keep the
  // palette order stable so managed groups do not change color between syncs.
  function assignGroupColor(groupKey, index) {
    if (groupKey.startsWith('__session_group__:')) return 'blue';
    if (groupKey === '__landing-pages__') return 'yellow';
    return GROUP_COLORS[index % GROUP_COLORS.length];
  }

  /**
   * currentMappingCandidates(groupKey, windowIdKey, matches)
   *
   * Returns the in-session mappings that are still among the ambiguous
   * candidates (each as { windowId, id }). A concrete window key restricts the
   * lookup to that window; the compatibility `any` key considers every current
   * session mapping for the logical group.
   */
  function currentMappingCandidates(groupKey, windowIdKey, matches) {
    const windowMap = chromeGroupMap?.[groupKey];
    if (!windowMap) return [];
    if (windowIdKey !== 'any') {
      const currentId = windowMap[windowIdKey];
      const match = currentId != null ? matches.find(g => Number(g.id) === Number(currentId)) : null;
      return match ? [{ windowId: match.windowId, id: match.id }] : [];
    }
    const kept = [];
    for (const [windowIdStr, chromeGroupId] of Object.entries(windowMap)) {
      if (chromeGroupId != null && matches.some(g => Number(g.id) === Number(chromeGroupId))) {
        kept.push({ windowId: windowIdStr, id: chromeGroupId });
      }
    }
    return kept;
  }

  /**
   * isGroupIdentityFree(title, color, windowId, currentGroups)
   *
   * A mirror's identity is its window + title + color fingerprint. Returns
   * true when no group in the given window already carries that fingerprint.
   * Retained as a pure compatibility helper for older dashboard call sites.
   */
  function isGroupIdentityFree(title, color, windowId, currentGroups) {
    if (!Array.isArray(currentGroups)) return true;
    return !currentGroups.some(g =>
      Number(g.windowId) === Number(windowId) &&
      g.title === title &&
      g.color === color
    );
  }

  /**
   * pickUncollidingGroupColor(title, preferred, windowId, currentGroups)
   *
   * Returns the first palette color that keeps the mirror's fingerprint
   * unique in the window; falls back to the preferred color when every
   * palette color collides (extreme case).
   */
  function pickUncollidingGroupColor(title, preferred, windowId, currentGroups) {
    if (!Array.isArray(currentGroups)) return preferred;
    for (const color of GROUP_COLORS) {
      if (isGroupIdentityFree(title, color, windowId, currentGroups)) return color;
    }
    return preferred;
  }

  async function loadChromeTabGroupsSetting() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      cachedEnabled = Boolean(stored[STORAGE_KEY]);
    } catch {
      cachedEnabled = false;
    }
    await loadChromeTabGroupState();
    return cachedEnabled;
  }

  async function saveChromeTabGroupsSetting(enabled) {
    cachedEnabled = Boolean(enabled);
    await chrome.storage.local.set({ [STORAGE_KEY]: cachedEnabled });
    return cachedEnabled;
  }

  // Kept as compatibility aliases for dashboard code that predates the
  // service-worker coordinator. Session ownership is now loaded from
  // storage.session through the coordinator; the page never persists IDs or
  // title/color fingerprints itself.
  async function persistChromeGroupMap() {
    return lastCoordinatorState;
  }

  async function loadPersistedChromeGroupMap() {
    return loadChromeTabGroupState();
  }

  function isChromeApiAvailable() {
    const available = typeof chrome !== 'undefined' &&
      chrome.tabs && typeof chrome.tabs.query === 'function' &&
      chrome.tabGroups && typeof chrome.tabGroups.query === 'function';
    if (!available) chromeGroupsLastError = 'Chrome tab-group query API unavailable';
    return available;
  }

  function getChromeGroupsLastError() {
    return chromeGroupsLastError;
  }

  async function reorderGroupedTabs(chromeGroupId, desiredTabIds, windowId) {
    const targetGroupId = Number(chromeGroupId);
    const targetWindowId = Number(windowId);
    if (!Number.isInteger(targetGroupId) || targetGroupId < 0 ||
        !Number.isInteger(targetWindowId) || targetWindowId < 0 ||
        !Array.isArray(desiredTabIds) || desiredTabIds.length === 0) return null;

    // Keep page scripts read-only with respect to native group membership and
    // order. The coordinator re-reads the live group, filters the requested
    // order to current members, then performs the moves inside its global
    // serial queue.
    const desiredIds = desiredTabIds
      .map(id => Number(id))
      .filter(Number.isInteger);
    if (desiredIds.length === 0) return null;

    muteChromeGroupEvents();
    const response = await sendCoordinatorRequest('merge', {
      operation: 'reorder',
      windowId: targetWindowId,
      targetGroupId,
      tabIds: desiredIds,
    });
    if (!response.ok) {
      throw new Error(getCoordinatorErrorMessage(response, 'Could not reorder Chrome tab group'));
    }
    return response;
  }

  function getManagedChromeGroupIds() {
    const ids = new Set();
    for (const windowMap of Object.values(chromeGroupMap)) {
      for (const chromeGroupId of Object.values(windowMap)) {
        if (chromeGroupId != null) ids.add(chromeGroupId);
      }
    }
    return ids;
  }

  /**
   * queryUserChromeGroups(windowId)
   *
   * Returns the native Chrome tab groups of the given window that the DASHBOARD
   * does not manage (i.e. groups the user created in the browser, not the
   * mirror groups this extension pushed). Each entry carries the group's live
   * title/color, its tab ids and its strip position (min tab index) so the
   * dashboard can render one card per group, ordered like the tab strip.
   */
  async function queryUserChromeGroups(windowId) {
    if (!isChromeApiAvailable()) return [];
    let hadPartialFailure = false;
    try {
      // Let the API filter by window (windowId is always a real window id from
      // getDashboardWindowIdForOpenTabs); fall back to an unfiltered query only
      // for a defensive non-finite id.
      const groups = Number.isFinite(Number(windowId))
        ? await chrome.tabGroups.query({ windowId: Number(windowId) })
        : await chrome.tabGroups.query({});
      const managed = getManagedChromeGroupIds();
      const result = [];
      for (const group of groups) {
        if (managed.has(group.id)) continue;
        let tabs = [];
        try {
          tabs = await chrome.tabs.query({ groupId: group.id });
        } catch (err) {
          // C6: a single group's tab query failing must not be silently
          // treated as "this group is empty"; keep the diagnostic so the
          // dashboard can distinguish API failure from genuinely no groups.
          hadPartialFailure = true;
          chromeGroupsLastError = err?.message || String(err || 'queryUserChromeGroups tabs.query failed');
          console.warn(`[tab-harbor] queryUserChromeGroups: tabs.query failed for group ${group.id}:`, err);
          continue;
        }
        if (!tabs.length) continue;
        const positions = tabs.map(t => t.index).filter(Number.isFinite);
        result.push({
          id: group.id,
          windowId: Number(group.windowId),
          title: group.title || '',
          color: group.color || 'grey',
          collapsed: Boolean(group.collapsed),
          minIndex: positions.length ? Math.min(...positions) : Number.MAX_SAFE_INTEGER,
          tabIds: tabs.map(t => t.id).filter(id => id != null),
        });
      }
      if (!hadPartialFailure) chromeGroupsLastError = '';
      return result.sort((a, b) => a.minIndex - b.minIndex);
    } catch (err) {
      // Never silently pretend there are no user groups: keep a diagnostic and
      // let the dashboard surface a visible failure state.
      chromeGroupsLastError = err?.message || String(err || 'queryUserChromeGroups failed');
      console.warn('[tab-harbor] queryUserChromeGroups failed:', err);
      return [];
    }
  }

  function getMappedWindowIds() {
    const ids = new Set();
    for (const windowMap of Object.values(chromeGroupMap)) {
      for (const windowId of Object.keys(windowMap || {})) {
        const id = Number(windowId);
        if (Number.isInteger(id) && id >= 0) ids.add(id);
      }
    }
    return ids;
  }

  function buildChromeSyncPayloads(domainGroups = []) {
    const groups = Array.isArray(domainGroups) ? domainGroups : [];
    const managedGroupIds = getManagedChromeGroupIds();
    const desiredByWindow = new Map();
    const windowIds = getMappedWindowIds();
    let colorIndex = 0;

    for (const group of groups) {
      const groupKey = String(group?.domain || '');
      for (const tab of (Array.isArray(group?.tabs) ? group.tabs : [])) {
        const windowId = Number(tab?.windowId);
        if (Number.isInteger(windowId) && windowId >= 0) windowIds.add(windowId);
      }
      if (!groupKey || group?.isManual || group?.isChromeGroup) continue;
      if (groupKey.startsWith('__session_group__:') || groupKey.startsWith('__chrome_group__:')) continue;

      const color = assignGroupColor(groupKey, colorIndex);
      colorIndex += 1;
      const title = getGroupTitle(group);
      for (const tab of (Array.isArray(group.tabs) ? group.tabs : [])) {
        const tabId = Number(tab?.id);
        const windowId = Number(tab?.windowId);
        if (!Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(windowId) || windowId < 0) continue;
        if (Number.isInteger(tab.groupId) && tab.groupId >= 0 && !managedGroupIds.has(tab.groupId)) continue;
        if (importMode && chromeGroupMap?.[groupKey]?.[String(windowId)] == null) continue;
        if (!desiredByWindow.has(windowId)) desiredByWindow.set(windowId, new Map());
        const windowGroups = desiredByWindow.get(windowId);
        if (!windowGroups.has(groupKey)) {
          windowGroups.set(groupKey, {
            groupKey,
            title,
            color,
            collapsed: true,
            tabIds: [],
          });
        }
        const desiredGroup = windowGroups.get(groupKey);
        if (!desiredGroup.tabIds.includes(tabId)) desiredGroup.tabIds.push(tabId);
      }
    }

    return [...windowIds]
      .sort((left, right) => left - right)
      .map(windowId => ({
        windowId,
        enabled: cachedEnabled,
        groups: cachedEnabled ? [...(desiredByWindow.get(windowId)?.values() || [])] : [],
      }));
  }

  function combineSyncResponses(responses) {
    if (responses.length === 1) return responses[0];
    const failures = responses.filter(response => !response?.ok);
    const latestState = [...responses].reverse().find(response => response?.state)?.state;
    return {
      ok: failures.length === 0,
      action: 'sync',
      enabled: cachedEnabled,
      windows: responses,
      conflicts: responses.flatMap(response => response?.conflicts || []),
      ...(latestState ? { state: latestState } : {}),
      ...(failures[0]?.error ? { error: failures[0].error } : {}),
    };
  }

  async function syncChromeTabGroups(domainGroups = []) {
    muteChromeGroupEvents();
    // Refreshing first gives the page an up-to-date view of session ownership;
    // all mutations still occur in the service worker's serialized queue.
    await loadChromeTabGroupState();
    const payloads = buildChromeSyncPayloads(domainGroups);
    if (payloads.length === 0) {
      return { ok: true, action: 'sync', enabled: cachedEnabled, windows: [], conflicts: [] };
    }
    const responses = [];
    for (const payload of payloads) {
      muteChromeGroupEvents();
      responses.push(await sendCoordinatorRequest('sync', payload));
    }
    return combineSyncResponses(responses);
  }

  async function resetChromeGroupState() {
    chromeGroupMap = {};
    lastCoordinatorState = null;
    cachedEnabled = false;
    importMode = false;
    chromeEventMuteUntil = 0;
  }

  function isChromeTabGroupsEnabled() {
    return cachedEnabled;
  }

  function getChromeGroupCount() {
    return Object.keys(chromeGroupMap).length;
  }

  async function populateChromeGroupMap() {
    // Historical import callers cannot claim ownership from the page. Refresh
    // the authoritative session mapping instead.
    return loadChromeTabGroupState();
  }

  async function queryExistingChromeGroups() {
    try {
      return await chrome.tabGroups.query({});
    } catch {
      return [];
    }
  }

  async function mergeChromeTabGroups(payload = {}) {
    muteChromeGroupEvents();
    return sendCoordinatorRequest('merge', payload);
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
    loadChromeTabGroupState,
    syncChromeTabGroups,
    mergeChromeTabGroups,
    resetChromeGroupState,
    isChromeTabGroupsEnabled,
    getChromeGroupCount,
    getManagedChromeGroupIds,
    queryUserChromeGroups,
    getChromeGroupsLastError,
    reorderGroupedTabs,
    muteChromeGroupEvents,
    populateChromeGroupMap,
    queryExistingChromeGroups,
    setImportMode,
    isImportMode,
    subscribeToChromeTabGroupChanges,
    loadPersistedChromeGroupMap,
    persistChromeGroupMap,
    STORAGE_KEY,
    assignGroupColor,
    getGroupTitle,
    isGroupIdentityFree,
    pickUncollidingGroupColor,
    currentMappingCandidates,
    applyCoordinatorState,
    buildChromeSyncPayloads,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabOutChromeTabGroups = api;

})(typeof globalThis !== 'undefined' ? globalThis : window);
