'use strict';

/**
 * focus-redirect.js — new-tab focus workaround
 *
 * Chrome's documented behavior: when the user creates a NEW tab (Ctrl+T), the
 * address bar always receives focus first, and a new-tab override page cannot
 * reliably claim it. Refreshing or navigating to the same page does NOT trigger
 * that behavior, which is why a plain focus() call works after a reload but
 * not after Ctrl+T.
 *
 * The community-verified workaround (Stack Overflow 16684663) is to force one
 * self-navigation: loading the page with a `?focus=1` query makes it a
 * navigated page instead of a freshly-created new-tab page, after which Chrome
 * no longer pins focus to the address bar and focus() (or the autofocus
 * attribute) takes effect.
 *
 * This script must run after the startup theme and before dashboard scripts so the redirect happens
 * before any dashboard logic runs. It is intentionally small and dependency
 * free. location.replace() starts an immediate navigation; the current page is
 * torn down before later scripts meaningfully run.
 */

(function focusRedirectOnce() {
  // When the auto-focus search toggle is off (mirrored from chrome.storage into
  // localStorage by the settings UI), do not self-navigate: the tab stays a
  // plain new-tab page (address bar keeps showing chrome://newtab/) and the
  // search field is not auto-focused.
  try {
    if (localStorage.getItem('tabHarborAutoFocusSearch') === '0') return;
  } catch { /* ignore */ }

  if (location.search.indexOf('focus=1') !== -1) return;
  const target = `${location.pathname}?focus=1${location.hash}`;
  location.replace(target);
})();
