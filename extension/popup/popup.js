'use strict';

const popupTheme = globalThis.TabOutThemeControls || {};
const popupIcons = globalThis.TabOutIconUtils || {};
const popupSessionGroups = globalThis.TabOutSessionGroups || {};
const popupGroupOrder = globalThis.TabOutGroupOrder || {};
const popupI18n = globalThis.TabHarborI18n || {};

const SESSION_GROUPS_KEY = 'sessionGroups';
const GROUP_ORDER_KEY = 'groupOrder';
const GROUP_TAB_ORDER_KEY = 'groupTabOrder';
const GROUP_LABEL_OVERRIDES_KEY = 'groupLabelOverrides';
const POPUP_VIEW_KEY = 'popupView';
// The dashboard's domain-to-Chrome mirror ids are runtime-only. Popup needs
// the same boundary when deciding whether a tab belongs to a user-created
// native group card or to an automatic domain card.
const CHROME_GROUP_SESSION_MAP_KEY = 'chromeTabGroupsSessionMap';

const popupState = {
  view: 'shortcuts',
  openTabs: [],
  quickShortcuts: [],
  sessionGroups: { groups: [], assignments: {} },
  groupOrder: { sessionOrder: [], pinnedOrder: [], pinEnabled: false },
  groupTabOrder: {},
  groupLabelOverrides: {},
  chromeGroupsById: {},
  managedChromeGroupIds: new Set(),
};

// Resolve the remembered view synchronously (localStorage is sync) so the
// very first paint shows the correct panel. chrome.storage is async and only
// reconciles later; without this the popup flashes the default shortcuts
// view for the first frame(s) when the remembered view is tabs.
try {
  popupState.view = localStorage.getItem(POPUP_VIEW_KEY) === 'tabs' ? 'tabs' : 'shortcuts';
} catch {
  popupState.view = 'shortcuts';
}

// Test exposure
globalThis.popupState = popupState;
globalThis.loadPopupView = loadPopupView;
globalThis.loadPopupState = loadPopupState;
globalThis.renderPopupShortcuts = renderPopupShortcuts;
globalThis.renderPopupTabs = renderPopupTabs;
globalThis.syncPopupView = syncPopupView;
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
  popupState.view = 'shortcuts';
  popupState.openTabs = [];
  popupState.sessionGroups = { groups: [], assignments: {} };
  popupState.groupOrder = { sessionOrder: [], pinnedOrder: [], pinEnabled: false };
  popupState.groupTabOrder = {};
  popupState.groupLabelOverrides = {};
  popupState.chromeGroupsById = {};
  popupState.managedChromeGroupIds = new Set();
  popupState.quickShortcuts = [];
};
globalThis._skipLoadPopupState = false;
globalThis._popupIcons = popupIcons;

const POPUP_REFRESH_KEYS = new Set([
  'quickShortcuts',
  'sessionGroups',
  'groupOrder',
  'groupTabOrder',
  'groupLabelOverrides',
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
    // Gmail inbox/sent/search views are content tabs; other Gmail views
    // (label views, bare front page) stay in the landing group.
    { hostname: 'mail.google.com', test: (_p, h) =>
        !h.includes('#inbox') && !h.includes('#sent') && !h.includes('#search/') },
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
  // Reorder by the stored per-group order; every tab stays visible so
  // duplicate URLs can be seen and closed, matching the dashboard.
  return reorderGroupTabsByStoredUrls(tabs, group?.domain);
}

async function loadPopupView() {
  try {
    const stored = await chrome.storage.local.get(POPUP_VIEW_KEY);
    popupState.view = stored[POPUP_VIEW_KEY] === 'tabs' ? 'tabs' : 'shortcuts';
    // Keep the synchronous first-frame mirror in sync: chrome.storage is the
    // source of truth (config import/export round-trips through it), so when
    // it differs from the localStorage mirror, persist the resolved view back
    // instead of letting the two diverge permanently (which would flash the
    // stale first frame on every popup open).
    try {
      localStorage.setItem(POPUP_VIEW_KEY, popupState.view);
    } catch { /* storage may be unavailable; chrome.storage remains authoritative */ }
  } catch {
    popupState.view = 'shortcuts';
  }
  return popupState.view;
}

function normalizeGroupLabelOverrides(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, label]) => typeof label === 'string' && label.trim())
      .map(([key, label]) => [String(key), label.trim()])
  );
}

