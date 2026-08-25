/* ================================================================
   Tab Harbor — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, saved sessions, focus tab)
   5. Stores dashboard preferences and workspace state in chrome.storage.local
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
  getFaviconUrl: runtimeGetFaviconUrl,
  getFallbackLabel: runtimeGetFallbackLabel,
  getGroupIcon: runtimeGetGroupIcon,
  getIconSources: runtimeGetIconSources,
  getPrimaryDomain: runtimeGetPrimaryDomain,
} = globalThis.TabOutIconUtils || {};

const {
  addSessionGroup,
  assignTabToSessionGroup,
  clearTabSessionGroup,
  normalizeSessionGroups,
  pruneSessionGroups,
  renameSessionGroup,
} = globalThis.TabOutSessionGroups || {};

const {
  applyGroupOrder,
  createReorderedKeys,
  normalizeGroupOrderState,
} = globalThis.TabOutGroupOrder || {};

const {
  clampTriggerTop: runtimeClampTriggerTop,
} = globalThis.TabOutDeferredTriggerPosition || {};

const {
  loadChromeTabGroupsSetting,
  saveChromeTabGroupsSetting,
  syncChromeTabGroups,
  isChromeTabGroupsEnabled,
  populateChromeGroupMap,
  queryExistingChromeGroups,
  queryUserChromeGroups,
  getManagedChromeGroupIds,
  getChromeGroupsLastError,
  reorderGroupedTabs,
  muteChromeGroupEvents,
  setImportMode,
  subscribeToChromeTabGroupChanges,
  assignGroupColor: runtimeAssignGroupColor,
} = globalThis.TabOutChromeTabGroups || {};

const {
  setImageFallbackAttributes: runtimeSetImageFallbackAttributes,
} = globalThis;

const {
  EMPTY_META: runtimeEmptyChromeImportedMeta = { entries: [] },
  normalizeChromeImportedGroupMeta,
  reconcileChromeTabGroupImports,
} = globalThis.TabOutChromeTabGroupImport || {};

const {
  reorderSubsetByIds,
} = globalThis.TabOutListOrder || {};

const {
  compressImageFileForStorage,
} = globalThis.TabOutBackgroundImage || {};

const {
  SEARCH_ENGINE_PRESETS: runtimeSearchEnginePresets,
  buildSearchUrlForQuery: runtimeBuildSearchUrlForQuery,
  getSavedSessionRestoreMode: runtimeGetSavedSessionRestoreMode,
  getSearchEngine: runtimeGetSearchEngine,
} = globalThis.TabOutThemeControls || {};

const SEARCH_ENGINE_LABEL_KEYS = {
  google: 'searchEngineGoogle',
  bing: 'searchEngineBing',
  baidu: 'searchEngineBaidu',
  sogou: 'searchEngineSogou',
  duckduckgo: 'searchEngineDuckDuckGo',
  brave: 'searchEngineBrave',
  yandex: 'searchEngineYandex',
};

const {
  getCanonicalTabUrl: runtimeGetCanonicalTabUrl,
  isRestorableTabUrl: runtimeIsRestorableTabUrl,
  parseSuspendedTabUrl: runtimeParseSuspendedTabUrl,
} = globalThis.TabHarborTabUrlUtils || {};

const {
  matchesHostnameSuffix: runtimeMatchesHostnameSuffix,
  getAutomaticLandingPagePatterns: runtimeGetAutomaticLandingPagePatterns,
  isAutomaticLandingPage: runtimeIsAutomaticLandingPage,
  getAutomaticTabGroupDefinition: runtimeGetAutomaticTabGroupDefinition,
  getAutomaticGroupDisplayTitle: runtimeGetAutomaticGroupDisplayTitle,
  analyzeNativeChromeGroups: runtimeAnalyzeNativeChromeGroups,
  buildAutomaticChromeSyncSnapshot: runtimeBuildAutomaticChromeSyncSnapshot,
  createAutomaticGroupingRuleOverrides: runtimeCreateAutomaticGroupingRuleOverrides,
  normalizeStoredAutomaticGroupingRuleOverrides: runtimeNormalizeStoredAutomaticGroupingRuleOverrides,
} = globalThis.TabHarborAutomaticTabGroups || {};

const {
  addSavedTabSession: runtimeAddSavedTabSession,
  appendSavedTabSessionTabs: runtimeAppendSavedTabSessionTabs,
  buildSessionSnapshot: runtimeBuildSessionSnapshot,
  createRestoredSessionGroups: runtimeCreateRestoredSessionGroups,
  getSavedTabSessions: runtimeGetSavedTabSessions,
} = globalThis.TabHarborTabSessions || {};

/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// Visible open tabs for this dashboard window — populated by fetchOpenTabs()
let openTabs = [];
let allOpenTabIds = [];
let sessionGroupsState = normalizeSessionGroups ? normalizeSessionGroups() : { groups: [], assignments: {} };
const MANUAL_GROUP_PREFIX = '__session_group__:';
const CHROME_GROUP_PREFIX = '__chrome_group__:';
// Chrome tab group color names → dashboard accent colors (used to tint the
// card name and the tab rows' drag handles of user-created Chrome group cards).
const CHROME_GROUP_COLOR_MAP = {
  grey: '#8f9a9f',
  blue: '#5b8def',
  red: '#d98080',
  yellow: '#d9b45b',
  green: '#7ba05b',
  pink: '#cf7a9e',
  purple: '#9a7acf',
  cyan: '#5ba8b3',
  orange: '#d98a4b',
};
const PAGE_CHIP_DRAG_DEBUG = false;
const PAGE_CHIP_EDGE_SCROLL_ZONE = 64;
const PAGE_CHIP_EDGE_SCROLL_SPEED = 12;
// Merged Chrome groups cycle through the accent palette instead of always
// landing on the first color (grey). Starts past grey so the FIRST merge is
// already visibly colored, then rotates through red/green/pink/...
let chromeGroupMergeColorIndex = 1;
const SESSION_GROUPS_KEY = 'sessionGroups';
const IMPORTED_CHROME_GROUPS_KEY = 'importedChromeSessionGroups';
let groupOrderState = normalizeGroupOrderState ? normalizeGroupOrderState() : { sessionOrder: [], pinnedOrder: [], pinEnabled: false };
const GROUP_ORDER_KEY = 'groupOrder';
let groupTabOrderState = {};
const GROUP_TAB_ORDER_KEY = 'groupTabOrder';
let groupLabelOverrides = {};
const GROUP_LABEL_OVERRIDES_KEY = 'groupLabelOverrides';
const AUTOMATIC_GROUPING_RULE_OVERRIDES_KEY = 'automaticTabGroupRuleOverrides';
let automaticGroupingRuleOverridesPublished = false;
let groupRenameEditorState = null;
let draggedGroupId = '';
let dragStartPoint = null;
let suppressJumpUntil = 0;
let suppressPageChipClickUntil = 0;
// Handle-click selection: clicking a row's drag handle toggles it into the
// selection; dragging a selected row then reorders the whole selection
// together within its group.
let selectedPageChipIds = new Set();
// Cards whose "+N more" overflow rows were expanded. Kept for the session so
// re-renders after a drag (or any other refresh) do not silently re-collapse
// the rows the user opened.
let expandedPageChipGroupKeys = new Set();
// Last toggled/selected row id — the anchor for Shift+click / Shift+Space
// range selection within the same card.
let pageChipSelectionAnchorId = '';
// Suppresses the synthesized click (detail 0 on some touch/pen devices) that
// follows a pointerup toggle, so a tap does not toggle the row twice.
let pageChipPointerToggleGuard = { key: '', until: 0 };
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
let pageChipNewGroupSlotEl = null;
let pageChipAutoScrollRaf = 0;
let pageChipCommitInFlight = false;
let batchActionInFlight = false;
// Card-level (per-domain / section-header) actions run without the batch
// bar's begin/finish wrapper, so they get their own re-entrancy guard:
// double-clicks or rapid keyboard activation must not run the same
// side-effecting action twice (merge would re-create the group).
let cardActionInFlight = false;
let tabSessionPickerState = {
  open: false,
  mode: 'new',
  source: 'current-window',
  selectedTabIds: [],
  newSessionName: '',
  targetSessionId: '',
  windowId: null,
  groups: [],
  savedSessions: [],
};
let chromeTabGroupsEnabled = false;
let chromeTabGroupLiveState = { sessionMap: {}, nativeGroups: [] };
let chromeTabGroupSnapshotAuthoritative = false;
let chromeTabGroupSyncGroups = null;
let chromeTabGroupPreserveKeys = [];
let chromeTabGroupConflicts = [];
let chromeGroupMergeDialogState = null;
let sleepControlEnabled = false;
let importedChromeGroupMeta = normalizeChromeImportedGroupMeta
  ? normalizeChromeImportedGroupMeta(runtimeEmptyChromeImportedMeta)
  : { entries: [] };
let chromeTabGroupsImportTimer = null;
let chromeTabGroupsUnsubscribe = null;
let chromeTabGroupsImportInFlight = false;
let suppressChromeTabGroupsImportUntil = 0;
const CHROME_TAB_GROUP_CLEANUP_RETRY_DELAYS_MS = [1000, 5000, 30000, 120000];
let chromeTabGroupCleanupRetryTimer = null;
let chromeTabGroupCleanupRetryAttempt = 0;
let chromeTabGroupCleanupInFlight = null;
// Search-field suggestion panel state. openSuggestions tracks visibility;
// suggestionHistoryCache debounces chrome.history lookups while the panel is
// open so we never query on every keystroke.
let searchSuggestionsOpen = false;
let searchSuggestionsQuery = '';
let searchSuggestionsSelectedIndex = -1;
let searchSuggestionsRows = [];
let searchSuggestionsHistoryCache = null;
let searchSuggestionsHistoryCacheTime = 0;
let searchSuggestionsDebounceTimer = null;
let searchSuggestionsFocusGuardUntil = 0;
// True while the input method editor is composing a candidate in the search
// field (compositionstart fired, compositionend not yet). Enter during
// composition confirms the IME candidate and must not submit the search.
let searchSuggestionsIsComposing = false;
// True while the Enter keydown handler has already started the search
// navigation, so the following form submit does not run it a second time.
let searchSubmitInFlight = false;
// Incremented whenever the suggestion panel is invalidated (search submit,
// outside click, Escape). In-flight refreshSearchSuggestions calls compare
// their captured generation against this and discard stale results, so their
// chrome.* calls never contend with a navigation's chrome.* calls.
let searchSuggestionsGeneration = 0;
let bookmarksShelfController = null;
let currentDashboardTabId = null;
let currentDashboardWindowId = null;
let dashboardStartupTabChangeIgnoreUntil = 0;
let tabDrivenDashboardRefreshRunning = false;
let tabDrivenDashboardRefreshDirty = false;
let tabDrivenDashboardRefreshDelayMs = 300;
let tabChangeListenerAttached = false;
const ENTRY_ANIMATIONS_CLASS = 'entry-animations-enabled';
let entryAnimationsTimer = null;
const CHROME_TAB_GROUPS_DEBUG_KEY = 'chromeTabGroupsDebug';
const HITOKOTO_CACHE_KEY = 'hitokotoCache';
const HITOKOTO_CACHE_LIMIT = 5;
const hitokotoPageState = {
  entry: null,
  locked: false,
  rendered: false,
  warmPromise: null,
};

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

function normalizeGroupLabelOverrides(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  return Object.fromEntries(
    Object.entries(input)
      .map(([groupKey, label]) => [String(groupKey), String(label || '').trim()])
      .filter(([, label]) => Boolean(label))
  );
}

function getTabOrderTokens(tab) {
  const tokens = [];
  if (tab?.id != null) tokens.push(String(tab.id));
  if (tab?.url) tokens.push(String(tab.url));
  return [...new Set(tokens.filter(Boolean))];
}

function getPrimaryTabOrderToken(tab) {
  return getTabOrderTokens(tab)[0] || '';
}

function pruneGroupTabOrderState(state, groups = []) {
  const normalized = normalizeGroupTabOrderState(state);
  const groupMap = new Map(
    groups.map(group => [
      String(group.domain),
      new Set(
        (group.tabs || [])
          .flatMap(tab => getTabOrderTokens(tab))
          .filter(Boolean)
      ),
    ])
  );

  return Object.fromEntries(
    Object.entries(normalized)
      .map(([groupKey, orderIds]) => {
        const validTokens = groupMap.get(String(groupKey));
        if (!validTokens) return null;
        const filtered = orderIds.filter(token => validTokens.has(token));
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

async function loadGroupLabelOverrides() {
  const stored = await chrome.storage.local.get(GROUP_LABEL_OVERRIDES_KEY);
  groupLabelOverrides = normalizeGroupLabelOverrides(stored[GROUP_LABEL_OVERRIDES_KEY]);
  return groupLabelOverrides;
}

async function saveGroupLabelOverrides(nextState) {
  groupLabelOverrides = normalizeGroupLabelOverrides(nextState);
  await chrome.storage.local.set({ [GROUP_LABEL_OVERRIDES_KEY]: groupLabelOverrides });
  return groupLabelOverrides;
}

function reorderGroupTabsByStoredUrls(tabs, groupKey) {
  const orderIds = groupTabOrderState[String(groupKey)] || [];
  if (!Array.isArray(tabs) || !tabs.length || !orderIds.length) return Array.isArray(tabs) ? tabs.slice() : [];

  const orderIndex = new Map(orderIds.map((id, index) => [String(id), index]));
  return tabs
    .map((tab, originalIndex) => {
      const match = getTabOrderTokens(tab)
        .map(token => orderIndex.get(token))
        .find(index => Number.isInteger(index));
      return {
        tab,
        originalIndex,
        order: Number.isInteger(match) ? match : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.order - b.order || a.originalIndex - b.originalIndex)
    .map(entry => entry.tab);
}

function getOrderedUniqueTabsForGroup(group) {
  const tabs = Array.isArray(group?.tabs) ? group.tabs : [];
  // User-created Chrome group cards always follow the native strip order
  // (tabs come from queryUserChromeGroups, already strip-ordered). Applying
  // the dashboard's stored tab order would keep a stale snapshot after the
  // user reorders the group in the browser (C22).
  if (group?.isChromeGroup) return tabs.slice();
  return reorderGroupTabsByStoredUrls(tabs, group?.domain);
}

function getTabsOrderedForChromeSync(group) {
  const tabs = Array.isArray(group?.tabs) ? group.tabs : [];
  const orderIds = groupTabOrderState[String(group?.domain)] || [];
  if (!orderIds.length) return tabs.slice();

  const orderIndex = new Map(orderIds.map((id, index) => [String(id), index]));
  return tabs
    .map((tab, originalIndex) => ({
      tab,
      originalIndex,
      order: (() => {
        const match = getTabOrderTokens(tab)
          .map(token => orderIndex.get(token))
          .find(index => Number.isInteger(index));
        return Number.isInteger(match) ? match : Number.MAX_SAFE_INTEGER;
      })(),
    }))
    .sort((a, b) => a.order - b.order || a.originalIndex - b.originalIndex)
    .map(entry => entry.tab);
}

function getChromeSyncGroups(groups = domainGroups) {
  const source = Array.isArray(chromeTabGroupSyncGroups)
    ? chromeTabGroupSyncGroups
    : (Array.isArray(groups) ? groups : []);
  return source.map(group => Array.isArray(group?.tabIds)
    ? { ...group, tabIds: group.tabIds.slice() }
    : { ...group, tabs: getTabsOrderedForChromeSync(group) });
}

async function sendChromeTabGroupRequest(action, payload = {}) {
  if (!chrome.runtime?.sendMessage) {
    return { ok: false, error: { code: 'API_UNAVAILABLE', message: 'Runtime messaging is unavailable' } };
  }
  try {
    return await chrome.runtime.sendMessage({
      action,
      source: 'dashboard',
      payload,
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) recoverFromInvalidatedExtensionContext();
    return {
      ok: false,
      error: {
        code: 'MESSAGE_FAILED',
        message: error?.message || String(error || 'Chrome tab-group request failed'),
      },
    };
  }
}

async function performChromeGroupMutation(operation, payload = {}) {
  const response = await sendChromeTabGroupRequest('merge-chrome-tab-groups', {
    ...payload,
    operation,
  });
  if (!response?.ok) {
    const error = new Error(response?.error?.message || 'Chrome tab-group operation failed');
    error.code = response?.error?.code || 'CHROME_GROUP_OPERATION_FAILED';
    error.details = response?.error?.details;
    throw error;
  }
  applyChromeTabGroupResponseState(response);
  return response;
}

async function getWindowIdForChromeGroupTabs(tabIds = []) {
  for (const rawTabId of tabIds || []) {
    const tabId = Number(rawTabId);
    if (!Number.isInteger(tabId)) continue;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (Number.isInteger(Number(tab?.windowId))) return Number(tab.windowId);
    } catch { /* stale id: try the next one */ }
  }
  const dashboardWindowId = await getDashboardWindowIdForOpenTabs();
  return dashboardWindowId == null ? null : Number(dashboardWindowId);
}

function applyChromeTabGroupResponseState(response) {
  const state = response?.state;
  if (!state || typeof state !== 'object') return;
  chromeTabGroupLiveState = {
    sessionMap: state.sessionMap || state.mapping || {},
    nativeGroups: Array.isArray(state.nativeGroups)
      ? state.nativeGroups
      : Array.isArray(state.liveGroups)
        ? state.liveGroups
        : [],
  };
}

function applyChromeTabGroupResponseConflicts(response) {
  if (!response?.state || !Array.isArray(response?.conflicts)) return false;
  const backgroundConflicts = (Array.isArray(response?.conflicts) ? response.conflicts : [])
    .filter(conflict => conflict?.reason === 'multiple-candidates' && conflict.groupKey)
    .map(conflict => ({
      ...conflict,
      title: getAutomaticGroupDisplayTitle({ groupKey: String(conflict.groupKey) }),
    }));
  const signature = conflicts => JSON.stringify(conflicts.map(conflict => ({
    groupKey: String(conflict.groupKey || ''),
    candidates: (conflict.candidates || []).map(candidate => ({
      groupId: Number(candidate.id ?? candidate.groupId),
      title: String(candidate.title || ''),
      color: String(candidate.color || ''),
      tabIds: (candidate.tabIds || []).map(Number),
    })),
  })));
  const changed = signature(backgroundConflicts) !== signature(chromeTabGroupConflicts);
  chromeTabGroupConflicts = backgroundConflicts;
  return changed;
}

function hasCreatedChromeTabGroupMappings(state = chromeTabGroupLiveState) {
  const sessionMap = state?.sessionMap;
  if (!sessionMap || typeof sessionMap !== 'object') return false;
  return Object.values(sessionMap).some(windowMap =>
    windowMap && typeof windowMap === 'object' &&
      Object.values(windowMap).some(entry => entry?.origin === 'created')
  );
}

function clearChromeTabGroupCleanupRetry() {
  if (chromeTabGroupCleanupRetryTimer) clearTimeout(chromeTabGroupCleanupRetryTimer);
  chromeTabGroupCleanupRetryTimer = null;
  chromeTabGroupCleanupRetryAttempt = 0;
}

function scheduleChromeTabGroupCleanupRetry() {
  if (chromeTabGroupsEnabled || chromeTabGroupCleanupRetryTimer) return;
  const delayIndex = Math.min(
    chromeTabGroupCleanupRetryAttempt,
    CHROME_TAB_GROUP_CLEANUP_RETRY_DELAYS_MS.length - 1,
  );
  const delay = CHROME_TAB_GROUP_CLEANUP_RETRY_DELAYS_MS[delayIndex];
  chromeTabGroupCleanupRetryAttempt += 1;
  chromeTabGroupCleanupRetryTimer = setTimeout(() => {
    chromeTabGroupCleanupRetryTimer = null;
    void requestChromeTabGroupCleanup();
  }, delay);
}

async function requestChromeTabGroupCleanup() {
  if (chromeTabGroupsEnabled) {
    clearChromeTabGroupCleanupRetry();
    return { ok: false, error: { code: 'SYNC_REENABLED', message: 'Chrome tab-group sync is enabled' } };
  }
  if (chromeTabGroupCleanupInFlight) return chromeTabGroupCleanupInFlight;

  chromeTabGroupCleanupInFlight = (async () => {
    const response = await syncChromeTabGroupsWithoutImportEcho();
    if (response?.ok) clearChromeTabGroupCleanupRetry();
    else scheduleChromeTabGroupCleanupRetry();
    return response;
  })().finally(() => {
    chromeTabGroupCleanupInFlight = null;
  });
  return chromeTabGroupCleanupInFlight;
}

async function loadChromeTabGroupLiveState(windowId) {
  const response = await sendChromeTabGroupRequest('get-chrome-tab-group-state', { windowId });
  if (response?.ok) applyChromeTabGroupResponseState(response);
  return response;
}

const TAB_HARBOR_BASE_LANDING_PAGE_PATTERNS = [
  { hostname: 'mail.google.com', test: (p, h) =>
      !h.includes('#inbox') && !h.includes('#sent') && !h.includes('#search/') },
  { hostname: 'x.com', pathExact: ['/home'] },
  { hostname: 'www.linkedin.com', pathExact: ['/'] },
  { hostname: 'github.com', pathExact: ['/'] },
  { hostname: 'www.youtube.com', pathExact: ['/'] },
];

function matchesAutomaticHostnameSuffix(hostname = '', suffix = '') {
  if (typeof runtimeMatchesHostnameSuffix === 'function') {
    return runtimeMatchesHostnameSuffix(hostname, suffix);
  }
  const normalizedHostname = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
  const normalizedSuffix = String(suffix || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '');
  if (!normalizedHostname || !normalizedSuffix) return false;
  return normalizedHostname === normalizedSuffix ||
    normalizedHostname.endsWith(`.${normalizedSuffix}`);
}

function getAutomaticLandingPagePatterns() {
  const localPatterns = typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' && Array.isArray(LOCAL_LANDING_PAGE_PATTERNS)
    ? LOCAL_LANDING_PAGE_PATTERNS
    : [];
  if (typeof runtimeGetAutomaticLandingPagePatterns === 'function') {
    return runtimeGetAutomaticLandingPagePatterns(localPatterns);
  }
  return [...TAB_HARBOR_BASE_LANDING_PAGE_PATTERNS, ...localPatterns];
}

async function publishAutomaticGroupingRuleOverrides() {
  if (typeof runtimeCreateAutomaticGroupingRuleOverrides !== 'function' ||
      typeof runtimeNormalizeStoredAutomaticGroupingRuleOverrides !== 'function') {
    return false;
  }

  const nextSnapshot = runtimeCreateAutomaticGroupingRuleOverrides({
    landingPagePatterns: typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' && Array.isArray(LOCAL_LANDING_PAGE_PATTERNS)
      ? LOCAL_LANDING_PAGE_PATTERNS
      : [],
    customGroups: typeof LOCAL_CUSTOM_GROUPS !== 'undefined' && Array.isArray(LOCAL_CUSTOM_GROUPS)
      ? LOCAL_CUSTOM_GROUPS
      : [],
  });

  try {
    const stored = await chrome.storage.local.get(AUTOMATIC_GROUPING_RULE_OVERRIDES_KEY);
    const currentSnapshot = runtimeNormalizeStoredAutomaticGroupingRuleOverrides(
      stored?.[AUTOMATIC_GROUPING_RULE_OVERRIDES_KEY],
    );
    if (JSON.stringify(currentSnapshot) !== JSON.stringify(nextSnapshot)) {
      await chrome.storage.local.set({
        [AUTOMATIC_GROUPING_RULE_OVERRIDES_KEY]: nextSnapshot,
      });
    }
    return true;
  } catch (error) {
    console.warn(
      '[tab-harbor] Could not publish local grouping rules; native group sync is paused:',
      error?.message || error,
    );
    return false;
  }
}

function isAutomaticLandingPage(url = '') {
  if (typeof runtimeIsAutomaticLandingPage === 'function') {
    return runtimeIsAutomaticLandingPage(url, getAutomaticLandingPagePatterns());
  }
  try {
    const parsed = new URL(url);
    return getAutomaticLandingPagePatterns().some(pattern => {
      const hostnameMatch = pattern.hostname
        ? parsed.hostname === pattern.hostname
        : pattern.hostnameEndsWith
          ? matchesAutomaticHostnameSuffix(parsed.hostname, pattern.hostnameEndsWith)
          : false;
      if (!hostnameMatch) return false;
      if (pattern.test) return pattern.test(parsed.pathname, url);
      if (pattern.pathPrefix) return parsed.pathname.startsWith(pattern.pathPrefix);
      if (pattern.pathExact) return pattern.pathExact.includes(parsed.pathname);
      return parsed.pathname === '/';
    });
  } catch {
    return false;
  }
}

function getAutomaticTabGroupDefinition(tab = {}) {
  if (typeof runtimeGetAutomaticTabGroupDefinition === 'function') {
    return runtimeGetAutomaticTabGroupDefinition(tab, {
      landingPagePatterns: typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' && Array.isArray(LOCAL_LANDING_PAGE_PATTERNS)
        ? LOCAL_LANDING_PAGE_PATTERNS
        : [],
      customGroups: typeof LOCAL_CUSTOM_GROUPS !== 'undefined' && Array.isArray(LOCAL_CUSTOM_GROUPS)
        ? LOCAL_CUSTOM_GROUPS
        : [],
    });
  }
  const url = String(tab.url || '');
  if (!url) return null;
  if (isAutomaticLandingPage(url)) {
    return { groupKey: '__landing-pages__', label: '' };
  }

  try {
    const parsed = new URL(url);
    const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' && Array.isArray(LOCAL_CUSTOM_GROUPS)
      ? LOCAL_CUSTOM_GROUPS
      : [];
    const customRule = customGroups.find(rule => {
      const hostMatch = rule.hostname
        ? parsed.hostname === rule.hostname
        : rule.hostnameEndsWith
          ? matchesAutomaticHostnameSuffix(parsed.hostname, rule.hostnameEndsWith)
          : false;
      if (!hostMatch) return false;
      return rule.pathPrefix ? parsed.pathname.startsWith(rule.pathPrefix) : true;
    });
    if (customRule?.groupKey) {
      return { groupKey: String(customRule.groupKey), label: String(customRule.groupLabel || '') };
    }
    if (parsed.protocol === 'file:') {
      return { groupKey: 'local-files', label: '' };
    }
    const hostname = runtimeGetPrimaryDomain ? runtimeGetPrimaryDomain(parsed.hostname) : parsed.hostname;
    return hostname ? { groupKey: hostname, label: '' } : null;
  } catch {
    return null;
  }
}

function getAutomaticGroupDisplayTitle(definition = {}) {
  if (typeof runtimeGetAutomaticGroupDisplayTitle === 'function') {
    return runtimeGetAutomaticGroupDisplayTitle(definition, {
      labelOverrides: groupLabelOverrides,
      homepagesLabel: runtimeT ? runtimeT('homepagesLabel') : 'Homepages',
    });
  }
  const groupKey = String(definition.groupKey || '');
  if (!groupKey) return '';
  if (groupLabelOverrides[groupKey]) return String(groupLabelOverrides[groupKey]).trim();
  if (definition.label) return String(definition.label).trim();
  if (groupKey === '__landing-pages__') {
    return runtimeT ? runtimeT('homepagesLabel') : 'Homepages';
  }
  return String(friendlyDomain(groupKey) || groupKey).trim();
}

function getNativeChromeGroupAnalysis(nativeGroups = [], tabs = [], windowId = null) {
  if (typeof runtimeAnalyzeNativeChromeGroups === 'function') {
    return runtimeAnalyzeNativeChromeGroups({
      nativeGroups,
      tabs,
      windowId,
      labelOverrides: groupLabelOverrides,
      landingPagePatterns: typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' && Array.isArray(LOCAL_LANDING_PAGE_PATTERNS)
        ? LOCAL_LANDING_PAGE_PATTERNS
        : [],
      customGroups: typeof LOCAL_CUSTOM_GROUPS !== 'undefined' && Array.isArray(LOCAL_CUSTOM_GROUPS)
        ? LOCAL_CUSTOM_GROUPS
        : [],
      sessionGroups: sessionGroupsState,
      homepagesLabel: runtimeT ? runtimeT('homepagesLabel') : 'Homepages',
    });
  }
  const tabById = new Map((tabs || []).map(tab => [Number(tab.id), tab]));
  const mappedGroupIds = new Set();
  const mappedKeysByGroupId = new Map();
  const rawMappedKeysByGroupId = new Map();
  const reconcilableCreatedGroupIds = new Set();
  const unsafeMappedGroupKeys = new Set();
  const candidatesByKey = new Map();
  const sessionAssignments = sessionGroupsState?.assignments || {};

  for (const group of nativeGroups || []) {
    if (windowId != null && Number(group.windowId) !== Number(windowId)) continue;
    const groupId = Number(group.id ?? group.groupId);
    const mappings = (Array.isArray(group.mappings) ? group.mappings : [])
      .filter(mapping => mapping?.groupKey);
    for (const mapping of mappings) {
      if (!mapping?.groupKey) continue;
      rawMappedKeysByGroupId.set(groupId, String(mapping.groupKey));
    }

    const readable = !group.shared && group.queryComplete !== false &&
      Array.isArray(group.tabIds) && group.tabIds.length > 0;
    const definitions = readable
      ? group.tabIds.map(tabId => getAutomaticTabGroupDefinition(tabById.get(Number(tabId))))
      : [];
    const pureDefinition = definitions.length > 0 && definitions.every(definition => definition) &&
      definitions.every(definition => definition.groupKey === definitions[0].groupKey)
      ? definitions[0]
      : null;
    const logicalKey = String(pureDefinition?.groupKey || '');
    const displayTitle = pureDefinition ? getAutomaticGroupDisplayTitle(pureDefinition) : '';

    let safeMapping = null;
    if (mappings.length === 1) {
      const mapping = mappings[0];
      const mappingKey = String(mapping.groupKey);
      const titleMatches = String(group.title || '') === displayTitle;
      const hasManualAssignments = group.tabIds.some(tabId =>
        Boolean(sessionAssignments[String(tabId)])
      );
      const canReconcileCreatedMapping = mapping.origin === 'created' &&
        readable && definitions.length > 0 && definitions.every(Boolean) &&
        !hasManualAssignments;
      if (canReconcileCreatedMapping) {
        reconcilableCreatedGroupIds.add(groupId);
      }
      const safe = readable && logicalKey === mappingKey &&
        (mapping.origin === 'created' || titleMatches);
      if (safe) {
        safeMapping = mapping;
        mappedGroupIds.add(groupId);
        mappedKeysByGroupId.set(groupId, mappingKey);
      } else {
        unsafeMappedGroupKeys.add(mappingKey);
      }
    } else if (mappings.length > 1) {
      mappings.forEach(mapping => unsafeMappedGroupKeys.add(String(mapping.groupKey)));
    }

    // An unsafe mapping remains visible as a native card and is frozen by the
    // coordinator; never reinterpret it as a fresh candidate in the same
    // render pass.
    if (!pureDefinition || (mappings.length > 0 && !safeMapping)) continue;
    const titleMatches = String(group.title || '') === displayTitle;
    if (!titleMatches && safeMapping?.origin !== 'created') continue;
    const groupKey = logicalKey;
    const candidate = { ...group, groupKey, displayTitle };
    if (!candidatesByKey.has(groupKey)) candidatesByKey.set(groupKey, []);
    candidatesByKey.get(groupKey).push(candidate);
  }

  const uniqueCandidateGroupIds = new Set();
  const allCandidateGroupIds = new Set();
  const candidateKeysByGroupId = new Map();
  const conflicts = [];
  for (const [groupKey, candidates] of candidatesByKey.entries()) {
    candidates.sort((left, right) => Number(left.minIndex ?? Number.MAX_SAFE_INTEGER) - Number(right.minIndex ?? Number.MAX_SAFE_INTEGER));
    for (const candidate of candidates) {
      const groupId = Number(candidate.id ?? candidate.groupId);
      allCandidateGroupIds.add(groupId);
      candidateKeysByGroupId.set(groupId, groupKey);
    }
    if (candidates.length === 1) {
      uniqueCandidateGroupIds.add(Number(candidates[0].id ?? candidates[0].groupId));
    } else if (candidates.length > 1) {
      conflicts.push({
        groupKey,
        reason: 'multiple-candidates',
        title: candidates[0].displayTitle || getAutomaticGroupDisplayTitle({ groupKey }),
        candidates,
      });
    }
  }

  return {
    mappedGroupIds,
    mappedKeysByGroupId,
    rawMappedKeysByGroupId,
    reconcilableCreatedGroupIds,
    unsafeMappedGroupKeys,
    candidatesByKey,
    candidateKeysByGroupId,
    uniqueCandidateGroupIds,
    allCandidateGroupIds,
    conflicts,
  };
}

function isManualGroupKey(groupKey = '') {
  return String(groupKey || '').startsWith(MANUAL_GROUP_PREFIX);
}

function getManualGroupIdFromGroupKey(groupKey = '') {
  return isManualGroupKey(groupKey) ? String(groupKey).slice(MANUAL_GROUP_PREFIX.length) : '';
}

function getDomainGroupByKey(groupKey = '') {
  return domainGroups.find(group => String(group?.domain) === String(groupKey)) || null;
}

function getGroupDisplayLabel(group) {
  if (!group) return 'Group';
  if (group.domain === '__landing-pages__') {
    return groupLabelOverrides[group.domain] || (runtimeT ? runtimeT('homepagesLabel') : 'Homepages');
  }
  return String(groupLabelOverrides[group.domain] || group.label || friendlyDomain(group.domain) || 'Group').trim() || 'Group';
}

function createUniqueSessionGroupName(baseName, groups = sessionGroupsState.groups, excludeGroupId = '') {
  const fallbackName = String(baseName || 'Group').trim() || 'Group';
  const lowerFallback = fallbackName.toLowerCase();
  const takenNames = new Set(
    (groups || [])
      .filter(group => group && String(group.id || '') !== String(excludeGroupId || ''))
      .map(group => String(group.name || '').trim().toLowerCase())
      .filter(Boolean)
  );

  if (!takenNames.has(lowerFallback)) return fallbackName;

  let suffix = 2;
  while (takenNames.has(`${lowerFallback} ${suffix}`)) suffix += 1;
  return `${fallbackName} ${suffix}`;
}

function openGroupRenameEditor(groupKey, manualGroupId = '') {
  const group = getDomainGroupByKey(groupKey);
  if (!group) return;
  groupRenameEditorState = {
    groupKey: String(groupKey || ''),
    manualGroupId: String(manualGroupId || ''),
    value: getGroupDisplayLabel(group),
    shouldFocus: true,
  };
  void renderDashboard();
}

function closeGroupRenameEditor() {
  groupRenameEditorState = null;
}

async function submitGroupRenameEditor() {
  if (!groupRenameEditorState) return;

  const { groupKey, manualGroupId } = groupRenameEditorState;
  const group = getDomainGroupByKey(groupKey);
  if (!group) {
    closeGroupRenameEditor();
    return;
  }

  const currentLabel = getGroupDisplayLabel(group);
  const cleanName = String(groupRenameEditorState.value || '').trim();
  if (!cleanName || cleanName === currentLabel) {
    closeGroupRenameEditor();
    await renderDashboard();
    return;
  }

  try {
    if (group.isChromeGroup && group.chromeGroupId != null) {
      // Native group writes are serialized by the background coordinator.
      const windowId = await getWindowIdForChromeGroupTabs((group.tabs || []).map(tab => tab.id));
      if (windowId == null) throw new Error('Chrome group window is unavailable');
      await performChromeGroupMutation('update', {
        windowId,
        targetGroupId: Number(group.chromeGroupId),
        changes: { title: cleanName },
      });
    } else if (manualGroupId) {
      const nextState = renameSessionGroup(sessionGroupsState, manualGroupId, cleanName);
      await saveSessionGroups(nextState);
    } else {
      await saveGroupLabelOverrides({
        ...groupLabelOverrides,
        [groupKey]: cleanName,
      });
    }
    closeGroupRenameEditor();
    await renderDashboard();
    showToast(runtimeT ? runtimeT('toastRenamedGroup', { name: cleanName }) : `Renamed to ${cleanName}`);
  } catch (err) {
    showToast(err.message || (runtimeT ? runtimeT('toastCouldNotCreateGroup') : 'Could not create group'));
  }
}

function deriveDraggedTabGroupName(tab) {
  const rawTitle = cleanTitle(
    smartTitle(stripTitleNoise(tab?.title || ''), tab?.url || ''),
    tab?.url || ''
  );
  const title = String(rawTitle || '').trim();
  if (title) return title;

  try {
    const parsed = new URL(String(tab?.url || ''));
    return friendlyDomain(parsed.hostname || parsed.host || parsed.href || 'Group');
  } catch {
    return 'Group';
  }
}

function getTabIdsForGroupChip(groupKey, chipSortId) {
  const group = getDomainGroupByKey(groupKey);
  if (!group) return [];

  return (group.tabs || [])
    .filter(tab => getTabOrderTokens(tab).includes(String(chipSortId || '')))
    .map(tab => Number(tab?.id))
    .filter(Number.isFinite);
}

/**
 * findGroupKeyForChip(chipId)
 *
 * Locates the domain group that currently owns a chip's tabs, so a drag
 * selection spanning several cards can move every selected row from its own
 * source group into the target.
 */
