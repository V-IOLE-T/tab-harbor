'use strict';

const popupTheme = globalThis.TabOutThemeControls || {};
const popupIcons = globalThis.TabOutIconUtils || {};
const popupListOrder = globalThis.TabOutListOrder || {};
const popupSessionGroups = globalThis.TabOutSessionGroups || {};
const popupGroupOrder = globalThis.TabOutGroupOrder || {};
const popupI18n = globalThis.TabHarborI18n || {};

const SESSION_GROUPS_KEY = 'sessionGroups';
const GROUP_ORDER_KEY = 'groupOrder';

const popupState = {
  view: 'shortcuts',
  openTabs: [],
  quickShortcuts: [],
  tabGroups: [],
  sessionGroups: { groups: [], assignments: {} },
  groupOrder: { sessionOrder: [], pinnedOrder: [], pinEnabled: false },
};

// Test exposure
globalThis.popupState = popupState;
globalThis.buildPopupTabGroups = buildPopupTabGroups;
globalThis.getGroupDisplayLabel = getGroupDisplayLabel;
globalThis.escapeAttr = escapeAttr;
globalThis.friendlyDomain = friendlyDomain;
globalThis.stripTitleNoise = stripTitleNoise;
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
  popupState.quickShortcuts = [];
};
globalThis._skipLoadPopupState = false;
globalThis._popupIcons = popupIcons;

function escapeAttr(value = '') {
  return popupIcons.escapeHtmlAttribute ? popupIcons.escapeHtmlAttribute(value) : String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function friendlyDomain(domain) {
  return String(domain || '')
    .replace(/^www\./, '')
    .replace(/\./g, ' ')
    .trim();
}

function stripTitleNoise(title) {
  return String(title || '')
    .replace(/\s*[|\-–—]\s*.*$/, '')
    .trim();
}

function getTabLabel(tab) {
  const title = stripTitleNoise(tab.title || '');
  if (title) return title;

  try {
    return friendlyDomain(new URL(tab.url).hostname) || tab.url;
  } catch {
    return tab.url || 'Tab';
  }
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

async function loadPopupState() {
  if (globalThis._skipLoadPopupState) return;
  const shortcutsGetter = popupTheme.getQuickShortcuts;
  if (typeof shortcutsGetter === 'function') {
    popupState.quickShortcuts = await shortcutsGetter();
  }

  const [tabs, tabGroups, sgResult, goResult] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    chrome.storage.local.get(SESSION_GROUPS_KEY),
    chrome.storage.local.get(GROUP_ORDER_KEY),
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
}

function buildPopupTabGroups() {
  const { openTabs, tabGroups, sessionGroups, groupOrder } = popupState;
  const usedTabIds = new Set();

  // Session groups
  const sessionGroupMap = Object.fromEntries(
    sessionGroups.groups.map(group => [
      group.id,
      { domain: `__session_group__:${group.id}`, label: group.name, tabs: [], kind: 'session', manualGroupId: group.id },
    ])
  );

  for (const tab of openTabs) {
    const assignedGroupId = sessionGroups.assignments[String(tab.id)];
    if (assignedGroupId && sessionGroupMap[assignedGroupId]) {
      sessionGroupMap[assignedGroupId].tabs.push(tab);
      usedTabIds.add(tab.id);
    }
  }

  // Domain groups
  const groupMap = {};
  const landingTabs = [];

  for (const tab of openTabs) {
    if (usedTabIds.has(tab.id)) continue;

    if (isLandingPage(tab.url)) {
      landingTabs.push(tab);
      usedTabIds.add(tab.id);
      continue;
    }

    const customRule = matchCustomGroup(tab.url);
    if (customRule) {
      const key = customRule.groupKey;
      if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [], kind: 'custom' };
      groupMap[key].tabs.push(tab);
      usedTabIds.add(tab.id);
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
    usedTabIds.add(tab.id);
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', label: '__landing-pages__', tabs: landingTabs, kind: 'landing' };
  }

  // Chrome tab groups (tabs not yet in any session/domain/custom group)
  const chromeGroupMap = {};
  for (const cg of tabGroups) {
    const cgTabs = cg.tabs.filter(tab => !usedTabIds.has(tab.id));
    if (!cgTabs.length) continue;
    chromeGroupMap[cg.id] = {
      domain: `__chrome_group__:${cg.id}`,
      label: cg.title || `Group ${cg.id}`,
      tabs: cgTabs,
      kind: 'chrome-group',
      color: cg.color,
      collapsed: cg.collapsed,
      chromeGroupId: cg.id,
    };
    cgTabs.forEach(tab => usedTabIds.add(tab.id));
  }

  const landingHostnames = new Set(getLandingPatterns().map(p => p.hostname).filter(Boolean));
  const landingSuffixes = getLandingPatterns().map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }

  const sessionGroupsList = Object.values(sessionGroupMap).filter(g => g.tabs.length > 0);
  const automaticGroups = Object.values(groupMap);
  const chromeGroupsList = Object.values(chromeGroupMap);

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

  let groups = [...orderedManual, ...orderedAuto, ...chromeGroupsList];

  // Ungrouped
  const ungroupedTabs = openTabs.filter(tab => !usedTabIds.has(tab.id));
  if (ungroupedTabs.length > 0) {
    groups.push({ domain: '__ungrouped__', label: popupI18n.t ? popupI18n.t('ungroupedLabel') : 'Ungrouped', tabs: ungroupedTabs, kind: 'ungrouped' });
  }

  return groups;
}

function renderPopupShortcuts() {
  const listEl = document.getElementById('popupShortcutsList');
  const countEl = document.getElementById('popupShortcutsCount');
  const emptyEl = document.getElementById('popupShortcutsEmpty');
  if (!listEl || !countEl || !emptyEl) return;

  countEl.textContent = String(popupState.quickShortcuts.length);
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
  return `
    <button class="group-nav-button" type="button" data-action="jump-popup-group" data-group-id="${escapeAttr(group.domain)}" aria-label="${escapeAttr(label)}" style="--s:${index}">
      ${iconData.src ? `<img class="group-nav-icon" src="${escapeAttr(iconData.src)}" alt="">` : ''}
    </button>
  `;
}

function renderTabGroup(group, groupIndex) {
  const label = getGroupDisplayLabel(group);
  const rows = (group.tabs || []).map((tab, tabIndex) => {
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
        <button class="popup-tab-open-btn" type="button" data-action="close-popup-tab" data-tab-id="${tab.id}">${closeLabel}</button>
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
  const countEl = document.getElementById('popupTabsCount');
  const emptyEl = document.getElementById('popupTabsEmpty');
  if (!listEl || !navEl || !countEl || !emptyEl) return;

  const tabs = popupState.openTabs;
  countEl.textContent = String(tabs.length);

  if (tabs.length === 0) {
    navEl.innerHTML = '';
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }

  const groups = buildPopupTabGroups();
  navEl.innerHTML = groups.map((g, i) => renderGroupNav(g, i)).join('');
  navEl.classList.add('is-entering');
  listEl.innerHTML = groups.map((g, i) => renderTabGroup(g, i)).join('');
  listEl.classList.add('is-entering');
  emptyEl.hidden = true;

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

function initializePopup() {
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
        await refreshPopup();
      } finally {
        actionEl.classList.remove('is-loading');
      }
      return;
    }

    if (action === 'open-popup-url') {
      e.preventDefault();
      const tabId = Number(actionEl.dataset.tabId);
      if (tabId) {
        await chrome.tabs.update(tabId, { active: true });
        window.close();
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

  refreshPopup()
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
