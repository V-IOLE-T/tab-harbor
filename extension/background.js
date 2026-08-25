/**
 * background.js — Service Worker
 *
 * Keeps Tab Harbor pages in sync when tabs change.
 * The toolbar badge is intentionally kept empty.
 */

// Chrome tab-group mutations must have one owner across every new-tab page.
// Load the pure grouping policy and the mutation coordinator in the MV3
// service worker so automatic grouping does not depend on an open dashboard.
// Node tests do not expose importScripts and inject these globals directly.
if (typeof importScripts === "function") {
  importScripts("config.js");
  // Every service-worker import must exist in the installed package. The
  // optional page-only config.local.js is intentionally excluded from release
  // archives, so requesting it here prevents Chrome from registering the
  // worker before JavaScript try/catch can make that request optional.
  importScripts("icon-utils.js");
  importScripts("tab-url-utils.js");
  importScripts("automatic-tab-groups.js");
  importScripts("chrome-tab-groups-coordinator.js");
}

const tabHarborChromeGroupCoordinatorFactory =
  globalThis.TabHarborChromeTabGroupsCoordinator?.createChromeTabGroupsCoordinator;
const tabHarborChromeGroupCoordinator =
  typeof tabHarborChromeGroupCoordinatorFactory === "function"
    ? tabHarborChromeGroupCoordinatorFactory({
        chromeApi: chrome,
        async readSyncEnabled() {
          const stored = await chrome.storage.local.get("chromeTabGroupsEnabled");
          return stored.chromeTabGroupsEnabled === true;
        },
      })
    : null;

const TAB_HARBOR_AUTOMATIC_GROUP_SYNC_DEBOUNCE_MS = 275;
const TAB_HARBOR_AUTOMATIC_GROUP_RULE_OVERRIDES_KEY =
  "automaticTabGroupRuleOverrides";
const TAB_HARBOR_CHROME_GROUP_CLEANUP_PENDING_KEY =
  "chromeTabGroupsCleanupPending";
const TAB_HARBOR_CHROME_GROUP_CLEANUP_RETRY_BASE_MS = 1000;
const TAB_HARBOR_CHROME_GROUP_CLEANUP_RETRY_MAX_MS = 30000;
const TAB_HARBOR_AUTOMATIC_GROUP_SYNC_STORAGE_KEYS = [
  "chromeTabGroupsEnabled",
  TAB_HARBOR_AUTOMATIC_GROUP_RULE_OVERRIDES_KEY,
  TAB_HARBOR_CHROME_GROUP_CLEANUP_PENDING_KEY,
  "sessionGroups",
  "groupLabelOverrides",
  "groupTabOrder",
  "languagePreference",
];
// One debounce/run slot per Chrome window. The coordinator still owns the
// global write queue; these slots prevent redundant snapshot work before a
// complete payload reaches it.
const tabHarborAutomaticGroupSyncSlots = new Map();
let tabHarborChromeGroupCleanupPendingCache = null;
let tabHarborChromeGroupSyncEnabledCache = null;
let tabHarborChromeGroupCleanupInFlight = null;
let tabHarborChromeGroupCleanupRetryTimer = null;
let tabHarborChromeGroupCleanupRetryAttempt = 0;

function isValidChromeWindowId(value) {
  return Number.isInteger(value) && value >= 0;
}

function getAutomaticChromeGroupBuilder() {
  return globalThis.TabHarborAutomaticTabGroups?.buildAutomaticChromeSyncSnapshot;
}

function getAutomaticChromeGroupRuleNormalizer() {
  return globalThis.TabHarborAutomaticTabGroups
    ?.normalizeStoredAutomaticGroupingRuleOverrides;
}

function resolveHomepagesLabel(languagePreference = "auto") {
  const preference = String(languagePreference || "auto");
  const browserLanguage = String(
    globalThis.navigator?.language || globalThis.navigator?.userLanguage || "en",
  ).toLowerCase();
  const useChinese = preference === "zh-CN" ||
    (preference !== "en" && browserLanguage.startsWith("zh"));
  return useChinese ? "主页" : "Homepages";
}

function getNativeGroupsFromCoordinatorState(state = {}, windowId) {
  if (Array.isArray(state.nativeGroups)) return state.nativeGroups;
  if (Array.isArray(state.liveGroups)) return state.liveGroups;
  const matchingWindow = Array.isArray(state.windows)
    ? state.windows.find(entry => Number(entry?.windowId) === Number(windowId))
    : null;
  return Array.isArray(matchingWindow?.nativeGroups)
    ? matchingWindow.nativeGroups
    : null;
}

