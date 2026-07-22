/**
 * background.js — Service Worker
 *
 * Keeps Tab Harbor pages in sync when tabs change.
 * The toolbar badge is intentionally kept empty.
 */

const TAB_HARBOR_BG_DEBUG = false;
if (TAB_HARBOR_BG_DEBUG)
  console.log(
    "[tab-harbor bg] Service worker loaded, registering event listeners...",
  );

// ─── Auto-close duplicate new tabs ───────────────────────────────────────────

function getNewTabUrls() {
  return new Set([
    chrome.runtime.getURL("index.html"),
    chrome.runtime.getURL("extension/index.html"),
  ]);
}

function isNewTabBlank(tab, newTabUrls) {
  const knownNewTabUrls =
    newTabUrls instanceof Set
      ? newTabUrls
      : new Set(Array.isArray(newTabUrls) ? newTabUrls : [newTabUrls]);
  const url = tab?.url || "";
  const pendingUrl = tab?.pendingUrl || "";
  if (
    pendingUrl &&
    !knownNewTabUrls.has(pendingUrl) &&
    pendingUrl !== "chrome://newtab/"
  ) {
    return false;
  }
  return (
    url === "chrome://newtab/" ||
    knownNewTabUrls.has(url) ||
    pendingUrl === "chrome://newtab/" ||
    knownNewTabUrls.has(pendingUrl) ||
    url === "" ||
    (tab.status === "loading" && !url)
  );
}

async function closeDuplicateNewTabs() {
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
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Update badge and notify Tab Harbor pages whenever a tab is opened
chrome.tabs.onCreated.addListener((tab) => {
  updateBadge();
  notifyTabHarborPages({ source: "tabs.onCreated", triggerTabId: tab?.id });
  closeDuplicateNewTabs();
});

// Update badge and notify Tab Harbor pages whenever a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  updateBadge();
  notifyTabHarborPages({ source: "tabs.onRemoved", triggerTabId: tabId });
});

// Update badge and notify Tab Harbor pages when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener((tabId) => {
  updateBadge();
  notifyTabHarborPages({ source: "tabs.onUpdated", triggerTabId: tabId });
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();

// ─── Test exports ────────────────────────────────────────────────────────────

globalThis.TabHarborBackground = {
  getNewTabUrls,
  isNewTabBlank,
  closeDuplicateNewTabs,
};
