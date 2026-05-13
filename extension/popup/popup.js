'use strict';

const popupTheme = globalThis.TabOutThemeControls || {};
const popupIcons = globalThis.TabOutIconUtils || {};
const popupSessionGroups = globalThis.TabOutSessionGroups || {};
const popupGroupOrder = globalThis.TabOutGroupOrder || {};
const popupI18n = globalThis.TabHarborI18n || {};

const SESSION_GROUPS_KEY = 'sessionGroups';
const GROUP_ORDER_KEY = 'groupOrder';
const GROUP_TAB_ORDER_KEY = 'groupTabOrder';

const popupState = {
  view: 'shortcuts',
  openTabs: [],
  quickShortcuts: [],
  tabGroups: [],
  sessionGroups: { groups: [], assignments: {} },
  groupOrder: { sessionOrder: [], pinnedOrder: [], pinEnabled: false },
  groupTabOrder: {},
};

// Test exposure
globalThis.popupState = popupState;
globalThis.buildPopupTabGroups = buildPopupTabGroups;
globalThis.getGroupDisplayLabel = getGroupDisplayLabel;
globalThis.escapeAttr = escapeAttr;
globalThis.getTabLabel = getTabLabel;
globalThis.isLandingPage = isLandingPage;
globalThis.matchCustomGroup = matchCustomGroup;
globalThis.renderShortcutCard = renderShortcutCard;
globalThis.renderTabGroup = renderTabGroup;
globalThis.renderGroupNav = renderGroupNav;
globalThis._resetPopupState = () => {
  popupState.openTabs = [];
  popupState.tabGroups = [];
  popupState.sessionGroups = { groups: [], assignments: {} };
  popupState.groupOrder = { sessionOrder: [], pinnedOrder: [], pinEnabled: false };
  popupState.groupTabOrder = {};
  popupState.quickShortcuts = [];
};
globalThis._skipLoadPopupState = false;
globalThis._popupIcons = popupIcons;

const POPUP_REFRESH_KEYS = new Set([
  'quickShortcuts',
  'sessionGroups',
  'groupOrder',
  'groupTabOrder',
  'themePreferences',
  'languagePreference',
]);

let popupRefreshTimer = null;
let popupRefreshInFlight = null;
let popupRefreshQueued = false;