function automaticChromeGroupSyncError(code, message, details = undefined) {
  return {
    ok: false,
    action: "automatic-sync",
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function clearPendingChromeGroupCleanupRetry() {
  if (tabHarborChromeGroupCleanupRetryTimer) {
    clearTimeout(tabHarborChromeGroupCleanupRetryTimer);
    tabHarborChromeGroupCleanupRetryTimer = null;
  }
  tabHarborChromeGroupCleanupRetryAttempt = 0;
}

function schedulePendingChromeGroupCleanupRetry() {
  if (tabHarborChromeGroupCleanupRetryTimer ||
      tabHarborChromeGroupCleanupPendingCache !== true) return;
  const delay = Math.min(
    TAB_HARBOR_CHROME_GROUP_CLEANUP_RETRY_BASE_MS *
      (2 ** tabHarborChromeGroupCleanupRetryAttempt),
    TAB_HARBOR_CHROME_GROUP_CLEANUP_RETRY_MAX_MS,
  );
  tabHarborChromeGroupCleanupRetryAttempt += 1;
  tabHarborChromeGroupCleanupRetryTimer = setTimeout(() => {
    tabHarborChromeGroupCleanupRetryTimer = null;
    void resumePendingChromeTabGroupCleanup({
      forceStorageRead: true,
      ignoreRetryTimer: true,
    });
  }, delay);
}

async function writeChromeGroupCleanupPending(pending) {
  const normalized = pending === true;
  const previous = tabHarborChromeGroupCleanupPendingCache;
  if (normalized) tabHarborChromeGroupCleanupPendingCache = true;
  try {
    await chrome.storage.local.set({
      [TAB_HARBOR_CHROME_GROUP_CLEANUP_PENDING_KEY]: normalized,
    });
    tabHarborChromeGroupCleanupPendingCache = normalized;
    return { ok: true };
  } catch (error) {
    // Never forget an already-pending cleanup merely because clearing its
    // marker failed. A later wake can safely retry the idempotent cleanup.
    tabHarborChromeGroupCleanupPendingCache = normalized
      ? true
      : (previous === true ? true : null);
    return automaticChromeGroupSyncError(
      "CLEANUP_STATE_WRITE_FAILED",
      error?.message || "could not persist Chrome tab-group cleanup state",
    );
  }
}

async function readChromeGroupCleanupControlState({ force = false } = {}) {
  if (!force && typeof tabHarborChromeGroupCleanupPendingCache === "boolean" &&
      typeof tabHarborChromeGroupSyncEnabledCache === "boolean") {
    return {
      enabled: tabHarborChromeGroupSyncEnabledCache,
      pending: tabHarborChromeGroupCleanupPendingCache,
    };
  }
  let stored;
  try {
    stored = await chrome.storage.local.get([
      "chromeTabGroupsEnabled",
      TAB_HARBOR_CHROME_GROUP_CLEANUP_PENDING_KEY,
    ]);
  } catch (error) {
    throw new Error(error?.message || "could not read Chrome tab-group cleanup state");
  }
  tabHarborChromeGroupSyncEnabledCache = stored?.chromeTabGroupsEnabled === true;
  tabHarborChromeGroupCleanupPendingCache =
    stored?.[TAB_HARBOR_CHROME_GROUP_CLEANUP_PENDING_KEY] === true;
  return {
    enabled: tabHarborChromeGroupSyncEnabledCache,
    pending: tabHarborChromeGroupCleanupPendingCache,
  };
}

async function resumePendingChromeTabGroupCleanup({
  markPending = false,
  forceStorageRead = false,
  ignoreRetryTimer = false,
  knownControlState = null,
} = {}) {
  if (tabHarborChromeGroupCleanupInFlight) {
    return tabHarborChromeGroupCleanupInFlight;
  }
  if (!ignoreRetryTimer && tabHarborChromeGroupCleanupRetryTimer) {
    return {
      ok: true,
      action: "sync",
      enabled: false,
      skipped: "cleanup-retry-scheduled",
    };
  }

  tabHarborChromeGroupCleanupInFlight = (async () => {
    if (markPending) {
      tabHarborChromeGroupSyncEnabledCache = false;
      const pendingWrite = await writeChromeGroupCleanupPending(true);
      if (!pendingWrite.ok) {
        // Continue with the live cleanup while this worker is alive. Keeping the
        // in-memory pending bit also gives the bounded retry path a chance to
        // persist the marker on its next attempt.
        console.warn(
          "[tab-harbor bg] Could not persist Chrome tab-group cleanup state:",
          pendingWrite.error?.message || pendingWrite.error,
        );
      }
    }

    let control = knownControlState;
    if (!control || forceStorageRead) {
      try {
        control = await readChromeGroupCleanupControlState({ force: forceStorageRead });
      } catch (error) {
        const failure = automaticChromeGroupSyncError(
          "CLEANUP_STATE_READ_FAILED",
          error?.message || "could not read Chrome tab-group cleanup state",
        );
        schedulePendingChromeGroupCleanupRetry();
        return failure;
      }
    }

    if (control.enabled === true) {
      clearPendingChromeGroupCleanupRetry();
      if (control.pending === true) await writeChromeGroupCleanupPending(false);
      return {
        ok: true,
        action: "sync",
        enabled: true,
        skipped: "cleanup-cancelled-after-enable",
      };
    }
    if (control.pending !== true && !markPending) {
      clearPendingChromeGroupCleanupRetry();
      return {
        ok: true,
        action: "sync",
        enabled: false,
        skipped: "no-pending-cleanup",
      };
    }
    if (!tabHarborChromeGroupCoordinator) {
      const failure = automaticChromeGroupSyncError(
        "COORDINATOR_UNAVAILABLE",
        "Chrome tab-group coordinator is unavailable",
      );
      schedulePendingChromeGroupCleanupRetry();
      return failure;
    }

    const response = await tabHarborChromeGroupCoordinator.dispatch({
      action: "sync",
      windowId: 0,
      enabled: false,
      allWindows: true,
      preserveGroupKeys: [],
      groups: [],
    });
    if (response?.ok) {
      const cleared = await writeChromeGroupCleanupPending(false);
      if (!cleared.ok) {
        schedulePendingChromeGroupCleanupRetry();
        return cleared;
      }
      clearPendingChromeGroupCleanupRetry();
      return response;
    }

    // A disable can race with re-enabling. Re-read the authoritative setting
    // before scheduling another destructive cleanup attempt.
    try {
      const latest = await readChromeGroupCleanupControlState({ force: true });
      if (latest.enabled) {
        clearPendingChromeGroupCleanupRetry();
        if (latest.pending) await writeChromeGroupCleanupPending(false);
        return response;
      }
    } catch {}
    tabHarborChromeGroupCleanupPendingCache = true;
    schedulePendingChromeGroupCleanupRetry();
    return response;
  })().finally(() => {
    tabHarborChromeGroupCleanupInFlight = null;
  });

  return tabHarborChromeGroupCleanupInFlight;
}

async function runAutomaticChromeGroupSync(windowId) {
  const numericWindowId = Number(windowId);
  if (!isValidChromeWindowId(numericWindowId)) {
    return automaticChromeGroupSyncError(
      "INVALID_WINDOW_ID",
      "automatic Chrome tab-group sync requires a valid window id",
    );
  }
  if (!tabHarborChromeGroupCoordinator) {
    return automaticChromeGroupSyncError(
      "COORDINATOR_UNAVAILABLE",
      "Chrome tab-group coordinator is unavailable",
    );
  }

  const builder = getAutomaticChromeGroupBuilder();
  if (typeof builder !== "function") {
    return automaticChromeGroupSyncError(
      "PLANNER_UNAVAILABLE",
      "automatic Chrome tab-group planner is unavailable",
    );
  }

  let stored;
  try {
    stored = await chrome.storage.local.get(TAB_HARBOR_AUTOMATIC_GROUP_SYNC_STORAGE_KEYS);
  } catch (error) {
    return automaticChromeGroupSyncError(
      "SETTING_READ_FAILED",
      error?.message || "could not read automatic Chrome tab-group settings",
    );
  }
  if (stored?.chromeTabGroupsEnabled !== true) {
    tabHarborChromeGroupSyncEnabledCache = false;
    tabHarborChromeGroupCleanupPendingCache =
      stored?.[TAB_HARBOR_CHROME_GROUP_CLEANUP_PENDING_KEY] === true;
    const cleanup = await resumePendingChromeTabGroupCleanup({
      knownControlState: {
        enabled: false,
        pending: tabHarborChromeGroupCleanupPendingCache,
      },
    });
    return {
      ok: true,
      action: "automatic-sync",
      windowId: numericWindowId,
      skipped: "disabled",
      ...(cleanup?.skipped === "no-pending-cleanup" ? {} : { cleanup }),
    };
  }
  tabHarborChromeGroupSyncEnabledCache = true;
  tabHarborChromeGroupCleanupPendingCache =
    stored?.[TAB_HARBOR_CHROME_GROUP_CLEANUP_PENDING_KEY] === true;

  const rawRuleOverrides = stored?.[TAB_HARBOR_AUTOMATIC_GROUP_RULE_OVERRIDES_KEY];
  if (rawRuleOverrides === undefined) {
    return {
      ok: true,
      action: "automatic-sync",
      windowId: numericWindowId,
      skipped: "rule-overrides-uninitialized",
    };
  }
  const normalizeRuleOverrides = getAutomaticChromeGroupRuleNormalizer();
  if (typeof normalizeRuleOverrides !== "function") {
    return automaticChromeGroupSyncError(
      "RULE_OVERRIDES_NORMALIZER_UNAVAILABLE",
      "automatic Chrome tab-group rule validation is unavailable",
      { windowId: numericWindowId },
    );
  }
  const ruleOverrides = normalizeRuleOverrides(rawRuleOverrides);
  if (!ruleOverrides) {
    return automaticChromeGroupSyncError(
      "INVALID_RULE_OVERRIDES",
      "stored automatic Chrome tab-group rules are invalid",
      { windowId: numericWindowId },
    );
  }
  if (ruleOverrides.backgroundSafe !== true) {
    return {
      ok: true,
      action: "automatic-sync",
      windowId: numericWindowId,
      skipped: "dashboard-only-rule-overrides",
    };
  }

  let tabs;
  try {
    tabs = await chrome.tabs.query({ windowId: numericWindowId });
  } catch (error) {
    return automaticChromeGroupSyncError(
      "TABS_QUERY_FAILED",
      error?.message || "could not query tabs for automatic Chrome grouping",
      { windowId: numericWindowId },
    );
  }
  if (!Array.isArray(tabs)) {
    return automaticChromeGroupSyncError(
      "TABS_QUERY_FAILED",
      "Chrome returned an invalid tab snapshot",
      { windowId: numericWindowId },
    );
  }

  // get-state performs the coordinator's fail-closed native-group read and
  // enriches every native group with its current session mapping. Never turn
  // a failed read into an empty desired snapshot: an empty snapshot would be
  // interpreted as permission to dismantle extension-created groups.
  const stateResponse = await tabHarborChromeGroupCoordinator.dispatch({
    action: "get-state",
    windowId: numericWindowId,
  });
  if (!stateResponse?.ok) {
    return automaticChromeGroupSyncError(
      stateResponse?.error?.code || "GROUP_STATE_QUERY_FAILED",
      stateResponse?.error?.message || "could not read live Chrome tab groups",
      stateResponse?.error?.details,
    );
  }
  const nativeGroups = getNativeGroupsFromCoordinatorState(
    stateResponse.state,
    numericWindowId,
  );
  if (!Array.isArray(nativeGroups)) {
    return automaticChromeGroupSyncError(
      "INVALID_GROUP_STATE",
      "Chrome tab-group coordinator returned an invalid live snapshot",
      { windowId: numericWindowId },
    );
  }

  let snapshot;
  try {
    snapshot = builder({
      windowId: numericWindowId,
      tabs,
      nativeGroups,
      sessionGroups: stored?.sessionGroups || { groups: [], assignments: {} },
      labelOverrides: stored?.groupLabelOverrides || {},
      groupTabOrder: stored?.groupTabOrder || {},
      landingPagePatterns: ruleOverrides.landingPagePatterns,
      customGroups: ruleOverrides.customGroups,
      homepagesLabel: resolveHomepagesLabel(stored?.languagePreference),
    });
  } catch (error) {
    return automaticChromeGroupSyncError(
      "SNAPSHOT_BUILD_FAILED",
      error?.message || "could not build the automatic Chrome tab-group snapshot",
      { windowId: numericWindowId },
    );
  }
  if (!snapshot || Number(snapshot.windowId) !== numericWindowId ||
      !Array.isArray(snapshot.groups) || !Array.isArray(snapshot.preserveGroupKeys)) {
    return automaticChromeGroupSyncError(
      "INVALID_SYNC_SNAPSHOT",
      "automatic Chrome tab-group planner returned an invalid snapshot",
      { windowId: numericWindowId },
    );
  }

  return tabHarborChromeGroupCoordinator.dispatch({
    action: "sync",
    windowId: numericWindowId,
    enabled: true,
    allWindows: false,
    preserveGroupKeys: snapshot.preserveGroupKeys,
    groups: snapshot.groups,
  });
}

function armAutomaticChromeGroupSync(slot, delayMs = TAB_HARBOR_AUTOMATIC_GROUP_SYNC_DEBOUNCE_MS) {
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => {
    slot.timer = null;
    void startAutomaticChromeGroupSyncRun(slot.windowId);
  }, delayMs);
}

function getAutomaticChromeGroupSyncSlot(windowId) {
  const numericWindowId = Number(windowId);
  let slot = tabHarborAutomaticGroupSyncSlots.get(numericWindowId);
  if (!slot) {
    slot = {
      windowId: numericWindowId,
      timer: null,
      running: false,
      dirty: false,
      currentRun: null,
      waiters: [],
      lastResult: null,
    };
    tabHarborAutomaticGroupSyncSlots.set(numericWindowId, slot);
  }
  return slot;
}

async function startAutomaticChromeGroupSyncRun(windowId) {
  const numericWindowId = Number(windowId);
  const slot = tabHarborAutomaticGroupSyncSlots.get(numericWindowId);
  if (!slot) return null;
  if (slot.running) return slot.currentRun;
  if (!slot.dirty) return slot.lastResult;

  if (slot.timer) {
    clearTimeout(slot.timer);
    slot.timer = null;
  }
  slot.running = true;
  slot.dirty = false;
  const runWaiters = slot.waiters.splice(0);
  const currentRun = (async () => {
    let result;
    try {
      result = await runAutomaticChromeGroupSync(numericWindowId);
    } catch (error) {
      result = automaticChromeGroupSyncError(
        "INTERNAL_ERROR",
        error?.message || String(error || "automatic Chrome tab-group sync failed"),
        { windowId: numericWindowId },
      );
    }
    slot.lastResult = result;
    for (const resolve of runWaiters) resolve(result);
    return result;
  })();
  slot.currentRun = currentRun;

  try {
    return await currentRun;
  } finally {
    slot.running = false;
    slot.currentRun = null;
    if (slot.dirty) {
      // A Chrome write may echo through tabs.onUpdated/onMoved. Keep exactly
      // one debounced trailing reconciliation opportunity; never drop events
      // merely because a sync was in flight, since a real user action can
      // arrive in the same interval.
      armAutomaticChromeGroupSync(slot);
    } else if (slot.waiters.length === 0) {
      tabHarborAutomaticGroupSyncSlots.delete(numericWindowId);
    }
  }
}

function scheduleAutomaticChromeGroupSync(windowId) {
  const numericWindowId = Number(windowId);
  if (!isValidChromeWindowId(numericWindowId)) {
    return Promise.resolve(automaticChromeGroupSyncError(
      "INVALID_WINDOW_ID",
      "automatic Chrome tab-group sync requires a valid window id",
    ));
  }
  const slot = getAutomaticChromeGroupSyncSlot(numericWindowId);
  slot.dirty = true;
  const promise = new Promise(resolve => slot.waiters.push(resolve));
  if (!slot.running) armAutomaticChromeGroupSync(slot);
  return promise;
}

async function flushAutomaticChromeGroupSyncForTest(windowId) {
  const numericWindowId = Number(windowId);
  let result = null;
  // Drain the current run plus any dirty trailing run without waiting for the
  // production debounce. This helper is intentionally exported only through
  // TabHarborBackground for deterministic Node tests.
  for (;;) {
    const slot = tabHarborAutomaticGroupSyncSlots.get(numericWindowId);
    if (!slot) return result;
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }
    if (slot.running) {
      result = await slot.currentRun;
      continue;
    }
    if (slot.dirty) {
      result = await startAutomaticChromeGroupSyncRun(numericWindowId);
      continue;
    }
    tabHarborAutomaticGroupSyncSlots.delete(numericWindowId);
    return slot.lastResult || result;
  }
}

