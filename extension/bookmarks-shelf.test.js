'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NATIVE_BOOKMARK_MANAGER_URL,
  createBookmarksShelf,
  renderBookmarksShelfMarkup,
} = require('./bookmarks-shelf.js');

function createEvent() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    emit(...args) {
      [...listeners].forEach(listener => listener(...args));
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

function makeTree({ rootTitle = 'Chrome bar', linkTitle = 'Example', linkUrl = 'https://example.com/' } = {}) {
  return [{
    id: 'browser-root',
    title: '',
    children: [
      {
        id: 'other-root',
        title: 'Other',
        folderType: 'other',
        parentId: 'browser-root',
        children: [],
      },
      {
        id: 'bar-root',
        title: rootTitle,
        folderType: 'bookmarks-bar',
        parentId: 'browser-root',
        children: [
          {
            id: 'nested-folder',
            title: 'Reading',
            parentId: 'bar-root',
            children: [{
              id: 'nested-link',
              title: 'Nested article',
              parentId: 'nested-folder',
              url: 'https://nested.example/article',
            }],
          },
          {
            id: 'safe-link',
            title: linkTitle,
            parentId: 'bar-root',
            url: linkUrl,
          },
          {
            id: 'dangerous-link',
            title: 'Bookmarklet',
            parentId: 'bar-root',
            url: 'javascript:alert(1)',
          },
        ],
      },
    ],
  }];
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createChromeMock({
  granted = false,
  requestResult = true,
  tree = makeTree(),
  searchResults = [],
} = {}) {
  const calls = {
    contains: [],
    request: [],
    getTree: 0,
    search: [],
    tabsCreate: [],
    tabsUpdate: [],
    windowsCreate: [],
  };
  const events = {
    permissionAdded: createEvent(),
    permissionRemoved: createEvent(),
    created: createEvent(),
    changed: createEvent(),
    moved: createEvent(),
    removed: createEvent(),
    childrenReordered: createEvent(),
    importBegan: createEvent(),
    importEnded: createEvent(),
  };

  let permissionGranted = granted;
  let nextRequestResult = requestResult;
  let currentTree = tree;
  let currentSearchResults = searchResults;

  const chromeApi = {
    permissions: {
      async contains(details) {
        calls.contains.push(details);
        return permissionGranted;
      },
      async request(details) {
        calls.request.push(details);
        permissionGranted = nextRequestResult;
        return nextRequestResult;
      },
      onAdded: events.permissionAdded,
      onRemoved: events.permissionRemoved,
    },
    bookmarks: {
      async getTree() {
        calls.getTree += 1;
        if (currentTree instanceof Error) throw currentTree;
        if (currentTree && typeof currentTree.then === 'function') return currentTree;
        return currentTree;
      },
      async search(query) {
        calls.search.push(query);
        if (currentSearchResults instanceof Error) throw currentSearchResults;
        return currentSearchResults;
      },
      onCreated: events.created,
      onChanged: events.changed,
      onMoved: events.moved,
      onRemoved: events.removed,
      onChildrenReordered: events.childrenReordered,
      onImportBegan: events.importBegan,
      onImportEnded: events.importEnded,
    },
    tabs: {
      async getCurrent() {
        return { id: 77 };
      },
      async query() {
        return [{ id: 78 }];
      },
      async update(tabId, updateProperties) {
        calls.tabsUpdate.push({ tabId, updateProperties });
      },
      async create(createProperties) {
        calls.tabsCreate.push(createProperties);
      },
    },
    windows: {
      async create(createProperties) {
        calls.windowsCreate.push(createProperties);
      },
    },
  };

  return {
    calls,
    chromeApi,
    events,
    setGranted(value) {
      permissionGranted = Boolean(value);
    },
    setRequestResult(value) {
      nextRequestResult = Boolean(value);
    },
    setSearchResults(value) {
      currentSearchResults = value;
    },
    setTree(value) {
      currentTree = value;
    },
  };
}

function wait(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('default markup is self-contained, quiet, and escapes bookmark content', () => {
  const html = renderBookmarksShelfMarkup({
    status: 'ready',
    permission: 'granted',
    query: '<query>',
    breadcrumbs: [{ id: 'folder"id', title: 'A & B' }],
    items: [{
      id: 'link"id',
      title: '<script>alert(1)</script>',
      url: 'https://example.com/?a=1&b=2',
      isFolder: false,
      path: [{ id: 'p', title: 'A & B' }],
    }],
    notice: '',
  });

  assert.match(html, /data-bookmarks-shelf/);
  assert.match(html, /data-bookmarks-action="search"/);
  assert.match(html, /data-bookmarks-action="open-manager"/);
  assert.match(html, /data-bookmarks-action="open-bookmark"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /link&quot;id/);
  assert.match(html, /aria-label="Bookmark: &lt;script&gt;alert\(1\)&lt;\/script&gt; — A &amp; B — https:\/\/example\.com/);
  assert.doesNotMatch(html, /data-bookmarks-favicon/);
});

test('permission, retry, and clear-search actions return focus inside the shelf', async () => {
  const mock = createChromeMock({
    granted: false,
    requestResult: false,
    searchResults: [{ id: 'safe-link', title: 'Example', url: 'https://example.com/' }],
  });
  const listeners = new Map();
  let activeElement = null;
  let currentElements = [];
  const makeElement = (action, disabled = false) => ({
    dataset: { bookmarksAction: action },
    disabled,
    focus() { if (!this.disabled) activeElement = this; },
    closest(selector) { return selector === '[data-bookmarks-action]' ? this : null; },
  });
  const host = {
    _html: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    contains(node) { return currentElements.includes(node); },
    set innerHTML(value) {
      this._html = value;
      currentElements = [];
      for (const action of ['search', 'request-permission', 'retry', 'clear-search', 'open-manager']) {
        if (value.includes(`data-bookmarks-action="${action}"`)) {
          currentElements.push(makeElement(action, action === 'search' && value.includes('data-bookmarks-action="search" disabled')));
        }
      }
    },
    get innerHTML() { return this._html; },
    querySelector(selector) {
      if (selector === '[data-bookmarks-action="search"]') {
        return currentElements.find(element => element.dataset.bookmarksAction === 'search') || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[data-bookmarks-action]' ? currentElements : [];
    },
  };
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    document: { get activeElement() { return activeElement; } },
    autoCheck: false,
  });
  shelf.mount(host);
  await shelf.checkPermission();

  activeElement = currentElements.find(element => element.dataset.bookmarksAction === 'request-permission');
  listeners.get('click')({ target: activeElement, preventDefault() {} });
  await wait();
  assert.equal(activeElement.dataset.bookmarksAction, 'request-permission');

  mock.setRequestResult(true);
  listeners.get('click')({ target: activeElement, preventDefault() {} });
  await wait();
  assert.equal(activeElement.dataset.bookmarksAction, 'search');

  await shelf.search('example');
  activeElement = currentElements.find(element => element.dataset.bookmarksAction === 'clear-search');
  listeners.get('click')({ target: activeElement, preventDefault() {} });
  await wait();
  assert.equal(activeElement.dataset.bookmarksAction, 'search');

  mock.setTree(new Error('temporary failure'));
  await shelf.refresh();
  activeElement = currentElements.find(element => element.dataset.bookmarksAction === 'retry');
  mock.setTree(makeTree());
  listeners.get('click')({ target: activeElement, preventDefault() {} });
  await wait();
  assert.equal(activeElement.dataset.bookmarksAction, 'search');
  shelf.dispose();
});

test('default markup exposes root, folder, and search view modes for layout styling', () => {
  const common = {
    status: 'ready',
    permission: 'granted',
    breadcrumbs: [],
    items: [],
    notice: '',
  };
  assert.match(
    renderBookmarksShelfMarkup({ ...common, isRootView: true, query: '' }),
    /data-view="root"/,
  );
  assert.match(
    renderBookmarksShelfMarkup({ ...common, isRootView: false, query: '' }),
    /data-view="folder"/,
  );
  assert.match(
    renderBookmarksShelfMarkup({ ...common, isRootView: true, query: 'read' }),
    /data-view="search"/,
  );
});

test('bookmark favicons are opt-in, Chrome-local only, and update without reloading the tree', async () => {
  const mock = createChromeMock({ granted: true });
  const faviconCalls = [];
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    autoCheck: false,
    getFaviconUrl(input) {
      faviconCalls.push(input);
      const pageUrl = String(input?.domain || '');
      if (!/^https?:/i.test(pageUrl)) return { url: '', source: '', fallback: '' };
      return {
        url: `chrome-extension://test-id/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${input.size}`,
        source: 'chrome',
        fallback: 'https://example.com/favicon.ico',
      };
    },
  });
  await shelf.checkPermission();

  assert.equal(shelf.getState().showFavicons, false);
  assert.equal(faviconCalls.length, 0);
  const treeReads = mock.calls.getTree;

  assert.equal(shelf.setShowFavicons(true), true);
  const state = shelf.getState();
  const safeLink = state.items.find(item => item.id === 'safe-link');
  const folder = state.items.find(item => item.id === 'nested-folder');
  assert.match(safeLink.faviconUrl, /^chrome-extension:\/\/test-id\/_favicon\//);
  assert.equal(folder.faviconUrl, '');
  assert.equal(mock.calls.getTree, treeReads);
  assert.ok(faviconCalls.every(call => call.size === 16));

  const html = renderBookmarksShelfMarkup(state);
  assert.match(html, /class="bookmarks-shelf-favicon"[^>]+alt=""[^>]+data-bookmarks-favicon/);
  assert.match(html, /aria-label="Bookmark: Example — Chrome bar — https:\/\/example\.com\//);
  const folderStart = html.indexOf('data-bookmark-id="nested-folder"');
  const folderMarkup = html.slice(folderStart, html.indexOf('</button>', folderStart));
  assert.match(folderMarkup, />▱<\/span>/);
  assert.doesNotMatch(folderMarkup, /<img/);
  const remoteMarkup = renderBookmarksShelfMarkup({
    ...state,
    items: [{ ...safeLink, faviconUrl: 'https://example.com/favicon.ico' }],
  });
  assert.doesNotMatch(remoteMarkup, /data-bookmarks-favicon/);
  shelf.dispose();

  const remoteMock = createChromeMock({ granted: true });
  const remoteShelf = createBookmarksShelf({
    chromeApi: remoteMock.chromeApi,
    autoCheck: false,
    showFavicons: true,
    getFaviconUrl: () => ({
      url: 'https://example.com/favicon.ico',
      source: 'chrome',
      fallback: '',
    }),
  });
  await remoteShelf.checkPermission();
  assert.ok(remoteShelf.getState().items.every(item => !item.faviconUrl));
  remoteShelf.dispose();
});

test('failed bookmark favicon images reveal the quiet glyph fallback', () => {
  const listeners = new Map();
  const host = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    contains() { return false; },
    set innerHTML(value) { this._html = value; },
    get innerHTML() { return this._html || ''; },
  };
  const shelf = createBookmarksShelf({ autoCheck: false });
  shelf.mount(host);

  const fallback = {
    hidden: true,
    matches(selector) { return selector === '[data-bookmarks-favicon-fallback]'; },
  };
  const image = {
    hidden: false,
    nextElementSibling: fallback,
    matches(selector) { return selector === 'img[data-bookmarks-favicon]'; },
  };
  listeners.get('error')({ target: image });
  assert.equal(image.hidden, true);
  assert.equal(fallback.hidden, false);

  shelf.dispose();
  assert.equal(listeners.has('error'), false);
});

test('initial permission check shows a gate without requesting permission or reading bookmarks', async () => {
  const mock = createChromeMock({ granted: false });
  const shelf = createBookmarksShelf({ chromeApi: mock.chromeApi, autoCheck: false });

  const granted = await shelf.checkPermission();
  assert.equal(granted, false);
  assert.equal(shelf.getState().status, 'permission-required');
  assert.equal(shelf.getState().permission, 'missing');
  assert.equal(mock.calls.contains.length, 1);
  assert.equal(mock.calls.request.length, 0);
  assert.equal(mock.calls.getTree, 0);
  shelf.dispose();
});

test('search while unauthorized is inert and never requests permission', async () => {
  const mock = createChromeMock({ granted: false });
  const shelf = createBookmarksShelf({ chromeApi: mock.chromeApi, autoCheck: false });
  await shelf.checkPermission();

  const results = await shelf.search('example');
  shelf.scheduleSearch('another');
  await wait(5);

  assert.deepEqual(results, []);
  assert.equal(mock.calls.request.length, 0);
  assert.equal(mock.calls.search.length, 0);
  shelf.dispose();
});

test('permission request only loads the tree after explicit grant', async () => {
  const deniedMock = createChromeMock({ granted: false, requestResult: false });
  const deniedShelf = createBookmarksShelf({ chromeApi: deniedMock.chromeApi, autoCheck: false });
  assert.equal(await deniedShelf.requestPermission(), false);
  assert.equal(deniedShelf.getState().status, 'denied');
  assert.equal(deniedMock.calls.request.length, 1);
  assert.equal(deniedMock.calls.getTree, 0);
  deniedShelf.dispose();

  const grantedMock = createChromeMock({ granted: false, requestResult: true });
  const grantedShelf = createBookmarksShelf({ chromeApi: grantedMock.chromeApi, autoCheck: false });
  assert.equal(await grantedShelf.requestPermission(), true);
  assert.equal(grantedShelf.getState().permission, 'granted');
  assert.equal(grantedShelf.getState().status, 'ready');
  assert.equal(grantedShelf.getState().currentFolderId, 'bar-root');
  assert.equal(grantedShelf.getState().isRootView, true);
  assert.equal(grantedMock.calls.getTree, 1);
  grantedShelf.dispose();
});

test('granted shelves browse folders one level at a time with breadcrumbs', async () => {
  const mock = createChromeMock({ granted: true });
  const shelf = createBookmarksShelf({ chromeApi: mock.chromeApi, autoCheck: false });
  await shelf.checkPermission();

  assert.deepEqual(shelf.getState().items.map(item => item.id), [
    'nested-folder',
    'safe-link',
    'dangerous-link',
  ]);
  assert.equal(shelf.openFolder('nested-folder'), true);
  assert.equal(shelf.getState().currentFolderId, 'nested-folder');
  assert.equal(shelf.getState().isRootView, false);
  assert.deepEqual(shelf.getState().breadcrumbs.map(item => item.id), ['bar-root', 'nested-folder']);
  assert.deepEqual(shelf.getState().items.map(item => item.id), ['nested-link']);

  assert.equal(shelf.openFolder('bar-root'), true);
  assert.equal(shelf.getState().currentFolderId, 'bar-root');
  assert.equal(shelf.getState().isRootView, true);
  shelf.dispose();
});

test('Escape returns an inline folder view to its parent and restores focus to the folder trigger', async () => {
  const mock = createChromeMock({ granted: true });
  const listeners = new Map();
  let folderFocusCount = 0;
  let searchFocusCount = 0;
  const folderTrigger = {
    dataset: { bookmarkId: 'nested-folder' },
    focus() { folderFocusCount += 1; },
  };
  const searchInput = {
    focus() { searchFocusCount += 1; },
  };
  const host = {
    innerHTML: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    querySelector(selector) {
      return selector === '[data-bookmarks-action="search"]' ? searchInput : null;
    },
    querySelectorAll(selector) {
      return selector === '[data-bookmark-id]' ? [folderTrigger] : [];
    },
    contains() { return true; },
  };
  const shelf = createBookmarksShelf({ chromeApi: mock.chromeApi, autoCheck: false });
  shelf.mount(host);
  await shelf.checkPermission();

  shelf.openFolder('nested-folder');
  assert.equal(shelf.getState().currentFolderId, 'nested-folder');
  let prevented = 0;
  listeners.get('keydown')({ key: 'Escape', preventDefault() { prevented += 1; } });
  assert.equal(shelf.getState().currentFolderId, 'bar-root');
  assert.equal(folderFocusCount, 1);
  assert.equal(prevented, 1);

  await shelf.search('nested');
  listeners.get('keydown')({ key: 'Escape', preventDefault() { prevented += 1; } });
  await wait();
  assert.equal(shelf.getState().query, '');
  assert.equal(searchFocusCount, 1);
  assert.equal(prevented, 2);
  shelf.dispose();
});

test('rerenders preserve search focus and hand folder focus to the new inline view', async () => {
  const mock = createChromeMock({
    granted: true,
    searchResults: [{ id: 'safe-link', title: 'Example', url: 'https://example.com/' }],
  });
  let activeElement = null;
  let currentSearch = null;
  let firstFolderItem = null;
  let restoredSelection = null;
  const makeSearch = () => ({
    dataset: { bookmarksAction: 'search' },
    selectionStart: 3,
    selectionEnd: 3,
    focus() { activeElement = this; },
    setSelectionRange(start, end) { restoredSelection = [start, end]; },
  });
  const host = {
    _html: '',
    addEventListener() {},
    removeEventListener() {},
    contains(node) { return node === activeElement; },
    set innerHTML(value) {
      this._html = value;
      currentSearch = makeSearch();
      firstFolderItem = {
        dataset: { bookmarksAction: 'open-bookmark', bookmarkId: 'nested-link' },
        focus() { activeElement = this; },
      };
    },
    get innerHTML() { return this._html; },
    querySelector(selector) {
      if (selector === '[data-bookmarks-action="search"]') return currentSearch;
      if (selector.includes('[data-bookmarks-action="open-folder"]')) return firstFolderItem;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const documentRef = {
    get activeElement() { return activeElement; },
  };
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    document: documentRef,
    autoCheck: false,
  });
  shelf.mount(host);
  await shelf.checkPermission();

  activeElement = currentSearch;
  await shelf.search('exa');
  assert.equal(activeElement, currentSearch);
  assert.deepEqual(restoredSelection, [3, 3]);

  activeElement = {
    dataset: { bookmarksAction: 'open-folder', bookmarkId: 'nested-folder' },
  };
  shelf.openFolder('nested-folder');
  assert.equal(activeElement, firstFolderItem);
  shelf.dispose();
});

test('keyboard entry into an empty folder keeps focus inside the shelf', async () => {
  const tree = makeTree();
  tree[0].children[1].children.unshift({
    id: 'empty-folder',
    title: 'Empty',
    parentId: 'bar-root',
    children: [],
  });
  const mock = createChromeMock({ granted: true, tree });
  let activeElement = null;
  let currentSearch = null;
  const host = {
    _html: '',
    addEventListener() {},
    removeEventListener() {},
    contains(node) { return node === activeElement; },
    set innerHTML(value) {
      this._html = value;
      currentSearch = {
        dataset: { bookmarksAction: 'search' },
        focus() { activeElement = this; },
      };
    },
    get innerHTML() { return this._html; },
    querySelector(selector) {
      if (selector === '[data-bookmarks-action="search"]') return currentSearch;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    document: { get activeElement() { return activeElement; } },
    autoCheck: false,
  });
  shelf.mount(host);
  await shelf.checkPermission();

  activeElement = {
    dataset: { bookmarksAction: 'open-folder', bookmarkId: 'empty-folder' },
  };
  shelf.openFolder('empty-folder');

  assert.equal(shelf.getState().status, 'empty');
  assert.equal(activeElement, currentSearch);
  shelf.dispose();
});

test('getSearchItems exposes safe bookmark leaves from the full tree and never requests permission', async () => {
  const tree = makeTree();
  tree[0].children[0].children.push({
    id: 'outside-link',
    title: 'Outside bar',
    parentId: 'other-root',
    url: 'https://outside.example/',
  });
  const mock = createChromeMock({ granted: true, tree });
  const changes = [];
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    autoCheck: false,
    onBookmarksChange: items => changes.push(items),
  });
  await shelf.checkPermission();

  const items = shelf.getSearchItems();
  assert.deepEqual(items.map(item => item.id), [
    'outside-link',
    'nested-link',
    'safe-link',
  ]);
  assert.deepEqual(
    items.find(item => item.id === 'nested-link').path.map(segment => segment.id),
    ['bar-root', 'nested-folder'],
  );
  assert.ok(!items.some(item => item.id === 'dangerous-link'));
  assert.equal(mock.calls.request.length, 0);
  assert.deepEqual(changes.at(-1), items);

  // Consumers receive copies and cannot mutate the controller cache.
  items[0].title = 'mutated';
  items[0].path.length = 0;
  assert.equal(shelf.getSearchItems()[0].title, 'Outside bar');
  assert.equal(shelf.getSearchItems()[0].path.length, 1);
  shelf.dispose();
});

