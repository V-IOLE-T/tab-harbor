'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const appEntryJs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const backgroundJs = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const chromeImportJs = fs.readFileSync(path.join(__dirname, 'chrome-tab-groups-import.js'), 'utf8');
const runtimeJs = fs.readFileSync(path.join(__dirname, 'dashboard-runtime.js'), 'utf8');
const themeJs = fs.readFileSync(path.join(__dirname, 'theme-controls.js'), 'utf8');
const drawerJs = fs.readFileSync(path.join(__dirname, 'drawer-manager.js'), 'utf8');
const helperJs = fs.readFileSync(path.join(__dirname, 'ui-helpers.js'), 'utf8');
const tabSessionsJs = fs.existsSync(path.join(__dirname, 'tab-sessions.js'))
  ? fs.readFileSync(path.join(__dirname, 'tab-sessions.js'), 'utf8')
  : '';
const sessionManagerJs = fs.existsSync(path.join(__dirname, 'session-manager.js'))
  ? fs.readFileSync(path.join(__dirname, 'session-manager.js'), 'utf8')
  : '';
const popupJs = fs.readFileSync(path.join(__dirname, 'popup', 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, 'popup', 'popup.html'), 'utf8');
const configJs = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8');
const configLoaderJs = fs.readFileSync(path.join(__dirname, 'config-loader.js'), 'utf8');
const appJs = [appEntryJs, runtimeJs, themeJs, drawerJs, helperJs].join('\n');