async function scheduleAutomaticChromeGroupSyncForAllWindows() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    return automaticChromeGroupSyncError(
      "TABS_QUERY_FAILED",
      error?.message || "could not discover Chrome windows for automatic grouping",
    );
  }
  if (!Array.isArray(tabs)) {
    return automaticChromeGroupSyncError(
      "TABS_QUERY_FAILED",
      "Chrome returned an invalid all-window tab snapshot",
    );
  }
  const windowIds = [...new Set(
    tabs.map(tab => Number(tab?.windowId)).filter(isValidChromeWindowId),
  )].sort((left, right) => left - right);
  for (const windowId of windowIds) void scheduleAutomaticChromeGroupSync(windowId);
  return { ok: true, action: "automatic-sync-scheduled", windowIds };
}

const TAB_HARBOR_GROUP_MESSAGE_ACTIONS = new Map([
  ["sync-chrome-tab-groups", "sync"],
  ["merge-chrome-tab-groups", "merge"],
  ["get-chrome-tab-group-state", "get-state"],
]);

function isTrustedTabHarborSender(sender = {}) {
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  if (!sender.url) return true;
  try {
    return sender.url.startsWith(chrome.runtime.getURL(""));
  } catch {
    return false;
  }
}

async function handleChromeTabGroupsMessage(message = {}, sender = {}) {
  const coordinatorAction = TAB_HARBOR_GROUP_MESSAGE_ACTIONS.get(message.action);
  if (!coordinatorAction) return null;
  if (!isTrustedTabHarborSender(sender) || message.source !== "dashboard") {
    return {
      ok: false,
      action: coordinatorAction,
      error: {
        code: "UNTRUSTED_SOURCE",
        message: "Chrome tab-group request must come from a Tab Harbor page",
      },
    };
  }
  if (!tabHarborChromeGroupCoordinator) {
    return {
      ok: false,
      action: coordinatorAction,
      error: {
        code: "COORDINATOR_UNAVAILABLE",
        message: "Chrome tab-group coordinator is unavailable",
      },
    };
  }

  const payload = message.payload && typeof message.payload === "object"
    ? message.payload
    : {};
  return tabHarborChromeGroupCoordinator.dispatch({
    ...payload,
    action: coordinatorAction,
  });
}

