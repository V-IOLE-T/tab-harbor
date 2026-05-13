'use strict';

(function attachGroupOrder(globalScope) {
  function uniqueKeys(keys = []) {
    return [...new Set((keys || []).filter(Boolean).map(String))];
  }

  function normalizeGroupOrderState(input) {
    const durableOrder = uniqueKeys(
      input?.sessionOrder?.length
        ? input.sessionOrder
        : (input?.pinnedOrder || [])
    );
    return {
      sessionOrder: durableOrder,
      pinnedOrder: durableOrder,
      pinEnabled: false,
    };
  }

  function mergeOrder(orderKeys, availableKeys) {
    const seen = new Set();
    const result = [];

    for (const key of uniqueKeys(orderKeys)) {
      if (!availableKeys.includes(key) || seen.has(key)) continue;
      seen.add(key);
      result.push(key);
    }

    for (const key of availableKeys) {
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(key);
    }

    return result;
  }

  function applyGroupOrder(groups, state) {
    const normalizedState = normalizeGroupOrderState(state);
    const availableKeys = groups.map(group => String(group.domain));
    const preferredOrder = normalizedState.sessionOrder;

    const finalKeys = mergeOrder(preferredOrder, availableKeys);
    const orderMap = new Map(finalKeys.map((key, index) => [key, index]));

    return [...groups].sort((a, b) => {
      return (orderMap.get(String(a.domain)) ?? Number.MAX_SAFE_INTEGER) -
        (orderMap.get(String(b.domain)) ?? Number.MAX_SAFE_INTEGER);
    });
  }

  function createReorderedKeys(currentKeys, draggedKey, targetKey, placeAfter = false) {
    const keys = uniqueKeys(currentKeys);
    if (!draggedKey || !targetKey || draggedKey === targetKey) return keys;

    const draggedIndex = keys.indexOf(String(draggedKey));
    const targetIndex = keys.indexOf(String(targetKey));
    if (draggedIndex === -1 || targetIndex === -1) return keys;

    const nextKeys = [...keys];
    nextKeys.splice(draggedIndex, 1);
    const insertIndex = placeAfter
      ? targetIndex > draggedIndex ? targetIndex : targetIndex + 1
      : targetIndex < draggedIndex ? targetIndex : targetIndex - 1;
    nextKeys.splice(Math.max(0, insertIndex), 0, String(draggedKey));
    return nextKeys;
  }

  function setPinEnabled(state, pinEnabled, currentOrderKeys = []) {
    const normalizedState = normalizeGroupOrderState(state);
    const orderKeys = normalizedState.sessionOrder.length > 0
      ? normalizedState.sessionOrder
      : uniqueKeys(currentOrderKeys);
    const durableOrder = mergeOrder(orderKeys, uniqueKeys(currentOrderKeys));
    return normalizeGroupOrderState({
      sessionOrder: durableOrder,
      pinnedOrder: durableOrder,
      pinEnabled: false,
    });
  }

  const api = {
    applyGroupOrder,
    createReorderedKeys,
    normalizeGroupOrderState,
    setPinEnabled,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabOutGroupOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