function escapeAttr(value = '') {
  return popupIcons.escapeHtmlAttribute ? popupIcons.escapeHtmlAttribute(value) : String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


function getTabHostname(tab) {
  try {
    if (tab?.url?.startsWith('file://')) return 'local-files';
    return new URL(tab?.url || '').hostname || '';
  } catch {
    return '';
  }
}

function getTabLabel(tab) {
  const title = cleanTitle(
    smartTitle(stripTitleNoise(tab.title || ''), tab.url || ''),
    getTabHostname(tab)
  );
  if (title) return title;

  try {
    return friendlyDomain(new URL(tab.url).hostname) || tab.url;
  } catch {
    return tab.url || 'Tab';
  }
}

function getTabOrderTokens(tab) {
  const tokens = [];
  if (tab?.id != null) tokens.push(String(tab.id));
  if (tab?.url) tokens.push(String(tab.url));
  return [...new Set(tokens.filter(Boolean))];
}

const filterTabs = popupTheme.filterRealTabs || (tabs => Array.isArray(tabs) ? tabs : []);

function getLandingPatterns() {
  const base = [
    { hostname: 'mail.google.com', test: (_p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
  ];
  const local = typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : [];
  return [...base, ...local];
}

function isLandingPage(url) {
  try {
    const parsed = new URL(url);
    return getLandingPatterns().some(p => {
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

function getCustomGroups() {
  return typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];
}

function matchCustomGroup(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return null;
    return getCustomGroups().find(r => {
      const hostMatch = r.hostname
        ? parsed.hostname === r.hostname
        : r.hostnameEndsWith
          ? parsed.hostname.endsWith(r.hostnameEndsWith)
          : false;
      if (!hostMatch) return false;
      if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
      return true;
    }) || null;
  } catch { return null; }
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

function reorderGroupTabsByStoredUrls(tabs, groupKey) {
  const orderIds = popupState.groupTabOrder[String(groupKey)] || [];
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
  return reorderGroupTabsByStoredUrls(tabs, group?.domain);
}

async function loadPopupState() {
  if (globalThis._skipLoadPopupState) return;
  const shortcutsGetter = popupTheme.getQuickShortcuts;
  if (typeof shortcutsGetter === 'function') {
    popupState.quickShortcuts = await shortcutsGetter();
  }

  const [tabs, tabGroups, sgResult, goResult, groupTabOrderResult] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    chrome.storage.local.get(SESSION_GROUPS_KEY),
    chrome.storage.local.get(GROUP_ORDER_KEY),
    chrome.storage.local.get(GROUP_TAB_ORDER_KEY),
  ]);

  popupState.openTabs = filterTabs(tabs).map(tab => ({
    id: tab.id,
    url: tab.url || '',
    title: tab.title || '',
    favIconUrl: tab.favIconUrl || '',
    windowId: tab.windowId,
    active: Boolean(tab.active),
    groupId: tab.groupId,
  }));

  popupState.tabGroups = Array.isArray(tabGroups)
    ? tabGroups
        .map(group => ({
          id: group.id,
          title: group.title || '',
          color: group.color || '',
          collapsed: Boolean(group.collapsed),
          tabs: popupState.openTabs.filter(tab => tab.groupId === group.id),
        }))
        .filter(group => group.tabs.length > 0)
    : [];

  const normalizeFn = popupSessionGroups.normalizeSessionGroups;
  popupState.sessionGroups = normalizeFn ? normalizeFn(sgResult[SESSION_GROUPS_KEY]) : { groups: [], assignments: {} };

  const normalizeOrderFn = popupGroupOrder.normalizeGroupOrderState;
  popupState.groupOrder = normalizeOrderFn ? normalizeOrderFn(goResult[GROUP_ORDER_KEY]) : { sessionOrder: [], pinnedOrder: [], pinEnabled: false };
  popupState.groupTabOrder = normalizeGroupTabOrderState(groupTabOrderResult[GROUP_TAB_ORDER_KEY]);
}

function buildPopupTabGroups() {
  const { openTabs, sessionGroups, groupOrder } = popupState;

  const sessionGroupMap = Object.fromEntries(
    sessionGroups.groups.map(group => [
      group.id,
      { domain: `__session_group__:${group.id}`, label: group.name, tabs: [], kind: 'session', manualGroupId: group.id },
    ])
  );

  const groupMap = {};
  const landingTabs = [];

  for (const tab of openTabs) {
    const assignedGroupId = sessionGroups.assignments[String(tab.id)];
    if (assignedGroupId && sessionGroupMap[assignedGroupId]) {
      sessionGroupMap[assignedGroupId].tabs.push(tab);
      continue;
    }

    if (isLandingPage(tab.url)) {
      landingTabs.push(tab);
      continue;
    }

    const customRule = matchCustomGroup(tab.url);
    if (customRule) {
      const key = customRule.groupKey;
      if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [], kind: 'custom' };
      groupMap[key].tabs.push(tab);
      continue;
    }

    let hostname;
    try {
      hostname = tab.url.startsWith('file://') ? 'local-files' : new URL(tab.url).hostname;
    } catch {
      continue;
    }
    if (!hostname) continue;

    if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, label: hostname, tabs: [], kind: 'domain' };
    groupMap[hostname].tabs.push(tab);
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', label: '__landing-pages__', tabs: landingTabs, kind: 'landing' };
  }

  const landingHostnames = new Set(getLandingPatterns().map(p => p.hostname).filter(Boolean));
  const landingSuffixes = getLandingPatterns().map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }

  const sessionGroupsList = Object.values(sessionGroupMap).filter(g => g.tabs.length > 0);
  const automaticGroups = Object.values(groupMap);

  const sortedAutomatic = automaticGroups.sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;
    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;
    return b.tabs.length - a.tabs.length;
  });

  const applyOrderFn = popupGroupOrder.applyGroupOrder;
  const orderedManual = applyOrderFn ? applyOrderFn(sessionGroupsList, groupOrder) : sessionGroupsList;
  const orderedAuto = applyOrderFn ? applyOrderFn(sortedAutomatic, groupOrder) : sortedAutomatic;

  return [...orderedManual, ...orderedAuto];
}