async function handleChromeTabGroupsSettingChanged(changes = {}, areaName = "") {
  const setting = areaName === "local" ? changes.chromeTabGroupsEnabled : null;
  if (!setting) return null;
  if (setting.newValue === true && setting.oldValue !== true) {
    tabHarborChromeGroupSyncEnabledCache = true;
    clearPendingChromeGroupCleanupRetry();
    await writeChromeGroupCleanupPending(false);
    // Enabling from the popup/config importer must work even when there is no
    // dashboard page available to submit an initial snapshot.
    return scheduleAutomaticChromeGroupSyncForAllWindows();
  }
  if (setting.oldValue !== true || setting.newValue === true) return null;

  // The setting itself is authoritative. Start the all-window cleanup in the
  // service worker as soon as it turns off, so closing/reloading the dashboard
  // immediately after the toggle cannot strand extension-created groups.
  return resumePendingChromeTabGroupCleanup({
    markPending: true,
    knownControlState: { enabled: false, pending: true },
    ignoreRetryTimer: true,
  });
}

if (chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes?.[TAB_HARBOR_CHROME_GROUP_CLEANUP_PENDING_KEY]) {
      tabHarborChromeGroupCleanupPendingCache =
        changes[TAB_HARBOR_CHROME_GROUP_CLEANUP_PENDING_KEY].newValue === true;
    }
    if (areaName === "local" && changes?.chromeTabGroupsEnabled) {
      tabHarborChromeGroupSyncEnabledCache =
        changes.chromeTabGroupsEnabled.newValue === true;
    }
    void handleChromeTabGroupsSettingChanged(changes, areaName).then((response) => {
      if (response && !response.ok) {
        console.warn("[tab-harbor bg] Chrome tab-group cleanup will need a retry:", response.error?.message || response.error);
      }
    }).catch((error) => {
      console.warn("[tab-harbor bg] Chrome tab-group cleanup failed:", error?.message || error);
    });
  });
}

