'use strict';

const SAVED_TAB_SESSION_COLLAPSED_KEY = 'savedTabSessionCollapsedState';
const SAVED_TAB_SESSION_ORDER_KEY = 'savedTabSessionOrder';
const sessionDataApi = typeof require === 'function'
  ? require('./tab-sessions.js')
  : (globalThis.TabHarborTabSessions || {});

const {
  buildSessionGroupsFromTabs: sessionManagerBuildSessionGroupsFromTabs,
  createSavedTabSessionFromTab: sessionManagerCreateSavedTabSessionFromTab,
} = sessionDataApi;

function normalizeSavedTabSessionOrder(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(id => String(id || '')).filter(Boolean))];
}

function normalizeSavedTabSessionCollapsedState(input, sessions = []) {
  const sessionIds = new Set(
    (Array.isArray(sessions) ? sessions : [])
      .map(session => String(session?.id || '').trim())
      .filter(Boolean)
  );

  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  return Object.fromEntries(
    Object.entries(input)
      .map(([sessionId, collapsed]) => [String(sessionId || '').trim(), collapsed === true])
      .filter(([sessionId, collapsed]) => sessionId && collapsed && (!sessionIds.size || sessionIds.has(sessionId)))
  );
}

function applySavedTabSessionOrder(sessions = [], orderIds = []) {
  const list = Array.isArray(sessions) ? sessions.slice() : [];
  const normalizedOrder = normalizeSavedTabSessionOrder(orderIds);
  if (!list.length || !normalizedOrder.length) return list;

  const sessionMap = new Map(list.map(session => [String(session?.id || ''), session]));
  const ordered = normalizedOrder.map(id => sessionMap.get(id)).filter(Boolean);
  const seen = new Set(ordered.map(session => String(session?.id || '')));
  const remainder = list.filter(session => !seen.has(String(session?.id || '')));
  return [...ordered, ...remainder];
}

function buildSavedTabSessionOrder(sessions = []) {
  return [...new Set((Array.isArray(sessions) ? sessions : []).map(session => String(session?.id || '')).filter(Boolean))];
}

function buildSavedTabSessionOrderWithInsertedSession(sessions = [], insertedSessionId = '', {
  placement = 'after',
  insertBeforeSessionId = '',
} = {}) {
  const normalizedInsertedId = String(insertedSessionId || '').trim();
  if (!normalizedInsertedId) return buildSavedTabSessionOrder(sessions);

  const currentOrder = buildSavedTabSessionOrder(sessions)
    .filter(id => id !== normalizedInsertedId);
  const normalizedBeforeId = String(insertBeforeSessionId || '').trim();
  if (normalizedBeforeId) {
    const insertIndex = currentOrder.indexOf(normalizedBeforeId);
    if (insertIndex >= 0) {
      currentOrder.splice(insertIndex, 0, normalizedInsertedId);
      return currentOrder;
    }
  }

  if (placement === 'before') {
    currentOrder.unshift(normalizedInsertedId);
    return currentOrder;
  }

  currentOrder.push(normalizedInsertedId);
  return currentOrder;
}

function buildSavedSessionTabToken(sessionId = '', tabIndex = 0) {
  const cleanSessionId = String(sessionId || '').trim();
  const cleanTabIndex = Number(tabIndex);
  if (!cleanSessionId || !Number.isInteger(cleanTabIndex)) return '';
  return `${cleanSessionId}::${cleanTabIndex}`;
}

function parseSavedSessionTabToken(token = '') {
  const raw = String(token || '');
  const separatorIndex = raw.lastIndexOf('::');
  if (separatorIndex <= 0) return null;
  const sessionId = raw.slice(0, separatorIndex).trim();
  const tabIndex = Number(raw.slice(separatorIndex + 2));
  if (!sessionId || !Number.isInteger(tabIndex)) return null;
  return { sessionId, tabIndex };
}

function reorderSavedSessionTabsByTokens(session = {}, orderTokens = []) {
  const tabs = Array.isArray(session?.tabs) ? session.tabs : [];
  const normalizedTokens = [...new Set((Array.isArray(orderTokens) ? orderTokens : []).map(String).filter(Boolean))];
  return normalizedTokens
    .map(token => {
      const parsed = parseSavedSessionTabToken(token);
      if (!parsed || parsed.sessionId !== String(session?.id || '')) return null;
      return tabs[parsed.tabIndex] || null;
    })
    .filter(Boolean);
}

function moveSavedSessionTabsByTokens({
  sourceSession = {},
  targetSession = {},
  sourceOrderTokens = [],
  targetOrderTokens = [],
  draggedToken = '',
} = {}) {
  const draggedMeta = parseSavedSessionTabToken(draggedToken);
  if (!draggedMeta) return { sourceTabs: [], targetTabs: [] };

  const sourceTabs = Array.isArray(sourceSession?.tabs) ? sourceSession.tabs : [];
  const targetTabs = Array.isArray(targetSession?.tabs) ? targetSession.tabs : [];
  const draggedTab = sourceTabs[draggedMeta.tabIndex] || null;
  if (!draggedTab) return { sourceTabs: [], targetTabs: [] };

  const nextSourceTabs = [...new Set((Array.isArray(sourceOrderTokens) ? sourceOrderTokens : []).map(String).filter(Boolean))]
    .map(token => {
      const parsed = parseSavedSessionTabToken(token);
      if (!parsed || parsed.sessionId !== String(sourceSession?.id || '')) return null;
      return sourceTabs[parsed.tabIndex] || null;
    })
    .filter(Boolean);

  const nextTargetTabs = [...new Set((Array.isArray(targetOrderTokens) ? targetOrderTokens : []).map(String).filter(Boolean))]
    .map(token => {
      if (token === draggedToken) return draggedTab;
      const parsed = parseSavedSessionTabToken(token);
      if (!parsed || parsed.sessionId !== String(targetSession?.id || '')) return null;
      return targetTabs[parsed.tabIndex] || null;
    })
    .filter(Boolean);

  return {
    sourceTabs: nextSourceTabs,
    targetTabs: nextTargetTabs,
  };
}

function detachSavedSessionTabToNewSession({
  sessions = [],
  draggedToken = '',
  placement = 'after',
  insertBeforeSessionId = '',
  now = new Date().toISOString(),
} = {}) {
  const draggedMeta = parseSavedSessionTabToken(draggedToken);
  if (!draggedMeta || typeof sessionManagerCreateSavedTabSessionFromTab !== 'function') {
    return {
      sessions: applySavedTabSessionOrder(sessions, buildSavedTabSessionOrder(sessions)),
      orderIds: buildSavedTabSessionOrder(sessions),
      createdSession: null,
      sourceSessionRemoved: false,
    };
  }

  const sourceSession = (Array.isArray(sessions) ? sessions : [])
    .find(session => String(session?.id || '') === draggedMeta.sessionId);
  const draggedTab = sourceSession?.tabs?.[draggedMeta.tabIndex] || null;
  if (!sourceSession || !draggedTab) {
    return {
      sessions: applySavedTabSessionOrder(sessions, buildSavedTabSessionOrder(sessions)),
      orderIds: buildSavedTabSessionOrder(sessions),
      createdSession: null,
      sourceSessionRemoved: false,
    };
  }

  const createdSession = sessionManagerCreateSavedTabSessionFromTab({
    sourceSession,
    tab: draggedTab,
    existingSessions: sessions,
    now,
  });
  const remainingTabs = (sourceSession.tabs || [])
    .filter((_, index) => index !== draggedMeta.tabIndex);
  const sourceSessionRemoved = remainingTabs.length === 0;
  const nextSessions = (Array.isArray(sessions) ? sessions : [])
    .flatMap(session => {
      if (String(session?.id || '') !== draggedMeta.sessionId) return [session];
      if (sourceSessionRemoved) return [];
      return [{
        ...session,
        tabs: remainingTabs,
        groups: typeof sessionManagerBuildSessionGroupsFromTabs === 'function'
          ? sessionManagerBuildSessionGroupsFromTabs(remainingTabs)
          : (session.groups || []),
      }];
    });
  const nextOrder = buildSavedTabSessionOrderWithInsertedSession(nextSessions, createdSession.id, {
    placement,
    insertBeforeSessionId,
  });

  return {
    sessions: applySavedTabSessionOrder([...nextSessions, createdSession], nextOrder),
    orderIds: nextOrder,
    createdSession,
    sourceSessionRemoved,
  };
}