function renderPopupShortcuts() {
  const listEl = document.getElementById('popupShortcutsList');
  const emptyEl = document.getElementById('popupShortcutsEmpty');
  if (!listEl || !emptyEl) return;

  listEl.classList.add('is-entering');
  listEl.innerHTML = popupState.quickShortcuts.length
    ? popupState.quickShortcuts.map((s, i) => renderShortcutCard(s, i)).join('')
    : '';
  emptyEl.hidden = popupState.quickShortcuts.length > 0;

  requestAnimationFrame(() => requestAnimationFrame(() => listEl.classList.add('is-ready')));
}

function renderShortcutCard(shortcut, index) {
  const label = shortcut.label || shortcut.url;
  const iconKind = String(shortcut.iconKind || '');
  const iconData = popupIcons.getIconSources ? popupIcons.getIconSources({ url: shortcut.url, favIconUrl: iconKind === 'image' ? shortcut.icon : '' }, 32) : { sources: [], hostname: '' };
  const safeUrl = escapeAttr(shortcut.url);
  const safeLabel = escapeAttr(label);
  const primaryIconUrl = iconKind === 'image'
    ? shortcut.icon
    : iconKind === 'svg'
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shortcut.icon || '')}`
      : iconKind === 'glyph'
        ? ''
        : (iconData.sources?.[0] || '');
  const glyph = iconKind === 'glyph' ? shortcut.icon : '';
  const fallbackLabel = popupIcons.getFallbackLabel ? popupIcons.getFallbackLabel(label, iconData.hostname) : label.slice(0, 1).toUpperCase();

  return `
    <div class="quick-shortcut-card popup-shortcut-card" style="--s:${index}">
      <button class="quick-shortcut-open" type="button" data-action="open-popup-url" data-url="${safeUrl}" aria-label="${safeLabel}">
        <span class="quick-shortcut-icon-wrap">
          ${primaryIconUrl ? `<img class="quick-shortcut-icon${iconKind === 'image' ? ' quick-shortcut-icon-custom' : ''}" src="${primaryIconUrl}" alt="" draggable="false">` : ''}
          ${glyph ? `<span class="quick-shortcut-custom-glyph" aria-hidden="true">${glyph}</span>` : ''}
          <span class="quick-shortcut-fallback"${primaryIconUrl || glyph ? ' style="display:none"' : ''}>${fallbackLabel}</span>
        </span>
        <span class="quick-shortcut-label">${safeLabel}</span>
      </button>
    </div>
  `;
}

function getGroupDisplayLabel(group) {
  const i18n = globalThis.TabHarborI18n || {};
  const t = i18n.t ? (key => i18n.t(key)) : (key => key);
  switch (group.kind) {
    case 'landing':   return t('homepagesLabel');
    case 'session':   return group.label;
    case 'chrome-group': return group.label;
    case 'ungrouped': return t('ungroupedLabel');
    default:          return friendlyDomain(group.domain) || group.domain;
  }
}

function renderGroupNav(group, index) {
  const label = getGroupDisplayLabel(group);
  const iconData = popupIcons.getGroupIcon ? popupIcons.getGroupIcon(group, label, 32) : { src: '', fallbackLabel: label.slice(0, 2).toUpperCase() };
  const fallbackLabel = escapeAttr(iconData.fallbackLabel || label.slice(0, 2).toUpperCase());
  const fallbackSrc = escapeAttr(iconData.fallbackSrc || '');
  return `
    <button class="group-nav-button" type="button" data-action="jump-popup-group" data-group-id="${escapeAttr(group.domain)}" aria-label="${escapeAttr(label)}" style="--s:${index}">
      ${iconData.src ? `<img class="group-nav-icon" src="${escapeAttr(iconData.src)}" alt="" draggable="false" data-fallback-src="${fallbackSrc}">` : ''}
      <span class="group-nav-fallback"${iconData.src ? ' style="display:none"' : ''}>${fallbackLabel}</span>
    </button>
  `;
}

function renderTabGroup(group, groupIndex) {
  const label = getGroupDisplayLabel(group);
  const rows = getOrderedUniqueTabsForGroup(group).map((tab, tabIndex) => {
    const title = getTabLabel(tab);
    const safeUrl = escapeAttr(tab.url || '');
    const safeTitle = escapeAttr(title);
    const iconData = popupIcons.getIconSources ? popupIcons.getIconSources(tab, 16) : { sources: [], hostname: '' };
    const fallbackLabel = popupIcons.getFallbackLabel ? popupIcons.getFallbackLabel(title, iconData.hostname) : '?';
    const closeLabel = popupI18n.t ? popupI18n.t('closeTabButton') : 'Close';
    return `
      <div class="popup-tab-row" style="--g:${groupIndex};--r:${tabIndex}" data-action="open-popup-url" data-url="${safeUrl}" data-tab-id="${tab.id}">
        ${iconData.sources?.[0] ? `<img class="popup-tab-favicon" src="${escapeAttr(iconData.sources[0])}" alt="">` : `<span class="popup-tab-favicon-fallback">${escapeAttr(fallbackLabel)}</span>`}
        <span class="popup-tab-title" title="${safeTitle}">${safeTitle}</span>
        <button class="popup-tab-close-btn" type="button" data-action="close-popup-tab" data-tab-id="${tab.id}" aria-label="${escapeAttr(closeLabel)}" title="${escapeAttr(closeLabel)}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    `;
  }).join('');

  return `
    <section class="popup-tab-group" data-group-id="${escapeAttr(group.domain)}" style="--s:${groupIndex}">
      <h1 class="popup-tab-group-title">${escapeAttr(label)}</h1>
      <div class="popup-tab-group-list">${rows}</div>
    </section>
  `;
}