if (chrome.runtime.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!TAB_HARBOR_GROUP_MESSAGE_ACTIONS.has(message?.action)) return undefined;
    void handleChromeTabGroupsMessage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error?.message || String(error || "Unknown error"),
        },
      }));
    return true;
  });
}

const TAB_HARBOR_BG_DEBUG = false;
if (TAB_HARBOR_BG_DEBUG)
  console.log(
    "[tab-harbor bg] Service worker loaded, registering event listeners...",
  );

// ─── Auto-close duplicate new tabs ───────────────────────────────────────────

// Tabs created within this window are exempt from duplicate-blank-tab cleanup:
// session restore creates many tabs in a burst and their navigation has not
// committed yet (url is empty), which would otherwise look like a pile of
// accidentally-opened blank new-tab pages and get closed.
const NEW_TAB_GRACE_PERIOD_MS = 5000;
const createdRecentlyAt = new Map(); // tabId -> timestamp
const graceTimers = new Map(); // tabId -> timeout id, one-shot post-grace check

function getNewTabUrls() {
  return new Set([
    chrome.runtime.getURL("index.html"),
    chrome.runtime.getURL("extension/index.html"),
  ]);
}

// Strip the query string (the focus-redirect appends ?focus=1 to the new-tab
// URL) and the hash so an extension new-tab page still matches its known URL.
function normalizeNewTabUrl(rawUrl = "") {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(rawUrl).split(/[?#]/)[0] || rawUrl;
  }
}

/**
 * scheduleGraceExpiryCheck(tabId)
 *
 * closeDuplicateNewTabs() only closes blank tabs whose grace period has
 * expired. A freshly created tab is exempt for NEW_TAB_GRACE_PERIOD_MS, so if
 * the user Ctrl+T's a new new-tab page next to an existing Tab Harbor page,
 * the check that runs at onCreated sees the new tab still in grace and does
 * nothing. This schedules one extra check after the grace window so the
 * duplicate is still caught once the exemption lapses.
 */
function scheduleGraceExpiryCheck(tabId) {
  if (graceTimers.has(tabId)) return;
  const timer = setTimeout(() => {
    graceTimers.delete(tabId);
    createdRecentlyAt.delete(tabId);
    closeDuplicateNewTabs();
  }, NEW_TAB_GRACE_PERIOD_MS + 200);
  graceTimers.set(tabId, timer);
}

function clearGraceExpiryCheck(tabId) {
  const timer = graceTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    graceTimers.delete(tabId);
  }
}