test('saved tabs page scripts load before dashboard runtime and expose a top page selector', () => {
  assert.match(html, /id="workspaceTopNav"/);
  assert.match(html, /id="homePage"/);
  assert.match(html, /id="savedTabsPage"/);
  assert.match(runtimeJs, /id="workspacePageSwitch"/);
  assert.match(runtimeJs, /function renderWorkspacePageSwitch\(currentPage = 'home'\)/);
  assert.match(runtimeJs, /data-action="switch-workspace-page"[\s\S]*data-page="home"/);
  assert.match(runtimeJs, /data-action="switch-workspace-page"[\s\S]*data-page="saved-tabs"/);
  assert.match(runtimeJs, /function renderWorkspaceThemeTools\(\) \{\s*const languagePreference = runtimeGetLanguagePreference \? runtimeGetLanguagePreference\(\) : 'auto';/);
  assert.match(runtimeJs, /renderWorkspaceThemeTools\(\)/);
  assert.match(runtimeJs, /syncWorkspaceTopNavMarkup/);
  assert.match(runtimeJs, /id="themeMenuTrigger"/);
  assert.match(sessionManagerJs, /renderSavedTabsNavArea/);
  assert.match(sessionManagerJs, /saved-session-nav-button/);
  assert.match(sessionManagerJs, /managerGetGroupIcon/);
  assert.match(html, /<script src="tab-url-utils\.js"><\/script>[\s\S]*<script src="tab-sessions\.js"><\/script>[\s\S]*<script src="session-manager\.js"><\/script>[\s\S]*<script src="dashboard-runtime\.js"><\/script>/);
});

test('workspace top selector stays mounted when open tabs become empty', () => {
  assert.match(runtimeJs, /function renderGroupNavArea\(groups\)/);
  assert.match(runtimeJs, /renderWorkspacePageSwitch\('home'\)/);
  assert.match(runtimeJs, /renderWorkspaceThemeTools\(\)/);
  assert.match(runtimeJs, /function renderOpenTabsSummary\(realTabs = getRealTabs\(\)\) \{[\s\S]*syncWorkspaceTopNavMarkup\(renderGroupNavArea\(domainGroups\), true\);[\s\S]*syncWorkspaceTopNavMarkup\(renderGroupNavArea\(\[\]\), true\);/);
  assert.match(runtimeJs, /function renderOpenTabsArea\(realTabs = getRealTabs\(\)\) \{[\s\S]*syncWorkspaceTopNavMarkup\(renderGroupNavArea\(domainGroups\), true\);[\s\S]*syncWorkspaceTopNavMarkup\(renderGroupNavArea\(\[\]\), true\);/);
  assert.doesNotMatch(runtimeJs, /renderOpenTabsSummary[\s\S]*syncWorkspaceTopNavMarkup\('', false\)/);
  assert.doesNotMatch(runtimeJs, /renderOpenTabsArea[\s\S]*syncWorkspaceTopNavMarkup\('', false\)/);
});

test('saved tabs page keeps session management while home owns session save actions', () => {
  assert.match(html, /id="savedSessionsList"/);
  assert.doesNotMatch(html, /class="saved-tabs-page-title"/);
  assert.doesNotMatch(html, /Keep a window or a handpicked set of tabs, then bring it back when the desk is ready\./);
  assert.match(runtimeJs, /data-action="save-current-window-session"/);
  assert.match(runtimeJs, /id="tabSessionPicker"/);
  assert.match(runtimeJs, /data-action="select-session-picker-mode"[\s\S]*data-session-picker-mode="existing"/);
  assert.match(runtimeJs, /data-action="change-session-picker-new-name"/);
  assert.match(runtimeJs, /sessionPickerNewSessionNamePlaceholder/);
  assert.match(runtimeJs, /data-action="change-session-picker-target"/);
  assert.match(runtimeJs, /data-action="save-selected-session-tabs"/);
  assert.match(runtimeJs, /class="section-icon-action"/);
  assert.match(runtimeJs, /class="section-icon-action section-icon-action-close"/);
  assert.match(runtimeJs, /data-tooltip="\$\{runtimeT \? runtimeT\('saveSessionButton'\) : 'Save session'\}"/);
  assert.doesNotMatch(runtimeJs, /section-summary/);
  assert.match(runtimeJs, /data-action="save-domain-session"/);
  assert.match(runtimeJs, /data-action="save-single-tab-session"/);
  assert.match(sessionManagerJs, /const SAVED_TAB_SESSION_ORDER_KEY = 'savedTabSessionOrder'/);
  assert.match(sessionManagerJs, /runtime\.syncWorkspaceTopNavMarkup\(renderSavedTabsNavArea\(sessions\), true\)/);
  assert.match(sessionManagerJs, /data-action="rename-saved-session"/);
  assert.match(sessionManagerJs, /data-action="submit-saved-session-rename"/);
  assert.match(sessionManagerJs, /managerRenameSavedTabSession/);
  assert.match(sessionManagerJs, /managerUpdateSavedTabSessionTabs/);
  assert.doesNotMatch(sessionManagerJs, /saved-session-group-chip/);
  assert.match(sessionManagerJs, /data-action="restore-tab-session"/);
  assert.match(sessionManagerJs, /class="group-action-icon saved-session-restore"/);
  assert.match(sessionManagerJs, /data-action="restore-saved-session-tab"/);
  assert.match(sessionManagerJs, /data-action="delete-tab-session"/);
  assert.match(sessionManagerJs, /data-action="delete-saved-session-tab"/);
  assert.doesNotMatch(sessionManagerJs, /saved-session-tab-url/);
});

test('saved-session picker scopes visible tabs to the selected entry point', () => {
  assert.match(runtimeJs, /async function openTabSessionPicker\(\{\s*source = 'current-window',\s*initialTabIds = null,\s*scopeTabIds = null,\s*\} = \{\}\)/);
  assert.match(runtimeJs, /const scopedGroups = getScopedTabSessionPickerGroups\(context\.groups, scopeTabIds\);/);
  assert.match(runtimeJs, /const allIds = getTabSessionPickerAllIds\(scopedGroups\);/);
  assert.match(runtimeJs, /groups: scopedGroups,/);
  assert.match(runtimeJs, /const newSessionName = String\(tabSessionPickerState\.newSessionName \|\| ''\)\.trim\(\);/);
  assert.match(runtimeJs, /saveSelectedTabSession\(\s*selectedIds,\s*tabSessionPickerState\.source \|\| 'selected',\s*newSessionName\s*\)/);
  assert.match(runtimeJs, /if \(action === 'save-current-window-session'\) \{[\s\S]{0,280}openTabSessionPicker\(\{ source: 'current-window' \}\)/);
  assert.match(runtimeJs, /if \(action === 'save-single-tab-session'\) \{[\s\S]{0,360}openTabSessionPicker\(\{\s*source: 'single-tab',\s*initialTabIds: \[tabId\],\s*scopeTabIds: \[tabId\],\s*\}\)/);
  assert.match(runtimeJs, /if \(action === 'save-domain-session'\) \{[\s\S]{0,720}openTabSessionPicker\(\{\s*source: 'group',\s*initialTabIds: tabIds,\s*scopeTabIds: tabIds,\s*\}\)/);
  assert.doesNotMatch(runtimeJs, /saveSelectedTabSession\(\[tabId\], 'single-tab'\)/);
  assert.doesNotMatch(runtimeJs, /saveSelectedTabSession\(tabIds, 'group'\)/);
});

test('home and saved section headers share a fixed title column and top nav stays single-row', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /#openTabsSection \.section-header h2,\s*\.saved-sessions-section \.section-header h2 \{[\s\S]*width:\s*13ch;/);
  assert.match(css, /#openTabsSection \.section-count,\s*\.saved-sessions-section \.section-count \{[\s\S]*width:\s*96px;/);
  assert.match(css, /\.group-nav-wide \{[\s\S]*min-height:\s*40px;[\s\S]*flex-wrap:\s*nowrap;[\s\S]*align-items:\s*center;/);
  assert.match(css, /\.group-nav-list \{[\s\S]*flex-wrap:\s*nowrap;/);
  assert.match(css, /\.group-nav-list \{[\s\S]*min-height:\s*40px;/);
  assert.match(css, /\.group-nav-list \{[\s\S]*overflow-x:\s*auto;/);
});

test('group close control is icon-only and tab rows expose session save actions', () => {
  assert.match(runtimeJs, /class="group-action-icon group-action-close"/);
  assert.match(runtimeJs, /data-action="close-domain-tabs"[\s\S]*aria-label="/);
  assert.match(runtimeJs, /data-action="close-domain-tabs"[\s\S]*data-tooltip="/);
  assert.match(runtimeJs, /class="mission-actions"/);
  assert.match(runtimeJs, /class="chip-action chip-session-save"/);
  assert.match(runtimeJs, /class="chip-action chip-session-save"[\s\S]*data-tooltip="/);
  assert.match(helperJs, /archive: `<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true"><path d="M845\.312 0\.512H32\.512v1022\.976h958\.976v-876\.8L845\.312 0\.512z/);
});

test('desk settings separates appearance and feature controls', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(runtimeJs, /class="theme-menu-tabs" role="tablist"/);
  assert.match(runtimeJs, /data-theme-menu-tab="appearance"[\s\S]*data-theme-menu-tab="features"/);
  assert.match(runtimeJs, /id="themeMenuAppearancePanel"[\s\S]*id="themeModeOptions"[\s\S]*id="themeOptions"/);
  assert.match(runtimeJs, /id="themeMenuFeaturesPanel"[\s\S]*data-action="toggle-chrome-tab-groups"[\s\S]*data-action="toggle-hitokoto"[\s\S]*data-action="toggle-sleep-control"[\s\S]*data-action="toggle-close-duplicate-new-tabs"/);
  assert.match(runtimeJs, /if \(action === 'select-theme-menu-tab'\)/);
  assert.match(themeJs, /let themeMenuActiveTab = 'appearance';/);
  assert.match(themeJs, /querySelectorAll\('\[data-theme-menu-panel\]'\)/);
  assert.match(css, /\.theme-menu-tab \{[\s\S]*border:\s*none;[\s\S]*border-radius:\s*0;/);
});

test('manual sleep control places per-tab moon action first', () => {
  assert.match(runtimeJs, /function buildOverflowChips[\s\S]*<div class="chip-actions">\s*\$\{sleepControlEnabled && !tab\.active \? `\s*<button class="chip-action chip-discard"[\s\S]*<button class="chip-action chip-session-save"/);
  assert.match(runtimeJs, /function renderDomainCard[\s\S]*<div class="chip-actions">\s*\$\{sleepControlEnabled && !tab\.active \? `<button class="chip-action chip-discard"[\s\S]*<button class="chip-action chip-session-save"/);
});

test('icon-only actions use themed tooltips instead of native title hovers', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /\.chip-action\[data-tooltip\]::after,/);
  assert.match(css, /content: attr\(data-tooltip\);/);
  assert.doesNotMatch(runtimeJs, /save-current-window-session"[^>]* title="/);
  assert.doesNotMatch(runtimeJs, /save-domain-session"[^>]* title="/);
  assert.doesNotMatch(runtimeJs, /save-single-tab-session"[^>]* title="/);
});

test('saved tabs top nav supports session reordering and card jump highlighting', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(sessionManagerJs, /normalizeSavedTabSessionOrder/);
  assert.match(sessionManagerJs, /applySavedTabSessionOrder/);
  assert.match(sessionManagerJs, /buildSavedTabSessionOrder/);
  assert.match(sessionManagerJs, /createNewSession/);
  assert.match(sessionManagerJs, /newSessionPlacement/);
  assert.match(sessionManagerJs, /insertBeforeSessionId/);
  assert.match(sessionManagerJs, /lastResolvedDropTarget/);
  assert.match(sessionManagerJs, /detachSavedSessionTabToNewSession/);
  assert.match(sessionManagerJs, /data-action="jump-to-saved-session"/);
  assert.match(sessionManagerJs, /savedSessionDragPlaceholderEl/);
  assert.match(sessionManagerJs, /savedSessionNewSessionSlotEl/);
  assert.match(sessionManagerJs, /saveSavedTabSessionOrder/);
  assert.match(sessionManagerJs, /const SAVED_TAB_SESSION_COLLAPSED_KEY = 'savedTabSessionCollapsedState'/);
  assert.match(css, /\.saved-session-card\.group-nav-target/);
  assert.match(sessionManagerJs, /savedSessionTabDragState/);
  assert.match(sessionManagerJs, /saved-session-reorder-handle/);
  assert.match(sessionManagerJs, /data-action="toggle-saved-session-settings"/);
  assert.match(sessionManagerJs, /data-action="change-saved-session-restore-mode"/);
  assert.match(sessionManagerJs, /data-action="change-saved-session-nav-display-mode"/);
  assert.match(sessionManagerJs, /saved-session-settings-trigger/);
  assert.match(sessionManagerJs, /saved-session-settings-menu/);
  assert.match(sessionManagerJs, /data-action="toggle-saved-session-collapse"/);
  assert.match(sessionManagerJs, /<select[^>]+data-action="change-saved-session-restore-mode"/);
  assert.match(sessionManagerJs, /<select[^>]+data-action="change-saved-session-nav-display-mode"/);
  assert.match(css, /\.saved-session-tab-row/);
  assert.match(css, /\.saved-session-tab-placeholder/);
  assert.match(css, /\.saved-session-new-slot/);
  assert.match(css, /\.saved-session-new-slot-line/);
  assert.match(css, /\.saved-session-settings-trigger/);
  assert.match(css, /\.saved-session-settings-menu/);
  assert.match(css, /\.saved-session-collapse/);
  assert.match(css, /\.saved-session-card\.is-collapsed/);
  assert.match(css, /\.saved-session-nav-button\.is-name-mode/);
});

test('tab sessions close selected tabs by id after storage save instead of fuzzy url matching', () => {
  assert.match(tabSessionsJs, /const SAVED_TAB_SESSIONS_KEY = 'savedTabSessions'/);
  assert.match(runtimeJs, /await saveTabsAsSession\(/);
  assert.match(runtimeJs, /chrome\.tabs\.remove\(tabIdsToClose\)/);
  assert.doesNotMatch(runtimeJs, /closeTabsByUrls\(selected/);
});

test('new tab dashboard scopes visible open tabs to its own browser window', () => {
  assert.match(runtimeJs, /let currentDashboardWindowId = null;/);
  assert.match(runtimeJs, /let allOpenTabIds = \[\];/);
  assert.match(runtimeJs, /const visibleTabs = currentWindowId == null\s*\?\s*tabs\s*:\s*tabs\.filter\(t => t\.windowId === currentWindowId\);/);
  assert.match(runtimeJs, /openTabs = visibleTabs\.map\(t =>/);
  assert.match(runtimeJs, /function getOpenTabIdsForSessionPruning\(\)/);
  assert.match(runtimeJs, /async function queryTabsForDashboardWindow\(\) \{[\s\S]*chrome\.tabs\.query\(\{\s*windowId: currentWindowId\s*\}\)/);
  assert.doesNotMatch(runtimeJs, /if \(currentDashboardWindowId != null\) return currentDashboardWindowId;/);
  assert.match(runtimeJs, /await loadSessionGroups\(getOpenTabIdsForSessionPruning\(\)\)/);
  assert.match(runtimeJs, /async function closeTabsByUrls\(urls\) \{[\s\S]*const allTabs = await queryTabsForDashboardWindow\(\);/);
  assert.match(runtimeJs, /async function closeTabsExact\(urls\) \{[\s\S]*const allTabs = await queryTabsForDashboardWindow\(\);/);
  assert.match(runtimeJs, /async function closeDuplicateTabs\(urls, keepOne = true\) \{[\s\S]*const allTabs = await queryTabsForDashboardWindow\(\);/);
  assert.doesNotMatch(runtimeJs, /await loadSessionGroups\(openTabs\.map\(tab => tab\.id\)\)/);
  assert.doesNotMatch(runtimeJs, /await loadSessionGroups\(realTabs\.map\(tab => tab\.id\)\)/);
});

test('tab chips no longer render move-to-group controls', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.doesNotMatch(runtimeJs, /function buildMoveMenu\(tab\)/);
  assert.doesNotMatch(runtimeJs, /toggle-move-menu/);
  assert.doesNotMatch(runtimeJs, /move-tab-to-group/);
  assert.doesNotMatch(runtimeJs, /move-tab-to-new-group/);
  assert.doesNotMatch(runtimeJs, /move-tab-to-original/);
  assert.doesNotMatch(css, /\.chip-move-menu/);
  assert.doesNotMatch(css, /\.chip-move-wrap/);
});

test('dragging uses the original group icon as a fixed positioned element', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(
    css,
    /\.group-nav-button\.is-dragging\s*\{[\s\S]*position:\s*fixed;[\s\S]*pointer-events:\s*none;/
  );
});

test('pin toggle is removed from the group nav controls', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.doesNotMatch(appJs, /headerPinToggle/);
  assert.doesNotMatch(css, /\.group-pin-toggle/);
});

test('group nav icons disable native image dragging', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(appJs, /class="group-nav-button"[\s\S]*draggable="false"/);
  assert.match(appJs, /class="group-nav-icon"[\s\S]*draggable="false"/);
  assert.match(css, /\.group-nav-button,\s*\.group-nav-button \*\s*\{[\s\S]*-webkit-user-drag:\s*none;/);
});

test('icon fallback handling avoids inline event handlers', () => {
  assert.doesNotMatch(appJs, /onerror=/);
  assert.match(appJs, /data-fallback-src=/);
  assert.match(helperJs, /document\.addEventListener\('error', event =>/);
  assert.match(helperJs, /handleImageFallbackError/);
  assert.match(helperJs, /setImageFallbackAttributes/);
});

test('toast helper tolerates missing optional action button node', () => {
  assert.match(helperJs, /if \(!toast \|\| !toastText\) return;/);
  assert.match(helperJs, /if \(action && toastAction\)/);
  assert.match(helperJs, /\} else if \(toastAction\) \{/);
});

test('popup group nav keeps visible fallback labels and popup-local image fallback handling', () => {
  assert.match(popupJs, /class="group-nav-fallback"/);
  assert.match(popupJs, /data-fallback-src=/);
  assert.match(popupJs, /document\.addEventListener\('error', handlePopupGroupNavImageError, true\)/);
});

test('popup auto-refreshes when tabs and local storage change', () => {
  assert.match(popupJs, /chrome\.tabs\?\.onCreated\?\.addListener\(schedule\)/);
  assert.match(popupJs, /chrome\.tabs\?\.onMoved\?\.addListener\(schedule\)/);
  assert.match(popupJs, /chrome\.tabGroups\?\.onUpdated\?\.addListener\(schedule\)/);
  assert.match(popupJs, /chrome\.storage\?\.onChanged\?\.addListener\(handlePopupStorageChanged\)/);
  assert.match(popupJs, /const POPUP_REFRESH_KEYS = new Set/);
});

test('popup opens tabs from other windows in the current window instead of focusing the old window', () => {
  assert.match(popupJs, /targetTab\.windowId !== currentWindow\.id/);
  assert.match(popupJs, /await chrome\.tabs\.create\(\{\s*windowId: currentWindow\.id,/);
  assert.match(popupJs, /await openPopupTab\(tabId, actionEl\.dataset\.url \|\| ''\)/);
});

test('popup removes redundant shortcuts and open-tabs summary rows', () => {
  assert.doesNotMatch(popupHtml, /id="popupShortcutsCount"/);
  assert.doesNotMatch(popupHtml, /id="popupTabsCount"/);
});

test('popup follows dashboard tab-order storage and richer title shaping', () => {
  assert.match(popupJs, /const GROUP_TAB_ORDER_KEY = 'groupTabOrder'/);
  assert.match(popupJs, /popupState\.groupTabOrder/);
  assert.match(popupJs, /function getOrderedUniqueTabsForGroup\(group\)/);
  // smartTitle and cleanTitle are now shared via ui-helpers.js
  assert.match(popupHtml, /<script src="\.\.\/ui-helpers\.js"><\/script>/);
});

test('manifest action keeps the popup entry wired to popup html', () => {
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');

  assert.match(manifest, /"default_popup": "popup\/popup\.html"/);
  assert.match(popupHtml, /<script src="popup\.js"><\/script>/);
});

test('theme controls expose popup helpers without dropping main theme runtime exports', () => {
  assert.match(themeJs, /getResolvedThemeDefinition/);
  assert.match(themeJs, /getSavedSessionNavDisplayMode/);
  assert.match(themeJs, /getResolvedTone/);
  assert.match(themeJs, /getSavedSessionRestoreMode/);
  assert.match(themeJs, /loadThemePreferences/);
  assert.match(themeJs, /getQuickShortcuts/);
  assert.match(themeJs, /saveSavedSessionNavDisplayMode/);
  assert.match(themeJs, /saveSavedSessionRestoreMode/);
  assert.match(themeJs, /saveQuickShortcutOrder/);
  assert.match(themeJs, /syncPopupTheme/);
});

test('index includes a back-to-top floating button', () => {
  assert.match(html, /id="backToTopBtn"/);
});

test('index includes todo drawer trigger and overlay without saved-for-later trigger', () => {
  assert.doesNotMatch(html, /id="deferredTrigger"/);
  assert.match(html, /id="todoTrigger"/);
  assert.match(html, /id="deferredOverlay"/);
  assert.match(html, /id="headerSearchForm"/);
  assert.match(html, /id="headerSearchInput"/);
  assert.match(html, /class="header-title-row"/);
  assert.match(html, /id="quickTabsSection"/);
  assert.match(html, /id="quickTabsList"/);
  assert.doesNotMatch(html, /Quick tabs/);
  assert.doesNotMatch(html, /No custom background/);
  assert.doesNotMatch(html, /deferredTriggerIconPath/);
  assert.doesNotMatch(html, /id="deferredTriggerCount"/);
  assert.doesNotMatch(html, /deferred-trigger-label/);
});

test('optional local config is loaded safely before app mount', () => {
  assert.match(html, /<script src="config\.js"><\/script>/);
  assert.match(html, /<script src="config-loader\.js"><\/script>/);
  assert.doesNotMatch(html, /<script src="config\.local\.js"><\/script>/);
  assert.match(configJs, /LOCAL_LANDING_PAGE_PATTERNS/);
  assert.match(configJs, /LOCAL_CUSTOM_GROUPS/);
  assert.match(configLoaderJs, /TabHarborConfigReady/);
  assert.match(configLoaderJs, /script\.src = 'config\.local\.js'/);
  assert.match(configLoaderJs, /script\.onerror = \(\) => resolve\(\)/);
  assert.match(appEntryJs, /TabHarborConfigReady/);
  assert.match(appEntryJs, /await appConfigReady/);
});

test('background keeps the toolbar badge empty', () => {
  assert.match(backgroundJs, /await chrome\.action\.setBadgeText\(\{\s*text:\s*["']{2}\s*\}\)/);
  assert.doesNotMatch(backgroundJs, /String\(count\)/);
});

test('manifest keeps only permissions required by the shipped runtime', () => {
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');

  assert.match(manifest, /"tabs"/);
  assert.match(manifest, /"storage"/);
  assert.match(manifest, /"search"/);
  assert.match(manifest, /"clipboardRead"/);
  assert.doesNotMatch(manifest, /"activeTab"/);
});

test('root manifest mirrors the Edge unpacked entry points', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8');

  assert.match(manifest, /"chrome_url_overrides": \{ "newtab": "extension\/index\.html" \}/);
  assert.match(manifest, /"service_worker": "extension\/background\.js"/);
  assert.match(manifest, /"default_popup": "extension\/popup\/popup\.html"/);
});

test('footer credits point to the repo and OO GitHub profile', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(
    html,
    /class="footer-credit"[\s\S]*href="https:\/\/github\.com\/V-IOLE-T\/tab-harbor"[\s\S]*>Tab Harbor<\/a> by <a class="footer-credit-link" href="https:\/\/github\.com\/V-IOLE-T"[\s\S]*>OO<\/a>/
  );
  assert.match(css, /\.footer-credit-link\s*\{/);
  assert.match(css, /\.footer-credit-link:hover,\s*\.footer-credit-link:focus-visible\s*\{/);
});

test('group nav reorder animation uses FLIP-style transition for sibling icons', () => {
  assert.match(appJs, /getBoundingClientRect\(\)/);
  assert.match(appJs, /requestAnimationFrame/);
  assert.match(appJs, /function animateNavButtonNode\(button, previousRect\)/);
  assert.match(appJs, /Math\.hypot\(deltaX, deltaY\)/);
  assert.match(appJs, /button\.style\.transform = `translate3d\(/);
  assert.match(appJs, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
});

test('group order state is always treated as a durable persisted order', () => {
  assert.match(runtimeJs, /sessionOrder:\s*orderKeys,/);
  assert.match(runtimeJs, /pinnedOrder:\s*orderKeys,/);
  assert.match(runtimeJs, /pinEnabled:\s*false,/);
});

test('drag preview only reorders top icons and defers card refresh until drop', () => {
  assert.match(appJs, /if \(options\.reorderCards !== false\)/);
  assert.match(appJs, /applyLiveGroupOrder\(previewOrderKeys,\s*\{\s*reorderCards:\s*false/);
  assert.match(appJs, /async function renderOpenTabsLayout\(\{ rebuildGroups = true, syncChrome = false, patchDom = false, changedGroupKeys = \[\] \} = \{\}\)/);
  assert.match(appJs, /await renderOpenTabsLayout\(\{[\s\S]*rebuildGroups: true,[\s\S]*syncChrome: true,[\s\S]*patchDom: true,[\s\S]*changedGroupKeys:/);
});

test('group drag commit reorders cards in place instead of refreshing the whole dashboard', () => {
  assert.match(appJs, /function animateMissionCards\(missionsEl, previousRects\)/);
  assert.match(appJs, /animateMissionCards\(missionsEl,\s*previousMissionRects\)/);
  assert.match(appJs, /const nextGroupOrder = groupOrderState\.sessionOrder\?\.slice\(\) \|\| domainGroups\.map\(group => String\(group\.domain\)\)/);
  assert.match(appJs, /document\.addEventListener\('pointerup', async \(\) => \{[\s\S]*const moved = dragStartPoint\?\.moved;[\s\S]*const nextGroupOrder = groupOrderState\.sessionOrder\?\.slice\(\) \|\| domainGroups\.map\(group => String\(group\.domain\)\);[\s\S]*clearGroupDragState\(\);[\s\S]*if \(moved\) \{[\s\S]*applyLiveGroupOrder\(nextGroupOrder,\s*\{\s*reorderCards:\s*true,\s*reorderNav:\s*true\s*\}\);[\s\S]*\}[\s\S]*\}\);/);
  assert.match(appJs, /applyLiveGroupOrder\(nextGroupOrder,\s*\{\s*reorderCards:\s*true,\s*reorderNav:\s*true\s*\}\)/);
  assert.match(appJs, /function suppressChromeTabGroupsImport\(durationMs = 1200\)/);
  assert.match(appJs, /function syncChromeTabGroupsWithoutImportEcho\(\)/);
  assert.match(appJs, /const ENTRY_ANIMATIONS_CLASS = 'entry-animations-enabled'/);
  assert.match(appJs, /function primeEntryAnimations\(durationMs = 1200\)/);
  assert.match(appJs, /function disableEntryAnimations\(\)/);
  assert.match(appJs, /function buildPersistentGroupOrderWithInsertedGroup\(insertedGroupKey,/);
  assert.match(appJs, /function buildPersistentGroupOrderReplacingKey\(replacementGroupKey, replacedGroupKey\)/);
  assert.match(appJs, /async function persistGroupOrder\(orderKeys = \[\]\)/);
  assert.match(chromeImportJs, /function findReusableSessionGroupId\(groups, assignments, nativeGroup\)/);
  assert.match(chromeImportJs, /sessionGroupId = findReusableSessionGroupId\(groups, normalizedState\.assignments, nativeGroup\);/);
  assert.match(appJs, /function disableChromeTabGroupsImportModeForLocalEdits\(\)/);
  assert.match(appJs, /function shouldImportChromeGroupsIntoSessionState\(\)/);
  assert.match(appJs, /setImportMode\(importedCount > 0\);\s*disableChromeTabGroupsImportModeForLocalEdits\(\);\s*window\.__suppressAutoRefreshUntil = Date\.now\(\) \+ 2000;\s*await renderDashboard\(\);/);
  assert.match(appJs, /if \(!shouldImportChromeGroupsIntoSessionState\(\)\) \{[\s\S]*disableChromeTabGroupsImportModeForLocalEdits\(\);[\s\S]*return;/);
  assert.match(appJs, /if \(enable && shouldImportChromeGroupsIntoSessionState\(\)\) \{/);
  assert.match(appJs, /else if \(!enable && typeof reconcileChromeTabGroupImports === 'function'\) \{/);
  assert.match(appJs, /applyLiveGroupOrder\(nextGroupOrder,\s*\{\s*reorderCards:\s*true,\s*reorderNav:\s*true\s*\}\);\s*await syncChromeTabGroupsWithoutImportEcho\(\);/);
});

test('session group naming no longer depends on removed chrome import fallback helpers', () => {
  assert.match(appJs, /function createUniqueSessionGroupName\(baseName, groups = sessionGroupsState\.groups, excludeGroupId = ''\) \{/);
  assert.match(appJs, /const lowerFallback = fallbackName\.toLowerCase\(\);/);
  assert.match(appJs, /while \(takenNames\.has\(`\$\{lowerFallback\} \$\{suffix\}`\)\) suffix \+= 1;/);
  assert.doesNotMatch(appJs, /return fallbackBuildChromeImportName\(baseName, groups, excludeGroupId\);/);
});

test('page chip drag commits without movement toasts', () => {
  assert.doesNotMatch(appJs, /showToast\(runtimeT \? runtimeT\('toastMovedTo'/);
  assert.doesNotMatch(appJs, /showToast\(runtimeT \? runtimeT\('toastCreatedGroup'/);
  assert.match(appJs, /logPageChipDragDebug\('finish-group-move'/);
  assert.match(appJs, /logPageChipDragDebug\('finish-new-group'/);
});

test('back-to-top button styles and behavior are wired up', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /\.back-to-top\s*\{/);
  assert.match(css, /\.back-to-top\.visible\s*\{/);
  assert.match(css, /\.back-to-top\s*\{[\s\S]*border-radius:\s*999px;/);
  assert.match(css, /\.back-to-top\s*\{[\s\S]*var\(--floating-surface-opacity\)/);
  assert.match(css, /\.back-to-top\s*\{[\s\S]*backdrop-filter:\s*blur\(10px\)/);
  assert.match(appJs, /window\.scrollTo\(\{\s*top:\s*0,\s*behavior:\s*prefersReducedMotion\(\) \? 'auto' : 'smooth'/);
  assert.match(appJs, /document\.getElementById\('backToTopBtn'\)/);
});

test('deferred drawer styles and behavior are wired up', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  assert.match(css, /\.drawer-header-actions\s*\{/);
  assert.match(css, /\.drawer-icon-btn\s*\{/);
  assert.match(css, /\.drawer-panel\.is-active\s*\{/);
  assert.match(css, /\.deferred-trigger\s*\{/);
  assert.match(css, /\.deferred-overlay\.visible\s*\{/);
  assert.match(css, /\.deferred-column\.open\s*\{/);
  assert.match(appJs, /const nextOpen = !deferredPanelOpen/);
  assert.doesNotMatch(appJs, /drawerView === 'saved'/);
  assert.doesNotMatch(appJs, /toggle-saved-search/);
  assert.match(appJs, /toggle-todo-search/);
  assert.match(appJs, /toggle-theme-menu/);
  assert.match(appJs, /select-theme/);
  assert.match(appJs, /select-theme-mode/);
  assert.match(appJs, /themeBackgroundInput/);
  assert.match(appJs, /loadThemePreferences/);
  assert.match(appJs, /e\.key === 'Escape' && deferredPanelOpen/);
  assert.match(appJs, /saveDrawerItemOrder/);
  assert.match(appJs, /previewDrawerItemOrder/);
  assert.match(html, /id="clearTodoArchiveBtn"/);
  assert.doesNotMatch(html, /id="savedSearchToggle"/);
  assert.match(html, /id="todoNewBtn"/);
  assert.match(css, /\.deferred-header\s*\{[\s\S]*animation:\s*none/);
  assert.match(css, /\.drawer-title-btn\s*\{[\s\S]*text-decoration:\s*underline/);
});

test('theme menu styles and custom background layer are defined', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /--page-custom-background:/);
  assert.match(css, /--custom-surface-opacity:/);
  assert.match(css, /--floating-surface-opacity:/);
  assert.match(css, /--panel-surface-opacity:/);
  assert.match(css, /--tooltip-surface:/);
  assert.match(css, /--tooltip-border:/);
  assert.match(css, /--tooltip-text:/);
  assert.match(css, /--workspace-accent:/);
  assert.match(css, /--workspace-accent-soft:/);
  assert.match(css, /--workspace-accent-border:/);
  assert.match(css, /--workspace-accent-contrast:/);
  assert.match(css, /--banner-action-bg:/);
  assert.match(css, /--banner-action-bg-hover:/);
  assert.match(css, /--banner-action-text:/);
  assert.match(css, /--workspace-chip-bg:/);
  assert.match(css, /--workspace-chip-bg-strong:/);
  assert.match(css, /--workspace-chip-text:/);
  assert.match(css, /--workspace-chip-border:/);
  assert.match(css, /body\s*\{[\s\S]*background-image:\s*var\(--page-custom-background\)/);
  assert.match(css, /\.header-title-row\s*\{[\s\S]*align-items:\s*center;[\s\S]*gap:\s*18px;[\s\S]*flex-wrap:\s*nowrap;/);
  assert.match(css, /\.header-left h1\s*\{[\s\S]*margin-bottom:\s*0;[\s\S]*white-space:\s*nowrap;/);
  assert.match(css, /\.header-left h1\s*\{[\s\S]*line-height:\s*1;/);
  assert.match(css, /\.header-left \.date\s*\{[\s\S]*font-size:\s*10px;[\s\S]*line-height:\s*1;[\s\S]*transform:\s*translateY\(1px\);/);
  assert.match(css, /\.header-theme-trigger\s*\{/);
  assert.match(css, /\.group-nav-tools\s*\{/);
  assert.match(css, /\.header-theme-trigger::after\s*\{/);
  assert.match(css, /\.header-search-shell\s*\{/);
  assert.match(css, /\.header-search-shell:focus-within\s*\{/);
  assert.match(css, /\.header-search-input\s*\{/);
  assert.match(css, /\.theme-menu\s*\{/);
  assert.match(css, /\.theme-mode-options\s*\{/);
  assert.match(css, /\.theme-mode-option\s*\{/);
  assert.match(css, /\.theme-range\s*\{/);
  assert.match(css, /\.theme-option\.is-active\s*\{/);
  assert.match(css, /\.header-theme-trigger\s*\{[\s\S]*background:\s*transparent;/);
  assert.match(themeJs, /body\.style\.backgroundImage = `linear-gradient/);
  assert.match(themeJs, /body\.classList\.add\('has-custom-background'\)/);
  assert.match(themeJs, /body\.classList\.remove\('has-custom-background'\)/);
  assert.match(themeJs, /hexToRgbChannels/);
  assert.match(themeJs, /surfaceOpacity/);
  assert.match(appJs, /const themeTrigger = document\.getElementById\('themeMenuTrigger'\)/);
  assert.match(appJs, /const themePanel = document\.getElementById\('themeMenuPanel'\)/);
  assert.match(appJs, /!themePanel\.contains\(e\.target\)/);
  assert.match(appJs, /id="themeMenuTrigger"/);
  assert.doesNotMatch(appJs, /id="headerPinToggle"/);
  assert.match(appJs, /id="themeMenuPanel"/);
  assert.match(appJs, /id="themeModeOptions"/);
  assert.match(appJs, /id="themeBackgroundInput"/);
  assert.match(appJs, /id="themeTransparencyRange"/);
  assert.match(appJs, /id="themeTransparencyValue"/);
  assert.match(appJs, /id="themeUiScaleRange"/);
  assert.match(appJs, /id="themeUiScaleValue"/);
  assert.match(appJs, /id="themeShortcutScaleRange"/);
  assert.match(appJs, /id="themeShortcutScaleValue"/);
  assert.match(themeJs, /uiScale/);
  assert.match(themeJs, /shortcutScale/);
  assert.match(css, /--ui-scale:/);
  assert.match(css, /--shortcut-scale:/);
  assert.match(css, /\.quick-tabs-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill, var\(--quick-shortcut-card-size\)\);/);
  assert.match(css, /\.quick-shortcut-card\s*\{[\s\S]*width:\s*var\(--quick-shortcut-card-size\);[\s\S]*flex:\s*0 0 var\(--quick-shortcut-card-size\);/);
  assert.match(themeJs, /Math\.min\(60, Math\.max\(2, Math\.round\(rawOpacity\)\)\)/);
  assert.match(appJs, /chrome\.search\?\.query/);
  assert.match(appJs, /disposition:\s*'CURRENT_TAB'/);
  assert.match(appJs, /e\.target\.id !== 'headerSearchForm'/);
  assert.match(appJs, /runDefaultSearch\(query\)/);
  assert.match(themeJs, /'--workspace-accent':/);
  assert.match(themeJs, /'--workspace-accent-soft':/);
  assert.match(themeJs, /'--workspace-accent-border':/);
  assert.match(themeJs, /'--workspace-accent-contrast':/);
  assert.match(css, /\.mission-card\s*\{[\s\S]*background:\s*color-mix\(\s*in\s+srgb,\s*var\(--card-bg\)\s+calc\(var\(--custom-surface-opacity\)\s*\+\s*68%\),\s*transparent\s*\);/);
  assert.match(css, /\.section-count\s*\{[\s\S]*color:\s*var\(--workspace-chip-text\);/);
  assert.match(css, /\.group-nav-button\s*\{[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/);
  assert.match(css, /\.group-nav-button::after\s*\{[\s\S]*background:\s*var\(--tooltip-surface\);[\s\S]*color:\s*var\(--tooltip-text\);[\s\S]*border:\s*1px solid var\(--tooltip-border\);/);
  assert.match(css, /\.tab-cleanup-banner\s*\{[\s\S]*var\(--theme-accent-soft\)[\s\S]*border:\s*1px solid var\(--theme-accent-muted\);/);
  assert.match(css, /\.tab-cleanup-icon svg\s*\{[\s\S]*color:\s*var\(--theme-accent-strong\);/);
  assert.match(css, /\.tab-cleanup-btn\s*\{[\s\S]*background:\s*var\(--banner-action-bg\);[\s\S]*color:\s*var\(--banner-action-text\);/);
  assert.match(css, /\.tab-cleanup-btn:hover\s*\{[\s\S]*background:\s*var\(--banner-action-bg-hover\);/);
  assert.match(css, /\.duplicate-count-badge\s*\{[\s\S]*color:\s*var\(--workspace-chip-text\);[\s\S]*background:\s*var\(--workspace-chip-bg-strong\);[\s\S]*border:\s*1px solid var\(--workspace-chip-border\);/);
  assert.match(css, /\.action-btn\.close-tabs\s*\{[\s\S]*border-color:\s*var\(--workspace-chip-border\);[\s\S]*color:\s*var\(--workspace-chip-text\);[\s\S]*background:\s*color-mix\(\s*in\s+srgb,\s*var\(--workspace-chip-bg\)\s+92%,\s*var\(--card-bg\)\s+8%\s*\);[\s\S]*border-radius:\s*8px;[\s\S]*min-height:\s*28px;/);
  assert.match(css, /\.action-btn\.close-tabs:hover\s*\{[\s\S]*background:\s*var\(--workspace-chip-bg-strong\);[\s\S]*border-color:\s*var\(--workspace-accent-border\);/);
  assert.match(css, /\.deferred-shell\s*\{[\s\S]*background:\s*color-mix\(\s*in\s+srgb,\s*var\(--card-bg\)\s+var\(--panel-card-opacity\),\s*transparent\s*\);/);
  assert.match(css, /--tooltip-surface:\s*color-mix\(\s*in\s+srgb,\s*var\(--workspace-accent-soft\)\s+32%,\s*var\(--card-bg\)\s+68%\s*\);/);
  assert.match(css, /\.drawer-title-btn\.is-active,\s*\.drawer-title-btn\[aria-selected="true"\]\s*\{[\s\S]*text-decoration-color:\s*var\(--drawer-tab-underline-active\);/);
  assert.match(css, /\.archive-clear-btn\s*\{[\s\S]*color:\s*var\(--workspace-chip-text\);/);
  assert.match(css, /\.todo-detail-card\s*\{[\s\S]*background:\s*color-mix\(\s*in\s+srgb,\s*var\(--card-bg\)\s+96%,\s*var\(--paper\)\s+4%\s*\);/);
  assert.match(appJs, /compressImageFileForStorage/);
  assert.doesNotMatch(appJs, /readFileAsDataUrl/);
  assert.match(html, /<script src="background-image\.js"><\/script>/);
  assert.match(html, /<script src="theme-controls\.js"><\/script>/);
});

test('quick tabs area renders shortcut cards and add button hooks', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /\.quick-tabs-grid\s*\{/);
  assert.match(css, /\.quick-tabs-grid\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(auto-fill, var\(--quick-shortcut-card-size\)\);[\s\S]*justify-content:\s*flex-start;/);
  assert.match(css, /\.quick-shortcut-card\s*\{/);
  assert.match(css, /\.quick-shortcut-card\s*\{[\s\S]*border:\s*none;/);
  assert.match(css, /\.quick-shortcut-card\s*\{[\s\S]*grid-template-rows:\s*var\(--quick-shortcut-shell-size\) auto;/);
  assert.match(css, /\.quick-shortcut-card\s*\{[\s\S]*width:\s*var\(--quick-shortcut-card-size\);[\s\S]*flex:\s*0 0 var\(--quick-shortcut-card-size\);/);
  assert.match(css, /\.quick-shortcut-icon-wrap\s*\{[\s\S]*border:\s*none;/);
  assert.match(css, /\.quick-shortcut-custom-glyph\s*\{/);
  assert.match(css, /\.quick-shortcut-icon-custom\s*\{/);
  assert.match(css, /\.quick-shortcut-edit\s*\{/);
  assert.match(css, /\.quick-shortcut-edit\s*\{[\s\S]*left:\s*0;[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;/);
  assert.match(css, /\.quick-shortcut-edit\s*\{[\s\S]*transform:\s*translateY\(2px\) scale\(0\.92\);/);
  assert.match(css, /\.quick-shortcut-card:hover \.quick-shortcut-edit,[\s\S]*transform:\s*translateY\(0\) scale\(1\);/);
  assert.match(css, /\.quick-shortcut-edit:hover,[\s\S]*border-color:\s*color-mix\(\s*in\s+srgb,\s*var\(--workspace-accent-border\)\s+38%,\s*transparent\s*\);/);
  assert.match(css, /\.shortcut-editor\s*\{/);
  assert.match(css, /\.shortcut-editor\s*\{[\s\S]*inset:\s*auto 88px 24px auto;/);
  assert.match(css, /\.shortcut-editor-preview\s*\{/);
  assert.match(css, /\.shortcut-editor-source-row\s*\{/);
  assert.match(css, /\.shortcut-editor-source-row\s*\{[\s\S]*display:\s*flex;/);
  assert.match(css, /\.shortcut-editor-source-segments\s*\{/);
  assert.match(css, /\.shortcut-editor-source-segments\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-width:\s*0;/);
  assert.match(css, /\.shortcut-editor-source-chip\s*\{/);
  assert.match(css, /\.shortcut-editor-source-chip\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*justify-content:\s*center;[\s\S]*flex:\s*1 1 0;/);
  assert.match(css, /\.shortcut-editor-source-chip:hover\s*\{/);
  assert.match(css, /\.shortcut-editor-source-chip\[aria-pressed="true"\]\s*\{/);
  assert.match(css, /\.shortcut-editor-mode-group\[hidden\]\s*\{/);
  assert.match(css, /\.shortcut-editor-inline-field\s*\{/);
  assert.match(css, /\.quick-shortcut-remove\s*\{/);
  assert.match(css, /\.quick-shortcut-remove\s*\{[\s\S]*right:\s*0;[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;/);
  assert.match(css, /\.quick-shortcut-remove:hover,[\s\S]*color:\s*color-mix\(in srgb, var\(--status-abandoned\) 92%, var\(--ink\) 8%\);/);
  assert.match(themeJs, /QUICK_SHORTCUTS_KEY/);
  assert.match(themeJs, /normalizeShortcutIcon/);
  assert.match(themeJs, /isSvgMarkup/);
  assert.match(themeJs, /svgToDataUrl/);
  assert.match(themeJs, /extractIconFromClipboardHtml/);
  assert.match(themeJs, /isTransientClipboardReference/);
  assert.match(themeJs, /\^data:image\\\//);
  assert.match(themeJs, /setShortcutEditorSource/);
  assert.match(themeJs, /tryShortcutEditorPasteViaExecCommand/);
  assert.match(themeJs, /document\.execCommand\('paste'\)/);
  assert.match(themeJs, /openShortcutEditor/);
  assert.match(themeJs, /function positionShortcutEditor\(triggerEl = null\)/);
  assert.match(themeJs, /const triggerRect = triggerEl\.getBoundingClientRect\(\)/);
  assert.match(themeJs, /panel\.style\.left = `\$\{Math\.round\(left\)\}px`;/);
  assert.match(themeJs, /positionShortcutEditor\(triggerEl\);/);
  assert.match(themeJs, /saveShortcutEditorShortcut/);
  assert.match(themeJs, /Shortcut icon updated/);
  assert.match(themeJs, /upload-shortcut-icon/);
  assert.match(themeJs, /edit-quick-shortcut/);
  assert.match(themeJs, /SVG icon pasted/);
  assert.match(themeJs, /temporary file reference\. Use Cmd\/Ctrl\+V instead/);
  assert.match(themeJs, /navigator\.clipboard\?\.read/);
  assert.match(themeJs, /text\/html/);
  assert.match(themeJs, /kind === 'svg' \|\| \/\^data:image\\\/\//);
  assert.match(themeJs, /renderQuickShortcuts/);
  assert.match(themeJs, /add-quick-shortcut/);
  assert.match(themeJs, /remove-quick-shortcut/);
  assert.match(themeJs, /open-quick-shortcut/);
  assert.match(appJs, /openOrFocusUrl/);
  assert.match(themeJs, /customIcon\.kind === 'glyph'\s*\?\s*''/);
  assert.doesNotMatch(themeJs, /title="\$\{safeLabel\}"/);
  assert.match(appJs, /data-chip-sort-id="\$\{safeSortId\}"[\s\S]*aria-label="\$\{safeTitle\}"/);
  assert.doesNotMatch(themeJs, /Add tab/);
  assert.match(html, /id="shortcutEditor"/);
  assert.match(html, /id="shortcutEditorForm"/);
  assert.match(html, /id="shortcutEditorSource"/);
  assert.match(html, /data-source="site"[\s\S]*>Website<\/button>/);
  assert.match(html, /data-source="glyph"[\s\S]*>Emoji<\/button>/);
  assert.match(html, /data-source="image"[\s\S]*>Image<\/button>/);
  assert.match(html, /data-source="svg"[\s\S]*>SVG<\/button>/);
  assert.match(html, /id="shortcutEditorSiteGroup"/);
  assert.match(html, /id="shortcutEditorEmoji"/);
  assert.match(html, /id="shortcutEditorSvgCode"/);
  assert.match(html, /id="shortcutEditorImageGroup"/);
  assert.match(html, />Save<\/button>/);
  assert.match(html, /Paste an image with Cmd\/Ctrl\+V while the editor is focused\./);
  assert.doesNotMatch(html, />Paste image<\/button>/);
  assert.match(html, /id="shortcutIconFileInput"/);
  assert.match(html, /id="shortcutEditorBack"/);
  assert.match(html, /id="tabPickerViewSwitch"/);
  assert.match(html, /id="tabPickerTabsTab"/);
  assert.match(html, /id="tabPickerUrlTab"/);
  assert.match(html, /id="tabPickerEditorHost"/);
  assert.match(themeJs, /let tabPickerMode = 'tabs';/);
  assert.match(themeJs, /function setTabPickerMode\(nextMode, \{ focus = true \} = \{\}\)/);
  assert.match(themeJs, /if \(action === 'switch-tab-picker-view'\) \{[\s\S]*setTabPickerMode\(actionEl\.dataset\.view \|\| 'tabs'\);/);
  assert.match(themeJs, /function mountShortcutEditorInTabPicker\(\)/);
  assert.match(themeJs, /elements\.form\.classList\.add\('is-tab-picker-pane'\)/);
  assert.match(themeJs, /if \(tabPickerMode === 'url'\) \{[\s\S]*openShortcutEditor\(null, tabPickerFocusReturnEl \|\| document\.activeElement, \{/);
  assert.match(themeJs, /function closeShortcutEditor\(\{ restoreFocus = true \} = \{\}\)/);
  assert.match(themeJs, /function syncFormControlValue\(element, nextValue\) \{[\s\S]*element\.dataset\.composing === 'true'/);
  assert.match(themeJs, /document\.addEventListener\('compositionstart', \(e\) => \{/);
  assert.match(themeJs, /document\.addEventListener\('compositionend', \(e\) => \{/);
  assert.match(css, /\.tab-picker-view-switch\s*\{/);
  assert.match(css, /\.tab-picker-search-wrap\[hidden\],[\s\S]*\.tab-picker-list\[hidden\],[\s\S]*\.tab-picker-editor-host\[hidden\]/);
  assert.match(css, /\.shortcut-editor-form\.is-tab-picker-pane\s*\{/);
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  assert.match(manifest, /"clipboardRead"/);
});

test('quick shortcuts support drag reordering with persisted order and drag preview styling', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(themeJs, /const\s*\{[\s\S]*reorderSubsetByIds:\s*themeReorderSubsetByIds,[\s\S]*\}\s*=\s*globalThis\.TabOutListOrder \|\| \{\};/);
  assert.match(themeJs, /class="quick-shortcut-card" data-shortcut-id="\$\{safeId\}"/);
  assert.match(themeJs, /const safeAriaLabel = themeEscapeHtmlAttribute \? themeEscapeHtmlAttribute\(label\) : label\.replace\(\/"\/g, '&quot;'\);/);
  assert.match(themeJs, /aria-label="\$\{safeAriaLabel\}"/);
  assert.match(themeJs, /let quickShortcutDragState = null;/);
  assert.match(themeJs, /document\.body\.classList\.add\('quick-shortcut-list-dragging'\)/);
  assert.match(themeJs, /quickShortcutSuppressClickUntil = Date\.now\(\) \+ 250/);
  assert.match(themeJs, /function clampQuickShortcutDragPoint\(clientX, clientY\)/);
  assert.match(themeJs, /const minClientX = listRect\.left \+ quickShortcutDragState\.offsetX - width \/ 2;/);
  assert.match(themeJs, /const maxClientX = listRect\.right \+ quickShortcutDragState\.offsetX - width \/ 2;/);
  assert.match(themeJs, /Math\.min\(Math\.max\(clientX, minClientX\), maxClientX\)/);
  assert.match(themeJs, /function ensureQuickShortcutSlot\(\)/);
  assert.match(themeJs, /quickShortcutSlotEl\.className = 'quick-shortcut-slot is-drag-slot';/);
  assert.match(themeJs, /function ensureQuickShortcutGhost\(\)/);
  assert.match(themeJs, /quickShortcutDraggedEl\.replaceWith\(quickShortcutSlotEl\)/);
  assert.match(themeJs, /quickShortcutGhostEl\.style\.setProperty\('--drag-height'/);
  assert.match(themeJs, /function updateDraggedQuickShortcutPosition\(clientX, clientY\)\s*\{[\s\S]*quickShortcutGhostEl\.style\.setProperty\('--drag-left'/);
  assert.match(themeJs, /await saveQuickShortcuts\(themeReorderSubsetByIds\(/);
  assert.match(themeJs, /function buildQuickShortcutSlotTargets\(listEl\)/);
  assert.match(themeJs, /slotTargets:\s*buildQuickShortcutSlotTargets\(listEl\)/);
  assert.match(themeJs, /function findQuickShortcutSlotIndex\(slotTargets, draggedCenterX, draggedCenterY\)/);
  assert.match(themeJs, /const distance = \(dx \* dx\) \+ \(dy \* dy\);/);
  assert.match(themeJs, /function animateQuickShortcutNode\(item, previousRect\)/);
  assert.match(themeJs, /function settleQuickShortcutItems\(listEl, affectedIds = null\)/);
  assert.match(themeJs, /if \(affected && !affected\.has\(key\)\) return;/);
  assert.match(themeJs, /Math\.hypot\(deltaX, deltaY\)/);
  assert.match(themeJs, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(themeJs, /const draggedCenterX = clampedPoint\.clientX - quickShortcutDragState\.offsetX \+ quickShortcutDragState\.width \/ 2;/);
  assert.match(themeJs, /const draggedCenterY = clampedPoint\.clientY - quickShortcutDragState\.offsetY \+ quickShortcutDragState\.height \/ 2;/);
  assert.match(themeJs, /const targetIndex = findQuickShortcutSlotIndex\(\s*quickShortcutDragState\.slotTargets,\s*draggedCenterX,\s*draggedCenterY\s*\);/);
  assert.match(themeJs, /const insertBeforeItem = items\[targetIndex\] \|\| null;/);
  assert.match(themeJs, /const targetBeforeNode = insertBeforeItem \|\| addCard \|\| null;/);
  assert.match(themeJs, /const currentBeforeNode = quickShortcutSlotEl\.nextElementSibling \|\| null;/);
  assert.match(themeJs, /if \(targetBeforeNode === currentBeforeNode\) return;/);
  assert.match(themeJs, /const previousOrderIds = \[\.\.\.listEl\.querySelectorAll\('\[data-shortcut-id\]'\)\]/);
  assert.match(themeJs, /const affectedIds = new Set\(/);
  assert.match(themeJs, /settleQuickShortcutItems\(listEl, affectedIds\);/);
  assert.match(themeJs, /animateQuickShortcutNode\(quickShortcutSlotEl, previousSlotRect\);/);
  assert.match(css, /body\.quick-shortcut-list-dragging\s*\{/);
  assert.match(css, /\.quick-shortcut-card\.is-drag-ghost\s*\{[\s\S]*position:\s*fixed;[\s\S]*height:\s*var\(--drag-height, auto\);[\s\S]*pointer-events:\s*none;/);
  assert.match(css, /\.quick-shortcut-card\.is-drag-ghost \.quick-shortcut-open\s*\{[\s\S]*transform:\s*none;[\s\S]*transition:\s*none;/);
  assert.match(css, /\.quick-shortcut-slot\s*\{[\s\S]*width:\s*var\(--quick-shortcut-card-size\);[\s\S]*min-height:\s*calc\(var\(--quick-shortcut-shell-size\) \+ 16px\);[\s\S]*pointer-events:\s*none;/);
});

test('quick shortcut add flows keep toast actions clickable and avoid stale duplicate state', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /\.toast\.visible\s*\{[\s\S]*pointer-events:\s*auto;/);
  assert.match(themeJs, /async function removeQuickShortcutById\(shortcutId\)\s*\{/);
  assert.match(themeJs, /showToast\('Tab added — undo\?',\s*\{[\s\S]*await removeQuickShortcutById\(nextShortcut\.id\);[\s\S]*await renderQuickShortcuts\(\);[\s\S]*\}\s*,?\s*\}\s*\);/);
  assert.match(themeJs, /const existingUrls = new Set\(shortcuts\.map\(s => s\.url\)\);[\s\S]*const shortcutUrl = tab\.url \|\| '';/);
  assert.match(themeJs, /if \(existingUrls\.has\(shortcutUrl\)\) continue;[\s\S]*newShortcuts\.push\(\{[\s\S]*url: shortcutUrl,[\s\S]*\}\);[\s\S]*existingUrls\.add\(shortcutUrl\);/);
});

test('collapsed drawer triggers use compact neutral frames with theme-ready tokens', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /--drawer-trigger-surface:/);
  assert.match(css, /--drawer-trigger-border:/);
  assert.match(css, /--drawer-trigger-icon:/);
  assert.match(css, /\.deferred-trigger\s*\{[\s\S]*width:\s*42px;[\s\S]*height:\s*42px;[\s\S]*padding:\s*0;/);
  assert.match(css, /\.deferred-trigger-icon\s*\{[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;/);
  assert.doesNotMatch(css, /#deferredTrigger\s*\{/);
  assert.doesNotMatch(css, /#todoTrigger\s*\{/);
});

test('todo list and tab chips expose drag handles with drag-state styling', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(drawerJs, /class="drawer-reorder-handle todo-reorder-handle"/);
  assert.match(appJs, /data-chip-drag-handle="tab"/);
  assert.match(appJs, /const chipItem = e\.target\.closest\('\[data-chip-sort-id\]'\);/);
  assert.match(appJs, /const chipAction = e\.target\.closest\('\.chip-actions'\);/);
  assert.match(appJs, /if \(chipItem && !chipAction && e\.button === 0\)/);
  assert.match(appJs, /e\.stopPropagation\(\);/);
  assert.match(appJs, /document\.body\.classList\.add\('page-chip-drag-armed'\)/);
  assert.match(appJs, /const GROUP_TAB_ORDER_KEY = 'groupTabOrder'/);
  assert.match(appJs, /saveGroupTabRowOrder/);
  assert.match(appJs, /ensureManualDropGroup/);
  assert.match(appJs, /moveDraggedPageChipToGroup/);
  assert.match(appJs, /createSessionGroupFromDraggedPageChip/);
  assert.match(appJs, /function getPageChipDropTarget\(clientX, clientY\)/);
  assert.match(appJs, /const PAGE_CHIP_DRAG_DEBUG = false;/);
  assert.match(appJs, /function buildPreviewGroupOrderFromDom\(insertedGroupKey = ''\)/);
  assert.match(appJs, /function clampPageChipClientPoint\(clientX, clientY\)/);
  assert.match(appJs, /window\.innerWidth - 1/);
  assert.match(appJs, /window\.innerHeight - 1/);
  assert.match(appJs, /const edgeThreshold = 18;/);
  assert.match(appJs, /clientY <= firstCardRect\.top \+ edgeThreshold/);
  assert.match(appJs, /clientY >= lastCardRect\.bottom - edgeThreshold/);
  assert.match(appJs, /for \(const cardEl of missionCards\) \{/);
  assert.match(appJs, /const withinCardY = clientY >= rect\.top && clientY <= rect\.bottom;/);
  assert.match(appJs, /const gapTop = currentRect\.bottom - gapThreshold;/);
  assert.match(appJs, /const gapBottom = nextRect\.top \+ gapThreshold;/);
  assert.match(appJs, /if \(clientY >= gapTop && clientY <= gapBottom\) \{/);
  assert.match(appJs, /const sourceGroupKey = pageChipDragState\?\.sourceGroupKey \|\| '';/);
  assert.match(appJs, /const isSourceGroup = groupKey === sourceGroupKey;/);
  assert.match(appJs, /if \(clientY >= listRect\.bottom \+ cardEdgeThreshold\) \{/);
  assert.match(appJs, /insertBeforeCardEl: nextCardEl,/);
  assert.match(appJs, /pageChipNewGroupSlotEl = document\.createElement\('div'\)/);
  assert.match(appJs, /pageChipNewGroupSlotEl\.className = 'mission-drop-new-group-slot';/);
  assert.match(appJs, /function syncPageChipDropTarget\(clientX, clientY\)/);
  assert.match(appJs, /const dragHandleEl = chipHandle \|\| item;/);
  assert.match(appJs, /handleEl:\s*dragHandleEl,/);
  assert.match(appJs, /pointerId:\s*e\.pointerId,/);
  assert.match(appJs, /dragHandleEl\.setPointerCapture\(e\.pointerId\)/);
  assert.match(appJs, /async function finishPageChipDrag\(\)/);
  assert.match(appJs, /let requiresOpenTabsRebuild = true;/);
  assert.match(appJs, /requiresOpenTabsRebuild = false;/);
  assert.match(appJs, /clearPageChipDragState\(\{ removeNode: requiresOpenTabsRebuild \}\)/);
  assert.match(appJs, /if \(!requiresOpenTabsRebuild\) \{[\s\S]*finish-local-reorder-commit[\s\S]*await syncChromeTabGroupsWithoutImportEcho\(\);/);
  assert.match(appJs, /document\.addEventListener\('pointercancel', async \(e\) => \{/);
  assert.match(appJs, /function startPageChipDragVisuals\(\)/);
  assert.match(appJs, /pageChipDragState\.lastResolvedDropTarget = \{/);
  assert.match(appJs, /const stickyTarget = pageChipDragState\.lastResolvedDropTarget;/);
  assert.match(appJs, /create-group-save-group-order/);
  assert.match(appJs, /disableChromeTabGroupsImportModeForLocalEdits\(\);[\s\S]*changedGroupKeys\.add\(sourceGroupKey\);/);
  assert.match(appJs, /buildPersistentGroupOrderWithInsertedGroup\(createdGroupKey,\s*\{/);
  assert.match(appJs, /await persistGroupOrder\(nextGroupOrder\);/);
  assert.match(appJs, /if \(!movedGroup\.targetWasManualGroup\) \{[\s\S]*buildPersistentGroupOrderReplacingKey\(movedGroup\.groupKey, targetGroupKey\)/);
  assert.match(appJs, /const clampedPoint = clampPageChipClientPoint\(clientX, clientY\);/);
  assert.match(appJs, /if \(!pageChipDragState\.moved\) \{[\s\S]*const distance = Math\.hypot\(e\.clientX - pageChipDragState\.x, e\.clientY - pageChipDragState\.y\);[\s\S]*if \(distance >= 4\) \{/);
  assert.match(appJs, /updateDraggedPageChipPosition\(e\.clientX, e\.clientY\);[\s\S]*syncPageChipDropTarget\(e\.clientX, e\.clientY\);/);
  assert.match(appJs, /clearPageChipDragState\(\{ removeNode: moved \}\)/);
  assert.match(appJs, /let suppressPageChipClickUntil = 0;/);
  assert.match(appJs, /if \(Date\.now\(\) < suppressPageChipClickUntil\) return;/);
  assert.match(appJs, /suppressPageChipClickUntil = Date\.now\(\) \+ 250;/);
  assert.match(appJs, /tabs:\s*getOrderedUniqueTabsForGroup\(group\)/);
  assert.doesNotMatch(drawerJs, /data-drag-handle="saved"/);
  assert.match(drawerJs, /data-drag-handle="todo"/);
  assert.match(drawerJs, /data-drag-handle="todo"[\s\S]*M8 6h\.01M8 12h\.01M8 18h\.01M16 6h\.01M16 12h\.01M16 18h\.01/);
  assert.doesNotMatch(drawerJs, /title="Drag to reorder"/);
  assert.match(css, /\.drawer-reorder-handle\s*\{/);
  assert.match(css, /\.todo-reorder-handle\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;/);
  assert.match(css, /\.page-chip > \.chip-reorder-handle\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;/);
  assert.match(css, /\.chip-reorder-handle\s*\{[\s\S]*opacity:\s*1;[\s\S]*border:\s*1px solid/);
  assert.match(css, /\.drawer-reorder-placeholder\s*\{/);
  assert.match(css, /body\.page-chip-list-dragging\s*\{/);
  assert.match(css, /body\.page-chip-drag-armed,\s*body\.page-chip-drag-armed \*\s*\{/);
  assert.match(css, /\.mission-drop-new-group-slot\s*\{/);
  assert.match(css, /\.mission-drop-new-group-line\s*\{/);
  assert.doesNotMatch(css, /\.page-chip-drag-debug\s*\{/);
  assert.match(css, /\.page-chip\.is-dragging\s*\{/);
  assert.match(css, /\.chip-reorder-placeholder\s*\{/);
  assert.match(css, /\.mission-card\.is-drop-target\s*\{/);
  assert.doesNotMatch(css, /\.deferred-item\.is-dragging/);
  assert.match(css, /\.todo-item\.is-dragging\s*\{/);
  assert.match(css, /\.chip-reorder-handle\s*\{[\s\S]*color:\s*color-mix\(in srgb, var\(--ink\) 84%, var\(--muted\) 16%\);/);
  assert.match(css, /\.drawer-reorder-handle\s*\{[\s\S]*border:\s*none;[\s\S]*background:\s*transparent;[\s\S]*color:\s*color-mix\(in srgb, var\(--ink\) 86%, var\(--muted\) 14%\);/);
});

test('manual groups expose an inline rename button with pencil styling', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(appJs, /data-action="rename-session-group"/);
  assert.match(appJs, /data-group-key="\$\{runtimeEscapeHtmlAttribute \? runtimeEscapeHtmlAttribute\(group\.domain\)/);
  assert.match(appJs, /runtimeT \? runtimeT\('renameGroup'\) : 'Rename group'/);
  assert.match(appJs, /function openGroupRenameEditor\(groupKey, manualGroupId = ''\)/);
  assert.match(appJs, /function submitGroupRenameEditor\(\)/);
  assert.match(appJs, /class="mission-rename-form"/);
  assert.match(appJs, /data-group-rename-input="/);
  assert.match(appJs, /if \(action === 'rename-session-group'\) \{[\s\S]*openGroupRenameEditor\(groupKey, manualGroupId\);[\s\S]*return;/);
  assert.match(appJs, /document\.addEventListener\('pointerdown', \(e\) => \{[\s\S]*if \(!groupRenameEditorState\) return;[\s\S]*void submitGroupRenameEditor\(\);/);
  assert.match(appJs, /document\.addEventListener\('focusout', \(e\) => \{[\s\S]*const renameInput = e\.target\.closest\('\.mission-rename-input'\);[\s\S]*void submitGroupRenameEditor\(\);/);
  assert.match(appJs, /loadGroupLabelOverrides/);
  assert.match(appJs, /saveGroupLabelOverrides/);
  assert.match(css, /\.mission-title-wrap\s*\{/);
  assert.match(css, /\.mission-rename-trigger\s*\{[\s\S]*cursor:\s*pointer;/);
  assert.match(css, /\.mission-rename-form\s*\{[\s\S]*min-width:\s*min\(520px,\s*100%\);/);
  assert.match(css, /\.mission-rename-input\s*\{[\s\S]*min-width:\s*280px;[\s\S]*height:\s*38px;/);
  assert.doesNotMatch(css, /\.mission-rename-actions\s*\{/);
  assert.doesNotMatch(css, /\.mission-rename-action\.is-primary\s*\{/);
  assert.doesNotMatch(css, /\.mission-rename-btn\s*\{/);
  assert.match(appJs, /class="mission-rename-trigger"/);
});

test('saved-for-later trigger and bookmark artwork are removed', () => {
  assert.doesNotMatch(html, /id="deferredTrigger"/);
  assert.doesNotMatch(html, /M17\.25 6\.75v13\.22/);
});

test('collapsed drawer triggers stay icon-only', () => {
  assert.doesNotMatch(appJs, /deferredTriggerCount/);
  assert.doesNotMatch(appJs, /if \(totalCount === 0\) \{[\s\S]*trigger\.style\.display = 'none';/);
});

test('todo trigger icon uses the checklist artwork', () => {
  assert.match(html, /id="todoTrigger"[\s\S]*M288\.384 173\.488a94\.208 94\.208 0 0 1 93\.392-81\.488/);
  assert.match(html, /id="todoTrigger"[\s\S]*M926\.624 660\.752a32 32 0 0 1 0 45\.248/);
});

test('todo archive supports deleting single items and clearing archived todos', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  assert.doesNotMatch(drawerJs, /restore-deferred/);
  assert.doesNotMatch(appJs, /reopenSavedTab\(restored\.url\)/);
  assert.doesNotMatch(drawerJs, /delete-archive-item/);
  assert.doesNotMatch(appJs, /clear-archive/);
  assert.match(appJs, /clear-todo-archive/);
  assert.match(html, /class="archive-header-row"/);
  assert.doesNotMatch(html, /id="clearArchiveBtn"/);
  assert.match(html, /id="clearTodoArchiveBtn"/);
  assert.doesNotMatch(drawerJs, /archive-actions/);
});

test('deferred trigger position is persisted separately from drawer open state', () => {
  assert.match(drawerJs, /const DEFERRED_TRIGGER_POSITION_KEY = 'deferredTriggerPosition'/);
  assert.match(drawerJs, /saveDeferredTriggerPosition/);
});

test('deferred trigger supports vertical drag positioning', () => {
  assert.match(appJs, /deferredTriggerDragState/);
  assert.match(appJs, /e\.target\.closest\('\.deferred-trigger'\)/);
  assert.match(appJs, /triggerStack\.style\.top = `\$\{nextTop}px`/);
});

test('drawer and search controls expose stronger accessibility semantics', () => {
  assert.match(html, /id="drawerColumn"[\s\S]*role="dialog"[\s\S]*aria-label="Todos"[\s\S]*tabindex="-1"/);
  assert.doesNotMatch(html, /role="tablist" aria-label="Drawer views"/);
  assert.doesNotMatch(html, /id="savedSearchToggle"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="savedSearchWrap"/);
  assert.match(html, /id="todoSearchToggle"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="todoSearchWrap"/);
  assert.doesNotMatch(html, /type="search"[\s\S]*id="savedSearchInput"[\s\S]*aria-label="Search saved pages"/);
  assert.match(html, /type="search"[\s\S]*id="todoSearchInput"[\s\S]*aria-label="Search todos"/);
});

test('drawer lives outside workspace pages so todos are global across pages', () => {
  const homeStart = html.indexOf('<main class="workspace-page is-active" id="homePage"');
  const homeEnd = html.indexOf('</main>', homeStart);
  const savedStart = html.indexOf('<main class="workspace-page" id="savedTabsPage"');
  const savedEnd = html.indexOf('</main>', savedStart);
  const drawerIndex = html.indexOf('id="drawerColumn"');
  const triggerIndex = html.indexOf('id="drawerTriggerStack"');

  assert.ok(homeStart >= 0 && homeEnd > homeStart);
  assert.ok(savedStart >= 0 && savedEnd > savedStart);
  assert.ok(drawerIndex > homeEnd && drawerIndex > savedEnd);
  assert.ok(triggerIndex > homeEnd && triggerIndex > savedEnd);
});

test('active todos expose edit and delete controls in list and detail views', () => {
  assert.match(drawerJs, /data-action="edit-todo"[\s\S]*data-todo-id="\$\{todo\.id\}"/);
  assert.match(drawerJs, /data-action="delete-todo"[\s\S]*data-todo-id="\$\{todo\.id\}"/);
  assert.match(drawerJs, /function renderTodoDetail\(todo\)[\s\S]*data-action="edit-todo"[\s\S]*data-action="delete-todo"/);
  assert.match(drawerJs, /class="todo-action-btn todo-edit"/);
  assert.match(drawerJs, /class="todo-action-btn todo-delete"/);
  assert.match(appJs, /if \(action === 'edit-todo'\)/);
  assert.match(appJs, /if \(action === 'delete-todo'\)/);
});

test('todos use an inline editor panel instead of browser prompts', () => {
  assert.match(drawerJs, /let todoEditorState = createTodoEditorState\(\);/);
  assert.match(drawerJs, /function renderTodoEditor\(\)/);
  assert.match(drawerJs, /id="todoEditorView"/);
  assert.match(drawerJs, /name="title"[\s\S]*class="todo-editor-input"/);
  assert.match(drawerJs, /name="description"[\s\S]*class="todo-editor-input todo-editor-textarea"/);
  assert.match(drawerJs, /data-action="submit-todo-editor"/);
  assert.match(drawerJs, /data-action="cancel-todo-editor"/);
  assert.match(appJs, /if \(action === 'create-todo'\) \{[\s\S]*openTodoEditor\(\{ mode: 'create'/);
  assert.match(appJs, /if \(action === 'edit-todo'\) \{[\s\S]*openTodoEditor\(\{[\s\S]*mode: 'edit'/);
  assert.match(appJs, /if \(action === 'submit-todo-editor'\)/);
  assert.match(appJs, /if \(action === 'update-todo-editor-field'\)/);
  assert.doesNotMatch(appJs, /window\.prompt\(runtimeT \? runtimeT\('promptTodoTitle'\)/);
});

test('interactive controls keep button semantics and reduced-motion support', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(themeJs, /class="quick-shortcut-open" type="button"/);
  assert.match(themeJs, /class="quick-shortcut-remove" type="button"/);
  assert.match(themeJs, /aria-pressed="\$\{themePreferences\.paletteId === id\}"/);
  assert.match(themeJs, /aria-pressed="\$\{themePreferences\.mode === id\}"/);
  assert.match(themeJs, /function prefersReducedMotion\(\)/);
  assert.match(appJs, /behavior:\s*prefersReducedMotion\(\) \? 'auto' : 'smooth'/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit, minmax\(128px, 1fr\)\);/);
});

test('drawer detail escapes todo title and description before injecting HTML', () => {
  assert.match(drawerJs, /<h3>\$\{drawerEscapeHtml \? drawerEscapeHtml\(todo\.title\) : todo\.title\}<\/h3>/);
  assert.match(drawerJs, /drawerEscapeHtml \? drawerEscapeHtml\(todo\.description \|\| 'Add a note when this task needs more context\.'\) : \(todo\.description \|\| 'Add a note when this task needs more context\.'\)/);
});

test('theme state uses separate mode and palette preferences', () => {
  assert.match(themeJs, /mode:\s*'system'/);
  assert.match(themeJs, /paletteId:\s*'paper'/);
  assert.match(themeJs, /savedSessionRestoreMode:\s*'new-window'/);
  assert.match(themeJs, /savedSessionNavDisplayMode:\s*'name'/);
  assert.doesNotMatch(themeJs, /themePreferences = \{[\s\S]*themeId:/);
  assert.match(themeJs, /resolvedTone/);
  assert.match(themeJs, /theme-tone-dark/);
  assert.match(themeJs, /theme-tone-light/);
  assert.match(appJs, /themeModeSystem/);
  assert.match(appJs, /themeModeLight/);
  assert.match(appJs, /themeModeDark/);
});

test('saved session restore supports both current-window and new-window modes', () => {
  assert.match(runtimeJs, /const restoreMode = runtimeGetSavedSessionRestoreMode \? runtimeGetSavedSessionRestoreMode\(\) : 'new-window';/);
  assert.match(runtimeJs, /if \(restoreMode === 'current-window'\)/);
  assert.match(runtimeJs, /async function openSavedTabsInCurrentWindow\(tabs = \[\]\)/);
  assert.match(runtimeJs, /await chrome\.tabs\.create\(\{\s*windowId: currentWindowId,\s*url: firstTab\.url,\s*active: true,\s*\}\)/);
  assert.match(runtimeJs, /await chrome\.windows\.create\(\{\s*url: firstTab\.url,\s*focused: true,\s*\}\)/);
  assert.match(runtimeJs, /async function restoreSavedTabToBrowser\(tabUrl\)/);
  assert.match(runtimeJs, /const \{ windowId \} = await openSavedTabsInCurrentWindow\(\[\{ url: tabUrl \}]\);/);
  assert.match(sessionManagerJs, /runtime\.restoreSavedTabToBrowser/);
});

test('saved tabs top nav supports icon and name display modes', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(sessionManagerJs, /const navDisplayMode = getSavedSessionNavDisplayModeValue\(\);/);
  assert.match(sessionManagerJs, /if \(navDisplayMode === 'name'\)/);
  assert.match(sessionManagerJs, /class="group-nav-button saved-session-nav-button is-name-mode"/);
  assert.match(sessionManagerJs, /<span class="saved-session-nav-label"/);
  assert.match(sessionManagerJs, /data-action="change-saved-session-nav-display-mode"/);
  assert.match(css, /\.saved-session-nav-button\.is-name-mode/);
  assert.match(css, /\.saved-session-nav-label/);
  assert.match(css, /\.saved-session-nav-button\.is-name-mode\s*\{[\s\S]*max-width:/);
  assert.match(css, /\.saved-session-nav-label\s*\{[\s\S]*white-space:\s*nowrap;[\s\S]*text-overflow:\s*ellipsis;/);
});

test('quick shortcuts always open a new active tab from the dashboard and popup', () => {
  assert.match(runtimeJs, /async function openOrFocusUrl\(url\)\s*\{\s*if \(!url\) return false;\s*await chrome\.tabs\.create\(\{\s*url,\s*active:\s*true\s*\}\);\s*return true;\s*\}/);
  assert.match(popupJs, /async function openPopupUrl\(url\)\s*\{\s*if \(!url\) return;\s*await chrome\.tabs\.create\(\{\s*url,\s*active:\s*true\s*\}\);\s*window\.close\(\);\s*\}/);
  assert.doesNotMatch(popupJs, /async function findTabByUrl\(/);
  assert.match(runtimeJs, /const fallbackUrl = `https:\/\/www\.google\.com\/search\?q=\$\{encodeURIComponent\(text\)\}`;\s*await navigateCurrentTabToUrl\(fallbackUrl\);/);
});

test('keyboard focus receives explicit visible treatment', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /--focus-ring:/);
  assert.match(css, /:is\([\s\S]*\.quick-shortcut-open,[\s\S]*\.theme-option,[\s\S]*\.todo-main[\s\S]*\):focus-visible/);
  assert.match(css, /outline:\s*2px solid var\(--focus-ring\);/);
  assert.match(css, /\.header-search-input:focus-visible\s*\{[\s\S]*outline:\s*none;[\s\S]*box-shadow:\s*none;/);
});

test('drawer tab hover and todo title typography stay aligned with theme system', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /--drawer-tab-idle:/);
  assert.match(css, /--drawer-tab-hover:/);
  assert.match(css, /\.drawer-title-btn\s*\{[\s\S]*color:\s*var\(--drawer-tab-idle\);[\s\S]*text-decoration-color:\s*transparent;/);
  assert.match(css, /\.drawer-title-btn\.is-active,\s*\.drawer-title-btn\[aria-selected="true"\]\s*\{[\s\S]*color:\s*var\(--ink\);/);
  assert.match(css, /\.drawer-title-btn:not\(\.is-active\):hover,\s*\.drawer-title-btn\[aria-selected="false"\]:hover\s*\{[\s\S]*color:\s*var\(--drawer-tab-hover\);/);
  assert.match(css, /\.drawer-title-btn:not\(\.is-active\):active,\s*\.drawer-title-btn\[aria-selected="false"\]:active\s*\{[\s\S]*color:\s*var\(--drawer-tab-pressed\);/);
  assert.match(css, /\.todo-title\s*\{[\s\S]*font-weight:\s*400;[\s\S]*line-height:\s*1\.45;/);
});

test('dynamic animation styles are generated by JavaScript instead of hardcoded CSS', () => {
  // Verify that hardcoded nth-child selectors are removed from CSS
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  
  // Should NOT have hardcoded mission-card nth-child rules
  assert.doesNotMatch(css, /\.active-section\.missions\.mission-card:nth-child\(\d+\)/);
  assert.doesNotMatch(css, /\.abandoned-section\.missions\.mission-card:nth-child\(\d+\)/);
  assert.doesNotMatch(css, /\.deferred-list\.deferred-item:nth-child\(\d+\)/);
  
  // Should have the dynamic injection function in JS
  assert.match(appJs, /function injectDynamicAnimationStyles\(\)/);
  assert.match(appJs, /document\.getElementById\('dynamic-animation-styles'\)/);
  assert.match(appJs, /createElement\('style'\)/);
  assert.match(appJs, /MAX_STAGGER_COUNT = 10/);
  assert.match(appJs, /STAGGER_INCREMENT = 0\.05/);
  assert.match(appJs, /i <= MAX_STAGGER_COUNT/);
  assert.match(appJs, /\.toFixed\(2\)/);
  assert.match(appJs, /body\.\$\{ENTRY_ANIMATIONS_CLASS\} \.active-section \.missions \.mission-card:nth-child\(\$\{i\}\)/);
  assert.match(appJs, /body\.\$\{ENTRY_ANIMATIONS_CLASS\} \.abandoned-section \.missions \.mission-card:nth-child\(\$\{i\}\)/);
  assert.match(appJs, /injectDynamicAnimationStyles\(\);/);
  assert.match(appJs, /primeEntryAnimations\(\);/);
  assert.match(appJs, /document\.addEventListener\('pointerdown', disableEntryAnimations, \{ capture: true, passive: true \}\)/);
  assert.match(css, /body\.entry-animations-enabled header\s*\{[\s\S]*animation:\s*fadeUp\s+0\.5s\s+ease\s+both;[\s\S]*\}/);
});

test('dashboard auto-refreshes when tabs change via background message', () => {
  const bgJs = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  
  // Background should broadcast tab changes via chrome.runtime.sendMessage
  // (the dashboard is an extension page, NOT a content script — sendMessage
  // to a content script would always fail with "Receiving end does not exist").
  assert.match(bgJs, /notifyTabHarborPages/);
  assert.match(bgJs, /chrome\.runtime\.sendMessage/);
  assert.doesNotMatch(bgJs, /chrome\.tabs\.sendMessage/);
  assert.match(bgJs, /action:\s*["']tabs-changed["']/);
  assert.match(bgJs, /triggerTabId/);
  assert.match(bgJs, /source:\s*["']tabs\.onCreated["']/);
  assert.match(bgJs, /source:\s*["']tabs\.onUpdated["']/);
  assert.match(bgJs, /chrome\.tabs\.onCreated\.addListener/);
  assert.match(bgJs, /chrome\.tabs\.onRemoved\.addListener/);
  
  // Dashboard should listen for messages and refresh
  assert.match(appJs, /setupTabChangeListener/);
  assert.match(appJs, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(appJs, /message\.action === 'tabs-changed'/);
  assert.match(appJs, /shouldSkipStartupTabChange\(message\)/);
  assert.match(appJs, /initializeDashboardRuntime[\s\S]*window\.__suppressAutoRefreshUntil = Math\.max\([\s\S]*Date\.now\(\) \+ 2000/);
  assert.match(appJs, /dashboardStartupTabChangeIgnoreUntil/);
  assert.match(appJs, /currentDashboardTabId/);
  assert.match(appJs, /setTimeout[\s\S]*renderDashboard/);
  assert.match(appJs, /__tabRefreshTimeout/);
});

test('closing duplicate Tab Harbor tabs rerenders without dropping chrome tab group mode', () => {
  assert.match(
    runtimeJs,
    /if \(action === 'close-tabout-dupes'\) \{[\s\S]*window\.__suppressAutoRefreshUntil = Date\.now\(\) \+ 2000;[\s\S]*await closeTabOutDupes\(\);[\s\S]*await renderDashboard\(\);[\s\S]*window\.__suppressAutoRefreshUntil = 0;[\s\S]*updateBackToTopVisibility\(\);/
  );
});

test('chrome tab group mode stays active while the toggle is on', () => {
  assert.match(
    runtimeJs,
    /async function applyChromeTabGroupsToggle\(nextEnabled\) \{[\s\S]*chromeTabGroupsEnabled = enable;[\s\S]*if \(typeof setImportMode === 'function'\) setImportMode\(importedCount > 0\);[\s\S]*await renderDashboard\(\);/
  );
  assert.doesNotMatch(
    runtimeJs,
    /applyChromeTabGroupsToggle[\s\S]*setImportMode\(false\)/
  );
  assert.doesNotMatch(
    runtimeJs,
    /scheduleChromeTabGroupsImport[\s\S]*setImportMode\(false\)/
  );
  assert.doesNotMatch(
    runtimeJs,
    /initializeDashboardRuntime[\s\S]*setImportMode\(false\)/
  );
});

test('discard tab supports per-chip, group-level, and global sleep-all with gated visibility', () => {
  assert.match(runtimeJs, /async function discardTab\(tabId\)\s*\{[\s\S]*chrome\.tabs\.discard\(/);
  assert.match(runtimeJs, /data-action="discard-tab"/);
  assert.match(runtimeJs, /data-action="sleep-domain-tabs"/);
  assert.match(runtimeJs, /data-action="sleep-all-open-tabs"/);
  assert.match(runtimeJs, /page-chip--discarded/);
  assert.match(runtimeJs, /if \(action === 'discard-tab'\)\s*\{[\s\S]*await fetchOpenTabs\(\);[\s\S]*await renderDashboard\(\);/);
  assert.match(runtimeJs, /if \(action === 'sleep-domain-tabs'\)\s*\{[\s\S]*await fetchOpenTabs\(\);[\s\S]*await renderDashboard\(\);/);

  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /\.chip-discard:hover\s*\{[\s\S]*color:\s*var\(--muted\);/);
  assert.match(css, /\.page-chip--discarded\s*\{[\s\S]*opacity:\s*0\.6;/);
  assert.match(css, /\.page-chip--discarded\s\.chip-text\s*\{[\s\S]*text-decoration:\s*line-through;/);
});

test('theme menu keeps chrome tab groups above hitokoto and uses left-aligned toggles', () => {
  assert.match(
    runtimeJs,
    /<label class="theme-menu-toggle-label theme-menu-toggle-button-row">[\s\S]*data-action="toggle-chrome-tab-groups"[\s\S]*theme-menu-label theme-menu-toggle-text[\s\S]*Chrome tab groups[\s\S]*<\/label>[\s\S]*<label class="theme-menu-toggle-label theme-menu-toggle-button-row">[\s\S]*data-action="toggle-hitokoto"[\s\S]*theme-menu-label theme-menu-toggle-text[\s\S]*一言/
  );

  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /\.theme-menu-toggle-text\s*\{[\s\S]*padding-top:\s*0;[\s\S]*flex:\s*1 1 auto;/);
  assert.match(css, /\.theme-menu-toggle-button-row\s*\{[\s\S]*cursor:\s*default;/);
});

test('hitokoto uses cached text and refreshes in the background without blocking dashboard render', () => {
  assert.match(runtimeJs, /const HITOKOTO_CACHE_KEY = 'hitokotoCache';/);
  assert.match(runtimeJs, /function renderCachedHitokoto\(/);
  assert.match(runtimeJs, /function refreshHitokotoInBackground\(/);
  assert.match(runtimeJs, /function warmHitokotoCacheInBackground\(/);
  assert.match(runtimeJs, /renderCachedHitokoto\(hitokotoTextEl, hitokotoFromEl\);[\s\S]*void warmHitokotoCacheInBackground\(\);/);

  const renderStaticDashboardBody = runtimeJs.match(
    /async function renderStaticDashboard\(\) \{([\s\S]*?)\n\}\n\nasync function renderDashboard/
  )?.[1] || '';
  assert.doesNotMatch(renderStaticDashboardBody, /await fetchHitokoto/);
  assert.doesNotMatch(renderStaticDashboardBody, /refreshHitokotoInBackground/);
});