test('getSearchItems is empty before permission and onBookmarksChange updates after tree events', async () => {
  const mock = createChromeMock({ granted: false });
  const changes = [];
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    autoCheck: false,
    eventDebounceMs: 5,
    onBookmarksChange: items => changes.push(items.map(item => item.id)),
  });
  await shelf.checkPermission();
  assert.deepEqual(shelf.getSearchItems(), []);
  assert.deepEqual(changes.at(-1), []);
  assert.equal(mock.calls.request.length, 0);

  mock.setRequestResult(true);
  await shelf.requestPermission();
  assert.ok(shelf.getSearchItems().some(item => item.id === 'safe-link'));

  const updatedTree = makeTree({ linkTitle: 'Updated title' });
  updatedTree[0].children[1].children.push({
    id: 'event-link',
    title: 'Added elsewhere',
    parentId: 'bar-root',
    url: 'https://event.example/',
  });
  mock.setTree(updatedTree);
  mock.events.created.emit('event-link', {});
  await wait(20);

  assert.ok(shelf.getSearchItems().some(item => item.id === 'event-link'));
  assert.ok(changes.at(-1).includes('event-link'));
  shelf.dispose();
});

test('bookmark opening honors current, background, middle-click, and new-window semantics', async () => {
  const mock = createChromeMock({ granted: true });
  const opened = [];
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    autoCheck: false,
    navigateCurrent: async url => opened.push(['current', url]),
    openBackground: async url => opened.push(['background', url]),
    openWindow: async url => opened.push(['window', url]),
  });
  await shelf.checkPermission();

  await shelf.openBookmark('safe-link');
  await shelf.openBookmark('safe-link', { ctrlKey: true });
  await shelf.openBookmark('safe-link', { metaKey: true });
  await shelf.openBookmark('safe-link', { button: 1 });
  await shelf.openBookmark('safe-link', { shiftKey: true, ctrlKey: true });

  assert.deepEqual(opened.map(item => item[0]), [
    'current',
    'background',
    'background',
    'background',
    'window',
  ]);
  assert.ok(opened.every(item => item[1] === 'https://example.com/'));
  shelf.dispose();
});

