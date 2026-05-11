/* ================================================================
   Tab Harbor — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';

const {
  getLanguagePreference: runtimeGetLanguagePreference,
  setLanguagePreference: runtimeSetLanguagePreference,
  t: runtimeT,
} = globalThis.TabHarborI18n || {};

const {
  escapeHtml: runtimeEscapeHtml,
  escapeHtmlAttribute: runtimeEscapeHtmlAttribute,
  getFallbackLabel: runtimeGetFallbackLabel,
  getGroupIcon: runtimeGetGroupIcon,
  getIconSources: runtimeGetIconSources,
} = globalThis.TabOutIconUtils || {};

const {
  addSessionGroup,
  assignTabToSessionGroup,
  clearTabSessionGroup,
  normalizeSessionGroups,
  pruneSessionGroups,
} = globalThis.TabOutSessionGroups || {};

const {
  applyGroupOrder,
  createReorderedKeys,
  normalizeGroupOrderState,
  setPinEnabled,
} = globalThis.TabOutGroupOrder || {};

const {
  clampTriggerTop: runtimeClampTriggerTop,
} = globalThis.TabOutDeferredTriggerPosition || {};

const {
  loadChromeTabGroupsSetting,
  saveChromeTabGroupsSetting,
  syncChromeTabGroups,
  collapseChromeTabGroupsInWindow,
  syncChromeTabGroupExpansionForTab,
  isChromeTabGroupsEnabled,
  populateChromeGroupMap,
  queryExistingChromeGroups,
  setImportMode,
  subscribeToChromeTabGroupChanges,
} = globalThis.TabOutChromeTabGroups || {};

const {
  setImageFallbackAttributes: runtimeSetImageFallbackAttributes,
} = globalThis;

function fallbackNormalizeChromeImportedGroupMeta(input) {
  const entries = Array.isArray(input?.entries)
    ? input.entries
      .filter(entry => entry && entry.sessionGroupId)
      .map(entry => ({
        sessionGroupId: String(entry.sessionGroupId),
        chromeGroupId: entry.chromeGroupId == null ? null : Number(entry.chromeGroupId),
        windowId: entry.windowId == null ? 0 : Number(entry.windowId),
        title: String(entry.title || 'Group').trim() || 'Group',
        color: String(entry.color || 'grey'),
      }))
    : [];

  return { entries };
}

function fallbackBuildChromeImportSignature(entry) {
  return [
    String(entry.windowId ?? 0),
    String(entry.title || 'Group').trim() || 'Group',
    String(entry.color || 'grey'),
  ].join('::');
}

function fallbackBuildChromeImportName(baseName, groups, excludeGroupId = '') {
  const fallbackName = String(baseName || 'Group').trim() || 'Group';
  const takenNames = new Set(
    (groups || [])
      .filter(group => group && group.id !== excludeGroupId)
      .map(group => String(group.name || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (!takenNames.has(fallbackName.toLowerCase())) return fallbackName;

  let suffix = 2;
  while (takenNames.has(`${fallbackName.toLowerCase()} ${suffix}`)) suffix++;
  return `${fallbackName} ${suffix}`;
}

function fallbackReconcileChromeTabGroupImports({
  currentState,
  importedMeta,
  nativeGroups,
}) {
  const normalizedState = normalizeSessionGroups(currentState);
  const normalizedMeta = fallbackNormalizeChromeImportedGroupMeta(importedMeta);
  const managedIds = new Set(normalizedMeta.entries.map(entry => entry.sessionGroupId));
  const sessionGroupIds = new Set(normalizedState.groups.map(group => group.id));

  let groups = normalizedState.groups.slice();
  let assignments = {};
  for (const [tabId, groupId] of Object.entries(normalizedState.assignments)) {
    if (managedIds.has(groupId)) continue;
    assignments[tabId] = groupId;
  }

  const metaByChromeGroupId = new Map();
  const metaBySignature = new Map();
  for (const entry of normalizedMeta.entries) {
    if (!sessionGroupIds.has(entry.sessionGroupId)) continue;
    if (entry.chromeGroupId != null) metaByChromeGroupId.set(entry.chromeGroupId, entry);
    metaBySignature.set(fallbackBuildChromeImportSignature(entry), entry);
  }

  const nextMetaEntries = [];
  const mappings = [];

  for (const nativeGroup of (nativeGroups || [])) {
    const chromeGroupId = nativeGroup?.chromeGroupId == null ? null : Number(nativeGroup.chromeGroupId);
    const windowId = nativeGroup?.windowId == null ? 0 : Number(nativeGroup.windowId);
    const title = String(nativeGroup?.title || 'Group').trim() || 'Group';
    const color = String(nativeGroup?.color || 'grey');
    const tabIds = Array.isArray(nativeGroup?.tabIds)
      ? nativeGroup.tabIds.filter(tabId => tabId != null).map(tabId => String(tabId))
      : [];
    if (!tabIds.length) continue;

    const signature = fallbackBuildChromeImportSignature({ windowId, title, color });
    const existingMeta = (chromeGroupId != null && metaByChromeGroupId.get(chromeGroupId))
      || metaBySignature.get(signature)
      || null;

    let sessionGroupId = existingMeta?.sessionGroupId || '';
    let groupIndex = groups.findIndex(group => group.id === sessionGroupId);

    if (groupIndex === -1) {
      const created = addSessionGroup({ groups, assignments }, fallbackBuildChromeImportName(title, groups));
      groups = created.state.groups;
      assignments = created.state.assignments;
      sessionGroupId = created.group.id;
      groupIndex = groups.findIndex(group => group.id === sessionGroupId);
    } else {
      const nextName = fallbackBuildChromeImportName(title, groups, sessionGroupId);
      if (groups[groupIndex].name !== nextName) {
        groups = groups.map(group => group.id === sessionGroupId
          ? { ...group, name: nextName }
          : group);
      }
    }

    for (const tabId of tabIds) {
      assignments[tabId] = sessionGroupId;
    }

    if (chromeGroupId != null) {
      mappings.push({
        virtualGroupKey: `__session_group__:${sessionGroupId}`,
        windowId,
        chromeGroupId,
      });
    }

    nextMetaEntries.push({
      sessionGroupId,
      chromeGroupId,
      windowId,
      title,
      color,
    });
  }

  const activeManagedIds = new Set(nextMetaEntries.map(entry => entry.sessionGroupId));
  groups = groups.filter(group => !managedIds.has(group.id) || activeManagedIds.has(group.id));
  assignments = Object.fromEntries(
    Object.entries(assignments).filter(([, groupId]) => !managedIds.has(groupId) || activeManagedIds.has(groupId))
  );

  return {
    state: normalizeSessionGroups({ groups, assignments }),
    importedMeta: fallbackNormalizeChromeImportedGroupMeta({ entries: nextMetaEntries }),
    mappings,
  };
}

const runtimeChromeImportApi = globalThis.TabOutChromeTabGroupImport || {
  EMPTY_META: { entries: [] },
  normalizeChromeImportedGroupMeta: fallbackNormalizeChromeImportedGroupMeta,
  reconcileChromeTabGroupImports: fallbackReconcileChromeTabGroupImports,
};

const {
  EMPTY_META: runtimeEmptyChromeImportedMeta,
  normalizeChromeImportedGroupMeta,
  reconcileChromeTabGroupImports,
} = runtimeChromeImportApi;

const {
  reorderSubsetByIds,
} = globalThis.TabOutListOrder || {};

const {
  compressImageFileForStorage,
} = globalThis.TabOutBackgroundImage || {};

/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];
let sessionGroupsState = normalizeSessionGroups ? normalizeSessionGroups() : { groups: [], assignments: {} };
const SESSION_GROUPS_KEY = 'sessionGroups';
const IMPORTED_CHROME_GROUPS_KEY = 'importedChromeSessionGroups';
let groupOrderState = normalizeGroupOrderState ? normalizeGroupOrderState() : { sessionOrder: [], pinnedOrder: [], pinEnabled: false };
const GROUP_ORDER_KEY = 'groupOrder';
let groupTabOrderState = {};
const GROUP_TAB_ORDER_KEY = 'groupTabOrder';
let draggedGroupId = '';
let dragStartPoint = null;
let suppressJumpUntil = 0;
let draggedGroupButtonEl = null;
let dragPlaceholderEl = null;
let draggedDrawerItemId = '';
let draggedDrawerItemEl = null;
let drawerItemDragState = null;
let drawerItemPlaceholderEl = null;
let draggedPageChipId = '';
let draggedPageChipEl = null;
let pageChipDragState = null;
let pageChipPlaceholderEl = null;
let chromeTabGroupsEnabled = false;
let importedChromeGroupMeta = normalizeChromeImportedGroupMeta
  ? normalizeChromeImportedGroupMeta(runtimeEmptyChromeImportedMeta)
  : { entries: [] };
let chromeTabGroupsImportTimer = null;
let chromeTabGroupsUnsubscribe = null;
let chromeTabGroupsImportInFlight = false;
const CHROME_TAB_GROUPS_DEBUG_KEY = 'chromeTabGroupsDebug';

function reorderVisibleItemsByIds(items, orderIds, includeItem) {
  if (reorderSubsetByIds) {
    return reorderSubsetByIds(items, orderIds, includeItem);
  }

  if (!Array.isArray(items)) return [];
  const list = items.slice();
  const shouldInclude = typeof includeItem === 'function' ? includeItem : () => true;
  const subset = list.filter(shouldInclude);
  const normalizedOrder = Array.isArray(orderIds) ? orderIds.map(id => String(id)).filter(Boolean) : [];
  if (!subset.length || subset.length !== normalizedOrder.length) return list;

  const subsetMap = new Map(subset.map(item => [String(item.id), item]));
  if (normalizedOrder.some(id => !subsetMap.has(id))) return list;

  let nextIndex = 0;
  return list.map(item => {
    if (!shouldInclude(item)) return item;
    const nextItem = subsetMap.get(normalizedOrder[nextIndex]);
    nextIndex += 1;
    return nextItem || item;
  });
}

function normalizeGroupTabOrderState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  return Object.fromEntries(
    Object.entries(input)
      .map(([groupKey, orderIds]) => [
        String(groupKey),
        Array.isArray(orderIds)
          ? [...new Set(orderIds.map(id => String(id)).filter(Boolean))]
          : [],
      ])
      .filter(([, orderIds]) => orderIds.length > 0)
  );
}

function pruneGroupTabOrderState(state, groups = []) {
  const normalized = normalizeGroupTabOrderState(state);
  const groupMap = new Map(
    groups.map(group => [
      String(group.domain),
      new Set(
        (group.tabs || [])
          .map(tab => String(tab?.url || ''))
          .filter(Boolean)
      ),
    ])
  );

  return Object.fromEntries(
    Object.entries(normalized)
      .map(([groupKey, orderIds]) => {
        const validUrls = groupMap.get(String(groupKey));
        if (!validUrls) return null;
        const filtered = orderIds.filter(url => validUrls.has(url));
        return filtered.length > 0 ? [String(groupKey), filtered] : null;
      })
      .filter(Boolean)
  );
}

async function loadGroupTabOrder(groups = []) {
  const stored = await chrome.storage.local.get(GROUP_TAB_ORDER_KEY);
  const nextState = normalizeGroupTabOrderState(stored[GROUP_TAB_ORDER_KEY]);
  const prunedState = pruneGroupTabOrderState(nextState, groups);
  groupTabOrderState = prunedState;
  await chrome.storage.local.set({ [GROUP_TAB_ORDER_KEY]: prunedState });
  return prunedState;
}

async function saveGroupTabOrder(nextState) {
  groupTabOrderState = normalizeGroupTabOrderState(nextState);
  await chrome.storage.local.set({ [GROUP_TAB_ORDER_KEY]: groupTabOrderState });
  return groupTabOrderState;
}

function reorderGroupTabsByStoredUrls(tabs, groupKey) {
  const orderIds = groupTabOrderState[String(groupKey)] || [];
  if (!Array.isArray(tabs) || !tabs.length || !orderIds.length) return Array.isArray(tabs) ? tabs.slice() : [];

  const wrappedTabs = tabs.map(tab => ({
    id: String(tab?.url || ''),
    tab,
  }));
  const subsetUrls = new Set(orderIds);
  const reordered = reorderVisibleItemsByIds(
    wrappedTabs,
    orderIds,
    item => subsetUrls.has(item.id)
  );
  return reordered.map(item => item.tab);
}

function getOrderedUniqueTabsForGroup(group) {
  const tabs = Array.isArray(group?.tabs) ? group.tabs : [];
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    const url = String(tab?.url || '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    uniqueTabs.push(tab);
  }
  return reorderGroupTabsByStoredUrls(uniqueTabs, group?.domain);
}

function getTabsOrderedForChromeSync(group) {
  const tabs = Array.isArray(group?.tabs) ? group.tabs : [];
  const orderUrls = groupTabOrderState[String(group?.domain)] || [];
  if (!orderUrls.length) return tabs.slice();

  const orderIndex = new Map(orderUrls.map((url, index) => [String(url), index]));
  return tabs
    .map((tab, originalIndex) => ({
      tab,
      originalIndex,
      order: orderIndex.has(String(tab?.url || ''))
        ? orderIndex.get(String(tab?.url || ''))
        : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.order - b.order || a.originalIndex - b.originalIndex)
    .map(entry => entry.tab);
}

function getChromeSyncGroups(groups = domainGroups) {
  return (Array.isArray(groups) ? groups : []).map(group => ({
    ...group,
    tabs: getTabsOrderedForChromeSync(group),
  }));
}

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Harbor's own pages.
 */