(function attachTabHarborSessionManager(globalScope) {
  const exportsApi = {
    SAVED_TAB_SESSION_COLLAPSED_KEY,
    SAVED_TAB_SESSION_ORDER_KEY,
    normalizeSavedTabSessionOrder,
    normalizeSavedTabSessionCollapsedState,
    applySavedTabSessionOrder,
    buildSavedTabSessionOrder,
    buildSavedTabSessionOrderWithInsertedSession,
    buildSavedSessionTabToken,
    detachSavedSessionTabToNewSession,
    parseSavedSessionTabToken,
    reorderSavedSessionTabsByTokens,
    moveSavedSessionTabsByTokens,
  };

  if (!globalScope?.document || !globalScope?.chrome?.storage?.local) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = exportsApi;
    }
    return;
  }

  const sessionStore = globalScope.TabHarborTabSessions || {};
  const sessionIcons = globalScope.TabOutIconUtils || {};
  const sessionI18n = globalScope.TabHarborI18n || {};

  const {
    addSavedTabSession: managerAddSavedTabSession,
    buildSessionGroupsFromTabs: managerBuildSessionGroupsFromTabs,
    createSavedTabSessionFromTab: managerCreateSavedTabSessionFromTab,
    deleteSavedTabSession: managerDeleteSavedTabSession,
    getSavedTabSessions: managerGetSavedTabSessions,
    renameSavedTabSession: managerRenameSavedTabSession,
    saveSavedTabSessions: managerSaveSavedTabSessions,
    updateSavedTabSessionTabs: managerUpdateSavedTabSessionTabs,
  } = sessionStore;

  const {
    escapeHtml: managerEscapeHtml,
    escapeHtmlAttribute: managerEscapeHtmlAttribute,
    getFallbackLabel: managerGetFallbackLabel,
    getGroupIcon: managerGetGroupIcon,
    getIconSources: managerGetIconSources,
  } = sessionIcons;

  const managerT = sessionI18n.t;
  let sessionManagerPage = 'home';
  let savedSessionOrderState = [];
  let savedSessionRenameState = null;
  let savedSessionSettingsState = null;
  let savedSessionCollapsedState = {};
  let savedSessionTabSuppressClickUntil = 0;
  let draggedSavedSessionId = '';
  let draggedSavedSessionButtonEl = null;
  let savedSessionDragStartPoint = null;
  let savedSessionDragPlaceholderEl = null;
  let savedSessionTabDragState = null;
  let draggedSavedSessionTabRowEl = null;
  let savedSessionNewSessionSlotEl = null;
  let savedSessionTabPlaceholderEl = null;

  const SAVED_SESSION_SETTINGS_ICON = `<svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true"><path d="M416.4 958h191.2V849.7c0-12.7 6.4-25.5 19.1-31.9 31.9-12.7 63.7-31.9 89.2-51 12.7-6.4 25.5-6.4 38.2 0l95.6 57.3 95.6-165.7-95.6-57.3C837 588.5 830.6 575.7 837 563c0-19.1 6.4-31.9 6.4-51s0-31.9-6.4-51c0-12.7 6.4-25.5 12.7-31.9l95.6-57.3-95.6-165.7-95.6 57.3c-12.7 6.4-25.5 6.4-38.2 0-25.5-19.1-57.3-38.2-89.2-51-12.7-12.7-19.1-25.5-19.1-38.2V66H416.4v108.3c0 12.7-6.4 25.5-19.1 31.9-31.9 12.7-63.7 31.9-89.2 51-12.7 6.4-25.5 6.4-38.2 0l-95.6-51-95.6 165.6 95.6 57.3c12.7 6.4 19.1 19.1 12.7 31.9 0 19.1-6.4 31.9-6.4 51s0 31.9 6.4 51c6.4 12.7 0 25.5-12.7 31.9l-95.6 57.3 95.6 165.7 95.6-57.3c12.7-6.4 25.5-6.4 38.2 0 25.5 19.1 57.3 38.2 89.2 51 12.7 6.4 19.1 19.1 19.1 31.9V958z m223 63.7H384.6c-19.1 0-31.9-12.7-31.9-31.9v-121c-25.5-12.7-51-25.5-70.1-38.2l-101.9 63.7c-12.7 6.4-31.9 6.4-44.6-12.7L8.6 658.6c-12.7-19.1-6.4-38.2 12.7-44.6l101.9-63.7v-76.5L21.4 410.1c-19.1-6.4-25.5-25.5-12.7-44.6l127.4-223c6.4-12.7 25.5-19.1 44.6-6.4l101.9 63.7c19.1-12.7 44.6-31.9 70.1-38.2V34.1c0-19.1 12.7-31.9 31.9-31.9h254.9c19.1 0 31.9 12.7 31.9 31.9v121.1c25.5 12.7 51 25.5 70.1 38.2l101.9-63.7c12.7-6.4 31.9-6.4 44.6 12.7l127.4 223c12.7 19.1 6.4 38.2-12.7 44.6l-101.9 63.7v76.5l101.9 63.7c12.7 6.4 19.1 25.5 12.7 44.6L888 881.5c-6.4 12.7-25.5 19.1-44.6 12.7l-101.9-63.7c-19.1 12.7-44.6 31.9-70.1 38.2v121.1c-0.1 19.2-12.8 31.9-32 31.9zM512 703.2c-108.3 0-191.2-82.8-191.2-191.2S403.7 320.8 512 320.8 703.2 403.7 703.2 512 620.3 703.2 512 703.2z m0-318.6c-70.1 0-127.4 57.3-127.4 127.4S441.9 639.4 512 639.4 639.4 582.1 639.4 512 582.1 384.6 512 384.6z"></path></svg>`;
  const SAVED_SESSION_RESTORE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true"><path d="M538.67041016 118.74658203c-17.34257813 6.10400391-33.02050781 20.80986328-39.68085938 37.04238281-2.77382813 7.07519531-3.19042969 10.96171875-3.88476562 36.3515625l-0.83144532 28.44140625-4.85595703 0.97119141c-2.63671875 0.55371094-14.84560547 2.35722656-27.05361328 4.021875-44.12021484 5.96689453-83.9390625 18.03691406-123.48017578 37.321875-38.01621094 18.59326172-68.4 39.95859375-96.56367187 67.98339844-20.671875 20.53388672-31.21787109 33.29824219-46.61806641 56.60595703-27.19160156 41.06865234-44.11845703 87.40722656-51.88886719 141.79394531-2.35722656 16.65-2.08037109 65.20693359 0.55634766 83.9381836 10.95996094 79.22021484 47.17089844 151.228125 102.3899414 203.81044921 40.92890625 38.98564453 86.01855469 66.73535156 137.21484375 84.07617188 28.996875 9.85166016 43.70361328 9.29707031 57.16230469-2.63671875 10.95996094-9.57304687 14.15039063-26.91386719 7.35205078-40.37255859-4.29960937-8.46298828-8.32324219-11.37568359-29.13398437-21.78105469-45.78486328-22.61601563-77.00273438-52.72294922-95.87109375-92.54179688-16.23339844-34.40830078-19.56269531-72.69960937-9.43417969-111.54638672 3.60703125-14.01328125 13.31806641-35.93408203 21.64394531-48.97617187 27.46845703-42.87128906 78.52587891-75.47519531 136.51962891-87.12861328 7.63154297-1.52753906 15.81679687-2.91357422 18.31376953-3.19306641l4.71796875-0.41484375-0.13974609 24.27890625c-0.13710937 33.71484375 3.46992187 45.23027344 18.86835937 59.79726563 18.17578125 17.20371094 45.64775391 21.09023438 70.20527344 9.71191406 4.71445312-2.08037109 17.06572266-9.84902344 27.33134765-17.06572266 10.265625-7.35292969 25.38896484-17.89541016 33.57421875-23.44746093 29.96806641-20.80986328 79.77568359-55.49589844 98.50605469-68.53710938 24.83525391-17.48144531 62.01738281-43.14726563 86.43515625-60.075 31.63271484-21.6421875 37.87646484-26.91474609 43.28876953-36.07207031 10.82197266-18.17402344 11.23857422-38.29306641 1.52490235-57.71601563-6.10400391-12.07001953-15.26044922-20.11816406-46.89316406-41.4852539-15.67792969-10.54072266-43.42763672-29.41171875-61.74052735-41.89833985C614.70019531 136.64375 594.86064453 123.46191406 585.84130859 119.99462891c-12.34775391-4.71796875-35.65458984-5.41230469-47.17089843-1.24804688z m38.15332031 66.31611328c6.52148438 4.44111328 45.78486328 31.078125 87.40722656 59.38066406 41.62236328 28.16542969 93.51123047 63.26542969 115.57089844 78.11191407 21.92080078 14.70849609 39.81796875 27.33398438 39.81796875 27.88769531 0 0.55371094-2.35722656 2.49609375-5.1328125 4.29960937-6.24375 3.74677734-95.03789063 65.34931641-195.76230469 135.55019532-45.23115234 31.49472656-58.41210938 40.37255859-59.66015625 40.37255859-0.83144531 0-1.52578125-12.48310547-1.94238281-32.32441406l-0.41484375-32.1890625-4.57910156-9.29619141c-5.27167969-10.68134766-12.48662109-17.75830078-23.86230469-23.16796875-6.66123047-3.19042969-9.29707031-3.60791016-21.50507813-3.46992187-32.74365234 0.27949219-80.33203125 12.20976562-115.71064453 29.13574218-20.25703125 9.71191406-29.27373047 15.12333984-48.14296875 29.13574219C277.70117187 537.18945313 241.34960937 616.1328125 248.00732422 695.07529297c0.83408203 9.99052734 2.35722656 21.92167969 3.46992187 26.49990234 0.97119141 4.43935547 1.66289062 8.46386719 1.38603516 8.74072266-0.83144531 0.83320313-11.23857422-16.23251953-18.59150391-30.38378906-24.14091797-46.75517578-34.96113281-99.34013672-30.9383789-149.42373047 2.08212891-24.69550781 4.43847656-38.15332031 9.71191406-56.60771485 16.65-56.8828125 52.72207031-108.77080078 100.86591797-144.98261718 48.14208984-36.21269531 99.61435547-55.77539063 170.92792969-65.06982422 33.43535156-4.44111328 42.03808594-7.49179688 53.13779297-18.45351563 14.15214844-14.15039063 18.03603516-27.60908203 18.03603515-62.98857422 0-24.834375 0.69433594-27.60820312 6.24199219-26.08242187 1.52753906 0.41660156 8.04814453 4.30048828 14.56875 8.73984375z"></path></svg>`;

  function getDashboardRuntime() {
    return globalScope.TabHarborDashboardRuntime || {};
  }

  function getThemeControls() {
    return globalScope.TabOutThemeControls || {};
  }

  function getSavedSessionRestoreModeValue() {
    const themeControls = getThemeControls();
    return typeof themeControls.getSavedSessionRestoreMode === 'function'
      ? themeControls.getSavedSessionRestoreMode()
      : 'new-window';
  }

  function getSavedSessionNavDisplayModeValue() {
    const themeControls = getThemeControls();
    return typeof themeControls.getSavedSessionNavDisplayMode === 'function'
      ? themeControls.getSavedSessionNavDisplayMode()
      : 'name';
  }

  async function persistSavedSessionRestoreMode(mode) {
    const themeControls = getThemeControls();
    if (typeof themeControls.saveSavedSessionRestoreMode === 'function') {
      return themeControls.saveSavedSessionRestoreMode(mode);
    }
    return null;
  }

  async function persistSavedSessionNavDisplayMode(mode) {
    const themeControls = getThemeControls();
    if (typeof themeControls.saveSavedSessionNavDisplayMode === 'function') {
      return themeControls.saveSavedSessionNavDisplayMode(mode);
    }
    return null;
  }

  function escapeText(value = '') {
    return managerEscapeHtml ? managerEscapeHtml(value) : String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(value = '') {
    return managerEscapeHtmlAttribute ? managerEscapeHtmlAttribute(value) : String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatRelativeTime(dateValue = '') {
    if (typeof timeAgo === 'function') return timeAgo(dateValue);
    return String(dateValue || '');
  }

  function getSessionTabWord(count) {
    return count === 1
      ? (managerT ? managerT('tabsWordSingular') : 'tab')
      : (managerT ? managerT('tabsWordPlural') : 'tabs');
  }

  function showManagerToast(message) {
    if (typeof showToast === 'function') showToast(message);
  }

  function getErrorToast() {
    return managerT ? managerT('toastSessionActionFailed') : 'Could not update saved tabs';
  }

  function resolvePageFromHash() {
    return globalScope.location?.hash === '#saved-tabs' ? 'saved-tabs' : 'home';
  }

  async function setWorkspacePage(page, { updateHash = true, render = true } = {}) {
    sessionManagerPage = page === 'saved-tabs' ? 'saved-tabs' : 'home';

    document.querySelectorAll('[data-workspace-page]').forEach(panel => {
      const isActive = panel.dataset.workspacePage === sessionManagerPage;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });

    document.querySelectorAll('[data-action="switch-workspace-page"]').forEach(button => {
      const isActive = button.dataset.page === sessionManagerPage;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    document.body.classList.toggle('showing-saved-tabs-page', sessionManagerPage === 'saved-tabs');

    if (updateHash) {
      const nextHash = sessionManagerPage === 'saved-tabs' ? '#saved-tabs' : '#home';
      if (globalScope.location && globalScope.location.hash !== nextHash) {
        globalScope.history.replaceState(null, '', nextHash);
      }
    }

    if (!render) return;

    if (sessionManagerPage === 'saved-tabs') {
      await renderSavedTabsPage();
      return;
    }

    const runtime = getDashboardRuntime();
    if (typeof runtime.renderDashboard === 'function') {
      await runtime.renderDashboard();
    }
  }

  function getSessionSummary(session) {
    const tabCount = Array.isArray(session?.tabs) ? session.tabs.length : 0;
    const tabWord = getSessionTabWord(tabCount);
    return `${tabCount} ${tabWord} saved ${formatRelativeTime(session.savedAt)}`;
  }

  function renderSavedSessionTabRows(session) {
    const tabs = Array.isArray(session?.tabs) ? session.tabs : [];
    if (!tabs.length) return '';

    return `
      <div class="saved-session-tab-list" data-saved-session-tab-list="${escapeAttr(session.id)}">
        ${tabs.map((tab, index) => {
          const tabToken = buildSavedSessionTabToken(session.id, index);
          const iconData = managerGetIconSources ? managerGetIconSources(tab, 16) : { hostname: '', sources: [] };
          const fallbackLabel = managerGetFallbackLabel ? managerGetFallbackLabel(tab.title || tab.url, iconData.hostname) : '?';
          const faviconUrl = iconData.sources?.[0] || '';
          const fallbackUrl = iconData.sources?.[1] || '';
          const fallbackSrcset = escapeAttr(JSON.stringify(iconData.sources?.slice(2) || []));
          const label = tab.title || tab.url || 'Tab';
          const safeLabel = escapeText(label);
          const safeUrl = escapeText(tab.url || '');
          const safeTooltip = escapeAttr(label);
          return `
            <div class="saved-session-tab-row" data-action="restore-saved-session-tab" data-saved-session-id="${escapeAttr(session.id)}" data-saved-tab-index="${index}" data-saved-tab-token="${escapeAttr(tabToken)}" data-session-id="${escapeAttr(session.id)}" data-tab-index="${index}">
              <button class="drawer-reorder-handle saved-session-reorder-handle" type="button" data-saved-tab-drag-handle="tab" aria-label="${managerT ? managerT('dragReorderTab') : 'Drag to reorder tab'}">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" /></svg>
              </button>
              <div class="saved-session-tab-main">
                ${faviconUrl ? `<img src="${escapeAttr(faviconUrl)}" alt="" data-fallback-src="${escapeAttr(fallbackUrl)}" data-fallback-srcset="${fallbackSrcset}">` : ''}
                <span class="inline-favicon-fallback"${faviconUrl ? ' style="display:none"' : ''}>${escapeText(fallbackLabel)}</span>
                <span class="saved-session-tab-title" title="${safeTooltip}">${safeLabel}</span>
              </div>
              <button class="chip-action chip-close saved-session-tab-delete" type="button" data-action="delete-saved-session-tab" data-session-id="${escapeAttr(session.id)}" data-tab-index="${index}" aria-label="${managerT ? managerT('deleteSessionButton') : 'Delete session'}" data-tooltip="${managerT ? managerT('deleteSessionButton') : 'Delete session'}">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>`;
        }).join('')}
      </div>`;
  }

  function renderSessionTabPreview(session) {
    return renderSavedSessionTabRows(session);
  }

  function openSavedSessionRenameEditor(session) {
    if (!session?.id) return;
    savedSessionRenameState = {
      sessionId: String(session.id),
      value: String(session.name || '').trim() || 'Saved tabs',
      shouldFocus: true,
    };
    void renderSavedTabsPage();
  }

  function closeSavedSessionRenameEditor() {
    savedSessionRenameState = null;
  }

  function openSavedSessionSettings(sessionId = '') {
    const cleanSessionId = String(sessionId || '').trim();
    if (!cleanSessionId) return;
    savedSessionSettingsState = { sessionId: cleanSessionId };
    void renderSavedTabsPage();
  }

  function closeSavedSessionSettings() {
    if (!savedSessionSettingsState) return;
    savedSessionSettingsState = null;
  }

  function toggleSavedSessionSettings(sessionId = '') {
    const cleanSessionId = String(sessionId || '').trim();
    if (!cleanSessionId) return;
    if (savedSessionSettingsState?.sessionId === cleanSessionId) {
      closeSavedSessionSettings();
      void renderSavedTabsPage();
      return;
    }
    openSavedSessionSettings(cleanSessionId);
  }

  function isSavedSessionExpanded(sessionId = '') {
    return savedSessionCollapsedState[String(sessionId || '')] !== true;
  }

  async function loadSavedSessionCollapsedState(sessions = []) {
    const stored = await chrome.storage.local.get(SAVED_TAB_SESSION_COLLAPSED_KEY);
    const normalized = normalizeSavedTabSessionCollapsedState(stored[SAVED_TAB_SESSION_COLLAPSED_KEY], sessions);
    savedSessionCollapsedState = normalized;
    await chrome.storage.local.set({ [SAVED_TAB_SESSION_COLLAPSED_KEY]: normalized });
    return normalized;
  }

  async function saveSavedSessionCollapsedState(nextState = {}, sessions = []) {
    savedSessionCollapsedState = normalizeSavedTabSessionCollapsedState(nextState, sessions);
    await chrome.storage.local.set({ [SAVED_TAB_SESSION_COLLAPSED_KEY]: savedSessionCollapsedState });
    return savedSessionCollapsedState;
  }

  async function toggleSavedSessionCollapsed(sessionId = '') {
    const cleanSessionId = String(sessionId || '').trim();
    if (!cleanSessionId) return;
    const sessions = await getOrderedSavedSessions();
    await saveSavedSessionCollapsedState({
      ...savedSessionCollapsedState,
      [cleanSessionId]: isSavedSessionExpanded(cleanSessionId),
    }, sessions);
    void renderSavedTabsPage();
  }

  async function submitSavedSessionRename() {
    if (!savedSessionRenameState || !managerRenameSavedTabSession) return;

    const targetId = String(savedSessionRenameState.sessionId || '');
    const cleanName = String(savedSessionRenameState.value || '').trim();
    if (!targetId || !cleanName) {
      closeSavedSessionRenameEditor();
      await renderSavedTabsPage();
      return;
    }

    await managerRenameSavedTabSession(targetId, cleanName);
    closeSavedSessionRenameEditor();
    await renderSavedTabsPage();
    showManagerToast(managerT ? managerT('toastRenamedGroup', { name: cleanName }) : `Renamed to ${cleanName}`);
  }

  async function saveSavedSessionTabsFromIndexes(sessionId, tabIndexes = []) {
    if (!managerUpdateSavedTabSessionTabs) return;
    const sessions = await getOrderedSavedSessions();
    const session = sessions.find(item => String(item?.id || '') === String(sessionId || ''));
    if (!session) return;
    const normalizedIndexes = [...new Set((Array.isArray(tabIndexes) ? tabIndexes : []).map(index => Number(index)).filter(Number.isInteger))];
    const nextTabs = normalizedIndexes
      .map(index => session.tabs?.[index] || null)
      .filter(Boolean);
    await managerUpdateSavedTabSessionTabs(sessionId, nextTabs);
  }

  async function saveSavedSessionTabsFromTokens(sessionId, orderTokens = []) {
    if (!managerUpdateSavedTabSessionTabs) return;
    const sessions = await getOrderedSavedSessions();
    const session = sessions.find(item => String(item?.id || '') === String(sessionId || ''));
    if (!session) return;
    const nextTabs = reorderSavedSessionTabsByTokens(session, orderTokens);
    await managerUpdateSavedTabSessionTabs(sessionId, nextTabs);
  }

  function renderSavedSessionSettingsMenu(sessionId = '') {
    const currentMode = getSavedSessionRestoreModeValue();
    const navDisplayMode = getSavedSessionNavDisplayModeValue();
    return `
      <div class="theme-menu saved-session-settings-menu" id="savedSessionSettingsMenu-${escapeAttr(sessionId)}" role="dialog" aria-label="${managerT ? managerT('savedSessionSettingsPanel') : 'Session settings panel'}">
        <div class="theme-menu-section">
          <div class="theme-menu-row theme-menu-row-inline-select">
            <label class="theme-menu-label" for="savedSessionRestoreMode-${escapeAttr(sessionId)}">${managerT ? managerT('savedSessionRestoreModeLabel') : 'Default open'}</label>
            <select class="saved-session-settings-select" id="savedSessionRestoreMode-${escapeAttr(sessionId)}" data-action="change-saved-session-restore-mode" data-session-id="${escapeAttr(sessionId)}" aria-label="${managerT ? managerT('savedSessionRestoreModeLabel') : 'Default open'}">
              <option value="current-window"${currentMode === 'current-window' ? ' selected' : ''}>${escapeText(managerT ? managerT('savedSessionRestoreModeCurrentWindow') : 'Current window')}</option>
              <option value="new-window"${currentMode === 'new-window' ? ' selected' : ''}>${escapeText(managerT ? managerT('savedSessionRestoreModeNewWindow') : 'New window')}</option>
            </select>
          </div>
        </div>
        <div class="theme-menu-section">
          <div class="theme-menu-row theme-menu-row-inline-select">
            <label class="theme-menu-label" for="savedSessionNavDisplayMode-${escapeAttr(sessionId)}">${managerT ? managerT('savedSessionNavDisplayModeLabel') : 'Top nav display'}</label>
            <select class="saved-session-settings-select" id="savedSessionNavDisplayMode-${escapeAttr(sessionId)}" data-action="change-saved-session-nav-display-mode" data-session-id="${escapeAttr(sessionId)}" aria-label="${managerT ? managerT('savedSessionNavDisplayModeLabel') : 'Top nav display'}">
              <option value="icon"${navDisplayMode === 'icon' ? ' selected' : ''}>${escapeText(managerT ? managerT('savedSessionNavDisplayModeIcon') : 'Icon')}</option>
              <option value="name"${navDisplayMode === 'name' ? ' selected' : ''}>${escapeText(managerT ? managerT('savedSessionNavDisplayModeName') : 'Group name')}</option>
            </select>
          </div>
        </div>
      </div>`;
  }

  function renderSavedSessionsCountMarkup(sessions = []) {
    const sessionWord = sessions.length === 1
      ? (managerT ? managerT('sessionWordSingular') : 'session')
      : (managerT ? managerT('sessionWordPlural') : 'sessions');
    const settingsOpen = Boolean(savedSessionSettingsState);
    return `
      <div class="saved-session-count-tools">
        <div class="saved-session-settings-wrap">
          <button class="header-theme-trigger saved-session-settings-trigger" type="button" data-action="toggle-saved-session-settings" data-session-id="global" data-tooltip="${managerT ? managerT('savedSessionSettings') : 'Session settings'}" aria-label="${managerT ? managerT('savedSessionSettings') : 'Session settings'}" aria-expanded="${settingsOpen ? 'true' : 'false'}" aria-controls="savedSessionSettingsMenu-global">
            ${SAVED_SESSION_SETTINGS_ICON}
          </button>
          ${settingsOpen ? renderSavedSessionSettingsMenu('global') : ''}
        </div>
        <span class="saved-session-count-text">${sessions.length ? `${sessions.length} ${sessionWord}` : ''}</span>
      </div>`;
  }

  function renderSavedSessionCard(session) {
    const sessionId = escapeAttr(session.id);
    const expanded = isSavedSessionExpanded(session.id);
    const renameEditorOpen = savedSessionRenameState?.sessionId === String(session.id);
    const renameValue = renameEditorOpen ? (savedSessionRenameState?.value || session.name || 'Saved tabs') : (session.name || 'Saved tabs');
    const safeRenameValue = escapeAttr(renameValue);
    return `
      <article class="saved-session-card${expanded ? '' : ' is-collapsed'}" data-session-id="${sessionId}">
        <div class="saved-session-main">
          <div class="saved-session-top">
            <div class="saved-session-heading">
              ${renameEditorOpen ? `
                <form class="mission-rename-form" data-action="submit-saved-session-rename" data-session-id="${sessionId}">
                  <input class="mission-rename-input saved-session-rename-input" type="text" value="${safeRenameValue}" data-saved-session-rename-input="${sessionId}" aria-label="${managerT ? managerT('renameGroup') : 'Rename group'}" autocomplete="off">
                </form>
              ` : `
                <button class="mission-rename-trigger" type="button" data-action="rename-saved-session" data-session-id="${sessionId}" aria-label="${managerT ? managerT('renameGroup') : 'Rename group'}" title="${managerT ? managerT('renameGroup') : 'Rename group'}">
                  <span class="mission-name">${escapeText(session.name || 'Saved tabs')}</span>
                </button>
              `}
              <span>${escapeText(getSessionSummary(session))}</span>
            </div>
            <div class="mission-actions">
              <button class="group-action-icon saved-session-collapse" type="button" data-action="toggle-saved-session-collapse" data-session-id="${sessionId}" aria-label="${expanded ? 'Collapse session' : 'Expand session'}" aria-expanded="${expanded ? 'true' : 'false'}">
                ${expanded
                  ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m18 15-6-6-6 6" /></svg>'
                  : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" /></svg>'}
              </button>
              <button class="group-action-icon saved-session-restore" type="button" data-action="restore-tab-session" data-session-id="${sessionId}" aria-label="${managerT ? managerT('restoreSessionButton') : 'Restore'}" data-tooltip="${managerT ? managerT('restoreSessionButton') : 'Restore'}">
                ${SAVED_SESSION_RESTORE_ICON}
              </button>
              <button class="group-action-icon group-action-close" type="button" data-action="delete-tab-session" data-session-id="${sessionId}" aria-label="${managerT ? managerT('deleteSessionButton') : 'Delete session'}" data-tooltip="${managerT ? managerT('deleteSessionButton') : 'Delete session'}">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
          <div class="saved-session-preview"${expanded ? '' : ' hidden'}>
            ${renderSessionTabPreview(session)}
          </div>
        </div>
      </article>`;
  }

  function getSavedSessionNavIconData(session) {
    const firstTab = Array.isArray(session?.tabs) ? session.tabs[0] : null;
    const label = getSavedSessionNavLabel(session);
    if (managerGetGroupIcon) {
      return managerGetGroupIcon({ tabs: firstTab ? [firstTab] : [] }, label, 32);
    }
    const iconData = managerGetIconSources
      ? managerGetIconSources(firstTab || { title: label, url: firstTab?.url || '' }, 32)
      : { hostname: '', primaryDomain: '', sources: [] };
    const fallbackLabel = managerGetFallbackLabel
      ? managerGetFallbackLabel(label, iconData.primaryDomain || iconData.hostname || '')
      : '?';
    return {
      hostname: iconData.hostname || '',
      primaryDomain: iconData.primaryDomain || '',
      src: iconData.sources?.[0] || '',
      fallbackSrc: iconData.sources?.[1] || '',
      fallbackLabel,
    };
  }

  function getSavedSessionNavLabel(session) {
    return String(session?.name || (managerT ? managerT('suggestSectionSessions') : 'Saved sessions')).trim() || 'Saved tabs';
  }

  function renderSavedSessionNavButton(session) {
    const sessionId = String(session?.id || '');
    const safeSessionId = escapeAttr(sessionId);
    const label = getSavedSessionNavLabel(session);
    const safeTooltip = escapeAttr(label);
    const iconData = getSavedSessionNavIconData(session);
    const navDisplayMode = getSavedSessionNavDisplayModeValue();

    if (navDisplayMode === 'name') {
      return `
        <button
          class="group-nav-button saved-session-nav-button is-name-mode"
          type="button"
          data-action="jump-to-saved-session"
          data-nav-kind="saved-sessions"
          data-session-id="${safeSessionId}"
          data-group-id="${safeSessionId}"
          data-tooltip="${safeTooltip}"
          aria-label="${managerT ? managerT('jumpToLabel', { label: safeTooltip }) : `Jump to ${safeTooltip}`}"
          draggable="false"
        >
          <span class="saved-session-nav-label">${escapeText(label)}</span>
        </button>`;
    }

    return `
      <button
        class="group-nav-button saved-session-nav-button"
        type="button"
        data-action="jump-to-saved-session"
        data-nav-kind="saved-sessions"
        data-session-id="${safeSessionId}"
        data-group-id="${safeSessionId}"
        data-tooltip="${safeTooltip}"
        aria-label="${managerT ? managerT('jumpToLabel', { label: safeTooltip }) : `Jump to ${safeTooltip}`}"
        draggable="false"
      >
        ${iconData.src
          ? `<img class="group-nav-icon" src="${escapeAttr(iconData.src)}" alt="" draggable="false" data-fallback-src="${escapeAttr(iconData.fallbackSrc || '')}" data-fallback-srcset="${escapeAttr(JSON.stringify(iconData.fallbackSources?.slice(1) || []))}">`
          : ''}
        <span class="group-nav-fallback"${iconData.src ? ' style="display:none"' : ''}>${escapeText(iconData.fallbackLabel || '?')}</span>
      </button>`;
  }

  function renderSavedTabsNavArea(sessions = []) {
    const runtime = getDashboardRuntime();
    const renderSwitch = typeof runtime.renderWorkspacePageSwitch === 'function'
      ? runtime.renderWorkspacePageSwitch('saved-tabs')
      : '';
    const renderTheme = typeof runtime.renderWorkspaceThemeTools === 'function'
      ? runtime.renderWorkspaceThemeTools()
      : '';

    return `
      <div class="group-nav-list" data-nav-kind="saved-sessions">
        ${sessions.map(renderSavedSessionNavButton).join('')}
      </div>
      ${renderSwitch}
      ${renderTheme}`;
  }

  async function loadSavedTabSessionOrder(sessions = []) {
    const stored = await chrome.storage.local.get(SAVED_TAB_SESSION_ORDER_KEY);
    const normalized = normalizeSavedTabSessionOrder(stored[SAVED_TAB_SESSION_ORDER_KEY]);
    const orderedSessions = applySavedTabSessionOrder(sessions, normalized);
    const nextOrder = buildSavedTabSessionOrder(orderedSessions);
    savedSessionOrderState = nextOrder;
    await chrome.storage.local.set({ [SAVED_TAB_SESSION_ORDER_KEY]: nextOrder });
    return nextOrder;
  }

  async function saveSavedTabSessionOrder(orderIds = []) {
    savedSessionOrderState = normalizeSavedTabSessionOrder(orderIds);
    await chrome.storage.local.set({ [SAVED_TAB_SESSION_ORDER_KEY]: savedSessionOrderState });
    return savedSessionOrderState;
  }

  async function getOrderedSavedSessions() {
    if (!managerGetSavedTabSessions) return [];
    const sessions = await managerGetSavedTabSessions();
    await loadSavedSessionCollapsedState(sessions);
    await loadSavedTabSessionOrder(sessions);
    return applySavedTabSessionOrder(sessions, savedSessionOrderState);
  }

  function getSavedSessionNavListEl() {
    return document.querySelector('#workspaceTopNav .group-nav-list[data-nav-kind="saved-sessions"]');
  }

  function animateSavedSessionNavButtonNode(button, previousRect) {
    if (!button || !previousRect || button.classList.contains('is-dragging')) return;

    const nextRect = button.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    if (!deltaX && !deltaY) return;

    button.style.transition = 'none';
    button.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
    requestAnimationFrame(() => {
      button.style.transition = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)';
      button.style.transform = '';
    });
  }

  function animateSavedSessionNavButtons(navListEl, previousRects) {
    navListEl?.querySelectorAll('.saved-session-nav-button').forEach(button => {
      const key = button.dataset.sessionId || '';
      animateSavedSessionNavButtonNode(button, previousRects.get(key));
    });
  }

  function ensureSavedSessionDragPlaceholder() {
    if (savedSessionDragPlaceholderEl || !draggedSavedSessionButtonEl) return savedSessionDragPlaceholderEl;

    savedSessionDragPlaceholderEl = document.createElement('div');
    savedSessionDragPlaceholderEl.className = 'group-nav-placeholder';
    draggedSavedSessionButtonEl.insertAdjacentElement('afterend', savedSessionDragPlaceholderEl);
    return savedSessionDragPlaceholderEl;
  }

  function clearSavedSessionDragState() {
    draggedSavedSessionId = '';
    savedSessionDragStartPoint = null;
    draggedSavedSessionButtonEl = null;
    savedSessionDragPlaceholderEl?.remove();
    savedSessionDragPlaceholderEl = null;
    document.body.classList.remove('group-dragging');
    document.querySelectorAll('.saved-session-nav-button.is-dragging').forEach(button => {
      button.classList.remove('is-dragging');
      button.style.removeProperty('--drag-left');
      button.style.removeProperty('--drag-top');
      button.style.removeProperty('transition');
      button.style.removeProperty('transform');
    });
  }

  function ensureSavedSessionTabPlaceholder(listEl) {
    if (!draggedSavedSessionTabRowEl) return null;

    if (!savedSessionTabPlaceholderEl) {
      savedSessionTabPlaceholderEl = document.createElement('div');
      savedSessionTabPlaceholderEl.className = 'saved-session-tab-placeholder';
      savedSessionTabPlaceholderEl.style.height = `${draggedSavedSessionTabRowEl.getBoundingClientRect().height}px`;
    }

    if (listEl && savedSessionTabPlaceholderEl.parentElement !== listEl) {
      listEl.appendChild(savedSessionTabPlaceholderEl);
    }

    return savedSessionTabPlaceholderEl;
  }

  function clearSavedSessionTabDropPreview() {
    document.querySelectorAll('.saved-session-card.is-drop-target').forEach(card => {
      card.classList.remove('is-drop-target');
    });
    document.body.classList.remove('saved-session-drop-new');
    savedSessionNewSessionSlotEl?.remove();
    savedSessionNewSessionSlotEl = null;
  }

  function setSavedSessionTabDropPreview(cardEl, {
    createNewSession = false,
    newSessionPlacement = 'after',
    insertBeforeCardEl = null,
  } = {}) {
    clearSavedSessionTabDropPreview();
    if (cardEl) cardEl.classList.add('is-drop-target');
    if (!createNewSession) return;

    document.body.classList.add('saved-session-drop-new');
    const listEl = document.getElementById('savedSessionsList');
    if (!listEl) return;

    savedSessionNewSessionSlotEl = document.createElement('div');
    savedSessionNewSessionSlotEl.className = 'saved-session-new-slot';
    savedSessionNewSessionSlotEl.innerHTML = '<span class="saved-session-new-slot-line"></span>';
    const firstCard = listEl.querySelector('.saved-session-card');
    if (insertBeforeCardEl) {
      listEl.insertBefore(savedSessionNewSessionSlotEl, insertBeforeCardEl);
    } else if (newSessionPlacement === 'before' && firstCard) {
      listEl.insertBefore(savedSessionNewSessionSlotEl, firstCard);
    } else {
      listEl.appendChild(savedSessionNewSessionSlotEl);
    }
  }

  function clearSavedSessionTabDragState({ removeNode = false } = {}) {
    const handleEl = savedSessionTabDragState?.handleEl || null;
    const pointerId = savedSessionTabDragState?.pointerId;
    savedSessionTabDragState = null;
    savedSessionTabPlaceholderEl?.remove();
    savedSessionTabPlaceholderEl = null;
    clearSavedSessionTabDropPreview();
    document.body.classList.remove('page-chip-list-dragging');
    document.body.classList.remove('page-chip-drag-armed');

    if (draggedSavedSessionTabRowEl) {
      if (removeNode) draggedSavedSessionTabRowEl.remove();
      draggedSavedSessionTabRowEl.classList.remove('is-dragging');
      draggedSavedSessionTabRowEl.style.removeProperty('--drag-left');
      draggedSavedSessionTabRowEl.style.removeProperty('--drag-top');
      draggedSavedSessionTabRowEl.style.removeProperty('--drag-width');
    }

    if (handleEl && pointerId != null && typeof handleEl.releasePointerCapture === 'function') {
      try {
        if (handleEl.hasPointerCapture?.(pointerId)) handleEl.releasePointerCapture(pointerId);
      } catch {}
    }

    draggedSavedSessionTabRowEl = null;
  }

  function updateDraggedSavedSessionTabPosition(clientX, clientY) {
    if (!draggedSavedSessionTabRowEl || !savedSessionTabDragState) return;
    draggedSavedSessionTabRowEl.style.setProperty('--drag-left', `${clientX - savedSessionTabDragState.offsetX}px`);
    draggedSavedSessionTabRowEl.style.setProperty('--drag-top', `${clientY - savedSessionTabDragState.offsetY}px`);
  }

  function previewSavedSessionTabOrder(clientY) {
    const listEl = savedSessionTabDragState?.listEl;
    if (!listEl || !draggedSavedSessionTabRowEl || !savedSessionTabDragState) return;

    const placeholder = ensureSavedSessionTabPlaceholder(listEl);
    const items = [...listEl.querySelectorAll('.saved-session-tab-row:not(.is-dragging)')];

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
  }

  function buildSavedSessionTabOrderFromPreview() {
    const listEl = savedSessionTabDragState?.listEl;
    if (!listEl) return [];

    return [...listEl.children]
      .map(node => {
        if (node === savedSessionTabPlaceholderEl) return savedSessionTabDragState?.tabToken || '';
        return node.dataset?.savedTabToken || '';
      })
      .filter(Boolean);
  }

  function getSavedSessionCardFromPoint(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    return element?.closest?.('.saved-session-card') || null;
  }

  function getSavedSessionListFromCard(cardEl) {
    return cardEl?.querySelector?.('[data-saved-session-tab-list]') || null;
  }

  function getSavedSessionTabDropTarget(clientX, clientY) {
    const listEl = document.getElementById('savedSessionsList');
    const cards = listEl ? [...listEl.querySelectorAll('.saved-session-card')] : [];
    if (!listEl || !cards.length) return null;

    const firstRect = cards[0].getBoundingClientRect();
    const lastRect = cards[cards.length - 1].getBoundingClientRect();
    const edgeThreshold = 18;
    const gapThreshold = 24;

    if (clientY <= firstRect.top + edgeThreshold) {
      return { kind: 'new-session', placement: 'before', reason: 'top-edge' };
    }

    if (clientY >= lastRect.bottom - edgeThreshold) {
      return { kind: 'new-session', placement: 'after', reason: 'bottom-edge' };
    }

    for (let index = 0; index < cards.length - 1; index += 1) {
      const currentRect = cards[index].getBoundingClientRect();
      const nextCardEl = cards[index + 1];
      const nextRect = nextCardEl.getBoundingClientRect();
      const gapTop = currentRect.bottom - gapThreshold;
      const gapBottom = nextRect.top + gapThreshold;
      if (clientY >= gapTop && clientY <= gapBottom) {
        return {
          kind: 'new-session',
          placement: 'before',
          insertBeforeCardEl: nextCardEl,
          insertBeforeSessionId: nextCardEl.dataset?.sessionId || '',
          reason: 'card-gap',
        };
      }
    }

    for (const cardEl of cards) {
      const rect = cardEl.getBoundingClientRect();
      const withinCardY = clientY >= rect.top && clientY <= rect.bottom;
      if (!withinCardY) continue;
      const targetListEl = getSavedSessionListFromCard(cardEl);
      const sessionId = cardEl.dataset?.sessionId || '';
      if (targetListEl && sessionId) {
        return {
          kind: 'session',
          cardEl,
          listEl: targetListEl,
          sessionId,
        };
      }
    }

    return null;
  }

  function buildSavedSessionTabOrderFromList(listEl, draggedToken = '') {
    if (!listEl) return [];
    return [...listEl.children]
      .map(node => {
        if (node === savedSessionTabPlaceholderEl) return draggedToken;
        return node.dataset?.savedTabToken || '';
      })
      .filter(Boolean);
  }

  function syncSavedSessionTabDropTarget(clientX, clientY) {
    if (!savedSessionTabDragState) return;

    const dropTarget = getSavedSessionTabDropTarget(clientX, clientY);
    if (!dropTarget) {
      savedSessionTabDragState = {
        ...savedSessionTabDragState,
        listEl: savedSessionTabDragState.sourceListEl || savedSessionTabDragState.listEl,
        targetSessionId: savedSessionTabDragState.sessionId,
        createNewSession: false,
        newSessionPlacement: '',
        insertBeforeSessionId: '',
        lastResolvedDropTarget: null,
      };
      clearSavedSessionTabDropPreview();
      return;
    }

    if (dropTarget.kind === 'new-session') {
      savedSessionTabDragState = {
        ...savedSessionTabDragState,
        listEl: null,
        targetSessionId: '',
        createNewSession: true,
        newSessionPlacement: dropTarget.placement || 'after',
        insertBeforeSessionId: dropTarget.insertBeforeSessionId || '',
        lastResolvedDropTarget: {
          kind: 'new-session',
          placement: dropTarget.placement || 'after',
          insertBeforeSessionId: dropTarget.insertBeforeSessionId || '',
          reason: dropTarget.reason || '',
        },
      };
      savedSessionTabPlaceholderEl?.remove();
      setSavedSessionTabDropPreview(null, {
        createNewSession: true,
        newSessionPlacement: savedSessionTabDragState.newSessionPlacement,
        insertBeforeCardEl: dropTarget.insertBeforeCardEl || null,
      });
      return;
    }

    savedSessionTabDragState = {
      ...savedSessionTabDragState,
      listEl: dropTarget.listEl || savedSessionTabDragState.sourceListEl || savedSessionTabDragState.listEl,
      targetSessionId: dropTarget.sessionId || savedSessionTabDragState.sessionId,
      createNewSession: false,
      newSessionPlacement: '',
      insertBeforeSessionId: '',
      lastResolvedDropTarget: {
        kind: 'session',
        sessionId: dropTarget.sessionId || '',
      },
    };
    setSavedSessionTabDropPreview(dropTarget.cardEl || null);
  }

  async function moveSavedSessionTabAcrossSessions(sourceSessionId, targetSessionId, sourceOrder, targetOrder, draggedToken) {
    if (!managerUpdateSavedTabSessionTabs) return;
    const sessions = await getOrderedSavedSessions();
    const sourceSession = sessions.find(item => String(item?.id || '') === String(sourceSessionId || ''));
    const targetSession = sessions.find(item => String(item?.id || '') === String(targetSessionId || ''));
    if (!sourceSession || !targetSession) return;

    const { sourceTabs: nextSourceTabs, targetTabs: nextTargetTabs } = moveSavedSessionTabsByTokens({
      sourceSession,
      targetSession,
      sourceOrderTokens: sourceOrder,
      targetOrderTokens: targetOrder,
      draggedToken,
    });

    await managerUpdateSavedTabSessionTabs(sourceSessionId, nextSourceTabs);
    await managerUpdateSavedTabSessionTabs(targetSessionId, nextTargetTabs);
  }

  async function detachDraggedSavedSessionTabToNewSession(draggedToken, {
    placement = 'after',
    insertBeforeSessionId = '',
  } = {}) {
    if (!managerSaveSavedTabSessions) return null;
    const sessions = await getOrderedSavedSessions();
    const result = detachSavedSessionTabToNewSession({
      sessions,
      draggedToken,
      placement,
      insertBeforeSessionId,
      now: new Date().toISOString(),
    });
    if (!result?.createdSession) return null;
    await managerSaveSavedTabSessions(result.sessions);
    await saveSavedTabSessionOrder(result.orderIds);
    return result;
  }

  async function restoreSavedSessionTab(sessionId, tabIndex) {
    const sessions = await getOrderedSavedSessions();
    const session = sessions.find(item => String(item?.id || '') === String(sessionId || ''));
    const tab = session?.tabs?.[tabIndex] || null;
    if (!tab?.url) return;
    const runtime = getDashboardRuntime();
    if (typeof runtime.restoreSavedTabToBrowser === 'function') {
      await runtime.restoreSavedTabToBrowser(tab.url);
    } else {
      await chrome.tabs.create({ url: tab.url, active: true });
    }
    showManagerToast(managerT ? managerT('toastSavedSessionTabRestored') : 'Restored tab');
  }

  function updateDraggedSavedSessionPosition(clientX, clientY) {
    if (!draggedSavedSessionButtonEl || !savedSessionDragStartPoint) return;
    draggedSavedSessionButtonEl.style.setProperty('--drag-left', `${clientX - savedSessionDragStartPoint.offsetX}px`);
    draggedSavedSessionButtonEl.style.setProperty('--drag-top', `${clientY - savedSessionDragStartPoint.offsetY}px`);
  }

  function previewSavedSessionOrder(clientX) {
    const navListEl = getSavedSessionNavListEl();
    if (!navListEl || !draggedSavedSessionId) return;

    const placeholder = ensureSavedSessionDragPlaceholder();
    const previousRects = new Map();
    const buttons = [...navListEl.querySelectorAll('.saved-session-nav-button:not(.is-dragging)')];

    buttons.forEach(button => {
      previousRects.set(button.dataset.sessionId || '', button.getBoundingClientRect());
    });

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

    animateSavedSessionNavButtons(navListEl, previousRects);
  }

  function buildSavedSessionOrderFromPreview() {
    const navListEl = getSavedSessionNavListEl();
    if (!navListEl || !draggedSavedSessionId) return savedSessionOrderState.slice();

    return [...navListEl.children]
      .map(node => {
        if (node === savedSessionDragPlaceholderEl) return draggedSavedSessionId;
        return node.dataset?.sessionId || '';
      })
      .filter(Boolean);
  }

  function highlightSavedSessionCard(sessionId = '') {
    const target = document.querySelector(`.saved-session-card[data-session-id="${CSS.escape(String(sessionId || ''))}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('group-nav-target');
    setTimeout(() => target.classList.remove('group-nav-target'), 1200);
  }

  async function renderSavedSessionsList() {
    const listEl = document.getElementById('savedSessionsList');
    const emptyEl = document.getElementById('savedSessionsEmpty');
    const countEl = document.getElementById('savedSessionsCount');
    if (!listEl) return;

    const sessions = await getOrderedSavedSessions();
    const runtime = getDashboardRuntime();
    if (typeof runtime.syncWorkspaceTopNavMarkup === 'function') {
      runtime.syncWorkspaceTopNavMarkup(renderSavedTabsNavArea(sessions), true);
    }

    if (countEl) {
      countEl.innerHTML = renderSavedSessionsCountMarkup(sessions);
    }
    listEl.innerHTML = sessions.map(renderSavedSessionCard).join('');
    if (emptyEl) emptyEl.hidden = sessions.length > 0;
  }

  async function renderSavedTabsPage() {
    await renderSavedSessionsList();
    if (typeof setupImageErrorHandlers === 'function') setupImageErrorHandlers();
    if (savedSessionRenameState?.shouldFocus) {
      const focusId = String(savedSessionRenameState.sessionId || '');
      requestAnimationFrame(() => {
        const renameInput = document.querySelector(`[data-saved-session-rename-input="${CSS.escape(focusId)}"]`);
        if (!renameInput) return;
        renameInput.focus();
        renameInput.select?.();
        if (savedSessionRenameState && savedSessionRenameState.sessionId === focusId) {
          savedSessionRenameState.shouldFocus = false;
        }
      });
    }
  }

  async function saveCurrentWindowSession() {
    const runtime = getDashboardRuntime();
    if (typeof runtime.saveCurrentWindowTabSession !== 'function') return;
    try {
      const result = await runtime.saveCurrentWindowTabSession();
      if (sessionManagerPage === 'saved-tabs') await renderSavedTabsPage();
      showManagerToast(managerT
        ? managerT('toastSessionSaved', {
          count: result?.session?.tabs?.length || 0,
          closedCount: result?.closedCount || 0,
        })
        : `Saved ${result?.session?.tabs?.length || 0} tabs; closed ${result?.closedCount || 0} originals`);
    } catch (error) {
      console.error('[tab-harbor] Failed to save current window session:', error);
      showManagerToast(getErrorToast());
    }
  }

  async function restoreSession(sessionId) {
    const runtime = getDashboardRuntime();
    if (typeof runtime.restoreSavedTabSession !== 'function') return;
    try {
      const result = await runtime.restoreSavedTabSession(sessionId);
      await renderSavedTabsPage();
      const chromeGroupFailures = Array.isArray(result?.chromeGroupRestore?.failures)
        ? result.chromeGroupRestore.failures
        : [];
      const getChromeGroupFailureGroupKey = (failure = {}) => {
        const groupId = failure?.groupId;
        if (groupId != null) return `id:${groupId}`;
        const title = failure?.title || '';
        const tabIds = Array.isArray(failure?.tabIds) ? failure.tabIds.join(',') : '';
        return `create:${title}:${tabIds}`;
      };
      const failedGroupCount = new Set(chromeGroupFailures.map(getChromeGroupFailureGroupKey)).size;
      const failureStages = new Set(chromeGroupFailures.map(failure => failure?.stage || 'unknown'));
      let restoreToastKey = 'toastSessionRestored';
      if (failedGroupCount) {
        if (failureStages.size === 1 && failureStages.has('create')) {
          restoreToastKey = 'toastSessionRestoredWithGroupCreateWarning';
        } else if (failureStages.size === 1 && failureStages.has('metadata')) {
          restoreToastKey = 'toastSessionRestoredWithGroupMetadataWarning';
        } else if (failureStages.size === 1 && failureStages.has('order')) {
          restoreToastKey = 'toastSessionRestoredWithGroupOrderWarning';
        } else {
          restoreToastKey = 'toastSessionRestoredWithGroupWarning';
        }
      }
      showManagerToast(managerT
        ? managerT(
          restoreToastKey,
          {
            count: result?.restoredCount || 0,
            failed: failedGroupCount,
          }
        )
        : failedGroupCount
          ? `Restored ${result?.restoredCount || 0} tabs; ${failedGroupCount} Chrome groups need attention`
          : `Restored ${result?.restoredCount || 0} tabs`);
    } catch (error) {
      console.error('[tab-harbor] Failed to restore tab session:', error);
      showManagerToast(getErrorToast());
    }
  }

  async function deleteSession(sessionId) {
    if (!managerDeleteSavedTabSession) return;
    try {
      await managerDeleteSavedTabSession(sessionId);
      await renderSavedTabsPage();
      showManagerToast(managerT ? managerT('toastSessionDeleted') : 'Session deleted');
    } catch (error) {
      console.error('[tab-harbor] Failed to delete tab session:', error);
      showManagerToast(getErrorToast());
    }
  }

  function syncSavedSessionRenameInputValue(inputEl) {
    if (!inputEl || !savedSessionRenameState) return;
    savedSessionRenameState = {
      ...savedSessionRenameState,
      value: inputEl.value,
    };
  }

  document.addEventListener('click', async event => {
    if (event.target.closest('.saved-session-reorder-handle')) return;
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    if (action === 'switch-workspace-page') {
      await setWorkspacePage(actionEl.dataset.page || 'home');
      return;
    }

    if (action === 'save-current-window-session') {
      if (actionEl.closest('#homePage')) return;
      event.preventDefault();
      await saveCurrentWindowSession();
      return;
    }

    if (action === 'jump-to-saved-session') {
      event.preventDefault();
      highlightSavedSessionCard(actionEl.dataset.sessionId || '');
      return;
    }

    if (action === 'restore-saved-session-tab') {
      if (Date.now() < savedSessionTabSuppressClickUntil) return;
      await restoreSavedSessionTab(actionEl.dataset.sessionId || '', Number(actionEl.dataset.tabIndex));
      return;
    }

    if (action === 'rename-saved-session') {
      event.preventDefault();
      const sessions = await getOrderedSavedSessions();
      const session = sessions.find(item => String(item?.id || '') === String(actionEl.dataset.sessionId || ''));
      if (session) openSavedSessionRenameEditor(session);
      return;
    }

    if (action === 'toggle-saved-session-collapse') {
      event.preventDefault();
      await toggleSavedSessionCollapsed(actionEl.dataset.sessionId || '');
      return;
    }

    if (action === 'toggle-saved-session-settings') {
      event.preventDefault();
      event.stopPropagation();
      toggleSavedSessionSettings(actionEl.dataset.sessionId || '');
      return;
    }

    if (action === 'submit-saved-session-rename') {
      event.preventDefault();
      await submitSavedSessionRename();
      return;
    }

    if (action === 'restore-tab-session') {
      await restoreSession(actionEl.dataset.sessionId || '');
      return;
    }

    if (action === 'delete-saved-session-tab') {
      const sessionId = actionEl.dataset.sessionId || '';
      const tabIndex = Number(actionEl.dataset.tabIndex);
      if (!sessionId || !Number.isInteger(tabIndex) || !managerUpdateSavedTabSessionTabs) return;
      const sessions = await getOrderedSavedSessions();
      const session = sessions.find(item => String(item?.id || '') === String(sessionId));
      if (!session) return;
      const nextTabs = (session.tabs || []).filter((_, index) => index !== tabIndex);
      await managerUpdateSavedTabSessionTabs(sessionId, nextTabs);
      await renderSavedTabsPage();
      showManagerToast(managerT ? managerT('toastSessionDeleted') : 'Session deleted');
      return;
    }

    if (action === 'delete-tab-session') {
      await deleteSession(actionEl.dataset.sessionId || '');
    }
  });

  document.addEventListener('pointerdown', event => {
    const button = event.target.closest('.saved-session-nav-button[data-nav-kind="saved-sessions"]');
    if (!button || sessionManagerPage !== 'saved-tabs') return;

    draggedSavedSessionId = button.dataset.sessionId || '';
    draggedSavedSessionButtonEl = button;
    const rect = button.getBoundingClientRect();
    savedSessionDragStartPoint = {
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
  });

  document.addEventListener('pointermove', event => {
    if (!draggedSavedSessionId || !savedSessionDragStartPoint || sessionManagerPage !== 'saved-tabs') return;

    const distance = Math.hypot(event.clientX - savedSessionDragStartPoint.x, event.clientY - savedSessionDragStartPoint.y);
    if (!savedSessionDragStartPoint.moved && distance < 2) return;

    if (!savedSessionDragStartPoint.moved) {
      savedSessionDragStartPoint.moved = true;
      document.body.classList.add('group-dragging');
      draggedSavedSessionButtonEl?.classList.add('is-dragging');
      ensureSavedSessionDragPlaceholder();
    }

    updateDraggedSavedSessionPosition(event.clientX, event.clientY);
    previewSavedSessionOrder(event.clientX);
  });

  document.addEventListener('pointerup', async () => {
    if (!draggedSavedSessionId) return;

    const moved = savedSessionDragStartPoint?.moved;
    if (moved) {
      await saveSavedTabSessionOrder(buildSavedSessionOrderFromPreview());
    }

    clearSavedSessionDragState();

    if (moved && sessionManagerPage === 'saved-tabs') {
      await renderSavedTabsPage();
    }
  });

  document.addEventListener('pointercancel', () => {
    if (!draggedSavedSessionId) return;
    clearSavedSessionDragState();
  });

  document.addEventListener('pointerdown', event => {
    const handleEl = event.target.closest('.saved-session-reorder-handle');
    const rowEl = event.target.closest('.saved-session-tab-row');
    const listEl = rowEl?.closest('[data-saved-session-tab-list]');
    if (!handleEl || !rowEl || !listEl || sessionManagerPage !== 'saved-tabs') return;

    const sessionId = rowEl.dataset.savedSessionId || '';
    const tabIndex = Number(rowEl.dataset.savedTabIndex);
    const tabToken = rowEl.dataset.savedTabToken || '';
    if (!sessionId || !Number.isInteger(tabIndex) || !tabToken) return;

    const rect = rowEl.getBoundingClientRect();
    draggedSavedSessionTabRowEl = rowEl;
    savedSessionTabDragState = {
      sessionId,
      targetSessionId: sessionId,
      tabIndex,
      tabToken,
      listEl,
      sourceListEl: listEl,
      handleEl,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      createNewSession: false,
      newSessionPlacement: '',
      insertBeforeSessionId: '',
      lastResolvedDropTarget: null,
      moved: false,
    };
  });

  document.addEventListener('pointermove', event => {
    if (!savedSessionTabDragState || !draggedSavedSessionTabRowEl || sessionManagerPage !== 'saved-tabs') return;

    const distance = Math.hypot(event.clientX - savedSessionTabDragState.x, event.clientY - savedSessionTabDragState.y);
    if (!savedSessionTabDragState.moved && distance < 2) return;

    if (!savedSessionTabDragState.moved) {
      savedSessionTabDragState.moved = true;
      document.body.classList.add('page-chip-list-dragging');
      draggedSavedSessionTabRowEl.classList.add('is-dragging');
      draggedSavedSessionTabRowEl.style.setProperty('--drag-width', `${draggedSavedSessionTabRowEl.getBoundingClientRect().width}px`);
      ensureSavedSessionTabPlaceholder(savedSessionTabDragState.listEl);
    }

    updateDraggedSavedSessionTabPosition(event.clientX, event.clientY);
    syncSavedSessionTabDropTarget(event.clientX, event.clientY);
    if (!savedSessionTabDragState?.createNewSession) {
      previewSavedSessionTabOrder(event.clientY);
    }
  });

  document.addEventListener('pointerup', async () => {
    if (!savedSessionTabDragState) return;
    const moved = savedSessionTabDragState.moved;
    const sessionId = savedSessionTabDragState.sessionId;
    const draggedToken = savedSessionTabDragState.tabToken || '';
    const nextOrder = buildSavedSessionTabOrderFromPreview();
    const targetSessionId = savedSessionTabDragState.targetSessionId || sessionId;
    const createNewSession = savedSessionTabDragState.createNewSession;
    const newSessionPlacement = savedSessionTabDragState.newSessionPlacement || 'after';
    const insertBeforeSessionId = savedSessionTabDragState.insertBeforeSessionId || '';
    const sourceListEl = document.querySelector(`[data-saved-session-tab-list="${CSS.escape(sessionId)}"]`);
    const sourceOrder = buildSavedSessionTabOrderFromList(sourceListEl);
    clearSavedSessionTabDragState({ removeNode: moved });
    if (moved) {
      savedSessionTabSuppressClickUntil = Date.now() + 250;
      if (createNewSession) {
        await detachDraggedSavedSessionTabToNewSession(draggedToken, {
          placement: newSessionPlacement,
          insertBeforeSessionId,
        });
      } else if (targetSessionId === sessionId) {
        await saveSavedSessionTabsFromTokens(sessionId, nextOrder);
      } else {
        await moveSavedSessionTabAcrossSessions(
          sessionId,
          targetSessionId,
          sourceOrder.filter(token => token !== draggedToken),
          nextOrder,
          draggedToken
        );
      }
      await renderSavedTabsPage();
    }
  });

  document.addEventListener('pointercancel', () => {
    if (!savedSessionTabDragState) return;
    clearSavedSessionTabDragState();
  });

  document.addEventListener('pointerdown', event => {
    if (!savedSessionSettingsState) return;
    if (event.target.closest('.saved-session-settings-wrap')) return;
    closeSavedSessionSettings();
    void renderSavedTabsPage();
  });

  document.addEventListener('input', event => {
    const inputEl = event.target.closest('.saved-session-rename-input');
    if (!inputEl) return;
    syncSavedSessionRenameInputValue(inputEl);
  });

  document.addEventListener('change', event => {
    const navDisplaySelectEl = event.target.closest('[data-action="change-saved-session-nav-display-mode"]');
    if (navDisplaySelectEl) {
      void persistSavedSessionNavDisplayMode(navDisplaySelectEl.value);
      return;
    }
    const selectEl = event.target.closest('[data-action="change-saved-session-restore-mode"]');
    if (!selectEl) return;
    void persistSavedSessionRestoreMode(selectEl.value);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && savedSessionSettingsState) {
      closeSavedSessionSettings();
      void renderSavedTabsPage();
      return;
    }
    const inputEl = event.target.closest('.saved-session-rename-input');
    if (!inputEl || !savedSessionRenameState) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitSavedSessionRename();
      return;
    }
    if (event.key === 'Escape') {
      closeSavedSessionRenameEditor();
      void renderSavedTabsPage();
      return;
    }
  });

  document.addEventListener('focusout', event => {
    const inputEl = event.target.closest('.saved-session-rename-input');
    if (!inputEl || !savedSessionRenameState) return;
    const nextFocused = event.relatedTarget;
    if (nextFocused && nextFocused.closest?.('.mission-rename-form')) return;
    void submitSavedSessionRename();
  });

  globalScope.addEventListener?.('hashchange', () => {
    void setWorkspacePage(resolvePageFromHash(), { updateHash: false });
  });

  function initializeSessionManager() {
    void setWorkspacePage(resolvePageFromHash(), { updateHash: false });
  }

  const api = {
    ...exportsApi,
    initializeSessionManager,
    renderSavedTabsPage,
    setWorkspacePage,
  };

  globalScope.TabHarborSessionManager = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSessionManager, { once: true });
  } else {
    initializeSessionManager();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
