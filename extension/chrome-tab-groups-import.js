'use strict';

(function attachChromeTabGroupImport(globalScope) {
  const {
    addSessionGroup,
    normalizeSessionGroups,
  } = globalScope.TabOutSessionGroups || {};

  const EMPTY_META = {
    entries: [],
  };

  function normalizeChromeImportedGroupMeta(input) {
    const entries = Array.isArray(input?.entries)
      ? input.entries
        .filter(entry => entry && entry.sessionGroupId)
        .map(entry => ({
          sessionGroupId: String(entry.sessionGroupId),
          chromeGroupId: entry.chromeGroupId == null ? null : Number(entry.chromeGroupId),
          windowId: entry.windowId == null ? 0 : Number(entry.windowId),
          title: String(entry.title || 'Group').trim() || 'Group',
          color: String(entry.color || 'grey'),
        }))
      : [];

    return { entries };
  }

  function buildMetaSignature(entry) {
    return [
      String(entry.windowId ?? 0),
      String(entry.title || 'Group').trim() || 'Group',
      String(entry.color || 'grey'),
    ].join('::');
  }

  function buildUniqueGroupName(baseName, groups, excludeGroupId = '') {
    const fallbackName = String(baseName || 'Group').trim() || 'Group';
    const lowerFallback = fallbackName.toLowerCase();
    const takenNames = new Set(
      (groups || [])
        .filter(group => group && group.id !== excludeGroupId)
        .map(group => String(group.name || '').trim().toLowerCase())
        .filter(Boolean)
    );

    if (!takenNames.has(lowerFallback)) return fallbackName;

    let suffix = 2;
    while (takenNames.has(`${lowerFallback} ${suffix}`)) suffix++;
    return `${fallbackName} ${suffix}`;
  }

  function findReusableSessionGroupId(groups, assignments, nativeGroup) {
    const nativeTabIds = Array.isArray(nativeGroup?.tabIds)
      ? nativeGroup.tabIds.map(tabId => String(tabId)).filter(Boolean).sort()
      : [];
    if (!nativeTabIds.length) return '';

    const nativeTitle = String(nativeGroup?.title || '').trim().toLowerCase();

    for (const group of groups || []) {
      const groupId = String(group?.id || '');
      if (!groupId) continue;

      const assignedTabIds = Object.entries(assignments || {})
        .filter(([, assignedGroupId]) => String(assignedGroupId) === groupId)
        .map(([tabId]) => String(tabId))
        .sort();
      if (!assignedTabIds.length || assignedTabIds.length !== nativeTabIds.length) continue;
      if (!assignedTabIds.every((tabId, index) => tabId === nativeTabIds[index])) continue;

      const groupName = String(group?.name || '').trim().toLowerCase();
      if (!nativeTitle || !groupName || nativeTitle === groupName) {
        return groupId;
      }
    }

    return '';
  }

  function reconcileChromeTabGroupImports({
    currentState,
    importedMeta,
    nativeGroups,
  }) {
    if (typeof normalizeSessionGroups !== 'function' || typeof addSessionGroup !== 'function') {
      throw new Error('Session group helpers are unavailable');
    }

    const normalizedState = normalizeSessionGroups(currentState);
    const normalizedMeta = normalizeChromeImportedGroupMeta(importedMeta);
    const managedIds = new Set(normalizedMeta.entries.map(entry => entry.sessionGroupId));
    const sessionGroupIds = new Set(normalizedState.groups.map(group => group.id));

    let groups = normalizedState.groups.filter(group => !managedIds.has(group.id) || sessionGroupIds.has(group.id));
    let assignments = {};
    for (const [tabId, groupId] of Object.entries(normalizedState.assignments)) {
      if (managedIds.has(groupId)) continue;
      assignments[tabId] = groupId;
    }

    const metaByChromeGroupId = new Map();
    const metaBySignature = new Map();
    for (const entry of normalizedMeta.entries) {
      if (!sessionGroupIds.has(entry.sessionGroupId)) continue;
      if (entry.chromeGroupId != null) metaByChromeGroupId.set(entry.chromeGroupId, entry);
      metaBySignature.set(buildMetaSignature(entry), entry);
    }

    const nextMetaEntries = [];
    const mappings = [];

    for (const nativeGroup of (nativeGroups || [])) {
      const chromeGroupId = nativeGroup?.chromeGroupId == null ? null : Number(nativeGroup.chromeGroupId);
      const windowId = nativeGroup?.windowId == null ? 0 : Number(nativeGroup.windowId);
      const title = String(nativeGroup?.title || 'Group').trim() || 'Group';
      const color = String(nativeGroup?.color || 'grey');
      const tabIds = Array.isArray(nativeGroup?.tabIds)
        ? nativeGroup.tabIds.filter(tabId => tabId != null).map(tabId => String(tabId))
        : [];
      if (tabIds.length === 0) continue;

      const signature = buildMetaSignature({ windowId, title, color });
      const existingMeta = (chromeGroupId != null && metaByChromeGroupId.get(chromeGroupId))
        || metaBySignature.get(signature)
        || null;

      let sessionGroupId = existingMeta?.sessionGroupId || '';
      let groupIndex = groups.findIndex(group => group.id === sessionGroupId);
      if (groupIndex === -1) {
        sessionGroupId = findReusableSessionGroupId(groups, normalizedState.assignments, nativeGroup);
        groupIndex = groups.findIndex(group => group.id === sessionGroupId);
      }

      if (groupIndex === -1) {
        const uniqueName = buildUniqueGroupName(title, groups);
        const created = addSessionGroup({ groups, assignments }, uniqueName);
        groups = created.state.groups;
        assignments = created.state.assignments;
        sessionGroupId = created.group.id;
        groupIndex = groups.findIndex(group => group.id === sessionGroupId);
      } else {
        const uniqueName = buildUniqueGroupName(title, groups, sessionGroupId);
        if (groups[groupIndex].name !== uniqueName) {
          groups = groups.map(group => group.id === sessionGroupId
            ? { ...group, name: uniqueName }
            : group);
        }
      }

      for (const tabId of tabIds) {
        assignments[tabId] = sessionGroupId;
      }

      if (chromeGroupId != null) {
        mappings.push({
          virtualGroupKey: `__session_group__:${sessionGroupId}`,
          windowId,
          chromeGroupId,
        });
      }

      nextMetaEntries.push({
        sessionGroupId,
        chromeGroupId,
        windowId,
        title,
        color,
      });
    }

    const activeManagedIds = new Set(nextMetaEntries.map(entry => entry.sessionGroupId));
    groups = groups.filter(group => !managedIds.has(group.id) || activeManagedIds.has(group.id));
    assignments = Object.fromEntries(
      Object.entries(assignments).filter(([, groupId]) => !managedIds.has(groupId) || activeManagedIds.has(groupId))
    );

    return {
      state: normalizeSessionGroups({ groups, assignments }),
      importedMeta: normalizeChromeImportedGroupMeta({ entries: nextMetaEntries }),
      mappings,
    };
  }

  const api = {
    EMPTY_META,
    normalizeChromeImportedGroupMeta,
    reconcileChromeTabGroupImports,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabOutChromeTabGroupImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
