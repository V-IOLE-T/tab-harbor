'use strict';

(function attachListOrder(globalScope) {
  function normalizeOrderIds(orderIds) {
    if (!Array.isArray(orderIds)) return [];
    return orderIds.map(id => String(id)).filter(Boolean);
  }

  function createReorderedIds(currentIds, draggedId, targetId, placeAfter = false) {
    const ids = normalizeOrderIds(currentIds);
    if (!draggedId || !targetId || draggedId === targetId) return ids;

    const draggedKey = String(draggedId);
    const targetKey = String(targetId);
    const draggedIndex = ids.indexOf(draggedKey);
    const targetIndex = ids.indexOf(targetKey);
    if (draggedIndex === -1 || targetIndex === -1) return ids;

    const nextIds = ids.slice();
    nextIds.splice(draggedIndex, 1);

    const insertIndex = placeAfter
      ? targetIndex > draggedIndex ? targetIndex : targetIndex + 1
      : targetIndex < draggedIndex ? targetIndex : targetIndex - 1;

    nextIds.splice(Math.max(0, insertIndex), 0, draggedKey);
    return nextIds;
  }

  function reorderSubsetByIds(items, orderIds, includeItem) {
    if (!Array.isArray(items)) return [];

    const list = items.slice();
    const shouldInclude = typeof includeItem === 'function' ? includeItem : () => true;
    const subset = list.filter(shouldInclude);
    const normalizedOrder = normalizeOrderIds(orderIds);

    if (!subset.length || subset.length !== normalizedOrder.length) return list;

    const subsetMap = new Map(subset.map(item => [String(item.id), item]));
    if (subsetMap.size !== subset.length) return list;
    if (normalizedOrder.some(id => !subsetMap.has(id))) return list;

    let nextIndex = 0;
    return list.map(item => {
      if (!shouldInclude(item)) return item;
      const reorderedItem = subsetMap.get(normalizedOrder[nextIndex]);
      nextIndex += 1;
      return reorderedItem || item;
    });
  }

  const api = {
    createReorderedIds,
    normalizeOrderIds,
    reorderSubsetByIds,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabOutListOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