async function loadPopupState() {
  if (globalThis._skipLoadPopupState) return;
  const shortcutsGetter = popupTheme.getQuickShortcuts;
  const popupUrlUtils = globalThis.TabHarborTabUrlUtils || {};
  const parseSuspendedUrl = popupUrlUtils.parseSuspendedTabUrl || (() => ({ isSuspended: false, originalUrl: '', title: '' }));
  const canonicalizeUrl = popupUrlUtils.getCanonicalTabUrl || (url => String(url || ''));

  const sessionStorage = chrome?.storage?.session;
  const [quickShortcuts, tabs, sgResult, goResult, groupTabOrderResult, labelOverridesResult, chromeGroups, chromeGroupMapResult] = await Promise.all([
    typeof shortcutsGetter === 'function' ? shortcutsGetter() : Promise.resolve([]),
    chrome.tabs.query({}),
    chrome.storage.local.get(SESSION_GROUPS_KEY),
    chrome.storage.local.get(GROUP_ORDER_KEY),
    chrome.storage.local.get(GROUP_TAB_ORDER_KEY),
    chrome.storage.local.get(GROUP_LABEL_OVERRIDES_KEY),
    typeof chrome.tabGroups?.query === 'function' ? chrome.tabGroups.query({}).catch(() => []) : Promise.resolve([]),
    typeof sessionStorage?.get === 'function'
      ? sessionStorage.get(CHROME_GROUP_SESSION_MAP_KEY).catch(() => ({}))
      : Promise.resolve({}),
  ]);

  popupState.quickShortcuts = Array.isArray(quickShortcuts) ? quickShortcuts : [];
  // Suspended tabs (chrome-extension://…/suspended.html#uri=…) stay visible
  // and group under their original URL, matching the dashboard — but only
  // when the original URL exists. Uri-less suspended pages fall through to
  // the normal filter and are dropped like other internal pages.
  popupState.openTabs = tabs.filter(tab => {
    const rawUrl = String(tab.url || '').trim();
    if (!rawUrl) return true;
    const suspended = parseSuspendedUrl(rawUrl);
    if (suspended.isSuspended && suspended.originalUrl) return true;
    return filterTabs([tab]).length > 0;
  }).map(tab => {
    const rawUrl = String(tab.url || '').trim();
    const suspended = parseSuspendedUrl(rawUrl);
    return {
      id: tab.id,
      url: canonicalizeUrl(rawUrl),
      title: suspended.title || tab.title || '',
      favIconUrl: tab.favIconUrl || '',
      windowId: tab.windowId,
      index: tab.index,
      active: Boolean(tab.active),
      groupId: tab.groupId,
    };
  });

  popupState.chromeGroupsById = Object.fromEntries((Array.isArray(chromeGroups) ? chromeGroups : [])
    .filter(group => Number.isFinite(Number(group?.id)))
    .map(group => [Number(group.id), group]));
  const storedChromeGroupMap = chromeGroupMapResult?.[CHROME_GROUP_SESSION_MAP_KEY];
  popupState.managedChromeGroupIds = new Set(
    Object.values(storedChromeGroupMap && typeof storedChromeGroupMap === 'object' ? storedChromeGroupMap : {})
      .flatMap(windowMap => Object.values(windowMap && typeof windowMap === 'object' ? windowMap : []))
      .map(Number)
      .filter(Number.isFinite)
  );

  popupState.groupLabelOverrides = normalizeGroupLabelOverrides(labelOverridesResult[GROUP_LABEL_OVERRIDES_KEY]);

  const normalizeFn = popupSessionGroups.normalizeSessionGroups;
  popupState.sessionGroups = normalizeFn ? normalizeFn(sgResult[SESSION_GROUPS_KEY]) : { groups: [], assignments: {} };

  const normalizeOrderFn = popupGroupOrder.normalizeGroupOrderState;
  popupState.groupOrder = normalizeOrderFn ? normalizeOrderFn(goResult[GROUP_ORDER_KEY]) : { sessionOrder: [], pinnedOrder: [], pinEnabled: false };
  popupState.groupTabOrder = normalizeGroupTabOrderState(groupTabOrderResult[GROUP_TAB_ORDER_KEY]);
}