test('dangerous bookmark protocols are blocked before any navigation callback', async () => {
  const mock = createChromeMock({ granted: true });
  const opened = [];
  const blocked = [];
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    autoCheck: false,
    navigateCurrent: async url => opened.push(url),
    onOpenBlocked: payload => blocked.push(payload),
  });
  await shelf.checkPermission();

  assert.equal(await shelf.openBookmark('dangerous-link'), false);
  assert.deepEqual(opened, []);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].url, 'javascript:alert(1)');
  assert.match(shelf.getState().notice, /will not open/i);
  shelf.dispose();
});

test('default open adapters update the current tab, create background tabs, windows, and native manager tabs', async () => {
  const mock = createChromeMock({ granted: true });
  const shelf = createBookmarksShelf({ chromeApi: mock.chromeApi, autoCheck: false });
  await shelf.checkPermission();

  await shelf.openBookmark('safe-link');
  await shelf.openBookmark('safe-link', { ctrlKey: true });
  await shelf.openBookmark('safe-link', { shiftKey: true });
  await shelf.openNativeManager();

  assert.deepEqual(mock.calls.tabsUpdate, [{
    tabId: 77,
    updateProperties: { url: 'https://example.com/' },
  }]);
  assert.deepEqual(mock.calls.tabsCreate, [
    { url: 'https://example.com/', active: false },
    { url: NATIVE_BOOKMARK_MANAGER_URL, active: true },
  ]);
  assert.deepEqual(mock.calls.windowsCreate, [{
    url: 'https://example.com/',
    focused: true,
  }]);
  shelf.dispose();
});

