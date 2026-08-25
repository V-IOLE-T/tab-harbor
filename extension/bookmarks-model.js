'use strict';

(function attachTabHarborBookmarksModel(globalScope) {
  // Bookmarklets and embedded-data URLs could execute content in the current
  // extension tab. Everything else is handed to Chrome and allowed to succeed
  // or fail using the browser's normal navigation rules (mailto:, custom app
  // schemes, internal pages, and future protocols therefore keep working).
  const BLOCKED_BOOKMARK_PROTOCOLS = new Set([
    'javascript:',
    'data:',
    'vbscript:',
  ]);

  function getNodeId(node) {
    if (!node || node.id === undefined || node.id === null) return '';
    return String(node.id);
  }

  function isBookmarkFolder(node) {
    return Boolean(node) && !node.url;
  }

  function getTreeRoot(tree = []) {
    if (!Array.isArray(tree)) return null;
    return tree.find(node => node && typeof node === 'object') || null;
  }

  function getTopLevelFolders(tree = []) {
    const root = getTreeRoot(tree);
    if (!root || !Array.isArray(root.children)) return [];
    return root.children.filter(isBookmarkFolder);
  }

  function selectPreferredBookmarkRoot(tree = []) {
    const folders = getTopLevelFolders(tree);
    return folders.find(folder => folder.folderType === 'bookmarks-bar') || folders[0] || null;
  }

  function buildBookmarkIndex(tree = []) {
    const nodesById = new Map();
    const parentIdsById = new Map();
    const visitedObjects = new Set();

    function visit(node, traversalParentId = '') {
      if (!node || typeof node !== 'object' || visitedObjects.has(node)) return;
      visitedObjects.add(node);

      const id = getNodeId(node);
      if (!id) return;

      nodesById.set(id, node);
      const declaredParentId = node.parentId === undefined || node.parentId === null
        ? ''
        : String(node.parentId);
      const parentId = declaredParentId || traversalParentId;
      if (parentId && parentId !== id) parentIdsById.set(id, parentId);

      if (!Array.isArray(node.children)) return;
      node.children.forEach(child => visit(child, id));
    }

    (Array.isArray(tree) ? tree : []).forEach(node => visit(node));
    return { nodesById, parentIdsById };
  }

  function createBookmarkModel(tree = []) {
    const browserRoot = getTreeRoot(tree);
    const preferredRoot = selectPreferredBookmarkRoot(tree);
    const { nodesById, parentIdsById } = buildBookmarkIndex(tree);

    return {
      browserRoot,
      browserRootId: getNodeId(browserRoot),
      preferredRoot,
      preferredRootId: getNodeId(preferredRoot),
      nodesById,
      parentIdsById,
    };
  }

  function getBookmarkNode(model, nodeId) {
    if (!model?.nodesById || nodeId === undefined || nodeId === null) return null;
    return model.nodesById.get(String(nodeId)) || null;
  }

  function getBookmarkParent(model, node) {
    const id = getNodeId(node);
    if (!id) return null;
    const parentId = model?.parentIdsById?.get(id);
    return parentId ? getBookmarkNode(model, parentId) : null;
  }

  function isNodeWithinFolder(model, nodeId, folderId) {
    const targetId = String(nodeId ?? '');
    const boundaryId = String(folderId ?? '');
    if (!targetId || !boundaryId) return false;

    const seen = new Set();
    let current = getBookmarkNode(model, targetId);
    while (current) {
      const currentId = getNodeId(current);
      if (!currentId || seen.has(currentId)) return false;
      if (currentId === boundaryId) return true;
      seen.add(currentId);
      current = getBookmarkParent(model, current);
    }
    return false;
  }

  function getBookmarkBreadcrumbs(model, folderId) {
    const folder = getBookmarkNode(model, folderId);
    if (!isBookmarkFolder(folder)) return [];

    const preferredRootId = String(model?.preferredRootId || '');
    const browserRootId = String(model?.browserRootId || '');
    const folderWithinPreferredRoot = preferredRootId
      ? isNodeWithinFolder(model, getNodeId(folder), preferredRootId)
      : false;
    const stopId = folderWithinPreferredRoot ? preferredRootId : browserRootId;
    const breadcrumbs = [];
    const seen = new Set();
    let current = folder;

    while (current) {
      const currentId = getNodeId(current);
      if (!currentId || seen.has(currentId)) break;
      seen.add(currentId);

      if (currentId !== browserRootId || currentId === getNodeId(folder)) {
        breadcrumbs.push(current);
      }
      if (currentId === stopId) break;
      current = getBookmarkParent(model, current);
    }

    return breadcrumbs.reverse();
  }

  function getBookmarkFolderView(model, requestedFolderId = '') {
    const requestedFolder = getBookmarkNode(model, requestedFolderId);
    const fallbackFolder = model?.preferredRoot || null;
    const folder = isBookmarkFolder(requestedFolder) ? requestedFolder : fallbackFolder;
    if (!folder) {
      return {
        folder: null,
        folderId: '',
        breadcrumbs: [],
        items: [],
      };
    }

    return {
      folder,
      folderId: getNodeId(folder),
      breadcrumbs: getBookmarkBreadcrumbs(model, getNodeId(folder)),
      items: Array.isArray(folder.children) ? folder.children.slice() : [],
    };
  }

  function getBookmarkFolderPath(model, nodeOrId, { includeNode = false } = {}) {
    let node = typeof nodeOrId === 'object'
      ? nodeOrId
      : getBookmarkNode(model, nodeOrId);
    if (!node) return [];

    if (!includeNode || !isBookmarkFolder(node)) {
      node = getBookmarkParent(model, node);
    }
    if (!node) return [];

    return getBookmarkBreadcrumbs(model, getNodeId(node));
  }

  function normalizeBookmarkItem(model, node) {
    if (!node || typeof node !== 'object') return null;
    const id = getNodeId(node);
    if (!id) return null;

    const pathNodes = getBookmarkFolderPath(model, node);
    return {
      id,
      parentId: node.parentId === undefined || node.parentId === null ? '' : String(node.parentId),
      title: String(node.title || node.url || ''),
      url: node.url ? String(node.url) : '',
      isFolder: isBookmarkFolder(node),
      path: pathNodes.map(pathNode => ({
        id: getNodeId(pathNode),
        title: String(pathNode.title || ''),
      })),
    };
  }

  function normalizeBookmarkItems(model, nodes = []) {
    if (!Array.isArray(nodes)) return [];
    return nodes.map(node => normalizeBookmarkItem(model, node)).filter(Boolean);
  }

  function getBookmarkLeafItems(model) {
    if (!model?.nodesById) return [];
    return normalizeBookmarkItems(
      model,
      [...model.nodesById.values()].filter(node => node?.url),
    );
  }

  function getSafeBookmarkUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
      const parsed = new URL(raw);
      return BLOCKED_BOOKMARK_PROTOCOLS.has(parsed.protocol.toLowerCase()) ? '' : parsed.href;
    } catch {
      return '';
    }
  }

  function isSafeBookmarkUrl(value = '') {
    return Boolean(getSafeBookmarkUrl(value));
  }

  const api = {
    BLOCKED_BOOKMARK_PROTOCOLS,
    buildBookmarkIndex,
    createBookmarkModel,
    getBookmarkBreadcrumbs,
    getBookmarkFolderPath,
    getBookmarkFolderView,
    getBookmarkLeafItems,
    getBookmarkNode,
    getSafeBookmarkUrl,
    getTopLevelFolders,
    isBookmarkFolder,
    isNodeWithinFolder,
    isSafeBookmarkUrl,
    normalizeBookmarkItem,
    normalizeBookmarkItems,
    selectPreferredBookmarkRoot,
  };

  globalScope.TabHarborBookmarksModel = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