function buildPopupTabGroups() {
  const { openTabs, sessionGroups, groupOrder, chromeGroupsById, managedChromeGroupIds } = popupState;

  const sessionGroupMap = Object.fromEntries(
    sessionGroups.groups.map(group => [
      group.id,
      { domain: `__session_group__:${group.id}`, label: group.name, tabs: [], kind: 'session', manualGroupId: group.id, createdAt: group.createdAt },
    ])
  );

  const groupMap = {};
  const nativeChromeGroupMap = {};
  const landingTabs = [];
  const ungroupedTabs = [];

  for (const tab of openTabs) {
    const nativeGroupId = Number(tab.groupId);
    const nativeChromeGroup = chromeGroupsById[nativeGroupId];
    // A live native group is authoritative for Popup just as it is for the
    // dashboard. Managed mirrors remain domain cards; all other Chrome groups
    // retain their title/color membership instead of being regrouped by URL.
    if (Number.isFinite(nativeGroupId) && nativeGroupId >= 0 && nativeChromeGroup && !managedChromeGroupIds.has(nativeGroupId)) {
      const key = `__chrome_group__:${nativeGroupId}`;
      if (!nativeChromeGroupMap[key]) {
        nativeChromeGroupMap[key] = {
          domain: key,
          label: String(nativeChromeGroup.title || '').trim() || 'Group',
          tabs: [],
          kind: 'chrome-group',
          chromeGroupId: nativeGroupId,
          chromeGroupColor: nativeChromeGroup.color,
          chromePosition: Number.isFinite(Number(tab.index)) ? Number(tab.index) : Number.MAX_SAFE_INTEGER,
        };
      }
      nativeChromeGroupMap[key].tabs.push(tab);
      nativeChromeGroupMap[key].chromePosition = Math.min(
        nativeChromeGroupMap[key].chromePosition,
        Number.isFinite(Number(tab.index)) ? Number(tab.index) : Number.MAX_SAFE_INTEGER
      );
      continue;
    }

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
      ungroupedTabs.push(tab);
      continue;
    }
    if (!hostname) {
      ungroupedTabs.push(tab);
      continue;
    }

    const primaryDomain = popupIcons.getPrimaryDomain ? popupIcons.getPrimaryDomain(hostname) : hostname;
    if (!groupMap[primaryDomain]) groupMap[primaryDomain] = { domain: primaryDomain, label: '', tabs: [], kind: 'domain' };
    groupMap[primaryDomain].tabs.push(tab);
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', label: '__landing-pages__', tabs: landingTabs, kind: 'landing' };
  }

  if (ungroupedTabs.length > 0) {
    groupMap['__ungrouped__'] = { domain: '__ungrouped__', label: '__ungrouped__', tabs: ungroupedTabs, kind: 'ungrouped' };
  }

  // chrome.tabs.query({}) can contain more than one window; keep each native
  // card in its browser-strip order rather than inheriting the global query
  // order or a persisted dashboard order.
  for (const group of Object.values(nativeChromeGroupMap)) {
    group.tabs.sort((a, b) => Number(a.index) - Number(b.index));
  }

  const landingHostnames = new Set(getLandingPatterns().map(p => p.hostname).filter(Boolean));
  const landingSuffixes = getLandingPatterns().map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }

  // Same ordering as the dashboard: oldest session group first, then automatic groups.
  const sessionGroupsList = Object.values(sessionGroupMap)
    .filter(g => g.tabs.length > 0)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const nativeChromeGroups = Object.values(nativeChromeGroupMap)
    .filter(group => group.tabs.length > 0)
    .sort((a, b) => a.chromePosition - b.chromePosition || a.chromeGroupId - b.chromeGroupId);
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
  // Keep user-created native group cards first, matching dashboard grouping;
  // they are session-local and must not be persisted via applyGroupOrder.
  const mergedGroups = [...nativeChromeGroups, ...sessionGroupsList, ...sortedAutomatic];
  return applyOrderFn ? applyOrderFn(mergedGroups, groupOrder) : mergedGroups;
}