/* ----------------------------------------------------------------
   Hitokoto helper
   ---------------------------------------------------------------- */

async function fetchHitokoto(timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch('https://v1.hitokoto.cn/', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response || !response.ok) return null;
    const data = await response.json();
    return data || null;
  } catch (err) {
    return null;
  }
}

async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      favIconUrl: t.favIconUrl || '',
      // Flag Tab Harbor's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

async function loadSessionGroups(openTabIds = []) {
  const stored = await chrome.storage.local.get(SESSION_GROUPS_KEY);
  const nextState = normalizeSessionGroups(stored[SESSION_GROUPS_KEY]);
  const prunedState = pruneSessionGroups(nextState, openTabIds);
  sessionGroupsState = prunedState;
  await chrome.storage.local.set({ [SESSION_GROUPS_KEY]: prunedState });
  return prunedState;
}

async function saveSessionGroups(nextState) {
  sessionGroupsState = normalizeSessionGroups(nextState);
  await chrome.storage.local.set({ [SESSION_GROUPS_KEY]: sessionGroupsState });
  return sessionGroupsState;
}

async function loadImportedChromeGroupMeta() {
  if (typeof normalizeChromeImportedGroupMeta !== 'function') {
    importedChromeGroupMeta = { entries: [] };
    return importedChromeGroupMeta;
  }
  const stored = await chrome.storage.local.get(IMPORTED_CHROME_GROUPS_KEY);
  importedChromeGroupMeta = normalizeChromeImportedGroupMeta(stored[IMPORTED_CHROME_GROUPS_KEY]);
  return importedChromeGroupMeta;
}

async function saveImportedChromeGroupMeta(nextMeta) {
  if (typeof normalizeChromeImportedGroupMeta !== 'function') {
    importedChromeGroupMeta = { entries: [] };
    return importedChromeGroupMeta;
  }
  importedChromeGroupMeta = normalizeChromeImportedGroupMeta(nextMeta);
  await chrome.storage.local.set({ [IMPORTED_CHROME_GROUPS_KEY]: importedChromeGroupMeta });
  return importedChromeGroupMeta;
}

async function saveChromeTabGroupsDebug(snapshot) {
  await chrome.storage.local.set({
    [CHROME_TAB_GROUPS_DEBUG_KEY]: {
      ...snapshot,
      updatedAt: new Date().toISOString(),
    },
  });
}

function ensureChromeTabGroupsSubscription() {
  if (!chromeTabGroupsEnabled || typeof subscribeToChromeTabGroupChanges !== 'function') {
    if (chromeTabGroupsImportTimer) {
      clearTimeout(chromeTabGroupsImportTimer);
      chromeTabGroupsImportTimer = null;
    }
    if (chromeTabGroupsUnsubscribe) {
      chromeTabGroupsUnsubscribe();
      chromeTabGroupsUnsubscribe = null;
    }
    return;
  }

  if (chromeTabGroupsUnsubscribe) return;
  chromeTabGroupsUnsubscribe = subscribeToChromeTabGroupChanges(() => {
    scheduleChromeTabGroupsImport();
  });
}

async function importChromeNativeGroupsIntoSessionGroups() {
  if (!chromeTabGroupsEnabled ||
      typeof reconcileChromeTabGroupImports !== 'function' ||
      typeof queryExistingChromeGroups !== 'function') {
    await saveChromeTabGroupsDebug({
      stage: 'import-skipped',
      enabled: chromeTabGroupsEnabled,
      hasReconcile: typeof reconcileChromeTabGroupImports === 'function',
      hasQuery: typeof queryExistingChromeGroups === 'function',
    });
    return 0;
  }

  const chromeGroups = await queryExistingChromeGroups();
  const nativeGroups = [];

  for (const chromeGroup of chromeGroups) {
    const groupedTabs = await chrome.tabs.query({ groupId: chromeGroup.id }).catch(() => []);
    const tabIds = groupedTabs.map(tab => tab.id).filter(tabId => tabId != null);
    if (!tabIds.length) continue;
    nativeGroups.push({
      chromeGroupId: chromeGroup.id,
      windowId: chromeGroup.windowId != null ? chromeGroup.windowId : (groupedTabs[0]?.windowId ?? 0),
      title: chromeGroup.title || 'Group',
      color: chromeGroup.color || 'grey',
      tabIds,
    });
  }

  const result = reconcileChromeTabGroupImports({
    currentState: sessionGroupsState,
    importedMeta: importedChromeGroupMeta,
    nativeGroups,
  });

  await saveSessionGroups(result.state);
  await saveImportedChromeGroupMeta(result.importedMeta);
  if (typeof populateChromeGroupMap === 'function') {
    await populateChromeGroupMap(result.mappings);
  }
  await saveChromeTabGroupsDebug({
    stage: 'import-finished',
    chromeGroupCount: chromeGroups.length,
    importedNativeGroupCount: nativeGroups.length,
    sessionGroupCount: result.state.groups.length,
    assignmentCount: Object.keys(result.state.assignments).length,
    importedMetaCount: result.importedMeta.entries.length,
    chromeGroupTitles: chromeGroups.map(group => group?.title || '(untitled)'),
    nativeGroups,
  });
  return nativeGroups.length;
}

function scheduleChromeTabGroupsImport() {
  if (!chromeTabGroupsEnabled) return;
  if (chromeTabGroupsImportTimer) clearTimeout(chromeTabGroupsImportTimer);
  chromeTabGroupsImportTimer = setTimeout(async () => {
    chromeTabGroupsImportTimer = null;
    if (chromeTabGroupsImportInFlight) {
      scheduleChromeTabGroupsImport();
      return;
    }

    chromeTabGroupsImportInFlight = true;
    try {
      await fetchOpenTabs();
      const realTabs = getRealTabs();
      await loadSessionGroups(realTabs.map(tab => tab.id));
      await loadImportedChromeGroupMeta();
      const importedCount = await importChromeNativeGroupsIntoSessionGroups();
      if (typeof setImportMode === 'function') setImportMode(importedCount > 0);
      await renderDashboard();
    } finally {
      chromeTabGroupsImportInFlight = false;
    }
  }, 120);
}

async function applyChromeTabGroupsToggle(nextEnabled) {
  const enable = Boolean(nextEnabled);
  await saveChromeTabGroupsSetting(enable);
  chromeTabGroupsEnabled = enable;

  await fetchOpenTabs();
  const realTabs = getRealTabs();
  await loadSessionGroups(realTabs.map(tab => tab.id));
  await loadImportedChromeGroupMeta();

  let importedCount = 0;
  if (enable) {
    importedCount = await importChromeNativeGroupsIntoSessionGroups();
  } else if (typeof reconcileChromeTabGroupImports === 'function') {
    const cleared = reconcileChromeTabGroupImports({
      currentState: sessionGroupsState,
      importedMeta: importedChromeGroupMeta,
      nativeGroups: [],
    });
    await saveSessionGroups(cleared.state);
    await saveImportedChromeGroupMeta(cleared.importedMeta);
  }

  ensureChromeTabGroupsSubscription();
  if (typeof setImportMode === 'function') setImportMode(importedCount > 0);
  await renderDashboard();
  showToast(enable
    ? (runtimeT ? runtimeT('toastChromeTabGroupsOn') : 'Chrome tab groups on')
    : (runtimeT ? runtimeT('toastChromeTabGroupsOff') : 'Chrome tab groups off'));
}

async function loadGroupOrder() {
  const stored = await chrome.storage.local.get(GROUP_ORDER_KEY);
  groupOrderState = normalizeGroupOrderState(stored[GROUP_ORDER_KEY]);
  return groupOrderState;
}

async function saveGroupOrder(nextState) {
  groupOrderState = normalizeGroupOrderState(nextState);
  await chrome.storage.local.set({ [GROUP_ORDER_KEY]: groupOrderState });
  return groupOrderState;
}

