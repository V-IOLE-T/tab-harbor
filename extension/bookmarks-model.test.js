'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createBookmarkModel,
  getBookmarkBreadcrumbs,
  getBookmarkFolderView,
  getBookmarkLeafItems,
  getSafeBookmarkUrl,
  isNodeWithinFolder,
  isSafeBookmarkUrl,
  normalizeBookmarkItem,
  selectPreferredBookmarkRoot,
} = require('./bookmarks-model.js');

function makeTree() {
  return [{
    id: 'root-dynamic',
    title: '',
    children: [
      {
        id: 'other-first',
        parentId: 'root-dynamic',
        title: 'Other shelf',
        folderType: 'other',
        children: [{
          id: 'other-link',
          parentId: 'other-first',
          title: 'Elsewhere',
          url: 'https://elsewhere.example/',
        }],
      },
      {
        id: 'bar-dynamic',
        parentId: 'root-dynamic',
        title: 'Toolbar from Chrome',
        folderType: 'bookmarks-bar',
        children: [
          {
            id: 'folder-a',
            parentId: 'bar-dynamic',
            title: 'Reading',
            children: [{
              id: 'folder-b',
              parentId: 'folder-a',
              title: 'Later',
              children: [{
                id: 'safe-link',
                parentId: 'folder-b',
                title: 'Article',
                url: 'https://example.com/article',
              }],
            }],
          },
          {
            id: 'root-link',
            parentId: 'bar-dynamic',
            title: 'Root link',
            url: 'https://root.example/',
          },
        ],
      },
    ],
  }];
}

test('selectPreferredBookmarkRoot prefers folderType bookmarks-bar without fixed IDs or titles', () => {
  const root = selectPreferredBookmarkRoot(makeTree());
  assert.equal(root.id, 'bar-dynamic');
  assert.equal(root.title, 'Toolbar from Chrome');
});

test('selectPreferredBookmarkRoot falls back to the first folder under the browser root', () => {
  const tree = [{
    id: 'anything',
    children: [
      { id: 'link-first', title: 'Link', url: 'https://example.com/' },
      { id: 'folder-first', title: 'Localized name', children: [] },
      { id: 'folder-second', title: 'Another folder', children: [] },
    ],
  }];
  assert.equal(selectPreferredBookmarkRoot(tree)?.id, 'folder-first');
});

test('selectPreferredBookmarkRoot returns null for malformed or folderless trees', () => {
  assert.equal(selectPreferredBookmarkRoot(null), null);
  assert.equal(selectPreferredBookmarkRoot([]), null);
  assert.equal(selectPreferredBookmarkRoot([{ id: 'root', children: [] }]), null);
  assert.equal(selectPreferredBookmarkRoot([{
    id: 'root',
    children: [{ id: 'only-link', url: 'https://example.com/' }],
  }]), null);
});

test('createBookmarkModel indexes nested nodes using declared or traversal parents', () => {
  const tree = makeTree();
  delete tree[0].children[1].children[0].parentId;
  const model = createBookmarkModel(tree);

  assert.equal(model.browserRootId, 'root-dynamic');
  assert.equal(model.preferredRootId, 'bar-dynamic');
  assert.equal(model.nodesById.get('safe-link').title, 'Article');
  assert.equal(model.parentIdsById.get('folder-a'), 'bar-dynamic');
  assert.equal(model.parentIdsById.get('safe-link'), 'folder-b');
});

test('folder views preserve Chrome child order and build incremental breadcrumbs', () => {
  const model = createBookmarkModel(makeTree());
  const view = getBookmarkFolderView(model, 'folder-b');

  assert.equal(view.folderId, 'folder-b');
  assert.deepEqual(view.breadcrumbs.map(node => node.id), [
    'bar-dynamic',
    'folder-a',
    'folder-b',
  ]);
  assert.deepEqual(view.items.map(node => node.id), ['safe-link']);
});

test('folder views fall back to the preferred root for missing IDs or bookmark IDs', () => {
  const model = createBookmarkModel(makeTree());
  assert.equal(getBookmarkFolderView(model, 'missing').folderId, 'bar-dynamic');
  assert.equal(getBookmarkFolderView(model, 'safe-link').folderId, 'bar-dynamic');
});

test('breadcrumbs outside the preferred root use their real top-level folder path', () => {
  const model = createBookmarkModel(makeTree());
  assert.deepEqual(
    getBookmarkBreadcrumbs(model, 'other-first').map(node => node.id),
    ['other-first'],
  );
  assert.equal(isNodeWithinFolder(model, 'safe-link', 'bar-dynamic'), true);
  assert.equal(isNodeWithinFolder(model, 'other-link', 'bar-dynamic'), false);
});

test('normalizeBookmarkItem exposes folder path without copying nested children', () => {
  const model = createBookmarkModel(makeTree());
  const normalized = normalizeBookmarkItem(model, model.nodesById.get('safe-link'));
  assert.deepEqual(normalized, {
    id: 'safe-link',
    parentId: 'folder-b',
    title: 'Article',
    url: 'https://example.com/article',
    isFolder: false,
    path: [
      { id: 'bar-dynamic', title: 'Toolbar from Chrome' },
      { id: 'folder-a', title: 'Reading' },
      { id: 'folder-b', title: 'Later' },
    ],
  });
});

test('getBookmarkLeafItems returns bookmark leaves across every top-level folder', () => {
  const model = createBookmarkModel(makeTree());
  const leaves = getBookmarkLeafItems(model);

  assert.deepEqual(leaves.map(item => item.id), [
    'other-link',
    'safe-link',
    'root-link',
  ]);
  assert.deepEqual(
    leaves.find(item => item.id === 'other-link').path,
    [{ id: 'other-first', title: 'Other shelf' }],
  );
});

test('safe URL validation blocks bookmarklets and embedded data, then lets Chrome handle other schemes', () => {
  const allowed = [
    'https://example.com/path',
    'http://example.com/',
    'file:///tmp/example.txt',
    'ftp://example.com/file.txt',
    'chrome://bookmarks/',
    'edge://favorites/',
    'brave://bookmarks/',
    'about:blank',
    'blob:https://example.com/id',
    'mailto:user@example.com',
    'web+notes:today',
  ];
  const blocked = [
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1) ',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'example.com/without-a-protocol',
    '',
  ];

  allowed.forEach(url => assert.equal(isSafeBookmarkUrl(url), true, url));
  blocked.forEach(url => assert.equal(isSafeBookmarkUrl(url), false, url));
  assert.equal(getSafeBookmarkUrl(' javascript:alert(1) '), '');
  assert.equal(getSafeBookmarkUrl(' HTTPS://EXAMPLE.COM/path '), 'https://example.com/path');
});

test('index traversal terminates safely for cyclic object graphs', () => {
  const root = { id: 'cycle-root', title: '' };
  const folder = { id: 'cycle-folder', title: 'Folder', children: [] };
  root.children = [folder];
  folder.children.push(root);

  const model = createBookmarkModel([root]);
  assert.equal(model.nodesById.size, 2);
  assert.equal(model.preferredRootId, 'cycle-folder');
});