test('authorized search uses Chrome search, preserves folder paths, and can open fresh result nodes', async () => {
  const mock = createChromeMock({
    granted: true,
    searchResults: [{
      id: 'fresh-result',
      parentId: 'bar-root',
      title: 'Fresh result',
      url: 'https://fresh.example/',
    }],
  });
  const opened = [];
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    autoCheck: false,
    navigateCurrent: async url => opened.push(url),
  });
  await shelf.checkPermission();

  const results = await shelf.search('fresh');
  assert.equal(mock.calls.search[0], 'fresh');
  assert.equal(results[0].id, 'fresh-result');
  assert.equal(shelf.getState().query, 'fresh');
  assert.equal(await shelf.openBookmark('fresh-result'), true);
  assert.deepEqual(opened, ['https://fresh.example/']);

  await shelf.search('');
  assert.equal(shelf.getState().query, '');
  assert.equal(shelf.getState().currentFolderId, 'bar-root');
  shelf.dispose();
});

test('bookmark events are debounced into one reload and imports refresh once at the end', async () => {
  const mock = createChromeMock({ granted: true });
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    autoCheck: false,
    eventDebounceMs: 5,
  });
  await shelf.checkPermission();
  assert.equal(mock.calls.getTree, 1);

  mock.events.changed.emit('safe-link', { title: 'Changed' });
  mock.events.moved.emit('safe-link', {});
  mock.events.removed.emit('safe-link', {});
  await wait(20);
  assert.equal(mock.calls.getTree, 2);

  mock.events.importBegan.emit();
  mock.events.created.emit('import-1', {});
  mock.events.created.emit('import-2', {});
  await wait(10);
  assert.equal(mock.calls.getTree, 2);
  mock.events.importEnded.emit();
  await wait(20);
  assert.equal(mock.calls.getTree, 3);
  shelf.dispose();
});