function updateGroupNavButtonIcon(groupKey) {
  const group = domainGroups.find(item => String(item.domain) === String(groupKey));
  const button = document.querySelector(`.group-nav-button[data-group-id="${CSS.escape(String(groupKey))}"]`);
  if (!group || !button || !runtimeGetGroupIcon) return;

  const label = group.domain === '__landing-pages__' ? (runtimeT ? runtimeT('homepagesLabel') : 'Homepages') : (group.label || friendlyDomain(group.domain));
  const orderedGroup = {
    ...group,
    tabs: getOrderedUniqueTabsForGroup(group),
  };
  const iconData = runtimeGetGroupIcon(orderedGroup, label, 32);
  const img = button.querySelector('.group-nav-icon');
  const fallback = button.querySelector('.group-nav-fallback');

  if (img && iconData.src) {
    img.src = iconData.src;
    if (typeof runtimeSetImageFallbackAttributes === 'function') {
      runtimeSetImageFallbackAttributes(img, iconData.fallbackSrc);
    }
    img.style.display = '';
    if (fallback) {
      fallback.textContent = iconData.fallbackLabel;
      fallback.style.display = 'none';
    }
    return;
  }

  if (img) img.style.display = 'none';
  if (fallback) {
    fallback.textContent = iconData.fallbackLabel;
    fallback.style.display = '';
  }
}

function animatePageChipItems(listEl, previousRects) {
  listEl?.querySelectorAll('[data-chip-sort-id]').forEach(item => {
    if (item.classList.contains('is-dragging')) return;

    const key = item.dataset.chipSortId || '';
    const previousRect = previousRects.get(key);
    if (!previousRect) return;

    const nextRect = item.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    if (!deltaX && !deltaY) return;

    item.style.transition = 'none';
    item.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    requestAnimationFrame(() => {
      item.style.transition = 'transform 0.16s ease';
      item.style.transform = '';
    });
  });
}

function syncGroupOrderState(orderKeys) {
  groupOrderState = normalizeGroupOrderState({
    ...groupOrderState,
    sessionOrder: orderKeys,
    pinnedOrder: groupOrderState.pinEnabled ? orderKeys : groupOrderState.pinnedOrder,
  });
  return groupOrderState;
}

function getStableGroupId(groupKey) {
  return 'domain-' + String(groupKey).replace(/[^a-z0-9]/g, '-');
}