function isNewTabBlank(tab, newTabUrls) {
  // A discarded (sleeping) tab is never an accidentally-opened blank new-tab
  // page: session restore creates tabs and discards them so they start asleep,
  // and a discarded tab may carry an empty/uncommitted url.
  if (tab?.discarded) return false;
  const knownNewTabUrls =
    newTabUrls instanceof Set
      ? newTabUrls
      : new Set(Array.isArray(newTabUrls) ? newTabUrls : [newTabUrls]);
  const normalizedKnown = new Set(
    [...knownNewTabUrls].map((u) => normalizeNewTabUrl(u)),
  );
  const url = tab?.url || "";
  const pendingUrl = tab?.pendingUrl || "";
  const normalizedUrl = normalizeNewTabUrl(url);
  const normalizedPendingUrl = normalizeNewTabUrl(pendingUrl);

  // A tab whose URL is already an explicit new-tab page is not "in flight":
  // it IS a new tab, so it must count for duplicate cleanup immediately. Only
  // tabs with an empty/uncommitted URL (session-restore bursts that have not
  // navigated yet) get the grace-period exemption.
  const isExplicitNewTab =
    url === "chrome://newtab/" ||
    normalizedKnown.has(normalizedUrl) ||
    pendingUrl === "chrome://newtab/" ||
    normalizedKnown.has(normalizedPendingUrl);

  if (!isExplicitNewTab && tab?.id != null) {
    const createdAt = createdRecentlyAt.get(tab.id);
    if (createdAt != null && Date.now() - createdAt < NEW_TAB_GRACE_PERIOD_MS) {
      return false;
    }
    if (createdAt != null) createdRecentlyAt.delete(tab.id);
  }

  if (
    pendingUrl &&
    !normalizedKnown.has(normalizedPendingUrl) &&
    pendingUrl !== "chrome://newtab/"
  ) {
    return false;
  }
  return (
    isExplicitNewTab ||
    url === "" ||
    (tab.status === "loading" && !url)
  );
}

// Re-entrancy guard: onCreated, the post-grace timer, and onUpdated can all
// call closeDuplicateNewTabs within a few hundred ms of each other. Running
// two checks concurrently against the same tabs would issue duplicate
// chrome.tabs.remove calls. While one check is in flight we count how many
// more are owed and run them afterwards (once), so the newest tab state is
// still checked without removing the same tab id twice.
let duplicateCloseInFlight = false;
let duplicateCloseQueued = 0;