function renderPopupTabs() {
  const listEl = document.getElementById('popupTabsList');
  const navEl = document.getElementById('popupGroupNav');
  const emptyEl = document.getElementById('popupTabsEmpty');
  if (!listEl || !navEl || !emptyEl) return;

  const tabs = popupState.openTabs;

  if (tabs.length === 0) {
    if (navEl.innerHTML !== '') navEl.innerHTML = '';
    if (listEl.innerHTML !== '') listEl.innerHTML = '';
    if (emptyEl.hidden !== false) emptyEl.hidden = false;
    return;
  }

  const groups = buildPopupTabGroups();
  const newNavHtml = groups.map((g, i) => renderGroupNav(g, i)).join('');
  const newListHtml = groups.map((g, i) => renderTabGroup(g, i)).join('');

  if (navEl.innerHTML !== newNavHtml) {
    navEl.innerHTML = newNavHtml;
    navEl.classList.add('is-entering');
  }
  if (listEl.innerHTML !== newListHtml) {
    listEl.innerHTML = newListHtml;
    listEl.classList.add('is-entering');
  }
  if (emptyEl.hidden !== true) {
    emptyEl.hidden = true;
  }

  requestAnimationFrame(() => requestAnimationFrame(() => {
    navEl.classList.add('is-ready');
    listEl.classList.add('is-ready');
  }));
}