function animateNavButtonNode(button, previousRect) {
  if (!button || !previousRect || button.classList.contains('is-dragging')) return;

  const nextRect = button.getBoundingClientRect();
  const deltaX = previousRect.left - nextRect.left;
  const deltaY = previousRect.top - nextRect.top;
  if (!deltaX && !deltaY) return;

  const travel = Math.hypot(deltaX, deltaY);
  const duration = prefersReducedMotion()
    ? 0
    : Math.min(320, Math.max(190, Math.round(172 + travel * 0.28)));

  button.style.transition = 'none';
  button.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
  requestAnimationFrame(() => {
    button.style.transition = duration
      ? `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
      : 'none';
    button.style.transform = '';
  });
}

function animateNavButtons(navListEl, previousRects) {
  navListEl?.querySelectorAll('.group-nav-button').forEach(button => {
    const key = button.dataset.groupId || '';
    animateNavButtonNode(button, previousRects.get(key));
  });
}

function applyLiveGroupOrder(orderKeys, options = {}) {
  const keyOrder = orderKeys.map(String);
  const groupMap = new Map(domainGroups.map(group => [String(group.domain), group]));
  domainGroups = keyOrder.map(key => groupMap.get(key)).filter(Boolean);
  syncGroupOrderState(domainGroups.map(group => group.domain));

  const missionsEl = document.getElementById('openTabsMissions');
  const navListEl = document.querySelector('#openTabsGroupNav .group-nav-list');
  if (options.reorderCards !== false) {
    keyOrder.forEach(key => {
      const card = missionsEl?.querySelector(`.mission-card[data-group-id="${CSS.escape(String(key))}"]`);
      if (card) missionsEl.appendChild(card);
    });
  }

  if (options.reorderNav === false || !navListEl) return;

  const previousNavRects = new Map();
  navListEl.querySelectorAll('.group-nav-button').forEach(button => {
    previousNavRects.set(button.dataset.groupId || '', button.getBoundingClientRect());
  });

  keyOrder.forEach(key => {
    const button = navListEl.querySelector(`.group-nav-button[data-group-id="${CSS.escape(String(key))}"]`);
    if (button) navListEl.appendChild(button);
  });

  animateNavButtons(navListEl, previousNavRects);
}

function clearGroupDragState() {
  draggedGroupId = '';
  dragStartPoint = null;
  draggedGroupButtonEl = null;
  dragPlaceholderEl?.remove();
  dragPlaceholderEl = null;
  document.body.classList.remove('group-dragging');
  document.querySelectorAll('.group-nav-button.is-dragging').forEach(button => {
    button.classList.remove('is-dragging');
    button.style.removeProperty('--drag-left');
    button.style.removeProperty('--drag-top');
  });
}

function animateDrawerListItems(listEl, previousRects) {
  listEl?.querySelectorAll('[data-drawer-sort-id]').forEach(item => {
    if (item.classList.contains('is-dragging')) return;

    const key = item.dataset.drawerSortId || '';
    const previousRect = previousRects.get(key);
    if (!previousRect) return;

    const nextRect = item.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    if (!deltaX && !deltaY) return;

    item.style.transition = 'none';
    item.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    requestAnimationFrame(() => {
      item.style.transition = 'transform 0.16s ease';
      item.style.transform = '';
    });
  });
}

function ensureDrawerItemPlaceholder() {
  if (drawerItemPlaceholderEl || !draggedDrawerItemEl) return drawerItemPlaceholderEl;

  drawerItemPlaceholderEl = document.createElement('div');
  drawerItemPlaceholderEl.className = 'drawer-reorder-placeholder';
  drawerItemPlaceholderEl.style.height = `${draggedDrawerItemEl.getBoundingClientRect().height}px`;
  draggedDrawerItemEl.insertAdjacentElement('afterend', drawerItemPlaceholderEl);
  return drawerItemPlaceholderEl;
}

function clearDrawerItemDragState() {
  draggedDrawerItemId = '';
  drawerItemDragState = null;
  drawerItemPlaceholderEl?.remove();
  drawerItemPlaceholderEl = null;
  document.body.classList.remove('drawer-list-dragging');

  if (draggedDrawerItemEl) {
    draggedDrawerItemEl.classList.remove('is-dragging');
    draggedDrawerItemEl.style.removeProperty('--drag-left');
    draggedDrawerItemEl.style.removeProperty('--drag-top');
    draggedDrawerItemEl.style.removeProperty('--drag-width');
  }

  draggedDrawerItemEl = null;
}

function ensurePageChipPlaceholder() {
  if (pageChipPlaceholderEl || !draggedPageChipEl) return pageChipPlaceholderEl;

  pageChipPlaceholderEl = document.createElement('div');
  pageChipPlaceholderEl.className = 'chip-reorder-placeholder';
  pageChipPlaceholderEl.style.height = `${draggedPageChipEl.getBoundingClientRect().height}px`;
  draggedPageChipEl.insertAdjacentElement('afterend', pageChipPlaceholderEl);
  return pageChipPlaceholderEl;
}

function clearPageChipDragState() {
  draggedPageChipId = '';
  pageChipDragState = null;
  pageChipPlaceholderEl?.remove();
  pageChipPlaceholderEl = null;
  document.body.classList.remove('page-chip-list-dragging');

  if (draggedPageChipEl) {
    draggedPageChipEl.classList.remove('is-dragging');
    draggedPageChipEl.style.removeProperty('--drag-left');
    draggedPageChipEl.style.removeProperty('--drag-top');
    draggedPageChipEl.style.removeProperty('--drag-width');
  }

  draggedPageChipEl = null;
}

function updateDraggedPageChipPosition(clientX, clientY) {
  if (!draggedPageChipEl || !pageChipDragState) return;

  draggedPageChipEl.style.setProperty('--drag-left', `${clientX - pageChipDragState.offsetX}px`);
  draggedPageChipEl.style.setProperty('--drag-top', `${clientY - pageChipDragState.offsetY}px`);
}

function previewPageChipOrder(clientY) {
  const listEl = pageChipDragState?.listEl;
  if (!listEl || !draggedPageChipId) return;

  const placeholder = ensurePageChipPlaceholder();
  const previousRects = new Map();
  const items = [...listEl.querySelectorAll('[data-chip-sort-id]:not(.is-dragging)')];

  items.forEach(item => {
    previousRects.set(item.dataset.chipSortId || '', item.getBoundingClientRect());
  });

  let insertBeforeItem = null;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      insertBeforeItem = item;
      break;
    }
  }

  if (insertBeforeItem) {
    listEl.insertBefore(placeholder, insertBeforeItem);
  } else {
    listEl.appendChild(placeholder);
  }

  animatePageChipItems(listEl, previousRects);
}

async function saveGroupTabRowOrder(groupKey, orderUrls) {
  if (!groupKey || !Array.isArray(orderUrls) || !orderUrls.length) return;

  await saveGroupTabOrder({
    ...groupTabOrderState,
    [String(groupKey)]: orderUrls.map(url => String(url)).filter(Boolean),
  });
}

function updateDraggedDrawerItemPosition(clientX, clientY) {
  if (!draggedDrawerItemEl || !drawerItemDragState) return;

  draggedDrawerItemEl.style.setProperty('--drag-left', `${clientX - drawerItemDragState.offsetX}px`);
  draggedDrawerItemEl.style.setProperty('--drag-top', `${clientY - drawerItemDragState.offsetY}px`);
}

function previewDrawerItemOrder(clientY) {
  const listEl = drawerItemDragState?.listEl;
  if (!listEl || !draggedDrawerItemId) return;

  const placeholder = ensureDrawerItemPlaceholder();
  const previousRects = new Map();
  const items = [...listEl.querySelectorAll('[data-drawer-sort-id]:not(.is-dragging)')];

  items.forEach(item => {
    previousRects.set(item.dataset.drawerSortId || '', item.getBoundingClientRect());
  });

  let insertBeforeItem = null;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      insertBeforeItem = item;
      break;
    }
  }

  if (insertBeforeItem) {
    listEl.insertBefore(placeholder, insertBeforeItem);
  } else {
    listEl.appendChild(placeholder);
  }

  animateDrawerListItems(listEl, previousRects);
}

async function reorderSavedTabs(orderIds) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const nextDeferred = reorderVisibleItemsByIds(
    deferred,
    orderIds,
    item => item && item.id && !item.completed && !item.dismissed
  );
  await chrome.storage.local.set({ deferred: nextDeferred });
  return nextDeferred;
}

async function reorderTodoItems(orderIds) {
  const todos = await getTodos();
  const nextTodos = reorderVisibleItemsByIds(
    todos,
    orderIds,
    todo => todo && todo.id && !todo.completed && !todo.dismissed
  );
  return saveTodos(nextTodos);
}

async function saveDrawerItemOrder(kind, orderIds) {
  if (!Array.isArray(orderIds) || !orderIds.length) return;

  if (kind === 'saved') {
    await reorderSavedTabs(orderIds);
    return;
  }

  if (kind === 'todo') {
    await reorderTodoItems(orderIds);
  }
}

function updateDraggedButtonPosition(clientX, clientY) {
  if (!draggedGroupButtonEl || !dragStartPoint) return;
  draggedGroupButtonEl.style.setProperty('--drag-left', `${clientX - dragStartPoint.offsetX}px`);
  draggedGroupButtonEl.style.setProperty('--drag-top', `${clientY - dragStartPoint.offsetY}px`);
}

function ensureDragPlaceholder() {
  if (dragPlaceholderEl || !draggedGroupButtonEl) return dragPlaceholderEl;

  dragPlaceholderEl = document.createElement('div');
  dragPlaceholderEl.className = 'group-nav-placeholder';
  draggedGroupButtonEl.insertAdjacentElement('afterend', dragPlaceholderEl);
  return dragPlaceholderEl;
}

function previewDraggedOrder(clientX) {
  const navListEl = document.querySelector('#openTabsGroupNav .group-nav-list');
  if (!navListEl || !draggedGroupId) return;

  const placeholder = ensureDragPlaceholder();
  const buttons = [...navListEl.querySelectorAll('.group-nav-button:not(.is-dragging)')];
  let insertBeforeButton = null;

  for (const button of buttons) {
    const rect = button.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      insertBeforeButton = button;
      break;
    }
  }

  if (insertBeforeButton) {
    navListEl.insertBefore(placeholder, insertBeforeButton);
  } else {
    navListEl.appendChild(placeholder);
  }

  const previewOrderKeys = [...navListEl.children]
    .map(node => {
      if (node === placeholder) return draggedGroupId;
      if (node.classList?.contains('group-nav-button') && !node.classList.contains('is-dragging')) {
        return node.dataset.groupId || '';
      }
      return '';
    })
    .filter(Boolean);

  if (previewOrderKeys.length > 0) {
    applyLiveGroupOrder(previewOrderKeys, { reorderCards: false, reorderNav: false });
  }
}

async function removeTabAssignments(tabIds = []) {
  if (!tabIds.length) return sessionGroupsState;

  let nextState = sessionGroupsState;
  for (const tabId of tabIds) {
    nextState = clearTabSessionGroup(nextState, tabId);
  }

  nextState = pruneSessionGroups(nextState, openTabs.map(tab => tab.id));
  return saveSessionGroups(nextState);
}

function buildMoveMenu(tab) {
  const currentGroupId = tab.manualGroupId || '';
  const otherGroups = sessionGroupsState.groups.filter(group => group.id !== currentGroupId);
  const groupButtons = otherGroups.map(group => `
    <button
      class="move-menu-btn"
      type="button"
      data-action="move-tab-to-group"
      data-tab-id="${tab.id}"
      data-group-id="${group.id}"
    >
      ${runtimeEscapeHtml ? runtimeEscapeHtml(group.name) : group.name}
    </button>`).join('');

  return `
    <div class="chip-move-wrap">
      <button
        class="chip-action chip-move-trigger"
        type="button"
        data-action="toggle-move-menu"
        data-tab-id="${tab.id}"
        aria-label="${runtimeT ? runtimeT('moveToGroup') : 'Move to group'}"
        aria-expanded="false"
        title="${runtimeT ? runtimeT('moveToGroup') : 'Move to group'}"
      >
        ${ICONS.move}
      </button>
      <div class="chip-move-menu" hidden>
        ${groupButtons || `<div class="move-menu-empty">${runtimeT ? runtimeT('noGroupsYet') : 'No groups yet'}</div>`}
        <button class="move-menu-btn move-menu-btn-primary" type="button" data-action="move-tab-to-new-group" data-tab-id="${tab.id}">
          ${runtimeT ? runtimeT('newGroupButton') : '+ New group'}
        </button>
        ${currentGroupId ? `<button class="move-menu-btn" type="button" data-action="move-tab-to-original" data-tab-id="${tab.id}">${runtimeT ? runtimeT('backToOriginalGroup') : 'Back to original group'}</button>` : ''}
      </div>
    </div>`;
}

function closeMoveMenus() {
  document.querySelectorAll('.chip-move-menu').forEach(menu => {
    menu.hidden = true;
  });
  document.querySelectorAll('.chip-move-trigger.is-open').forEach(trigger => {
    trigger.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  });
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
  await loadSessionGroups(openTabs.map(tab => tab.id));
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
  await loadSessionGroups(openTabs.map(tab => tab.id));
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return false;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
  if (typeof syncChromeTabGroupExpansionForTab === 'function') {
    await syncChromeTabGroupExpansionForTab(match);
  }
  return true;
}

async function navigateCurrentTabToUrl(url) {
  if (!url) return false;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return false;
  await chrome.tabs.update(activeTab.id, { url });
  return true;
}

async function openOrFocusUrl(url) {
  if (!url) return false;
  await navigateCurrentTabToUrl(url);
  return true;
}

async function runDefaultSearch(query) {
  const text = String(query || '').trim();
  if (!text) return;

  if (chrome.search?.query) {
    await chrome.search.query({
      text,
      disposition: 'CURRENT_TAB',
    });
    return;
  }

  const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  await navigateCurrentTabToUrl(fallbackUrl);
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
  await loadSessionGroups(openTabs.map(tab => tab.id));
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Harbor new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Harbor tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Harbor pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(tab.url || '') : (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(label) : label.replace(/"/g, '&quot;');
    const safeLabel = runtimeEscapeHtml ? runtimeEscapeHtml(label) : label;
    const iconData = runtimeGetIconSources(tab, 16);
    const faviconUrl = iconData.sources[0] || '';
    const fallbackUrl = iconData.sources[1] || '';
    const fallbackLabel = runtimeGetFallbackLabel(label, iconData.hostname);
    const safeFallbackUrl = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(fallbackUrl) : fallbackUrl.replace(/"/g, '&quot;');
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" aria-label="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" data-fallback-src="${safeFallbackUrl}">` : ''}
      <span class="chip-favicon chip-favicon-fallback"${faviconUrl ? ' style="display:none"' : ''}>${fallbackLabel}</span>
      <span class="chip-text">${safeLabel}</span>${dupeTag}
      <div class="chip-actions">
        ${buildMoveMenu(tab)}
        <button class="chip-action chip-save" type="button" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" aria-label="${runtimeT ? runtimeT('saveForLater') : 'Save for later'}" title="${runtimeT ? runtimeT('saveForLater') : 'Save for later'}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" type="button" data-action="close-single-tab" data-tab-url="${safeUrl}" aria-label="${runtimeT ? runtimeT('closeThisTab') : 'Close this tab'}" title="${runtimeT ? runtimeT('closeThisTab') : 'Close this tab'}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">${runtimeT ? runtimeT('moreCount', { count: hiddenTabs.length }) : `+${hiddenTabs.length} more`}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = getStableGroupId(group.domain);

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${runtimeT
      ? runtimeT('tabsOpenBadge', {
          count: tabCount,
          tabsWord: tabCount === 1 ? runtimeT('tabsWordSingular') : runtimeT('tabsWordPlural'),
        })
      : `${tabCount} tab${tabCount !== 1 ? 's' : ''} open`}
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge is-duplicate">
        ${runtimeT
          ? runtimeT('duplicatesCount', {
              count: totalExtras,
              suffix: totalExtras !== 1 ? 's' : '',
            })
          : `${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}`}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const orderedTabs = getOrderedUniqueTabsForGroup(group);
  const visibleTabs = orderedTabs.slice(0, 8);
  const extraCount  = orderedTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(tab.url || '') : (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(label) : label.replace(/"/g, '&quot;');
    const safeLabel = runtimeEscapeHtml ? runtimeEscapeHtml(label) : label;
    const safeSortId = (runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(tab.url) : tab.url.replace(/"/g, '&quot;'));
    const safeGroupId = (runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(group.domain) : String(group.domain).replace(/"/g, '&quot;'));
    const iconData = runtimeGetIconSources(tab, 16);
    const faviconUrl = iconData.sources[0] || '';
    const fallbackUrl = iconData.sources[1] || '';
    const fallbackLabel = runtimeGetFallbackLabel(label, iconData.hostname);
    const safeFallbackUrl = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(fallbackUrl) : fallbackUrl.replace(/"/g, '&quot;');
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-chip-sort-id="${safeSortId}" data-chip-group-id="${safeGroupId}" aria-label="${safeTitle}">
      <button class="drawer-reorder-handle chip-reorder-handle" type="button" data-chip-drag-handle="tab" aria-label="${runtimeT ? runtimeT('dragReorderTab') : 'Drag to reorder tab'}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" /></svg>
      </button>
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" data-fallback-src="${safeFallbackUrl}">` : ''}
      <span class="chip-favicon chip-favicon-fallback"${faviconUrl ? ' style="display:none"' : ''}>${fallbackLabel}</span>
      <span class="chip-text">${safeLabel}</span>${dupeTag}
      <div class="chip-actions">
        ${buildMoveMenu(tab)}
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${runtimeT ? runtimeT('saveForLater') : 'Save for later'}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="${runtimeT ? runtimeT('closeThisTab') : 'Close this tab'}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(orderedTabs.slice(8), urlCounts) : '');

  const closeAllButton = `
      <button class="action-btn close-tabs" type="button" data-action="close-domain-tabs" data-domain-id="${stableId}">
        ${ICONS.close}
        ${runtimeT ? runtimeT('closeGroup') : 'Close group'}
      </button>`;

  let actionsHtml = '';
  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" type="button" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        ${runtimeT
          ? runtimeT('closedDuplicatesCount', { count: totalExtras, suffix: totalExtras !== 1 ? 's' : '' })
          : `Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}`}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}" data-group-id="${group.domain}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <div class="mission-heading">
            <span class="mission-name">${isLanding ? (runtimeT ? runtimeT('homepagesLabel') : 'Homepages') : (runtimeEscapeHtml ? runtimeEscapeHtml(group.label || friendlyDomain(group.domain)) : (group.label || friendlyDomain(group.domain)))}</span>
            ${tabBadge}
            ${dupeBadge}
          </div>
          ${closeAllButton}
        </div>
        <div class="mission-pages">${pageChips}</div>
        ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ''}
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">${runtimeT ? runtimeT('tabsLabel') : 'tabs'}</div>
      </div>
    </div>`;
}

function renderGroupNav(group) {
  const stableId = getStableGroupId(group.domain);
  const isLanding = group.domain === '__landing-pages__';
  const label = isLanding ? (runtimeT ? runtimeT('homepagesLabel') : 'Homepages') : (group.label || friendlyDomain(group.domain));
  const orderedGroup = {
    ...group,
    tabs: getOrderedUniqueTabsForGroup(group),
  };
  const iconData = runtimeGetGroupIcon(orderedGroup, label, 32);
  const safeTooltip = runtimeEscapeHtmlAttribute(label);

  return `
    <button
      class="group-nav-button"
      data-action="jump-to-domain"
      data-group-id="${group.domain}"
      data-domain-id="${stableId}"
      data-tooltip="${safeTooltip}"
      aria-label="${runtimeT ? runtimeT('jumpToLabel', { label }) : `Jump to ${label}` }"
      draggable="false"
    >
      ${iconData.src
        ? `<img class="group-nav-icon" src="${iconData.src}" alt="" draggable="false" data-fallback-src="${runtimeEscapeHtmlAttribute(iconData.fallbackSrc)}">`
        : ''}
      <span class="group-nav-fallback"${iconData.src ? ' style="display:none"' : ''}>${iconData.fallbackLabel}</span>
    </button>`;
}

function renderGroupNavArea(groups) {
  const pinTooltip = groupOrderState.pinEnabled
    ? (runtimeT ? runtimeT('pinnedOrder') : 'Pinned order')
    : (runtimeT ? runtimeT('pinOrder') : 'Pin order');
  const languagePreference = runtimeGetLanguagePreference ? runtimeGetLanguagePreference() : 'auto';
  return `
    <div class="group-nav-list">
      ${groups.map(group => renderGroupNav(group)).join('')}
    </div>
    <div class="group-nav-tools">
      <button class="header-theme-trigger" id="themeMenuTrigger" type="button" data-action="toggle-theme-menu" data-tooltip="${runtimeT ? runtimeT('deskSettings') : 'Desk settings'}" aria-label="${runtimeT ? runtimeT('deskSettings') : 'Desk settings'}" aria-expanded="false" aria-controls="themeMenuPanel">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 7.5h15m-12 4.5h9m-6 4.5h3" />
          <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="16.5" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <button class="group-pin-toggle ${groupOrderState.pinEnabled ? 'is-active' : ''}" id="headerPinToggle" type="button" data-action="toggle-pin-order" data-tooltip="${pinTooltip}" aria-label="${pinTooltip}" aria-pressed="${groupOrderState.pinEnabled}">
        ${ICONS.pin}
      </button>
      <div class="theme-menu" id="themeMenuPanel" hidden role="dialog" aria-label="${runtimeT ? runtimeT('deskSettingsPanel') : 'Desk settings panel'}">
        <div class="theme-menu-section">
          <div class="theme-menu-row theme-menu-row-inline-choices">
            <div class="theme-menu-label">${runtimeT ? runtimeT('appearanceMode') : 'Appearance mode'}</div>
            <div class="theme-mode-options" id="themeModeOptions" role="group" aria-label="${runtimeT ? runtimeT('appearanceMode') : 'Appearance mode'}"></div>
          </div>
        </div>
        <div class="theme-menu-section">
          <div class="theme-menu-label">${runtimeT ? runtimeT('deskPalette') : 'Desk palette'}</div>
          <div class="theme-options" id="themeOptions"></div>
        </div>
        <div class="theme-menu-section">
          <div class="theme-menu-label">${runtimeT ? runtimeT('deskBackdrop') : 'Desk backdrop'}</div>
          <div class="theme-menu-actions">
            <button class="theme-menu-action" type="button" data-action="open-background-picker">${runtimeT ? runtimeT('uploadImage') : 'Upload image'}</button>
            <button class="theme-menu-action is-secondary" type="button" data-action="clear-custom-background">${runtimeT ? runtimeT('clearText') : 'Clear'}</button>
          </div>
        </div>
        <div class="theme-menu-section">
          <div class="theme-menu-row theme-menu-row-inline-choices">
            <div class="theme-menu-label">${runtimeT ? runtimeT('languageLabel') : 'Language'}</div>
            <div class="theme-language-options" role="group" aria-label="${runtimeT ? runtimeT('languageLabel') : 'Language'}">
              <button class="theme-language-option ${languagePreference === 'auto' ? 'is-active' : ''}" type="button" data-action="select-language" data-language="auto" aria-pressed="${languagePreference === 'auto'}">${runtimeT ? runtimeT('languageAuto') : 'Auto'}</button>
              <button class="theme-language-option ${languagePreference === 'en' ? 'is-active' : ''}" type="button" data-action="select-language" data-language="en" aria-pressed="${languagePreference === 'en'}">${runtimeT ? runtimeT('languageEnglish') : 'English'}</button>
              <button class="theme-language-option ${languagePreference === 'zh-CN' ? 'is-active' : ''}" type="button" data-action="select-language" data-language="zh-CN" aria-pressed="${languagePreference === 'zh-CN'}">${runtimeT ? runtimeT('languageChinese') : 'Chinese'}</button>
            </div>
          </div>
        </div>
        <div class="theme-menu-section">
          <div class="theme-menu-row theme-menu-row-inline-range">
            <div class="theme-menu-label">${runtimeT ? runtimeT('surfaceDepth') : 'Surface depth'}</div>
            <input
              class="theme-range"
              id="themeTransparencyRange"
              type="range"
              aria-label="${runtimeT ? runtimeT('surfaceDepth') : 'Surface depth'}"
              min="2"
              max="60"
              step="1"
              value="14"
            >
            <div class="theme-range-value" id="themeTransparencyValue">14%</div>
          </div>
        </div>
        <div class="theme-menu-section">
          <label class="theme-menu-toggle-label">
            <input type="checkbox" data-action="toggle-chrome-tab-groups"${chromeTabGroupsEnabled ? ' checked' : ''} aria-label="${runtimeT ? runtimeT('chromeTabGroupsLabel') : 'Chrome tab groups'}">
            <span class="theme-menu-toggle-slider"></span>
            <span class="theme-menu-label theme-menu-toggle-text">${runtimeT ? runtimeT('chromeTabGroupsLabel') : 'Chrome tab groups'}</span>
          </label>
        </div>
        <div class="theme-menu-section">
          <label class="theme-menu-toggle-label theme-menu-toggle-button-row">
            <button class="theme-toggle-switch ${(typeof themePreferences !== 'undefined' && themePreferences.hitokotoEnabled !== false) ? 'is-active' : ''}" type="button" data-action="toggle-hitokoto" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.hitokotoEnabled !== false) ? 'true' : 'false'}" aria-label="${runtimeT ? runtimeT('hitokotoLabel') : '一言'}"></button>
            <span class="theme-menu-label theme-menu-toggle-text">${runtimeT ? runtimeT('hitokotoLabel') : '一言'}</span>
          </label>
        </div>
        <input type="file" id="themeBackgroundInput" accept="image/*" hidden>
      </div>
    </div>`;
}

/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Hitokoto (一言) ---
  const hitokotoEnabled = typeof themePreferences !== 'undefined' ? themePreferences.hitokotoEnabled : true;
  const hitokotoEl     = document.getElementById('hitokoto');
  const hitokotoTextEl = document.getElementById('hitokotoText');
  const hitokotoFromEl = document.getElementById('hitokotoFrom');
  if (hitokotoEnabled && hitokotoEl && hitokotoTextEl && hitokotoFromEl) {
    try {
      const data = await fetchHitokoto();
      if (data) {
        hitokotoTextEl.textContent = data.hitokoto;
        const from = [data.from_who, data.from].filter(Boolean).join(' · ');
        hitokotoFromEl.textContent = from ? ` — ${from}` : '';
        hitokotoEl.style.display = '';
      }
    } catch (_e) {
      // Silently fail — hitokoto is a nice-to-have, not critical
    }
  } else if (hitokotoEl) {
    hitokotoEl.style.display = 'none';
  }

  renderThemeMenu();
  await renderQuickShortcuts();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();
  await loadSessionGroups(realTabs.map(tab => tab.id));
  await loadGroupOrder();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const manualGroupMap = Object.fromEntries(
    sessionGroupsState.groups.map(group => [
      group.id,
      {
        domain: `__session_group__:${group.id}`,
        label: group.name,
        tabs: [],
        isManual: true,
        manualGroupId: group.id,
        createdAt: group.createdAt,
      },
    ])
  );
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      const assignedGroupId = sessionGroupsState.assignments[String(tab.id)];
      if (assignedGroupId && manualGroupMap[assignedGroupId]) {
        manualGroupMap[assignedGroupId].tabs.push({
          ...tab,
          manualGroupId: assignedGroupId,
        });
        continue;
      }

      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  const manualGroups = Object.values(manualGroupMap)
    .filter(group => group.tabs.length > 0)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const automaticGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });
  domainGroups = applyGroupOrder([...manualGroups, ...automaticGroups], groupOrderState);
  await loadGroupTabOrder(domainGroups);

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');
  const openTabsGroupNav     = document.getElementById('openTabsGroupNav');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = runtimeT ? runtimeT('openTabsSectionTitle') : 'Open tabs';
    const tabsWord = runtimeT
      ? (realTabs.length === 1 ? runtimeT('tabsWordSingular') : runtimeT('tabsWordPlural'))
      : `tab${realTabs.length !== 1 ? 's' : ''}`;
    const groupsWord = runtimeT
      ? (domainGroups.length === 1 ? runtimeT('groupsWordSingular') : runtimeT('groupsWordPlural'))
      : `group${domainGroups.length !== 1 ? 's' : ''}`;
    const summary = runtimeT
      ? runtimeT('sectionSummary', { tabs: realTabs.length, groups: domainGroups.length, tabsWord, groupsWord })
      : `${realTabs.length} ${tabsWord} across ${domainGroups.length} ${groupsWord}`;
    if (openTabsSectionCount) {
      openTabsSectionCount.innerHTML = `<span class="section-summary">${summary}</span><button class="action-btn close-tabs section-action" type="button" data-action="close-all-open-tabs">${ICONS.close} ${runtimeT ? runtimeT('closeAllTabsButton') : 'Close all tabs'}</button>`;
    }
    if (openTabsMissionsEl) openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    if (openTabsGroupNav) {
      openTabsGroupNav.innerHTML = renderGroupNavArea(domainGroups);
      openTabsGroupNav.style.display = 'flex';
    }
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    if (openTabsGroupNav) {
      openTabsGroupNav.innerHTML = '';
      openTabsGroupNav.style.display = 'none';
    }
    openTabsSection.style.display = 'block';
    if (openTabsMissionsEl) openTabsMissionsEl.innerHTML = renderMissionsEmptyState();
    if (openTabsSectionCount) openTabsSectionCount.textContent = runtimeT ? runtimeT('emptyTabsCount') : '0 domains';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Harbor tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
  
  // Setup image error handlers for CSP compliance
  setupImageErrorHandlers();
}

async function renderDashboard() {
  await renderStaticDashboard();
  if (typeof syncChromeTabGroups === 'function') {
    await syncChromeTabGroups(getChromeSyncGroups(domainGroups));
  }
}

async function collapseChromeGroupsForCurrentTabHarborTab() {
  if (typeof collapseChromeTabGroupsInWindow !== 'function') return;

  let currentTab = null;
  try {
    currentTab = await chrome.tabs.getCurrent();
  } catch {
    currentTab = null;
  }

  if (!currentTab?.windowId) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = activeTab || null;
    } catch {
      currentTab = null;
    }
  }

  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;
  const isTabHarborTab = currentTab?.url === newtabUrl || currentTab?.url === 'chrome://newtab/';
  if (!currentTab?.windowId || !isTabHarborTab) return;
  await collapseChromeTabGroupsInWindow(currentTab.windowId);
}

function updateBackToTopVisibility() {
  const button = document.getElementById('backToTopBtn');
  if (!button) return;
  const shouldShow = window.scrollY > 320;
  button.classList.toggle('visible', shouldShow);
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  if (e.target.closest('.chip-reorder-handle')) return;
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === 'toggle-theme-menu') {
    setThemeMenuOpen(!themeMenuOpen);
    return;
  }

  if (action === 'select-theme') {
    const paletteId = actionEl.dataset.paletteId || 'paper';
    await saveThemePreferences({ paletteId });
    setThemeMenuOpen(false, { restoreFocus: true });
    showToast(runtimeT ? runtimeT('toastThemeUpdated') : 'Theme updated');
    return;
  }

  if (action === 'select-theme-mode') {
    const mode = actionEl.dataset.themeMode || 'system';
    await saveThemePreferences({ mode });
    setThemeMenuOpen(false, { restoreFocus: true });
    const modeLabelKey = {
      system: 'themeModeSystem',
      light: 'themeModeLight',
      dark: 'themeModeDark',
    }[mode] || 'themeModeSystem';
    const modeLabel = runtimeT
      ? runtimeT(modeLabelKey)
      : mode;
    showToast(runtimeT ? runtimeT('toastThemeModeUpdated', { mode: modeLabel }) : `Appearance mode: ${modeLabel}`);
    return;
  }

  if (action === 'open-background-picker') {
    document.getElementById('themeBackgroundInput')?.click();
    return;
  }

  if (action === 'clear-custom-background') {
    await saveThemePreferences({ customBackground: '' });
    setThemeMenuOpen(false, { restoreFocus: true });
    showToast(runtimeT ? runtimeT('toastBackgroundCleared') : 'Background cleared');
    return;
  }

  if (action === 'select-language') {
    const language = actionEl.dataset.language || 'auto';
    if (runtimeSetLanguagePreference) {
      await runtimeSetLanguagePreference(language, { reload: true });
      return;
    }
  }

  // ---- Close duplicate Tab Harbor tabs ----
  if (action === 'close-tabout-dupes') {
    // Suppress auto-refresh to prevent animation spam
    window.__suppressAutoRefresh = true;
    
    await closeTabOutDupes();
    await renderDashboard();
    updateBackToTopVisibility();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast(runtimeT ? runtimeT('toastClosedExtraTabHarborTabs') : 'Closed extra Tab Harbor tabs');
    return;
  }

  if (action === 'toggle-hitokoto') {
    const nextEnabled = !(typeof themePreferences !== 'undefined' && themePreferences.hitokotoEnabled);
    await saveThemePreferences({ hitokotoEnabled: nextEnabled });
    const hitokotoEl = document.getElementById('hitokoto');
    const hitokotoTextEl = document.getElementById('hitokotoText');
    const hitokotoFromEl = document.getElementById('hitokotoFrom');
    if (hitokotoEl) hitokotoEl.style.display = nextEnabled ? '' : 'none';
    if (nextEnabled && hitokotoTextEl && hitokotoFromEl) {
      // Re-fetch hitokoto when turning back on (with timeout)
      fetchHitokoto().then(data => {
        if (!data) return;
        hitokotoTextEl.textContent = data.hitokoto;
        const from = [data.from_who, data.from].filter(Boolean).join(' · ');
        hitokotoFromEl.textContent = from ? ` — ${from}` : '';
      }).catch(() => { /* silently fail */ });
    } else if (!nextEnabled && hitokotoTextEl && hitokotoFromEl) {
      hitokotoTextEl.textContent = '';
      hitokotoFromEl.textContent = '';
    }
    // Sync toggle switch visual state (renderThemeMenu does not know about this switch)
    const toggleSwitch = document.querySelector('[data-action="toggle-hitokoto"]');
    if (toggleSwitch) {
      toggleSwitch.classList.toggle('is-active', nextEnabled);
      toggleSwitch.setAttribute('aria-pressed', String(nextEnabled));
    }
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Open/close the Move to group menu ----
  if (action === 'toggle-move-menu') {
    e.stopPropagation();
    const menu = actionEl.closest('.chip-move-wrap')?.querySelector('.chip-move-menu');
    const shouldOpen = Boolean(menu?.hidden);
    closeMoveMenus();
    if (menu && shouldOpen) {
      menu.hidden = false;
      actionEl.classList.add('is-open');
      actionEl.setAttribute('aria-expanded', 'true');
    }
    return;
  }

  // ---- Move a tab into an existing manual group ----
  if (action === 'move-tab-to-group') {
    e.stopPropagation();
    const tabId = Number(actionEl.dataset.tabId);
    const groupId = actionEl.dataset.groupId;
    const group = sessionGroupsState.groups.find(item => item.id === groupId);
    if (!tabId || !groupId || !group) return;

    const nextState = assignTabToSessionGroup(sessionGroupsState, tabId, groupId);
    await saveSessionGroups(nextState);
    closeMoveMenus();
    await renderDashboard();
    showToast(runtimeT ? runtimeT('toastMovedTo', { name: group.name }) : `Moved to ${group.name}`);
    return;
  }

  // ---- Create a new manual group and move this tab into it ----
  if (action === 'move-tab-to-new-group') {
    e.stopPropagation();
    const tabId = Number(actionEl.dataset.tabId);
    if (!tabId) return;

    const nextName = window.prompt(runtimeT ? runtimeT('promptNewGroupName') : 'New group name');
    if (!nextName || !nextName.trim()) {
      closeMoveMenus();
      return;
    }

    try {
      const created = addSessionGroup(sessionGroupsState, nextName);
      const nextState = assignTabToSessionGroup(created.state, tabId, created.group.id);
      await saveSessionGroups(nextState);
      closeMoveMenus();
      await renderDashboard();
      showToast(runtimeT ? runtimeT('toastCreatedGroup', { name: created.group.name }) : `Created ${created.group.name}`);
    } catch (err) {
      showToast(err.message || (runtimeT ? runtimeT('toastCouldNotCreateGroup') : 'Could not create group'));
    }
    return;
  }

  // ---- Move a tab back to its original automatic group ----
  if (action === 'move-tab-to-original') {
    e.stopPropagation();
    const tabId = Number(actionEl.dataset.tabId);
    if (!tabId) return;

    const nextState = pruneSessionGroups(
      clearTabSessionGroup(sessionGroupsState, tabId),
      openTabs.map(tab => tab.id)
    );
    await saveSessionGroups(nextState);
    closeMoveMenus();
    await renderDashboard();
    showToast(runtimeT ? runtimeT('toastMovedBackToOriginalGroup') : 'Moved back to original group');
    return;
  }

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Jump to a domain group card from the top icon nav ----
  if (action === 'toggle-pin-order') {
    e.stopPropagation();
    const nextState = setPinEnabled(
      groupOrderState,
      !groupOrderState.pinEnabled,
      domainGroups.map(group => group.domain)
    );
    await saveGroupOrder(nextState);
    await renderDashboard();
    showToast(nextState.pinEnabled
      ? (runtimeT ? runtimeT('toastPinnedOrder') : 'Pinned current order')
      : (runtimeT ? runtimeT('toastPinOrderOff') : 'Pin order turned off'));
    return;
  }

  if (action === 'toggle-chrome-tab-groups') {
    return;
  }

  if (action === 'jump-to-domain') {
    if (Date.now() < suppressJumpUntil) return;
    const domainId = actionEl.dataset.domainId;
    if (!domainId) return;
    const target = document.querySelector(`.mission-card[data-domain-id="${domainId}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('group-nav-target');
    setTimeout(() => target.classList.remove('group-nav-target'), 1200);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Suppress auto-refresh to prevent animation spam
    window.__suppressAutoRefresh = true;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();
    await loadSessionGroups(openTabs.map(tab => tab.id));

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    const parentCard = chip?.closest('.mission-card');
    
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      
      // First phase: fade and scale down
      chip.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.95)';
      
      setTimeout(() => {
        // Second phase: collapse height to 0 for smooth upward slide
        chip.style.transition = 'height 0.2s ease-out, margin 0.2s ease-out, padding 0.2s ease-out, opacity 0.1s';
        chip.style.height     = '0';
        chip.style.marginTop  = '0';
        chip.style.marginBottom = '0';
        chip.style.paddingTop = '0';
        chip.style.paddingBottom = '0';
        chip.style.overflow   = 'hidden';
        
        setTimeout(() => {
          chip.remove();
          
          // Check if card is now empty and animate it out
          if (parentCard) {
            const remainingChips = parentCard.querySelectorAll('.page-chip[data-action="focus-tab"]');
            
            if (remainingChips.length === 0) {
              // Card is empty - wait a brief moment for layout to settle, then animate card out
              setTimeout(() => {
                animateCardOut(parentCard);
              }, 50);
            }
          }
        }, 200);
      }, 150);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast(runtimeT ? runtimeT('toastTabClosed') : 'Tab closed');
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Suppress auto-refresh to prevent animation spam
    window.__suppressAutoRefresh = true;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-harbor] Failed to save tab:', err);
      showToast(runtimeT ? runtimeT('toastFailedToSaveTab') : 'Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();
    await loadSessionGroups(openTabs.map(tab => tab.id));

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast(runtimeT ? runtimeT('toastSavedForLater') : 'Saved for later');
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Restore an active saved tab back to normal (remove from saved) ----
  if (action === 'restore-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    const restored = await restoreSavedTab(id);
    if (!restored?.url) return;

    await reopenSavedTab(restored.url);
    await renderDashboard();

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
      }, 300);
    }

    showToast(runtimeT ? runtimeT('toastRestoredToOpenTabs') : 'Restored to open tabs');
    return;
  }

  // ---- Delete a single archived item ----
  if (action === 'delete-archive-item') {
    const id = actionEl.dataset.archiveId;
    if (!id) return;

    await deleteArchivedTab(id);
    await renderDeferredColumn();
    showToast(runtimeT ? runtimeT('toastRemovedFromArchive') : 'Removed from archive');
    return;
  }

  // ---- Clear all archived items ----
  if (action === 'clear-archive') {
    await clearArchivedTabs();
    await renderDeferredColumn();
    showToast(runtimeT ? runtimeT('toastArchiveCleared') : 'Archive cleared');
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    // Suppress auto-refresh to prevent animation spam
    window.__suppressAutoRefresh = true;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__'
      ? (runtimeT ? runtimeT('homepagesLabel') : 'Homepages')
      : (group.label || friendlyDomain(group.domain));
    const tabsWord = runtimeT
      ? (urls.length === 1 ? runtimeT('tabsWordSingular') : runtimeT('tabsWordPlural'))
      : `tab${urls.length !== 1 ? 's' : ''}`;
    showToast(runtimeT
      ? runtimeT('closedTabsFromGroup', { count: urls.length, tabsWord, groupLabel })
      : `Closed ${urls.length} ${tabsWord} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    // Suppress auto-refresh to prevent animation spam
    window.__suppressAutoRefresh = true;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.classList.contains('is-duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast(runtimeT ? runtimeT('toastClosedDuplicatesKeptOne') : 'Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    // Suppress auto-refresh to prevent animation spam
    window.__suppressAutoRefresh = true;
    
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast(runtimeT ? runtimeT('toastAllTabsClosed') : 'All tabs closed. Fresh start.');
    return;
  }
});

document.addEventListener('click', (e) => {
  const themeTrigger = document.getElementById('themeMenuTrigger');
  const themePanel = document.getElementById('themeMenuPanel');
  if (
    themeMenuOpen &&
    themePanel &&
    !themePanel.contains(e.target) &&
    !themeTrigger?.contains(e.target)
  ) {
    setThemeMenuOpen(false);
  }

  if (e.target.closest('.chip-move-wrap')) return;
  closeMoveMenus();
});

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('#deferredTrigger');
  if (trigger) {
    if (Date.now() < deferredTriggerSuppressClickUntil) return;
    const nextOpen = !(deferredPanelOpen && drawerView === 'saved');
    drawerView = 'saved';
    setDeferredPanelOpen(nextOpen);
    return;
  }

  const todoTrigger = e.target.closest('#todoTrigger');
  if (todoTrigger) {
    if (Date.now() < deferredTriggerSuppressClickUntil) return;
    const nextOpen = !(deferredPanelOpen && drawerView === 'todos');
    drawerView = 'todos';
    setDeferredPanelOpen(nextOpen);
    return;
  }

  if (e.target.closest('#deferredCloseBtn') || e.target.closest('#deferredOverlay')) {
    setDeferredPanelOpen(false);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && themeMenuOpen) {
    setThemeMenuOpen(false, { restoreFocus: true });
    return;
  }

  if (e.key === 'Escape' && deferredPanelOpen) {
    setDeferredPanelOpen(false);
  }
});

document.addEventListener('pointerdown', (e) => {
  const trigger = e.target.closest('.deferred-trigger');
  const triggerStack = document.getElementById('drawerTriggerStack');
  if (!trigger || !triggerStack || isMobileDeferredLayout() || e.button !== 0) return;

  const rect = triggerStack.getBoundingClientRect();
  deferredTriggerDragState = {
    startY: e.clientY,
    offsetY: e.clientY - rect.top,
    moved: false,
  };
});

document.addEventListener('pointermove', (e) => {
  if (!deferredTriggerDragState || isMobileDeferredLayout()) return;

  const triggerStack = document.getElementById('drawerTriggerStack');
  if (!triggerStack) return;

  const distance = Math.abs(e.clientY - deferredTriggerDragState.startY);
  if (!deferredTriggerDragState.moved && distance < 6) return;

  deferredTriggerDragState.moved = true;
  const nextTop = runtimeClampTriggerTop(
    e.clientY - deferredTriggerDragState.offsetY,
    window.innerHeight,
    triggerStack.offsetHeight || 96,
    24
  );
  if (nextTop == null) return;

  deferredTriggerPosition = { top: nextTop };
  triggerStack.style.top = `${nextTop}px`;
});

document.addEventListener('pointerup', async () => {
  if (!deferredTriggerDragState) return;

  if (deferredTriggerDragState.moved) {
    await saveDeferredTriggerPosition(deferredTriggerPosition);
    deferredTriggerSuppressClickUntil = Date.now() + 250;
  }

  deferredTriggerDragState = null;
});

document.addEventListener('click', (e) => {
  const backToTopBtn = e.target.closest('#backToTopBtn');
  if (!backToTopBtn) return;

  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
});

document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === 'switch-drawer-view') {
    drawerView = actionEl.dataset.view || 'saved';
    todoDetailId = '';
    await renderDeferredColumn();
    return;
  }

  if (action === 'toggle-saved-search') {
    savedSearchOpen = !savedSearchOpen;
    if (!savedSearchOpen) savedSearchQuery = '';
    await renderDeferredColumn();
    return;
  }

  if (action === 'toggle-todo-search') {
    todoSearchOpen = !todoSearchOpen;
    if (!todoSearchOpen) todoSearchQuery = '';
    await renderDeferredColumn();
    return;
  }

  if (action === 'create-todo') {
    const title = window.prompt(runtimeT ? runtimeT('promptTodoTitle') : 'Todo title');
    if (!title || !title.trim()) return;
    const description = window.prompt(runtimeT ? runtimeT('promptTodoDetails') : 'Todo details (optional)') || '';
    await createTodoItem({ title, description });
    drawerView = 'todos';
    todoDetailId = '';
    await renderDeferredColumn();
    return;
  }

  if (action === 'open-todo-detail') {
    todoDetailId = actionEl.dataset.todoId || '';
    await renderDeferredColumn();
    return;
  }

  if (action === 'close-todo-detail') {
    todoDetailId = '';
    await renderDeferredColumn();
    return;
  }

  if (action === 'complete-todo') {
    const id = actionEl.dataset.todoId;
    if (!id) return;
    await completeTodoItem(id);
    if (todoDetailId === id) todoDetailId = '';
    await renderDeferredColumn();
    return;
  }

  if (action === 'delete-todo-archive') {
    const id = actionEl.dataset.todoId;
    if (!id) return;
    await deleteTodoItem(id);
    await renderDeferredColumn();
    return;
  }

  if (action === 'clear-todo-archive') {
    await clearTodoArchiveItems();
    await renderDeferredColumn();
    return;
  }

  if (action === 'close-drawer') {
    setDeferredPanelOpen(false);
    return;
  }
});

document.addEventListener('pointerdown', (e) => {
  const chipHandle = e.target.closest('[data-chip-drag-handle="tab"]');
  if (chipHandle && e.button === 0) {
    const item = chipHandle.closest('[data-chip-sort-id]');
    const listEl = item?.parentElement;
    const groupKey = item?.dataset.chipGroupId || '';
    if (!item || !listEl || !groupKey) return;

    e.preventDefault();
    draggedPageChipId = item.dataset.chipSortId || '';
    draggedPageChipEl = item;

    const rect = item.getBoundingClientRect();
    pageChipDragState = {
      groupKey,
      listEl,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      moved: false,
    };
    return;
  }

  const drawerHandle = e.target.closest('.drawer-reorder-handle');
  if (!drawerHandle || e.button !== 0) return;

  const item = drawerHandle.closest('[data-drawer-sort-id]');
  const listEl = item?.parentElement;
  const kind = item?.dataset.drawerSortKind || '';
  if (!item || !listEl || !kind) return;

  e.preventDefault();
  draggedDrawerItemId = item.dataset.drawerSortId || '';
  draggedDrawerItemEl = item;

  const rect = item.getBoundingClientRect();
  drawerItemDragState = {
    kind,
    listEl,
    x: e.clientX,
    y: e.clientY,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    moved: false,
  };
});

document.addEventListener('pointermove', (e) => {
  if (draggedPageChipId && pageChipDragState) {
    const distance = Math.hypot(e.clientX - pageChipDragState.x, e.clientY - pageChipDragState.y);
    if (!pageChipDragState.moved && distance >= 4) {
      pageChipDragState.moved = true;
      document.body.classList.add('page-chip-list-dragging');
      draggedPageChipEl?.classList.add('is-dragging');
      draggedPageChipEl?.style.setProperty('--drag-width', `${draggedPageChipEl.getBoundingClientRect().width}px`);
      ensurePageChipPlaceholder();
    }

    if (pageChipDragState.moved) {
      updateDraggedPageChipPosition(e.clientX, e.clientY);
      previewPageChipOrder(e.clientY);
    }
    return;
  }

  if (!draggedDrawerItemId || !drawerItemDragState) return;

  const distance = Math.hypot(e.clientX - drawerItemDragState.x, e.clientY - drawerItemDragState.y);
  if (!drawerItemDragState.moved && distance < 4) return;

  if (!drawerItemDragState.moved) {
    drawerItemDragState.moved = true;
    document.body.classList.add('drawer-list-dragging');
    draggedDrawerItemEl?.classList.add('is-dragging');
    draggedDrawerItemEl?.style.setProperty('--drag-width', `${draggedDrawerItemEl.getBoundingClientRect().width}px`);
    ensureDrawerItemPlaceholder();
  }

  updateDraggedDrawerItemPosition(e.clientX, e.clientY);
  previewDrawerItemOrder(e.clientY);
});

document.addEventListener('pointerup', async () => {
  if (draggedPageChipId && pageChipDragState) {
    const moved = pageChipDragState.moved;
    const draggedGroupKey = pageChipDragState.groupKey;
    if (moved) {
      const orderUrls = [...pageChipDragState.listEl.children]
        .map(node => {
          if (node === pageChipPlaceholderEl) return draggedPageChipId;
          if (node === draggedPageChipEl) return '';
          return node.dataset?.chipSortId || '';
        })
        .filter(Boolean);

      await saveGroupTabRowOrder(pageChipDragState.groupKey, orderUrls);
      if (draggedPageChipEl && pageChipPlaceholderEl) {
        pageChipDragState.listEl.insertBefore(draggedPageChipEl, pageChipPlaceholderEl);
      }
      if (typeof syncChromeTabGroups === 'function') {
        await syncChromeTabGroups(getChromeSyncGroups(domainGroups));
      }
    }

    clearPageChipDragState();

    if (moved) {
      updateGroupNavButtonIcon(draggedGroupKey);
    }
    return;
  }

  if (!draggedDrawerItemId || !drawerItemDragState) return;

  const moved = drawerItemDragState.moved;
  if (moved) {
    const orderIds = [...drawerItemDragState.listEl.children]
      .map(node => {
        if (node === drawerItemPlaceholderEl) return draggedDrawerItemId;
        return node.dataset?.drawerSortId || '';
      })
      .filter(Boolean);

    await saveDrawerItemOrder(drawerItemDragState.kind, orderIds);
  }

  const draggedKind = drawerItemDragState.kind;
  clearDrawerItemDragState();

  if (moved) {
    if (draggedKind === 'saved') {
      await renderDeferredColumn();
    } else if (draggedKind === 'todo') {
      await renderTodoPanel();
    }
  }
});

document.addEventListener('pointerdown', (e) => {
  const button = e.target.closest('.group-nav-button');
  if (!button) return;

  draggedGroupId = button.dataset.groupId || '';
  draggedGroupButtonEl = button;
  const rect = button.getBoundingClientRect();
  dragStartPoint = {
    x: e.clientX,
    y: e.clientY,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    moved: false,
    lastTargetId: draggedGroupId,
  };
});

document.addEventListener('pointermove', (e) => {
  if (!draggedGroupId || !dragStartPoint) return;

  const distance = Math.hypot(e.clientX - dragStartPoint.x, e.clientY - dragStartPoint.y);
  if (!dragStartPoint.moved && distance < 2) return;

  if (!dragStartPoint.moved) {
    dragStartPoint.moved = true;
    document.body.classList.add('group-dragging');
    draggedGroupButtonEl?.classList.add('is-dragging');
    ensureDragPlaceholder();
  }

  updateDraggedButtonPosition(e.clientX, e.clientY);
  previewDraggedOrder(e.clientX);
});

document.addEventListener('pointerup', async () => {
  if (!draggedGroupId) return;

  const moved = dragStartPoint?.moved;
  if (dragStartPoint?.moved) {
    await saveGroupOrder(groupOrderState);
    suppressJumpUntil = Date.now() + 250;
  }

  clearGroupDragState();

  if (moved) {
    await renderDashboard();
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  const nextOpen = !toggle.classList.contains('open');
  toggle.classList.toggle('open', nextOpen);
  toggle.setAttribute('aria-expanded', String(nextOpen));
  const body = document.getElementById('archiveBody');
  if (body) {
    body.hidden = !nextOpen;
    body.style.display = nextOpen ? 'block' : 'none';
  }
});

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#todoArchiveToggle');
  if (!toggle) return;

  const nextOpen = !toggle.classList.contains('open');
  toggle.classList.toggle('open', nextOpen);
  toggle.setAttribute('aria-expanded', String(nextOpen));
  const body = document.getElementById('todoArchiveBody');
  if (body) {
    body.hidden = !nextOpen;
    body.style.display = nextOpen ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id === 'themeTransparencyRange') {
    themePreferences = normalizeThemePreferences({
      ...themePreferences,
      surfaceOpacity: Number(e.target.value),
    });
    applyThemePreferences();
    const valueEl = document.getElementById('themeTransparencyValue');
    if (valueEl) valueEl.textContent = `${themePreferences.surfaceOpacity}%`;
    await chrome.storage.local.set({ [THEME_PREFERENCES_KEY]: themePreferences });
    return;
  }

  if (e.target.id !== 'savedSearchInput') return;
  savedSearchQuery = e.target.value.trim();
  await renderDeferredColumn();
});

document.addEventListener('input', async (e) => {
  if (e.target.id !== 'todoSearchInput') return;
  todoSearchQuery = e.target.value.trim();
  await renderDeferredColumn();
});

document.addEventListener('change', async (e) => {
  if (e.target.matches('input[data-action="toggle-chrome-tab-groups"]')) {
    if (typeof setThemeMenuOpen === 'function') setThemeMenuOpen(false);
    await applyChromeTabGroupsToggle(e.target.checked);
    return;
  }

  if (e.target.id !== 'themeBackgroundInput') return;

  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  try {
    if (!compressImageFileForStorage) {
      throw new Error('Background compression is unavailable');
    }
    const customBackground = await compressImageFileForStorage(file);
    await saveThemePreferences({ customBackground });
    setThemeMenuOpen(false, { restoreFocus: true });
    showToast('Background updated');
  } catch (err) {
    showToast(err?.message || 'Could not load background');
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'headerSearchForm') return;

  e.preventDefault();
  const input = document.getElementById('headerSearchInput');
  const query = input?.value || '';
  await runDefaultSearch(query);
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */

/**
 * injectDynamicAnimationStyles()
 *
 * Dynamically generates CSS animation rules for staggered entry animations.
 * This avoids hardcoding dozens of nth-child selectors in the CSS file.
 * 
 * Strategy: Stagger first 10 elements, then cap delay to avoid excessive wait times.
 */
function injectDynamicAnimationStyles() {
  // Check if styles already injected to avoid duplicates
  if (document.getElementById('dynamic-animation-styles')) return;

  const styleEl = document.createElement('style');
  styleEl.id = 'dynamic-animation-styles';

  const rules = [];
  const MAX_STAGGER_COUNT = 10; // Only stagger first 10 elements
  const STAGGER_INCREMENT = 0.05; // 50ms between each element

  // Active section mission cards - start at 0.25s, stagger first 10, then cap
  for (let i = 1; i <= 50; i++) {
    const delay = i <= MAX_STAGGER_COUNT 
      ? 0.25 + (i - 1) * STAGGER_INCREMENT
      : 0.25 + (MAX_STAGGER_COUNT - 1) * STAGGER_INCREMENT;
    rules.push(
      `.active-section .missions .mission-card:nth-child(${i}) { animation: fadeUp 0.4s ease ${delay.toFixed(2)}s both; }`
    );
  }

  // Abandoned section mission cards - start at 0.5s, stagger first 10, then cap
  for (let i = 1; i <= 50; i++) {
    const delay = i <= MAX_STAGGER_COUNT 
      ? 0.5 + (i - 1) * STAGGER_INCREMENT
      : 0.5 + (MAX_STAGGER_COUNT - 1) * STAGGER_INCREMENT;
    rules.push(
      `.abandoned-section .missions .mission-card:nth-child(${i}) { animation: fadeUp 0.4s ease ${delay.toFixed(2)}s both; }`
    );
  }

  // Deferred list items - stagger first 10, then cap at 0.5s
  for (let i = 1; i <= 50; i++) {
    const delay = i <= MAX_STAGGER_COUNT 
      ? i * STAGGER_INCREMENT
      : MAX_STAGGER_COUNT * STAGGER_INCREMENT;
    rules.push(
      `.deferred-list .deferred-item:nth-child(${i}) { animation-delay: ${delay.toFixed(2)}s; }`
    );
  }

  styleEl.textContent = rules.join('\n');
  document.head.appendChild(styleEl);
}

/**
 * setupImageErrorHandlers()
 * 
 * Attaches error handlers to all favicon images after DOM update.
 * This replaces inline onerror attributes to comply with CSP.
 */
function setupImageErrorHandlers() {
  // Handle chip favicons
  document.querySelectorAll('.chip-favicon[data-fallback-url]').forEach(img => {
    if (!img.dataset.errorHandlerAttached) {
      img.addEventListener('error', function() {
        const fallbackUrl = this.dataset.fallbackUrl;
        if (fallbackUrl && this.dataset.fallbackApplied !== 'true') {
          this.dataset.fallbackApplied = 'true';
          this.src = fallbackUrl;
          return;
        }
        this.style.display = 'none';
        const sibling = this.nextElementSibling;
        if (sibling && sibling.classList.contains('chip-favicon-fallback')) {
          sibling.style.display = '';
        }
      });
      img.dataset.errorHandlerAttached = 'true';
    }
  });

  // Handle group nav icons
  document.querySelectorAll('.group-nav-icon[data-fallback-src]').forEach(img => {
    if (!img.dataset.errorHandlerAttached) {
      img.addEventListener('error', function() {
        const fallbackSrc = this.dataset.fallbackSrc;
        if (fallbackSrc && this.dataset.fallbackApplied !== 'true') {
          this.dataset.fallbackApplied = 'true';
          this.src = fallbackSrc;
          return;
        }
        this.style.display = 'none';
        const sibling = this.nextElementSibling;
        if (sibling && sibling.classList.contains('group-nav-fallback')) {
          sibling.style.display = '';
        }
      });
      img.dataset.errorHandlerAttached = 'true';
    }
  });
}

async function initializeDashboardRuntime() {
  injectDynamicAnimationStyles();
  await loadThemePreferences();
  if (typeof loadChromeTabGroupsSetting === 'function') {
    chromeTabGroupsEnabled = await loadChromeTabGroupsSetting();
  }
  await loadImportedChromeGroupMeta();
  if (chromeTabGroupsEnabled) {
    await fetchOpenTabs();
    const realTabs = getRealTabs();
    await loadSessionGroups(realTabs.map(tab => tab.id));
    const importedCount = await importChromeNativeGroupsIntoSessionGroups();
    if (typeof setImportMode === 'function') setImportMode(importedCount > 0);
  }
  ensureChromeTabGroupsSubscription();
  await renderDashboard();
  await collapseChromeGroupsForCurrentTabHarborTab();
  updateBackToTopVisibility();

  // Listen for tab change notifications from background script
  setupTabChangeListener();
}

/**
 * setupTabChangeListener()
 * 
 * Listens for messages from background.js when tabs change,
 * and refreshes the dashboard to show updated tab list.
 */
function setupTabChangeListener() {
  console.log('[tab-harbor] Setting up tab change listener');
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[tab-harbor] Received message:', message);
    
    if (message.action === 'tabs-changed') {
      // Skip refresh if we just performed a tab action ourselves
      // This prevents animation spam when closing tabs from the dashboard
      if (window.__suppressAutoRefresh) {
        console.log('[tab-harbor] Auto-refresh suppressed (recent user action)');
        window.__suppressAutoRefresh = false;
        return;
      }
      
      console.log('[tab-harbor] Tab changed, scheduling refresh...');
      
      // Debounce rapid changes (e.g., closing multiple tabs)
      if (window.__tabRefreshTimeout) {
        clearTimeout(window.__tabRefreshTimeout);
      }
      
      window.__tabRefreshTimeout = setTimeout(async () => {
        try {
          console.log('[tab-harbor] Refreshing dashboard...');
          await renderDashboard();
          updateBackToTopVisibility();
          console.log('[tab-harbor] Dashboard refreshed successfully');
        } catch (err) {
          console.warn('[tab-harbor] Failed to refresh dashboard:', err);
        }
      }, 300); // Wait 300ms after last tab change
    }
  });
}

function mountDashboardRuntime() {
  if (!window.__tabHarborRuntimeMounted) {
    window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
    window.addEventListener('focus', () => {
      void collapseChromeGroupsForCurrentTabHarborTab();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void collapseChromeGroupsForCurrentTabHarborTab();
      }
    });
    window.__tabHarborRuntimeMounted = true;
  }
  return initializeDashboardRuntime();
}

globalThis.TabHarborDashboardRuntime = {
  initializeDashboardRuntime,
  mountDashboardRuntime,
  fetchOpenTabs,
  getOpenTabs: () => openTabs,
};