async function closeDuplicateNewTabs() {
  if (duplicateCloseInFlight) {
    duplicateCloseQueued += 1;
    return;
  }
  duplicateCloseInFlight = true;
  try {
    const stored = await chrome.storage.local.get("themePreferences");
    const prefs = stored.themePreferences || {};
    if (prefs.closeDuplicateNewTabsEnabled !== true) return;

    const newTabUrls = getNewTabUrls();
    const allTabs = await chrome.tabs.query({});
    const blankTabs = allTabs.filter((tab) => isNewTabBlank(tab, newTabUrls));

    if (blankTabs.length <= 1) return;

    // Keep the active tab; if none is active, keep the one with the largest id (newest)
    const activeTab = blankTabs.find((tab) => tab.active);
    const toKeep =
      activeTab || blankTabs.reduce((a, b) => (a.id > b.id ? a : b));
    const toClose = blankTabs
      .filter((tab) => tab.id !== toKeep.id)
      .map((tab) => tab.id);

    if (toClose.length > 0) await chrome.tabs.remove(toClose);
  } catch (err) {
    console.warn("[tab-harbor bg] closeDuplicateNewTabs error:", err.message);
  } finally {
    duplicateCloseInFlight = false;
    if (duplicateCloseQueued > 0) {
      duplicateCloseQueued = 0;
      void closeDuplicateNewTabs();
    }
  }
}

async function updateBadge() {
  try {
    await chrome.action.setBadgeText({ text: "" });
  } catch {
    chrome.action.setBadgeText({ text: "" });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Notify Tab Harbor pages when tabs change so they can refresh
async function notifyTabHarborPages(eventMeta = {}) {
  const message = {
    action: "tabs-changed",
    source: eventMeta.source || "tabs.changed",
    triggerTabId: eventMeta.triggerTabId ?? null,
  };
  if (isValidChromeWindowId(eventMeta.windowId)) {
    message.windowId = Number(eventMeta.windowId);
  }

  try {
    await chrome.runtime.sendMessage(message);
  } catch (err) {
    if (err?.message && !err.message.includes("Receiving end does not exist")) {
      console.warn(
        "[tab-harbor bg] Error notifying Tab Harbor pages:",
        err.message,
      );
    }
  }
}

// Update badge when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  void resumePendingChromeTabGroupCleanup({ forceStorageRead: true });
  // An update can replace the old Dashboard-owned implementation while the
  // user already has ordinary tabs open. Reconcile them immediately instead
  // of waiting for the next tab mutation or for a Tab Harbor page to open.
  void scheduleAutomaticChromeGroupSyncForAllWindows();
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  void resumePendingChromeTabGroupCleanup({ forceStorageRead: true });
  void scheduleAutomaticChromeGroupSyncForAllWindows();
});

// Update badge and notify Tab Harbor pages whenever a tab is opened
chrome.tabs.onCreated.addListener((tab) => {
  if (tab?.id != null) {
    createdRecentlyAt.set(tab.id, Date.now());
    scheduleGraceExpiryCheck(tab.id);
  }
  updateBadge();
  notifyTabHarborPages({
    source: "tabs.onCreated",
    triggerTabId: tab?.id,
    windowId: tab?.windowId,
  });
  void scheduleAutomaticChromeGroupSync(tab?.windowId);
  closeDuplicateNewTabs();
});

// Update badge and notify Tab Harbor pages whenever a tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo = {}) => {
  createdRecentlyAt.delete(tabId);
  clearGraceExpiryCheck(tabId);
  updateBadge();
  notifyTabHarborPages({
    source: "tabs.onRemoved",
    triggerTabId: tabId,
    windowId: removeInfo.windowId,
  });
  if (!removeInfo.isWindowClosing) {
    void scheduleAutomaticChromeGroupSync(removeInfo.windowId);
  }
});

// Update badge and notify Tab Harbor pages when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener((tabId, changeInfo = {}, tab = {}) => {
  updateBadge();
  notifyTabHarborPages({
    source: "tabs.onUpdated",
    triggerTabId: tabId,
    windowId: tab?.windowId,
  });

  const changesAutomaticGroupMembership = ["url", "groupId", "pinned"]
    .some(key => Object.prototype.hasOwnProperty.call(changeInfo, key));
  if (changesAutomaticGroupMembership) {
    void scheduleAutomaticChromeGroupSync(tab?.windowId);
  }

  // A tab that just committed a new-tab URL (chrome://newtab/ or the Tab
  // Harbor extension page) may have been created inside the grace window and
  // therefore skipped by the onCreated cleanup. Re-check now that its URL is
  // known so a Ctrl+T'd duplicate next to an existing Tab Harbor page is
  // still closed. The grace check itself already ran or is scheduled by
  // onCreated; this is a second, URL-driven opportunity.
  if (changeInfo?.url) {
    const urls = getNewTabUrls();
    const isNewTab = changeInfo.url === "chrome://newtab/" || urls.has(changeInfo.url);
    if (isNewTab) closeDuplicateNewTabs();
  }
});

