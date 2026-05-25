/**
 * background.js — Service Worker
 *
 * Keeps Tab Harbor pages in sync when tabs change.
 * The toolbar badge is intentionally kept empty.
 */

const TAB_HARBOR_BG_DEBUG = false;
if (TAB_HARBOR_BG_DEBUG) console.log('[tab-harbor bg] Service worker loaded, registering event listeners...');

async function updateBadge() {
  try {
    await chrome.action.setBadgeText({ text: '' });
  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

function getTabHarborDashboardUrls() {
  const extensionId = chrome.runtime.id;
  return new Set([
    `chrome-extension://${extensionId}/index.html`,
    `chrome-extension://${extensionId}/extension/index.html`,
  ]);
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Notify Tab Harbor pages when tabs change so they can refresh
async function notifyTabHarborPages(eventMeta = {}) {
  try {
    // Find all Tab Harbor dashboard pages
    const dashboardUrls = getTabHarborDashboardUrls();

    // Query all tabs and filter manually for more reliable matching
    const allTabs = await chrome.tabs.query({});

    const dashboardTabs = allTabs.filter(tab => {
      if (!tab.url) return false;
      // Tab Harbor can appear as either:
      // 1. chrome-extension://EXTENSION_ID/index.html (direct access)
      // 2. chrome-extension://EXTENSION_ID/extension/index.html (root manifest entry)
      // 3. chrome://newtab/ with title "Tab Harbor" (new tab override)
      return (
        dashboardUrls.has(tab.url) ||
        (tab.url === 'chrome://newtab/' && tab.title === 'Tab Harbor')
      );
    });

    if (dashboardTabs.length === 0) return;

    for (const tab of dashboardTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'tabs-changed',
          source: eventMeta.source || 'tabs.changed',
          triggerTabId: eventMeta.triggerTabId ?? null,
        });
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
chrome.tabs.onCreated.addListener((tab) => {
  updateBadge();
  notifyTabHarborPages({ source: 'tabs.onCreated', triggerTabId: tab?.id });
});

// Update badge and notify Tab Harbor pages whenever a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  updateBadge();
  notifyTabHarborPages({ source: 'tabs.onRemoved', triggerTabId: tabId });
});

// Update badge and notify Tab Harbor pages when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener((tabId) => {
  updateBadge();
  notifyTabHarborPages({ source: 'tabs.onUpdated', triggerTabId: tabId });
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