function syncPopupView() {
  const shortcutsTab = document.getElementById('popupShortcutsTab');
  const tabsTab = document.getElementById('popupTabsTab');
  const shortcutsPanel = document.getElementById('popupShortcutsPanel');
  const tabsPanel = document.getElementById('popupTabsPanel');
  const shortcutsList = document.getElementById('popupShortcutsList');
  const tabsList = document.getElementById('popupTabsList');
  const navEl = document.getElementById('popupGroupNav');
  const isTabs = popupState.view === 'tabs';

  shortcutsTab?.classList.toggle('is-active', !isTabs);
  shortcutsTab?.setAttribute('aria-selected', String(!isTabs));
  tabsTab?.classList.toggle('is-active', isTabs);
  tabsTab?.setAttribute('aria-selected', String(isTabs));

  // Strip animation classes so they replay on re-enter
  [shortcutsList, tabsList, navEl].forEach(el => {
    el?.classList.remove('is-ready', 'is-entering');
  });

  if (shortcutsPanel) {
    shortcutsPanel.hidden = isTabs;
    shortcutsPanel.classList.toggle('is-active', !isTabs);
  }
  if (tabsPanel) {
    tabsPanel.hidden = !isTabs;
    tabsPanel.classList.toggle('is-active', isTabs);
  }

  // Re-trigger animation for the incoming active panel
  if (!isTabs && shortcutsList) {
    requestAnimationFrame(() => requestAnimationFrame(() => shortcutsList.classList.add('is-ready')));
  } else if (isTabs && tabsList && navEl) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      tabsList.classList.add('is-ready');
      navEl.classList.add('is-ready');
    }));
  }
}

async function openPopupUrl(url) {
  if (!url) return;
  const existing = await findTabByUrl(url);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}

async function findTabByUrl(url) {
  try {
    const tabs = await chrome.tabs.query({ url });
    return tabs[0] || null;
  } catch {
    return null;
  }
}

async function openPopupTab(tabId, fallbackUrl = '') {
  if (!tabId) {
    await openPopupUrl(fallbackUrl);
    return;
  }

  let targetTab = null;
  try {
    targetTab = await chrome.tabs.get(tabId);
  } catch {
    targetTab = null;
  }

  if (!targetTab?.id) {
    await openPopupUrl(fallbackUrl);
    return;
  }

  let currentWindow = null;
  try {
    currentWindow = await chrome.windows.getCurrent();
  } catch {
    currentWindow = null;
  }

  if (currentWindow?.id && targetTab.windowId && targetTab.windowId !== currentWindow.id) {
    const targetUrl = targetTab.url || fallbackUrl;
    if (!targetUrl) return;
    await chrome.tabs.create({
      windowId: currentWindow.id,
      url: targetUrl,
      active: true,
    });
    window.close();
    return;
  }

  await chrome.tabs.update(targetTab.id, { active: true });
  window.close();
}

function handlePopupGroupNavImageError(event) {
  const target = event.target;
  if (!(target instanceof HTMLImageElement)) return;
  if (!target.classList.contains('group-nav-icon')) return;

  const fallbackSrc = String(target.dataset.fallbackSrc || '').trim();
  if (fallbackSrc && target.dataset.fallbackApplied !== 'true') {
    target.dataset.fallbackApplied = 'true';
    target.src = fallbackSrc;
    return;
  }

  target.style.display = 'none';
  const sibling = target.nextElementSibling;
  if (sibling?.classList.contains('group-nav-fallback')) {
    sibling.style.display = '';
  }
}

async function refreshPopup() {
  if (popupTheme.loadThemePreferences) {
    await popupTheme.loadThemePreferences();
  }
  await loadPopupState();
  renderPopupShortcuts();
  renderPopupTabs();
  syncPopupView();
  if (popupI18n.applyDomTranslations) {
    popupI18n.applyDomTranslations(document.querySelector('.popup-app'));
  }
  if (popupTheme.syncPopupTheme) {
    popupTheme.syncPopupTheme(document);
  }
}

function schedulePopupRefresh(delay = 120) {
  if (popupRefreshTimer) {
    clearTimeout(popupRefreshTimer);
  }
  popupRefreshTimer = setTimeout(() => {
    popupRefreshTimer = null;
    void refreshPopupSafely();
  }, delay);
}