// A tab can be replaced with a different tab id (OAuth/redirect flows,
// prerendering). Without this, pages keep chips for tab ids that no longer
// exist, and actions on those stale chips corrupt grouping state.
chrome.tabs.onReplaced.addListener(async (addedTabId) => {
  updateBadge();
  let replacementTab = null;
  try {
    replacementTab = await chrome.tabs.get(addedTabId);
  } catch {}
  notifyTabHarborPages({
    source: "tabs.onReplaced",
    triggerTabId: addedTabId,
    windowId: replacementTab?.windowId,
  });
  if (isValidChromeWindowId(replacementTab?.windowId)) {
    void scheduleAutomaticChromeGroupSync(replacementTab.windowId);
  } else {
    // Replacement lookup can race with another navigation/removal. Fall back
    // to discovering live windows rather than silently losing the only event.
    void scheduleAutomaticChromeGroupSyncForAllWindows();
  }
});

if (chrome.tabs.onMoved?.addListener) {
  chrome.tabs.onMoved.addListener((tabId, moveInfo = {}) => {
    notifyTabHarborPages({
      source: "tabs.onMoved",
      triggerTabId: tabId,
      windowId: moveInfo.windowId,
    });
    void scheduleAutomaticChromeGroupSync(moveInfo.windowId);
  });
}

if (chrome.tabs.onAttached?.addListener) {
  chrome.tabs.onAttached.addListener((tabId, attachInfo = {}) => {
    notifyTabHarborPages({
      source: "tabs.onAttached",
      triggerTabId: tabId,
      windowId: attachInfo.newWindowId,
    });
    void scheduleAutomaticChromeGroupSync(attachInfo.newWindowId);
  });
}

if (chrome.tabs.onDetached?.addListener) {
  chrome.tabs.onDetached.addListener((tabId, detachInfo = {}) => {
    notifyTabHarborPages({
      source: "tabs.onDetached",
      triggerTabId: tabId,
      windowId: detachInfo.oldWindowId,
    });
    void scheduleAutomaticChromeGroupSync(detachInfo.oldWindowId);
  });
}

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();

// ─── Test exports ────────────────────────────────────────────────────────────

globalThis.TabHarborBackground = {
  getNewTabUrls,
  isNewTabBlank,
  closeDuplicateNewTabs,
  handleChromeTabGroupsMessage,
  handleChromeTabGroupsSettingChanged,
  runAutomaticChromeGroupSync,
  scheduleAutomaticChromeGroupSync,
  scheduleAutomaticChromeGroupSyncForAllWindows,
  resumePendingChromeTabGroupCleanup,
  _flushAutomaticChromeGroupSync: flushAutomaticChromeGroupSyncForTest,
  _getAutomaticChromeGroupSyncSlot: windowId => {
    const slot = tabHarborAutomaticGroupSyncSlots.get(Number(windowId));
    return slot ? {
      running: slot.running,
      dirty: slot.dirty,
      timerPending: Boolean(slot.timer),
      waiterCount: slot.waiters.length,
    } : null;
  },
  _resetAutomaticChromeGroupSync: () => {
    for (const slot of tabHarborAutomaticGroupSyncSlots.values()) {
      if (slot.timer) clearTimeout(slot.timer);
      for (const resolve of slot.waiters.splice(0)) {
        resolve(automaticChromeGroupSyncError("TEST_RESET", "automatic sync state reset"));
      }
    }
    tabHarborAutomaticGroupSyncSlots.clear();
  },
  _getPendingChromeTabGroupCleanupState: () => ({
    pending: tabHarborChromeGroupCleanupPendingCache,
    enabled: tabHarborChromeGroupSyncEnabledCache,
    inFlight: Boolean(tabHarborChromeGroupCleanupInFlight),
    retryPending: Boolean(tabHarborChromeGroupCleanupRetryTimer),
    retryAttempt: tabHarborChromeGroupCleanupRetryAttempt,
  }),
  _flushPendingChromeTabGroupCleanup: async () => {
    if (tabHarborChromeGroupCleanupRetryTimer) {
      clearTimeout(tabHarborChromeGroupCleanupRetryTimer);
      tabHarborChromeGroupCleanupRetryTimer = null;
    }
    return resumePendingChromeTabGroupCleanup({
      forceStorageRead: true,
      ignoreRetryTimer: true,
    });
  },
  _resetPendingChromeTabGroupCleanup: () => {
    if (tabHarborChromeGroupCleanupRetryTimer) {
      clearTimeout(tabHarborChromeGroupCleanupRetryTimer);
      tabHarborChromeGroupCleanupRetryTimer = null;
    }
    tabHarborChromeGroupCleanupPendingCache = null;
    tabHarborChromeGroupSyncEnabledCache = null;
    tabHarborChromeGroupCleanupInFlight = null;
    tabHarborChromeGroupCleanupRetryAttempt = 0;
  },
  // Test-only: reset the re-entrancy guard between test cases.
  _resetDuplicateCloseGuard: () => {
    duplicateCloseInFlight = false;
    duplicateCloseQueued = 0;
  },
};