let popupShortcutsRenderKey = '';

function renderPopupShortcuts() {
  const listEl = document.getElementById('popupShortcutsList');
  const emptyEl = document.getElementById('popupShortcutsEmpty');
  if (!listEl || !emptyEl) return;

  // Skip re-rendering when neither the shortcuts nor the column setting
  // changed — background tab refreshes must not reset the grid.
  const cols = popupTheme.getQuickShortcutCols ? popupTheme.getQuickShortcutCols() : 'auto';
  const renderKey = `${JSON.stringify(popupState.quickShortcuts)}|${cols}`;
  if (renderKey === popupShortcutsRenderKey) return;
  popupShortcutsRenderKey = renderKey;

  // The dashboard "quick links per row" setting controls the popup grid too.
  listEl.classList.toggle('is-fixed-cols-4', cols === '4');
  listEl.classList.toggle('is-fixed-cols-5', cols === '5');
  listEl.innerHTML = popupState.quickShortcuts.length
    ? popupState.quickShortcuts.map((s, i) => renderShortcutCard(s, i)).join('')
    : '';
  emptyEl.hidden = popupState.quickShortcuts.length > 0;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    listEl.classList.add('is-ready');
  }));
}

function renderShortcutCard(shortcut, index) {
  const label = shortcut.label || shortcut.url;
  const iconKind = String(shortcut.iconKind || '');
  const iconData = popupIcons.getIconSources ? popupIcons.getIconSources({ url: shortcut.url }, 32) : { sources: [], hostname: '' };
  const fallbackLabel = popupIcons.getFallbackLabel ? popupIcons.getFallbackLabel(label, iconData.hostname) : label.slice(0, 1).toUpperCase();
  const safeUrl = escapeAttr(shortcut.url);
  const safeLabel = escapeAttr(label);
  const primaryIconUrl = iconKind === 'image'
    ? shortcut.icon
    : iconKind === 'svg'
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shortcut.icon || '')}`
      : iconKind === 'glyph'
        ? ''
        : (iconData.sources[0] || '');
  const glyph = iconKind === 'glyph' ? shortcut.icon : '';
  const fallbackSources = (iconKind === 'image' || iconKind === 'svg')
    ? iconData.sources
    : iconData.sources.slice(1);
  const fallbackSrc = escapeAttr(fallbackSources[0] || '');
  const fallbackSrcset = fallbackSources.length > 1 ? escapeAttr(JSON.stringify(fallbackSources.slice(1))) : '';

  return `
    <div class="quick-shortcut-card popup-shortcut-card" style="--s:${index}">
      <button class="quick-shortcut-open" type="button" data-action="open-popup-url" data-url="${safeUrl}" aria-label="${safeLabel}">
        <span class="quick-shortcut-icon-wrap">
          ${primaryIconUrl ? `<img class="quick-shortcut-icon${iconKind === 'image' ? ' quick-shortcut-icon-custom' : ''}" src="${primaryIconUrl}" alt="" draggable="false" data-fallback-src="${fallbackSrc}"${fallbackSrcset ? ` data-fallback-srcset="${fallbackSrcset}"` : ''}>` : ''}
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
  if (!group) return 'Group';
  if (popupState.groupLabelOverrides[group.domain]) {
    return popupState.groupLabelOverrides[group.domain];
  }
  switch (group.kind) {
    case 'landing':   return t('homepagesLabel');
    case 'session':   return group.label;
    case 'chrome-group': return group.label;
    case 'ungrouped': return t('ungroupedLabel');
    default:          return group.label || (friendlyDomain(group.domain) || group.domain);
  }
}

