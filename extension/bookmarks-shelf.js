'use strict';

(function attachTabHarborBookmarksShelf(globalScope) {
  const modelApi = typeof require === 'function'
    ? require('./bookmarks-model.js')
    : (globalScope.TabHarborBookmarksModel || {});

  const BOOKMARKS_PERMISSION = 'bookmarks';
  const NATIVE_BOOKMARK_MANAGER_URL = 'chrome://bookmarks/';
  const DEFAULT_EVENT_DEBOUNCE_MS = 140;
  const DEFAULT_SEARCH_DEBOUNCE_MS = 140;

  const DEFAULT_MESSAGES = Object.freeze({
    shelfLabel: 'Chrome bookmarks',
    searchLabel: 'Search bookmarks',
    searchPlaceholder: 'Search bookmarks…',
    openManager: 'Open Chrome bookmark manager',
    enableTitle: 'Bring your Chrome bookmarks to this desk',
    enableBody: 'Allow bookmark access to browse and open them here. Tab Harbor does not copy your bookmark tree.',
    enableAction: 'Enable bookmarks',
    deniedTitle: 'Bookmark access was not granted',
    deniedBody: 'Nothing changed. You can try again whenever you want.',
    revokedTitle: 'Bookmark access was removed',
    revokedBody: 'Enable it again to continue browsing your Chrome bookmarks.',
    checking: 'Checking bookmark access…',
    loading: 'Opening your bookmarks…',
    searching: 'Searching bookmarks…',
    emptyFolder: 'This folder is empty.',
    emptySearch: 'No bookmarks match this search.',
    emptyTree: 'No bookmark folder is available yet.',
    errorTitle: 'Bookmarks are quiet for the moment',
    errorBody: 'Tab Harbor could not read them right now. Your Chrome bookmarks were not changed.',
    retry: 'Try again',
    folderLabel: 'Folder',
    bookmarkLabel: 'Bookmark',
    breadcrumbsLabel: 'Bookmark folders',
    rootFallback: 'Bookmarks',
    clearSearch: 'Clear search',
    blockedUrl: 'This bookmark uses a URL type Tab Harbor will not open.',
    openFailed: 'This bookmark could not be opened.',
  });

  function escapeHtml(value = '') {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value = '') {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function getMessages(overrides = {}) {
    return { ...DEFAULT_MESSAGES, ...(overrides || {}) };
  }

  function isChromeFaviconUrl(value = '') {
    try {
      const parsed = new URL(String(value || ''));
      return parsed.protocol === 'chrome-extension:' && parsed.pathname.startsWith('/_favicon/');
    } catch {
      return false;
    }
  }

  function getStatusMarkup(state, messages) {
    const status = state?.status || 'idle';
    if (status === 'checking') {
      return `<div class="bookmarks-shelf-state" role="status">${escapeHtml(messages.checking)}</div>`;
    }
    if (status === 'loading') {
      return `<div class="bookmarks-shelf-state" role="status">${escapeHtml(messages.loading)}</div>`;
    }
    if (status === 'searching') {
      return `<div class="bookmarks-shelf-state bookmarks-shelf-state-inline" role="status">${escapeHtml(messages.searching)}</div>`;
    }
    return '';
  }

  function getPermissionGateMarkup(state, messages) {
    const status = state?.status || '';
    if (!['permission-required', 'denied', 'revoked'].includes(status)) return '';

    const copy = status === 'denied'
      ? { title: messages.deniedTitle, body: messages.deniedBody }
      : status === 'revoked'
        ? { title: messages.revokedTitle, body: messages.revokedBody }
        : { title: messages.enableTitle, body: messages.enableBody };

    return `
      <div class="bookmarks-shelf-gate" role="region" aria-label="${escapeAttribute(copy.title)}">
        <h3 class="bookmarks-shelf-gate-title">${escapeHtml(copy.title)}</h3>
        <p class="bookmarks-shelf-gate-copy">${escapeHtml(copy.body)}</p>
        <div class="bookmarks-shelf-gate-actions">
          <button class="bookmarks-shelf-action" type="button" data-bookmarks-action="request-permission">${escapeHtml(messages.enableAction)}</button>
          <button class="bookmarks-shelf-action is-secondary" type="button" data-bookmarks-action="open-manager">${escapeHtml(messages.openManager)}</button>
        </div>
      </div>`;
  }

  function getErrorMarkup(messages) {
    return `
      <div class="bookmarks-shelf-state bookmarks-shelf-error" role="status">
        <strong>${escapeHtml(messages.errorTitle)}</strong>
        <span>${escapeHtml(messages.errorBody)}</span>
        <button class="bookmarks-shelf-action is-secondary" type="button" data-bookmarks-action="retry">${escapeHtml(messages.retry)}</button>
      </div>`;
  }

  function getBreadcrumbsMarkup(state, messages) {
    const breadcrumbs = Array.isArray(state?.breadcrumbs) ? state.breadcrumbs : [];
    if (!breadcrumbs.length) return '';
    return `
      <nav class="bookmarks-shelf-breadcrumbs" aria-label="${escapeAttribute(messages.breadcrumbsLabel)}">
        <ol>
          ${breadcrumbs.map((crumb, index) => {
            const title = crumb.title || messages.rootFallback;
            const current = index === breadcrumbs.length - 1;
            return `<li>${current
              ? `<span aria-current="page">${escapeHtml(title)}</span>`
              : `<button type="button" data-bookmarks-action="open-folder" data-bookmarks-breadcrumb="true" data-bookmark-id="${escapeAttribute(crumb.id)}">${escapeHtml(title)}</button>`}</li>`;
          }).join('')}
        </ol>
      </nav>`;
  }

  function getItemsMarkup(state, messages) {
    const items = Array.isArray(state?.items) ? state.items : [];
    if (!items.length) {
      const emptyMessage = state?.query
        ? messages.emptySearch
        : state?.emptyReason === 'tree'
          ? messages.emptyTree
          : messages.emptyFolder;
      return `<div class="bookmarks-shelf-empty" role="status">${escapeHtml(emptyMessage)}</div>`;
    }

    return `
      <div class="bookmarks-shelf-list" role="list">
        ${items.map(item => {
          const title = item.title || item.url || (item.isFolder ? messages.folderLabel : messages.bookmarkLabel);
          const path = Array.isArray(item.path)
            ? item.path.map(segment => segment.title).filter(Boolean).join(' / ')
            : '';
          if (item.isFolder) {
            const accessibleLabel = `${messages.folderLabel}: ${title}${path ? ` — ${path}` : ''}`;
            return `
              <div class="bookmarks-shelf-row is-folder" role="listitem">
                <button type="button" data-bookmarks-action="open-folder" data-bookmark-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(accessibleLabel)}">
                  <span class="bookmarks-shelf-row-icon" aria-hidden="true">▱</span>
                  <span class="bookmarks-shelf-row-main">
                    <span class="bookmarks-shelf-row-title">${escapeHtml(title)}</span>
                    ${path ? `<span class="bookmarks-shelf-row-path">${escapeHtml(path)}</span>` : ''}
                  </span>
                </button>
              </div>`;
          }
          const accessibleLabel = `${messages.bookmarkLabel}: ${title}${path ? ` — ${path}` : ''}${item.url ? ` — ${item.url}` : ''}`;
          const faviconMarkup = state?.showFavicons && isChromeFaviconUrl(item.faviconUrl)
            ? `<span class="bookmarks-shelf-row-icon is-favicon" aria-hidden="true">
                <img class="bookmarks-shelf-favicon" src="${escapeAttribute(item.faviconUrl)}" alt="" data-bookmarks-favicon>
                <span class="bookmarks-shelf-favicon-fallback" data-bookmarks-favicon-fallback hidden>◦</span>
              </span>`
            : '<span class="bookmarks-shelf-row-icon" aria-hidden="true">◦</span>';
          return `
            <div class="bookmarks-shelf-row is-bookmark" role="listitem">
              <button type="button" data-bookmarks-action="open-bookmark" data-bookmark-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(accessibleLabel)}">
                ${faviconMarkup}
                <span class="bookmarks-shelf-row-main">
                  <span class="bookmarks-shelf-row-title">${escapeHtml(title)}</span>
                  <span class="bookmarks-shelf-row-url">${escapeHtml(item.url || '')}</span>
                  ${state?.query && path ? `<span class="bookmarks-shelf-row-path">${escapeHtml(path)}</span>` : ''}
                </span>
              </button>
            </div>`;
        }).join('')}
      </div>`;
  }

  function renderBookmarksShelfMarkup(state = {}, messageOverrides = {}) {
    const messages = getMessages(messageOverrides);
    const permissionGranted = state.permission === 'granted';
    const showView = permissionGranted && !['checking', 'loading', 'error'].includes(state.status);
    const viewMode = state.query ? 'search' : state.isRootView ? 'root' : 'folder';
    const statusMarkup = getStatusMarkup(state, messages);
    const permissionMarkup = getPermissionGateMarkup(state, messages);
    const errorMarkup = state.status === 'error' ? getErrorMarkup(messages) : '';
    const noticeMarkup = state.notice
      ? `<div class="bookmarks-shelf-notice" role="status" aria-live="polite">${escapeHtml(state.notice)}</div>`
      : '';

    return `
      <section class="bookmarks-shelf is-${escapeAttribute(viewMode)}-view" data-bookmarks-shelf data-status="${escapeAttribute(state.status || 'idle')}" data-view="${escapeAttribute(viewMode)}" aria-label="${escapeAttribute(messages.shelfLabel)}">
        <header class="bookmarks-shelf-toolbar">
          <label class="bookmarks-shelf-search">
            <span class="bookmarks-shelf-visually-hidden">${escapeHtml(messages.searchLabel)}</span>
            <input type="search" value="${escapeAttribute(state.query || '')}" placeholder="${escapeAttribute(messages.searchPlaceholder)}" data-bookmarks-action="search"${permissionGranted ? '' : ' disabled'}>
          </label>
          ${state.query ? `<button class="bookmarks-shelf-action is-secondary" type="button" data-bookmarks-action="clear-search">${escapeHtml(messages.clearSearch)}</button>` : ''}
          <button class="bookmarks-shelf-action is-secondary" type="button" data-bookmarks-action="open-manager">${escapeHtml(messages.openManager)}</button>
        </header>
        ${noticeMarkup}
        ${statusMarkup}
        ${permissionMarkup}
        ${errorMarkup}
        ${showView ? `${getBreadcrumbsMarkup(state, messages)}${getItemsMarkup(state, messages)}` : ''}
      </section>`;
  }

  function hasBookmarksPermissionDetail(detail) {
    return Array.isArray(detail?.permissions) && detail.permissions.includes(BOOKMARKS_PERMISSION);
  }

  function createBookmarksShelf(options = {}) {
    const chromeApi = options.chromeApi || globalScope.chrome || null;
    const documentRef = options.document || globalScope.document || null;
    const locationRef = options.location || globalScope.location || null;
    const eventDebounceMs = Number.isFinite(options.eventDebounceMs)
      ? Math.max(0, options.eventDebounceMs)
      : DEFAULT_EVENT_DEBOUNCE_MS;
    const searchDebounceMs = Number.isFinite(options.searchDebounceMs)
      ? Math.max(0, options.searchDebounceMs)
      : DEFAULT_SEARCH_DEBOUNCE_MS;
    const scheduleTimeout = options.setTimeout || globalScope.setTimeout?.bind(globalScope) || setTimeout;
    const cancelTimeout = options.clearTimeout || globalScope.clearTimeout?.bind(globalScope) || clearTimeout;
    const messages = getMessages(options.messages);
    const faviconResolver = typeof options.getFaviconUrl === 'function'
      ? options.getFaviconUrl
      : globalScope.TabOutIconUtils?.getFaviconUrl;

    let host = null;
    let bookmarkModel = null;
    let visibleNodesById = new Map();
    let searchItems = [];
    let searchItemsSignature = '';
    let disposed = false;
    let started = false;
    let importInProgress = false;
    let treeGeneration = 0;
    let searchGeneration = 0;
    let permissionGeneration = 0;
    let latestSearchQuery = '';
    let reloadTimer = null;
    let searchTimer = null;
    const folderNavigationHistory = [];
    const permissionSubscriptions = [];
    const bookmarkSubscriptions = [];

    let state = {
      status: 'idle',
      permission: 'unknown',
      currentFolderId: '',
      currentFolderTitle: '',
      query: '',
      breadcrumbs: [],
      items: [],
      notice: '',
      emptyReason: '',
      isRootView: true,
      showFavicons: options.showFavicons === true,
    };

    function resolveBookmarkFaviconUrl(item = {}) {
      if (!state.showFavicons || item.isFolder || !item.url || typeof faviconResolver !== 'function') {
        return '';
      }
      try {
        const result = faviconResolver({ domain: item.url, size: 16 });
        if (result?.source !== 'chrome' || typeof result.url !== 'string') return '';
        return isChromeFaviconUrl(result.url) ? result.url : '';
      } catch {
        return '';
      }
    }

    function getState() {
      return {
        ...state,
        breadcrumbs: state.breadcrumbs.map(item => ({ ...item })),
        items: state.items.map(item => ({
          ...item,
          faviconUrl: resolveBookmarkFaviconUrl(item),
          path: Array.isArray(item.path) ? item.path.map(segment => ({ ...segment })) : [],
        })),
      };
    }

    function render() {
      if (!host) return;
      const activeElement = documentRef?.activeElement || null;
      const focusSnapshot = activeElement && host.contains?.(activeElement)
        ? {
            action: String(activeElement.dataset?.bookmarksAction || ''),
            bookmarkId: String(activeElement.dataset?.bookmarkId || ''),
            selectionStart: Number.isInteger(activeElement.selectionStart) ? activeElement.selectionStart : null,
            selectionEnd: Number.isInteger(activeElement.selectionEnd) ? activeElement.selectionEnd : null,
          }
        : null;
      const snapshot = getState();
      if (typeof options.render === 'function') {
        options.render({ host, state: snapshot, controller });
      } else {
        host.innerHTML = renderBookmarksShelfMarkup(snapshot, messages);
      }
      if (!focusSnapshot?.action) return;
      if (focusSnapshot.action === 'search') {
        const nextInput = host.querySelector?.('[data-bookmarks-action="search"]');
        nextInput?.focus?.({ preventScroll: true });
        if (focusSnapshot.selectionStart != null && nextInput?.setSelectionRange) {
          nextInput.setSelectionRange(focusSnapshot.selectionStart, focusSnapshot.selectionEnd);
        }
        return;
      }
      if (focusSnapshot.bookmarkId && focusBookmarkItem(focusSnapshot.bookmarkId)) return;
      if (focusSnapshot.action === 'open-folder') {
        const firstItem = host.querySelector?.(
          '[data-bookmarks-action="open-folder"], [data-bookmarks-action="open-bookmark"]'
        );
        if (firstItem?.focus) firstItem.focus({ preventScroll: true });
        else focusShelfSearch();
        return;
      }
      focusShelfAction(focusSnapshot.action);
    }

    function emitState() {
      const snapshot = getState();
      render();
      if (typeof options.onStateChange === 'function') {
        options.onStateChange(snapshot, controller);
      }
    }

    function setState(patch = {}) {
      if (disposed) return;
      state = { ...state, ...patch };
      emitState();
    }

    function setShowFavicons(enabled) {
      const nextEnabled = enabled === true;
      if (state.showFavicons !== nextEnabled) setState({ showFavicons: nextEnabled });
      return nextEnabled;
    }

    function cloneSearchItems(items = searchItems) {
      return items.map(item => ({
        ...item,
        path: Array.isArray(item.path) ? item.path.map(segment => ({ ...segment })) : [],
      }));
    }

    function getSearchItems() {
      if (state.permission !== 'granted') return [];
      return cloneSearchItems();
    }

    function publishSearchItems(nextItems = []) {
      const normalized = cloneSearchItems(Array.isArray(nextItems) ? nextItems : []);
      const signature = JSON.stringify(normalized);
      searchItems = normalized;
      if (signature === searchItemsSignature) return;
      searchItemsSignature = signature;
      if (typeof options.onBookmarksChange === 'function') {
        options.onBookmarksChange(cloneSearchItems(), controller);
      }
    }

    function refreshSearchItemsFromModel() {
      const allLeaves = modelApi.getBookmarkLeafItems?.(bookmarkModel) || [];
      // Global search suggestions open URLs outside this controller, so expose
      // only leaves that pass the same navigation safety policy used here.
      const openableLeaves = allLeaves.flatMap(item => {
        const safeUrl = modelApi.getSafeBookmarkUrl?.(item.url) || '';
        return safeUrl ? [{ ...item, url: safeUrl }] : [];
      });
      publishSearchItems(openableLeaves);
    }

    function clearTimer(timerName) {
      if (timerName === 'reload' && reloadTimer !== null) {
        cancelTimeout(reloadTimer);
        reloadTimer = null;
      }
      if (timerName === 'search' && searchTimer !== null) {
        cancelTimeout(searchTimer);
        searchTimer = null;
      }
    }

    function invalidateAsyncWork() {
      treeGeneration += 1;
      searchGeneration += 1;
      permissionGeneration += 1;
      clearTimer('reload');
      clearTimer('search');
    }

    function removeSubscriptions(subscriptions) {
      subscriptions.splice(0).forEach(({ event, listener }) => {
        try {
          event?.removeListener?.(listener);
        } catch { }
      });
    }

    function subscribe(event, listener, subscriptions) {
      if (!event?.addListener) return;
      event.addListener(listener);
      subscriptions.push({ event, listener });
    }

    function clearBookmarkData({ permission, status } = {}) {
      bookmarkModel = null;
      visibleNodesById = new Map();
      latestSearchQuery = '';
      folderNavigationHistory.length = 0;
      publishSearchItems([]);
      removeSubscriptions(bookmarkSubscriptions);
      invalidateAsyncWork();
      setState({
        permission: permission || state.permission,
        status: status || state.status,
        currentFolderId: '',
        currentFolderTitle: '',
        query: '',
        breadcrumbs: [],
        items: [],
        notice: '',
        emptyReason: '',
        isRootView: true,
      });
    }

    async function defaultNavigateCurrent(url) {
      const tabsApi = chromeApi?.tabs;
      if (tabsApi?.update) {
        let currentTab = null;
        try {
          currentTab = await tabsApi.getCurrent?.();
        } catch { }
        if (!currentTab?.id) {
          try {
            const tabs = await tabsApi.query?.({ active: true, currentWindow: true });
            currentTab = Array.isArray(tabs) ? tabs[0] : null;
          } catch { }
        }
        if (currentTab?.id !== undefined && currentTab?.id !== null) {
          await tabsApi.update(currentTab.id, { url });
          return;
        }
      }
      if (typeof locationRef?.assign === 'function') {
        locationRef.assign(url);
        return;
      }
      throw new Error('Current-tab navigation is unavailable');
    }

    async function defaultOpenBackground(url) {
      if (!chromeApi?.tabs?.create) throw new Error('Tab creation is unavailable');
      await chromeApi.tabs.create({ url, active: false });
    }

    async function defaultOpenWindow(url) {
      if (!chromeApi?.windows?.create) throw new Error('Window creation is unavailable');
      await chromeApi.windows.create({ url, focused: true });
    }

    async function reportOpenFailure(error, context) {
      if (typeof options.onError === 'function') options.onError(error, context);
      setState({ notice: messages.openFailed });
    }

    async function openNativeManager() {
      try {
        if (typeof options.openManager === 'function') {
          await options.openManager(NATIVE_BOOKMARK_MANAGER_URL);
          return true;
        }
        if (chromeApi?.tabs?.create) {
          await chromeApi.tabs.create({ url: NATIVE_BOOKMARK_MANAGER_URL, active: true });
          return true;
        }
        if (typeof locationRef?.assign === 'function') {
          locationRef.assign(NATIVE_BOOKMARK_MANAGER_URL);
          return true;
        }
      } catch (error) {
        await reportOpenFailure(error, 'open-manager');
      }
      return false;
    }

    function resolveBookmarkNode(nodeOrId) {
      if (nodeOrId && typeof nodeOrId === 'object') return nodeOrId;
      const id = String(nodeOrId ?? '');
      return modelApi.getBookmarkNode?.(bookmarkModel, id) || visibleNodesById.get(id) || null;
    }

    async function openBookmark(nodeOrId, modifiers = {}) {
      const node = resolveBookmarkNode(nodeOrId);
      if (!node) return false;
      if (modelApi.isBookmarkFolder?.(node)) {
        return openFolder(node.id);
      }

      const safeUrl = modelApi.getSafeBookmarkUrl?.(node.url) || '';
      if (!safeUrl) {
        setState({ notice: messages.blockedUrl });
        if (typeof options.onOpenBlocked === 'function') {
          options.onOpenBlocked({ node, url: String(node.url || '') });
        }
        return false;
      }

      const useNewWindow = modifiers.shiftKey === true;
      const useBackgroundTab = modifiers.ctrlKey === true
        || modifiers.metaKey === true
        || Number(modifiers.button) === 1;

      try {
        if (useNewWindow) {
          const openWindow = options.openWindow || defaultOpenWindow;
          await openWindow(safeUrl, node);
        } else if (useBackgroundTab) {
          const openBackground = options.openBackground || defaultOpenBackground;
          await openBackground(safeUrl, node);
        } else {
          const navigateCurrent = options.navigateCurrent || defaultNavigateCurrent;
          await navigateCurrent(safeUrl, node);
        }
        setState({ notice: '' });
        return true;
      } catch (error) {
        await reportOpenFailure(error, 'open-bookmark');
        return false;
      }
    }

    function buildFolderState(folderId, { query = '' } = {}) {
      const view = modelApi.getBookmarkFolderView?.(bookmarkModel, folderId) || {
        folder: null,
        folderId: '',
        breadcrumbs: [],
        items: [],
      };
      const normalizedItems = modelApi.normalizeBookmarkItems?.(bookmarkModel, view.items) || [];
      visibleNodesById = new Map(
        (Array.isArray(view.items) ? view.items : [])
          .filter(node => node?.id !== undefined && node?.id !== null)
          .map(node => [String(node.id), node]),
      );
      const breadcrumbs = (view.breadcrumbs || []).map(node => ({
        id: String(node.id ?? ''),
        title: String(node.title || ''),
      }));
      return {
        status: normalizedItems.length ? 'ready' : 'empty',
        currentFolderId: view.folderId || '',
        currentFolderTitle: String(view.folder?.title || ''),
        query,
        breadcrumbs,
        items: normalizedItems,
        notice: '',
        emptyReason: view.folder ? 'folder' : 'tree',
        isRootView: Boolean(view.folderId && view.folderId === bookmarkModel?.preferredRootId),
      };
    }

    function focusBookmarkItem(bookmarkId) {
      if (!host?.querySelectorAll || !bookmarkId) return false;
      const target = [...host.querySelectorAll('[data-bookmark-id]')]
        .find(element => String(element?.dataset?.bookmarkId || '') === String(bookmarkId));
      if (!target?.focus) return false;
      target.focus({ preventScroll: true });
      return true;
    }

    function focusShelfSearch() {
      const searchInput = host?.querySelector?.('[data-bookmarks-action="search"]');
      if (!searchInput?.focus || searchInput.disabled) return false;
      searchInput.focus({ preventScroll: true });
      return true;
    }

    function focusShelfAction(action) {
      if (!host?.querySelectorAll || !action) return false;
      const target = [...host.querySelectorAll('[data-bookmarks-action]')]
        .find(element => String(element?.dataset?.bookmarksAction || '') === String(action));
      if (!target?.focus || target.disabled) return false;
      target.focus({ preventScroll: true });
      return true;
    }

    function openFolder(folderId, { recordHistory = true } = {}) {
      if (!bookmarkModel) return false;
      const targetId = String(folderId ?? '');
      const previousFolderId = String(state.currentFolderId || '');
      if (recordHistory && targetId && previousFolderId && targetId !== previousFolderId) {
        folderNavigationHistory.push({
          folderId: previousFolderId,
          triggerId: targetId,
        });
      }
      latestSearchQuery = '';
      searchGeneration += 1;
      clearTimer('search');
      setState(buildFolderState(folderId, { query: '' }));
      return Boolean(state.currentFolderId);
    }

    function closeFolderView() {
      if (!bookmarkModel || state.isRootView) return false;
      const previous = folderNavigationHistory.pop();
      const breadcrumbs = Array.isArray(state.breadcrumbs) ? state.breadcrumbs : [];
      const fallbackParent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null;
      const targetFolderId = previous?.folderId || fallbackParent?.id || bookmarkModel.preferredRootId;
      const returnFocusId = previous?.triggerId || state.currentFolderId;
      latestSearchQuery = '';
      searchGeneration += 1;
      clearTimer('search');
      setState(buildFolderState(targetFolderId, { query: '' }));
      focusBookmarkItem(returnFocusId);
      return true;
    }

    async function permissionStillGranted() {
      if (!chromeApi?.permissions?.contains) return false;
      try {
        return await chromeApi.permissions.contains({ permissions: [BOOKMARKS_PERMISSION] });
      } catch {
        return false;
      }
    }

    async function handleApiFailure(error, context, isCurrent = () => true) {
      if (!isCurrent()) return;
      if (typeof options.onError === 'function') options.onError(error, context);
      const granted = await permissionStillGranted();
      if (disposed || !isCurrent()) return;
      if (!granted) {
        clearBookmarkData({ permission: 'revoked', status: 'revoked' });
        return;
      }
      if (context === 'get-tree') {
        bookmarkModel = null;
        visibleNodesById = new Map();
        publishSearchItems([]);
      }
      setState({
        status: 'error',
        notice: '',
        items: [],
        emptyReason: '',
      });
    }

    async function search(query = '') {
      const rawQuery = String(query || '');
      const normalizedQuery = rawQuery.trim();
      latestSearchQuery = rawQuery;
      clearTimer('search');
      const generation = ++searchGeneration;

      if (state.permission !== 'granted') {
        return [];
      }
      if (!normalizedQuery) {
        if (bookmarkModel) setState(buildFolderState(state.currentFolderId, { query: '' }));
        return state.items;
      }
      if (!bookmarkModel || !chromeApi?.bookmarks?.search) return [];

      setState({ status: 'searching', query: rawQuery, notice: '' });
      try {
        const results = await chromeApi.bookmarks.search(normalizedQuery);
        if (disposed || generation !== searchGeneration) return [];
        const nodes = (Array.isArray(results) ? results : []).map(result => {
          const known = modelApi.getBookmarkNode?.(bookmarkModel, result?.id);
          return known || result;
        });
        visibleNodesById = new Map(
          nodes
            .filter(node => node?.id !== undefined && node?.id !== null)
            .map(node => [String(node.id), node]),
        );
        const items = modelApi.normalizeBookmarkItems?.(bookmarkModel, nodes) || [];
        setState({
          status: items.length ? 'ready' : 'empty',
          query: rawQuery,
          items,
          notice: '',
          emptyReason: 'search',
        });
        return items;
      } catch (error) {
        if (generation !== searchGeneration) return [];
        await handleApiFailure(error, 'search', () => generation === searchGeneration);
        return [];
      }
    }

    function scheduleSearch(query = '') {
      const rawQuery = String(query || '');
      clearTimer('search');
      searchGeneration += 1;
      if (state.permission !== 'granted') return;
      // Record the user's latest input immediately without forcing a full DOM
      // redraw on every keystroke. Tree reloads can then preserve this intent
      // even before the debounce timer has fired.
      latestSearchQuery = rawQuery;
      state = { ...state, query: rawQuery };
      searchTimer = scheduleTimeout(() => {
        searchTimer = null;
        void search(rawQuery);
      }, searchDebounceMs);
    }

    async function loadTree({ preserveQuery = true } = {}) {
      if (state.permission !== 'granted') return false;
      if (!chromeApi?.bookmarks?.getTree) {
        bookmarkModel = null;
        visibleNodesById = new Map();
        publishSearchItems([]);
        const error = new Error('Bookmarks API is unavailable');
        if (typeof options.onError === 'function') options.onError(error, 'get-tree');
        setState({ status: 'error', items: [], notice: '', emptyReason: '' });
        return false;
      }
      if (!preserveQuery) {
        latestSearchQuery = '';
        state = { ...state, query: '' };
      }
      const generation = ++treeGeneration;
      const previousFolderId = state.currentFolderId;
      searchGeneration += 1;
      setState({ status: 'loading', notice: '', query: latestSearchQuery });

      try {
        const tree = await chromeApi.bookmarks.getTree();
        if (disposed || generation !== treeGeneration) return false;
        bookmarkModel = modelApi.createBookmarkModel?.(tree) || null;
        if (!bookmarkModel?.preferredRoot) {
          latestSearchQuery = '';
          publishSearchItems([]);
          setState({
            status: 'empty',
            currentFolderId: '',
            currentFolderTitle: '',
            query: '',
            breadcrumbs: [],
            items: [],
            notice: '',
            emptyReason: 'tree',
            isRootView: true,
          });
          return true;
        }

        refreshSearchItemsFromModel();
        // A bookmark event may have started this tree read before the user
        // typed a newer query. Restore against the latest input, not the query
        // captured when the read began, and invalidate any search that ran on
        // the old model while getTree was pending.
        const queryToRestore = latestSearchQuery;
        const folderState = buildFolderState(
          previousFolderId || bookmarkModel.preferredRootId,
          { query: queryToRestore },
        );
        setState(folderState);
        if (queryToRestore.trim()) await search(queryToRestore);
        return true;
      } catch (error) {
        if (generation !== treeGeneration) return false;
        await handleApiFailure(error, 'get-tree', () => generation === treeGeneration);
        return false;
      }
    }

    function scheduleTreeReload() {
      if (state.permission !== 'granted' || importInProgress) return;
      treeGeneration += 1;
      searchGeneration += 1;
      clearTimer('reload');
      reloadTimer = scheduleTimeout(() => {
        reloadTimer = null;
        void loadTree({ preserveQuery: true });
      }, eventDebounceMs);
    }

    function ensureBookmarkSubscriptions() {
      if (bookmarkSubscriptions.length || state.permission !== 'granted') return;
      const bookmarks = chromeApi?.bookmarks;
      if (!bookmarks) return;

      subscribe(bookmarks.onCreated, () => {
        if (!importInProgress) scheduleTreeReload();
      }, bookmarkSubscriptions);
      subscribe(bookmarks.onChanged, scheduleTreeReload, bookmarkSubscriptions);
      subscribe(bookmarks.onMoved, scheduleTreeReload, bookmarkSubscriptions);
      subscribe(bookmarks.onRemoved, scheduleTreeReload, bookmarkSubscriptions);
      subscribe(bookmarks.onChildrenReordered, scheduleTreeReload, bookmarkSubscriptions);
      subscribe(bookmarks.onImportBegan, () => {
        importInProgress = true;
        treeGeneration += 1;
        searchGeneration += 1;
        clearTimer('reload');
      }, bookmarkSubscriptions);
      subscribe(bookmarks.onImportEnded, () => {
        importInProgress = false;
        scheduleTreeReload();
      }, bookmarkSubscriptions);
    }

    function handlePermissionRemoved(detail) {
      if (!hasBookmarksPermissionDetail(detail)) return;
      clearBookmarkData({ permission: 'revoked', status: 'revoked' });
    }

    function handlePermissionAdded(detail) {
      if (!hasBookmarksPermissionDetail(detail)) return;
      setState({ permission: 'granted', status: 'loading' });
      ensureBookmarkSubscriptions();
      void loadTree({ preserveQuery: false });
    }

    function start() {
      if (started || disposed) return;
      started = true;
      subscribe(chromeApi?.permissions?.onRemoved, handlePermissionRemoved, permissionSubscriptions);
      subscribe(chromeApi?.permissions?.onAdded, handlePermissionAdded, permissionSubscriptions);
    }

    async function checkPermission({ load = true } = {}) {
      start();
      if (!chromeApi?.permissions?.contains) {
        setState({ status: 'error', permission: 'unknown' });
        return false;
      }

      const generation = ++permissionGeneration;
      setState({ status: 'checking', notice: '' });
      try {
        const granted = await chromeApi.permissions.contains({ permissions: [BOOKMARKS_PERMISSION] });
        if (disposed || generation !== permissionGeneration) return false;
        if (!granted) {
          const permission = state.permission === 'granted' ? 'revoked' : 'missing';
          clearBookmarkData({
            permission,
            status: permission === 'revoked' ? 'revoked' : 'permission-required',
          });
          return false;
        }

        setState({ permission: 'granted', status: load ? 'loading' : 'idle' });
        ensureBookmarkSubscriptions();
        if (load) await loadTree({ preserveQuery: false });
        return true;
      } catch (error) {
        if (generation !== permissionGeneration) return false;
        if (typeof options.onError === 'function') options.onError(error, 'check-permission');
        setState({ status: 'error', permission: 'unknown' });
        return false;
      }
    }

    async function requestPermission() {
      start();
      if (!chromeApi?.permissions?.request) {
        setState({ status: 'error', permission: 'unknown' });
        return false;
      }

      const generation = ++permissionGeneration;
      let requestPromise;
      try {
        // Keep this call as the first meaningful operation in the explicit
        // button handler so Chrome still sees the user gesture.
        requestPromise = chromeApi.permissions.request({ permissions: [BOOKMARKS_PERMISSION] });
      } catch (error) {
        if (typeof options.onError === 'function') options.onError(error, 'request-permission');
        setState({ status: 'error', permission: 'unknown' });
        return false;
      }

      setState({ status: 'checking', notice: '' });
      try {
        const granted = await requestPromise;
        if (disposed || generation !== permissionGeneration) return false;
        if (!granted) {
          clearBookmarkData({ permission: 'denied', status: 'denied' });
          return false;
        }
        setState({ permission: 'granted', status: 'loading' });
        ensureBookmarkSubscriptions();
        await loadTree({ preserveQuery: false });
        return true;
      } catch (error) {
        if (generation !== permissionGeneration) return false;
        if (typeof options.onError === 'function') options.onError(error, 'request-permission');
        setState({ status: 'error', permission: 'unknown' });
        return false;
      }
    }

    async function refresh() {
      if (state.permission !== 'granted') return checkPermission({ load: true });
      return loadTree({ preserveQuery: true });
    }

    function getActionElement(event) {
      const actionElement = event?.target?.closest?.('[data-bookmarks-action]') || null;
      if (!actionElement || (host?.contains && !host.contains(actionElement))) return null;
      return actionElement;
    }

    function handleHostClick(event) {
      const actionElement = getActionElement(event);
      if (!actionElement) return;
      const action = actionElement.dataset.bookmarksAction || '';

      if (action === 'request-permission') {
        event.preventDefault();
        void requestPermission().then(granted => {
          if (granted) focusShelfSearch();
          else if (!focusShelfAction('request-permission')) focusShelfAction('retry');
        });
        return;
      }
      if (action === 'open-manager') {
        event.preventDefault();
        void openNativeManager();
        return;
      }
      if (action === 'retry') {
        event.preventDefault();
        void refresh().then(refreshed => {
          if (refreshed) focusShelfSearch();
          else if (!focusShelfAction('retry')) focusShelfAction('request-permission');
        });
        return;
      }
      if (action === 'clear-search') {
        event.preventDefault();
        void search('').then(() => focusShelfSearch());
        return;
      }
      if (action === 'open-folder') {
        event.preventDefault();
        const fromBreadcrumb = actionElement.dataset.bookmarksBreadcrumb === 'true';
        if (fromBreadcrumb) folderNavigationHistory.length = 0;
        openFolder(actionElement.dataset.bookmarkId || '', { recordHistory: !fromBreadcrumb });
        return;
      }
      if (action === 'open-bookmark') {
        event.preventDefault();
        void openBookmark(actionElement.dataset.bookmarkId || '', event);
      }
    }

    function handleHostAuxClick(event) {
      if (Number(event?.button) !== 1) return;
      const actionElement = getActionElement(event);
      if (actionElement?.dataset.bookmarksAction !== 'open-bookmark') return;
      event.preventDefault();
      void openBookmark(actionElement.dataset.bookmarkId || '', event);
    }

    function handleHostInput(event) {
      const actionElement = getActionElement(event);
      if (actionElement?.dataset.bookmarksAction !== 'search') return;
      scheduleSearch(actionElement.value || '');
    }

    function handleHostKeydown(event) {
      if (event?.key !== 'Escape') return;
      if (state.query) {
        event.preventDefault?.();
        void search('').then(() => focusShelfSearch());
        return;
      }
      if (!state.isRootView) {
        event.preventDefault?.();
        closeFolderView();
      }
    }

    function handleHostError(event) {
      const image = event?.target;
      if (!image?.matches?.('img[data-bookmarks-favicon]')) return;
      image.hidden = true;
      const fallback = image.nextElementSibling;
      if (fallback?.matches?.('[data-bookmarks-favicon-fallback]')) fallback.hidden = false;
    }

    function detachHost() {
      if (!host?.removeEventListener) {
        host = null;
        return;
      }
      host.removeEventListener('click', handleHostClick);
      host.removeEventListener('auxclick', handleHostAuxClick);
      host.removeEventListener('input', handleHostInput);
      host.removeEventListener('keydown', handleHostKeydown);
      host.removeEventListener('error', handleHostError, true);
      host = null;
    }

    function mount(nextHost = null) {
      if (disposed) throw new Error('Bookmarks shelf has been disposed');
      detachHost();
      host = typeof nextHost === 'string'
        ? documentRef?.querySelector?.(nextHost) || null
        : nextHost;
      if (host?.addEventListener) {
        host.addEventListener('click', handleHostClick);
        host.addEventListener('auxclick', handleHostAuxClick);
        host.addEventListener('input', handleHostInput);
        host.addEventListener('keydown', handleHostKeydown);
        host.addEventListener('error', handleHostError, true);
      }
      start();
      render();
      if (options.autoCheck !== false) void checkPermission({ load: true });
      return controller;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      detachHost();
      invalidateAsyncWork();
      removeSubscriptions(bookmarkSubscriptions);
      removeSubscriptions(permissionSubscriptions);
      bookmarkModel = null;
      visibleNodesById = new Map();
      latestSearchQuery = '';
      searchItems = [];
      searchItemsSignature = '';
    }

    const controller = {
      checkPermission,
      closeFolderView,
      dispose,
      getSearchItems,
      getState,
      loadTree,
      mount,
      openBookmark,
      openFolder,
      openNativeManager,
      refresh,
      requestPermission,
      scheduleSearch,
      search,
      setShowFavicons,
    };

    return controller;
  }

  function mountBookmarksShelf(host, options = {}) {
    const controller = createBookmarksShelf(options);
    return controller.mount(host);
  }

  const api = {
    BOOKMARKS_PERMISSION,
    DEFAULT_MESSAGES,
    NATIVE_BOOKMARK_MANAGER_URL,
    createBookmarksShelf,
    mountBookmarksShelf,
    renderBookmarksShelfMarkup,
  };

  globalScope.TabHarborBookmarksShelf = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