test('generation tokens prevent stale tree loads from replacing newer state', async () => {
  const mock = createChromeMock({ granted: true });
  const shelf = createBookmarksShelf({ chromeApi: mock.chromeApi, autoCheck: false });
  await shelf.checkPermission();

  const first = deferred();
  const second = deferred();
  const queued = [first.promise, second.promise];
  mock.chromeApi.bookmarks.getTree = async () => {
    mock.calls.getTree += 1;
    return queued.shift();
  };

  const staleLoad = shelf.loadTree({ preserveQuery: false });
  const freshLoad = shelf.loadTree({ preserveQuery: false });
  second.resolve(makeTree({ rootTitle: 'Fresh root', linkTitle: 'Fresh link', linkUrl: 'https://fresh.example/' }));
  await freshLoad;
  first.resolve(makeTree({ rootTitle: 'Stale root', linkTitle: 'Stale link', linkUrl: 'https://stale.example/' }));
  await staleLoad;

  assert.equal(shelf.getState().currentFolderTitle, 'Fresh root');
  assert.equal(shelf.getState().items.find(item => item.id === 'safe-link').title, 'Fresh link');
  shelf.dispose();
});

test('a query typed during a deferred tree reload wins over the reload snapshot', async () => {
  const mock = createChromeMock({
    granted: true,
    searchResults: [{
      id: 'fresh-result',
      parentId: 'bar-root',
      title: 'Fresh result',
      url: 'https://fresh.example/',
    }],
  });
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    autoCheck: false,
    searchDebounceMs: 0,
  });
  await shelf.checkPermission();

  const delayedTree = deferred();
  mock.setTree(delayedTree.promise);
  const reload = shelf.loadTree({ preserveQuery: true });
  shelf.scheduleSearch('fresh');
  await wait();
  assert.equal(shelf.getState().query, 'fresh', 'the new query can run while the old tree read is pending');

  delayedTree.resolve(makeTree({ rootTitle: 'Reloaded root' }));
  await reload;

  assert.equal(shelf.getState().query, 'fresh');
  assert.equal(shelf.getState().status, 'ready');
  assert.deepEqual(shelf.getState().items.map(item => item.id), ['fresh-result']);
  assert.equal(mock.calls.search.at(-1), 'fresh');
  shelf.dispose();
});