function renderGroupNav(group, index) {
  const label = getGroupDisplayLabel(group);
  const iconData = popupIcons.getGroupIcon ? popupIcons.getGroupIcon(group, label, 32) : { src: '', fallbackLabel: label.slice(0, 2).toUpperCase() };
  const fallbackLabel = escapeAttr(iconData.fallbackLabel || label.slice(0, 2).toUpperCase());
  const fallbackSrc = escapeAttr(iconData.fallbackSrc || '');
  const fallbackSrcset = escapeAttr(JSON.stringify(iconData.fallbackSources?.slice(1) || []));
  return `
    <button class="group-nav-button" type="button" data-action="jump-popup-group" data-group-id="${escapeAttr(group.domain)}" aria-label="${escapeAttr(label)}" style="--s:${index}">
      ${iconData.src ? `<img class="group-nav-icon" src="${escapeAttr(iconData.src)}" alt="" draggable="false" data-fallback-src="${fallbackSrc}" data-fallback-srcset="${fallbackSrcset}">` : ''}
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
    const fallbackSrc = escapeAttr(iconData.sources?.[1] || '');
    const fallbackSrcset = iconData.sources?.length > 2 ? escapeAttr(JSON.stringify(iconData.sources.slice(2))) : '';
    const closeLabel = popupI18n.t ? popupI18n.t('closeTabButton') : 'Close';
    return `
      <div class="popup-tab-row" style="--g:${groupIndex};--r:${tabIndex}" data-action="open-popup-url" data-url="${safeUrl}" data-tab-id="${tab.id}">
        ${iconData.sources?.[0] ? `<img class="popup-tab-favicon" src="${escapeAttr(iconData.sources[0])}" alt="" data-fallback-src="${fallbackSrc}"${fallbackSrcset ? ` data-fallback-srcset="${fallbackSrcset}"` : ''}>` : ''}
        <span class="popup-tab-favicon-fallback"${iconData.sources?.[0] ? ' style="display:none"' : ''}>${escapeAttr(fallbackLabel)}</span>
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
  }
  if (listEl.innerHTML !== newListHtml) {
    listEl.innerHTML = newListHtml;
  }
  if (emptyEl.hidden !== true) {
    emptyEl.hidden = true;
  }

  requestAnimationFrame(() => requestAnimationFrame(() => {
    navEl.classList.add('is-ready');
    listEl.classList.add('is-ready');
  }));
}

let lastSyncedPopupView = '';

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

  // Strip animation classes only when the view actually switched, so
  // background refreshes do not replay the entry animation.
  const viewChanged = lastSyncedPopupView !== popupState.view;
  lastSyncedPopupView = popupState.view;
  if (viewChanged) {
    [shortcutsList, tabsList, navEl].forEach(el => {
      el?.classList.remove('is-ready', 'is-entering');
    });
    // Hide the incoming panel until its entry animation starts (re-triggered
    // below), so content painted after a view switch never flashes unstyled.
    if (!isTabs) {
      shortcutsList?.classList.add('is-entering');
    } else {
      tabsList?.classList.add('is-entering');
      navEl?.classList.add('is-entering');
    }
  }

  if (shortcutsPanel) {
    shortcutsPanel.hidden = isTabs;
    shortcutsPanel.classList.toggle('is-active', !isTabs);
  }
  if (tabsPanel) {
    tabsPanel.hidden = !isTabs;
    tabsPanel.classList.toggle('is-active', isTabs);
  }

  // Re-trigger animation for the incoming active panel (skip when the
  // class is already present so background refreshes cause no mutations).
  // is-entering (set above on view switch) stays on while the entrance
  // animation plays; only the same-view sync below clears it.
  if (!isTabs && shortcutsList && !shortcutsList.classList.contains('is-ready')) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      shortcutsList.classList.add('is-ready');
    }));
  } else if (isTabs && tabsList && navEl) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!tabsList.classList.contains('is-ready')) tabsList.classList.add('is-ready');
      if (!navEl.classList.contains('is-ready')) navEl.classList.add('is-ready');
    }));
  }

  // Background refreshes must not replay the entrance animation: the child
  // animations are bound to .is-entering.is-ready, so clearing is-entering
  // here (and on every later same-view sync) keeps replaced content visible.
  if (!viewChanged) {
    [shortcutsList, tabsList, navEl].forEach(el => {
      el?.classList.remove('is-entering');
    });
  }
}