function findGroupKeyForChip(chipId) {
  const key = String(chipId || '');
  if (!key) return '';
  for (const group of domainGroups) {
    if ((group.tabs || []).some(tab => getTabOrderTokens(tab).includes(key))) {
      return String(group.domain || '');
    }
  }
  return '';
}

/**
 * orderChipIdsByDom(ids)
 *
 * Returns the given chip ids ordered by their current visual (DOM) position,
 * card by card. Same-group reorders and cross-group moves then share the same
 * "visual order" semantics for a batch (a batch never flips the order the user
 * sees, regardless of the order rows were toggled).
 */
function orderChipIdsByDom(ids) {
  const set = new Set((ids || []).map(String).filter(Boolean));
  if (!set.size) return [];
  const ordered = [];
  const seen = new Set();
  document.querySelectorAll('.mission-card').forEach(card => {
    card.querySelectorAll('.page-chip[data-chip-sort-id]').forEach(row => {
      const id = String(row.dataset.chipSortId || '');
      if (set.has(id) && !seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    });
  });
  // Ids with no rendered row (rare) keep their original relative order at the end.
  for (const id of set) {
    if (!seen.has(id)) ordered.push(id);
  }
  return ordered;
}

/**
 * getMovingPageChipIds()
 *
 * The chips participating in the current drag: the whole highlight-only
 * selection when the dragged row is part of it, otherwise just the dragged
 * row. Same-group reorders and cross-group moves all use this set, always in
 * visual (DOM) order.
 */
function getMovingPageChipIds() {
  const draggedChipId = String(draggedPageChipId || '');
  // Prefer the snapshot captured when the drag armed — the selection must
  // not change mid-drag, so commit-time logic uses the same set throughout.
  let ids;
  if (pageChipDragState?.movingChipIds?.length) {
    ids = [...pageChipDragState.movingChipIds];
  } else if (selectedPageChipIds.size > 0 && selectedPageChipIds.has(draggedChipId)) {
    ids = [...selectedPageChipIds].map(String).filter(Boolean);
  } else {
    ids = [draggedChipId].filter(Boolean);
  }
  return orderChipIdsByDom(ids);
}

/**
 * collectMovingTabIds(movingChipIds, fallbackGroupKey)
 *
 * Returns { tabIds, groupsById } for every moving chip, resolving each chip's
 * own source group (chips from other cards are collected from their cards).
 */
function collectMovingTabIds(movingChipIds, fallbackGroupKey = '') {
  const tabIds = [];
  const groupsById = {};
  for (const chipId of movingChipIds) {
    const chipGroupKey = findGroupKeyForChip(chipId) || String(fallbackGroupKey || '');
    if (!chipGroupKey) continue;
    groupsById[chipGroupKey] = groupsById[chipGroupKey] || new Set();
    groupsById[chipGroupKey].add(String(chipId));
    tabIds.push(...getTabIdsForGroupChip(chipGroupKey, chipId));
  }
  return { tabIds, groupsById };
}

function getOrderedIdsForGroup(groupKey) {
  const group = getDomainGroupByKey(groupKey);
  return getOrderedUniqueTabsForGroup(group).map(tab => getPrimaryTabOrderToken(tab)).filter(Boolean);
}

function buildOrderedIdsFromList(listEl, draggedId) {
  if (!listEl) return [];

  return [...listEl.children]
    .map(node => {
      if (node === pageChipPlaceholderEl) return String(draggedId || '');
      return node.dataset?.chipSortId || '';
    })
    .filter(Boolean);
}

/**
 * buildBatchOrderedIdsFromList(listEl, movingIds)
 *
 * Rebuilds the list order with every moving chip placed consecutively at the
 * placeholder (drop) position, preserving their relative order.
 */
function buildBatchOrderedIdsFromList(listEl, movingIds) {
  if (!listEl) return [];
  const movingSet = new Set((movingIds || []).map(String).filter(Boolean));
  const children = [...listEl.children];
  const rest = [];
  const moving = [];
  for (const node of children) {
    if (node === pageChipPlaceholderEl) continue;
    const id = node.dataset?.chipSortId || '';
    if (id && movingSet.has(id)) moving.push(id);
    else if (id) rest.push(id);
  }
  const placeholderIdx = children.findIndex(node => node === pageChipPlaceholderEl);
  // Count only id-bearing nodes that will stay in the final order, so non-chip
  // children (e.g. the overflow "+N more" row) cannot skew the insert index.
  const dropPos = placeholderIdx === -1
    ? rest.length
    : children.slice(0, placeholderIdx)
        .filter(n => n !== pageChipPlaceholderEl && rest.includes(String(n.dataset?.chipSortId || '')))
        .length;
  rest.splice(dropPos, 0, ...moving);
  return rest;
}

function logPageChipDragDebug(stage, details = {}) {
  if (!PAGE_CHIP_DRAG_DEBUG) return;

  const payload = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  void (payload ? `${stage} ${payload}` : stage);
}

function clearPageChipDropPreview() {
  document.querySelectorAll('.mission-card.is-drop-target').forEach(card => {
    card.classList.remove('is-drop-target');
  });
  document.body.classList.remove('page-chip-drop-new-group');
  pageChipNewGroupSlotEl?.remove();
  pageChipNewGroupSlotEl = null;
}

function setPageChipDropPreview(cardEl, {
  createNewGroup = false,
  newGroupPlacement = 'after',
  insertBeforeCardEl = null,
} = {}) {
  clearPageChipDropPreview();
  if (cardEl) cardEl.classList.add('is-drop-target');
  if (createNewGroup) {
    document.body.classList.add('page-chip-drop-new-group');
    const missionsEl = document.getElementById('openTabsMissions');
    if (missionsEl) {
      pageChipNewGroupSlotEl = document.createElement('div');
      pageChipNewGroupSlotEl.className = 'mission-drop-new-group-slot';
      pageChipNewGroupSlotEl.innerHTML = '<span class="mission-drop-new-group-line"></span>';
      const firstCard = missionsEl.querySelector('.mission-card');
      if (insertBeforeCardEl) {
        missionsEl.insertBefore(pageChipNewGroupSlotEl, insertBeforeCardEl);
      } else if (newGroupPlacement === 'before' && firstCard) {
        missionsEl.insertBefore(pageChipNewGroupSlotEl, firstCard);
      } else {
        missionsEl.appendChild(pageChipNewGroupSlotEl);
      }
    }
  }
}

function getPageChipDropTarget(clientX, clientY) {
  const missionsEl = document.getElementById('openTabsMissions');
  const missionCards = missionsEl ? [...missionsEl.querySelectorAll('.mission-card')] : [];
  if (!missionsEl || !missionCards.length) return null;

  const firstCardRect = missionCards[0].getBoundingClientRect();
  const lastCardRect = missionCards[missionCards.length - 1].getBoundingClientRect();
  const edgeThreshold = 18;
  const gapThreshold = 24;

  if (clientY <= firstCardRect.top + edgeThreshold) {
    return { kind: 'new-group', placement: 'before', reason: 'top-edge' };
  }

  if (clientY >= lastCardRect.bottom - edgeThreshold) {
    return { kind: 'new-group', placement: 'after', reason: 'bottom-edge' };
  }

  for (let index = 0; index < missionCards.length - 1; index += 1) {
    const currentRect = missionCards[index].getBoundingClientRect();
    const nextCardEl = missionCards[index + 1];
    const nextRect = nextCardEl.getBoundingClientRect();
    const gapTop = currentRect.bottom - gapThreshold;
    const gapBottom = nextRect.top + gapThreshold;
    if (clientY >= gapTop && clientY <= gapBottom) {
      return {
        kind: 'new-group',
        placement: 'before',
        insertBeforeCardEl: nextCardEl,
        reason: 'card-gap',
      };
    }
  }

  for (const cardEl of missionCards) {
    const rect = cardEl.getBoundingClientRect();
    const withinCardY = clientY >= rect.top && clientY <= rect.bottom;
    if (!withinCardY) continue;

    const listEl = cardEl.querySelector('.mission-pages');
    const groupKey = cardEl.dataset?.groupId || '';
    const listRect = listEl?.getBoundingClientRect?.();
    const sourceGroupKey = pageChipDragState?.sourceGroupKey || '';
    const isSourceGroup = groupKey === sourceGroupKey;
    const cardEdgeThreshold = 16;

    if (listEl && groupKey && listRect && isSourceGroup) {
      if (clientY <= listRect.top - cardEdgeThreshold) {
        return { kind: 'new-group', placement: 'before', insertBeforeCardEl: cardEl, reason: 'source-card-top-gap' };
      }
      if (clientY >= listRect.bottom + cardEdgeThreshold) {
        return { kind: 'new-group', placement: 'after', reason: 'source-card-bottom-gap' };
      }
    }

    if (listEl && groupKey) {
      return { kind: 'group', cardEl, listEl, groupKey };
    }
  }

  return null;
}

function reassignTabsToSessionGroup(state, tabIds, groupId) {
  let nextState = state;
  for (const tabId of tabIds) {
    nextState = assignTabToSessionGroup(nextState, tabId, groupId);
  }
  return nextState;
}

function clearTabsFromSessionGroups(state, tabIds) {
  let nextState = state;
  for (const tabId of tabIds) {
    nextState = clearTabSessionGroup(nextState, tabId);
  }
  return nextState;
}

function ensureManualDropGroup(state, targetGroupKey) {
  const targetManualGroupId = getManualGroupIdFromGroupKey(targetGroupKey);
  if (targetManualGroupId) {
    return {
      nextState: state,
      groupId: targetManualGroupId,
      groupName: state.groups.find(group => group.id === targetManualGroupId)?.name || '',
    };
  }

  const targetGroup = getDomainGroupByKey(targetGroupKey);
  if (!targetGroup) throw new Error('Group not found');

  const baseName = getGroupDisplayLabel(targetGroup);
  const nextName = createUniqueSessionGroupName(baseName, state.groups);
  const created = addSessionGroup(state, nextName);
  const targetTabIds = (targetGroup.tabs || [])
    .map(tab => Number(tab?.id))
    .filter(Number.isFinite);

  return {
    nextState: reassignTabsToSessionGroup(created.state, targetTabIds, created.group.id),
    groupId: created.group.id,
    groupName: created.group.name,
  };
}

/* ----------------------------------------------------------------
   Hitokoto helper
   ---------------------------------------------------------------- */

async function fetchHitokoto(timeoutMs = 3000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://v1.hitokoto.cn/', { signal: controller.signal });
    if (!response || !response.ok) return null;
    const data = await response.json();
    return data || null;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeHitokotoEntry(data) {
  if (!data || typeof data !== 'object') return null;
  const hitokoto = String(data.hitokoto || '').trim();
  if (!hitokoto) return null;
  return {
    hitokoto,
    from_who: String(data.from_who || '').trim(),
    from: String(data.from || '').trim(),
  };
}

function getHitokotoCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HITOKOTO_CACHE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeHitokotoEntry).filter(Boolean).slice(0, HITOKOTO_CACHE_LIMIT);
  } catch (_err) {
    return [];
  }
}

function saveHitokotoCache(nextEntries) {
  try {
    const entries = Array.isArray(nextEntries) ? nextEntries : [];
    localStorage.setItem(HITOKOTO_CACHE_KEY, JSON.stringify(entries.slice(0, HITOKOTO_CACHE_LIMIT)));
  } catch (_err) {
    // Cache writes are best-effort; the dashboard should stay usable without them.
  }
}

function addHitokotoToCache(data) {
  const entry = normalizeHitokotoEntry(data);
  if (!entry) return null;
  const existing = getHitokotoCache().filter(item => item.hitokoto !== entry.hitokoto);
  saveHitokotoCache([entry, ...existing]);
  return entry;
}

function setHitokotoContent(textEl, fromEl, data) {
  const entry = normalizeHitokotoEntry(data);
  if (!entry || !textEl || !fromEl) return false;
  textEl.textContent = entry.hitokoto;
  const from = [entry.from_who, entry.from].filter(Boolean).join(' · ');
  fromEl.textContent = from ? ` — ${from}` : '';
  return true;
}

function lockHitokotoForCurrentPage() {
  if (hitokotoPageState.locked) return hitokotoPageState.entry;
  hitokotoPageState.entry = normalizeHitokotoEntry(getHitokotoCache()[0]);
  hitokotoPageState.locked = true;
  return hitokotoPageState.entry;
}

function renderCachedHitokoto(textEl, fromEl) {
  const entry = lockHitokotoForCurrentPage();
  if (!entry) return false;
  if (!hitokotoPageState.rendered) {
    hitokotoPageState.rendered = setHitokotoContent(
      textEl,
      fromEl,
      entry,
    );
  }
  return hitokotoPageState.rendered;
}

function warmHitokotoCacheInBackground() {
  if (hitokotoPageState.warmPromise) return hitokotoPageState.warmPromise;
  hitokotoPageState.warmPromise = fetchHitokoto()
    .then(data => addHitokotoToCache(data))
    .catch(() => null);
  return hitokotoPageState.warmPromise;
}

function syncHitokotoForCurrentPage() {
  const hitokotoEl = document.getElementById('hitokoto');
  const hitokotoTextEl = document.getElementById('hitokotoText');
  const hitokotoFromEl = document.getElementById('hitokotoFrom');
  if (!hitokotoEl || !hitokotoTextEl || !hitokotoFromEl) return false;

  // Lock the instance before checking visibility. A page opened while the
  // feature is disabled must not select a newer cache entry when re-enabled.
  lockHitokotoForCurrentPage();
  const enabled = typeof themePreferences !== 'undefined'
    ? themePreferences.hitokotoEnabled !== false
    : true;
  if (!enabled) {
    // Keep the locked text in place so re-enabling reveals the same instance
    // value instead of selecting a newer cache entry.
    hitokotoEl.style.display = 'none';
    return false;
  }

  const hasHitokoto = renderCachedHitokoto(hitokotoTextEl, hitokotoFromEl);
  hitokotoEl.style.display = hasHitokoto ? '' : 'none';
  // This request is only for the next new-tab instance. Completion updates the
  // cache and never calls a renderer for the current page.
  void warmHitokotoCacheInBackground();
  return hasHitokoto;
}

/**
 * fetchOpenTabs()
 *
 * Reads the open tabs of the dashboard's window directly from Chrome
 * (all windows when the dashboard window id is unavailable). Flags Tab
 * Harbor's own pages via isTabOut so duplicate new tabs can be detected.
 */
async function fetchOpenTabs() {
  try {
    const currentWindowId = await getDashboardWindowIdForOpenTabs();
    const tabs = await chrome.tabs.query({});
    allOpenTabIds = tabs.map(tab => tab?.id).filter(tabId => tabId != null);
    const visibleTabs = currentWindowId == null
      ? tabs
      : tabs.filter(t => t.windowId === currentWindowId);

    openTabs = visibleTabs.map(t => {
      const rawUrl = t.url || '';
      const suspended = runtimeParseSuspendedTabUrl
        ? runtimeParseSuspendedTabUrl(rawUrl)
        : { isSuspended: false, originalUrl: '', title: '' };
      const canonicalUrl = runtimeGetCanonicalTabUrl
        ? runtimeGetCanonicalTabUrl(rawUrl)
        : rawUrl;

      return {
        id:       t.id,
        rawUrl,
        url:      canonicalUrl,
        title:    suspended.title || t.title,
        windowId: t.windowId,
        active:   t.active,
        pinned:   Boolean(t.pinned),
        // Native Chrome tab group membership + strip position: used to render
        // user-created Chrome groups as first-class cards and to order cards
        // like the tab strip.
        groupId:  Number.isInteger(t.groupId) && t.groupId >= 0 ? t.groupId : -1,
        index:    Number.isInteger(t.index) ? t.index : 0,
        favIconUrl: t.favIconUrl || '',
        isSuspended: Boolean(suspended.isSuspended),
        discarded: t.discarded || false,
        // Flag Tab Harbor's own pages so we can detect duplicate new tabs
        isTabOut: isTabHarborNewTabUrl(rawUrl),
      };
    });
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
    allOpenTabIds = [];
  }
}

function getOpenTabIdsForSessionPruning() {
  return allOpenTabIds.length > 0 ? allOpenTabIds : openTabs.map(tab => tab.id);
}