test('a still-debounced query also survives when the tree reload finishes first', async () => {
  const mock = createChromeMock({
    granted: true,
    searchResults: [{
      id: 'pending-result',
      parentId: 'bar-root',
      title: 'Pending result',
      url: 'https://pending.example/',
    }],
  });
  const shelf = createBookmarksShelf({
    chromeApi: mock.chromeApi,
    autoCheck: false,
    searchDebounceMs: 100,
  });
  await shelf.checkPermission();

  const delayedTree = deferred();
  mock.setTree(delayedTree.promise);
  const reload = shelf.loadTree({ preserveQuery: true });
  shelf.scheduleSearch('pending');
  delayedTree.resolve(makeTree({ rootTitle: 'Reloaded first' }));
  await reload;

  assert.equal(shelf.getState().query, 'pending');
  assert.deepEqual(shelf.getState().items.map(item => item.id), ['pending-result']);
  assert.equal(mock.calls.search.at(-1), 'pending');
  shelf.dispose();
});

test('a stale API failure cannot overwrite a newer successful tree after permission recheck', async () => {
  const mock = createChromeMock({ granted: true });
  const shelf = createBookmarksShelf({ chromeApi: mock.chromeApi, autoCheck: false });
  await shelf.checkPermission();

  const delayedPermission = deferred();
  mock.chromeApi.permissions.contains = async () => delayedPermission.promise;
  mock.setTree(new Error('stale read failed'));
  const staleLoad = shelf.loadTree({ preserveQuery: false });
  await wait();

  mock.setTree(makeTree({ rootTitle: 'Fresh root', linkTitle: 'Fresh link' }));
  const freshLoad = shelf.loadTree({ preserveQuery: false });
  await freshLoad;
  delayedPermission.resolve(true);
  await staleLoad;

  assert.equal(shelf.getState().status, 'ready');
  assert.equal(shelf.getState().currentFolderTitle, 'Fresh root');
  assert.equal(shelf.getState().items.find(item => item.id === 'safe-link').title, 'Fresh link');
  shelf.dispose();
});

