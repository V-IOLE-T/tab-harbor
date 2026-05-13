/**
 * background.js — Service Worker
 *
 * Keeps Tab Harbor pages in sync when tabs change.
 * The toolbar badge is intentionally kept empty.
 */

// console.log('[tab-harbor bg] Service worker loaded, registering event listeners...');

async function updateBadge() {
  try {
    await chrome.action.setBadgeText({ text: '' });
  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Notify Tab Harbor pages when tabs change so they can refresh
async function notifyTabHarborPages() {
  try {
    // Find all Tab Harbor dashboard pages
    const extensionId = chrome.runtime.id;

    // Query all tabs and filter manually for more reliable matching
    const allTabs = await chrome.tabs.query({});

    const dashboardTabs = allTabs.filter(tab => {
      if (!tab.url) return false;
      // Tab Harbor can appear as either:
      // 1. chrome-extension://EXTENSION_ID/index.html (direct access)
      // 2. chrome://newtab/ with title "Tab Harbor" (new tab override)
      return (
        tab.url.startsWith(`chrome-extension://${extensionId}/index.html`) ||
        (tab.url === 'chrome://newtab/' && tab.title === 'Tab Harbor')
      );
    });

    if (dashboardTabs.length === 0) return;

    for (const tab of dashboardTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'tabs-changed' });
      } catch (err) {
        // Tab might be closed or not ready, ignore
        console.warn(`[tab-harbor bg] Failed to notify tab ${tab.id}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[tab-harbor bg] Error in notifyTabHarborPages:', err);
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
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
  notifyTabHarborPages();
});

// Update badge and notify Tab Harbor pages whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
  notifyTabHarborPages();
});

// Update badge and notify Tab Harbor pages when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
  notifyTabHarborPages();
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