async function queryTabsForDashboardWindow() {
  const currentWindowId = await getDashboardWindowIdForOpenTabs();
  if (currentWindowId == null) return chrome.tabs.query({});

  try {
    return await chrome.tabs.query({ windowId: currentWindowId });
  } catch {
    return chrome.tabs.query({});
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

function suppressChromeTabGroupsImport(durationMs = 1200) {
  suppressChromeTabGroupsImportUntil = Math.max(
    suppressChromeTabGroupsImportUntil,
    Date.now() + Math.max(0, Number(durationMs) || 0)
  );
  if (chromeTabGroupsImportTimer) {
    clearTimeout(chromeTabGroupsImportTimer);
    chromeTabGroupsImportTimer = null;
  }
}

function isChromeTabGroupsImportSuppressed() {
  return Date.now() < suppressChromeTabGroupsImportUntil;
}

function disableEntryAnimations() {
  if (entryAnimationsTimer) {
    clearTimeout(entryAnimationsTimer);
    entryAnimationsTimer = null;
  }
  document.body.classList.remove(ENTRY_ANIMATIONS_CLASS);
}

function primeEntryAnimations(durationMs = 1200) {
  if (!document.body) return;
  document.body.classList.add(ENTRY_ANIMATIONS_CLASS);
  if (entryAnimationsTimer) clearTimeout(entryAnimationsTimer);
  entryAnimationsTimer = setTimeout(() => {
    document.body.classList.remove(ENTRY_ANIMATIONS_CLASS);
    entryAnimationsTimer = null;
  }, Math.max(0, Number(durationMs) || 0));
}

async function syncChromeTabGroupsWithoutImportEcho() {
  suppressChromeTabGroupsImport();
  if (chromeTabGroupsEnabled && !chromeTabGroupSnapshotAuthoritative) {
    return {
      ok: false,
      action: 'sync',
      error: {
        code: 'NON_AUTHORITATIVE_SNAPSHOT',
        message: 'Chrome tab-group sync skipped because the live snapshot is incomplete',
      },
    };
  }
  const windowId = await getDashboardWindowIdForOpenTabs();
  if (windowId == null) return;
  let colorIndex = 0;
  const groups = getChromeSyncGroups(domainGroups)
    .filter(group => !group.isManual && !group.isChromeGroup && !group.isChromeGroupConflict)
    .map(group => {
      if (Array.isArray(group.tabIds)) {
        return {
          groupKey: String(group.groupKey || group.domain || ''),
          title: String(group.title || ''),
          color: String(group.color || 'grey'),
          collapsed: group.collapsed === true,
          tabIds: group.tabIds.map(Number).filter(Number.isInteger),
        };
      }
      const groupKey = String(group.domain || group.groupKey || '');
      const tabIds = (group.tabs || [])
        .map(tab => Number(tab?.id))
        .filter(Number.isInteger);
      const color = typeof runtimeAssignGroupColor === 'function'
        ? runtimeAssignGroupColor(groupKey, colorIndex)
        : 'grey';
      if (!groupKey.startsWith(MANUAL_GROUP_PREFIX)) colorIndex += 1;
      return {
        groupKey,
        title: getAutomaticGroupDisplayTitle({ groupKey, label: group.label || '' }),
        color,
        collapsed: true,
        tabIds,
      };
    })
    .filter(group => group.groupKey && group.tabIds.length > 0);
  const response = await sendChromeTabGroupRequest('sync-chrome-tab-groups', {
    windowId: Number(windowId),
    enabled: chromeTabGroupsEnabled,
    allWindows: !chromeTabGroupsEnabled,
    preserveGroupKeys: chromeTabGroupsEnabled ? chromeTabGroupPreserveKeys : [],
    groups: chromeTabGroupsEnabled ? groups : [],
  });
  applyChromeTabGroupResponseState(response);
  if (applyChromeTabGroupResponseConflicts(response)) {
    renderOpenTabsSummary(getRealTabs());
  }
  return response;
}

function disableChromeTabGroupsImportModeForLocalEdits() {
  if (!chromeTabGroupsEnabled) return;
  if (typeof setImportMode === 'function') setImportMode(false);
}

function shouldImportChromeGroupsIntoSessionState() {
  // Retired: native Chrome groups are recognized live as first-class cards
  // (queryUserChromeGroups) instead of being imported into session state,
  // which would mark them managed and hide the cards. Keeping the function
  // lets the toggle/refresh wiring short-circuit cleanly.
  return false;
}

function getChromeGroupEventWindowIds(event = {}) {
  return [
    event?.group?.windowId,
    event?.tab?.windowId,
    event?.moveInfo?.windowId,
    event?.removeInfo?.windowId,
    event?.attachInfo?.newWindowId,
    event?.detachInfo?.oldWindowId,
  ]
    .map(value => Number(value))
    .filter(Number.isInteger);
}

function isChromeGroupEventForCurrentDashboard(event = {}) {
  if (currentDashboardWindowId == null) return true;
  const eventWindowIds = getChromeGroupEventWindowIds(event);
  if (eventWindowIds.length === 0) return true;
  return eventWindowIds.includes(Number(currentDashboardWindowId));
}

function armTabDrivenDashboardRefresh(delayMs) {
  if (window.__tabRefreshTimeout) clearTimeout(window.__tabRefreshTimeout);
  window.__tabRefreshTimeout = setTimeout(() => {
    window.__tabRefreshTimeout = null;
    void runTabDrivenDashboardRefresh();
  }, Math.max(0, Number(delayMs) || 0));
}

async function runTabDrivenDashboardRefresh() {
  if (tabDrivenDashboardRefreshRunning || !tabDrivenDashboardRefreshDirty) return;
  tabDrivenDashboardRefreshRunning = true;
  tabDrivenDashboardRefreshDirty = false;
  try {
    // The service worker owns event-driven native-group writes. Dashboard
    // listeners only refresh their window's visible state, otherwise one
    // Chrome event would submit a second copy of the same desired snapshot.
    await renderDashboard({ syncChromeGroups: false });
    updateBackToTopVisibility();
    if (typeof window.__tabHarborSuggestionsRefresh === 'function') {
      window.__tabHarborSuggestionsRefresh();
    }
  } catch (err) {
    console.warn('[tab-harbor] Failed to refresh dashboard:', err);
    if (isExtensionContextInvalidated(err)) recoverFromInvalidatedExtensionContext();
  } finally {
    tabDrivenDashboardRefreshRunning = false;
    if (tabDrivenDashboardRefreshDirty) {
      // Events received during the asynchronous DOM rebuild are represented
      // by one trailing refresh. They never start a concurrent render.
      armTabDrivenDashboardRefresh(tabDrivenDashboardRefreshDelayMs);
    }
  }
}

function scheduleTabDrivenDashboardRefresh(delayMs = 300) {
  tabDrivenDashboardRefreshDirty = true;
  tabDrivenDashboardRefreshDelayMs = Math.max(0, Number(delayMs) || 0);
  if (tabDrivenDashboardRefreshRunning) return;
  armTabDrivenDashboardRefresh(tabDrivenDashboardRefreshDelayMs);
}

function ensureChromeTabGroupsSubscription() {
  if (typeof subscribeToChromeTabGroupChanges !== 'function') {
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
  chromeTabGroupsUnsubscribe = subscribeToChromeTabGroupChanges((event = {}) => {
    if (event?.source === 'storage.onChanged') {
      chromeTabGroupsEnabled = event.enabled === true;
      if (!chromeTabGroupsEnabled) {
        if (chromeTabGroupsImportTimer) clearTimeout(chromeTabGroupsImportTimer);
        chromeTabGroupsImportTimer = null;
        if (typeof setImportMode === 'function') setImportMode(false);
        void requestChromeTabGroupCleanup();
      } else {
        clearChromeTabGroupCleanupRetry();
      }
      renderThemeMenu();
    }
    // C14: a tab dragged into a native group OUTSIDE the dashboard (browser
    // strip drag, another window's new-tab page, context menu) leaves a stale
    // manual-group assignment behind. When the event carries a tab that now
    // belongs to a native group, drop it from the manual session groups so the
    // next render cannot show it in two cards.
    const eventTab = event?.tab;
    const eventGroupId = eventTab?.groupId ?? event?.changeInfo?.groupId ?? event?.attachInfo?.groupId ?? -1;
    // tabs.onAttached carries tabId + attachInfo (no tab object and no
    // groupId): resolve the raw id against the live tab once so cross-window
    // attach-to-group is cleaned too. Guard the lookup for that event source
    // explicitly — attachInfo has no groupId, so a groupId-only guard makes
    // the whole path unreachable.
    const rawTabId = eventTab?.id != null ? Number(eventTab.id) : (event?.tabId != null ? Number(event.tabId) : null);
    const isAttachEvent = event?.source === 'tabs.onAttached';
    const resolveCleanup = async (tabId) => {
      if (tabId == null) return;
      let liveGroupId = Number(eventGroupId);
      if (eventTab?.id == null) {
        try {
          const live = await chrome.tabs.get(tabId);
          liveGroupId = live?.groupId != null ? Number(live.groupId) : -1;
        } catch { liveGroupId = -1; }
      }
      if (Number(liveGroupId) < 0) return;
      const currentAssignment = sessionGroupsState?.assignments?.[String(tabId)];
      if (!currentAssignment) return;
      let nextState = clearTabsFromSessionGroups(sessionGroupsState, [tabId]);
      nextState = pruneSessionGroups(nextState, getOpenTabIdsForSessionPruning());
      // saveSessionGroups already normalizes and assigns sessionGroupsState;
      // do NOT write the raw nextState back in a .then (it could clobber the
      // normalized shape or a newer state under race).
      void saveSessionGroups(nextState);
    };
    if (rawTabId != null && (Number(eventGroupId) >= 0 || isAttachEvent)) {
      void resolveCleanup(rawTabId);
    }

    if (!isChromeGroupEventForCurrentDashboard(event)) return;

    // Live card recognition is a pure read — never gate it on the push/import
    // suppression windows (those exist to stop sync echo). Browser group
    // changes re-render the cards even when the sync toggle is off.
    const suppressionRemaining = Math.max(0, (window.__suppressAutoRefreshUntil || 0) - Date.now());
    scheduleTabDrivenDashboardRefresh(suppressionRemaining + 200);
    // Push/import side stays gated by the toggle and the echo windows.
    if (chromeTabGroupsEnabled && !isChromeTabGroupsImportSuppressed()) {
      scheduleChromeTabGroupsImport();
    }
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

    // The import pipeline is retired; do not pay for fetch/load/storage work
    // on every Chrome group event just to discover that (C17).
    if (!shouldImportChromeGroupsIntoSessionState()) {
      disableChromeTabGroupsImportModeForLocalEdits();
      return;
    }

    chromeTabGroupsImportInFlight = true;
    try {
      await fetchOpenTabs();
      const realTabs = getRealTabs();
      await loadSessionGroups(getOpenTabIdsForSessionPruning());
      await loadImportedChromeGroupMeta();
      if (!shouldImportChromeGroupsIntoSessionState()) {
        disableChromeTabGroupsImportModeForLocalEdits();
        return;
      }
      const importedCount = await importChromeNativeGroupsIntoSessionGroups();
      if (typeof setImportMode === 'function') setImportMode(importedCount > 0);
      disableChromeTabGroupsImportModeForLocalEdits();
      window.__suppressAutoRefreshUntil = Date.now() + 2000;
      await renderDashboard();
      if (window.__tabRefreshTimeout) {
        clearTimeout(window.__tabRefreshTimeout);
        window.__tabRefreshTimeout = null;
      }
      window.__suppressAutoRefreshUntil = 0;
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
  await loadSessionGroups(getOpenTabIdsForSessionPruning());
  await loadImportedChromeGroupMeta();

  let importedCount = 0;
  if (enable && shouldImportChromeGroupsIntoSessionState()) {
    importedCount = await importChromeNativeGroupsIntoSessionGroups();
  } else if (!enable && typeof reconcileChromeTabGroupImports === 'function') {
    // The import pipeline is retired: importedChromeGroupMeta entries are
    // historical records, and the session groups they point to are now
    // ordinary manual groups the user may still be using. Turning the toggle
    // off must not delete those groups — only clear the stale metadata.
    const cleared = reconcileChromeTabGroupImports({
      currentState: sessionGroupsState,
      importedMeta: importedChromeGroupMeta,
      nativeGroups: [],
    });
    await saveImportedChromeGroupMeta(cleared.importedMeta);
  }

  // Turning sync off also requests all-window cleanup. A transient Chrome API
  // failure leaves sync disabled (so no new writes can occur) but schedules a
  // visible, retryable cleanup instead of pretending every created group was
  // already dismantled.
  let cleanupResponse = null;
  if (!enable) {
    cleanupResponse = await requestChromeTabGroupCleanup();
  } else {
    clearChromeTabGroupCleanupRetry();
  }

  ensureChromeTabGroupsSubscription();
  if (typeof setImportMode === 'function') setImportMode(importedCount > 0);
  disableChromeTabGroupsImportModeForLocalEdits();
  window.__suppressAutoRefreshUntil = Date.now() + 2000;
  await renderDashboard();
  if (window.__tabRefreshTimeout) {
    clearTimeout(window.__tabRefreshTimeout);
    window.__tabRefreshTimeout = null;
  }
  window.__suppressAutoRefreshUntil = 0;
  const toastMessage = enable
    ? (runtimeT ? runtimeT('toastChromeTabGroupsOn') : 'Chrome tab groups on')
    : cleanupResponse?.ok
      ? (runtimeT ? runtimeT('toastChromeTabGroupsOff') : 'Chrome tab groups off')
      : (runtimeT
          ? runtimeT('toastChromeTabGroupsOffCleanupPending')
          : 'Chrome tab-group sync is off; cleanup will retry');
  showToast(toastMessage);
}

async function loadGroupOrder() {
  const stored = await chrome.storage.local.get(GROUP_ORDER_KEY);
  groupOrderState = normalizeGroupOrderState(stored[GROUP_ORDER_KEY]);
  // Chrome-group card keys are session-local and must never live in the
  // durable card order. Clean any residue written before the filter was
  // centralized here (C23).
  const chromeKey = /^__chrome_group__:/;
  const cleanSessionOrder = (groupOrderState.sessionOrder || []).filter(key => !chromeKey.test(String(key)));
  const cleanPinnedOrder = (groupOrderState.pinnedOrder || []).filter(key => !chromeKey.test(String(key)));
  if (cleanSessionOrder.length !== (groupOrderState.sessionOrder || []).length ||
      cleanPinnedOrder.length !== (groupOrderState.pinnedOrder || []).length) {
    groupOrderState = normalizeGroupOrderState({
      ...groupOrderState,
      sessionOrder: cleanSessionOrder,
      pinnedOrder: cleanPinnedOrder,
    });
    await chrome.storage.local.set({ [GROUP_ORDER_KEY]: groupOrderState });
  }
  return groupOrderState;
}

async function saveGroupOrder(nextState) {
  const chromeKey = /^__chrome_group__:/;
  const cleanSessionOrder = (nextState?.sessionOrder || []).map(String).filter(key => key && !chromeKey.test(key));
  const cleanPinnedOrder = (nextState?.pinnedOrder || []).map(String).filter(key => key && !chromeKey.test(key));
  groupOrderState = normalizeGroupOrderState({
    ...nextState,
    sessionOrder: cleanSessionOrder,
    pinnedOrder: cleanPinnedOrder,
  });
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
      runtimeSetImageFallbackAttributes(img, iconData.fallbackSources || iconData.fallbackSrc);
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
  // A reorder applies to the whole strip: both the session and pinned orders
  // follow the new key order, and pinning is disabled so a pinned subset
  // cannot retain a stale order after the reorder.
  groupOrderState = normalizeGroupOrderState({
    ...groupOrderState,
    sessionOrder: orderKeys,
    pinnedOrder: orderKeys,
    pinEnabled: false,
  });
  return groupOrderState;
}

function getStableGroupId(groupKey) {
  return 'domain-' + String(groupKey).replace(/[^a-z0-9]/g, '-');
}

function getTabIdValue(tabId) {
  const id = Number(tabId);
  return Number.isFinite(id) ? id : null;
}

async function getCurrentWindowId() {
  const currentWindow = await chrome.windows.getCurrent();
  return currentWindow?.id;
}

async function getDashboardWindowIdForOpenTabs() {
  const currentTab = await resolveCurrentDashboardTab();
  if (currentTab?.windowId != null) {
    currentDashboardWindowId = currentTab.windowId;
    return currentDashboardWindowId;
  }

  try {
    currentDashboardWindowId = await getCurrentWindowId();
  } catch {
    currentDashboardWindowId = null;
  }
  return currentDashboardWindowId;
}

function getTabCanonicalUrl(tab) {
  return runtimeGetCanonicalTabUrl ? runtimeGetCanonicalTabUrl(tab?.url || '') : String(tab?.url || '');
}

function getTabsByIds(tabIds = [], tabs = openTabs) {
  const selectedIds = new Set((tabIds || []).map(String).filter(Boolean));
  return (Array.isArray(tabs) ? tabs : []).filter(tab => selectedIds.has(String(tab?.id)));
}

function getPageChipTabIdMap() {
  const map = new Map();
  document.querySelectorAll('.page-chip[data-chip-sort-id]').forEach(row => {
    const chipId = String(row.dataset.chipSortId || '');
    const tabId = Number(row.dataset.tabId);
    if (chipId && Number.isFinite(tabId)) map.set(chipId, tabId);
  });
  return map;
}

function getSelectedBatchTabIds() {
  const collected = collectMovingTabIds([...selectedPageChipIds], '');
  return [...new Set(collected.tabIds.map(Number).filter(Number.isFinite))];
}

async function refreshTabData() {
  await fetchOpenTabs();
  await loadSessionGroups(getOpenTabIdsForSessionPruning());
}

async function runWithSuppressedRefresh(task) {
  window.__suppressAutoRefreshUntil = Date.now() + 2000;
  try {
    return await task();
  } finally {
    window.__suppressAutoRefreshUntil = 0;
  }
}

function beginBatchAction() {
  window.__suppressAutoRefreshUntil = Date.now() + 2000;
}

async function finishBatchAction({ clearSelection = false, keptChipIds = null } = {}) {
  if (clearSelection) {
    selectedPageChipIds.clear();
    pageChipSelectionAnchorId = '';
  } else if (keptChipIds) {
    selectedPageChipIds = new Set(keptChipIds);
    pageChipSelectionAnchorId = '';
  }
  // Sync the selection UI immediately (batch bar/highlight), then render.
  // The finally guarantees the refresh-suppression window is always closed,
  // even when renderDashboard rejects.
  refreshPageChipSelectionClasses();
  try {
    await renderDashboard();
    updateBackToTopVisibility();
  } finally {
    window.__suppressAutoRefreshUntil = 0;
  }
}

async function closeTabsSafely(tabIds, { playSound = true } = {}) {
  let closedCount = 0;
  const closedTabIds = new Set();
  if (tabIds.length) {
    const allTabs = await queryTabsForDashboardWindow();
    const safeToClose = ensureWindowsKeepLastTab(allTabs, tabIds);
    // Close in parallel so large batch operations do not degrade to N serial
    // Chrome API round-trips; individual failures are still isolated.
    const results = await Promise.allSettled(safeToClose.map(tabId => chrome.tabs.remove(tabId)));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        closedCount += 1;
        closedTabIds.add(Number(safeToClose[index]));
      }
      // Rejected tabs may already be gone; if they are still open, the
      // re-render and selection-preservation paths keep them visible/selected.
    });
    if (closedCount > 0 && playSound) playCloseSound();
  }
  return { closedCount, closedTabIds };
}

async function closeTabsByUrlsSafely(urls, { exact = false, playSound = true } = {}) {
  if (!urls || urls.length === 0) return { closedCount: 0, closedTabIds: new Set() };

  const allTabs = await queryTabsForDashboardWindow();
  let matched = [];

  if (exact) {
    const urlSet = new Set(urls.map(url => runtimeGetCanonicalTabUrl ? runtimeGetCanonicalTabUrl(url) : url));
    matched = allTabs.filter(t => urlSet.has(getTabCanonicalUrl(t))).map(t => t.id);
  } else {
    // Separate file:// URLs (exact match) from regular URLs (hostname match).
    const targetHostnames = [];
    const exactUrls = new Set();
    for (const u of urls) {
      const canonicalUrl = runtimeGetCanonicalTabUrl ? runtimeGetCanonicalTabUrl(u) : u;
      if (canonicalUrl.startsWith('file://')) {
        exactUrls.add(canonicalUrl);
      } else {
        try { targetHostnames.push(new URL(canonicalUrl).hostname); }
        catch { /* skip unparseable */ }
      }
    }
    matched = allTabs
      .filter(tab => {
        const tabUrl = getTabCanonicalUrl(tab);
        if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
        try {
          const tabHostname = new URL(tabUrl).hostname;
          return tabHostname && targetHostnames.includes(tabHostname);
        } catch { return false; }
      })
      .map(tab => tab.id);
  }

  return closeTabsSafely(matched, { playSound });
}

async function closeDuplicatesByUrls(urls, { keepOne = true, playSound = true } = {}) {
  if (!urls || urls.length === 0) return { closedCount: 0, closedTabIds: new Set() };
  const allTabs = await queryTabsForDashboardWindow();
  const toClose = [];

  for (const url of urls) {
    const targetUrl = runtimeGetCanonicalTabUrl ? runtimeGetCanonicalTabUrl(url) : url;
    const matching = allTabs.filter(t => getTabCanonicalUrl(t) === targetUrl);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  return closeTabsSafely(toClose, { playSound });
}

async function closeDuplicatesInSelection(tabIds, { playSound = true } = {}) {
  const selectedTabs = getTabsByIds(tabIds);
  const byUrl = new Map();
  for (const tab of selectedTabs) {
    const url = getTabCanonicalUrl(tab);
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(tab);
  }
  const toClose = [];
  for (const tabs of byUrl.values()) {
    if (tabs.length < 2) continue;
    const keep = tabs.find(t => t.active) || tabs[0];
    for (const tab of tabs) {
      if (tab.id !== keep.id) toClose.push(tab.id);
    }
  }
  return closeTabsSafely(toClose, { playSound });
}

async function mergeTabsIntoChromeGroup(tabIds, { title, color }) {
  const requestedIds = (tabIds || []).map(Number).filter(Number.isInteger);
  const liveTabs = [];
  for (const tabId of requestedIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && !tab.pinned) liveTabs.push(tab);
    } catch { /* stale ids are dropped before the background revalidation */ }
  }
  const liveIds = liveTabs.map(tab => Number(tab.id));
  if (!liveIds.length) throw new Error('No eligible tabs remain');
  // `title` may be a function (mergedIds) => label: count-based labels must
  // use the live ids — stale ids dropped before the background request
  // would otherwise inflate the count in the group title.
  const label = typeof title === 'function' ? title(liveIds) : title;
  const windowId = Number(liveTabs[0].windowId);
  const response = await performChromeGroupMutation('create', {
    windowId,
    tabIds: liveIds,
    orderedTabIds: liveIds,
    title: String(label || ''),
    color: String(color || 'grey'),
  });
  return {
    groupId: response.groupId,
    updated: response.updated !== false,
    mergedTabIds: response.mergedTabIds || liveIds,
  };
}

async function sleepTabsByIds(tabIds, { skipActive = true } = {}) {
  let discarded = 0;
  let failed = 0;
  let skippedActive = 0;
  let stale = 0;
  const resultsByTabId = new Map();

  const tasks = (tabIds || []).map(async (rawTabId) => {
    const tabId = Number(rawTabId);
    if (!Number.isFinite(tabId)) return { tabId: null, status: 'stale' };

    let liveTab = null;
    try { liveTab = await chrome.tabs.get(tabId); } catch { liveTab = null; }
    if (!liveTab) return { tabId, status: 'stale' };
    if (skipActive && liveTab?.active) return { tabId, status: 'skipped-active' };
    const ok = await discardTab(tabId);
    return { tabId, status: ok ? 'discarded' : 'failed' };
  });

  const settled = await Promise.all(tasks);
  for (const result of settled) {
    if (result.status === 'discarded') discarded += 1;
    else if (result.status === 'failed') failed += 1;
    else if (result.status === 'skipped-active') skippedActive += 1;
    else if (result.status === 'stale') stale += 1;
    if (result.tabId != null) resultsByTabId.set(result.tabId, { status: result.status });
  }

  return { discarded, failed, skippedActive, stale, resultsByTabId };
}

async function openSessionPickerForTabs(tabIds, source) {
  const normalizedTabIds = (tabIds || []).map(String).filter(Boolean);
  if (!normalizedTabIds.length) return;
  await openTabSessionPicker({
    source,
    initialTabIds: normalizedTabIds,
    scopeTabIds: normalizedTabIds,
  });
}

function getTabGroupLookup(groups = domainGroups) {
  const lookup = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const groupEntry = {
      key: String(group?.domain || ''),
      label: getGroupDisplayLabel(group),
      manualGroupId: String(group?.manualGroupId || ''),
      chromeGroupColor: String(group?.chromeGroupColor || ''),
    };
    for (const tab of Array.isArray(group?.tabs) ? group.tabs : []) {
      if (tab?.id != null) lookup.set(String(tab.id), groupEntry);
      if (tab?.url) lookup.set(String(tab.url), groupEntry);
    }
  }
  return lookup;
}

async function refreshTabSessionModel() {
  await fetchOpenTabs();
  const realTabs = getRealTabs();
  await loadSessionGroups(getOpenTabIdsForSessionPruning());
  await loadGroupOrder();
  await loadGroupLabelOverrides();
  await buildDomainGroups(realTabs);
  return realTabs;
}

async function saveTabsAsSession(tabs, selectedTabIds, source = 'manual', name = '') {
  if (!runtimeBuildSessionSnapshot || !runtimeAddSavedTabSession) {
    throw new Error('Session storage is unavailable');
  }

  const selectedIds = new Set((selectedTabIds || []).map(String).filter(Boolean));
  const snapshot = runtimeBuildSessionSnapshot({
    tabs,
    groupLookup: getTabGroupLookup(),
    selectedTabIds: [...selectedIds],
    source,
    name,
    now: new Date().toISOString(),
  });

  const savedSessions = await runtimeAddSavedTabSession(snapshot);
  const tabIdsToClose = (Array.isArray(tabs) ? tabs : [])
    .filter(tab => selectedIds.has(String(tab?.id)) && (runtimeIsRestorableTabUrl ? runtimeIsRestorableTabUrl(tab?.url || '') : true))
    .map(tab => getTabIdValue(tab?.id))
    .filter(Number.isFinite);

  if (tabIdsToClose.length > 0) {
    await chrome.tabs.remove(tabIdsToClose);
  }

  await renderDashboard();

  return {
    session: snapshot,
    sessions: savedSessions,
    closedTabIds: tabIdsToClose,
  };
}

async function saveCurrentWindowTabSession() {
  const realTabs = await refreshTabSessionModel();
  const currentWindowId = await getCurrentWindowId();
  const windowTabs = realTabs.filter(tab => tab.windowId === currentWindowId);
  const result = await saveTabsAsSession(
    windowTabs,
    windowTabs.map(tab => String(tab.id)),
    'current-window'
  );
  return result;
}

async function saveSelectedTabSession(tabIds = [], source = 'selected', name = '') {
  const realTabs = await refreshTabSessionModel();
  const selectedTabs = getTabsByIds(tabIds, realTabs);
  const result = await saveTabsAsSession(selectedTabs, tabIds, source, name);
  return result;
}

async function appendTabsToExistingSavedSession(sessionId, tabIds = []) {
  if (!runtimeBuildSessionSnapshot || !runtimeAppendSavedTabSessionTabs) {
    throw new Error('Session storage is unavailable');
  }

  const realTabs = await refreshTabSessionModel();
  const selectedTabs = getTabsByIds(tabIds, realTabs);
  const selectedIds = new Set((tabIds || []).map(String).filter(Boolean));
  const snapshot = runtimeBuildSessionSnapshot({
    tabs: selectedTabs,
    groupLookup: getTabGroupLookup(),
    selectedTabIds: [...selectedIds],
    source: 'append-existing',
    now: new Date().toISOString(),
  });

  const result = await runtimeAppendSavedTabSessionTabs(sessionId, snapshot.tabs, {
    skipDuplicateUrls: true,
  });
  const tabIdsToClose = selectedTabs
    .filter(tab => selectedIds.has(String(tab?.id)) && (runtimeIsRestorableTabUrl ? runtimeIsRestorableTabUrl(tab?.url || '') : true))
    .map(tab => getTabIdValue(tab?.id))
    .filter(Number.isFinite);

  if (tabIdsToClose.length > 0) {
    await chrome.tabs.remove(tabIdsToClose);
  }

  return {
    ...result,
    selectedCount: snapshot.tabs.length,
    closedTabIds: tabIdsToClose,
  };
}

async function submitTodoEditor() {
  const editorState = getTodoEditorState ? getTodoEditorState() : {};
  const title = String(editorState.title || '').trim();
  const description = String(editorState.description || '').trim();

  if (!title) {
    setTodoEditorError(runtimeT ? runtimeT('todoTitleRequired') : 'Add a title before saving.');
    await renderDeferredColumn();
    focusTodoEditorTitle();
    return;
  }

  if (editorState.mode === 'edit') {
    if (!editorState.todoId) return;
    await updateTodoItem(editorState.todoId, { title, description });
    closeTodoEditor();
    showToast(runtimeT ? runtimeT('toastTodoUpdated') : 'Todo updated');
    await renderDeferredColumn();
    return;
  }

  await createTodoItem({ title, description });
  closeTodoEditor();
  drawerView = 'todos';
  todoDetailId = '';
  await renderDeferredColumn();
}

async function getTabSessionPickerContext() {
  await refreshTabSessionModel();
  const currentWindowId = await getCurrentWindowId();
  const groups = domainGroups
    .map(group => ({
      key: String(group.domain),
      label: getGroupDisplayLabel(group),
      manualGroupId: String(group.manualGroupId || ''),
      tabs: getOrderedUniqueTabsForGroup(group)
        .filter(tab => tab.windowId === currentWindowId)
        .filter(tab => runtimeIsRestorableTabUrl ? runtimeIsRestorableTabUrl(tab.url || '') : true)
        .map(tab => ({
          id: tab.id,
          url: tab.url,
          rawUrl: tab.rawUrl || tab.url,
          title: tab.title || tab.url,
          favIconUrl: tab.favIconUrl || '',
          windowId: tab.windowId,
        })),
    }))
    .filter(group => group.tabs.length > 0);

  return { groups };
}

function getTabSessionPickerSelectedIds() {
  return [...new Set((tabSessionPickerState.selectedTabIds || []).map(String).filter(Boolean))];
}

function getTabSessionPickerAllIds(groups = []) {
  return [...new Set((Array.isArray(groups) ? groups : [])
    .flatMap(group => Array.isArray(group?.tabs) ? group.tabs : [])
    .map(tab => String(tab?.id || ''))
    .filter(Boolean))];
}

function getScopedTabSessionPickerGroups(groups = [], scopeTabIds = null) {
  if (!Array.isArray(scopeTabIds)) return Array.isArray(groups) ? groups : [];
  const scopeIds = new Set(scopeTabIds.map(id => String(id)).filter(Boolean));
  if (!scopeIds.size) return [];
  return (Array.isArray(groups) ? groups : [])
    .map(group => ({
      ...group,
      tabs: (Array.isArray(group?.tabs) ? group.tabs : [])
        .filter(tab => scopeIds.has(String(tab?.id || ''))),
    }))
    .filter(group => group.tabs.length > 0);
}

function getTabSessionPickerGroupIds(groupKey = '', groups = []) {
  const group = (Array.isArray(groups) ? groups : [])
    .find(item => String(item?.key || item?.domain || '') === String(groupKey || ''));
  return (group?.tabs || [])
    .map(tab => String(tab?.id || ''))
    .filter(Boolean);
}

function getSavedSessionOptionLabel(session = {}) {
  const tabCount = Array.isArray(session?.tabs) ? session.tabs.length : 0;
  const tabWord = runtimeT
    ? (tabCount === 1 ? runtimeT('tabsWordSingular') : runtimeT('tabsWordPlural'))
    : `tab${tabCount === 1 ? '' : 's'}`;
  return `${session.name || 'Saved tabs'} (${tabCount} ${tabWord})`;
}

async function openTabSessionPicker({
  source = 'current-window',
  initialTabIds = null,
  scopeTabIds = null,
} = {}) {
  const context = await getTabSessionPickerContext();
  const savedSessions = runtimeGetSavedTabSessions ? await runtimeGetSavedTabSessions() : [];
  const scopedGroups = getScopedTabSessionPickerGroups(context.groups, scopeTabIds);
  const allIds = getTabSessionPickerAllIds(scopedGroups);
  const allIdSet = new Set(allIds);
  const initialSelectedIds = Array.isArray(initialTabIds)
    ? [...new Set(initialTabIds.map(id => String(id)).filter(id => allIdSet.has(id)))]
    : allIds;
  tabSessionPickerState = {
    open: true,
    mode: tabSessionPickerState.mode === 'existing' && savedSessions.length ? 'existing' : 'new',
    source,
    selectedTabIds: initialSelectedIds,
    newSessionName: tabSessionPickerState.newSessionName || '',
    targetSessionId: tabSessionPickerState.targetSessionId || String(savedSessions[0]?.id || ''),
    windowId: await getCurrentWindowId(),
    groups: scopedGroups,
    savedSessions,
  };
  renderOpenTabsArea();
}

function closeTabSessionPicker() {
  tabSessionPickerState = {
    open: false,
    mode: 'new',
    source: 'current-window',
    selectedTabIds: [],
    newSessionName: '',
    targetSessionId: '',
    windowId: null,
    groups: [],
    savedSessions: [],
  };
  renderOpenTabsArea();
}

function renderTabSessionPicker(groups = tabSessionPickerState.groups) {
  if (!tabSessionPickerState.open) return '';
  const pickerGroups = Array.isArray(groups) ? groups : [];
  const savedSessions = Array.isArray(tabSessionPickerState.savedSessions)
    ? tabSessionPickerState.savedSessions
    : [];
  const selectedIds = new Set(getTabSessionPickerSelectedIds());
  const selectedCount = selectedIds.size;
  const existingDisabled = savedSessions.length === 0;
  const mode = tabSessionPickerState.mode === 'existing' && !existingDisabled ? 'existing' : 'new';
  const targetSessionId = tabSessionPickerState.targetSessionId || String(savedSessions[0]?.id || '');
  const safeTargetSessionId = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(targetSessionId) : targetSessionId.replace(/"/g, '&quot;');
  const safeSelectLabel = runtimeEscapeHtmlAttribute
    ? runtimeEscapeHtmlAttribute(runtimeT ? runtimeT('sessionPickerTargetSessionLabel') : 'Target session')
    : 'Target session';
  const newSessionName = String(tabSessionPickerState.newSessionName || '');
  const safeNewSessionName = runtimeEscapeHtmlAttribute
    ? runtimeEscapeHtmlAttribute(newSessionName)
    : newSessionName.replace(/"/g, '&quot;');
  const namePlaceholder = runtimeT ? runtimeT('sessionPickerNewSessionNamePlaceholder') : 'Group title (optional)';
  const safeNamePlaceholder = runtimeEscapeHtmlAttribute
    ? runtimeEscapeHtmlAttribute(namePlaceholder)
    : namePlaceholder.replace(/"/g, '&quot;');
  const listHtml = pickerGroups.length
    ? pickerGroups.map(group => {
      const groupKey = String(group.key || group.domain || '');
      const safeGroupKey = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(groupKey) : groupKey.replace(/"/g, '&quot;');
      const tabs = Array.isArray(group.tabs)
        ? (group.key ? group.tabs : getOrderedUniqueTabsForGroup(group))
          .filter(tab => runtimeIsRestorableTabUrl ? runtimeIsRestorableTabUrl(tab.url || '') : true)
        : [];
      const groupIds = tabs.map(tab => String(tab?.id || '')).filter(Boolean);
      const checked = groupIds.length > 0 && groupIds.every(id => selectedIds.has(id));
      const rawGroupLabel = group.label || (group.domain ? getGroupDisplayLabel(group) : 'Group');
      const groupLabel = runtimeEscapeHtml ? runtimeEscapeHtml(rawGroupLabel) : rawGroupLabel;
      return `
        <section class="session-picker-group">
          <label class="session-picker-group-header">
            <input type="checkbox" data-action="toggle-session-picker-group" data-group-key="${safeGroupKey}"${checked ? ' checked' : ''}>
            <span class="session-picker-group-title">${groupLabel}</span>
            <span class="session-picker-group-count">${tabs.length}</span>
          </label>
          <div class="session-picker-tabs">
            ${tabs.map(tab => {
              const tabId = String(tab?.id || '');
              const safeTabId = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(tabId) : tabId.replace(/"/g, '&quot;');
              const safeTitle = runtimeEscapeHtml ? runtimeEscapeHtml(tab.title || tab.url || 'Tab') : tab.title || tab.url || 'Tab';
              const safeUrlText = runtimeEscapeHtml ? runtimeEscapeHtml(getTabCanonicalUrl(tab)) : getTabCanonicalUrl(tab);
              const iconData = runtimeGetIconSources ? runtimeGetIconSources(tab, 16) : { sources: [], hostname: '' };
              const faviconUrl = iconData.sources?.[0] || '';
              const fallbackUrl = iconData.sources?.[1] || '';
              const fallbackSrcset = iconData.sources?.length > 2
                ? (runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(JSON.stringify(iconData.sources.slice(2))) : JSON.stringify(iconData.sources.slice(2)).replace(/"/g, '&quot;'))
                : '';
              const fallbackLabel = runtimeGetFallbackLabel ? runtimeGetFallbackLabel(tab.title || tab.url || '', iconData.hostname || '') : '?';
              return `
                <label class="session-picker-tab-row">
                  <input type="checkbox" data-action="toggle-session-picker-tab" data-tab-id="${safeTabId}"${selectedIds.has(tabId) ? ' checked' : ''}>
                  <span class="session-picker-tab-title">
                    ${faviconUrl ? `<img src="${runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(faviconUrl) : faviconUrl}" alt="" data-fallback-src="${runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(fallbackUrl) : fallbackUrl}"${fallbackSrcset ? ` data-fallback-srcset="${fallbackSrcset}"` : ''}>` : ''}
                    <span class="inline-favicon-fallback"${faviconUrl ? ' style="display:none"' : ''}>${runtimeEscapeHtml ? runtimeEscapeHtml(fallbackLabel) : fallbackLabel}</span>
                    <span>${safeTitle}</span>
                  </span>
                  <span class="session-picker-tab-url">${safeUrlText}</span>
                </label>`;
            }).join('')}
          </div>
        </section>`;
    }).join('')
    : `<div class="session-picker-empty">${runtimeT ? runtimeT('sessionPickerEmpty') : 'No restorable tabs in this window.'}</div>`;

  return `
    <section class="session-picker" id="tabSessionPicker" aria-label="${runtimeT ? runtimeT('sessionPickerTitle') : 'Choose what to save'}">
      <div class="session-picker-header">
        <div>
          <div class="session-picker-title">${runtimeT ? runtimeT('sessionPickerTitle') : 'Choose what to save'}</div>
        </div>
        <button class="group-action-icon group-action-close" type="button" data-action="close-session-picker" aria-label="${runtimeT ? runtimeT('sessionPickerClose') : 'Close tab picker'}">
          ${ICONS.close}
        </button>
      </div>
      <div class="session-picker-list">${listHtml}</div>
      <div class="session-picker-footer">
        <span class="session-picker-count">${runtimeT ? runtimeT('sessionPickerSelectedCount', { count: selectedCount }) : `${selectedCount} selected`}</span>
        <div class="session-picker-save-mode" role="group" aria-label="${runtimeT ? runtimeT('sessionPickerModeLabel') : 'Save mode'}">
          <button class="session-picker-mode-button${mode === 'new' ? ' is-active' : ''}" type="button" data-action="select-session-picker-mode" data-session-picker-mode="new" aria-pressed="${mode === 'new'}">${runtimeT ? runtimeT('sessionPickerNewSession') : 'New group'}</button>
          <button class="session-picker-mode-button${mode === 'existing' ? ' is-active' : ''}" type="button" data-action="select-session-picker-mode" data-session-picker-mode="existing" aria-pressed="${mode === 'existing'}"${existingDisabled ? ' disabled' : ''}>${runtimeT ? runtimeT('sessionPickerExistingSession') : 'Existing group'}</button>
        </div>
        <input class="session-picker-name-input" type="text" data-action="change-session-picker-new-name" value="${safeNewSessionName}" placeholder="${safeNamePlaceholder}" aria-label="${safeNamePlaceholder}"${mode === 'new' ? '' : ' hidden disabled'}>
        <select class="session-picker-target-select" data-action="change-session-picker-target" aria-label="${safeSelectLabel}"${mode === 'existing' && !existingDisabled ? '' : ' hidden disabled'}>
          ${savedSessions.length
            ? savedSessions.map(session => {
              const id = String(session?.id || '');
              const safeId = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(id) : id.replace(/"/g, '&quot;');
              const label = getSavedSessionOptionLabel(session);
              return `<option value="${safeId}"${id === targetSessionId ? ' selected' : ''}>${runtimeEscapeHtml ? runtimeEscapeHtml(label) : label}</option>`;
            }).join('')
            : `<option value="">${runtimeT ? runtimeT('sessionPickerNoSavedSessions') : 'No saved sessions yet'}</option>`}
        </select>
        <button class="action-btn save-tabs" type="button" data-action="save-selected-session-tabs"${selectedCount ? '' : ' disabled'}>
          ${mode === 'existing'
            ? (runtimeT ? runtimeT('sessionPickerAddToExisting') : 'Add to session')
            : (runtimeT ? runtimeT('sessionPickerSaveAndClose') : 'Save and close')}
        </button>
      </div>
    </section>`;
}

async function submitTabSessionPicker() {
  const selectedIds = getTabSessionPickerSelectedIds();
  if (!selectedIds.length) {
    showToast(runtimeT ? runtimeT('toastNoSessionTabsSelected') : 'Select at least one tab');
    return;
  }

  try {
    if (tabSessionPickerState.mode === 'existing') {
      const targetSessionId = tabSessionPickerState.targetSessionId || String(tabSessionPickerState.savedSessions?.[0]?.id || '');
      if (!targetSessionId) throw new Error('Session not found');
      const result = await appendTabsToExistingSavedSession(targetSessionId, selectedIds);
      tabSessionPickerState = {
        ...tabSessionPickerState,
        open: false,
        newSessionName: '',
      };
      await renderDashboard();
      const skipped = result?.skippedDuplicateCount || 0;
      showToast(runtimeT
        ? runtimeT('toastSessionTabsAdded', { count: result?.appendedCount || 0, skipped })
        : `Added ${result?.appendedCount || 0} tabs${skipped ? `, skipped ${skipped} duplicates` : ''}`);
      return;
    }

    const newSessionName = String(tabSessionPickerState.newSessionName || '').trim();
    tabSessionPickerState = {
      ...tabSessionPickerState,
      open: false,
      newSessionName: '',
    };
    const result = await saveSelectedTabSession(
      selectedIds,
      tabSessionPickerState.source || 'selected',
      newSessionName
    );
    showToast(runtimeT
      ? runtimeT('toastSessionSaved', { count: result?.session?.tabs?.length || 0 })
      : `Saved ${result?.session?.tabs?.length || 0} tabs and closed the originals`);
  } catch (err) {
    console.error('[tab-harbor] Failed to save selected tabs:', err);
    showToast(runtimeT ? runtimeT('toastSessionActionFailed') : 'Could not update saved tabs');
  }
}

async function openSavedTabsInCurrentWindow(tabs = []) {
  const [firstTab, ...restTabs] = Array.isArray(tabs) ? tabs : [];
  if (!firstTab?.url) return { restoredTabs: [], windowId: null };

  const currentWindowId = await getCurrentWindowId();
  const firstCreatedTab = currentWindowId != null
    ? await chrome.tabs.create({
      windowId: currentWindowId,
      url: firstTab.url,
      active: true,
    })
    : await chrome.tabs.create({
      url: firstTab.url,
      active: true,
    });
  const targetWindowId = firstCreatedTab?.windowId ?? currentWindowId ?? null;
  const restoredTabs = firstCreatedTab?.id != null
    ? [{ id: firstCreatedTab.id, url: firstTab.url }]
    : [];

  for (const tab of restTabs) {
    const createdTab = await chrome.tabs.create({
      windowId: targetWindowId,
      url: tab.url,
      active: false,
    });
    // Restored tabs start ASLEEP: tabs.create loads the URL immediately, which
    // spikes CPU/memory when a session holds many tabs. Discard right after
    // the navigation commits (early in the load) so the URL is kept and the
    // page is never fully rendered; the tab reloads on activation. Fire-and-
    // forget: background's duplicate-blank-tab cleanup exempts freshly-created
    // tabs and discarded tabs, so a restore batch is never closed.
    if (createdTab?.id != null) {
      discardRestoredTabAfterCommit(createdTab.id, tab.url);
    }
    restoredTabs.push({
      id: createdTab.id,
      url: tab.url,
    });
  }

  return { restoredTabs, windowId: targetWindowId };
}

async function openSavedTabsInNewWindow(tabs = []) {
  const [firstTab, ...restTabs] = Array.isArray(tabs) ? tabs : [];
  if (!firstTab?.url) return { restoredTabs: [], windowId: null };

  const createdWindow = await chrome.windows.create({
    url: firstTab.url,
    focused: true,
  });
  const restoredTabs = [];
  const firstCreatedTab = Array.isArray(createdWindow?.tabs) ? createdWindow.tabs[0] : null;
  if (firstCreatedTab?.id != null) {
    restoredTabs.push({
      id: firstCreatedTab.id,
      url: firstTab.url,
    });
  } else if (createdWindow?.id != null) {
    const createdWindowTabs = await chrome.tabs.query({ windowId: createdWindow.id });
    const queriedFirstTab = createdWindowTabs?.[0];
    if (queriedFirstTab?.id != null) {
      restoredTabs.push({
        id: queriedFirstTab.id,
        url: firstTab.url,
      });
    }
  }

  for (const tab of restTabs) {
    const createdTab = await chrome.tabs.create({
      windowId: createdWindow.id,
      url: tab.url,
      active: false,
    });
    // Restored tabs start ASLEEP: tabs.create loads the URL immediately, which
    // spikes CPU/memory when a session holds many tabs. Discard right after
    // the navigation commits (early in the load) so the URL is kept and the
    // page is never fully rendered; the tab reloads on activation. Fire-and-
    // forget: background's duplicate-blank-tab cleanup exempts freshly-created
    // tabs and discarded tabs, so a restore batch is never closed.
    if (createdTab?.id != null) {
      discardRestoredTabAfterCommit(createdTab.id, tab.url);
    }
    restoredTabs.push({
      id: createdTab.id,
      url: tab.url,
    });
  }

  return { restoredTabs, windowId: createdWindow?.id ?? null };
}

async function restoreSavedTabToBrowser(tabUrl) {
  if (!tabUrl) return null;
  const restoreMode = runtimeGetSavedSessionRestoreMode ? runtimeGetSavedSessionRestoreMode() : 'new-window';
  if (restoreMode === 'current-window') {
    const { windowId } = await openSavedTabsInCurrentWindow([{ url: tabUrl }]);
    return { windowId, restoreMode };
  }
  const { windowId } = await openSavedTabsInNewWindow([{ url: tabUrl }]);
  return { windowId, restoreMode };
}

async function restoreSavedTabSession(sessionId) {
  if (!runtimeGetSavedTabSessions || !runtimeCreateRestoredSessionGroups) {
    throw new Error('Session restore is unavailable');
  }

  const sessions = await runtimeGetSavedTabSessions();
  const session = sessions.find(item => item.id === String(sessionId));
  if (!session || !Array.isArray(session.tabs) || !session.tabs.length) {
    throw new Error('Session not found');
  }

  const restoreMode = runtimeGetSavedSessionRestoreMode ? runtimeGetSavedSessionRestoreMode() : 'new-window';

  // Run under the refresh-suppression window: the burst of tabs.create and the
  // deferred discard events echo back as tabs-changed → debounced renderDashboard
  // calls. The restore already renders explicitly below, so suppressing that
  // echo avoids a redundant post-restore refresh. The explicit renderDashboard
  // call is unaffected — suppression only gates the event-driven refresh path.
  return runWithSuppressedRefresh(async () => {
    const { restoredTabs, windowId } = restoreMode === 'current-window'
      ? await openSavedTabsInCurrentWindow(session.tabs)
      : await openSavedTabsInNewWindow(session.tabs);

    const { state: nextSessionGroups, chromeGroupPlans } = runtimeCreateRestoredSessionGroups({
      existingState: sessionGroupsState,
      session,
      restoredTabs,
      now: new Date().toISOString(),
    });
    // Re-create native Chrome groups that were saved with the session: fresh
    // groups with the recorded title/color, tabs in the recorded order.
    await restoreChromeGroupsForSession(chromeGroupPlans, windowId);
    await saveSessionGroups(nextSessionGroups);
    await renderDashboard();

    return {
      restoredCount: restoredTabs.length,
      windowId,
    };
  });
}

/**
 * restoreChromeGroupsForSession(plans, windowId)
 *
 * Executes saved-session Chrome-group plans: creates a fresh native Chrome
 * group per plan (the recorded group id is session-local and cannot be
 * reused), restores its title/color and orders the tabs as recorded. A
 * same-title group already in the window gets a " (2)"/" (3)" suffix so the
 * restored group stays independent instead of merging. Writes are muted so
 * the dashboard's own group events cannot echo.
 */
async function restoreChromeGroupsForSession(plans, windowId) {
  if (!Array.isArray(plans) || !plans.length) return;
  let existingTitles = new Set();
  try {
    // Same-title conflict check is scoped to the restore target window; let
    // the API filter instead of pulling every window's groups.
    const groups = windowId != null
      ? await chrome.tabGroups.query({ windowId: Number(windowId) })
      : await chrome.tabGroups.query({});
    existingTitles = new Set(groups
      .map(g => String(g.title || ''))
      .filter(Boolean));
  } catch { /* keep the empty set: creation still proceeds */ }

  for (const plan of plans) {
    const planTabIds = (Array.isArray(plan?.tabIds) ? plan.tabIds : [])
      .map(Number)
      .filter(Number.isFinite);
    if (!planTabIds.length) continue;

    let title = String(plan?.title || '').trim();
    // Same-title group already in the window → independent group with a
    // " (N)" suffix instead of merging into the existing one.
    if (title && existingTitles.has(title)) {
      let suffix = 2;
      let candidate = `${title} (${suffix})`;
      while (existingTitles.has(candidate)) {
        suffix += 1;
        candidate = `${title} (${suffix})`;
      }
      title = candidate;
    }
    if (title) existingTitles.add(title);

    if (typeof muteChromeGroupEvents === 'function') muteChromeGroupEvents();
    try {
      // The service-worker coordinator pins creation to the restored window,
      // revalidates every tab, applies the recorded appearance, and restores
      // the saved order as one globally serialized operation.
      const targetWindowId = Number.isInteger(Number(windowId))
        ? Number(windowId)
        : await getWindowIdForChromeGroupTabs(planTabIds);
      if (!Number.isInteger(targetWindowId)) continue;
      await performChromeGroupMutation('create', {
        windowId: targetWindowId,
        tabIds: planTabIds,
        orderedTabIds: planTabIds,
        title,
        color: String(plan?.color || 'grey'),
      });
    } catch (err) {
      console.warn('[tab-harbor] restoreChromeGroupsForSession failed:', err);
    }
  }
}

async function removeOpenTabByIdOrUrl(tabId, tabUrl) {
  const numericTabId = getTabIdValue(tabId);
  if (numericTabId != null) {
    try {
      await chrome.tabs.remove(numericTabId);
      return numericTabId;
    } catch { /* tab already gone — treat as removed */ }
    return null;
  }

  const allTabs = await queryTabsForDashboardWindow();
  const targetUrl = runtimeGetCanonicalTabUrl ? runtimeGetCanonicalTabUrl(tabUrl || '') : tabUrl;
  const match = allTabs.find(tab => {
    const canonicalUrl = getTabCanonicalUrl(tab);
    return tab.url === tabUrl || canonicalUrl === targetUrl;
  });
  if (match?.id != null) {
    try {
      await chrome.tabs.remove(match.id);
      return match.id;
    } catch { /* tab already gone — treat as removed */ }
  }
  return null;
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

function animateMissionCards(missionsEl, previousRects) {
  missionsEl?.querySelectorAll('.mission-card').forEach(card => {
    const key = card.dataset.groupId || '';
    const previousRect = previousRects.get(key);
    if (!previousRect) return;

    const nextRect = card.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    if (!deltaX && !deltaY) return;

    const travel = Math.hypot(deltaX, deltaY);
    const duration = prefersReducedMotion()
      ? 0
      : Math.min(220, Math.max(140, Math.round(150 + travel * 0.18)));

    card.style.transition = 'none';
    card.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
    requestAnimationFrame(() => {
      card.style.transition = duration
        ? `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
        : 'none';
      card.style.transform = '';
    });
  });
}

function buildPreviewGroupOrderFromDom(insertedGroupKey = '') {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return [];

  return [...missionsEl.children]
    .map(node => {
      if (node === pageChipNewGroupSlotEl) return insertedGroupKey;
      if (node.classList?.contains('mission-card')) return node.dataset?.groupId || '';
      return '';
    })
    .filter(Boolean);
}

function buildPersistentGroupOrderWithInsertedGroup(insertedGroupKey, {
  insertBeforeGroupKey = '',
  placement = 'after',
} = {}) {
  const normalizedInsertedKey = String(insertedGroupKey || '');
  if (!normalizedInsertedKey) return [];

  const currentKeys = domainGroups
    .map(group => String(group?.domain || ''))
    .filter(Boolean)
    .filter(key => key !== normalizedInsertedKey);

  const normalizedBeforeKey = String(insertBeforeGroupKey || '');
  if (normalizedBeforeKey) {
    const insertIndex = currentKeys.indexOf(normalizedBeforeKey);
    if (insertIndex >= 0) {
      currentKeys.splice(insertIndex, 0, normalizedInsertedKey);
      return currentKeys;
    }
  }

  if (placement === 'before') {
    currentKeys.unshift(normalizedInsertedKey);
    return currentKeys;
  }

  currentKeys.push(normalizedInsertedKey);
  return currentKeys;
}

function buildPersistentGroupOrderReplacingKey(replacementGroupKey, replacedGroupKey) {
  const normalizedReplacementKey = String(replacementGroupKey || '');
  const normalizedReplacedKey = String(replacedGroupKey || '');
  if (!normalizedReplacementKey) return [];

  const isChromeGroupKey = key => String(key || '').startsWith('__chrome_group__:');
  const currentKeys = domainGroups
    .map(group => String(group?.domain || ''))
    .filter(Boolean)
    .filter(key => key !== normalizedReplacementKey)
    .filter(key => !isChromeGroupKey(key));

  // Chrome-group cards are ordered by the browser tab strip, not by the
  // dashboard's persisted group order, so they must never enter that order.
  if (isChromeGroupKey(normalizedReplacementKey)) return currentKeys;

  if (!normalizedReplacedKey) {
    currentKeys.push(normalizedReplacementKey);
    return currentKeys;
  }

  const replaceIndex = currentKeys.indexOf(normalizedReplacedKey);
  if (replaceIndex >= 0) {
    currentKeys.splice(replaceIndex, 1, normalizedReplacementKey);
    return currentKeys;
  }

  currentKeys.push(normalizedReplacementKey);
  return currentKeys;
}

async function persistGroupOrder(orderKeys = []) {
  const normalizedKeys = [...new Set((orderKeys || []).map(key => String(key)).filter(Boolean))]
    .filter(key => !key.startsWith('__chrome_group__:'));
  if (!normalizedKeys.length) return groupOrderState;

  return saveGroupOrder({
    ...groupOrderState,
    sessionOrder: normalizedKeys,
    pinnedOrder: normalizedKeys,
    pinEnabled: false,
  });
}

function applyLiveGroupOrder(orderKeys, options = {}) {
  const keyOrder = orderKeys.map(String);
  const groupMap = new Map(domainGroups.map(group => [String(group.domain), group]));
  domainGroups = keyOrder.map(key => groupMap.get(key)).filter(Boolean);
  syncGroupOrderState(domainGroups.map(group => group.domain));

  const missionsEl = document.getElementById('openTabsMissions');
  const navListEl = document.querySelector('#workspaceTopNav .group-nav-list[data-nav-kind="open-tabs"]');
  if (options.reorderCards !== false) {
    const previousMissionRects = new Map();
    missionsEl?.querySelectorAll('.mission-card').forEach(card => {
      previousMissionRects.set(card.dataset.groupId || '', card.getBoundingClientRect());
    });

    keyOrder.forEach(key => {
      const card = missionsEl?.querySelector(`.mission-card[data-group-id="${CSS.escape(String(key))}"]`);
      if (card) missionsEl.appendChild(card);
    });

    animateMissionCards(missionsEl, previousMissionRects);
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

function ensurePageChipPlaceholder(listEl = pageChipDragState?.dropListEl || pageChipDragState?.sourceListEl) {
  if (!draggedPageChipEl) return null;

  if (!pageChipPlaceholderEl) {
    pageChipPlaceholderEl = document.createElement('div');
    pageChipPlaceholderEl.className = 'chip-reorder-placeholder';
    pageChipPlaceholderEl.style.height = `${draggedPageChipEl.getBoundingClientRect().height}px`;
  }

  if (listEl && pageChipPlaceholderEl.parentElement !== listEl) {
    listEl.appendChild(pageChipPlaceholderEl);
  }

  return pageChipPlaceholderEl;
}

function clampPageChipClientPoint(clientX, clientY) {
  const maxX = Math.max(0, window.innerWidth - 1);
  const maxY = Math.max(0, window.innerHeight - 1);
  return {
    clientX: Math.min(Math.max(Number(clientX) || 0, 0), maxX),
    clientY: Math.min(Math.max(Number(clientY) || 0, 0), maxY),
  };
}

function stopPageChipAutoScroll() {
  if (pageChipAutoScrollRaf) {
    cancelAnimationFrame(pageChipAutoScrollRaf);
    pageChipAutoScrollRaf = 0;
  }
}

function updatePageChipAutoScroll(clientX, clientY) {
  if (!pageChipDragState || !draggedPageChipId) return;
  pageChipDragState.lastClientX = clientX;
  pageChipDragState.lastClientY = clientY;

  const viewportHeight = window.innerHeight;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - viewportHeight);
  if (maxScroll <= 0) {
    stopPageChipAutoScroll();
    return;
  }

  const bottomZone = viewportHeight - PAGE_CHIP_EDGE_SCROLL_ZONE;
  let delta = 0;
  if (clientY < PAGE_CHIP_EDGE_SCROLL_ZONE) {
    const intensity = 1 - Math.max(0, clientY) / PAGE_CHIP_EDGE_SCROLL_ZONE;
    delta = -Math.max(2, Math.round(PAGE_CHIP_EDGE_SCROLL_SPEED * intensity));
    if (window.scrollY <= 0) delta = 0;
  } else if (clientY > bottomZone) {
    const intensity = Math.min(1, (clientY - bottomZone) / PAGE_CHIP_EDGE_SCROLL_ZONE);
    delta = Math.max(2, Math.round(PAGE_CHIP_EDGE_SCROLL_SPEED * intensity));
    if (window.scrollY >= maxScroll) delta = 0;
  }

  if (!delta) {
    stopPageChipAutoScroll();
    return;
  }

  if (pageChipAutoScrollRaf) return;

  pageChipAutoScrollRaf = requestAnimationFrame(() => {
    pageChipAutoScrollRaf = 0;
    if (!pageChipDragState || !draggedPageChipId) return;
    const x = pageChipDragState.lastClientX;
    const y = pageChipDragState.lastClientY;
    if (x == null || y == null) return;
    window.scrollBy(0, delta);
    // The page moved under a stationary pointer, so the drop target must be
    // resolved again at the same viewport point.
    previewPageChipOrder(x, y);
    updatePageChipAutoScroll(x, y);
  });
}

function clearPageChipDragState({ removeNode = false } = {}) {
  stopPageChipAutoScroll();
  const handleEl = pageChipDragState?.handleEl || null;
  const pointerId = pageChipDragState?.pointerId;
  draggedPageChipId = '';
  clearPageChipDropPreview();
  pageChipPlaceholderEl?.remove();
  pageChipPlaceholderEl = null;
  document.body.classList.remove('page-chip-list-dragging');
  document.body.classList.remove('page-chip-drag-armed');

  if (draggedPageChipEl) {
    if (removeNode) draggedPageChipEl.remove();
    draggedPageChipEl.classList.remove('is-dragging');
    draggedPageChipEl.style.removeProperty('--drag-left');
    draggedPageChipEl.style.removeProperty('--drag-top');
    draggedPageChipEl.style.removeProperty('--drag-width');
  }

  if (handleEl && pointerId != null && typeof handleEl.releasePointerCapture === 'function') {
    try {
      if (handleEl.hasPointerCapture?.(pointerId)) handleEl.releasePointerCapture(pointerId);
    } catch {}
  }

  pageChipDragState = null;
  draggedPageChipEl = null;
  document.getElementById('pageChipDragBadge')?.remove();
}

function updateDraggedPageChipPosition(clientX, clientY) {
  if (!draggedPageChipEl || !pageChipDragState) return;
  const clampedPoint = clampPageChipClientPoint(clientX, clientY);

  draggedPageChipEl.style.setProperty('--drag-left', `${clampedPoint.clientX - pageChipDragState.offsetX}px`);
  draggedPageChipEl.style.setProperty('--drag-top', `${clampedPoint.clientY - pageChipDragState.offsetY}px`);

  const badge = document.getElementById('pageChipDragBadge');
  if (badge) {
    badge.style.left = `${clampedPoint.clientX + 14}px`;
    badge.style.top = `${clampedPoint.clientY - 22}px`;
  }
}

function startPageChipDragVisuals() {
  if (!draggedPageChipEl || !pageChipDragState || pageChipDragState.moved) return;
  disableEntryAnimations();
  pageChipDragState.moved = true;
  document.body.classList.add('page-chip-list-dragging');
  draggedPageChipEl.classList.add('is-dragging');
  draggedPageChipEl.style.setProperty('--drag-width', `${draggedPageChipEl.getBoundingClientRect().width}px`);
  ensurePageChipPlaceholder();
  // Batch feedback: show how many rows are moving.
  updatePageChipDragBadge(pageChipDragState.movingChipIds?.length || 1);
  logPageChipDragDebug('drag-start', {
    groupKey: pageChipDragState.sourceGroupKey,
    chip: draggedPageChipId,
  });
}

function updatePageChipDragBadge(count) {
  let badge = document.getElementById('pageChipDragBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'pageChipDragBadge';
    badge.className = 'page-chip-drag-badge';
    document.body.appendChild(badge);
  }
  badge.textContent = count > 1 ? `×${count}` : '';
  badge.style.display = count > 1 ? '' : 'none';
}

function syncPageChipDropTarget(clientX, clientY) {
  const clampedPoint = clampPageChipClientPoint(clientX, clientY);
  const dropTarget = getPageChipDropTarget(clampedPoint.clientX, clampedPoint.clientY);
  if (!pageChipDragState || !draggedPageChipId) return;

  if (!dropTarget) {
    const previous = pageChipDragState.debugTargetSignature || '';
    pageChipDragState.dropGroupKey = '';
    pageChipDragState.dropListEl = null;
    pageChipDragState.dropCardEl = null;
    pageChipDragState.createNewGroup = false;
    pageChipDragState.newGroupPlacement = '';
    pageChipDragState.insertBeforeCardEl = null;
    pageChipDragState.lastResolvedDropTarget = null;
    pageChipPlaceholderEl?.remove();
    clearPageChipDropPreview();
    pageChipDragState.debugTargetSignature = 'none';
    if (previous !== 'none') {
      logPageChipDragDebug('target', { kind: 'none', x: Math.round(clampedPoint.clientX), y: Math.round(clampedPoint.clientY) });
    }
    return;
  }

  if (dropTarget.kind === 'new-group') {
    pageChipDragState.dropGroupKey = '';
    pageChipDragState.dropListEl = null;
    pageChipDragState.dropCardEl = null;
    pageChipDragState.createNewGroup = true;
    pageChipDragState.newGroupPlacement = dropTarget.placement || 'after';
    pageChipDragState.insertBeforeCardEl = dropTarget.insertBeforeCardEl || null;
    pageChipDragState.lastResolvedDropTarget = {
      kind: 'new-group',
      placement: pageChipDragState.newGroupPlacement,
      insertBeforeCardEl: pageChipDragState.insertBeforeCardEl,
      reason: dropTarget.reason || '',
    };
    pageChipPlaceholderEl?.remove();
    setPageChipDropPreview(null, {
      createNewGroup: true,
      newGroupPlacement: pageChipDragState.newGroupPlacement,
      insertBeforeCardEl: pageChipDragState.insertBeforeCardEl,
    });
    const signature = `new:${pageChipDragState.newGroupPlacement}:${dropTarget.reason || ''}`;
    if (pageChipDragState.debugTargetSignature !== signature) {
      pageChipDragState.debugTargetSignature = signature;
      logPageChipDragDebug('target', {
        kind: 'new-group',
        placement: pageChipDragState.newGroupPlacement,
        reason: dropTarget.reason || '',
        x: Math.round(clampedPoint.clientX),
        y: Math.round(clampedPoint.clientY),
      });
    }
    return;
  }

  const { cardEl, listEl, groupKey } = dropTarget;
  pageChipDragState.dropGroupKey = groupKey;
  pageChipDragState.dropListEl = listEl;
  pageChipDragState.dropCardEl = cardEl;
  pageChipDragState.createNewGroup = false;
  pageChipDragState.newGroupPlacement = '';
  pageChipDragState.insertBeforeCardEl = null;
  pageChipDragState.lastResolvedDropTarget = {
    kind: 'group',
    groupKey,
    cardEl,
    listEl,
  };
  setPageChipDropPreview(cardEl);
  // Keep the count badge honest per drop context: when dropping back on the
  // source group only the rows present in this list actually reorder, while a
  // cross-group drop moves the whole batch.
  if (groupKey === pageChipDragState.sourceGroupKey) {
    const movingIds = Array.isArray(pageChipDragState.movingChipIds) ? pageChipDragState.movingChipIds : [];
    const inListCount = movingIds.filter(id => [...listEl.children].some(n => String(n.dataset?.chipSortId || '') === String(id))).length;
    updatePageChipDragBadge(inListCount);
  } else {
    updatePageChipDragBadge(Array.isArray(pageChipDragState.movingChipIds) ? pageChipDragState.movingChipIds.length : 1);
  }
  const signature = `group:${groupKey}`;
  if (pageChipDragState.debugTargetSignature !== signature) {
    pageChipDragState.debugTargetSignature = signature;
      logPageChipDragDebug('target', {
        kind: 'group',
        groupKey,
        x: Math.round(clampedPoint.clientX),
        y: Math.round(clampedPoint.clientY),
      });
    }

  return dropTarget;
}

function previewPageChipOrder(clientX, clientY) {
  const dropTarget = syncPageChipDropTarget(clientX, clientY);
  if (!dropTarget || dropTarget.kind !== 'group') return;
  const { listEl } = dropTarget;

  const placeholder = ensurePageChipPlaceholder(listEl);
  const previousRects = new Map();
  // Collapsed overflow rows are hidden (zero-size) and sit after every visible
  // row; they must not be insertion candidates, or a drop at the bottom of the
  // visible list would land the batch inside the collapsed section.
  const items = [...listEl.querySelectorAll('[data-chip-sort-id]:not(.is-dragging):not(.page-chip--collapsed)')];

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
    // Dropping below the last visible row: park the placeholder right before
    // the collapsed block (i.e. as the last visible row), not at the end.
    const firstCollapsed = listEl.querySelector('.page-chip--collapsed');
    if (firstCollapsed) listEl.insertBefore(placeholder, firstCollapsed);
    else listEl.appendChild(placeholder);
  }

  animatePageChipItems(listEl, previousRects);
}

async function saveGroupTabRowOrder(groupKey, orderIds) {
  if (!groupKey || !Array.isArray(orderIds) || !orderIds.length) return;
  // Chrome-group card rows are session-local and follow the native strip
  // order; never persist their keys into the durable per-group tab order.
  if (String(groupKey || '').startsWith('__chrome_group__:')) return;

  await saveGroupTabOrder({
    ...groupTabOrderState,
    [String(groupKey)]: orderIds.map(id => String(id)).filter(Boolean),
  });
}

function createSessionGroupFromDraggedTab(state, tab) {
  const nextName = createUniqueSessionGroupName(deriveDraggedTabGroupName(tab), state.groups);
  return addSessionGroup(state, nextName);
}

async function saveCrossGroupTabRowOrder(sourceGroupKey, targetGroupKey, targetListEl, movingIds) {
  const ids = Array.isArray(movingIds)
    ? movingIds.map(id => String(id)).filter(Boolean)
    : [String(movingIds || '')].filter(Boolean);
  if (!ids.length) return;

  // Remove every moving chip from its own source group's stored order, so a
  // selection spanning several cards cleans up every card it left.
  const chipsByGroup = {};
  for (const id of ids) {
    const groupKey = findGroupKeyForChip(id) || String(sourceGroupKey || '');
    if (!groupKey) continue;
    chipsByGroup[groupKey] = chipsByGroup[groupKey] || [];
    chipsByGroup[groupKey].push(id);
  }
  const nextState = { ...groupTabOrderState };
  for (const [groupKey, chipIds] of Object.entries(chipsByGroup)) {
    const chipSet = new Set(chipIds);
    nextState[groupKey] = getOrderedIdsForGroup(groupKey).filter(id => !chipSet.has(String(id || '')));
  }
  nextState[String(targetGroupKey)] = targetListEl
    ? buildCrossGroupTargetOrder(targetListEl, ids)
    : ids;

  await saveGroupTabOrder(nextState);
}

function buildCrossGroupTargetOrder(targetListEl, movingIds) {
  const children = [...targetListEl.children];
  const movingSet = new Set((movingIds || []).map(String).filter(Boolean));
  // Chips already in the target card are part of the batch: remove them from
  // the pre-existing order so the whole batch lands contiguously at the drop
  // point without duplicates (the batch order wins over the old position).
  const targetIds = children
    .filter(n => n.dataset?.chipSortId)
    .map(n => String(n.dataset.chipSortId))
    .filter(id => !movingSet.has(id));
  const placeholderIdx = children.findIndex(n => n === pageChipPlaceholderEl);
  const insertAt = placeholderIdx === -1
    ? targetIds.length
    : Math.min(
        children.slice(0, placeholderIdx)
          .filter(n => n.dataset?.chipSortId && !movingSet.has(String(n.dataset.chipSortId)))
          .length,
        targetIds.length
      );
  targetIds.splice(insertAt, 0, ...(movingIds || []).map(String).filter(Boolean));
  return targetIds;
}

async function moveDraggedPageChipToGroup(targetGroupKey, targetListEl = null) {
  const sourceGroupKey = pageChipDragState?.sourceGroupKey || '';
  const draggedChipId = draggedPageChipId;
  // Move the whole selection together when the dragged row is selected,
  // resolving each chip's own source card (cross-card selections work).
  const movingChipIds = getMovingPageChipIds();
  const collected = collectMovingTabIds(movingChipIds, sourceGroupKey);
  const draggedTabIds = collected.tabIds;
  const sourceGroupKeys = Object.keys(collected.groupsById);
  if (!sourceGroupKey || !draggedChipId || !draggedTabIds.length) return null;
  const targetWasManualGroup = isManualGroupKey(targetGroupKey);
  const targetGroup = getDomainGroupByKey(targetGroupKey);

  logPageChipDragDebug('move-group-begin', {
    sourceGroupKey,
    targetGroupKey,
    draggedChipId,
    movingChips: movingChipIds.join(','),
    tabIds: draggedTabIds.join(','),
  });

  // Dropping into a user-created Chrome group card joins that native group —
  // the tabs leave their previous dashboard/Chrome membership behind.
  if (targetGroup?.isChromeGroup && targetGroup.chromeGroupId != null) {
    if (typeof muteChromeGroupEvents === 'function') muteChromeGroupEvents();
    // The native group write is the source of truth. If it fails (stale tab,
    // pinned tab, deleted target group, API error), abort the move instead of
    // silently clearing saved session assignments (C1).
    try {
      await groupTabsWithStaleRetryIntoGroup(Number(targetGroup.chromeGroupId), draggedTabIds);
    } catch (err) {
      console.warn('[tab-harbor] move-to-chrome-group: join failed:', err);
      showToast(runtimeT ? runtimeT('toastGroupCreateFailed') : 'Could not join Chrome tab group');
      return null;
    }
    // Persist the FULL drop order into the native group too:
    // chrome.tabs.group appends the batch at the group tail, which would
    // diverge from the panel order when the drop lands mid-card. Build the
    // whole target order (existing rows + batch at the placeholder) and
    // reorder the native group to match it, so the strip follows the cards.
    try {
      const firstWindowId = draggedTabIds.length
        ? (await chrome.tabs.get(draggedTabIds[0]).catch(() => null))?.windowId
        : null;
      if (firstWindowId != null && typeof reorderGroupedTabs === 'function') {
        const fullTargetOrder = targetListEl
          ? buildCrossGroupTargetOrder(targetListEl, movingChipIds)
          : [];
        const orderForNative = fullTargetOrder.length
          ? fullTargetOrder
          : draggedTabIds.map(String);
        await reorderGroupedTabs(Number(targetGroup.chromeGroupId), orderForNative.map(String), Number(firstWindowId));
      }
    } catch (err) {
      // The join already succeeded; a reorder failure must not roll back the
      // move or clear the session state. Keep it observable in the console.
      console.warn('[tab-harbor] move-to-chrome-group: reorder failed:', err);
    }
    let nextState = clearTabsFromSessionGroups(sessionGroupsState, draggedTabIds);
    nextState = pruneSessionGroups(nextState, getOpenTabIdsForSessionPruning());
    try {
      await saveSessionGroups(nextState);
    } catch (err) {
      console.warn('[tab-harbor] move-to-chrome-group: session cleanup failed:', err);
      showToast(runtimeT ? runtimeT('toastBatchMergeCleanupFailed') : 'Merged tabs, but could not update saved groups');
    }
    logPageChipDragDebug('move-group-join-chrome', {
      groupId: targetGroup.chromeGroupId,
      tabCount: draggedTabIds.length,
    });
    return {
      groupKey: targetGroupKey,
      groupName: targetGroup.label || 'Group',
      targetWasManualGroup: false,
      sourceGroupKeys,
    };
  }

  // Leaving a user-created Chrome group card (dropping into a domain/manual
  // card or a new group) detaches the batch from its native group first.
  const sourceGroups = sourceGroupKeys
    .map(key => getDomainGroupByKey(key))
    .filter(Boolean);
  if (sourceGroups.some(group => group?.isChromeGroup)) {
    if (typeof muteChromeGroupEvents === 'function') muteChromeGroupEvents();
    try {
      await ungroupTabsWithStaleRetry(draggedTabIds);
    } catch (err) {
      console.warn('[tab-harbor] move-to-group: ungroup failed:', err);
      showToast(runtimeT ? runtimeT('toastGroupCreateFailed') : 'Could not leave Chrome tab group');
      return null;
    }
    logPageChipDragDebug('move-group-ungroup-chrome', {
      tabCount: draggedTabIds.length,
    });
  }

  let nextState = clearTabsFromSessionGroups(sessionGroupsState, draggedTabIds);
  const dropTarget = ensureManualDropGroup(nextState, targetGroupKey);
  nextState = reassignTabsToSessionGroup(dropTarget.nextState, draggedTabIds, dropTarget.groupId);
  nextState = pruneSessionGroups(nextState, getOpenTabIdsForSessionPruning());
  logPageChipDragDebug('move-group-save-session', {
    groupId: dropTarget.groupId,
    groupName: dropTarget.groupName,
  });
  try {
    await saveSessionGroups(nextState);
  } catch (err) {
    console.warn('[tab-harbor] move-to-manual-group: session cleanup failed:', err);
    showToast(runtimeT ? runtimeT('toastBatchMergeCleanupFailed') : 'Merged tabs, but could not update saved groups');
  }
  logPageChipDragDebug('move-group-end', {
    groupId: dropTarget.groupId,
    groupName: dropTarget.groupName,
  });

  return {
    groupKey: `${MANUAL_GROUP_PREFIX}${dropTarget.groupId}`,
    groupName: dropTarget.groupName,
    targetWasManualGroup,
    sourceGroupKeys,
  };
}

async function createSessionGroupFromDraggedPageChip() {
  const sourceGroupKey = pageChipDragState?.sourceGroupKey || '';
  const draggedChipId = draggedPageChipId;
  // Create the group from the whole selection when the dragged row is
  // selected, resolving each chip's own source card.
  const movingChipIds = getMovingPageChipIds();
  const collected = collectMovingTabIds(movingChipIds, sourceGroupKey);
  const draggedTabIds = collected.tabIds;
  const sourceGroupKeys = Object.keys(collected.groupsById);
  const movingSet = new Set(movingChipIds);
  const draggedTabs = (domainGroups || [])
    .flatMap(group => group.tabs || [])
    .filter(tab => getTabOrderTokens(tab).some(token => movingSet.has(String(token))));
  if (!sourceGroupKey || !draggedChipId || !draggedTabs.length || !draggedTabIds.length) return null;

  logPageChipDragDebug('create-group-begin', {
    sourceGroupKey,
    draggedChipId,
    movingChips: movingChipIds.join(','),
    tabIds: draggedTabIds.join(','),
  });
  let nextState = clearTabsFromSessionGroups(sessionGroupsState, draggedTabIds);
  const created = createSessionGroupFromDraggedTab(nextState, draggedTabs[0]);
  nextState = reassignTabsToSessionGroup(created.state, draggedTabIds, created.group.id);
  nextState = pruneSessionGroups(nextState, getOpenTabIdsForSessionPruning());
  logPageChipDragDebug('create-group-save-session', {
    groupId: created.group.id,
    groupName: created.group.name,
  });
  await saveSessionGroups(nextState);
  logPageChipDragDebug('create-group-save-order', {
    groupId: created.group.id,
    groupName: created.group.name,
  });
  await saveCrossGroupTabRowOrder(sourceGroupKey, `${MANUAL_GROUP_PREFIX}${created.group.id}`, null, getMovingPageChipIds());
  logPageChipDragDebug('create-group-end', {
    groupId: created.group.id,
    groupName: created.group.name,
    sourceGroups: sourceGroupKeys.join(','),
  });

  return { ...created.group, sourceGroupKeys };
}

async function finishPageChipDrag() {
  if (!draggedPageChipId || !pageChipDragState) return false;

  // Stop edge auto-scroll before the async commit so a scheduled frame cannot
  // change the drop target mid-commit.
  stopPageChipAutoScroll();

  // While a commit is in flight, Escape must not clear pageChipDragState —
  // the commit reads that state after await points (C9).
  pageChipCommitInFlight = true;

  const moved = pageChipDragState.moved;
  const sourceGroupKey = pageChipDragState.sourceGroupKey;
  const targetGroupKey = pageChipDragState.dropGroupKey || '';
  const targetListEl = pageChipDragState.dropListEl;
  const createNewGroup = pageChipDragState.createNewGroup;
  logPageChipDragDebug('finish-begin', {
    moved,
    sourceGroupKey,
    targetGroupKey,
    createNewGroup,
    placement: pageChipDragState.newGroupPlacement || '',
  });

  try {
    const changedGroupKeys = new Set();
    let requiresOpenTabsRebuild = true;
    if (moved) {
      if (targetGroupKey && targetGroupKey === sourceGroupKey && targetListEl) {
        // Batch reorder: the whole selection (snapshot taken when the drag
        // armed) moves together to the drop point. Rows from other cards are
        // simply not present in this list, so they are ignored here.
        const movingIds = getMovingPageChipIds();
        const orderIds = buildBatchOrderedIdsFromList(targetListEl, movingIds);
        logPageChipDragDebug('finish-reorder-save', { orderCount: orderIds.length, moving: movingIds.join(',') });
        await saveGroupTabRowOrder(sourceGroupKey, orderIds);
        if (pageChipPlaceholderEl && movingIds.length) {
          const movingSet = new Set(movingIds);
          const movingEls = [...targetListEl.querySelectorAll('[data-chip-sort-id]')]
            .filter(el => movingSet.has(String(el.dataset.chipSortId || '')));
          for (const el of movingEls) targetListEl.insertBefore(el, pageChipPlaceholderEl);
        }
        // User-created Chrome group cards persist their in-group order to the
        // native group too (syncChromeTabGroups skips them by design).
        const sourceGroup = getDomainGroupByKey(sourceGroupKey);
        if (sourceGroup?.isChromeGroup && sourceGroup.chromeGroupId != null
            && typeof reorderGroupedTabs === 'function') {
          const windowId = sourceGroup.tabs?.[0]?.windowId;
          if (windowId != null) {
            await reorderGroupedTabs(Number(sourceGroup.chromeGroupId), orderIds.map(String), windowId);
          }
        }
        // Defensive: the order was persisted from the placeholder position; if
        // the placeholder is somehow missing, fall back to a full re-render so
        // the DOM cannot diverge from the stored order.
        requiresOpenTabsRebuild = !pageChipPlaceholderEl;
      } else if (targetGroupKey) {
        const movedGroup = await moveDraggedPageChipToGroup(targetGroupKey, targetListEl);
        if (movedGroup) {
          disableChromeTabGroupsImportModeForLocalEdits();
          changedGroupKeys.add(sourceGroupKey);
          for (const g of (movedGroup.sourceGroupKeys || [])) changedGroupKeys.add(g);
          changedGroupKeys.add(movedGroup.groupKey);
          if (!movedGroup.targetWasManualGroup) {
            const nextGroupOrder = buildPersistentGroupOrderReplacingKey(movedGroup.groupKey, targetGroupKey);
            await persistGroupOrder(nextGroupOrder);
          }
          logPageChipDragDebug('finish-save-cross-order', { groupKey: movedGroup.groupKey });
          await saveCrossGroupTabRowOrder(sourceGroupKey, movedGroup.groupKey, targetListEl, getMovingPageChipIds());
          logPageChipDragDebug('finish-group-move', { groupKey: movedGroup.groupKey, groupName: movedGroup.groupName });
          // The rows left their cards — clear the selection so no residual
          // highlight lingers in the new group and invites an accidental re-drag.
          clearPageChipSelection();
        }
      } else if (createNewGroup) {
        // Leaving a user-created Chrome group card detaches the batch from its
        // native group; the new manual group stays dashboard-internal.
        // Ungroup EVERY moving tab that currently lives in a Chrome group, not
        // just the anchor chip's source card (C23).
        if (typeof muteChromeGroupEvents === 'function') muteChromeGroupEvents();
        const allMovingCollected = collectMovingTabIds(getMovingPageChipIds(), '');
        const chromeOwnedMovingTabIds = allMovingCollected.tabIds.filter(id => {
          const tab = openTabs.find(t => Number(t.id) === Number(id));
          return tab && Number.isInteger(tab.groupId) && tab.groupId >= 0;
        });
        if (chromeOwnedMovingTabIds.length) {
          try {
            await ungroupTabsWithStaleRetry(chromeOwnedMovingTabIds);
          } catch (err) {
            console.warn('[tab-harbor] create-new-group: ungroup failed:', err);
            showToast(runtimeT ? runtimeT('toastGroupCreateFailed') : 'Could not leave Chrome tab group');
            clearPageChipDragState({ removeNode: false });
            return false;
          }
        }
        const createdGroup = await createSessionGroupFromDraggedPageChip();
        if (createdGroup) {
          disableChromeTabGroupsImportModeForLocalEdits();
          changedGroupKeys.add(sourceGroupKey);
          for (const g of (createdGroup.sourceGroupKeys || [])) changedGroupKeys.add(g);
          const createdGroupKey = `${MANUAL_GROUP_PREFIX}${createdGroup.id}`;
          changedGroupKeys.add(createdGroupKey);
          const nextGroupOrder = buildPersistentGroupOrderWithInsertedGroup(createdGroupKey, {
            insertBeforeGroupKey: pageChipDragState.insertBeforeCardEl?.dataset?.groupId || '',
            placement: pageChipDragState.newGroupPlacement || 'after',
          });
          await persistGroupOrder(nextGroupOrder);
          logPageChipDragDebug('create-group-save-group-order', {
            orderCount: nextGroupOrder.length,
          });
          logPageChipDragDebug('finish-new-group', { groupName: createdGroup.name });
          // Same as cross-group moves: the batch now lives in a fresh group,
          // so drop the selection to avoid residual highlights.
          clearPageChipSelection();
        }
      } else {
        // Dropped outside any valid target (dead zone): cancel the drag and
        // restore the rows. Removing them here would hide open tabs from the
        // view until the next full render, since the source card is not
        // patched in this path.
        logPageChipDragDebug('finish-dead-zone-cancel', { moved });
        clearPageChipDragState({ removeNode: false });
        return true;
      }

      clearPageChipDragState({ removeNode: requiresOpenTabsRebuild });
      suppressPageChipClickUntil = Date.now() + 250;
      if (!requiresOpenTabsRebuild) {
        logPageChipDragDebug('finish-local-reorder-commit', { groupKey: sourceGroupKey });
        await syncChromeTabGroupsWithoutImportEcho();
      } else {
        logPageChipDragDebug('finish-open-tabs-patch-begin', { moved, changedGroups: [...changedGroupKeys].join(',') });
        await renderOpenTabsLayout({
          rebuildGroups: true,
          syncChrome: true,
          patchDom: true,
          changedGroupKeys: [...changedGroupKeys],
        });
        logPageChipDragDebug('finish-open-tabs-patch-end', { moved });
      }
    } else {
      clearPageChipDragState({ removeNode: moved });
    }

    logPageChipDragDebug('finish-end', { moved });
    return true;
  } catch (error) {
    logPageChipDragDebug('finish-error', {
      message: error?.message || String(error),
    });
    throw error;
  } finally {
    pageChipCommitInFlight = false;
  }
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
  const navListEl = document.querySelector('#workspaceTopNav .group-nav-list[data-nav-kind="open-tabs"]');
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

  nextState = pruneSessionGroups(nextState, getOpenTabIdsForSessionPruning());
  return saveSessionGroups(nextState);
}

/**
 * ensureWindowsKeepLastTab(allTabs, toCloseIds)
 *
 * Never close the last tab of any window: removing a window's final tab
 * closes the window, and removing the final tab of the last window exits
 * the browser. Returns the ids that may safely be closed.
 */
function ensureWindowsKeepLastTab(allTabs, toCloseIds) {
  const toCloseSet = new Set(toCloseIds || []);
  const winIds = new Set(allTabs.filter(t => toCloseSet.has(t.id)).map(t => t.windowId));
  for (const winId of winIds) {
    const winTabs = allTabs.filter(t => t.windowId === winId);
    if (winTabs.length > 0 && winTabs.every(t => toCloseSet.has(t.id))) {
      const keep = winTabs.find(t => t.active) || winTabs[0];
      toCloseSet.delete(keep.id);
    }
  }
  return [...toCloseSet];
}

/**
 * focusTab(url, tabId = null)
 *
 * Switches Chrome to a tab: a numeric tabId wins, otherwise the URL is
 * matched (exact match first, then hostname fallback). Also brings the
 * window to the front.
 */
async function focusTab(url, tabId = null) {
  if (!url && !tabId) return;
  const numericTabId = getTabIdValue(tabId);
  if (numericTabId != null) {
    try {
      const targetTab = await chrome.tabs.get(numericTabId);
      if (targetTab?.id != null) {
        await chrome.tabs.update(targetTab.id, { active: true });
        await chrome.windows.update(targetTab.windowId, { focused: true });
        return true;
      }
    } catch { /* fall back to URL matching */ }
  }

  const allTabs = await queryTabsForDashboardWindow();
  const targetUrl = runtimeGetCanonicalTabUrl ? runtimeGetCanonicalTabUrl(url || '') : url;

  // Try exact URL match first
  let matches = allTabs.filter(t => getTabCanonicalUrl(t) === targetUrl || t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(targetUrl).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(getTabCanonicalUrl(t)).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return false;

  const match = matches.find(t => t.active) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
  return true;
}

/**
 * normalizeNewTabUrlForComparison(url)
 *
 * The focus-redirect appends `?focus=1` to the new-tab page URL (see
 * focus-redirect.js). A Tab Harbor new-tab page may therefore appear with or
 * without that query across different tabs/windows. Strip query + hash so the
 * comparison identifies the page regardless of the focus parameter.
 */
function normalizeNewTabUrlForComparison(rawUrl = '') {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(rawUrl).split(/[?#]/)[0] || rawUrl;
  }
}

function isTabHarborNewTabUrl(rawUrl = '') {
  const url = String(rawUrl || '');
  if (url === 'chrome://newtab/') return true;
  // The current page IS a Tab Harbor new-tab page; compare normalized forms so
  // the ?focus=1 query (and any hash) does not break the match.
  return normalizeNewTabUrlForComparison(url) === normalizeNewTabUrlForComparison(window.location.href);
}

async function navigateCurrentTabToUrl(url) {
  if (!url) return false;
  // Prefer the dashboard's own cached tab id when it is still live — this
  // skips a chrome.tabs.query round-trip so the search navigation starts
  // immediately (a real-perceived-latency win on the search submit path).
  if (currentDashboardTabId != null) {
    try {
      await chrome.tabs.update(currentDashboardTabId, { url });
      return true;
    } catch {
      // Tab was replaced/closed; fall through to the query path.
    }
  }
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return false;
  await chrome.tabs.update(activeTab.id, { url });
  return true;
}

async function openOrFocusUrl(url) {
  if (!url) return false;
  await chrome.tabs.create({ url, active: true });
  return true;
}

function syncSearchPlaceholder() {
  const input = document.getElementById('headerSearchInput');
  if (!input) return;
  const engine = runtimeGetSearchEngine ? runtimeGetSearchEngine() : 'default';
  let placeholder = '';
  if (engine === 'custom') {
    const customUrl = ((typeof themePreferences !== 'undefined' && themePreferences.customSearchUrl) || '').trim();
    placeholder = customUrl
      ? (runtimeT ? runtimeT('searchPlaceholderCustom') : 'Search with a custom engine...')
      : (runtimeT ? runtimeT('searchPlaceholderDefault') : 'Search with your default engine...');
  } else if (engine !== 'default') {
    const labelKey = SEARCH_ENGINE_LABEL_KEYS[engine] || '';
    const engineName = labelKey
      ? (runtimeT ? runtimeT(labelKey) : (runtimeSearchEnginePresets?.[engine]?.name || ''))
      : (runtimeSearchEnginePresets?.[engine]?.name || '');
    placeholder = runtimeT
      ? runtimeT('searchPlaceholderEngine', { engine: engineName })
      : `Search with ${engineName}...`;
  } else {
    placeholder = runtimeT ? runtimeT('searchPlaceholderDefault') : 'Search with your default engine...';
  }
  input.setAttribute('placeholder', placeholder);
  const hint = document.getElementById('headerSearchSuggestionsHint');
  if (hint) {
    hint.textContent = runtimeT ? runtimeT('suggestHintArrows') : 'Use ↑↓ to move, Enter to open';
  }
}

async function runDefaultSearch(query) {
  const text = String(query || '').trim();
  if (!text) return;

  const searchUrl = runtimeBuildSearchUrlForQuery ? runtimeBuildSearchUrlForQuery(text) : '';
  if (searchUrl) {
    let validSearchUrl = false;
    try {
      validSearchUrl = /^https?:$/.test(new URL(searchUrl).protocol);
    } catch {
      validSearchUrl = false;
    }
    if (validSearchUrl) {
      const navigated = await navigateCurrentTabToUrl(searchUrl).catch(() => false);
      if (navigated) return;
      // Navigation failed (rare) — fall through to the browser search path.
    } else {
      showToast(runtimeT ? runtimeT('toastInvalidCustomSearchUrl') : 'Invalid custom search URL, using browser default');
    }
  }

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

/* ----------------------------------------------------------------
   SEARCH SUGGESTIONS — inline panel under the header search field
   ----------------------------------------------------------------
   Sources (union, de-duplicated by URL):
     1. open tabs in the current window (type 'tab')
     2. quick shortcuts (type 'shortcut')
     3. Chrome bookmarks (type 'bookmark')
     4. saved session tabs (type 'session')
     5. browser history (type 'history') — only when chrome.history exists
   The panel is keyboard-navigable (ArrowUp/Down, Enter, Escape) and follows
   the quiet visual language of the rest of the dashboard.
   ---------------------------------------------------------------- */

const SEARCH_SUGGESTION_SOURCES = ['tab', 'shortcut', 'bookmark', 'session', 'history'];
const SEARCH_SUGGESTIONS_MAX = 12;
const SEARCH_HISTORY_CACHE_TTL_MS = 30000;
const SEARCH_SUGGESTION_DEBOUNCE_MS = 120;

function getSearchSuggestionsInput() {
  return document.getElementById('headerSearchInput');
}

function getSearchSuggestionsPanel() {
  return document.getElementById('headerSearchSuggestions');
}

function searchSuggestionsAvailable() {
  return typeof chrome !== 'undefined' && !!chrome.history && typeof chrome.history.search === 'function';
}

function getBookmarksShelfMessages() {
  const message = (key, fallback) => runtimeT ? runtimeT(key) : fallback;
  return {
    shelfLabel: message('bookmarksShelfLabel', 'Chrome bookmarks'),
    searchLabel: message('bookmarksSearchLabel', 'Search bookmarks'),
    searchPlaceholder: message('bookmarksSearchPlaceholder', 'Search bookmarks…'),
    openManager: message('bookmarksOpenManager', 'Open bookmark manager'),
    enableTitle: message('bookmarksEnableTitle', 'Keep bookmarks close'),
    enableBody: message('bookmarksEnableBody', 'Allow read-only access. Nothing is copied or changed.'),
    enableAction: message('bookmarksEnableAction', 'Show bookmarks'),
    deniedTitle: message('bookmarksDeniedTitle', 'Bookmark access was not granted'),
    deniedBody: message('bookmarksDeniedBody', 'You can try again whenever you like.'),
    revokedTitle: message('bookmarksRevokedTitle', 'Bookmark access was removed'),
    revokedBody: message('bookmarksRevokedBody', 'Enable it again to browse here.'),
    checking: message('bookmarksChecking', 'Checking bookmark access…'),
    loading: message('bookmarksLoading', 'Opening your bookmarks…'),
    searching: message('bookmarksSearching', 'Searching bookmarks…'),
    emptyFolder: message('bookmarksEmptyFolder', 'This folder is empty.'),
    emptySearch: message('bookmarksEmptySearch', 'No matching bookmarks.'),
    emptyTree: message('bookmarksEmptyTree', 'The bookmarks bar is empty.'),
    errorTitle: message('bookmarksErrorTitle', 'Bookmarks are quiet for the moment'),
    errorBody: message('bookmarksErrorBody', 'Chrome could not return them. Nothing was changed.'),
    retry: message('bookmarksRetry', 'Try again'),
    folderLabel: message('bookmarksFolderLabel', 'Folder'),
    bookmarkLabel: message('bookmarksBookmarkLabel', 'Bookmark'),
    breadcrumbsLabel: message('bookmarksBreadcrumbsLabel', 'Bookmark folders'),
    rootFallback: message('bookmarksRootFallback', 'Bookmarks'),
    clearSearch: message('bookmarksClearSearch', 'Clear'),
    blockedUrl: message('bookmarksBlockedUrl', 'This bookmark type cannot be opened here.'),
    openFailed: message('bookmarksOpenFailed', 'This bookmark could not be opened.'),
  };
}

function setupBookmarksShelf() {
  if (bookmarksShelfController) return bookmarksShelfController;
  const host = document.getElementById('bookmarksShelfHost');
  const mountShelf = globalThis.TabHarborBookmarksShelf?.mountBookmarksShelf;
  if (!host || typeof mountShelf !== 'function') return null;

  const refreshOpenSuggestions = () => {
    if (searchSuggestionsOpen) void refreshSearchSuggestions(true);
  };
  bookmarksShelfController = mountShelf(host, {
    chromeApi: chrome,
    document,
    location,
    getFaviconUrl: runtimeGetFaviconUrl,
    showFavicons: typeof themePreferences !== 'undefined' && themePreferences.bookmarksShowFavicons === true,
    messages: getBookmarksShelfMessages(),
    onStateChange: refreshOpenSuggestions,
    onBookmarksChange: refreshOpenSuggestions,
  });
  return bookmarksShelfController;
}

function getSearchSuggestionSectionLabel(type) {
  switch (type) {
    case 'tab': return runtimeT ? runtimeT('suggestSectionTabs') : 'Open tabs';
    case 'shortcut': return runtimeT ? runtimeT('suggestSectionShortcuts') : 'Quick links';
    case 'bookmark': return runtimeT ? runtimeT('suggestSectionBookmarks') : 'Bookmarks';
    case 'session': return runtimeT ? runtimeT('suggestSectionSessions') : 'Saved sessions';
    case 'history': return runtimeT ? runtimeT('suggestSectionHistory') : 'History';
    default: return '';
  }
}

async function loadSearchSuggestionSources() {
  // Tabs come from the dashboard's own in-memory snapshot (already filtered to
  // the current window and canonicalized).
  const tabs = getRealTabs().map(tab => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl || '',
    windowId: tab.windowId,
  }));

  // Read shortcuts and sessions in parallel: both are independent
  // chrome.storage calls, and running them concurrently keeps the whole
  // suggestion refresh shorter, so fewer chrome.* calls are still queued when
  // the user hits Enter to search.
  const [shortcuts, sessions] = await Promise.all([
    (async () => {
      if (typeof globalThis.TabOutThemeControls?.getQuickShortcuts === 'function') {
        return await globalThis.TabOutThemeControls.getQuickShortcuts();
      }
      return [];
    })(),
    (async () => {
      if (typeof runtimeGetSavedTabSessions === 'function') {
        return await runtimeGetSavedTabSessions();
      }
      return [];
    })(),
  ]);

  // Reading the controller's in-memory snapshot never requests permission.
  // Only the explicit button inside the bookmarks shelf may do that.
  const bookmarks = typeof bookmarksShelfController?.getSearchItems === 'function'
    ? bookmarksShelfController.getSearchItems()
    : [];

  return { tabs, shortcuts, bookmarks, sessions };
}

async function loadSearchHistoryCache() {
  if (!searchSuggestionsAvailable()) {
    searchSuggestionsHistoryCache = null;
    return [];
  }
  const now = Date.now();
  if (searchSuggestionsHistoryCache && now - searchSuggestionsHistoryCacheTime < SEARCH_HISTORY_CACHE_TTL_MS) {
    return searchSuggestionsHistoryCache;
  }
  try {
    // Empty text returns the most recent browsing history — exactly what a
    // default (no-query) suggestion panel wants. Deeper filtering happens
    // client-side against this bounded cache.
    const items = await chrome.history.search({
      text: '',
      maxResults: 20,
      startTime: 0,
    });
    searchSuggestionsHistoryCache = items.map(item => ({
      url: item.url,
      title: item.title || item.url,
      visitCount: item.visitCount || 0,
      lastVisitTime: item.lastVisitTime || 0,
    }));
    searchSuggestionsHistoryCacheTime = now;
    return searchSuggestionsHistoryCache;
  } catch (err) {
    if (isExtensionContextInvalidated(err)) recoverFromInvalidatedExtensionContext();
    console.warn('[tab-harbor] history search failed:', err);
    searchSuggestionsHistoryCache = null;
    return [];
  }
}

async function refreshSearchSuggestions(force = false) {
  const input = getSearchSuggestionsInput();
  const panel = getSearchSuggestionsPanel();
  if (!input || !panel) return;

  const query = input.value || '';
  if (query === searchSuggestionsQuery && !force) return;

  // The panel only ever shows for a non-empty query: empty input means no
  // suggestions, no matter who calls refresh (focus, tab change, debounce).
  if (!query) {
    closeSearchSuggestions();
    return;
  }

  // Every request receives its own token. A newer query, a submit, or a panel
  // close invalidates all older async source reads before they can touch DOM.
  const gen = ++searchSuggestionsGeneration;
  searchSuggestionsQuery = query;

  const [sources, history] = await Promise.all([
    loadSearchSuggestionSources(),
    loadSearchHistoryCache(),
  ]);
  // A search was submitted (or the panel otherwise invalidated) while we were
  // awaiting chrome.* — discard this stale refresh instead of rendering it.
  if (gen !== searchSuggestionsGeneration || input.value !== query) return;
  let rows;
  if (typeof globalThis.TabHarborSearchSuggestions?.assembleSuggestions === 'function') {
    rows = globalThis.TabHarborSearchSuggestions.assembleSuggestions({
      ...sources,
      history,
    }, query);
  } else {
    rows = [
      ...sources.tabs.map(tab => ({ type: 'tab', url: tab.url, title: tab.title || tab.url, tabId: tab.id })),
      ...sources.shortcuts.map(shortcut => ({ type: 'shortcut', url: shortcut.url, title: shortcut.label || shortcut.url })),
      ...sources.bookmarks.map(bookmark => ({ type: 'bookmark', bookmarkId: bookmark.id, url: bookmark.url, title: bookmark.title || bookmark.url, folderPath: bookmark.folderPath || '' })),
      ...history.map(item => ({ type: 'history', url: item.url, title: item.title || item.url })),
    ].slice(0, SEARCH_SUGGESTIONS_MAX);
  }
  searchSuggestionsRows = rows;

  if (!rows.length) {
    closeSearchSuggestions();
    return;
  }

  openSearchSuggestions();
  renderSearchSuggestions(rows, query);
}

function renderSearchSuggestions(rows = [], query = '') {
  const panel = getSearchSuggestionsPanel();
  if (!panel) return;
  const input = getSearchSuggestionsInput();
  input?.removeAttribute('aria-activedescendant');
  searchSuggestionsSelectedIndex = -1;

  if (!rows.length) {
    panel.innerHTML = '';
    panel.hidden = true;
    if (input) input.setAttribute('aria-expanded', 'false');
    return;
  }

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.type)) grouped.set(row.type, []);
    grouped.get(row.type).push(row);
  }

  let html = '';
  for (const type of SEARCH_SUGGESTION_SOURCES) {
    const groupRows = grouped.get(type);
    if (!groupRows || !groupRows.length) continue;
    const label = getSearchSuggestionSectionLabel(type);
    html += `<div class="header-search-suggestion-section" data-suggestion-section="${type}">`;
    if (label) html += `<div class="header-search-suggestion-section-label">${runtimeEscapeHtml ? runtimeEscapeHtml(label) : label}</div>`;
    groupRows.forEach(row => {
      const safeTitle = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(row.title || row.url || '') : String(row.title || row.url || '').replace(/"/g, '&quot;');
      const safeUrl = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(row.url || '') : String(row.url || '').replace(/"/g, '&quot;');
      const bookmarksShowFavicons = typeof themePreferences !== 'undefined'
        && themePreferences.bookmarksShowFavicons === true;
      const shouldResolveIcon = row.type !== 'bookmark' || bookmarksShowFavicons;
      const iconData = shouldResolveIcon && runtimeGetIconSources
        ? runtimeGetIconSources(row, 16)
        : { sources: [] };
      const selectIconSources = globalThis.TabHarborSearchSuggestions?.selectSuggestionIconSources;
      const selectedIconSources = typeof selectIconSources === 'function'
        ? selectIconSources(row, iconData.sources, {
            bookmarksShowFavicons,
          })
        : row.type === 'bookmark'
          ? { faviconUrl: '', fallbackUrl: '' }
          : {
              faviconUrl: iconData.sources?.[0] || '',
              fallbackUrl: iconData.sources?.[1] || '',
            };
      const faviconUrl = selectedIconSources.faviconUrl || '';
      const fallbackUrl = selectedIconSources.fallbackUrl || '';
      const fallbackLabel = runtimeGetFallbackLabel ? runtimeGetFallbackLabel(row.title || row.url, iconData.hostname) : '';
      const safeFaviconUrl = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(faviconUrl) : String(faviconUrl).replace(/"/g, '&quot;');
      const safeFallbackUrl = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(fallbackUrl) : String(fallbackUrl).replace(/"/g, '&quot;');
      const resultId = getSearchSuggestionResultId(row);
      const safeBookmarkId = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(row.bookmarkId || '') : String(row.bookmarkId || '').replace(/"/g, '&quot;');
      const supportingText = row.type === 'bookmark' && row.folderPath ? row.folderPath : row.url || '';
      html += `<div class="header-search-suggestion-row" id="${resultId}" role="option" data-suggestion-type="${row.type}" data-suggestion-url="${safeUrl}" data-suggestion-tab-id="${row.tabId != null ? row.tabId : ''}" data-suggestion-bookmark-id="${safeBookmarkId}" aria-selected="false" tabindex="-1">
        <span class="header-search-suggestion-icon">${faviconUrl ? `<img src="${safeFaviconUrl}" alt="" data-fallback-src="${safeFallbackUrl}">` : ''}</span>
        <span class="header-search-suggestion-title">${runtimeEscapeHtml ? runtimeEscapeHtml(row.title || row.url) : String(row.title || row.url)}</span>
        <span class="header-search-suggestion-url">${runtimeEscapeHtml ? runtimeEscapeHtml(supportingText) : String(supportingText)}</span>
      </div>`;
    });
    html += '</div>';
  }

  panel.innerHTML = html;
  panel.hidden = false;
  if (input) input.setAttribute('aria-expanded', 'true');
  setupSearchSuggestionImageFallbacks(panel);
}

function getSearchSuggestionResultId(row = {}) {
  const source = `${row.type || 'result'}|${row.tabId ?? row.bookmarkId ?? row.url ?? ''}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `header-search-result-${(hash >>> 0).toString(36)}`;
}

function setupSearchSuggestionImageFallbacks(panel) {
  panel.querySelectorAll('img[data-fallback-src]').forEach(img => {
    if (img.dataset.errorHandlerAttached) return;
    img.addEventListener('error', function handleSuggestionIconError() {
      const fallbackSrc = this.dataset.fallbackSrc;
      if (fallbackSrc && this.dataset.fallbackApplied !== 'true') {
        this.dataset.fallbackApplied = 'true';
        this.src = fallbackSrc;
        return;
      }
      this.style.display = 'none';
    });
    img.dataset.errorHandlerAttached = 'true';
  });
}

function openSearchSuggestions() {
  const panel = getSearchSuggestionsPanel();
  if (!panel) return;
  searchSuggestionsOpen = true;
  searchSuggestionsSelectedIndex = -1;
  panel.hidden = false;
}

function closeSearchSuggestions({ restoreFocus = false } = {}) {
  const panel = getSearchSuggestionsPanel();
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = '';
  }
  const input = getSearchSuggestionsInput();
  if (input) input.setAttribute('aria-expanded', 'false');
  input?.removeAttribute('aria-activedescendant');
  searchSuggestionsOpen = false;
  searchSuggestionsSelectedIndex = -1;
  searchSuggestionsRows = [];
  searchSuggestionsQuery = '';
  if (searchSuggestionsDebounceTimer) {
    clearTimeout(searchSuggestionsDebounceTimer);
    searchSuggestionsDebounceTimer = null;
  }
  // Invalidate any in-flight suggestion refresh so its pending chrome.* calls
  // are discarded (their results would be stale anyway) and do not contend
  // with the navigation's chrome.* calls in the extension page API queue.
  searchSuggestionsGeneration += 1;
  if (restoreFocus && input) input.focus({ preventScroll: true });
}

function selectSearchSuggestionIndex(nextIndex) {
  const rows = Array.from(document.querySelectorAll('.header-search-suggestion-row'));
  if (!rows.length) return;
  const count = rows.length;
  if (nextIndex < 0) nextIndex = count - 1;
  if (nextIndex >= count) nextIndex = 0;
  searchSuggestionsSelectedIndex = nextIndex;

  rows.forEach((row, index) => {
    const selected = index === nextIndex;
    row.classList.toggle('is-selected', selected);
    row.setAttribute('aria-selected', String(selected));
    if (selected) {
      getSearchSuggestionsInput()?.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    }
  });
}

async function activateSearchSuggestion(row, { openInNewTab = false, shiftKey = false, button = 0 } = {}) {
  if (!row) return;
  const type = row.dataset.suggestionType || '';
  const url = row.dataset.suggestionUrl || '';
  const tabId = row.dataset.suggestionTabId || '';
  const bookmarkId = row.dataset.suggestionBookmarkId || '';

  if (type === 'bookmark' && bookmarkId && bookmarksShelfController?.openBookmark) {
    closeSearchSuggestions();
    await bookmarksShelfController.openBookmark(bookmarkId, {
      ctrlKey: openInNewTab,
      metaKey: openInNewTab,
      shiftKey,
      button,
    });
    return;
  }

  if (type === 'tab' && tabId && !openInNewTab) {
    const numericTabId = getTabIdValue(tabId);
    if (numericTabId != null) {
      closeSearchSuggestions();
      try {
        const targetTab = await chrome.tabs.get(numericTabId);
        if (targetTab?.id != null) {
          await chrome.tabs.update(targetTab.id, { active: true });
          await chrome.windows.update(targetTab.windowId, { focused: true });
          return;
        }
      } catch { /* fall through to URL open */ }
    }
  }

  if (!url) return;
  closeSearchSuggestions();
  if (shiftKey) {
    await chrome.windows.create({ url, focused: true }).catch(err => {
      if (isExtensionContextInvalidated(err)) recoverFromInvalidatedExtensionContext();
      console.warn('[tab-harbor] failed to open suggestion in new window:', err);
    });
    return;
  }
  if (openInNewTab || button === 1) {
    await chrome.tabs.create({ url, active: false }).catch(err => {
      if (isExtensionContextInvalidated(err)) recoverFromInvalidatedExtensionContext();
      console.warn('[tab-harbor] failed to open suggestion in new tab:', err);
    });
    return;
  }
  await openOrFocusUrl(url);
}

async function handleSearchSuggestionKeydown(e) {
  const input = getSearchSuggestionsInput();
  if (!input || document.activeElement !== input) return;

  // An Enter while the input method editor (IME) is composing a candidate —
  // e.g. a Chinese/Japanese input method where Enter confirms the chosen
  // word — must NOT submit the search. Block the default submit and return;
  // the search runs only on a "real" Enter outside composition.
  if (e.key === 'Enter' && (searchSuggestionsIsComposing || e.isComposing)) {
    e.preventDefault();
    return;
  }

  // Enter always starts the search here (one event-loop turn earlier than the
  // form submit), whether or not the suggestion panel is open. The panel is
  // only relevant for picking a highlighted row.
  if (e.key === 'Enter') {
    if (searchSuggestionsOpen) {
      const selected = document.querySelector('.header-search-suggestion-row.is-selected');
      if (selected) {
        e.preventDefault();
        await activateSearchSuggestion(selected, { openInNewTab: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
        return;
      }
    }
    // Nothing selected: start the search immediately from the keydown so the
    // navigation begins a full event-loop turn earlier than waiting for the
    // form submit. Prevent the submit listener from running it a second time.
    e.preventDefault();
    const query = input.value || '';
    closeSearchSuggestions();
    // Stop any pending self-focus retries before we navigate away — a timer
    // firing during the teardown adds nothing and can contend with the
    // navigation's chrome.* calls.
    cancelSearchFocusRetryIfInteracting();
    searchSubmitInFlight = true;
    try {
      await runDefaultSearch(query);
    } finally {
      // preventDefault on keydown stops the form submit, so the flag is never
      // consumed by the submit listener; clear it here (a navigation usually
      // unloads the page anyway, but an empty query must not leave it stuck).
      searchSubmitInFlight = false;
    }
    return;
  }

  if (!searchSuggestionsOpen) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectSearchSuggestionIndex(searchSuggestionsSelectedIndex + 1);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectSearchSuggestionIndex(searchSuggestionsSelectedIndex - 1);
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSearchSuggestions({ restoreFocus: true });
    return;
  }
}

function shouldAutoFocusSearchField() {
  const active = document.activeElement;
  if (!active) return true;
  if (active.id === 'headerSearchInput') return false;
  // Never steal focus from another form field the user may be typing in.
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (active.isContentEditable) return false;
  return true;
}

// Retry schedule for claiming the search-field focus on new-tab load.
// Chrome focuses the omnibox after a fresh newtab (Ctrl+T) renders, which can
// override an earlier focus() call. Refresh-on-the-same-tab usually keeps the
// focus, which is why Ctrl+T behaves differently. We retry across a wide
// window (up to ~5s) with increasing delays, and stop as soon as the input
// holds focus or the user interacts with the page.
const SEARCH_FOCUS_RETRY_DELAYS_MS = [150, 400, 900, 1800, 3200, 5000];
let searchFocusRetryTimer = null;
let searchFocusRetryAttempt = 0;

function focusSearchFieldOnForeground() {
  if (!shouldAutoFocusSearchField()) return;
  const input = getSearchSuggestionsInput();
  if (!input) return;
  // Avoid re-focusing in the same tick as a user click that just landed on
  // another control (focusin fires after pointerdown on some platforms).
  if (Date.now() < searchSuggestionsFocusGuardUntil) return;
  input.focus({ preventScroll: true });
  // Verify the focus actually landed; if the browser grabbed it back (e.g. the
  // omnibox on a fresh newtab), retry on a short schedule.
  scheduleSearchFocusVerification();
}

function scheduleSearchFocusVerification() {
  if (searchFocusRetryTimer) clearTimeout(searchFocusRetryTimer);
  searchFocusRetryTimer = null;
  searchFocusRetryAttempt = 0;
  const verify = () => {
    const input = getSearchSuggestionsInput();
    // The user took over (clicked elsewhere / typed) — stop retrying.
    if (!input || document.activeElement === input) return;
    if (!shouldAutoFocusSearchField()) return;
    if (Date.now() < searchSuggestionsFocusGuardUntil) return;
    if (searchFocusRetryAttempt >= SEARCH_FOCUS_RETRY_DELAYS_MS.length) return;
    const delay = SEARCH_FOCUS_RETRY_DELAYS_MS[searchFocusRetryAttempt];
    searchFocusRetryAttempt += 1;
    searchFocusRetryTimer = setTimeout(() => {
      searchFocusRetryTimer = null;
      input.focus({ preventScroll: true });
      verify();
    }, delay);
  };
  verify();
}

// A user interaction with the page (focus landed back on a page control) means
// the user is using the workspace, not aiming at self-focus; stop retrying so
// we never yank focus mid-session.
function cancelSearchFocusRetryIfInteracting() {
  if (searchFocusRetryTimer) clearTimeout(searchFocusRetryTimer);
  searchFocusRetryTimer = null;
  searchFocusRetryAttempt = SEARCH_FOCUS_RETRY_DELAYS_MS.length; // exhausted
}

/**
 * Setup search-field focus + suggestion panel wiring. Called once from
 * initializeDashboardRuntime so all listeners attach after the DOM is ready.
 */
function setupSearchSuggestions() {
  const input = getSearchSuggestionsInput();
  const panel = getSearchSuggestionsPanel();
  if (!input || !panel) return;

  const onFocus = () => {
    // Focus alone must NOT open the panel — suggestions appear only once the
    // user starts typing (see the input listener below).
    if (getSearchSuggestionsInput()?.value) {
      void refreshSearchSuggestions(true);
    }
  };
  input.addEventListener('focus', onFocus);

  // IME composition tracking: Enter inside composition confirms the selected
  // candidate (e.g. Chinese input methods) and must not submit the search.
  input.addEventListener('compositionstart', () => {
    searchSuggestionsIsComposing = true;
  });
  input.addEventListener('compositionend', () => {
    searchSuggestionsIsComposing = false;
  });

  input.addEventListener('input', () => {
    // Only a non-empty query shows suggestions; clearing the field hides them.
    const query = input.value || '';
    if (!query) {
      closeSearchSuggestions();
      return;
    }
    if (searchSuggestionsDebounceTimer) clearTimeout(searchSuggestionsDebounceTimer);
    searchSuggestionsDebounceTimer = setTimeout(() => {
      searchSuggestionsDebounceTimer = null;
      void refreshSearchSuggestions(true);
    }, SEARCH_SUGGESTION_DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    void handleSearchSuggestionKeydown(e);
  });

  // Clicking a suggestion row activates it (Ctrl/Cmd opens in new tab).
  panel.addEventListener('mousedown', (e) => {
    // Prevent the input from losing focus before the click handler runs.
    e.preventDefault();
  });
  panel.addEventListener('click', async (e) => {
    const row = e.target.closest('.header-search-suggestion-row');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    await activateSearchSuggestion(row, { openInNewTab: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey, button: e.button });
  });
  panel.addEventListener('auxclick', async (e) => {
    if (e.button !== 1) return;
    const row = e.target.closest('.header-search-suggestion-row');
    if (!row) return;
    e.preventDefault();
    await activateSearchSuggestion(row, { openInNewTab: true, button: 1 });
  });

  // Close when the user clicks anywhere outside the search form.
  document.addEventListener('pointerdown', (e) => {
    if (!searchSuggestionsOpen) return;
    if (e.target.closest('#headerSearchForm')) return;
    closeSearchSuggestions();
  });

  // The user clicked into the page: they are using the workspace, not waiting
  // for the search field to claim focus. Stop the self-focus retry loop.
  document.addEventListener('pointerdown', () => {
    cancelSearchFocusRetryIfInteracting();
  }, { capture: true, passive: true });

  // Refresh the panel when tabs change (openTabs re-render) so open-tab
  // suggestions stay current while the panel is open.
  if (typeof window.__tabHarborSuggestionsRefresh === 'undefined') {
    window.__tabHarborSuggestionsRefresh = () => {
      if (searchSuggestionsOpen) void refreshSearchSuggestions(true);
    };
  }
}


/**
 * groupTabsWithStaleRetry(tabIds)
 *
 * chrome.tabs.group fails atomically when any id is invalid (a tab closed or
 * was replaced between render and click). Drop ids that no longer exist —
 * verified with chrome.tabs.get — and retry once with the survivors; if that
 * still fails (or nothing was stale), rethrow so the caller can toast.
 * Returns { groupId, mergedTabIds } so callers can report/clean up using the
 * actual tabs that were grouped, not the pre-retry list.
 */
async function groupTabsWithStaleRetry(tabIds) {
  const initialIds = (tabIds || []).map(Number).filter(Number.isFinite);
  const windowId = await getWindowIdForChromeGroupTabs(initialIds);
  if (!Number.isInteger(windowId)) throw new Error('Could not resolve the Chrome tab-group window');
  return performChromeGroupMutation('create', {
    windowId,
    tabIds: initialIds,
    orderedTabIds: initialIds,
    title: '',
    color: 'grey',
  });
}

/**
 * groupTabsWithStaleRetryIntoGroup(groupId, tabIds)
 *
 * Same stale-retry contract as groupTabsWithStaleRetry, but joins an existing
 * Chrome tab group instead of creating a new one. Used by drag-into-Chrome-group
 * so a single closed tab cannot silently abort the whole move while still
 * surfacing real API failures (e.g. pinned tabs).
 */
async function groupTabsWithStaleRetryIntoGroup(groupId, tabIds) {
  const initialIds = (tabIds || []).map(Number).filter(Number.isFinite);
  const windowId = await getWindowIdForChromeGroupTabs(initialIds);
  if (!Number.isInteger(windowId)) throw new Error('Could not resolve the Chrome tab-group window');
  return performChromeGroupMutation('join', {
    windowId,
    targetGroupId: Number(groupId),
    tabIds: initialIds,
  });
}

/**
 * ungroupTabsWithStaleRetry(tabIds)
 *
 * Retry ungroup with only live tab ids when the first atomic call fails. If no
 * ids survive or none were stale, rethrow so callers can show a failure instead
 * of silently writing local state that contradicts the browser.
 */
async function ungroupTabsWithStaleRetry(tabIds) {
  const initialIds = (tabIds || []).map(Number).filter(Number.isFinite);
  if (!initialIds.length) return;
  const windowId = await getWindowIdForChromeGroupTabs(initialIds);
  if (!Number.isInteger(windowId)) throw new Error('Could not resolve the Chrome tab-group window');
  return performChromeGroupMutation('ungroup', {
    windowId,
    tabIds: initialIds,
  });
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Harbor new-tab pages except the current one.
 * The close itself goes through closeTabsSafely so the shared
 * window-last-tab protection applies: a window whose ONLY tab would be
 * closed keeps it instead of closing the window.
 */
async function closeTabOutDupes() {
  const allTabs = await queryTabsForDashboardWindow();
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t => isTabHarborNewTabUrl(t.url));

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Harbor tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await closeTabsSafely(toClose, { playSound: false });
  await fetchOpenTabs();
}

/**
 * discardTab(tabId)
 *
 * Discards (unloads) a tab to free memory while keeping it in the tab bar.
 * Chrome's discard API puts the tab to sleep; clicking it later will reload.
 */
async function discardTab(tabId) {
  if (!tabId) return false;
  try {
    await chrome.tabs.discard(Number(tabId));
    return true;
  } catch (err) {
    console.error('Failed to discard tab:', err);
    return false;
  }
}

/**
 * discardRestoredTabAfterCommit(tabId, targetUrl)
 *
 * Discards a freshly-created restored tab once its navigation has committed
 * (the tab's url is no longer blank/about:blank). Discarding a tab while its
 * navigation is still pending cancels the navigation and resets the tab to
 * about:blank in Edge — the recorded URL is lost and activating the tab later
 * would reload a blank page instead of the saved page. Polling stops as soon
 * as the url is committed, which happens early in the load (first bytes), so
 * the page is never fully rendered; a timeout degrades to a normally-loading
 * tab on slow networks. Fire-and-forget: the restored id list is unaffected
 * (discard keeps the tab id), and failures are swallowed by discardTab.
 */
async function discardRestoredTabAfterCommit(tabId, targetUrl) {
  const numericId = Number(tabId);
  if (!Number.isFinite(numericId)) return;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    let live = null;
    try {
      live = await chrome.tabs.get(numericId);
    } catch {
      return; // tab already gone — nothing to sleep
    }
    const url = String(live?.url || '');
    if (url && url !== 'about:blank' && url !== 'chrome://newtab/') {
      await discardTab(numericId);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Timeout: leave the tab loading normally.
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
    if (runtimeIsRestorableTabUrl) return runtimeIsRestorableTabUrl(url);
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

/**
 * buildPageChipHtml(tab, group, urlCounts, collapsed)
 *
 * Renders one open-tab row. Used for both the visible rows and the overflow
 * rows (collapsed = true) so every row is identical: drag handle, sort id,
 * group id, selection highlight and aria state. Collapsed rows stay in the
 * list as direct children — hidden with a CSS class — so the drag machinery
 * (placeholder, drop index, order save) treats them like any other row.
 */
function buildPageChipHtml(tab, group, urlCounts = {}, collapsed = false) {
  // Placeholder rows represent a tab id the openTabs snapshot has not
  // materialized yet. They must not look like a real row with destructive
  // controls (sleep) or an empty accessible name (C16).
  const isPlaceholder = !tab.url && !tab.title && tab.id != null;
  let label = isPlaceholder
    ? (runtimeT ? runtimeT('chromeGroupPlaceholder') : 'Loading…')
    : cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group?.domain || '');
  // For localhost tabs, prepend port number so you can tell projects apart
  if (!isPlaceholder) {
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
  }
  const count    = urlCounts[tab.url] || 1;
  const sortId = getPrimaryTabOrderToken(tab);
  const isSelected = selectedPageChipIds.has(String(sortId || ''));
  const chipClass = `${count > 1 ? ' chip-has-dupes' : ''}${tab.discarded ? ' page-chip--discarded' : ''}${isSelected ? ' is-selected' : ''}${isPlaceholder ? ' page-chip--placeholder' : ''}${collapsed ? ' page-chip--collapsed' : ''}`;
  const safeUrl   = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(tab.url || '') : (tab.url || '').replace(/"/g, '&quot;');
  const safeTitle = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(label) : label.replace(/"/g, '&quot;');
  const safeLabel = runtimeEscapeHtml ? runtimeEscapeHtml(label) : label;
  const safeSortId = (runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(sortId) : String(sortId).replace(/"/g, '&quot;'));
  const safeGroupId = (runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(group?.domain || '') : String(group?.domain || '').replace(/"/g, '&quot;'));
  const iconData = runtimeGetIconSources(tab, 16);
  const faviconUrl = iconData.sources[0] || '';
  const fallbackUrl = iconData.sources[1] || '';
  const fallbackLabel = runtimeGetFallbackLabel(label, iconData.hostname);
  const safeFallbackUrl = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(fallbackUrl) : fallbackUrl.replace(/"/g, '&quot;');
  // Chrome group cards tint their row drag handles with the native group
  // color. The tint is exposed as a CSS variable (not an inline color) so the
  // sheet's hover/focus rules can still recolor the handle (C29).
  const chromeGroupColor = group?.isChromeGroup
    ? (CHROME_GROUP_COLOR_MAP[group.chromeGroupColor] || (String(group.chromeGroupColor || '').startsWith('#') ? group.chromeGroupColor : ''))
    : '';
  return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-id="${tab.id}" data-tab-url="${safeUrl}" data-chip-sort-id="${safeSortId}" data-chip-group-id="${safeGroupId}" aria-label="${safeTitle}">
      <button class="drawer-reorder-handle chip-reorder-handle" type="button" data-chip-drag-handle="tab" aria-pressed="${isSelected ? 'true' : 'false'}" aria-label="${runtimeT ? runtimeT('dragReorderTabSelect') : 'Drag to reorder; Enter or Space to select'}"${chromeGroupColor ? ` style="--chrome-group-color:${chromeGroupColor}"` : ''}>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" /></svg>
      </button>
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" data-fallback-src="${safeFallbackUrl}" data-fallback-srcset="${runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(JSON.stringify(iconData.sources.slice(2))) : JSON.stringify(iconData.sources.slice(2)).replace(/"/g, '&quot;')}">` : ''}
      <span class="chip-favicon chip-favicon-fallback"${faviconUrl ? ' style="display:none"' : ''}>${fallbackLabel}</span>
      <span class="chip-text">${safeLabel}</span>
      <div class="chip-actions">
        ${sleepControlEnabled && !tab.active && !tab.discarded && !isPlaceholder ? `<button class="chip-action chip-discard" data-action="discard-tab" data-tab-id="${tab.id}" aria-label="${runtimeT ? runtimeT('discardTab') : 'Sleep tab'}" data-tooltip="${runtimeT ? runtimeT('discardTab') : 'Sleep tab'}">
          ${ICONS.moon}
        </button>` : ''}
        ${!isPlaceholder ? `<button class="chip-action chip-session-save" data-action="save-single-tab-session" data-tab-id="${tab.id}" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" aria-label="${runtimeT ? runtimeT('saveTabSession') : 'Save tab session'}" data-tooltip="${runtimeT ? runtimeT('saveTabSession') : 'Save tab session'}">
          ${ICONS.archive}
        </button>` : ''}
        ${!isPlaceholder ? `<button class="chip-action chip-close" data-action="close-single-tab" data-tab-id="${tab.id}" data-tab-url="${safeUrl}" aria-label="${runtimeT ? runtimeT('closeThisTab') : 'Close this tab'}" data-tooltip="${runtimeT ? runtimeT('closeThisTab') : 'Close this tab'}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>` : ''}
      </div>
    </div>`;
}

function buildOverflowChips(extraCount) {
  return `
    <button type="button" class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">${runtimeT ? runtimeT('moreCount', { count: extraCount }) : `+${extraCount} more`}</span>
    </button>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group)
 *
 * Builds the HTML for one domain group card (domain, manual or Chrome group).
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const stableId  = getStableGroupId(group.domain);
  const groupTitle = getGroupDisplayLabel(group);
  const renameEditorOpen = groupRenameEditorState?.groupKey === String(group.domain);
  const renameEditorValue = renameEditorOpen ? (groupRenameEditorState?.value || groupTitle) : groupTitle;
  const safeRenameValue = runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(renameEditorValue) : String(renameEditorValue).replace(/"/g, '&quot;');

  // Count duplicates (exact URL match). Placeholder rows have no URL yet and
  // must never look like duplicate tabs (C13).
  const urlCounts = {};
  for (const tab of tabs) {
    if (!tab.url) continue;
    urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  }
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const dupeBadge = hasDupes
    ? `<span class="duplicate-count-badge">
        ${runtimeT
          ? runtimeT('duplicatesCount', {
              count: totalExtras,
              suffix: totalExtras !== 1 ? 's' : '',
            })
          : `${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}`}
      </span>`
    : '';

  const orderedTabs = getOrderedUniqueTabsForGroup(group);
  const extraCount  = Math.max(0, orderedTabs.length - 8);

  // Every row (visible + overflow) goes through the same renderer, so the
  // expanded "+N more" rows look and behave exactly like the first eight.
  // Overflow rows are direct list children hidden with a CSS class — they
  // keep their drag handles, sort ids and stored order. Cards whose overflow
  // was expanded stay expanded across re-renders (drag commits, refreshes).
  const isOverflowExpanded = expandedPageChipGroupKeys.has(String(group.domain));
  const pageChips = orderedTabs.map((tab, index) => buildPageChipHtml(tab, group, urlCounts, index >= 8 && !isOverflowExpanded)).join('')
    + (extraCount > 0 && !isOverflowExpanded ? buildOverflowChips(extraCount) : '');

  const saveGroupButton = `
      <button class="group-action-icon" type="button" data-action="save-domain-session" data-domain-id="${stableId}" aria-label="${runtimeT ? runtimeT('saveGroupSession') : 'Save group session'}" data-tooltip="${runtimeT ? runtimeT('saveGroupSession') : 'Save group session'}">
        ${ICONS.archive}
      </button>`;
  const closeAllButton = `
      <button class="group-action-icon group-action-close" type="button" data-action="close-domain-tabs" data-domain-id="${stableId}" aria-label="${runtimeT ? runtimeT('closeGroup') : 'Close group'}" data-tooltip="${runtimeT ? runtimeT('closeGroup') : 'Close group'}">
        ${ICONS.close}
      </button>`;

  const dupeUrlsEncoded = hasDupes ? dupeUrls.map(([url]) => encodeURIComponent(url)).join(',') : '';
  // Header actions, left to right: close duplicates, merge into a Chrome
  // group, sleep all in group, save session, close group. All are icon
  // buttons in the same quiet header style (30×30, muted → ink on hover).
  // A card that IS a Chrome group has no "merge into Chrome group" action.
  const mergeGroupButton = group.isChromeGroup ? '' : `
    <button class="group-action-icon" type="button" data-action="group-card-tabs" data-domain-id="${stableId}" aria-label="${runtimeT ? runtimeT('groupCardTabsLabel') : 'Merge into Chrome group'}" data-tooltip="${runtimeT ? runtimeT('groupCardTabsLabel') : 'Merge into Chrome group'}">
      ${ICONS.mergeGroup}
    </button>`;
  const dedupLabel = runtimeT
    ? runtimeT('closedDuplicatesCount', { count: totalExtras, suffix: totalExtras !== 1 ? 's' : '' })
    : `Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}`;
  const dedupButton = hasDupes ? `
    <button class="group-action-icon" type="button" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}" aria-label="${dedupLabel}" data-tooltip="${dedupLabel}">
      ${ICONS.closeDuplicates}
    </button>` : '';

  // Chrome tab group colors: named enum colors map to dashboard accents, and
  // Chrome 132+ custom colors come back as raw hex (#rrggbb) — pass those
  // through unchanged so user group cards always wear their real color.
  const chromeColor = group.isChromeGroup
    ? (CHROME_GROUP_COLOR_MAP[group.chromeGroupColor] || (String(group.chromeGroupColor || '').startsWith('#') ? group.chromeGroupColor : ''))
    : '';
  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}${group.isChromeGroup ? ' chrome-group-card' : ''}" data-domain-id="${stableId}" data-group-id="${group.domain}"${group.chromeGroupId != null ? ` data-chrome-group-id="${group.chromeGroupId}"` : ''}${chromeColor ? ` style="--chrome-group-color:${chromeColor}"` : ''}>
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <div class="mission-heading">
            <span class="mission-title-wrap">
              ${renameEditorOpen ? `
                <form class="mission-rename-form" data-action="submit-group-rename" data-group-key="${runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(group.domain) : String(group.domain).replace(/"/g, '&quot;')}"${group.manualGroupId ? ` data-manual-group-id="${runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(group.manualGroupId) : String(group.manualGroupId).replace(/"/g, '&quot;')}"` : ''}>
                  <input class="mission-rename-input" type="text" value="${safeRenameValue}" data-group-rename-input="${runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(group.domain) : String(group.domain).replace(/"/g, '&quot;')}" aria-label="${runtimeT ? runtimeT('renameGroup') : 'Rename group'}" autocomplete="off">
                </form>
              ` : `
                <button class="mission-rename-trigger" type="button" data-action="rename-session-group" data-group-key="${runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(group.domain) : String(group.domain).replace(/"/g, '&quot;')}"${group.manualGroupId ? ` data-manual-group-id="${runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(group.manualGroupId) : String(group.manualGroupId).replace(/"/g, '&quot;')}"` : ''} aria-label="${runtimeT ? runtimeT('renameGroup') : 'Rename group'}" title="${runtimeT ? runtimeT('renameGroup') : 'Rename group'}">
                  <span class="mission-name">${runtimeEscapeHtml ? runtimeEscapeHtml(groupTitle) : groupTitle}</span>
                </button>
              `}
            </span>
            ${dupeBadge}
          </div>
          <div class="mission-actions">
            ${dedupButton}
            ${mergeGroupButton}
            ${sleepControlEnabled ? `
            <button class="group-action-icon" type="button" data-action="sleep-domain-tabs" data-domain-id="${stableId}" aria-label="${runtimeT ? runtimeT('sleepAllTabsButton') : 'Sleep all tabs in group'}" data-tooltip="${runtimeT ? runtimeT('sleepAllTabsButton') : 'Sleep all tabs in group'}">
              ${ICONS.moon}
            </button>` : ''}
            ${saveGroupButton}
            ${closeAllButton}
          </div>
        </div>
        <div class="mission-pages">${pageChips}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">${runtimeT ? runtimeT('tabsLabel') : 'tabs'}</div>
      </div>
    </div>`;
}

function renderGroupNav(group) {
  const stableId = getStableGroupId(group.domain);
  const label = getGroupDisplayLabel(group);
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
      data-nav-kind="open-tabs"
      data-group-id="${group.domain}"
      data-domain-id="${stableId}"
      data-tooltip="${safeTooltip}"
      aria-label="${runtimeT ? runtimeT('jumpToLabel', { label: safeTooltip }) : `Jump to ${safeTooltip}` }"
      draggable="false"
    >
      ${iconData.src
        ? `<img class="group-nav-icon" src="${iconData.src}" alt="" draggable="false" data-fallback-src="${runtimeEscapeHtmlAttribute(iconData.fallbackSrc)}" data-fallback-srcset="${runtimeEscapeHtmlAttribute(JSON.stringify(iconData.fallbackSources?.slice(1) || []))}">`
        : ''}
      <span class="group-nav-fallback"${iconData.src ? ' style="display:none"' : ''}>${iconData.fallbackLabel}</span>
    </button>`;
}

function renderWorkspacePageSwitch(currentPage = 'home') {
  const homeActive = currentPage !== 'saved-tabs';
  const savedActive = currentPage === 'saved-tabs';
  const homeLabel = runtimeT ? runtimeT('workspacePageHome') : 'Home';
  const savedLabel = runtimeT ? runtimeT('workspacePageSavedTabs') : 'Saved tabs';

  return `
    <nav class="workspace-page-switch" id="workspacePageSwitch" aria-label="Workspace pages">
      <button class="workspace-page-switch-btn${homeActive ? ' is-active' : ''}" type="button" data-action="switch-workspace-page" data-page="home" aria-pressed="${homeActive ? 'true' : 'false'}" aria-controls="homePage">${homeLabel}</button>
      <button class="workspace-page-switch-btn${savedActive ? ' is-active' : ''}" type="button" data-action="switch-workspace-page" data-page="saved-tabs" aria-pressed="${savedActive ? 'true' : 'false'}" aria-controls="savedTabsPage">${savedLabel}</button>
    </nav>`;
}

function renderWorkspaceThemeTools() {
  const languagePreference = runtimeGetLanguagePreference ? runtimeGetLanguagePreference() : 'auto';
  return `
    <div class="group-nav-tools">
      <button class="header-theme-trigger" id="themeMenuTrigger" type="button" data-action="toggle-theme-menu" data-tooltip="${runtimeT ? runtimeT('deskSettings') : 'Desk settings'}" aria-label="${runtimeT ? runtimeT('deskSettings') : 'Desk settings'}" aria-expanded="false" aria-controls="themeMenuPanel">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 7.5h15m-12 4.5h9m-6 4.5h3" />
          <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="16.5" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <div class="theme-menu" id="themeMenuPanel" hidden role="dialog" aria-label="${runtimeT ? runtimeT('deskSettingsPanel') : 'Desk settings panel'}">
        <div class="theme-menu-tabs" role="tablist" aria-label="${runtimeT ? runtimeT('deskSettingsPanel') : 'Desk settings panel'}">
          <button class="theme-menu-tab" id="themeMenuAppearanceTab" type="button" role="tab" data-action="select-theme-menu-tab" data-theme-menu-tab="appearance" aria-controls="themeMenuAppearancePanel" aria-selected="true">${runtimeT ? runtimeT('settingsTabAppearance') : 'Appearance'}</button>
          <button class="theme-menu-tab" id="themeMenuFeaturesTab" type="button" role="tab" data-action="select-theme-menu-tab" data-theme-menu-tab="features" aria-controls="themeMenuFeaturesPanel" aria-selected="false">${runtimeT ? runtimeT('settingsTabFeatures') : 'Features'}</button>
        </div>
        <div class="theme-menu-panel" id="themeMenuAppearancePanel" role="tabpanel" aria-labelledby="themeMenuAppearanceTab" data-theme-menu-panel="appearance">
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
            <div class="theme-menu-row theme-menu-row-inline-range">
              <div class="theme-menu-label">${runtimeT ? runtimeT('uiScaleLabel') : 'Text size'}</div>
              <input
                class="theme-range"
                id="themeUiScaleRange"
                type="range"
                aria-label="${runtimeT ? runtimeT('uiScaleLabel') : 'Text size'}"
                min="100"
                max="120"
                step="1"
                value="100"
              >
              <div class="theme-range-value" id="themeUiScaleValue">100%</div>
            </div>
          </div>
          <div class="theme-menu-section">
            <div class="theme-menu-row theme-menu-row-inline-range">
              <div class="theme-menu-label">${runtimeT ? runtimeT('shortcutScaleLabel') : 'Shortcut size'}</div>
              <input
                class="theme-range"
                id="themeShortcutScaleRange"
                type="range"
                aria-label="${runtimeT ? runtimeT('shortcutScaleLabel') : 'Shortcut size'}"
                min="100"
                max="130"
                step="1"
                value="100"
              >
              <div class="theme-range-value" id="themeShortcutScaleValue">100%</div>
            </div>
          </div>
          <div class="theme-menu-section">
            <div class="theme-menu-row theme-menu-row-inline-choices">
              <div class="theme-menu-label">${runtimeT ? runtimeT('quickShortcutColsLabel') : 'Quick links per row'}</div>
              <div class="theme-mode-options" role="group" aria-label="${runtimeT ? runtimeT('quickShortcutColsLabel') : 'Quick links per row'}">
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.quickShortcutCols === 'auto') ? 'is-active' : ''}" type="button" data-action="select-quick-shortcut-cols" data-cols="auto" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.quickShortcutCols === 'auto') ? 'true' : 'false'}">${runtimeT ? runtimeT('quickShortcutColsAuto') : 'Auto'}</button>
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.quickShortcutCols === '4') ? 'is-active' : ''}" type="button" data-action="select-quick-shortcut-cols" data-cols="4" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.quickShortcutCols === '4') ? 'true' : 'false'}">${runtimeT ? runtimeT('quickShortcutCols4') : '4 columns'}</button>
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.quickShortcutCols === '5') ? 'is-active' : ''}" type="button" data-action="select-quick-shortcut-cols" data-cols="5" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.quickShortcutCols === '5') ? 'true' : 'false'}">${runtimeT ? runtimeT('quickShortcutCols5') : '5 columns'}</button>
              </div>
            </div>
          </div>
        </div>
        <div class="theme-menu-panel" id="themeMenuFeaturesPanel" role="tabpanel" aria-labelledby="themeMenuFeaturesTab" data-theme-menu-panel="features" hidden>
          <div class="theme-menu-section">
            <label class="theme-menu-toggle-label theme-menu-toggle-button-row">
              <button class="theme-toggle-switch ${chromeTabGroupsEnabled ? 'is-active' : ''}" type="button" data-action="toggle-chrome-tab-groups" aria-pressed="${chromeTabGroupsEnabled ? 'true' : 'false'}" aria-label="${runtimeT ? runtimeT('chromeTabGroupsLabel') : 'Chrome tab groups'}"></button>
              <span class="theme-menu-label theme-menu-toggle-text">${runtimeT ? runtimeT('chromeTabGroupsLabel') : 'Chrome tab groups'}</span>
            </label>
          </div>
          <div class="theme-menu-section">
            <label class="theme-menu-toggle-label theme-menu-toggle-button-row">
              <button class="theme-toggle-switch ${(typeof themePreferences !== 'undefined' && themePreferences.bookmarksShowFavicons === true) ? 'is-active' : ''}" type="button" data-action="toggle-bookmark-favicons" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.bookmarksShowFavicons === true) ? 'true' : 'false'}" aria-label="${runtimeT ? runtimeT('bookmarksShowFaviconsLabel') : 'Show website icons for bookmarks'}"></button>
              <span class="theme-menu-label theme-menu-toggle-text">${runtimeT ? runtimeT('bookmarksShowFaviconsLabel') : 'Show website icons for bookmarks'}</span>
            </label>
          </div>
          <div class="theme-menu-section">
            <label class="theme-menu-toggle-label theme-menu-toggle-button-row">
              <button class="theme-toggle-switch ${(typeof themePreferences !== 'undefined' && themePreferences.hitokotoEnabled !== false) ? 'is-active' : ''}" type="button" data-action="toggle-hitokoto" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.hitokotoEnabled !== false) ? 'true' : 'false'}" aria-label="${runtimeT ? runtimeT('hitokotoLabel') : 'Hitokoto'}"></button>
              <span class="theme-menu-label theme-menu-toggle-text">${runtimeT ? runtimeT('hitokotoLabel') : 'Hitokoto'}</span>
            </label>
          </div>
          <div class="theme-menu-section">
            <label class="theme-menu-toggle-label theme-menu-toggle-button-row">
              <button class="theme-toggle-switch ${sleepControlEnabled ? 'is-active' : ''}" type="button" data-action="toggle-sleep-control" aria-pressed="${sleepControlEnabled ? 'true' : 'false'}" aria-label="${runtimeT ? runtimeT('sleepControlLabel') : 'Manual sleep control'}"></button>
              <span class="theme-menu-label theme-menu-toggle-text">${runtimeT ? runtimeT('sleepControlLabel') : 'Manual sleep control'}</span>
            </label>
          </div>
          <div class="theme-menu-section">
            <label class="theme-menu-toggle-label theme-menu-toggle-button-row">
              <button class="theme-toggle-switch ${(typeof themePreferences !== 'undefined' && themePreferences.closeDuplicateNewTabsEnabled) ? 'is-active' : ''}" type="button" data-action="toggle-close-duplicate-new-tabs" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.closeDuplicateNewTabsEnabled) ? 'true' : 'false'}" aria-label="${runtimeT ? runtimeT('closeDuplicateNewTabsLabel') : 'Auto-close duplicate new tabs'}"></button>
              <span class="theme-menu-label theme-menu-toggle-text">${runtimeT ? runtimeT('closeDuplicateNewTabsLabel') : 'Auto-close duplicate new tabs'}</span>
            </label>
          </div>
          <div class="theme-menu-section">
            <label class="theme-menu-toggle-label theme-menu-toggle-button-row">
              <button class="theme-toggle-switch ${(typeof themePreferences !== 'undefined' && themePreferences.quickShortcutOpenMode === 'current-tab') ? 'is-active' : ''}" type="button" data-action="toggle-quick-shortcut-open-mode" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.quickShortcutOpenMode === 'current-tab') ? 'true' : 'false'}" aria-label="${runtimeT ? runtimeT('quickShortcutOpenModeLabel') : 'Open quick links in current tab'}"></button>
              <span class="theme-menu-label theme-menu-toggle-text">${runtimeT ? runtimeT('quickShortcutOpenModeLabel') : 'Open quick links in current tab'}</span>
            </label>
          </div>
          <div class="theme-menu-section">
            <div class="theme-menu-row theme-menu-row-inline-choices">
              <div class="theme-menu-label">${runtimeT ? runtimeT('searchEngineLabel') : 'Search engine'}</div>
              <div class="theme-mode-options" role="group" aria-label="${runtimeT ? runtimeT('searchEngineLabel') : 'Search engine'}">
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'default') ? 'is-active' : ''}" type="button" data-action="select-search-engine" data-engine="default" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'default') ? 'true' : 'false'}">${runtimeT ? runtimeT('searchEngineDefault') : 'Browser default'}</button>
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'google') ? 'is-active' : ''}" type="button" data-action="select-search-engine" data-engine="google" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'google') ? 'true' : 'false'}">${runtimeT ? runtimeT('searchEngineGoogle') : 'Google'}</button>
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'bing') ? 'is-active' : ''}" type="button" data-action="select-search-engine" data-engine="bing" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'bing') ? 'true' : 'false'}">${runtimeT ? runtimeT('searchEngineBing') : 'Bing'}</button>
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'baidu') ? 'is-active' : ''}" type="button" data-action="select-search-engine" data-engine="baidu" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'baidu') ? 'true' : 'false'}">${runtimeT ? runtimeT('searchEngineBaidu') : 'Baidu'}</button>
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'sogou') ? 'is-active' : ''}" type="button" data-action="select-search-engine" data-engine="sogou" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'sogou') ? 'true' : 'false'}">${runtimeT ? runtimeT('searchEngineSogou') : 'Sogou'}</button>
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'duckduckgo') ? 'is-active' : ''}" type="button" data-action="select-search-engine" data-engine="duckduckgo" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'duckduckgo') ? 'true' : 'false'}">${runtimeT ? runtimeT('searchEngineDuckDuckGo') : 'DuckDuckGo'}</button>
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'brave') ? 'is-active' : ''}" type="button" data-action="select-search-engine" data-engine="brave" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'brave') ? 'true' : 'false'}">${runtimeT ? runtimeT('searchEngineBrave') : 'Brave'}</button>
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'yandex') ? 'is-active' : ''}" type="button" data-action="select-search-engine" data-engine="yandex" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'yandex') ? 'true' : 'false'}">${runtimeT ? runtimeT('searchEngineYandex') : 'Yandex'}</button>
                <button class="theme-mode-option ${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'custom') ? 'is-active' : ''}" type="button" data-action="select-search-engine" data-engine="custom" aria-pressed="${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'custom') ? 'true' : 'false'}">${runtimeT ? runtimeT('searchEngineCustom') : 'Custom'}</button>
              </div>
            </div>
          </div>
          <div class="theme-menu-section" id="customSearchUrlSection"${(typeof themePreferences !== 'undefined' && themePreferences.searchEngine === 'custom') ? '' : ' style="display:none"'}>
            <div class="theme-menu-row theme-menu-row-inline-select">
              <label class="theme-menu-label" for="customSearchUrlInput">${runtimeT ? runtimeT('customSearchUrlLabel') : 'Custom search URL'}</label>
              <input class="theme-menu-text-input" id="customSearchUrlInput" type="text" data-action="change-custom-search-url" value="${runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(((typeof themePreferences !== 'undefined' && themePreferences.customSearchUrl) || '')) : ''}" placeholder="https://example.com/search?q={query}" aria-label="${runtimeT ? runtimeT('customSearchUrlLabel') : 'Custom search URL'}" aria-describedby="customSearchUrlHint" spellcheck="false">
            </div>
            <div class="theme-menu-row theme-menu-row-inline-select">
              <div class="theme-menu-label theme-menu-hint" id="customSearchUrlHint">${runtimeT ? runtimeT('customSearchUrlHint') : 'Use {query} or %s as the placeholder'}</div>
            </div>
          </div>
          <div class="theme-menu-section">
            <div class="theme-menu-label">${runtimeT ? runtimeT('settingsExportImport') : 'Configuration backup'}</div>
            <div class="theme-menu-actions">
              <button class="theme-menu-action" type="button" data-action="export-config">${runtimeT ? runtimeT('settingsExport') : 'Export'}</button>
              <button class="theme-menu-action is-secondary" type="button" data-action="import-config">${runtimeT ? runtimeT('settingsImport') : 'Import'}</button>
            </div>
          </div>
        </div>
        <input type="file" id="themeBackgroundInput" accept="image/*" hidden>
        <input type="file" id="configImportInput" accept="application/json,.json" hidden>
      </div>
    </div>`;
}

async function handleExportConfig() {
  const configSync = globalThis.TabHarborConfigSync;
  if (!configSync) {
    showToast('Config sync unavailable');
    return;
  }
  try {
    const json = await configSync.exportConfig();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `tab-harbor-config-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setThemeMenuOpen(false, { restoreFocus: true });
    showToast(runtimeT ? runtimeT('toastConfigExported') : 'Config exported');
  } catch (err) {
    console.error('[tab-harbor] Export failed:', err);
    showToast(runtimeT ? runtimeT('toastConfigExportFailed') : 'Export failed');
  }
}

async function handleConfigImportInput(inputEl) {
  const configSync = globalThis.TabHarborConfigSync;
  if (!configSync) {
    showToast('Config sync unavailable');
    return;
  }
  const file = inputEl.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const result = await configSync.importConfig(text);
    setThemeMenuOpen(false, { restoreFocus: true });
    // Reset the input so selecting the same file again re-triggers change.
    inputEl.value = '';
    showToast(runtimeT
      ? runtimeT('toastConfigImported', { keys: result.importedKeys.length })
      : `Imported ${result.importedKeys.length} setting${result.importedKeys.length !== 1 ? 's' : ''}`);
    globalThis.location?.reload?.();
  } catch (err) {
    console.error('[tab-harbor] Import failed:', err);
    showToast(err?.message || (runtimeT ? runtimeT('toastConfigImportFailed') : 'Import failed'));
  }
}

function renderGroupNavArea(groups) {
  return `
    <div class="group-nav-list" data-nav-kind="open-tabs">
      ${groups.map(group => renderGroupNav(group)).join('')}
    </div>
    ${renderWorkspacePageSwitch('home')}
    ${renderWorkspaceThemeTools()}`;
}

function buildElementFromHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild || null;
}

function getWorkspaceTopNavHost() {
  return document.getElementById('workspaceTopNav');
}

function syncWorkspaceTopNavMarkup(markup = '', visible = true) {
  const navHost = getWorkspaceTopNavHost();
  if (!navHost) return;
  navHost.innerHTML = markup;
  navHost.style.display = visible ? 'flex' : 'none';
  if (typeof renderThemeMenu === 'function') renderThemeMenu();
}

function buildOpenTabsSectionActions() {
  // Section header above ALL cards, left to right: close duplicates (only
  // while some card-visible URL is duplicated anywhere in the window), merge
  // every open tab into one Chrome tab group, sleep all, save session, close
  // all. Duplicates are counted over getRealTabs() — the same restorable-tab
  // scope the cards show — so internal pages (chrome://, the dashboard's own
  // new-tab page) never inflate the count.
  const counts = {};
  for (const tab of getRealTabs()) {
    if (!tab?.url) continue;
    counts[tab.url] = (counts[tab.url] || 0) + 1;
  }
  const dupeUrls = Object.entries(counts)
    .filter(([, c]) => c > 1)
    .map(([url]) => url);
  const totalExtras = dupeUrls.reduce((sum, url) => sum + counts[url] - 1, 0);
  const dedupLabel = runtimeT
    ? runtimeT('closedDuplicatesCount', { count: totalExtras, suffix: totalExtras !== 1 ? 's' : '' })
    : `Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}`;
  const dupeUrlsEncoded = dupeUrls.map(url => encodeURIComponent(url)).join(',');

  return `
    ${dupeUrls.length > 0 ? `<button class="section-icon-action" type="button" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}" aria-label="${dedupLabel}" data-tooltip="${dedupLabel}">
      ${ICONS.closeDuplicates}
    </button>` : ''}
    <button class="section-icon-action" type="button" data-action="group-card-tabs" data-scope="all" aria-label="${runtimeT ? runtimeT('groupCardTabsLabel') : 'Merge into Chrome group'}" data-tooltip="${runtimeT ? runtimeT('groupCardTabsLabel') : 'Merge into Chrome group'}">
      ${ICONS.mergeGroup}
    </button>
    ${sleepControlEnabled ? `<button class="section-icon-action" type="button" data-action="sleep-all-open-tabs" aria-label="${runtimeT ? runtimeT('sleepAllOpenTabsButton') : 'Sleep all tabs'}" data-tooltip="${runtimeT ? runtimeT('sleepAllOpenTabsButton') : 'Sleep all tabs'}">${ICONS.moon}</button>` : ''}
    <button class="section-icon-action" type="button" data-action="save-current-window-session" aria-label="${runtimeT ? runtimeT('saveSessionButton') : 'Save session'}" data-tooltip="${runtimeT ? runtimeT('saveSessionButton') : 'Save session'}">${ICONS.archive}</button>
    <button class="section-icon-action section-icon-action-close" type="button" data-action="close-all-open-tabs" aria-label="${runtimeT ? runtimeT('closeAllTabsButton') : 'Close all tabs'}" data-tooltip="${runtimeT ? runtimeT('closeAllTabsButton') : 'Close all tabs'}">${ICONS.close}</button>`;
}

function renderChromeTabGroupConflicts() {
  if (!chromeTabGroupsEnabled || !chromeTabGroupConflicts.length) return '';
  const rows = chromeTabGroupConflicts.map(conflict => {
    const candidates = Array.isArray(conflict.candidates) ? conflict.candidates : [];
    const name = String(conflict.title || getAutomaticGroupDisplayTitle({ groupKey: conflict.groupKey }) || 'Group');
    const tabCount = candidates.reduce((sum, candidate) => sum + (candidate.tabIds?.length || 0), 0);
    const title = runtimeT
      ? runtimeT('chromeGroupConflictTitle', { name })
      : `Multiple Chrome groups named “${name}”`;
    const meta = runtimeT
      ? runtimeT('chromeGroupConflictMeta', { groups: candidates.length, tabs: tabCount })
      : `${candidates.length} groups · ${tabCount} tabs`;
    const safeKey = runtimeEscapeHtmlAttribute
      ? runtimeEscapeHtmlAttribute(conflict.groupKey || '')
      : String(conflict.groupKey || '').replace(/"/g, '&quot;');
    const mergeLabel = runtimeT
      ? runtimeT('chromeGroupConflictMergeLabel', { name })
      : `Merge duplicate Chrome groups for ${name}`;
    return `<article class="chrome-group-conflict" data-chrome-group-conflict="${safeKey}">
      <div class="chrome-group-conflict-copy">
        <span class="chrome-group-conflict-title">${runtimeEscapeHtml ? runtimeEscapeHtml(title) : title}</span>
        <span class="chrome-group-conflict-meta">${runtimeEscapeHtml ? runtimeEscapeHtml(meta) : meta}</span>
      </div>
      <button class="chrome-group-conflict-action" type="button" data-action="open-chrome-group-merge" data-group-key="${safeKey}" aria-label="${runtimeEscapeHtmlAttribute ? runtimeEscapeHtmlAttribute(mergeLabel) : mergeLabel.replace(/"/g, '&quot;')}">${runtimeT ? runtimeT('chromeGroupConflictMerge') : 'Merge…'}</button>
    </article>`;
  }).join('');
  return rows;
}

function syncChromeTabGroupConflictStatus() {
  const status = document.getElementById('chromeGroupConflictsStatus');
  if (!status) return;
  const signature = JSON.stringify(chromeTabGroupConflicts.map(conflict => ({
    groupKey: String(conflict.groupKey || ''),
    title: String(conflict.title || ''),
    candidates: (conflict.candidates || []).map(candidate => ({
      groupId: Number(candidate.id ?? candidate.groupId),
      title: String(candidate.title || ''),
      color: String(candidate.color || ''),
      tabIds: (candidate.tabIds || []).map(Number),
    })),
  })));
  if (status.dataset.conflictSignature === signature) return;
  status.dataset.conflictSignature = signature;
  status.innerHTML = renderChromeTabGroupConflicts();
}

function getChromeGroupConflict(groupKey) {
  return chromeTabGroupConflicts.find(conflict => String(conflict.groupKey || '') === String(groupKey || '')) || null;
}

function closeChromeGroupMergeDialog({ restoreFocus = true } = {}) {
  const dialog = document.getElementById('chromeGroupMergeDialog');
  if (!restoreFocus && chromeGroupMergeDialogState) chromeGroupMergeDialogState.trigger = null;
  if (dialog?.open) dialog.close();
}

function focusChromeGroupMergeResult(groupKey) {
  const key = String(groupKey || '');
  const groupButton = [...document.querySelectorAll('.group-nav-button[data-group-id]')]
    .find(button => String(button.dataset.groupId || '') === key);
  const fallback = groupButton || document.getElementById('headerSearchInput');
  fallback?.focus?.({ preventScroll: true });
}

function openChromeGroupMergeDialog(groupKey, trigger = null) {
  const conflict = getChromeGroupConflict(groupKey);
  const candidates = Array.isArray(conflict?.candidates) ? conflict.candidates : [];
  const dialog = document.getElementById('chromeGroupMergeDialog');
  const options = document.getElementById('chromeGroupMergeOptions');
  if (!conflict || candidates.length < 2 || !dialog || !options) return;

  const name = String(conflict.title || getAutomaticGroupDisplayTitle({ groupKey }) || 'Group');
  const titleEl = document.getElementById('chromeGroupMergeDialogTitle');
  const hintEl = document.getElementById('chromeGroupMergeDialogHint');
  const cancelEl = document.getElementById('chromeGroupMergeCancel');
  const confirmEl = document.getElementById('chromeGroupMergeConfirm');
  if (titleEl) titleEl.textContent = runtimeT ? runtimeT('chromeGroupMergeDialogTitle', { name }) : `Merge “${name}”`;
  if (hintEl) hintEl.textContent = runtimeT
    ? runtimeT('chromeGroupMergeDialogHint')
    : 'Choose the group whose name, color and position should stay.';
  if (cancelEl) cancelEl.textContent = runtimeT ? runtimeT('chromeGroupMergeCancel') : 'Cancel';
  if (confirmEl) confirmEl.textContent = runtimeT ? runtimeT('chromeGroupMergeConfirm') : 'Merge groups';

  const expectedGroups = [];
  options.innerHTML = candidates.map((candidate, index) => {
    const groupId = Number(candidate.id ?? candidate.groupId);
    const expectedTabs = (candidate.tabIds || []).map(tabId => {
      const tab = openTabs.find(item => Number(item.id) === Number(tabId));
      return {
        tabId: Number(tabId),
        url: String(tab?.rawUrl ?? tab?.url ?? tab?.pendingUrl ?? ''),
        label: String(tab?.title || tab?.url || `Tab ${tabId}`),
      };
    });
    expectedGroups.push({
      groupId,
      title: String(candidate.title || ''),
      color: String(candidate.color || 'grey'),
      tabs: expectedTabs.map(tab => ({ tabId: tab.tabId, url: tab.url })),
    });
    const position = runtimeT
      ? runtimeT('chromeGroupMergePosition', { position: index + 1 })
      : `From left: ${index + 1}`;
    const title = `${runtimeT ? runtimeT('chromeGroupMergeTargetLabel') : 'Keep this group'} · ${position} · ${candidate.color || 'grey'}`;
    const members = expectedTabs.map(tab => tab.label).join(' · ');
    const safeTitle = runtimeEscapeHtml ? runtimeEscapeHtml(title) : title;
    const safeMembers = runtimeEscapeHtml ? runtimeEscapeHtml(members) : members;
    return `<label class="chrome-group-merge-option${index === 0 ? ' is-selected' : ''}">
      <input type="radio" name="chromeGroupMergeTarget" value="${groupId}"${index === 0 ? ' checked' : ''}>
      <span class="chrome-group-merge-option-copy">
        <span class="chrome-group-merge-option-title">${safeTitle}</span>
        <span class="chrome-group-merge-option-tabs">${safeMembers}</span>
      </span>
    </label>`;
  }).join('');
  chromeGroupMergeDialogState = { groupKey: String(groupKey), conflict, expectedGroups, trigger };
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => options.querySelector('input:checked')?.focus({ preventScroll: true }));
}

function setupChromeGroupMergeDialog() {
  const dialog = document.getElementById('chromeGroupMergeDialog');
  if (!dialog || dialog.dataset.lifecycleAttached === 'true') return;
  dialog.addEventListener('close', () => {
    const trigger = chromeGroupMergeDialogState?.trigger;
    chromeGroupMergeDialogState = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  });
  dialog.addEventListener('change', (event) => {
    if (!event.target?.matches?.('input[name="chromeGroupMergeTarget"]')) return;
    dialog.querySelectorAll('.chrome-group-merge-option').forEach(option => {
      option.classList.toggle('is-selected', option.contains(event.target));
    });
  });
  dialog.dataset.lifecycleAttached = 'true';
}

function renderOpenTabsSummary(realTabs = getRealTabs()) {
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');

  if (!openTabsSection) return;

  if (domainGroups.length > 0) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = runtimeT ? runtimeT('openTabsSectionTitle') : 'Open tabs';
    if (openTabsSectionCount) {
      openTabsSectionCount.innerHTML = buildOpenTabsSectionActions();
    }
    syncWorkspaceTopNavMarkup(renderGroupNavArea(domainGroups), true);
    if (openTabsMissionsEl) {
      openTabsMissionsEl.querySelector('#tabSessionPicker')?.remove();
      const leadingMarkup = tabSessionPickerState.open ? renderTabSessionPicker() : '';
      if (leadingMarkup) openTabsMissionsEl.insertAdjacentHTML('afterbegin', leadingMarkup);
    }
    openTabsSection.style.display = 'block';
    syncChromeTabGroupConflictStatus();
    return;
  }

  syncWorkspaceTopNavMarkup(renderGroupNavArea([]), true);
  openTabsSection.style.display = 'block';
  syncChromeTabGroupConflictStatus();
  if (openTabsMissionsEl) openTabsMissionsEl.innerHTML = renderMissionsEmptyState();
  if (openTabsSectionCount) openTabsSectionCount.textContent = runtimeT ? runtimeT('emptyTabsCount') : '0 domains';
}

function patchOpenTabsDomFromGroups(realTabs = getRealTabs(), changedGroupKeys = []) {
  const missionsEl = document.getElementById('openTabsMissions');
  const navHost = getWorkspaceTopNavHost();
  const navListEl = navHost?.querySelector('.group-nav-list[data-nav-kind="open-tabs"]');
  if (!missionsEl || !navHost || !navListEl) {
    renderOpenTabsArea(realTabs);
    return;
  }

  const changedKeys = new Set((changedGroupKeys || []).map(String).filter(Boolean));

  const existingCards = new Map(
    [...missionsEl.querySelectorAll('.mission-card')].map(card => [card.dataset.groupId || '', card])
  );
  const existingButtons = new Map(
    [...navListEl.querySelectorAll('.group-nav-button')].map(button => [button.dataset.groupId || '', button])
  );
  const desiredKeys = domainGroups.map(group => String(group.domain));

  existingCards.forEach((card, key) => {
    if (!desiredKeys.includes(key)) card.remove();
  });
  existingButtons.forEach((button, key) => {
    if (!desiredKeys.includes(key)) button.remove();
  });

  const previousNavRects = new Map();
  navListEl.querySelectorAll('.group-nav-button').forEach(button => {
    previousNavRects.set(button.dataset.groupId || '', button.getBoundingClientRect());
  });

  for (const group of domainGroups) {
    const key = String(group.domain);
    const currentCard = existingCards.get(key) || null;
    let nextCardNode = currentCard;
    if (!currentCard || changedKeys.has(key)) {
      nextCardNode = buildElementFromHtml(renderDomainCard(group));
      if (currentCard && nextCardNode) {
        currentCard.replaceWith(nextCardNode);
      }
    }
    if (nextCardNode) missionsEl.appendChild(nextCardNode);

    const currentButton = existingButtons.get(key) || null;
    let nextButtonNode = currentButton;
    if (!currentButton || changedKeys.has(key)) {
      nextButtonNode = buildElementFromHtml(renderGroupNav(group));
      if (currentButton && nextButtonNode) {
        currentButton.replaceWith(nextButtonNode);
      }
    }
    if (nextButtonNode) navListEl.appendChild(nextButtonNode);
  }

  animateNavButtons(navListEl, previousNavRects);
  renderOpenTabsSummary(realTabs);
}

async function buildDomainGroups(realTabs = getRealTabs()) {
  domainGroups = [];
  chromeTabGroupSnapshotAuthoritative = false;
  const dashboardWindowId = await getDashboardWindowIdForOpenTabs();
  let liveStateResponse = null;
  let nativeChromeGroups = [];
  if (dashboardWindowId != null) {
    liveStateResponse = await loadChromeTabGroupLiveState(Number(dashboardWindowId));
    if (liveStateResponse?.ok) {
      nativeChromeGroups = chromeTabGroupLiveState.nativeGroups;
      chromeTabGroupSnapshotAuthoritative = true;
    }
  }
  // A read failure never becomes an empty authoritative snapshot. The legacy
  // page-side query is read-only and keeps existing native cards visible while
  // the background coordinator fails the sync round closed.
  if (!liveStateResponse?.ok && typeof queryUserChromeGroups === 'function') {
    try {
      nativeChromeGroups = dashboardWindowId == null
        ? []
        : await queryUserChromeGroups(Number(dashboardWindowId));
    } catch (error) {
      console.warn('[tab-harbor] buildDomainGroups: Chrome group fallback failed:', error);
    }
  }
  if (!liveStateResponse?.ok) {
    const lastToastAt = window.__chromeGroupsErrorToastAt || 0;
    if (Date.now() - lastToastAt > 15000) {
      window.__chromeGroupsErrorToastAt = Date.now();
      showToast(runtimeT ? runtimeT('toastChromeGroupsUnavailable') : 'Could not read Chrome tab groups');
    }
  }

  const nativeAnalysis = getNativeChromeGroupAnalysis(
    nativeChromeGroups,
    realTabs,
    dashboardWindowId,
  );
  chromeTabGroupPreserveKeys = [...nativeAnalysis.unsafeMappedGroupKeys];
  const automaticNativeGroupIds = chromeTabGroupsEnabled
    ? new Set([
        ...nativeAnalysis.mappedGroupIds,
        ...nativeAnalysis.reconcilableCreatedGroupIds,
        ...nativeAnalysis.uniqueCandidateGroupIds,
      ])
    : new Set();
  const userChromeGroups = (nativeChromeGroups || []).filter(group =>
    !automaticNativeGroupIds.has(Number(group.id ?? group.groupId))
  );
  const chromeOwnedTabIds = new Set((userChromeGroups || []).flatMap(group => group.tabIds || []).map(Number));
  const userChromeGroupIds = new Set(userChromeGroups.map(group => Number(group.id ?? group.groupId)));
  for (const tab of realTabs) {
    if (Number.isInteger(tab?.groupId) && userChromeGroupIds.has(Number(tab.groupId))) {
      chromeOwnedTabIds.add(Number(tab.id));
    }
  }
  chromeTabGroupConflicts = chromeTabGroupsEnabled ? nativeAnalysis.conflicts : [];
  const manualGroupMap = Object.fromEntries(
    sessionGroupsState.groups.map(group => [
      group.id,
      {
        domain: `${MANUAL_GROUP_PREFIX}${group.id}`,
        label: group.name,
        tabs: [],
        isManual: true,
        manualGroupId: group.id,
        createdAt: group.createdAt,
      },
    ])
  );
  const groupMap = {};
  const syncGroupMap = {};

  for (const tab of realTabs) {
    const nativeGroupId = Number(tab?.groupId);
    const belongsToMappedNativeGroup = Number.isInteger(nativeGroupId)
      && nativeAnalysis.mappedGroupIds.has(nativeGroupId);
    const belongsToReconcilableCreatedGroup = Number.isInteger(nativeGroupId)
      && nativeAnalysis.reconcilableCreatedGroupIds.has(nativeGroupId);
    const rawMappedGroupKey = Number.isInteger(nativeGroupId)
      ? nativeAnalysis.rawMappedKeysByGroupId.get(nativeGroupId) || ''
      : '';
    const belongsToCandidateNativeGroup = Number.isInteger(nativeGroupId)
      && nativeAnalysis.allCandidateGroupIds.has(nativeGroupId);
    const belongsToAutomaticNativeGroup = automaticNativeGroupIds.has(nativeGroupId);
    const assignedGroupId = sessionGroupsState.assignments[String(tab.id)];
    const definition = getAutomaticTabGroupDefinition(tab);

    // The coordinator needs the complete logical membership to decide whether
    // one native group is safe to adopt or several are ambiguous. Candidate
    // tabs therefore remain in this sync-only snapshot even when ambiguous
    // groups continue rendering as native cards until confirmation.
    const isUngrouped = !Number.isInteger(nativeGroupId) || nativeGroupId < 0;
    const eligibleForAutomaticSync = chromeTabGroupsEnabled
      && !tab?.pinned
      && definition
      && (isUngrouped || belongsToMappedNativeGroup || belongsToReconcilableCreatedGroup
        || belongsToCandidateNativeGroup
        || rawMappedGroupKey === definition.groupKey)
      && (!assignedGroupId || belongsToMappedNativeGroup || belongsToCandidateNativeGroup
        || rawMappedGroupKey === definition.groupKey);
    if (eligibleForAutomaticSync) {
      const key = definition.groupKey;
      if (!syncGroupMap[key]) syncGroupMap[key] = { domain: key, label: definition.label || '', tabs: [] };
      syncGroupMap[key].tabs.push(tab);
    }

    // A tab inside a user-created Chrome group belongs to that group's card.
    if (chromeOwnedTabIds.has(tab.id)) continue;
    try {
      if (assignedGroupId && manualGroupMap[assignedGroupId] && !belongsToAutomaticNativeGroup) {
        manualGroupMap[assignedGroupId].tabs.push({
          ...tab,
          manualGroupId: assignedGroupId,
        });
        continue;
      }
      if (!definition) continue;
      const key = definition.groupKey;
      if (!groupMap[key]) groupMap[key] = { domain: key, label: definition.label || '', tabs: [] };
      groupMap[key].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  chromeTabGroupSyncGroups = Object.values(syncGroupMap);

  const landingPatterns = getAutomaticLandingPagePatterns();
  const landingHostnames = new Set(landingPatterns.map(pattern => pattern.hostname).filter(Boolean));
  const landingSuffixes = landingPatterns.map(pattern => pattern.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(suffix => matchesAutomaticHostnameSuffix(domain, suffix));
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

  for (const group of automaticGroups) {
    if (groupLabelOverrides[group.domain]) {
      group.label = groupLabelOverrides[group.domain];
    }
  }

  // Chrome-group cards mirror the browser's tab strip: one card per
  // user-created group, ordered by the group's first tab position.
  // C12: the openTabs snapshot can lag (async/edge timing), so a tab id the
  // snapshot has not materialized yet must not silently empty the card — keep
  // a minimal placeholder so the card still renders and the next refresh
  // fills the rows in.
  const chromeCards = (userChromeGroups || [])
    .map(group => {
      const groupId = Number(group.id ?? group.groupId);
      const liveIds = Array.isArray(group.tabIds) && group.tabIds.length > 0
        ? group.tabIds
        : realTabs.filter(tab => Number(tab.groupId) === groupId).map(tab => tab.id);
      return {
        domain: `${CHROME_GROUP_PREFIX}${groupId}`,
        label: group.title || 'Group',
        tabs: liveIds.map(id => {
          const live = openTabs.find(t => Number(t.id) === Number(id));
          return live || { id: Number(id), url: '', title: '', windowId: Number(group.windowId), groupId };
        }),
        isChromeGroup: true,
        chromeGroupId: groupId,
        chromeGroupColor: group.color,
        chromeGroupCollapsed: group.collapsed,
        chromePosition: group.minIndex,
      };
    })
    .filter(group => group.tabs.length > 0);

  if (chromeCards.length > 0) {
    domainGroups = [...chromeCards, ...applyGroupOrder([...manualGroups, ...automaticGroups], groupOrderState)];
  } else {
    domainGroups = applyGroupOrder([...manualGroups, ...automaticGroups], groupOrderState);
  }
  await loadGroupTabOrder(domainGroups);
  if (dashboardWindowId != null && automaticGroupingRuleOverridesPublished &&
      typeof runtimeBuildAutomaticChromeSyncSnapshot === 'function') {
    const automaticSnapshot = runtimeBuildAutomaticChromeSyncSnapshot({
      windowId: Number(dashboardWindowId),
      tabs: realTabs,
      nativeGroups: nativeChromeGroups,
      sessionGroups: sessionGroupsState,
      labelOverrides: groupLabelOverrides,
      groupTabOrder: groupTabOrderState,
      landingPagePatterns: typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' && Array.isArray(LOCAL_LANDING_PAGE_PATTERNS)
        ? LOCAL_LANDING_PAGE_PATTERNS
        : [],
      customGroups: typeof LOCAL_CUSTOM_GROUPS !== 'undefined' && Array.isArray(LOCAL_CUSTOM_GROUPS)
        ? LOCAL_CUSTOM_GROUPS
        : [],
      homepagesLabel: runtimeT ? runtimeT('homepagesLabel') : 'Homepages',
    });
    chromeTabGroupSyncGroups = chromeTabGroupsEnabled ? automaticSnapshot.groups : [];
    chromeTabGroupPreserveKeys = chromeTabGroupsEnabled ? automaticSnapshot.preserveGroupKeys : [];
    chromeTabGroupConflicts = chromeTabGroupsEnabled ? automaticSnapshot.analysis.conflicts : [];
  }
  return domainGroups;
}

function renderOpenTabsArea(realTabs = getRealTabs()) {
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = runtimeT ? runtimeT('openTabsSectionTitle') : 'Open tabs';
    if (openTabsSectionCount) {
      openTabsSectionCount.innerHTML = buildOpenTabsSectionActions();
    }
    if (openTabsMissionsEl) openTabsMissionsEl.innerHTML = `${renderTabSessionPicker()}${domainGroups.map(g => renderDomainCard(g)).join('')}`;
    syncWorkspaceTopNavMarkup(renderGroupNavArea(domainGroups), true);
    openTabsSection.style.display = 'block';
    syncChromeTabGroupConflictStatus();
  } else if (openTabsSection) {
    syncWorkspaceTopNavMarkup(renderGroupNavArea([]), true);
    openTabsSection.style.display = 'block';
    syncChromeTabGroupConflictStatus();
    if (openTabsMissionsEl) openTabsMissionsEl.innerHTML = renderMissionsEmptyState();
    if (openTabsSectionCount) openTabsSectionCount.textContent = runtimeT ? runtimeT('emptyTabsCount') : '0 domains';
  }

  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  if (groupRenameEditorState?.shouldFocus) {
    const focusKey = String(groupRenameEditorState.groupKey || '');
    requestAnimationFrame(() => {
      const renameInput = document.querySelector(`[data-group-rename-input="${CSS.escape(focusKey)}"]`);
      if (!renameInput) return;
      renameInput.focus();
      renameInput.select?.();
      if (groupRenameEditorState && groupRenameEditorState.groupKey === focusKey) {
        groupRenameEditorState.shouldFocus = false;
      }
    });
  }

  // Re-apply the selection highlight and prune ids whose rows are gone; this
  // also keeps the batch action bar in sync after any re-render. Expanded
  // overflow state for cards that no longer exist is dropped.
  for (const key of expandedPageChipGroupKeys) {
    if (!domainGroups.some(group => String(group.domain) === key)) expandedPageChipGroupKeys.delete(key);
  }
  refreshPageChipSelectionClasses();
}

async function renderOpenTabsLayout({ rebuildGroups = true, syncChrome = false, patchDom = false, changedGroupKeys = [] } = {}) {
  const realTabs = getRealTabs();
  if (rebuildGroups) {
    await buildDomainGroups(realTabs);
  }
  if (patchDom) {
    patchOpenTabsDomFromGroups(realTabs, changedGroupKeys);
    refreshPageChipSelectionClasses();
  } else {
    renderOpenTabsArea(realTabs);
  }
  setupImageErrorHandlers();
  if (syncChrome) {
    await syncChromeTabGroupsWithoutImportEcho();
  }
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
 * 6. Renders the todos drawer (deferred column)
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Hitokoto (一言) ---
  // The current page instance owns one immutable entry. Re-renders only sync
  // visibility; they never re-select the cache or replace the displayed text.
  syncHitokotoForCurrentPage();

  renderThemeMenu();
  await renderQuickShortcuts();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();
  await loadSessionGroups(getOpenTabIdsForSessionPruning());
  await loadGroupOrder();
  await loadGroupLabelOverrides();
  await buildDomainGroups(realTabs);
  renderOpenTabsArea(realTabs);

  // --- Check for duplicate Tab Harbor tabs ---
  checkTabOutDupes();

  // --- Render the todos drawer (deferred column) ---
  await renderDeferredColumn();
  
  // Setup image error handlers for CSP compliance
  setupImageErrorHandlers();

  if (document.body.classList.contains('showing-saved-tabs-page')) {
    await globalThis.TabHarborSessionManager?.renderSavedTabsPage?.();
  }
}

async function renderDashboard({ syncChromeGroups = true } = {}) {
  await renderStaticDashboard();
  if (!syncChromeGroups) return;
  if (chromeTabGroupsEnabled) {
    await syncChromeTabGroupsWithoutImportEcho();
  } else if (hasCreatedChromeTabGroupMappings() && !chromeTabGroupCleanupRetryTimer) {
    await requestChromeTabGroupCleanup();
  }
}

async function resolveCurrentDashboardTab() {
  let currentTab = null;
  try {
    currentTab = await chrome.tabs.getCurrent();
  } catch {
    currentTab = null;
  }

  if (!currentTab?.id || !currentTab?.windowId) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = activeTab || currentTab || null;
    } catch {
      currentTab = currentTab || null;
    }
  }

  return currentTab;
}

function shouldSkipStartupTabChange(message = {}) {
  if (Date.now() > dashboardStartupTabChangeIgnoreUntil) return false;
  if (message.source !== 'tabs.onCreated' && message.source !== 'tabs.onUpdated') return false;
  if (currentDashboardTabId == null || message.triggerTabId == null) return false;
  return Number(message.triggerTabId) === Number(currentDashboardTabId);
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
  // Clicking outside the tab cards (and the batch action bar) clears the
  // highlight-only selection.
  if (selectedPageChipIds.size > 0 && !e.target.closest('.mission-card') && !e.target.closest('#pageChipBatchBar')) {
    clearPageChipSelection();
  }
  if (e.target.closest('.chip-reorder-handle')) {
    // Keyboard activation (Enter/Space) toggles the row in the selection;
    // pointer clicks are already handled by the pointerup path.
    if (e.detail === 0 && !(draggedPageChipId && pageChipDragState)) {
      const chip = e.target.closest('[data-chip-sort-id]');
      if (chip) {
        const key = String(chip.dataset.chipSortId || '');
        // A touch/pen tap already toggled this row in the pointerup path — the
        // synthesized click must not toggle it a second time. Keyboard clicks
        // are preceded by a keydown, so they never hit this guard.
        if (pageChipPointerToggleGuard.key === key
          && Date.now() < pageChipPointerToggleGuard.until
          && Date.now() - pageChipLastKeydownAt > 120) return;
        if (e.shiftKey && pageChipSelectionAnchorId) selectPageChipRange(key, pageChipSelectionAnchorId);
        else togglePageChipSelection(key);
      }
    }
    return;
  }
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === 'open-chrome-group-merge') {
    openChromeGroupMergeDialog(actionEl.dataset.groupKey || '', actionEl);
    return;
  }

  if (action === 'close-chrome-group-merge') {
    closeChromeGroupMergeDialog();
    return;
  }

  if (action === 'toggle-theme-menu') {
    setThemeMenuOpen(!themeMenuOpen);
    return;
  }

  if (action === 'select-theme-menu-tab') {
    themeMenuActiveTab = actionEl.dataset.themeMenuTab === 'features' ? 'features' : 'appearance';
    renderThemeMenu();
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

  if (action === 'select-quick-shortcut-cols') {
    const cols = ['auto', '4', '5'].includes(actionEl.dataset.cols) ? actionEl.dataset.cols : 'auto';
    await saveThemePreferences({ quickShortcutCols: cols });
    // renderThemeMenu does not know about this choice row, so patch it in place.
    document.querySelectorAll('[data-action="select-quick-shortcut-cols"]').forEach(option => {
      const isActive = option.dataset.cols === cols;
      option.classList.toggle('is-active', isActive);
      option.setAttribute('aria-pressed', String(isActive));
    });
    setThemeMenuOpen(false, { restoreFocus: true });
    return;
  }

  if (action === 'select-search-engine') {
    const engine = ['default', 'google', 'bing', 'baidu', 'sogou', 'duckduckgo', 'brave', 'yandex', 'custom'].includes(actionEl.dataset.engine) ? actionEl.dataset.engine : 'default';
    await saveThemePreferences({ searchEngine: engine });
    syncSearchPlaceholder();
    // renderThemeMenu does not know about this choice row, so patch it in place.
    document.querySelectorAll('[data-action="select-search-engine"]').forEach(option => {
      const isActive = option.dataset.engine === engine;
      option.classList.toggle('is-active', isActive);
      option.setAttribute('aria-pressed', String(isActive));
    });
    const customSection = document.getElementById('customSearchUrlSection');
    if (customSection) customSection.style.display = engine === 'custom' ? '' : 'none';
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

  if (action === 'export-config') {
    e.preventDefault();
    await handleExportConfig();
    return;
  }

  if (action === 'import-config') {
    e.preventDefault();
    document.getElementById('configImportInput')?.click();
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
    window.__suppressAutoRefreshUntil = Date.now() + 2000;

    await closeTabOutDupes();
    await renderDashboard();
    if (window.__tabRefreshTimeout) {
      clearTimeout(window.__tabRefreshTimeout);
      window.__tabRefreshTimeout = null;
    }
    window.__suppressAutoRefreshUntil = 0;
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

  if (action === 'toggle-chrome-tab-groups') {
    const nextEnabled = !chromeTabGroupsEnabled;
    if (typeof setThemeMenuOpen === 'function') setThemeMenuOpen(false);
    await applyChromeTabGroupsToggle(nextEnabled);
    return;
  }

  if (action === 'toggle-hitokoto') {
    const nextEnabled = !(typeof themePreferences !== 'undefined' && themePreferences.hitokotoEnabled);
    await saveThemePreferences({ hitokotoEnabled: nextEnabled });
    syncHitokotoForCurrentPage();
    // Sync toggle switch visual state (renderThemeMenu does not know about this switch)
    const toggleSwitch = document.querySelector('[data-action="toggle-hitokoto"]');
    if (toggleSwitch) {
      toggleSwitch.classList.toggle('is-active', nextEnabled);
      toggleSwitch.setAttribute('aria-pressed', String(nextEnabled));
    }
    return;
  }

  if (action === 'toggle-bookmark-favicons') {
    const nextEnabled = !(typeof themePreferences !== 'undefined' && themePreferences.bookmarksShowFavicons === true);
    await saveThemePreferences({ bookmarksShowFavicons: nextEnabled });
    bookmarksShelfController?.setShowFavicons?.(nextEnabled);
    const toggleSwitch = document.querySelector('[data-action="toggle-bookmark-favicons"]');
    if (toggleSwitch) {
      toggleSwitch.classList.toggle('is-active', nextEnabled);
      toggleSwitch.setAttribute('aria-pressed', String(nextEnabled));
    }
    return;
  }

  if (action === 'toggle-sleep-control') {
    const nextEnabled = sleepControlEnabled !== true;
    await saveThemePreferences({ sleepControlEnabled: nextEnabled });
    sleepControlEnabled = nextEnabled;
    await renderDashboard();
    return;
  }

  if (action === 'toggle-close-duplicate-new-tabs') {
    const nextEnabled = !(typeof themePreferences !== 'undefined' && themePreferences.closeDuplicateNewTabsEnabled);
    await saveThemePreferences({ closeDuplicateNewTabsEnabled: nextEnabled });
    const toggleSwitch = document.querySelector('[data-action="toggle-close-duplicate-new-tabs"]');
    if (toggleSwitch) {
      toggleSwitch.classList.toggle('is-active', nextEnabled);
      toggleSwitch.setAttribute('aria-pressed', String(nextEnabled));
    }
    return;
  }

  if (action === 'toggle-quick-shortcut-open-mode') {
    const nextMode = (typeof themePreferences !== 'undefined' && themePreferences.quickShortcutOpenMode === 'current-tab') ? 'new-tab' : 'current-tab';
    await saveThemePreferences({ quickShortcutOpenMode: nextMode });
    const toggleSwitch = document.querySelector('[data-action="toggle-quick-shortcut-open-mode"]');
    if (toggleSwitch) {
      toggleSwitch.classList.toggle('is-active', nextMode === 'current-tab');
      toggleSwitch.setAttribute('aria-pressed', String(nextMode === 'current-tab'));
    }
    return;
  }

  const card = actionEl.closest('.mission-card');

  if (action === 'save-current-window-session') {
    if (!actionEl.closest('#homePage')) return;
    e.preventDefault();
    await openTabSessionPicker({ source: 'current-window' });
    return;
  }

  if (action === 'close-session-picker') {
    e.preventDefault();
    closeTabSessionPicker();
    return;
  }

  if (action === 'select-session-picker-mode') {
    e.preventDefault();
    const nextMode = actionEl.dataset.sessionPickerMode === 'existing' ? 'existing' : 'new';
    if (nextMode === 'existing' && !tabSessionPickerState.savedSessions?.length) return;
    tabSessionPickerState = {
      ...tabSessionPickerState,
      mode: nextMode,
      targetSessionId: tabSessionPickerState.targetSessionId || String(tabSessionPickerState.savedSessions?.[0]?.id || ''),
    };
    renderOpenTabsArea();
    return;
  }

  if (action === 'toggle-session-picker-group') {
    const groupKey = actionEl.dataset.groupKey || '';
    const groupIds = getTabSessionPickerGroupIds(groupKey, tabSessionPickerState.groups);
    const selected = new Set(getTabSessionPickerSelectedIds());
    const checked = groupIds.length > 0 && groupIds.every(id => selected.has(id));
    groupIds.forEach(id => {
      if (checked) selected.delete(id);
      else selected.add(id);
    });
    tabSessionPickerState = {
      ...tabSessionPickerState,
      selectedTabIds: [...selected],
    };
    renderOpenTabsArea();
    return;
  }

  if (action === 'toggle-session-picker-tab') {
    const tabId = String(actionEl.dataset.tabId || '');
    if (!tabId) return;
    const selected = new Set(getTabSessionPickerSelectedIds());
    if (selected.has(tabId)) selected.delete(tabId);
    else selected.add(tabId);
    tabSessionPickerState = {
      ...tabSessionPickerState,
      selectedTabIds: [...selected],
    };
    renderOpenTabsArea();
    return;
  }

  if (action === 'save-selected-session-tabs') {
    e.preventDefault();
    await submitTabSessionPicker();
    return;
  }

  if (action === 'rename-session-group') {
    e.stopPropagation();
    const groupKey = actionEl.dataset.groupKey || '';
    const manualGroupId = actionEl.dataset.manualGroupId || '';
    openGroupRenameEditor(groupKey, manualGroupId);
    return;
  }

  if (action === 'cancel-group-rename') {
    e.stopPropagation();
    closeGroupRenameEditor();
    await renderDashboard();
    return;
  }

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const cardEl = actionEl.closest('.mission-card');
    const collapsed = cardEl ? [...cardEl.querySelectorAll('.page-chip--collapsed')] : [];
    collapsed.forEach(chip => chip.classList.remove('page-chip--collapsed'));
    actionEl.remove();
    // Remember the expansion so drag commits and refreshes keep it open.
    const groupKey = String(cardEl?.dataset?.groupId || '');
    if (groupKey) expandedPageChipGroupKeys.add(groupKey);
    // Keyboard activation should hand focus to the newly revealed rows
    // instead of dropping it to the page body.
    if (e.detail === 0) {
      const firstHandle = collapsed[0]?.querySelector('[data-chip-drag-handle="tab"]');
      if (firstHandle) firstHandle.focus();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    if (Date.now() < suppressPageChipClickUntil) return;
    const chip = actionEl.closest('[data-chip-sort-id]');
    const key = chip ? String(chip.dataset.chipSortId || '') : '';
    // The pointerup path already handled this gesture as a click (a toggle);
    // the click that follows must not toggle the row again — or jump to the
    // tab the user just deselected. Row bodies are not keyboard-focusable, so
    // no keydown bypass is needed here (unlike the handle branch above).
    const toggleGuardHit = Boolean(key)
      && pageChipPointerToggleGuard.key === key
      && Date.now() < pageChipPointerToggleGuard.until;
    if (toggleGuardHit) return;
    // While a multi-selection exists, clicking a row toggles it in the
    // selection instead of activating the tab — batch mode never jumps.
    if (selectedPageChipIds.size > 0) {
      if (key) {
        if (e.shiftKey && pageChipSelectionAnchorId) {
          selectPageChipRange(key, pageChipSelectionAnchorId);
        } else {
          togglePageChipSelection(key);
        }
      }
      return;
    }
    const tabUrl = actionEl.dataset.tabUrl;
    const tabId = actionEl.dataset.tabId || '';
    if (tabUrl || tabId) await focusTab(tabUrl, tabId);
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
    const tabId = actionEl.dataset.tabId || '';
    if (!tabUrl && !tabId) return;

    // Close the tab in Chrome directly. Prefer id so suspended/canonical URLs
    // and duplicate pages cannot close the wrong tab.
    await runWithSuppressedRefresh(async () => {
      await removeOpenTabByIdOrUrl(tabId, tabUrl);
      await fetchOpenTabs();
      await loadSessionGroups(getOpenTabIdsForSessionPruning());
    });

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

  // ---- Discard (sleep) a single tab ----
  if (action === 'discard-tab') {
    e.stopPropagation();
    const tabId = actionEl.dataset.tabId;
    if (!tabId) return;

    window.__suppressAutoRefreshUntil = Date.now() + 2000;

    // A chip can outlive its tab when the tab is replaced/closed without a
    // refresh (e.g. an OAuth/redirect flow swaps the tab id). Sleeping a ghost
    // id would silently no-op, and the re-render would then drop the dangling
    // manual-group assignment — making the card structure look wrong. Detect it
    // up front: re-render to drop the ghost row, and let the refresh prune any
    // dangling assignment.
    const { discarded, failed, stale } = await sleepTabsByIds([tabId], { skipActive: false });
    if (stale > 0) {
      // The chip outlived its tab: prune the dangling assignment right away
      // (same as the success branch) so the re-render drops both the ghost
      // row and its stale manual-group entry, even if the background refresh
      // message is suppressed by the window below.
      await fetchOpenTabs();
      await loadSessionGroups(getOpenTabIdsForSessionPruning());
      await renderDashboard();
      updateBackToTopVisibility();
      window.__suppressAutoRefreshUntil = 0;
      showToast(runtimeT ? runtimeT('toastTabAlreadyClosed') || 'Tab already closed' : 'Tab already closed');
      return;
    }

    if (failed > 0 || discarded === 0) {
      window.__suppressAutoRefreshUntil = 0;
      showToast(runtimeT ? runtimeT('toastTabDiscardFailed') || 'Failed to sleep tab' : 'Failed to sleep tab');
      return;
    }

    await fetchOpenTabs();
    await loadSessionGroups(getOpenTabIdsForSessionPruning());
    await renderDashboard();
    updateBackToTopVisibility();
    window.__suppressAutoRefreshUntil = 0;

    showToast(runtimeT ? runtimeT('toastTabDiscarded') : 'Tab sleeping');
    return;
  }

  // ---- Save a single tab as its own session snapshot (then close it) ----
  if (action === 'save-single-tab-session') {
    e.stopPropagation();
    const tabId = actionEl.dataset.tabId || '';
    if (!tabId) return;

    await openSessionPickerForTabs([tabId], 'single-tab');
    return;
  }

  // ---- Batch actions for the handle multi-selection ----
  if (action === 'batch-close-tabs') {
    e.stopPropagation();
    if (batchActionInFlight) return;
    batchActionInFlight = true;
    try {
      beginBatchAction();
      const tabIds = getSelectedBatchTabIds();
      const { closedCount } = await closeTabsSafely(tabIds);
      await finishBatchAction({ clearSelection: true });
      showToast(runtimeT ? runtimeT('toastBatchClosed', { count: closedCount }) : `${closedCount} tabs closed`);
      return;
    } finally {
      batchActionInFlight = false;
      window.__suppressAutoRefreshUntil = 0;
    }
  }

  if (action === 'batch-discard-tabs') {
    e.stopPropagation();
    if (!sleepControlEnabled) return;
    if (batchActionInFlight) return;
    batchActionInFlight = true;
    try {
      beginBatchAction();
      // Resolve each selected chip to its live tab id through the current DOM,
      // then keep the ORIGINAL chip sort ids for every tab that survives. This
      // preserves selection across all cards even when a chip sort id is not a
      // plain tab id (e.g. URL-based tokens or placeholder rows).
      const chipTabIds = getPageChipTabIdMap();
      const tabIds = [...selectedPageChipIds]
        .map(chipId => chipTabIds.get(String(chipId)))
        .filter(tabId => tabId != null);
      const { discarded, failed, skippedActive, stale, resultsByTabId } = await sleepTabsByIds(tabIds, { skipActive: true });
      // Chips that could not be resolved to a numeric tab id did not take
      // part in the sleep, so they were not affected — keep them selected.
      // Chips whose tab was processed stay selected when the tab survived
      // (stale/failed/skipped-active included); rows that are really gone
      // are pruned by refreshPageChipSelectionClasses after the render.
      const keptChipIds = [...selectedPageChipIds].filter(chipId => {
        const tabId = chipTabIds.get(String(chipId));
        return tabId == null || resultsByTabId.has(tabId);
      });
      await finishBatchAction({ keptChipIds });
      if (discarded > 0) {
        showToast(runtimeT ? runtimeT('toastTabsDiscarded', { count: discarded }) : `${discarded} tabs sleeping`);
      } else if (failed > 0) {
        showToast(runtimeT ? runtimeT('toastTabDiscardFailed') : 'Failed to sleep tab');
      } else if (skippedActive > 0) {
        showToast(runtimeT ? runtimeT('toastBatchSleepNone') : 'Selected tabs are active');
      } else if (stale > 0) {
        showToast(runtimeT ? runtimeT('toastTabAlreadyClosed') : 'Tab already closed');
      }
      return;
    } finally {
      batchActionInFlight = false;
      window.__suppressAutoRefreshUntil = 0;
    }
  }

  // ---- Deduplicate within the selection, keep one copy per URL ----
  if (action === 'batch-dedup-selection') {
    e.stopPropagation();
    if (batchActionInFlight) return;
    batchActionInFlight = true;
    try {
      beginBatchAction();
      const chipTabIds = getPageChipTabIdMap();
      const tabIds = getSelectedBatchTabIds();
      const { closedCount, closedTabIds } = await closeDuplicatesInSelection(tabIds);
      // Keep the ORIGINAL chip sort ids that survive dedup, so selection is
      // preserved on every card even when a chip id is not a plain tab id.
      // Chips without a resolvable numeric tab id did not take part in the
      // dedup — keep them selected. refreshPageChipSelectionClasses prunes
      // any id that no longer has a row.
      const keptChipIds = [...selectedPageChipIds].filter(chipId => {
        const tabId = chipTabIds.get(String(chipId));
        return tabId == null || !closedTabIds.has(tabId);
      });
      await finishBatchAction({ keptChipIds });
      if (closedCount > 0) {
        showToast(runtimeT
          ? runtimeT('toastBatchClosedDuplicates', { count: closedCount })
          : `Closed ${closedCount} duplicate tabs`);
      } else {
        showToast(runtimeT ? runtimeT('toastBatchNoDuplicates') : 'No duplicate tabs in selection');
      }
      return;
    } finally {
      batchActionInFlight = false;
      window.__suppressAutoRefreshUntil = 0;
    }
  }

  if (action === 'batch-save-session') {
    e.stopPropagation();
    const tabIds = getSelectedBatchTabIds().map(String);
    if (!tabIds.length) return;
    await openSessionPickerForTabs(tabIds, 'selected');
    return;
  }

  // ---- Merge the whole selection into ONE new Chrome tab group ----
  if (action === 'batch-merge-chrome-group') {
    e.stopPropagation();
    if (batchActionInFlight) return;
    batchActionInFlight = true;
    try {
      // Skip pinned tabs (Chrome cannot group them). Tabs already inside a
      // Chrome group ARE merged: chrome.tabs.group without a groupId moves them
      // out of their source group and into the newly created group.
      const pinnedIds = new Set((openTabs || []).filter(t => t?.pinned).map(t => Number(t.id)));
      const allSelected = getSelectedBatchTabIds();
      const tabIds = allSelected.filter(id => !pinnedIds.has(id));
      const skippedCount = allSelected.length - tabIds.length;
      if (!tabIds.length) {
        showToast(runtimeT ? runtimeT('toastBatchMergeNoEligible') : 'No eligible tabs to merge');
        return;
      }
      beginBatchAction();

      let mergeResult;
      try {
        // Resolve the name from the ACTUAL merged ids: stale ids dropped by
        // groupTabsWithStaleRetry must not drive the group name.
        const title = (mergedIds) => buildBatchMergeGroupTitle(mergedIds);
        const color = typeof runtimeAssignGroupColor === 'function'
          ? runtimeAssignGroupColor('all', chromeGroupMergeColorIndex++)
          : 'blue';
        mergeResult = await mergeTabsIntoChromeGroup(tabIds, { title, color });
      } catch (err) {
        window.__suppressAutoRefreshUntil = 0;
        showToast(runtimeT ? runtimeT('toastGroupCreateFailed') : 'Could not create Chrome tab group');
        return;
      }

      // Tabs moving into a native group drop their dashboard manual-group
      // assignments (same cleanup as the drag-into-Chrome-group path). The
      // group side effect has already happened, so a storage failure must not
      // leave the selection/suppression dangling (C6/C22).
      const mergedTabIds = mergeResult?.mergedTabIds || tabIds;
      try {
        let nextState = clearTabsFromSessionGroups(sessionGroupsState, mergedTabIds);
        nextState = pruneSessionGroups(nextState, getOpenTabIdsForSessionPruning());
        await saveSessionGroups(nextState);
      } catch (err) {
        console.warn('[tab-harbor] batch merge: session cleanup failed after group creation:', err);
        await finishBatchAction({ clearSelection: true });
        showToast(runtimeT ? runtimeT('toastBatchMergeCleanupFailed') : 'Merged tabs, but could not update saved groups');
        return;
      }

      await finishBatchAction({ clearSelection: true });
      if (!mergeResult.updated) {
        showToast(runtimeT
          ? runtimeT('toastBatchMergedGroupRenameFailed', { count: mergedTabIds.length })
          : `Merged ${mergedTabIds.length} tabs, but could not name the group`);
      } else if (skippedCount > 0) {
        showToast(runtimeT
          ? runtimeT('toastBatchMergedChromeGroupWithSkipped', { count: mergedTabIds.length, skipped: skippedCount })
          : `Merged ${mergedTabIds.length} tabs into a Chrome tab group (${skippedCount} skipped)`);
      } else {
        showToast(runtimeT
          ? runtimeT('toastBatchMergedChromeGroup', { count: mergedTabIds.length })
          : `Merged ${mergedTabIds.length} tabs into a Chrome tab group`);
      }
      return;
    } finally {
      batchActionInFlight = false;
      window.__suppressAutoRefreshUntil = 0;
    }
  }

  if (action === 'clear-chip-selection') {
    e.stopPropagation();
    clearPageChipSelection();
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    if (cardActionInFlight) return;
    cardActionInFlight = true;
    try {
      const domainId = actionEl.dataset.domainId;
      const group    = domainGroups.find(g => {
        return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
      });
      if (!group) return;

      // Suppress auto-refresh to prevent animation spam
      window.__suppressAutoRefreshUntil = Date.now() + 2000;

      const urls      = group.tabs.map(t => t.url);
      // Landing pages and custom groups (whose domain key isn't a real hostname)
      // must use exact URL matching to avoid closing unrelated tabs. Chrome-group
      // cards are scoped by their own tab ids: URL matching would close same-URL
      // tabs outside the group (C12).
      const useExact  = group.domain === '__landing-pages__' || !!group.label;

      // Start the card exit immediately so the close feels instant; the tabs
      // close in the background below (the suppressed refresh syncs the rest).
      if (card) {
        playCloseSound();
        animateCardOut(card);
      }

      // Remove from in-memory groups
      const idx = domainGroups.indexOf(group);
      if (idx !== -1) domainGroups.splice(idx, 1);

      // Close the tabs in the background (the card is already exiting), then
      // rebuild so the nav and remaining cards reflect the closed group.
      let closeResult = { closedCount: 0 };
      try {
        if (group.isChromeGroup) {
          const tabIds = group.tabs.map(t => Number(t.id)).filter(Number.isFinite);
          closeResult = await closeTabsSafely(tabIds, { playSound: false });
        } else {
          closeResult = await closeTabsByUrlsSafely(urls, { exact: useExact, playSound: false });
        }
      } catch { /* swallow: tabs may already be gone */ }
      await renderDashboard();
      window.__suppressAutoRefreshUntil = 0;

      const closedCount = group.isChromeGroup ? closeResult.closedCount : urls.length;
      const groupLabel = group.domain === '__landing-pages__'
        ? (runtimeT ? runtimeT('homepagesLabel') : 'Homepages')
        : (group.label || friendlyDomain(group.domain));
      const tabsWord = runtimeT
        ? (closedCount === 1 ? runtimeT('tabsWordSingular') : runtimeT('tabsWordPlural'))
        : `tab${closedCount !== 1 ? 's' : ''}`;
      showToast(runtimeT
        ? runtimeT('closedTabsFromGroup', { count: closedCount, tabsWord, groupLabel })
        : `Closed ${closedCount} ${tabsWord} from ${groupLabel}`);

      const statTabs = document.getElementById('statTabs');
      if (statTabs) statTabs.textContent = openTabs.length;
      return;
    } finally {
      cardActionInFlight = false;
    }
  }

  // ---- Save a whole domain group as one session snapshot (then close it) ----
  if (action === 'save-domain-session') {
    e.preventDefault();
    const domainId = actionEl.dataset.domainId || '';
    const group = domainGroups.find(g => getStableGroupId(g.domain) === domainId);
    if (!group) return;

    const tabIds = getOrderedUniqueTabsForGroup(group)
      .map(tab => String(tab?.id || ''))
      .filter(Boolean);
    if (!tabIds.length) return;

    await openSessionPickerForTabs(tabIds, 'group');
    return;
  }

  // ---- Sleep all tabs in a domain group ----
  if (action === 'sleep-domain-tabs') {
    if (cardActionInFlight) return;
    cardActionInFlight = true;
    try {
      const domainId = actionEl.dataset.domainId || '';
      const group = domainGroups.find(g => getStableGroupId(g.domain) === domainId);
      if (!group) return;

      // Already-discarded rows have no sleep button and cannot be discarded
      // again; filter them out so "nothing left to sleep" is a silent no-op
      // instead of a misleading failure toast.
      const tabIds = getOrderedUniqueTabsForGroup(group).filter(t => !t.active && !t.discarded).map(t => t.id);
      if (!tabIds.length) return;

      window.__suppressAutoRefreshUntil = Date.now() + 2000;

      const { discarded } = await sleepTabsByIds(tabIds, { skipActive: true });
      if (discarded === 0) {
        window.__suppressAutoRefreshUntil = 0;
        showToast(runtimeT ? runtimeT('toastTabDiscardFailed') || 'Failed to sleep tabs' : 'Failed to sleep tabs');
        return;
      }

      await fetchOpenTabs();
      await loadSessionGroups(getOpenTabIdsForSessionPruning());
      await renderDashboard();
      window.__suppressAutoRefreshUntil = 0;

      showToast(runtimeT
        ? runtimeT('toastTabsDiscarded', { count: discarded })
        : `${discarded} tabs sleeping`);
      return;
    } finally {
      cardActionInFlight = false;
    }
  }

  // ---- Sleep all open tabs ----
  if (action === 'sleep-all-open-tabs') {
    // Same as the per-group path: already-discarded tabs are not sleepable
    // again, so an all-slept window is a silent no-op, not a false failure.
    const tabIds = getRealTabs().filter(t => !t.active && !t.discarded).map(t => t.id);
    if (!tabIds.length) return;

    window.__suppressAutoRefreshUntil = Date.now() + 2000;

    const { discarded } = await sleepTabsByIds(tabIds, { skipActive: true });
    if (discarded === 0) {
      window.__suppressAutoRefreshUntil = 0;
      showToast(runtimeT ? runtimeT('toastTabDiscardFailed') || 'Failed to sleep tabs' : 'Failed to sleep tabs');
      return;
    }

    await fetchOpenTabs();
    await loadSessionGroups(getOpenTabIdsForSessionPruning());
    await renderDashboard();
    window.__suppressAutoRefreshUntil = 0;

    showToast(runtimeT
      ? runtimeT('toastTabsDiscarded', { count: discarded })
      : `${discarded} tabs sleeping`);
    return;
  }

  // ---- Merge tabs into one Chrome tab group ----
  if (action === 'group-card-tabs') {
    if (cardActionInFlight) return;
    cardActionInFlight = true;
    try {
      const scope = actionEl.dataset.scope || '';
      const domainId = actionEl.dataset.domainId || '';
      const group = scope === 'all' ? null : domainGroups.find(g => getStableGroupId(g.domain) === domainId);
      if (scope !== 'all' && !group) return;

      const tabIds = [];
      if (scope === 'all') {
        // Section-header variant: merge every open tab (all cards) into one
        // Chrome tab group. Pinned tabs and existing Chrome-group cards stay
        // outside the merged group.
        for (const g of domainGroups) {
          if (g.isChromeGroup) continue;
          for (const tab of getOrderedUniqueTabsForGroup(g)) {
            const id = Number(tab?.id);
            if (!Number.isInteger(id) || id <= 0) continue;
            if (tab?.pinned) continue;
            tabIds.push(id);
          }
        }
      } else if (group) {
        // Per-domain merge: pinned tabs stay outside the merged Chrome group,
        // matching the section-header merge-all path (Chrome cannot group them).
        for (const tab of getOrderedUniqueTabsForGroup(group)) {
          const id = Number(tab?.id);
          if (!Number.isInteger(id) || id <= 0) continue;
          if (tab?.pinned) continue;
          tabIds.push(id);
        }
      }
      if (!tabIds.length) return;

      // Suppress auto-refresh to prevent animation spam
      window.__suppressAutoRefreshUntil = Date.now() + 2000;
      // The dashboard's own group write must not echo through the event
      // subscription (same mute contract as every other group write path).
      if (typeof muteChromeGroupEvents === 'function') muteChromeGroupEvents();

      let mergeResult;
      try {
        // The merge-all label is count-based: resolve it from the ACTUAL merged
        // ids so stale ids dropped by groupTabsWithStaleRetry cannot inflate the
        // count in the group title.
        const label = scope === 'all'
          ? (mergedIds) => (runtimeT ? runtimeT('mergeAllGroupTitle', { count: mergedIds.length }) : `Open tabs (${mergedIds.length})`)
          : getGroupDisplayLabel(group);
        // Merged groups rotate through the accent palette (not always grey):
        // both the section-header merge-all and the per-domain merge use the
        // same shared counter so consecutive merges get different colors.
        const color = typeof runtimeAssignGroupColor === 'function'
          ? runtimeAssignGroupColor(scope === 'all' ? 'all' : group.domain, chromeGroupMergeColorIndex++)
          : 'blue';
        mergeResult = await mergeTabsIntoChromeGroup(tabIds, { title: label, color });
      } catch (err) {
        window.__suppressAutoRefreshUntil = 0;
        showToast(runtimeT ? runtimeT('toastGroupCreateFailed') : 'Could not create Chrome tab group');
        return;
      }

      // Tabs moving into a native group drop their dashboard manual-group
      // assignments, matching the batch-merge and drag-into-Chrome-group paths
      // (C2). Use the actual merged ids so stale tabs are not carried forward.
      const mergedTabIds = mergeResult?.mergedTabIds || tabIds;
      let cleanupFailed = false;
      try {
        let nextState = clearTabsFromSessionGroups(sessionGroupsState, mergedTabIds);
        nextState = pruneSessionGroups(nextState, getOpenTabIdsForSessionPruning());
        await saveSessionGroups(nextState);
      } catch (err) {
        cleanupFailed = true;
        console.warn('[tab-harbor] group-card merge: session cleanup failed:', err);
      }

      // The merge consumes the selection (matching the batch-merge path, which
      // calls finishBatchAction({ clearSelection: true })): without this the
      // handle multi-selection would keep highlighting rows that now live in
      // the native group.
      clearPageChipSelection();

      // Rebuild so the card reflects the new native group right away.
      await renderDashboard();
      window.__suppressAutoRefreshUntil = 0;

      if (cleanupFailed) {
        showToast(runtimeT ? runtimeT('toastBatchMergeCleanupFailed') : 'Merged tabs, but could not update saved groups');
      } else if (mergeResult.updated) {
        showToast(runtimeT ? runtimeT('toastGroupCreated') : 'Created Chrome tab group');
      } else {
        showToast(runtimeT
          ? runtimeT('toastBatchMergedGroupRenameFailed', { count: mergedTabIds.length })
          : `Merged ${mergedTabIds.length} tabs, but could not name the group`);
      }
      return;
    } finally {
      cardActionInFlight = false;
    }
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    if (cardActionInFlight) return;
    cardActionInFlight = true;
    try {
      // Chrome-group cards dedup within their own tab set only; URL-wide
      // matching would close same-URL tabs outside the group (C12).
      const chromeCard = actionEl.closest('.mission-card.chrome-group-card');
      const chromeGroupId = chromeCard?.dataset?.chromeGroupId;
      const chromeGroup = chromeGroupId
        ? domainGroups.find(g => g.isChromeGroup && String(g.chromeGroupId) === String(chromeGroupId))
        : null;
      const urlsEncoded = actionEl.dataset.dupeUrls || '';
      const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
      const chromeTabIds = chromeGroup
        ? chromeGroup.tabs.map(t => Number(t.id)).filter(Number.isFinite)
        : [];

      // No-op selections must return BEFORE the refresh-suppression window is
      // raised: an early return can never leak a 2s auto-refresh block.
      if (chromeGroup ? chromeTabIds.length === 0 : urls.length === 0) return;

      // Suppress auto-refresh to prevent animation spam
      window.__suppressAutoRefreshUntil = Date.now() + 2000;

      if (chromeGroup) {
        await closeDuplicatesInSelection(chromeTabIds, { playSound: false });
      } else {
        await closeDuplicatesByUrls(urls, { keepOne: true, playSound: false });
      }
      playCloseSound();

      // Rebuild the open-tabs area right away so the kept copy shows
      // immediately. The suppression above deliberately drops the event-driven
      // refresh, so without this call the stale duplicate chips would stay
      // visible until the next unsuppressed tab event (~2s later).
      await renderDashboard();
      window.__suppressAutoRefreshUntil = 0;

      showToast(runtimeT ? runtimeT('toastClosedDuplicatesKeptOne') : 'Closed duplicates, kept one copy each');
      return;
    } finally {
      cardActionInFlight = false;
    }
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    // Suppress auto-refresh to prevent animation spam
    window.__suppressAutoRefreshUntil = Date.now() + 2000;
    
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrlsSafely(allUrls, { playSound: false });
    await refreshTabData();
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });
    window.__suppressAutoRefreshUntil = 0;

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

});

document.addEventListener('click', (e) => {
  const todoTrigger = e.target.closest('#todoTrigger');
  if (todoTrigger) {
    if (Date.now() < deferredTriggerSuppressClickUntil) return;
    const nextOpen = !deferredPanelOpen;
    drawerView = 'todos';
    setDeferredPanelOpen(nextOpen);
    return;
  }

  if (e.target.closest('#deferredOverlay')) {
    setDeferredPanelOpen(false);
  }
});

document.addEventListener('pointerdown', (e) => {
  if (!groupRenameEditorState) return;
  if (e.target.closest('.mission-rename-form') || e.target.closest('[data-action="rename-session-group"]')) return;
  void submitGroupRenameEditor();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && themeMenuOpen) {
    setThemeMenuOpen(false, { restoreFocus: true });
    return;
  }

  if (e.key === 'Escape' && groupRenameEditorState) {
    closeGroupRenameEditor();
    void renderDashboard();
    return;
  }

  if (e.key === 'Escape' && deferredPanelOpen && todoEditorState?.open) {
    closeTodoEditor();
    void renderDeferredColumn();
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

// @lat: [[features#Tab row multi-select and batch drag]]
/**
 * togglePageChipSelection(chipId)
 *
 * Handle-click toggles a row into the highlight-only selection. Selected
 * rows reorder together when one of them is dragged within its group.
 */
function togglePageChipSelection(chipId) {
  const key = String(chipId || '');
  if (!key) return;
  if (selectedPageChipIds.has(key)) selectedPageChipIds.delete(key);
  else selectedPageChipIds.add(key);
  pageChipSelectionAnchorId = key;
  refreshPageChipSelectionClasses();
}

function refreshPageChipSelectionClasses() {
  const seen = new Set();
  document.querySelectorAll('.page-chip[data-chip-sort-id]').forEach(row => {
    const id = String(row.dataset.chipSortId || '');
    seen.add(id);
    const selected = selectedPageChipIds.has(id);
    row.classList.toggle('is-selected', selected);
    const handle = row.querySelector('[data-chip-drag-handle="tab"]');
    if (handle) handle.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  // Prune ids whose rows are gone (closed tabs) so stale selections cannot
  // linger, inflate the batch count, or highlight an unrelated tab later.
  for (const id of selectedPageChipIds) {
    if (!seen.has(id)) {
      selectedPageChipIds.delete(id);
      if (pageChipSelectionAnchorId === id) pageChipSelectionAnchorId = '';
    }
  }
  syncPageChipBatchBar();
}

function clearPageChipSelection() {
  selectedPageChipIds.clear();
  pageChipSelectionAnchorId = '';
  refreshPageChipSelectionClasses();
}

/**
 * selectPageChipRange(targetId, anchorId)
 *
 * Shift+click / Shift+Space selects every row between the anchor (last toggled
 * row) and the target within the same card, inclusive. Cross-card targets fall
 * back to a plain toggle.
 */
function selectPageChipRange(targetId, anchorId) {
  const targetKey = String(targetId || '');
  const anchorKey = String(anchorId || '');
  if (!targetKey) return;
  const targetEl = document.querySelector(`.page-chip[data-chip-sort-id="${CSS.escape(targetKey)}"]`);
  const anchorEl = anchorKey ? document.querySelector(`.page-chip[data-chip-sort-id="${CSS.escape(anchorKey)}"]`) : null;
  if (!targetEl) return;
  if (!anchorEl || targetEl.closest('.mission-card') !== anchorEl.closest('.mission-card')) {
    togglePageChipSelection(targetKey);
    return;
  }
  const card = targetEl.closest('.mission-card');
  // Collapsed overflow rows are not part of the visible range.
  const rows = [...card.querySelectorAll('.page-chip[data-chip-sort-id]:not(.page-chip--collapsed)')];
  const start = rows.indexOf(anchorEl);
  const end = rows.indexOf(targetEl);
  if (start === -1 || end === -1) {
    togglePageChipSelection(targetKey);
    return;
  }
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  for (let i = lo; i <= hi; i += 1) {
    selectedPageChipIds.add(String(rows[i].dataset.chipSortId));
  }
  pageChipSelectionAnchorId = targetKey;
  refreshPageChipSelectionClasses();
}

/**
 * buildBatchMergeGroupTitle(tabIds)
 *
 * Names a new Chrome tab group from the SELECTED tabs' content: the most
 * frequent domain wins (single-domain selections use the bare site name, e.g.
 * "GitHub"; mixed selections append the count, e.g. "GitHub ×3"), falling back
 * to the first tab's title when no domain is resolvable, then to the generic
 * "Selected (N)" label. Chrome exposes no content-aware naming API, so the
 * heuristic runs locally.
 */
function buildBatchMergeGroupTitle(tabIds) {
  // Keep common brand names in their canonical casing; friendlyDomain would
  // otherwise turn "github.com" into "Github".
  const BRAND_DOMAIN_LABELS = {
    'github.com': 'GitHub',
    'youtube.com': 'YouTube',
  };
  const tabs = getTabsByIds(tabIds);
  const counts = new Map();
  for (const tab of tabs) {
    const rawUrl = String(tab?.url || '');
    // Internal pages (chrome://, about:) never drive the group name.
    if (/^(chrome|about|edge|brave|opera):/i.test(rawUrl)) continue;
    let hostname = '';
    try { hostname = new URL(rawUrl).hostname || ''; } catch { hostname = ''; }
    if (!hostname) continue;
    hostname = hostname.replace(/^www\./, '');
    if (!hostname) continue;
    counts.set(hostname, (counts.get(hostname) || 0) + 1);
  }
  if (counts.size > 0) {
    let topDomain = '';
    let topCount = 0;
    for (const [domain, count] of counts) {
      if (count > topCount) {
        topDomain = domain;
        topCount = count;
      }
    }
    const label = BRAND_DOMAIN_LABELS[topDomain] || friendlyDomain(topDomain) || topDomain || 'Group';
    return counts.size === 1 ? label : `${label} ×${topCount}`;
  }
  const firstTitle = tabs.find(t => t?.title)?.title;
  if (firstTitle) return firstTitle.trim().slice(0, 40) || 'Group';
  return runtimeT ? runtimeT('batchMergeGroupTitle', { count: tabIds.length }) : `Selected (${tabIds.length})`;
}

/**
 * syncPageChipBatchBar()
 *
 * While a multi-selection exists, the open-tabs section header transforms in
 * place: the title becomes the selection count and the header's icon actions
 * are replaced by the batch action bar (clear / dedup / merge / sleep / save
 * / close). The row keeps the section header's height and quiet style — no
 * separate strip is appended.
 */
function syncPageChipBatchBar() {
  const count = selectedPageChipIds.size;
  const section = document.getElementById('openTabsSection');
  const header = section ? section.querySelector('.section-header') : null;
  const titleEl = document.getElementById('openTabsSectionTitle');
  const countEl = document.getElementById('openTabsSectionCount');
  if (!section || !header || !titleEl || !countEl) return;
  // The title carries the selection count while selected; announce the swap.
  titleEl.setAttribute('aria-live', 'polite');
  let bar = document.getElementById('pageChipBatchBar');
  if (count === 0) {
    section.classList.remove('has-chip-selection');
    if (bar) bar.remove();
    titleEl.textContent = runtimeT ? runtimeT('openTabsSectionTitle') : 'Open tabs';
    countEl.style.display = '';
    return;
  }
  section.classList.add('has-chip-selection');
  titleEl.textContent = runtimeT ? runtimeT('batchSelectedCount', { count }) : `${count} selected`;
  countEl.style.display = 'none';
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'pageChipBatchBar';
    bar.className = 'page-chip-batch-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', runtimeT ? runtimeT('batchBarLabel') : 'Selected tabs');
    bar.innerHTML = `
      <button type="button" class="page-chip-batch-action" data-action="clear-chip-selection" aria-label="${runtimeT ? runtimeT('batchClearSelection') : 'Clear selection'}" data-tooltip="${runtimeT ? runtimeT('batchClearSelection') : 'Clear selection'}">${ICONS.deselect}</button>
      <button type="button" class="page-chip-batch-action" data-action="batch-dedup-selection" aria-label="${runtimeT ? runtimeT('batchCloseDuplicates') : 'Close selected duplicates'}" data-tooltip="${runtimeT ? runtimeT('batchCloseDuplicates') : 'Close selected duplicates'}">${ICONS.closeDuplicates}</button>
      <button type="button" class="page-chip-batch-action" data-action="batch-merge-chrome-group" aria-label="${runtimeT ? runtimeT('batchMergeChromeGroup') : 'Merge into Chrome group'}" data-tooltip="${runtimeT ? runtimeT('batchMergeChromeGroup') : 'Merge into Chrome group'}">${ICONS.mergeGroup}</button>
      ${sleepControlEnabled ? `<button type="button" class="page-chip-batch-action" data-action="batch-discard-tabs" aria-label="${runtimeT ? runtimeT('batchSleepTabs') : 'Sleep selected'}" data-tooltip="${runtimeT ? runtimeT('batchSleepTabs') : 'Sleep selected'}">${ICONS.moon}</button>` : ''}
      <button type="button" class="page-chip-batch-action" data-action="batch-save-session" aria-label="${runtimeT ? runtimeT('batchSaveSession') : 'Save session'}" data-tooltip="${runtimeT ? runtimeT('batchSaveSession') : 'Save session'}">${ICONS.archive}</button>
      <button type="button" class="page-chip-batch-action" data-action="batch-close-tabs" aria-label="${runtimeT ? runtimeT('batchCloseTabs') : 'Close selected'}" data-tooltip="${runtimeT ? runtimeT('batchCloseTabs') : 'Close selected'}">${ICONS.close}</button>
    `;
    header.insertBefore(bar, countEl);
  }
}

// Escape clears the highlight-only selection; a drag in flight is cancelled
// first so it cannot commit a stale batch. Space on a focused reorder handle
// is left to the native <button> activation (keyup → click), which already
// suppresses page scrolling for buttons — preventing the keydown would cancel
// that activation and break the keyboard toggle.
let pageChipLastKeydownAt = 0;
document.addEventListener('keydown', (e) => {
  pageChipLastKeydownAt = Date.now();
  if (e.key !== 'Escape') return;
  // A commit is in flight: leave both the drag state and the selection alone.
  // Clearing pageChipDragState mid-commit makes the commit read null after an
  // await and leaves a half-applied move (C9).
  if (pageChipCommitInFlight) return;
  if (draggedPageChipId && pageChipDragState) {
    clearPageChipDragState({ removeNode: false });
  }
  if (selectedPageChipIds.size > 0) {
    clearPageChipSelection();
  }
});

document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === 'toggle-todo-search') {
    todoSearchOpen = !todoSearchOpen;
    if (!todoSearchOpen) todoSearchQuery = '';
    await renderDeferredColumn();
    return;
  }

  if (action === 'create-todo') {
    drawerView = 'todos';
    todoDetailId = '';
    openTodoEditor({ mode: 'create' });
    await renderDeferredColumn();
    focusTodoEditorTitle();
    return;
  }

  if (action === 'edit-todo') {
    const id = actionEl.dataset.todoId;
    if (!id) return;
    const todos = await getTodos();
    const todo = todos.find(item => item.id === id && !item.dismissed);
    if (!todo) return;
    drawerView = 'todos';
    openTodoEditor({
      mode: 'edit',
      todo,
    });
    await renderDeferredColumn();
    focusTodoEditorTitle();
    return;
  }

  if (action === 'update-todo-editor-field') {
    setTodoEditorField(actionEl.dataset.field || '', actionEl.value || '');
    return;
  }

  if (action === 'submit-todo-editor') {
    e.preventDefault();
    await submitTodoEditor();
    return;
  }

  if (action === 'cancel-todo-editor') {
    closeTodoEditor();
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

  if (action === 'delete-todo') {
    const id = actionEl.dataset.todoId;
    if (!id) return;
    await deleteTodoItem(id);
    if (todoDetailId === id) todoDetailId = '';
    if (todoEditorState?.todoId === id) closeTodoEditor();
    showToast(runtimeT ? runtimeT('toastTodoDeleted') : 'Todo deleted');
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
  const chipItem = e.target.closest('[data-chip-sort-id]');
  const chipAction = e.target.closest('.chip-actions');
  // The whole row is the drag surface — the handle is just the visible grip.
  // A press that never moves is a click: the handle toggles the row in the
  // selection, and the row body activates the tab (unless a multi-selection
  // is active, in which case it toggles the row too). A press that moves
  // drags the row (or the whole selection) no matter where it started; the
  // click that follows a completed drag is suppressed in the pointerup path.
  if (chipItem && !chipAction && e.button === 0) {
    // Re-entrancy guard: a second pointer must not clobber an in-flight drag
    // (first drag would be silently lost and its capture never released).
    if (pageChipDragState || draggedPageChipId) return;
    const item = chipItem;
    const listEl = item?.parentElement;
    const groupKey = item?.dataset.chipGroupId || '';
    if (!item || !listEl || !groupKey) return;

    e.preventDefault();
    e.stopPropagation();
    draggedPageChipId = item.dataset.chipSortId || '';
    draggedPageChipEl = item;
    const dragHandleEl = chipHandle || item;
    document.body.classList.add('page-chip-drag-armed');

    const rect = item.getBoundingClientRect();
    pageChipDragState = {
      sourceGroupKey: groupKey,
      sourceListEl: listEl,
      dropGroupKey: groupKey,
      dropListEl: listEl,
      dropCardEl: item.closest('.mission-card'),
      createNewGroup: false,
      newGroupPlacement: '',
      handleEl: dragHandleEl,
      // Handle presses toggle on click; body presses only toggle while a
      // multi-selection is already active (otherwise the click jumps).
      originatedFromHandle: Boolean(chipHandle),
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      moved: false,
      movingChipIds: getMovingPageChipIds(),
    };
    logPageChipDragDebug('pointerdown', {
      groupKey,
      chip: draggedPageChipId,
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      pointerId: e.pointerId,
      moving: pageChipDragState.movingChipIds.length,
    });
    if (typeof dragHandleEl.setPointerCapture === 'function' && e.pointerId != null) {
      try {
        dragHandleEl.setPointerCapture(e.pointerId);
        logPageChipDragDebug('capture', { pointerId: e.pointerId });
      } catch {}
    }
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
      startPageChipDragVisuals();
    }

    if (pageChipDragState.moved) {
      pageChipDragState.lastClientX = e.clientX;
      pageChipDragState.lastClientY = e.clientY;
      updateDraggedPageChipPosition(e.clientX, e.clientY);
      previewPageChipOrder(e.clientX, e.clientY);
      updatePageChipAutoScroll(e.clientX, e.clientY);
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

document.addEventListener('pointerup', async (e) => {
  if (draggedPageChipId && pageChipDragState) {
    if (pageChipDragState.pointerId != null && e.pointerId != null && pageChipDragState.pointerId !== e.pointerId) return;
    logPageChipDragDebug('pointerup', {
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      pointerId: e.pointerId,
      moved: pageChipDragState.moved,
    });
    // A press that never moved is a click, not a drag. The handle always
    // toggles the row in the highlight-only selection (Shift extends the
    // range from the anchor); the row body only toggles while a selection is
    // already active — a plain body click stays a click so the synthesized
    // click event can activate the tab.
    const finalDistance = Math.hypot(e.clientX - pageChipDragState.x, e.clientY - pageChipDragState.y);
    if (!pageChipDragState.moved && finalDistance < 4) {
      const toggleAsClick = pageChipDragState.originatedFromHandle
        || selectedPageChipIds.size > 0
        || e.shiftKey;
      if (toggleAsClick) {
        // Guard the synthesized click that follows on touch/pen devices so the
        // row is not toggled twice.
        pageChipPointerToggleGuard = { key: String(draggedPageChipId || ''), until: Date.now() + 400 };
        if (e.shiftKey && pageChipSelectionAnchorId) {
          selectPageChipRange(draggedPageChipId, pageChipSelectionAnchorId);
        } else {
          togglePageChipSelection(draggedPageChipId);
        }
      } else {
        // No toggle happened, so there is no synthesized click to guard — a
        // stale guard must not swallow the click that activates the tab.
        pageChipPointerToggleGuard = { key: '', until: 0 };
      }
      clearPageChipDragState({ removeNode: false });
      return;
    }
    if (!pageChipDragState.moved) {
      const distance = Math.hypot(e.clientX - pageChipDragState.x, e.clientY - pageChipDragState.y);
      if (distance >= 4) {
        startPageChipDragVisuals();
      }
    }
    // A completed drag must not let the click that follows it activate the
    // tab (the click lands on the row under the pointer). Suppress it here,
    // synchronously, because the click is dispatched before the async commit
    // inside finishPageChipDrag finishes.
    suppressPageChipClickUntil = Date.now() + 250;
    updateDraggedPageChipPosition(e.clientX, e.clientY);
    const stickyTarget = pageChipDragState.lastResolvedDropTarget;
    const stickyIsNonSource = stickyTarget && (
      stickyTarget.kind === 'new-group'
      || (stickyTarget.kind === 'group' && stickyTarget.groupKey && stickyTarget.groupKey !== pageChipDragState.sourceGroupKey)
    );
    if (!stickyIsNonSource) {
      // Resolve the drop target and park the placeholder at the actual release
      // point even when no pointermove preceded (fast flick), so the batch
      // lands where the pointer was released instead of at the list end.
      previewPageChipOrder(e.clientX, e.clientY);
    } else {
      logPageChipDragDebug('pointerup-keep-target', {
        kind: stickyTarget.kind,
        groupKey: stickyTarget.groupKey || '',
        placement: stickyTarget.placement || '',
      });
    }
    await finishPageChipDrag();
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
    if (draggedKind === 'todo') {
      await renderTodoPanel();
    }
  }
});

document.addEventListener('pointercancel', async (e) => {
  if (!draggedPageChipId || !pageChipDragState) return;
  if (pageChipDragState.pointerId != null && e.pointerId != null && pageChipDragState.pointerId !== e.pointerId) return;
  logPageChipDragDebug('pointercancel', { pointerId: e.pointerId });
  await finishPageChipDrag();
});

document.addEventListener('pointerdown', (e) => {
  const button = e.target.closest('.group-nav-button[data-nav-kind="open-tabs"]');
  if (!button) return;

  const groupId = button.dataset.groupId || '';
  // Chrome-group cards follow the native browser strip and are intentionally
  // not persisted in the dashboard group order; do not start a drag that can
  // never be saved (C18).
  if (String(groupId).startsWith('__chrome_group__:')) return;

  draggedGroupId = groupId;
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
  const nextGroupOrder = groupOrderState.sessionOrder?.slice() || domainGroups.map(group => String(group.domain));
  if (dragStartPoint?.moved) {
    await saveGroupOrder(groupOrderState);
    suppressJumpUntil = Date.now() + 250;
  }

  clearGroupDragState();

  if (moved) {
    applyLiveGroupOrder(nextGroupOrder, { reorderCards: true, reorderNav: true });
    await syncChromeTabGroupsWithoutImportEcho();
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
  const customSearchUrlInput = e.target.closest('[data-action="change-custom-search-url"]');
  if (customSearchUrlInput) {
    themePreferences = normalizeThemePreferences({
      ...themePreferences,
      customSearchUrl: customSearchUrlInput.value,
    });
    await chrome.storage.local.set({ [THEME_PREFERENCES_KEY]: themePreferences });
    syncSearchPlaceholder();
    return;
  }

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

  if (e.target.id === 'themeUiScaleRange') {
    themePreferences = normalizeThemePreferences({
      ...themePreferences,
      uiScale: Number(e.target.value),
    });
    applyThemePreferences();
    const valueEl = document.getElementById('themeUiScaleValue');
    if (valueEl) valueEl.textContent = `${themePreferences.uiScale}%`;
    await chrome.storage.local.set({ [THEME_PREFERENCES_KEY]: themePreferences });
    return;
  }

  if (e.target.id === 'themeShortcutScaleRange') {
    themePreferences = normalizeThemePreferences({
      ...themePreferences,
      shortcutScale: Number(e.target.value),
    });
    applyThemePreferences();
    const valueEl = document.getElementById('themeShortcutScaleValue');
    if (valueEl) valueEl.textContent = `${themePreferences.shortcutScale}%`;
    await chrome.storage.local.set({ [THEME_PREFERENCES_KEY]: themePreferences });
    return;
  }

  const sessionPickerNameInput = e.target.closest('[data-action="change-session-picker-new-name"]');
  if (sessionPickerNameInput) {
    tabSessionPickerState = {
      ...tabSessionPickerState,
      newSessionName: sessionPickerNameInput.value || '',
    };
    return;
  }

  return;
});

document.addEventListener('input', (e) => {
  const renameInput = e.target.closest('.mission-rename-input');
  if (!renameInput || !groupRenameEditorState) return;
  groupRenameEditorState = {
    ...groupRenameEditorState,
    value: renameInput.value,
    shouldFocus: false,
  };
});

document.addEventListener('focusout', (e) => {
  const renameInput = e.target.closest('.mission-rename-input');
  if (!renameInput || !groupRenameEditorState) return;
  const nextFocused = e.relatedTarget;
  if (nextFocused && nextFocused.closest?.('.mission-rename-form')) return;
  void submitGroupRenameEditor();
});

document.addEventListener('input', async (e) => {
  const todoEditorInput = e.target.closest('[data-action="update-todo-editor-field"]');
  if (todoEditorInput) {
    setTodoEditorField(todoEditorInput.dataset.field || '', todoEditorInput.value || '');
    return;
  }

  if (e.target.id !== 'todoSearchInput') return;
  todoSearchQuery = e.target.value.trim();
  await renderDeferredColumn();
});

document.addEventListener('change', async (e) => {
  const sessionPickerTarget = e.target.closest('[data-action="change-session-picker-target"]');
  if (sessionPickerTarget) {
    tabSessionPickerState = {
      ...tabSessionPickerState,
      targetSessionId: sessionPickerTarget.value || '',
    };
    return;
  }

  if (e.target.id === 'configImportInput') {
    await handleConfigImportInput(e.target);
    e.target.value = '';
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
  if (e.target.id === 'chromeGroupMergeForm') {
    e.preventDefault();
    const dialogState = chromeGroupMergeDialogState;
    const targetInput = e.target.querySelector('input[name="chromeGroupMergeTarget"]:checked');
    const targetGroupId = Number(targetInput?.value);
    const candidates = Array.isArray(dialogState?.conflict?.candidates)
      ? dialogState.conflict.candidates
      : [];
    const sourceGroupIds = candidates
      .map(candidate => Number(candidate.id ?? candidate.groupId))
      .filter(groupId => Number.isInteger(groupId) && groupId !== targetGroupId);
    const windowId = await getDashboardWindowIdForOpenTabs();
    if (!dialogState || !Number.isInteger(targetGroupId) || sourceGroupIds.length === 0 || windowId == null) return;
    const expectedGroups = Array.isArray(dialogState.expectedGroups)
      ? dialogState.expectedGroups
      : [];

    const confirmButton = document.getElementById('chromeGroupMergeConfirm');
    if (confirmButton) confirmButton.disabled = true;
    const response = await sendChromeTabGroupRequest('merge-chrome-tab-groups', {
      windowId: Number(windowId),
      groupKey: dialogState.groupKey,
      targetGroupId,
      sourceGroupIds,
      expectedGroups,
    });
    if (confirmButton) confirmButton.disabled = false;
    if (!response?.ok) {
      showToast(runtimeT ? runtimeT('chromeGroupMergeFailed') : 'Could not merge Chrome groups');
      return;
    }
    applyChromeTabGroupResponseState(response);
    const mergedGroupKey = dialogState.groupKey;
    closeChromeGroupMergeDialog({ restoreFocus: false });
    await fetchOpenTabs();
    await renderDashboard();
    focusChromeGroupMergeResult(mergedGroupKey);
    showToast(runtimeT ? runtimeT('chromeGroupMergeSuccess') : 'Chrome groups merged');
    return;
  }

  if (e.target.matches('.mission-rename-form')) {
    e.preventDefault();
    await submitGroupRenameEditor();
    return;
  }

  if (e.target.matches('.todo-editor-form')) {
    e.preventDefault();
    await submitTodoEditor();
    return;
  }

  if (e.target.id !== 'headerSearchForm') return;

  e.preventDefault();
  // An IME-confirmation Enter (composition active) must not submit a search.
  // The keydown handler blocks the default submit, but guard here too in case
  // a browser still dispatches submit during composition.
  if (searchSuggestionsIsComposing || e.isComposing) {
    searchSubmitInFlight = false;
    return;
  }
  // Enter was already handled by the input's keydown listener (which starts
  // the navigation one event-loop turn earlier). A submit still fires as the
  // form's default action; skip the duplicate run.
  if (searchSubmitInFlight) {
    searchSubmitInFlight = false;
    return;
  }
  const input = document.getElementById('headerSearchInput');
  const query = input?.value || '';
  closeSearchSuggestions();
  cancelSearchFocusRetryIfInteracting();
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
      `body.${ENTRY_ANIMATIONS_CLASS} .active-section .missions .mission-card:nth-child(${i}) { animation: fadeUp 0.4s ease ${delay.toFixed(2)}s both; }`
    );
  }

  // Abandoned section mission cards - start at 0.5s, stagger first 10, then cap
  for (let i = 1; i <= 50; i++) {
    const delay = i <= MAX_STAGGER_COUNT 
      ? 0.5 + (i - 1) * STAGGER_INCREMENT
      : 0.5 + (MAX_STAGGER_COUNT - 1) * STAGGER_INCREMENT;
    rules.push(
      `body.${ENTRY_ANIMATIONS_CLASS} .abandoned-section .missions .mission-card:nth-child(${i}) { animation: fadeUp 0.4s ease ${delay.toFixed(2)}s both; }`
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
  primeEntryAnimations();
  const currentTab = await resolveCurrentDashboardTab();
  currentDashboardTabId = currentTab?.id ?? null;
  currentDashboardWindowId = currentTab?.windowId ?? null;
  dashboardStartupTabChangeIgnoreUntil = Date.now() + 2000;
  window.__suppressAutoRefreshUntil = Math.max(
    window.__suppressAutoRefreshUntil || 0,
    Date.now() + 2000
  );
  // Attach before the first asynchronous render. Notifications received while
  // the initial snapshot is loading are retained as one trailing refresh
  // instead of being lost until the user causes another tab event.
  setupTabChangeListener();
  tabDrivenDashboardRefreshRunning = true;
  try {
    await loadThemePreferences();
    automaticGroupingRuleOverridesPublished = await publishAutomaticGroupingRuleOverrides();
    syncSearchPlaceholder();
    setupBookmarksShelf();
    setupChromeGroupMergeDialog();
    sleepControlEnabled = (typeof themePreferences !== 'undefined' && themePreferences.sleepControlEnabled === true);

    const navHost = getWorkspaceTopNavHost();
    if (navHost && !navHost.dataset.wheelHijackAttached) {
      navHost.dataset.wheelHijackAttached = '1';
      // The nav scrollbars are hidden; let the vertical wheel scroll the
      // group lists horizontally (delegated so it survives re-renders) — but
      // only when the list can actually scroll, so a wheel over a short nav
      // passes through instead of trapping the page.
      navHost.addEventListener('wheel', (e) => {
        const list = e.target.closest('.group-nav-list');
        if (!list) return;
        if (list.scrollWidth <= list.clientWidth) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          list.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }
    if (typeof loadChromeTabGroupsSetting === 'function') {
      chromeTabGroupsEnabled = await loadChromeTabGroupsSetting();
    }
    await loadImportedChromeGroupMeta();
    if (chromeTabGroupsEnabled) {
      await fetchOpenTabs();
      const realTabs = getRealTabs();
      await loadSessionGroups(getOpenTabIdsForSessionPruning());
      if (shouldImportChromeGroupsIntoSessionState()) {
        const importedCount = await importChromeNativeGroupsIntoSessionGroups();
        if (typeof setImportMode === 'function') setImportMode(importedCount > 0);
      }
    }
    ensureChromeTabGroupsSubscription();
    disableChromeTabGroupsImportModeForLocalEdits();
    await renderDashboard();
  } finally {
    tabDrivenDashboardRefreshRunning = false;
    if (tabDrivenDashboardRefreshDirty) {
      armTabDrivenDashboardRefresh(tabDrivenDashboardRefreshDelayMs);
    }
  }
  updateBackToTopVisibility();

  // Search-field auto-focus + inline suggestions.
  setupSearchSuggestions();
  focusSearchFieldOnForeground();
  // Chrome focuses the omnibox shortly after a newtab page finishes loading,
  // which can override the focus above. Re-claim the search field once the
  // window has fully loaded.
  if (document.readyState === 'complete') {
    scheduleSearchFocusVerification();
  } else {
    window.addEventListener('load', scheduleSearchFocusVerification, { once: true });
  }
}

/**
 * isExtensionContextInvalidated(err)
 *
 * True when the extension was reloaded/updated/disabled while this page was
 * still open: every chrome.* call then throws "Extension context invalidated".
 * The page cannot do anything useful until it rebinds to a live context.
 */
function isExtensionContextInvalidated(err) {
  return Boolean(err && /Extension context invalidated/i.test(String(err?.message || err)));
}

// Reload only once per invalidation — if the extension is disabled, the next
// new-tab load falls back to the default page, so a single attempt cannot loop.
let extensionContextInvalidatedHandled = false;
function recoverFromInvalidatedExtensionContext() {
  if (extensionContextInvalidatedHandled) return;
  extensionContextInvalidatedHandled = true;
  console.warn('[tab-harbor] Extension context invalidated — reloading dashboard to rebind.');
  try { location.reload(); } catch { /* page may already be tearing down */ }
}

/**
 * setupTabChangeListener()
 * 
 * Listens for messages from background.js when tabs change,
 * and refreshes the dashboard to show updated tab list.
 */
function setupTabChangeListener() {
  if (tabChangeListenerAttached) return;
  tabChangeListenerAttached = true;
  const DEBUG = false;
  if (DEBUG) console.log('[tab-harbor] Setting up tab change listener');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (DEBUG) console.log('[tab-harbor] Received message:', message);

    if (message.action === 'tabs-changed') {
      if (shouldSkipStartupTabChange(message)) {
        return;
      }

      if (currentDashboardWindowId != null && message.windowId != null &&
          Number(message.windowId) !== Number(currentDashboardWindowId)) {
        return;
      }

      // Keep, rather than discard, notifications received during startup or
      // a local action's quiet window. One read-only refresh runs after the
      // suppression period and absorbs every event in the burst.
      const suppressionRemaining = Math.max(
        0,
        (window.__suppressAutoRefreshUntil || 0) - Date.now(),
      );
      if (suppressionRemaining > 0) {
        scheduleTabDrivenDashboardRefresh(suppressionRemaining + 200);
        return;
      }

      if (DEBUG) console.log('[tab-harbor] Tab changed, scheduling refresh...');

      // Background and direct Chrome listeners share one timer. A burst of
      // duplicate notifications therefore becomes one read-only refresh.
      scheduleTabDrivenDashboardRefresh(300);
    }
  });
}

function mountDashboardRuntime() {
  if (!window.__tabHarborRuntimeMounted) {
    document.addEventListener('pointerdown', disableEntryAnimations, { capture: true, passive: true });
    window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
    // Any chrome.* call after the extension reloaded throws; a rejected promise
    // from a user action would otherwise leave the page as a silent zombie.
    window.addEventListener('unhandledrejection', (event) => {
      if (isExtensionContextInvalidated(event?.reason)) recoverFromInvalidatedExtensionContext();
    });
    window.addEventListener('focus', () => {
      focusSearchFieldOnForeground();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        focusSearchFieldOnForeground();
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
  getTabSessionPickerContext,
  getOpenTabs: () => openTabs,
  renderDashboard,
  renderWorkspacePageSwitch,
  renderWorkspaceThemeTools,
  syncWorkspaceTopNavMarkup,
  restoreSavedTabToBrowser,
  restoreSavedTabSession,
  saveCurrentWindowTabSession,
  saveSelectedTabSession,
};