// Popup quick links always open a new active tab, regardless of the
// dashboard "open in current tab" setting: navigating the current tab here
// would replace the real page behind the popup, which is destructive. The
// open-mode toggle (and Ctrl/Shift modifiers) apply to the new-tab page only.
async function openPopupUrl(url) {
  if (!url) return;
  await chrome.tabs.create({ url, active: true });
  window.close();
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
    // Activate the existing tab in its own window instead of duplicating it
    // here — the tabs view exists to avoid opening duplicates. Mirrors the
    // dashboard focus-tab behavior (tabs.update + windows.update).
    try {
      await chrome.tabs.update(targetTab.id, { active: true });
    } catch {
      // The tab closed meanwhile — fall back to opening its URL here.
      const targetUrl = targetTab.url || fallbackUrl;
      if (targetUrl) {
        await chrome.tabs.create({
          windowId: currentWindow.id,
          url: targetUrl,
          active: true,
        });
      }
      window.close();
      return;
    }
    // Activating the tab is the essential step; focusing its window is
    // best-effort — if it fails the tab is already active where it lives.
    await chrome.windows.update(targetTab.windowId, { focused: true }).catch(() => {});
    window.close();
    return;
  }

  await chrome.tabs.update(targetTab.id, { active: true });
  window.close();
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
    } catch (err) {
      // A failed refresh keeps the previous snapshot; surface for debugging.
      console.warn('[tab-harbor popup] refresh failed:', err?.message || err);
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
  registerPopupAutoRefresh();

  const groupNavWrap = document.getElementById('popupGroupNav');
  if (groupNavWrap) {
    // The nav scrollbar is hidden; let the vertical wheel scroll it
    // horizontally — but only when it can actually scroll, so a wheel over
    // a short nav (no overflow) passes through untouched.
    groupNavWrap.addEventListener('wheel', (e) => {
      const list = e.target.closest('.group-nav-list') || groupNavWrap;
      if (list.scrollWidth <= list.clientWidth) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        list.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  document.addEventListener('click', async e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    if (action === 'switch-popup-view') {
      popupState.view = actionEl.dataset.view === 'tabs' ? 'tabs' : 'shortcuts';
      syncPopupView();
      void chrome.storage.local.set({ [POPUP_VIEW_KEY]: popupState.view });
      try { localStorage.setItem(POPUP_VIEW_KEY, popupState.view); } catch { /* storage unavailable */ }
      return;
    }

    if (action === 'refresh-popup') {
      await refreshPopupSafely();
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
        // The safe pipeline keeps the previous snapshot if this refresh fails.
        await refreshPopupSafely();
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
      // A close in flight makes the close button unclickable (pointer-events:
      // none), so a fast second click lands on the row itself — ignore it or
      // the user's "close" intent would re-open the tab.
      const rowEl = actionEl.closest('.popup-tab-row');
      if (rowEl?.querySelector('.popup-tab-close-btn.is-loading')) return;
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

  // Apply the remembered view before the first paint (scripts run during
  // parse, ahead of any frame) so opening on the tabs view never flashes
  // the default shortcuts panel. loadPopupView below reconciles with
  // chrome.storage for imports/exports.
  syncPopupView();

  loadPopupView()
    .then(() => {
      syncPopupView();
      return refreshPopupSafely();
    })
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