test('permission revocation clears bookmark data and makes later searches inert', async () => {
  const mock = createChromeMock({ granted: true });
  const shelf = createBookmarksShelf({ chromeApi: mock.chromeApi, autoCheck: false });
  await shelf.checkPermission();
  assert.ok(shelf.getState().items.length > 0);

  mock.setGranted(false);
  mock.events.permissionRemoved.emit({ permissions: ['bookmarks'] });
  assert.equal(shelf.getState().status, 'revoked');
  assert.equal(shelf.getState().permission, 'revoked');
  assert.deepEqual(shelf.getState().items, []);

  await shelf.search('example');
  assert.equal(mock.calls.search.length, 0);
  shelf.dispose();
});

test('empty trees and API failures use quiet non-destructive states', async () => {
  const emptyMock = createChromeMock({
    granted: true,
    tree: [{ id: 'only-root', title: '', children: [] }],
  });
  const emptyShelf = createBookmarksShelf({ chromeApi: emptyMock.chromeApi, autoCheck: false });
  await emptyShelf.checkPermission();
  assert.equal(emptyShelf.getState().status, 'empty');
  assert.equal(emptyShelf.getState().emptyReason, 'tree');
  emptyShelf.dispose();

  const failingMock = createChromeMock({ granted: true, tree: new Error('private failure') });
  const errors = [];
  const failingShelf = createBookmarksShelf({
    chromeApi: failingMock.chromeApi,
    autoCheck: false,
    onError: (error, context) => errors.push({ error, context }),
  });
  await failingShelf.checkPermission();
  assert.equal(failingShelf.getState().status, 'error');
  assert.equal(failingShelf.getState().notice, '');
  assert.equal(errors[0].context, 'get-tree');
  failingShelf.dispose();

  const unavailableMock = createChromeMock({ granted: true });
  delete unavailableMock.chromeApi.bookmarks.getTree;
  const unavailableShelf = createBookmarksShelf({
    chromeApi: unavailableMock.chromeApi,
    autoCheck: false,
  });
  await unavailableShelf.checkPermission();
  assert.equal(unavailableShelf.getState().status, 'error');
  assert.deepEqual(unavailableShelf.getSearchItems(), []);
  unavailableShelf.dispose();
});

test('dispose removes Chrome event subscriptions and invalidates future updates', async () => {
  const mock = createChromeMock({ granted: true });
  const shelf = createBookmarksShelf({ chromeApi: mock.chromeApi, autoCheck: false });
  await shelf.checkPermission();

  assert.equal(mock.events.permissionRemoved.listenerCount(), 1);
  assert.equal(mock.events.changed.listenerCount(), 1);
  shelf.dispose();
  assert.equal(mock.events.permissionRemoved.listenerCount(), 0);
  assert.equal(mock.events.changed.listenerCount(), 0);
});