async function refreshPopupSafely() {
  if (popupRefreshInFlight) {
    popupRefreshQueued = true;
    return popupRefreshInFlight;
  }

  popupRefreshInFlight = (async () => {
    try {
      await refreshPopup();
    } finally {
      popupRefreshInFlight = null;
      if (popupRefreshQueued) {
        popupRefreshQueued = false;
        schedulePopupRefresh(0);
      }
    }
  })();

  return popupRefreshInFlight;
}

function handlePopupStorageChanged(changes, areaName) {
  if (areaName !== 'local') return;
  const hasRelevantChange = Object.keys(changes || {}).some(key => POPUP_REFRESH_KEYS.has(key));
  if (!hasRelevantChange) return;
  schedulePopupRefresh();
}

function registerPopupAutoRefresh() {
  const schedule = () => schedulePopupRefresh();

  chrome.tabs?.onActivated?.addListener(schedule);
  chrome.tabs?.onAttached?.addListener(schedule);
  chrome.tabs?.onCreated?.addListener(schedule);
  chrome.tabs?.onDetached?.addListener(schedule);
  chrome.tabs?.onMoved?.addListener(schedule);
  chrome.tabs?.onRemoved?.addListener(schedule);
  chrome.tabs?.onUpdated?.addListener(schedule);
  chrome.tabGroups?.onCreated?.addListener(schedule);
  chrome.tabGroups?.onRemoved?.addListener(schedule);
  chrome.tabGroups?.onUpdated?.addListener(schedule);
  chrome.storage?.onChanged?.addListener(handlePopupStorageChanged);
  chrome.runtime?.onMessage?.addListener(message => {
    if (message?.action === 'tabs-changed') {
      schedule();
    }
  });
}

function initializePopup() {
  document.addEventListener('error', handlePopupGroupNavImageError, true);
  registerPopupAutoRefresh();

  document.addEventListener('click', async e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    if (action === 'switch-popup-view') {
      popupState.view = actionEl.dataset.view === 'tabs' ? 'tabs' : 'shortcuts';
      syncPopupView();
      return;
    }

    if (action === 'refresh-popup') {
      await refreshPopup();
      return;
    }

    if (action === 'close-popup-tab') {
      e.preventDefault();
      const tabId = Number(actionEl.dataset.tabId);
      if (!tabId) return;
      actionEl.classList.add('is-loading');
      try {
        await chrome.tabs.remove(tabId);
        // Suppress auto-refresh scheduled by tabs.onRemoved to avoid double render
        if (popupRefreshTimer) {
          clearTimeout(popupRefreshTimer);
          popupRefreshTimer = null;
        }
        popupRefreshQueued = false;
        // Wait for any already-running refresh to settle before re-rendering
        if (popupRefreshInFlight) {
          try { await popupRefreshInFlight; } catch { /* swallow */ }
        }
        await refreshPopup();
        // tabs.onActivated (from switching to a new active tab) may have
        // rescheduled a refresh during our await — suppress it
        if (popupRefreshTimer) {
          clearTimeout(popupRefreshTimer);
          popupRefreshTimer = null;
        }
        popupRefreshQueued = false;
      } finally {
        actionEl.classList.remove('is-loading');
      }
      return;
    }

    if (action === 'open-popup-url') {
      e.preventDefault();
      const tabId = Number(actionEl.dataset.tabId);
      if (tabId) {
        await openPopupTab(tabId, actionEl.dataset.url || '');
      } else {
        await openPopupUrl(actionEl.dataset.url || '');
      }
      return;
    }

    if (action === 'jump-popup-group') {
      const groupId = actionEl.dataset.groupId || '';
      const target = document.querySelector(`.popup-tab-group[data-group-id="${CSS.escape(groupId)}"]`);
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });

  refreshPopupSafely()
    .then(() => requestAnimationFrame(() => document.body.classList.add('is-ready')))
    .catch(() => {
      renderPopupShortcuts();
      renderPopupTabs();
      syncPopupView();
      if (popupI18n.applyDomTranslations) {
        popupI18n.applyDomTranslations(document.querySelector('.popup-app'));
      }
      document.body.classList.add('is-ready');
    });
}

initializePopup();
