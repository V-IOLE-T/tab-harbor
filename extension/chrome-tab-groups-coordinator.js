'use strict';

(function attachChromeTabGroupsCoordinator(globalScope) {
  const SESSION_MAP_KEY = 'chromeTabGroupsSessionMap';
  const LEGACY_LOCAL_META_KEY = 'chromeTabGroupsMeta';
  const ORIGIN_CREATED = 'created';
  const ORIGIN_ADOPTED = 'adopted';
  const VALID_ORIGINS = new Set([ORIGIN_CREATED, ORIGIN_ADOPTED]);
  const RESERVED_GROUP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const VALID_COLORS = new Set([
    'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange',
  ]);

  class CoordinatorError extends Error {
    constructor(code, message, details = null) {
      super(message);
      this.name = 'CoordinatorError';
      this.code = code;
      this.details = details;
    }
  }

  function asErrorResult(action, error) {
    const err = error instanceof CoordinatorError
      ? error
      : new CoordinatorError('INTERNAL_ERROR', error?.message || String(error || 'Unknown error'));
    return {
      ok: false,
      action,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details == null ? {} : { details: err.details }),
      },
    };
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function createDictionary() {
    return Object.create(null);
  }

  function hasOwn(record, key) {
    return isRecord(record) && Object.prototype.hasOwnProperty.call(record, key);
  }

  function requireRecord(value, label) {
    if (!isRecord(value)) {
      throw new CoordinatorError('INVALID_PAYLOAD', `${label} must be an object`);
    }
    return value;
  }

  function requireInteger(value, label, { min = 0 } = {}) {
    if (!Number.isInteger(value) || value < min) {
      throw new CoordinatorError('INVALID_PAYLOAD', `${label} must be an integer >= ${min}`);
    }
    return value;
  }

  function requireString(value, label, { allowEmpty = false, maxLength = 512 } = {}) {
    if (typeof value !== 'string') {
      throw new CoordinatorError('INVALID_PAYLOAD', `${label} must be a string`);
    }
    const clean = value.trim();
    if (!allowEmpty && !clean) {
      throw new CoordinatorError('INVALID_PAYLOAD', `${label} must not be empty`);
    }
    if (clean.length > maxLength) {
      throw new CoordinatorError('INVALID_PAYLOAD', `${label} is too long`);
    }
    return clean;
  }

  function requireGroupKey(value, label = 'groupKey') {
    const groupKey = requireString(value, label, { maxLength: 256 });
    if (RESERVED_GROUP_KEYS.has(groupKey)) {
      throw new CoordinatorError('INVALID_PAYLOAD', `${label} is reserved`);
    }
    return groupKey;
  }

  function normalizeTabIds(value, label, { allowEmpty = false } = {}) {
    if (!Array.isArray(value)) {
      throw new CoordinatorError('INVALID_PAYLOAD', `${label} must be an array`);
    }
    const ids = [];
    const seen = new Set();
    for (const rawId of value) {
      const id = requireInteger(rawId, `${label}[]`);
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (!allowEmpty && ids.length === 0) {
      throw new CoordinatorError('INVALID_PAYLOAD', `${label} must not be empty`);
    }
    return ids;
  }

  function normalizeExpectedMergeGroups(value, selectedGroupIds) {
    if (!Array.isArray(value)) {
      throw new CoordinatorError('INVALID_PAYLOAD', 'expectedGroups must be an array');
    }
    const selectedIds = new Set(selectedGroupIds.map(Number));
    const seenGroupIds = new Set();
    const seenTabIds = new Set();
    const groups = value.map((rawGroup, index) => {
      const group = requireRecord(rawGroup, `expectedGroups[${index}]`);
      const groupId = requireInteger(group.groupId, `expectedGroups[${index}].groupId`);
      if (!selectedIds.has(groupId) || seenGroupIds.has(groupId)) {
        throw new CoordinatorError('INVALID_PAYLOAD', 'expectedGroups must match the selected Chrome groups exactly');
      }
      seenGroupIds.add(groupId);
      const title = requireString(group.title, `expectedGroups[${index}].title`, {
        allowEmpty: true,
        maxLength: 256,
      });
      const color = requireString(group.color, `expectedGroups[${index}].color`);
      if (!VALID_COLORS.has(color)) {
        throw new CoordinatorError('INVALID_PAYLOAD', `expectedGroups[${index}].color is invalid`);
      }
      if (!Array.isArray(group.tabs) || group.tabs.length === 0) {
        throw new CoordinatorError('INVALID_PAYLOAD', `expectedGroups[${index}].tabs must not be empty`);
      }
      const tabs = group.tabs.map((rawTab, tabIndex) => {
        const tab = requireRecord(rawTab, `expectedGroups[${index}].tabs[${tabIndex}]`);
        const tabId = requireInteger(tab.tabId, `expectedGroups[${index}].tabs[${tabIndex}].tabId`);
        if (seenTabIds.has(tabId)) {
          throw new CoordinatorError('INVALID_PAYLOAD', `tab ${tabId} appears in more than one expected group`);
        }
        seenTabIds.add(tabId);
        return {
          tabId,
          url: requireString(tab.url, `expectedGroups[${index}].tabs[${tabIndex}].url`, {
            allowEmpty: true,
            maxLength: 32768,
          }),
        };
      });
      return { groupId, title, color, tabs };
    });
    if (seenGroupIds.size !== selectedIds.size) {
      throw new CoordinatorError('INVALID_PAYLOAD', 'expectedGroups must match the selected Chrome groups exactly');
    }
    return groups;
  }

  function validateSyncPayload(input) {
    const payload = requireRecord(input, 'sync payload');
    const windowId = requireInteger(payload.windowId, 'windowId');
    const enabled = payload.enabled == null ? true : payload.enabled;
    if (typeof enabled !== 'boolean') {
      throw new CoordinatorError('INVALID_PAYLOAD', 'enabled must be a boolean');
    }
    const rawGroups = payload.groups == null && enabled === false ? [] : payload.groups;
    if (!Array.isArray(rawGroups)) {
      throw new CoordinatorError('INVALID_PAYLOAD', 'groups must be an array');
    }
    const allWindows = payload.allWindows == null ? false : payload.allWindows;
    if (typeof allWindows !== 'boolean' || (enabled && allWindows)) {
      throw new CoordinatorError('INVALID_PAYLOAD', 'allWindows is only valid when sync is disabled');
    }
    const rawPreserveGroupKeys = payload.preserveGroupKeys == null ? [] : payload.preserveGroupKeys;
    if (!Array.isArray(rawPreserveGroupKeys)) {
      throw new CoordinatorError('INVALID_PAYLOAD', 'preserveGroupKeys must be an array');
    }
    const preserveGroupKeys = [];
    const seenPreserveKeys = new Set();
    rawPreserveGroupKeys.forEach((rawKey, index) => {
      const groupKey = requireGroupKey(rawKey, `preserveGroupKeys[${index}]`);
      if (!seenPreserveKeys.has(groupKey)) {
        seenPreserveKeys.add(groupKey);
        preserveGroupKeys.push(groupKey);
      }
    });

    const seenKeys = new Set();
    const assignedTabIds = new Set();
    const groups = rawGroups.map((rawGroup, index) => {
      const group = requireRecord(rawGroup, `groups[${index}]`);
      const groupKey = requireGroupKey(group.groupKey, `groups[${index}].groupKey`);
      if (seenKeys.has(groupKey)) {
        throw new CoordinatorError('INVALID_PAYLOAD', `duplicate groupKey: ${groupKey}`);
      }
      seenKeys.add(groupKey);

      const title = requireString(group.title, `groups[${index}].title`, {
        allowEmpty: true,
        maxLength: 256,
      });
      const color = group.color == null ? 'grey' : requireString(group.color, `groups[${index}].color`);
      if (!VALID_COLORS.has(color)) {
        throw new CoordinatorError('INVALID_PAYLOAD', `groups[${index}].color is invalid`);
      }
      const collapsed = group.collapsed == null ? true : group.collapsed;
      if (typeof collapsed !== 'boolean') {
        throw new CoordinatorError('INVALID_PAYLOAD', `groups[${index}].collapsed must be a boolean`);
      }
      const tabIds = normalizeTabIds(group.tabIds, `groups[${index}].tabIds`);
      for (const tabId of tabIds) {
        if (assignedTabIds.has(tabId)) {
          throw new CoordinatorError('INVALID_PAYLOAD', `tab ${tabId} appears in more than one logical group`);
        }
        assignedTabIds.add(tabId);
      }
      return { groupKey, title, color, collapsed, tabIds };
    });

    return { action: 'sync', windowId, enabled, allWindows, preserveGroupKeys, groups };
  }

  function validateMergePayload(input) {
    const payload = requireRecord(input, 'merge payload');
    const windowId = requireInteger(payload.windowId, 'windowId');
    const operation = payload.operation == null
      ? 'merge-groups'
      : requireString(payload.operation, 'operation', { maxLength: 64 });

    if (operation !== 'merge-groups') {
      if (!['create', 'join', 'ungroup', 'update', 'reorder'].includes(operation)) {
        throw new CoordinatorError('INVALID_PAYLOAD', 'operation is invalid');
      }
      if (operation === 'create') {
        const tabIds = normalizeTabIds(payload.tabIds, 'tabIds');
        const title = payload.title == null
          ? ''
          : requireString(payload.title, 'title', { allowEmpty: true, maxLength: 256 });
        const color = payload.color == null ? 'grey' : requireString(payload.color, 'color');
        if (!VALID_COLORS.has(color)) {
          throw new CoordinatorError('INVALID_PAYLOAD', 'color is invalid');
        }
        const orderedTabIds = payload.orderedTabIds == null
          ? tabIds.slice()
          : normalizeTabIds(payload.orderedTabIds, 'orderedTabIds');
        return { action: 'merge', operation, windowId, tabIds, orderedTabIds, title, color };
      }

      if (operation === 'ungroup') {
        return {
          action: 'merge',
          operation,
          windowId,
          tabIds: normalizeTabIds(payload.tabIds, 'tabIds'),
        };
      }

      const targetGroupId = requireInteger(payload.targetGroupId, 'targetGroupId');
      if (operation === 'join') {
        const tabIds = normalizeTabIds(payload.tabIds, 'tabIds');
        const orderedTabIds = payload.orderedTabIds == null
          ? []
          : normalizeTabIds(payload.orderedTabIds, 'orderedTabIds');
        return { action: 'merge', operation, windowId, targetGroupId, tabIds, orderedTabIds };
      }
      if (operation === 'reorder') {
        return {
          action: 'merge',
          operation,
          windowId,
          targetGroupId,
          tabIds: normalizeTabIds(payload.tabIds, 'tabIds'),
        };
      }

      const changes = requireRecord(payload.changes, 'changes');
      const normalizedChanges = {};
      if (Object.prototype.hasOwnProperty.call(changes, 'title')) {
        normalizedChanges.title = requireString(changes.title, 'changes.title', { allowEmpty: true, maxLength: 256 });
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'color')) {
        const color = requireString(changes.color, 'changes.color');
        if (!VALID_COLORS.has(color)) throw new CoordinatorError('INVALID_PAYLOAD', 'changes.color is invalid');
        normalizedChanges.color = color;
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'collapsed')) {
        if (typeof changes.collapsed !== 'boolean') {
          throw new CoordinatorError('INVALID_PAYLOAD', 'changes.collapsed must be a boolean');
        }
        normalizedChanges.collapsed = changes.collapsed;
      }
      if (Object.keys(normalizedChanges).length === 0) {
        throw new CoordinatorError('INVALID_PAYLOAD', 'changes must include title, color, or collapsed');
      }
      return { action: 'merge', operation, windowId, targetGroupId, changes: normalizedChanges };
    }

    const targetGroupId = requireInteger(payload.targetGroupId, 'targetGroupId');
    const sourceGroupIds = normalizeTabIds(payload.sourceGroupIds, 'sourceGroupIds')
      .filter(groupId => groupId !== targetGroupId);
    if (sourceGroupIds.length === 0) {
      throw new CoordinatorError('INVALID_PAYLOAD', 'sourceGroupIds must contain a group other than targetGroupId');
    }
    const groupKey = payload.groupKey == null
      ? ''
      : requireGroupKey(payload.groupKey, 'groupKey');
    const selectedGroupIds = [targetGroupId, ...sourceGroupIds];
    const expectedGroups = normalizeExpectedMergeGroups(payload.expectedGroups, selectedGroupIds);
    return {
      action: 'merge',
      operation,
      windowId,
      targetGroupId,
      sourceGroupIds,
      groupKey,
      expectedGroups,
    };
  }

  function validateGetStatePayload(input) {
    const payload = requireRecord(input, 'get-state payload');
    if (payload.windowId == null) return { action: 'get-state', windowId: null };
    return {
      action: 'get-state',
      windowId: requireInteger(payload.windowId, 'windowId'),
    };
  }

  function validateDispatchPayload(input) {
    const payload = requireRecord(input, 'message');
    if (payload.action === 'sync') return validateSyncPayload(payload);
    if (payload.action === 'merge') return validateMergePayload(payload);
    if (payload.action === 'get-state') return validateGetStatePayload(payload);
    throw new CoordinatorError('INVALID_ACTION', 'action must be sync, merge, or get-state');
  }

  function normalizeSessionMap(input) {
    if (input == null) return createDictionary();
    if (!isRecord(input)) {
      throw new CoordinatorError('INVALID_STORED_STATE', 'stored Chrome group session map must be an object');
    }
    const result = createDictionary();
    const seenGroupBindings = new Set();
    for (const [groupKey, rawWindowMap] of Object.entries(input)) {
      if (!groupKey || RESERVED_GROUP_KEYS.has(groupKey) || !isRecord(rawWindowMap)) {
        throw new CoordinatorError('INVALID_STORED_STATE', 'stored Chrome group session map is malformed');
      }
      const windowMap = createDictionary();
      for (const [windowIdKey, rawEntry] of Object.entries(rawWindowMap)) {
        if (!/^\d+$/.test(windowIdKey) || !isRecord(rawEntry)) {
          throw new CoordinatorError('INVALID_STORED_STATE', 'stored Chrome group session map is malformed');
        }
        const groupId = rawEntry.groupId;
        const origin = rawEntry.origin;
        if (!Number.isInteger(groupId) || groupId < 0 || !VALID_ORIGINS.has(origin)) {
          throw new CoordinatorError('INVALID_STORED_STATE', 'stored Chrome group session map is malformed');
        }
        const bindingKey = `${windowIdKey}:${groupId}`;
        if (seenGroupBindings.has(bindingKey)) {
          throw new CoordinatorError(
            'INVALID_STORED_STATE',
            'one Chrome group cannot be bound to multiple logical groups'
          );
        }
        seenGroupBindings.add(bindingKey);
        windowMap[windowIdKey] = { groupId, origin };
      }
      if (Object.keys(windowMap).length > 0) result[groupKey] = windowMap;
    }
    return result;
  }

  function cloneSessionMap(input) {
    const clone = createDictionary();
    for (const [groupKey, windowMap] of Object.entries(input || {})) {
      clone[groupKey] = createDictionary();
      for (const [windowId, entry] of Object.entries(windowMap || {})) {
        clone[groupKey][windowId] = { groupId: entry.groupId, origin: entry.origin };
      }
    }
    return clone;
  }

  function setMapping(map, groupKey, windowId, groupId, origin) {
    if (!hasOwn(map, groupKey)) map[groupKey] = createDictionary();
    map[groupKey][String(windowId)] = { groupId, origin };
  }

  function deleteMapping(map, groupKey, windowId) {
    if (!hasOwn(map, groupKey)) return;
    delete map[groupKey][String(windowId)];
    if (Object.keys(map[groupKey]).length === 0) delete map[groupKey];
  }

  function getMapping(map, groupKey, windowId) {
    if (!hasOwn(map, groupKey)) return null;
    const windowMap = map[groupKey];
    const windowIdKey = String(windowId);
    return hasOwn(windowMap, windowIdKey) ? windowMap[windowIdKey] : null;
  }

  function sessionMapsEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function reconcileWindowMappings(map, windowId, liveGroups) {
    const nextMap = cloneSessionMap(map);
    const liveById = new Map((liveGroups || []).map(group => [Number(group.id), group]));
    for (const [groupKey, windowMap] of Object.entries(map || {})) {
      const entry = windowMap?.[String(windowId)];
      if (!entry) continue;
      const liveGroup = liveById.get(entry.groupId);
      // Shared groups are unsafe to mutate, but they are still live. Keep the
      // mapping so later sync/disable rounds can freeze it with its origin
      // intact instead of silently forgetting ownership.
      if (!liveGroup || Number(liveGroup.windowId) !== Number(windowId)) {
        deleteMapping(nextMap, groupKey, windowId);
      }
    }
    return nextMap;
  }

  function groupDetails(group, tabs = [], extra = {}) {
    const positions = tabs
      .map(tab => Number(tab?.index))
      .filter(Number.isFinite);
    const queryComplete = extra.queryComplete == null
      ? !Object.prototype.hasOwnProperty.call(extra, 'tabQueryError')
      : Boolean(extra.queryComplete);
    return {
      id: Number(group.id),
      groupId: Number(group.id),
      windowId: Number(group.windowId),
      title: String(group.title || ''),
      color: String(group.color || 'grey'),
      tabIds: tabs
        .map(tab => Number(tab?.id))
        .filter(Number.isInteger),
      collapsed: Boolean(group.collapsed),
      shared: Boolean(group.shared),
      minIndex: positions.length > 0 ? Math.min(...positions) : null,
      queryComplete,
      ...extra,
    };
  }

  function createChromeTabGroupsCoordinator(options = {}) {
    const chromeApi = options.chromeApi || globalScope.chrome;
    const logger = options.logger || globalScope.console || { warn() {} };
    const storageKey = options.storageKey || SESSION_MAP_KEY;
    const readSyncEnabled = typeof options.readSyncEnabled === 'function'
      ? options.readSyncEnabled
      : null;

    let operationTail = Promise.resolve();
    const syncSlots = new Map();
    let legacyMetaCleanupDone = false;

    function requireChromeApis() {
      const available = chromeApi?.storage?.session &&
        typeof chromeApi.storage.session.get === 'function' &&
        typeof chromeApi.storage.session.set === 'function' &&
        chromeApi?.storage?.local &&
        typeof chromeApi.storage.local.remove === 'function' &&
        chromeApi?.tabGroups &&
        typeof chromeApi.tabGroups.query === 'function' &&
        typeof chromeApi.tabGroups.update === 'function' &&
        chromeApi?.tabs &&
        typeof chromeApi.tabs.query === 'function' &&
        typeof chromeApi.tabs.group === 'function' &&
        typeof chromeApi.tabs.ungroup === 'function' &&
        typeof chromeApi.tabs.move === 'function';
      if (!available) {
        throw new CoordinatorError('API_UNAVAILABLE', 'required Chrome tab-group APIs are unavailable');
      }
    }

    async function removeLegacyLocalMetaOnce() {
      if (legacyMetaCleanupDone) return true;
      try {
        await chromeApi.storage.local.remove(LEGACY_LOCAL_META_KEY);
        legacyMetaCleanupDone = true;
        return true;
      } catch (error) {
        try {
          logger.warn?.('[tab-harbor] could not remove legacy chromeTabGroupsMeta:', error);
        } catch {}
        return false;
      }
    }

    async function readSessionMap() {
      requireChromeApis();
      let stored;
      try {
        stored = await chromeApi.storage.session.get(storageKey);
      } catch (error) {
        throw new CoordinatorError('STORAGE_READ_FAILED', error?.message || 'could not read Chrome group session map');
      }
      return normalizeSessionMap(stored?.[storageKey]);
    }

    async function writeSessionMap(map) {
      try {
        await chromeApi.storage.session.set({ [storageKey]: cloneSessionMap(map) });
      } catch (error) {
        throw new CoordinatorError('STORAGE_WRITE_FAILED', error?.message || 'could not write Chrome group session map');
      }
    }

    function enqueueOperation(run) {
      const result = operationTail.then(run, run);
      operationTail = result.catch(() => {});
      return result;
    }

    async function applyAuthoritativeSyncSetting(payload) {
      if (!readSyncEnabled) return payload;
      let enabled;
      try {
        enabled = Boolean(await readSyncEnabled());
      } catch (error) {
        throw new CoordinatorError(
          'SETTING_READ_FAILED',
          error?.message || 'could not read the Chrome tab-group sync setting'
        );
      }
      if (!enabled) {
        return {
          ...payload,
          enabled: false,
          allWindows: true,
          preserveGroupKeys: [],
          groups: [],
        };
      }
      if (!payload.enabled) {
        throw new CoordinatorError(
          'STALE_SYNC_SETTING',
          'the Chrome tab-group sync setting changed before this request ran'
        );
      }
      return payload;
    }

    async function queryWindowSnapshot(windowId) {
      let groups;
      let tabs;
      try {
        groups = await chromeApi.tabGroups.query({ windowId });
        tabs = await chromeApi.tabs.query({ windowId });
      } catch (error) {
        throw new CoordinatorError(
          'GLOBAL_QUERY_FAILED',
          error?.message || 'could not query live Chrome groups',
          { windowId }
        );
      }

      if (!Array.isArray(groups) || !Array.isArray(tabs)) {
        throw new CoordinatorError('GLOBAL_QUERY_FAILED', 'Chrome returned an invalid live snapshot', { windowId });
      }

      const validGroup = group => isRecord(group) &&
        Number.isInteger(group.id) && group.id >= 0 &&
        Number.isInteger(group.windowId) && Number(group.windowId) === Number(windowId);
      const validTab = tab => isRecord(tab) &&
        Number.isInteger(tab.id) && tab.id >= 0 &&
        Number.isInteger(tab.windowId) && Number(tab.windowId) === Number(windowId);
      if (!groups.every(validGroup) || !tabs.every(validTab)) {
        throw new CoordinatorError('GLOBAL_QUERY_FAILED', 'Chrome returned a malformed live snapshot', { windowId });
      }

      const liveGroups = groups;
      const liveTabs = tabs;
      if (new Set(liveGroups.map(group => group.id)).size !== liveGroups.length ||
          new Set(liveTabs.map(tab => tab.id)).size !== liveTabs.length) {
        throw new CoordinatorError('GLOBAL_QUERY_FAILED', 'Chrome returned duplicate live identifiers', { windowId });
      }
      const tabsById = new Map(liveTabs.map(tab => [Number(tab.id), tab]));
      const groupById = new Map(liveGroups.map(group => [Number(group.id), group]));
      if (liveTabs.some(tab => Number.isInteger(tab.groupId) && tab.groupId >= 0 && !groupById.has(tab.groupId))) {
        throw new CoordinatorError('GLOBAL_QUERY_FAILED', 'Chrome returned tabs with unknown group identifiers', {
          windowId,
        });
      }
      const memberTabsByGroupId = new Map();
      const failedGroupQueries = new Map();

      await Promise.all(liveGroups.map(async (group) => {
        try {
          const memberTabs = await chromeApi.tabs.query({ groupId: Number(group.id) });
          if (!Array.isArray(memberTabs)) throw new Error('invalid tabs.query result');
          if (!memberTabs.every(tab => validTab(tab) && Number(tab.groupId) === Number(group.id))) {
            throw new Error('inconsistent group member snapshot');
          }
          const memberIds = memberTabs.map(tab => Number(tab.id)).sort((a, b) => a - b);
          const expectedTabs = liveTabs
            .filter(tab => Number(tab.groupId) === Number(group.id))
            .sort((a, b) => Number(a.index) - Number(b.index));
          const expectedIds = expectedTabs.map(tab => Number(tab.id)).sort((a, b) => a - b);
          if (new Set(memberIds).size !== memberIds.length ||
              memberIds.length !== expectedIds.length ||
              memberIds.some((id, index) => id !== expectedIds[index])) {
            throw new Error('inconsistent group member snapshot');
          }
          memberTabsByGroupId.set(Number(group.id), expectedTabs);
        } catch (error) {
          failedGroupQueries.set(Number(group.id), error?.message || String(error || 'tabs.query failed'));
        }
      }));

      return {
        windowId,
        liveGroups,
        liveTabs,
        tabsById,
        groupById,
        memberTabsByGroupId,
        failedGroupQueries,
      };
    }

    async function queryGlobalLiveWindowIds() {
      let groups;
      let tabs;
      try {
        [groups, tabs] = await Promise.all([
          chromeApi.tabGroups.query({}),
          chromeApi.tabs.query({}),
        ]);
      } catch (error) {
        throw new CoordinatorError(
          'GLOBAL_QUERY_FAILED',
          error?.message || 'could not query live Chrome windows'
        );
      }
      const validGroup = group => isRecord(group) &&
        Number.isInteger(group.id) && group.id >= 0 &&
        Number.isInteger(group.windowId) && group.windowId >= 0;
      const validTab = tab => isRecord(tab) &&
        Number.isInteger(tab.id) && tab.id >= 0 &&
        Number.isInteger(tab.windowId) && tab.windowId >= 0;
      if (!Array.isArray(groups) || !Array.isArray(tabs) ||
          !groups.every(validGroup) || !tabs.every(validTab) ||
          new Set(groups.map(group => group.id)).size !== groups.length ||
          new Set(tabs.map(tab => tab.id)).size !== tabs.length) {
        throw new CoordinatorError('GLOBAL_QUERY_FAILED', 'Chrome returned a malformed global live snapshot');
      }
      return new Set([
        ...groups.map(group => Number(group.windowId)),
        ...tabs.map(tab => Number(tab.windowId)),
      ]);
    }

    async function refreshSnapshotAfterWrites(windowId, fallbackSnapshot) {
      try {
        return { snapshot: await queryWindowSnapshot(windowId), queryComplete: true };
      } catch (error) {
        try {
          logger.warn?.('[tab-harbor] post-write Chrome group refresh failed:', error);
        } catch {}
        const failedSnapshot = fallbackSnapshot;
        for (const group of failedSnapshot.liveGroups || []) {
          if (!failedSnapshot.failedGroupQueries.has(Number(group.id))) {
            failedSnapshot.failedGroupQueries.set(Number(group.id), 'post-write refresh failed');
          }
        }
        return { snapshot: failedSnapshot, queryComplete: false };
      }
    }

    function validateDesiredTabs(group, snapshot) {
      const errors = [];
      for (const tabId of group.tabIds) {
        const liveTab = snapshot.tabsById.get(tabId);
        if (!liveTab) {
          errors.push({ tabId, reason: 'missing-or-wrong-window' });
          continue;
        }
        if (liveTab.pinned) errors.push({ tabId, reason: 'pinned' });
      }
      return errors;
    }

    function findCandidates(group, snapshot, excludedGroupIds = new Set()) {
      const desiredIds = new Set(group.tabIds);
      const candidates = [];
      const failedRelated = [];

      for (const nativeGroup of snapshot.liveGroups) {
        const nativeGroupId = Number(nativeGroup.id);
        if (excludedGroupIds.has(nativeGroupId)) continue;
        if (nativeGroup.shared === true) continue;
        if (String(nativeGroup.title || '') !== group.title) continue;
        if (snapshot.failedGroupQueries.has(nativeGroupId)) {
          failedRelated.push(groupDetails(nativeGroup, [], {
            tabQueryError: snapshot.failedGroupQueries.get(nativeGroupId),
          }));
          continue;
        }
        const memberTabs = snapshot.memberTabsByGroupId.get(nativeGroupId) || [];
        if (memberTabs.length === 0) continue;
        if (memberTabs.every(tab => desiredIds.has(Number(tab.id)))) {
          candidates.push(groupDetails(nativeGroup, memberTabs));
        }
      }

      const byStripPosition = (left, right) =>
        Number(left.minIndex ?? Number.MAX_SAFE_INTEGER) -
          Number(right.minIndex ?? Number.MAX_SAFE_INTEGER) ||
        Number(left.groupId) - Number(right.groupId);
      candidates.sort(byStripPosition);
      failedRelated.sort(byStripPosition);
      return { candidates, failedRelated };
    }

    function findUnexpectedNativeMembership(group, allowedGroupIds, snapshot) {
      const unexpected = new Map();
      for (const tabId of group.tabIds) {
        const liveTab = snapshot.tabsById.get(tabId);
        const nativeGroupId = Number(liveTab?.groupId);
        if (!Number.isInteger(nativeGroupId) || nativeGroupId < 0 || allowedGroupIds.has(nativeGroupId)) continue;
        const nativeGroup = snapshot.groupById.get(nativeGroupId);
        const memberTabs = snapshot.memberTabsByGroupId.get(nativeGroupId) || [];
        unexpected.set(nativeGroupId, nativeGroup
          ? groupDetails(nativeGroup, memberTabs, {
            ...(snapshot.failedGroupQueries.has(nativeGroupId)
              ? { tabQueryError: snapshot.failedGroupQueries.get(nativeGroupId) }
              : {}),
          })
          : { groupId: nativeGroupId, title: '', color: 'grey', tabIds: [] });
      }
      return [...unexpected.values()];
    }

    function buildNativeState(snapshot, map) {
      const mappingsByGroupId = new Map();
      for (const [groupKey, windowMap] of Object.entries(map || {})) {
        const entry = windowMap?.[String(snapshot.windowId)];
        if (!entry) continue;
        if (!mappingsByGroupId.has(entry.groupId)) mappingsByGroupId.set(entry.groupId, []);
        mappingsByGroupId.get(entry.groupId).push({ groupKey, origin: entry.origin });
      }
      return snapshot.liveGroups.map(group => {
        const groupId = Number(group.id);
        return groupDetails(group, snapshot.memberTabsByGroupId.get(groupId) || [], {
          mappings: mappingsByGroupId.get(groupId) || [],
          ...(snapshot.failedGroupQueries.has(groupId)
            ? { tabQueryError: snapshot.failedGroupQueries.get(groupId) }
            : {}),
        });
      });
    }

    async function updateCreatedGroup(groupId, group, {
      initializeCollapsed = false,
      liveGroup = null,
    } = {}) {
      const changes = {};
      if (!liveGroup || String(liveGroup.title || '') !== String(group.title || '')) {
        changes.title = group.title;
      }
      if (!liveGroup || String(liveGroup.color || 'grey') !== String(group.color || 'grey')) {
        changes.color = group.color;
      }
      // `collapsed` is an initial presentation choice, not durable ownership
      // state. Once the native group exists, Chrome's live value belongs to the
      // user; routine syncs may keep the managed title/color current but must
      // never collapse a group the user expanded (or vice versa).
      if (initializeCollapsed && (!liveGroup || Boolean(liveGroup.collapsed) !== Boolean(group.collapsed))) {
        changes.collapsed = group.collapsed;
      }
      // Chrome may emit tab-group events even when update() receives values
      // identical to the live group. Skipping a no-op write keeps the
      // background event-driven sync from feeding itself indefinitely.
      if (Object.keys(changes).length === 0) return null;
      await chromeApi.tabGroups.update(groupId, changes);
      return changes;
    }

    async function addTabsToGroup(groupId, tabIds) {
      if (tabIds.length === 0) return groupId;
      return chromeApi.tabs.group({ groupId, tabIds });
    }

    async function performDisabledSync(payload, map, snapshot) {
      const nextMap = cloneSessionMap(map);
      const results = [];
      const conflicts = [];
      for (const [groupKey, windowMap] of Object.entries(map)) {
        const entry = windowMap?.[String(payload.windowId)];
        if (!entry || entry.origin !== ORIGIN_CREATED) continue;
        const liveGroup = snapshot.groupById.get(entry.groupId);
        if (!liveGroup) {
          deleteMapping(nextMap, groupKey, payload.windowId);
          results.push({ groupKey, status: 'removed-stale-created', groupId: entry.groupId, origin: entry.origin });
          continue;
        }
        if (liveGroup.shared === true) {
          conflicts.push({
            groupKey,
            reason: 'shared-group',
            candidates: [groupDetails(
              liveGroup,
              snapshot.memberTabsByGroupId.get(entry.groupId) || []
            )],
          });
          results.push({ groupKey, status: 'frozen', groupId: entry.groupId, origin: entry.origin });
          continue;
        }
        if (snapshot.failedGroupQueries.has(entry.groupId)) {
          conflicts.push({
            groupKey,
            reason: 'group-query-failed',
            candidates: [groupDetails(liveGroup, [], {
              tabQueryError: snapshot.failedGroupQueries.get(entry.groupId),
            })],
          });
          results.push({ groupKey, status: 'frozen', groupId: entry.groupId, origin: entry.origin });
          continue;
        }
        const memberTabs = snapshot.memberTabsByGroupId.get(entry.groupId) || [];
        const memberIds = memberTabs.map(tab => Number(tab.id));
        if (memberIds.length > 0) await chromeApi.tabs.ungroup(memberIds);
        deleteMapping(nextMap, groupKey, payload.windowId);
        results.push({ groupKey, status: 'removed-created', groupId: entry.groupId, origin: entry.origin });
      }
      if (!sessionMapsEqual(nextMap, map)) await writeSessionMap(nextMap);
      const refreshed = await refreshSnapshotAfterWrites(payload.windowId, snapshot);
      const nativeGroups = buildNativeState(refreshed.snapshot, nextMap);
      return {
        ok: conflicts.length === 0,
        action: 'sync',
        enabled: false,
        windowId: payload.windowId,
        results,
        conflicts,
        state: {
          mapping: nextMap,
          sessionMap: nextMap,
          queryComplete: refreshed.queryComplete,
          nativeGroups,
          liveGroups: nativeGroups,
        },
      };
    }

    async function performDisabledSyncAllWindows(payload, map) {
      const liveWindowIds = await queryGlobalLiveWindowIds();
      let nextMap = cloneSessionMap(map);
      for (const [groupKey, windowMap] of Object.entries(nextMap)) {
        for (const windowIdKey of Object.keys(windowMap || {})) {
          if (!liveWindowIds.has(Number(windowIdKey))) {
            deleteMapping(nextMap, groupKey, Number(windowIdKey));
          }
        }
      }

      const windowIds = new Set();
      if (liveWindowIds.has(Number(payload.windowId))) windowIds.add(Number(payload.windowId));
      for (const windowMap of Object.values(nextMap || {})) {
        for (const [windowIdKey, entry] of Object.entries(windowMap || {})) {
          if (entry?.origin === ORIGIN_CREATED && /^\d+$/.test(windowIdKey)) {
            windowIds.add(Number(windowIdKey));
          }
        }
      }

      // Read every affected window before the first mutation. If even one
      // global snapshot fails, disabling sync is a zero-write round.
      const snapshots = new Map();
      for (const windowId of [...windowIds].sort((left, right) => left - right)) {
        snapshots.set(windowId, await queryWindowSnapshot(windowId));
      }

      const results = [];
      const conflicts = [];
      const windows = [];
      let queryComplete = true;
      for (const [windowId, snapshot] of snapshots) {
        const response = await performDisabledSync(
          { ...payload, windowId, allWindows: false },
          nextMap,
          snapshot
        );
        nextMap = response.state.sessionMap;
        results.push(...response.results);
        conflicts.push(...response.conflicts);
        queryComplete = queryComplete && response.state.queryComplete !== false;
        windows.push({ windowId, nativeGroups: response.state.nativeGroups });
      }
      if (!sessionMapsEqual(nextMap, map)) await writeSessionMap(nextMap);
      const nativeGroups = windows.flatMap(windowState => windowState.nativeGroups);
      return {
        ok: conflicts.length === 0,
        action: 'sync',
        enabled: false,
        allWindows: true,
        windowId: payload.windowId,
        results,
        conflicts,
        state: {
          mapping: nextMap,
          sessionMap: nextMap,
          queryComplete,
          nativeGroups,
          liveGroups: nativeGroups,
          windows,
        },
      };
    }

    async function performSync(payload) {
      const map = await readSessionMap();
      if (!payload.enabled) {
        const result = payload.allWindows
          ? await performDisabledSyncAllWindows(payload, map)
          : await performDisabledSync(payload, map, await queryWindowSnapshot(payload.windowId));
        await removeLegacyLocalMetaOnce();
        return result;
      }

      // All global and per-group reads complete before the first mutation. A
      // global query failure therefore guarantees a zero-write round.
      const snapshot = await queryWindowSnapshot(payload.windowId);

      const nextMap = cloneSessionMap(map);
      const desiredByKey = new Map(payload.groups.map(group => [group.groupKey, group]));
      const preserveGroupKeys = new Set(payload.preserveGroupKeys || []);
      const desiredKeyByTabId = new Map();
      for (const group of payload.groups) {
        for (const tabId of group.tabIds) desiredKeyByTabId.set(Number(tabId), group.groupKey);
      }
      const mappedSourceByGroupId = new Map();
      for (const [groupKey, windowMap] of Object.entries(map)) {
        const entry = windowMap?.[String(payload.windowId)];
        if (entry) mappedSourceByGroupId.set(Number(entry.groupId), { groupKey, ...entry });
      }
      const outgoingRelocationsByGroupId = new Map();
      const incomingSourceGroupIdsByKey = new Map();

      // A tab can legitimately change logical domains while remaining inside
      // the extension-created native group that owned its previous URL. Treat
      // that exact, live mapping as a relocation source instead of freezing
      // both groups forever. Adopted/shared/incomplete groups remain immutable:
      // changing their membership would exceed the ownership represented by
      // the session map or guess from an incomplete Chrome snapshot.
      for (const [tabId, destinationKey] of desiredKeyByTabId) {
        const liveTab = snapshot.tabsById.get(tabId);
        const sourceGroupId = Number(liveTab?.groupId);
        if (!liveTab || liveTab.pinned || !Number.isInteger(sourceGroupId) || sourceGroupId < 0) continue;
        const source = mappedSourceByGroupId.get(sourceGroupId);
        if (!source || source.origin !== ORIGIN_CREATED || source.groupKey === destinationKey) continue;
        if (!preserveGroupKeys.has(source.groupKey)) continue;
        const liveSourceGroup = snapshot.groupById.get(sourceGroupId);
        if (!liveSourceGroup || liveSourceGroup.shared === true ||
            snapshot.failedGroupQueries.has(sourceGroupId)) continue;

        if (!outgoingRelocationsByGroupId.has(sourceGroupId)) {
          outgoingRelocationsByGroupId.set(sourceGroupId, new Set());
        }
        outgoingRelocationsByGroupId.get(sourceGroupId).add(tabId);
        if (!incomingSourceGroupIdsByKey.has(destinationKey)) {
          incomingSourceGroupIdsByKey.set(destinationKey, new Set());
        }
        incomingSourceGroupIdsByKey.get(destinationKey).add(sourceGroupId);
      }
      const results = [];
      const conflicts = [];
      const plans = [];

      // Retire mappings not present in the latest snapshot. Created groups are
      // dismantled; adopted groups are merely forgotten and never ungrouped.
      for (const [groupKey, windowMap] of Object.entries(map)) {
        const entry = windowMap?.[String(payload.windowId)];
        if (!entry || desiredByKey.has(groupKey)) continue;
        if (preserveGroupKeys.has(groupKey)) {
          results.push({
            groupKey,
            status: 'frozen-preserved',
            groupId: entry.groupId,
            origin: entry.origin,
          });
          continue;
        }
        const liveGroup = snapshot.groupById.get(entry.groupId);
        if (entry.origin === ORIGIN_CREATED && liveGroup) {
          if (liveGroup.shared === true) {
            conflicts.push({
              groupKey,
              reason: 'shared-group',
              candidates: [groupDetails(
                liveGroup,
                snapshot.memberTabsByGroupId.get(entry.groupId) || []
              )],
            });
            results.push({ groupKey, status: 'frozen', groupId: entry.groupId, origin: entry.origin });
            continue;
          }
          if (snapshot.failedGroupQueries.has(entry.groupId)) {
            conflicts.push({
              groupKey,
              reason: 'group-query-failed',
              candidates: [groupDetails(liveGroup, [], {
                tabQueryError: snapshot.failedGroupQueries.get(entry.groupId),
              })],
            });
            results.push({ groupKey, status: 'frozen', groupId: entry.groupId, origin: entry.origin });
            continue;
          }
          plans.push({
            kind: 'remove-created',
            groupKey,
            groupId: entry.groupId,
            tabIds: (snapshot.memberTabsByGroupId.get(entry.groupId) || []).map(tab => Number(tab.id)),
          });
        } else {
          deleteMapping(nextMap, groupKey, payload.windowId);
          results.push({
            groupKey,
            status: liveGroup ? 'released-adopted' : 'removed-stale',
            groupId: entry.groupId,
            origin: entry.origin,
          });
        }
      }

      for (const group of payload.groups) {
        const tabErrors = validateDesiredTabs(group, snapshot);
        if (tabErrors.length > 0) {
          conflicts.push({ groupKey: group.groupKey, reason: 'invalid-live-tabs', candidates: [], tabErrors });
          results.push({ groupKey: group.groupKey, status: 'frozen' });
          continue;
        }

        let mapping = getMapping(nextMap, group.groupKey, payload.windowId);
        let mappedGroup = mapping ? snapshot.groupById.get(mapping.groupId) : null;
        if (mapping && !mappedGroup) {
          deleteMapping(nextMap, group.groupKey, payload.windowId);
          mapping = null;
        }

        if (mapping && mappedGroup) {
          const mappedGroupId = Number(mappedGroup.id);
          if (mappedGroup.shared === true || snapshot.failedGroupQueries.has(mappedGroupId)) {
            const mappedMembers = snapshot.memberTabsByGroupId.get(mappedGroupId) || [];
            conflicts.push({
              groupKey: group.groupKey,
              reason: mappedGroup.shared === true ? 'shared-group' : 'group-query-failed',
              candidates: [groupDetails(mappedGroup, mappedMembers, {
                ...(snapshot.failedGroupQueries.has(mappedGroupId)
                  ? { tabQueryError: snapshot.failedGroupQueries.get(mappedGroupId) }
                  : {}),
              })],
            });
            results.push({ groupKey: group.groupKey, status: 'frozen', groupId: mappedGroupId, origin: mapping.origin });
            continue;
          }

          if (mapping.origin === ORIGIN_ADOPTED && String(mappedGroup.title || '') !== group.title) {
            conflicts.push({
              groupKey: group.groupKey,
              reason: 'adopted-title-mismatch',
              candidates: [groupDetails(
                mappedGroup,
                snapshot.memberTabsByGroupId.get(mappedGroupId) || []
              )],
            });
            results.push({
              groupKey: group.groupKey,
              status: 'frozen',
              groupId: mappedGroupId,
              origin: mapping.origin,
            });
            continue;
          }

          const mappedMembers = snapshot.memberTabsByGroupId.get(mappedGroupId) || [];
          const desiredIds = new Set(group.tabIds);
          const outgoingIds = outgoingRelocationsByGroupId.get(mappedGroupId) || new Set();
          if (!mappedMembers.every(tab =>
            desiredIds.has(Number(tab.id)) || outgoingIds.has(Number(tab.id))
          )) {
            conflicts.push({
              groupKey: group.groupKey,
              reason: 'mapped-group-has-unrelated-tabs',
              candidates: [groupDetails(mappedGroup, mappedMembers)],
            });
            results.push({ groupKey: group.groupKey, status: 'frozen', groupId: mappedGroupId, origin: mapping.origin });
            continue;
          }

          // A current ownership mapping does not make a second safe same-name
          // group disappear. Surface all such groups as the same explicit
          // merge conflict used during first adoption; otherwise the extra
          // group would be reported only as unexpected membership and the
          // dashboard would have no confirmation path to resolve it.
          const mappedCandidate = groupDetails(mappedGroup, mappedMembers);
          const incomingSourceIds = incomingSourceGroupIdsByKey.get(group.groupKey) || new Set();
          const { candidates, failedRelated } = findCandidates(group, snapshot, incomingSourceIds);
          if (failedRelated.length > 0) {
            conflicts.push({
              groupKey: group.groupKey,
              reason: 'group-query-failed',
              candidates: failedRelated,
            });
            results.push({
              groupKey: group.groupKey,
              status: 'frozen',
              groupId: mappedGroupId,
              origin: mapping.origin,
            });
            continue;
          }
          const safeCandidatesById = new Map([[mappedGroupId, mappedCandidate]]);
          for (const candidate of candidates) {
            safeCandidatesById.set(Number(candidate.groupId), candidate);
          }
          const safeCandidates = [...safeCandidatesById.values()].sort((left, right) =>
            Number(left.minIndex ?? Number.MAX_SAFE_INTEGER) -
              Number(right.minIndex ?? Number.MAX_SAFE_INTEGER) ||
            Number(left.groupId) - Number(right.groupId)
          );
          if (safeCandidates.length > 1) {
            conflicts.push({
              groupKey: group.groupKey,
              reason: 'multiple-candidates',
              candidates: safeCandidates,
            });
            results.push({
              groupKey: group.groupKey,
              status: 'conflict',
              groupId: mappedGroupId,
              origin: mapping.origin,
            });
            continue;
          }

          const unexpected = findUnexpectedNativeMembership(
            group,
            new Set([mappedGroupId, ...incomingSourceIds]),
            snapshot
          );
          if (unexpected.length > 0) {
            conflicts.push({ groupKey: group.groupKey, reason: 'unexpected-native-membership', candidates: unexpected });
            results.push({ groupKey: group.groupKey, status: 'frozen', groupId: mappedGroupId, origin: mapping.origin });
            continue;
          }

          plans.push({
            kind: 'reuse',
            group,
            groupId: mappedGroupId,
            origin: mapping.origin,
            tabIds: group.tabIds.filter(tabId =>
              !mappedMembers.some(tab => Number(tab.id) === Number(tabId))
            ),
          });
          continue;
        }

        const incomingSourceIds = incomingSourceGroupIdsByKey.get(group.groupKey) || new Set();
        const { candidates, failedRelated } = findCandidates(group, snapshot, incomingSourceIds);
        if (failedRelated.length > 0) {
          conflicts.push({ groupKey: group.groupKey, reason: 'group-query-failed', candidates: failedRelated });
          results.push({ groupKey: group.groupKey, status: 'frozen' });
          continue;
        }
        if (candidates.length > 1) {
          conflicts.push({ groupKey: group.groupKey, reason: 'multiple-candidates', candidates });
          results.push({ groupKey: group.groupKey, status: 'conflict' });
          continue;
        }

        const allowed = new Set([
          ...candidates.map(candidate => candidate.groupId),
          ...incomingSourceIds,
        ]);
        const unexpected = findUnexpectedNativeMembership(group, allowed, snapshot);
        if (unexpected.length > 0) {
          conflicts.push({ groupKey: group.groupKey, reason: 'unexpected-native-membership', candidates: unexpected });
          results.push({ groupKey: group.groupKey, status: 'frozen' });
          continue;
        }

        if (candidates.length === 1) {
          const existingIds = new Set((candidates[0].tabIds || []).map(Number));
          plans.push({
            kind: 'adopt',
            group,
            groupId: candidates[0].groupId,
            origin: ORIGIN_ADOPTED,
            tabIds: group.tabIds.filter(tabId => !existingIds.has(Number(tabId))),
          });
        } else {
          plans.push({ kind: 'create', group, origin: ORIGIN_CREATED });
        }
      }

      // Relocation plans are connected: a source-group reuse must not run when
      // one of its destinations failed preflight, and a destination shared by
      // several sources must not partially move the remaining tabs either.
      // Cancel the whole connected relocation component before the first write
      // so query failures cannot leak an otherwise harmless title/color/add
      // update from the source group.
      const plannedGroupKeys = new Set(
        plans.map(plan => plan.group?.groupKey).filter(Boolean)
      );
      const blockedSourceGroupIds = new Set();
      for (const [destinationKey, sourceGroupIds] of incomingSourceGroupIdsByKey) {
        if (plannedGroupKeys.has(destinationKey)) continue;
        for (const sourceGroupId of sourceGroupIds) blockedSourceGroupIds.add(sourceGroupId);
      }
      const blockedDestinationKeys = new Set();
      let addedDependency = true;
      while (addedDependency) {
        addedDependency = false;
        for (const [destinationKey, sourceGroupIds] of incomingSourceGroupIdsByKey) {
          if (![...sourceGroupIds].some(groupId => blockedSourceGroupIds.has(groupId))) continue;
          if (!blockedDestinationKeys.has(destinationKey)) {
            blockedDestinationKeys.add(destinationKey);
            addedDependency = true;
          }
          for (const sourceGroupId of sourceGroupIds) {
            if (!blockedSourceGroupIds.has(sourceGroupId)) {
              blockedSourceGroupIds.add(sourceGroupId);
              addedDependency = true;
            }
          }
        }
      }
      const executablePlans = plans.filter(plan => {
        const groupKey = plan.group?.groupKey || plan.groupKey;
        if (blockedDestinationKeys.has(groupKey)) return false;
        return !blockedSourceGroupIds.has(Number(plan.groupId));
      });

      // Execute the preflighted plan. No candidate choice is made after writes
      // begin, which keeps conflict handling deterministic. If a later Chrome
      // write fails, persist ownership already established by earlier writes so
      // the next round cannot orphan and duplicate those groups.
      try {
        for (const plan of executablePlans) {
          if (plan.kind === 'remove-created') {
            if (plan.tabIds.length > 0) await chromeApi.tabs.ungroup(plan.tabIds);
            deleteMapping(nextMap, plan.groupKey, payload.windowId);
            results.push({
              groupKey: plan.groupKey,
              status: 'removed-created',
              groupId: plan.groupId,
              origin: ORIGIN_CREATED,
            });
            continue;
          }

          if (plan.kind === 'create') {
            const groupId = await chromeApi.tabs.group({ tabIds: plan.group.tabIds });
            if (!Number.isInteger(groupId) || groupId < 0) {
              throw new CoordinatorError('CREATE_FAILED', `Chrome did not create a group for ${plan.group.groupKey}`);
            }
            setMapping(nextMap, plan.group.groupKey, payload.windowId, groupId, ORIGIN_CREATED);
            try {
              await updateCreatedGroup(groupId, plan.group, { initializeCollapsed: true });
            } catch (error) {
              throw new CoordinatorError('GROUP_UPDATE_FAILED', error?.message || 'created group could not be updated', {
                groupKey: plan.group.groupKey,
                groupId,
              });
            }
            results.push({
              groupKey: plan.group.groupKey,
              status: 'created',
              groupId,
              origin: ORIGIN_CREATED,
            });
            continue;
          }

          // Existing members stay in place. Re-submitting them to tabs.group
          // is unnecessary and can let Chrome move them within the strip;
          // only the validated missing tabs are joined.
          await addTabsToGroup(plan.groupId, plan.tabIds || []);
          setMapping(nextMap, plan.group.groupKey, payload.windowId, plan.groupId, plan.origin);
          if (plan.origin === ORIGIN_CREATED) {
            await updateCreatedGroup(plan.groupId, plan.group, {
              liveGroup: snapshot.groupById.get(Number(plan.groupId)) || null,
            });
          }
          results.push({
            groupKey: plan.group.groupKey,
            status: plan.kind === 'adopt' ? 'adopted' : 'reused',
            groupId: plan.groupId,
            origin: plan.origin,
          });
        }
      } catch (error) {
        if (!sessionMapsEqual(nextMap, map)) {
          try {
            await writeSessionMap(nextMap);
          } catch (storageError) {
            throw new CoordinatorError('PARTIAL_SYNC_STORAGE_FAILED', storageError?.message || 'partial sync map could not be saved', {
              cause: error?.message || String(error),
            });
          }
        }
        throw error;
      }

      if (!sessionMapsEqual(nextMap, map)) await writeSessionMap(nextMap);
      await removeLegacyLocalMetaOnce();
      const refreshed = await refreshSnapshotAfterWrites(payload.windowId, snapshot);
      const reconciledMap = refreshed.queryComplete
        ? reconcileWindowMappings(nextMap, payload.windowId, refreshed.snapshot.liveGroups)
        : nextMap;
      if (!sessionMapsEqual(reconciledMap, nextMap)) await writeSessionMap(reconciledMap);
      const nativeGroups = buildNativeState(refreshed.snapshot, reconciledMap);
      return {
        ok: conflicts.length === 0,
        action: 'sync',
        enabled: true,
        windowId: payload.windowId,
        results,
        conflicts,
        state: {
          mapping: reconciledMap,
          sessionMap: reconciledMap,
          queryComplete: refreshed.queryComplete,
          nativeGroups,
          liveGroups: nativeGroups,
        },
      };
    }

    function getLiveMutationTabIds(tabIds, snapshot, { allowPinned = false } = {}) {
      const liveIds = [];
      const skippedTabIds = [];
      for (const tabId of tabIds || []) {
        const tab = snapshot.tabsById.get(Number(tabId));
        if (!tab || (!allowPinned && tab.pinned)) {
          skippedTabIds.push(Number(tabId));
          continue;
        }
        const sourceGroup = snapshot.groupById.get(Number(tab.groupId));
        if (sourceGroup?.shared === true) {
          throw new CoordinatorError('LIVE_STATE_CONFLICT', 'tabs in shared Chrome groups cannot be moved automatically', {
            tabId: Number(tab.id),
            groupId: Number(sourceGroup.id),
          });
        }
        liveIds.push(Number(tab.id));
      }
      return { liveIds, skippedTabIds };
    }

    async function moveTabsInOrder(tabIds, windowId, baseIndex) {
      for (const [offset, tabId] of (tabIds || []).entries()) {
        await chromeApi.tabs.move(Number(tabId), {
          windowId: Number(windowId),
          index: Number(baseIndex) + offset,
        });
      }
    }

    async function performMutation(payload) {
      const map = await readSessionMap();
      const snapshot = await queryWindowSnapshot(payload.windowId);

      if (payload.operation === 'update') {
        const target = snapshot.groupById.get(payload.targetGroupId);
        if (!target) throw new CoordinatorError('LIVE_STATE_CONFLICT', 'target Chrome group no longer exists');
        await chromeApi.tabGroups.update(payload.targetGroupId, payload.changes);
        const refreshed = await refreshSnapshotAfterWrites(payload.windowId, snapshot);
        await removeLegacyLocalMetaOnce();
        const nativeGroups = buildNativeState(refreshed.snapshot, map);
        return {
          ok: true,
          action: 'merge',
          operation: payload.operation,
          windowId: payload.windowId,
          groupId: payload.targetGroupId,
          state: {
            mapping: map,
            sessionMap: map,
            queryComplete: refreshed.queryComplete,
            nativeGroups,
            liveGroups: nativeGroups,
          },
        };
      }

      if (payload.operation === 'reorder') {
        const target = snapshot.groupById.get(payload.targetGroupId);
        if (!target || target.shared === true) {
          throw new CoordinatorError('LIVE_STATE_CONFLICT', 'target Chrome group cannot be reordered');
        }
        if (snapshot.failedGroupQueries.has(payload.targetGroupId)) {
          throw new CoordinatorError('GROUP_QUERY_FAILED', 'could not read the target Chrome group');
        }
        const members = snapshot.memberTabsByGroupId.get(payload.targetGroupId) || [];
        const memberIds = new Set(members.map(tab => Number(tab.id)));
        const orderedIds = payload.tabIds.filter(tabId => memberIds.has(Number(tabId)));
        const baseIndex = members.length
          ? Math.min(...members.map(tab => Number(tab.index)).filter(Number.isFinite))
          : 0;
        if (orderedIds.length > 1) await moveTabsInOrder(orderedIds, payload.windowId, baseIndex);
        return {
          ok: true,
          action: 'merge',
          operation: payload.operation,
          windowId: payload.windowId,
          groupId: payload.targetGroupId,
          orderedTabIds: orderedIds,
        };
      }

      const { liveIds, skippedTabIds } = getLiveMutationTabIds(payload.tabIds, snapshot);
      if (liveIds.length === 0) {
        throw new CoordinatorError('LIVE_STATE_CONFLICT', 'no eligible tabs remain for this operation', { skippedTabIds });
      }

      if (payload.operation === 'ungroup') {
        await chromeApi.tabs.ungroup(liveIds);
        const refreshed = await refreshSnapshotAfterWrites(payload.windowId, snapshot);
        const nativeGroups = buildNativeState(refreshed.snapshot, map);
        return {
          ok: true,
          action: 'merge',
          operation: payload.operation,
          windowId: payload.windowId,
          tabIds: liveIds,
          skippedTabIds,
          state: {
            mapping: map,
            sessionMap: map,
            queryComplete: refreshed.queryComplete,
            nativeGroups,
            liveGroups: nativeGroups,
          },
        };
      }

      if (payload.operation === 'join') {
        const target = snapshot.groupById.get(payload.targetGroupId);
        if (!target || target.shared === true || snapshot.failedGroupQueries.has(payload.targetGroupId)) {
          throw new CoordinatorError('LIVE_STATE_CONFLICT', 'target Chrome group cannot accept tabs');
        }
        await chromeApi.tabs.group({ groupId: payload.targetGroupId, tabIds: liveIds });
        if (payload.orderedTabIds.length > 1) {
          const currentMembers = snapshot.memberTabsByGroupId.get(payload.targetGroupId) || [];
          const memberIds = new Set([...currentMembers.map(tab => Number(tab.id)), ...liveIds]);
          const orderedIds = payload.orderedTabIds.filter(tabId => memberIds.has(Number(tabId)));
          const baseIndex = currentMembers.length
            ? Math.min(...currentMembers.map(tab => Number(tab.index)).filter(Number.isFinite))
            : Math.min(...liveIds.map(tabId => Number(snapshot.tabsById.get(tabId)?.index)).filter(Number.isFinite));
          if (orderedIds.length > 1 && Number.isFinite(baseIndex)) {
            await moveTabsInOrder(orderedIds, payload.windowId, baseIndex);
          }
        }
        const refreshed = await refreshSnapshotAfterWrites(payload.windowId, snapshot);
        const nativeGroups = buildNativeState(refreshed.snapshot, map);
        return {
          ok: true,
          action: 'merge',
          operation: payload.operation,
          windowId: payload.windowId,
          groupId: payload.targetGroupId,
          tabIds: liveIds,
          skippedTabIds,
          state: {
            mapping: map,
            sessionMap: map,
            queryComplete: refreshed.queryComplete,
            nativeGroups,
            liveGroups: nativeGroups,
          },
        };
      }

      const groupId = await chromeApi.tabs.group({
        tabIds: liveIds,
        createProperties: { windowId: payload.windowId },
      });
      if (!Number.isInteger(groupId) || groupId < 0) {
        throw new CoordinatorError('CREATE_FAILED', 'Chrome did not create a tab group');
      }
      let updated = true;
      try {
        await chromeApi.tabGroups.update(groupId, {
          title: payload.title,
          color: payload.color,
        });
      } catch (error) {
        updated = false;
        try {
          logger.warn?.('[tab-harbor] group created but presentation update failed:', error);
        } catch {}
      }
      const requestedOrder = payload.orderedTabIds.filter(tabId => liveIds.includes(Number(tabId)));
      if (requestedOrder.length > 1) {
        const baseIndex = Math.min(...liveIds
          .map(tabId => Number(snapshot.tabsById.get(tabId)?.index))
          .filter(Number.isFinite));
        if (Number.isFinite(baseIndex)) await moveTabsInOrder(requestedOrder, payload.windowId, baseIndex);
      }
      const refreshed = await refreshSnapshotAfterWrites(payload.windowId, snapshot);
      const nativeGroups = buildNativeState(refreshed.snapshot, map);
      return {
        ok: true,
        action: 'merge',
        operation: payload.operation,
        windowId: payload.windowId,
        groupId,
        updated,
        mergedTabIds: liveIds,
        skippedTabIds,
        state: {
          mapping: map,
          sessionMap: map,
          queryComplete: refreshed.queryComplete,
          nativeGroups,
          liveGroups: nativeGroups,
        },
      };
    }

    async function performMerge(payload) {
      if (payload.operation !== 'merge-groups') {
        return performMutation(payload);
      }
      const map = await readSessionMap();
      const snapshot = await queryWindowSnapshot(payload.windowId);
      const allIds = [payload.targetGroupId, ...payload.sourceGroupIds];
      const groups = allIds.map(groupId => snapshot.groupById.get(groupId));
      if (groups.some(group => !group)) {
        throw new CoordinatorError('LIVE_STATE_CONFLICT', 'one or more merge groups no longer exist', { groupIds: allIds });
      }
      if (groups.some(group => group.shared === true)) {
        throw new CoordinatorError('LIVE_STATE_CONFLICT', 'shared Chrome groups cannot be merged', { groupIds: allIds });
      }
      const failedIds = allIds.filter(groupId => snapshot.failedGroupQueries.has(groupId));
      if (failedIds.length > 0) {
        throw new CoordinatorError('GROUP_QUERY_FAILED', 'could not read every group selected for merge', {
          groups: failedIds.map(groupId => groupDetails(snapshot.groupById.get(groupId), [], {
            tabQueryError: snapshot.failedGroupQueries.get(groupId),
          })),
        });
      }

      const expectedByGroupId = new Map(payload.expectedGroups.map(group => [group.groupId, group]));
      const changedGroups = [];
      for (const groupId of allIds) {
        const liveGroup = snapshot.groupById.get(groupId);
        const expected = expectedByGroupId.get(groupId);
        const liveTabs = snapshot.memberTabsByGroupId.get(groupId) || [];
        const liveMembers = liveTabs.map(tab => ({
          tabId: Number(tab.id),
          url: String(tab.url || tab.pendingUrl || ''),
        }));
        const appearanceChanged = String(liveGroup.title || '') !== expected.title ||
          String(liveGroup.color || 'grey') !== expected.color;
        const membershipChanged = liveMembers.length !== expected.tabs.length ||
          liveMembers.some((tab, index) =>
            tab.tabId !== expected.tabs[index].tabId || tab.url !== expected.tabs[index].url
          );
        if (appearanceChanged || membershipChanged) {
          changedGroups.push(groupDetails(liveGroup, liveTabs, {
            expectedTitle: expected.title,
            expectedColor: expected.color,
            expectedTabs: expected.tabs,
          }));
        }
      }
      if (changedGroups.length > 0) {
        throw new CoordinatorError(
          'LIVE_STATE_CONFLICT',
          'one or more merge groups changed after confirmation opened',
          { groups: changedGroups }
        );
      }

      const mapped = [];
      for (const [groupKey, windowMap] of Object.entries(map)) {
        const entry = windowMap?.[String(payload.windowId)];
        if (entry && allIds.includes(entry.groupId)) mapped.push({ groupKey, ...entry });
      }
      const mappedKeys = new Set(mapped.map(entry => entry.groupKey));
      if (mappedKeys.size > 1) {
        throw new CoordinatorError('MAPPING_CONFLICT', 'merge groups belong to different logical groups', {
          mappings: mapped,
        });
      }
      if (payload.groupKey && mappedKeys.size === 1 && !mappedKeys.has(payload.groupKey)) {
        throw new CoordinatorError('MAPPING_CONFLICT', 'merge groupKey does not match the live mapping', {
          mappings: mapped,
          groupKey: payload.groupKey,
        });
      }

      const allTabs = allIds
        .flatMap(groupId => snapshot.memberTabsByGroupId.get(groupId) || [])
        .filter((tab, index, tabs) => tabs.findIndex(item => Number(item.id) === Number(tab.id)) === index)
        .sort((a, b) => Number(a.index) - Number(b.index));
      const orderedTabIds = allTabs.map(tab => Number(tab.id));
      const sourceTabIds = payload.sourceGroupIds
        .flatMap(groupId => snapshot.memberTabsByGroupId.get(groupId) || [])
        .map(tab => Number(tab.id));
      if (sourceTabIds.length === 0) {
        throw new CoordinatorError('LIVE_STATE_CONFLICT', 'source groups contain no tabs');
      }

      // Adding source tabs to the target keeps the target group's title, color
      // and collapsed state. No tabGroups.update call is made here.
      await chromeApi.tabs.group({ groupId: payload.targetGroupId, tabIds: sourceTabIds });
      const baseIndex = allTabs.length > 0
        ? Math.min(...allTabs.map(tab => Number(tab.index)).filter(Number.isFinite))
        : 0;
      for (const [offset, tabId] of orderedTabIds.entries()) {
        await chromeApi.tabs.move(tabId, { windowId: payload.windowId, index: baseIndex + offset });
      }

      const nextMap = cloneSessionMap(map);
      for (const entry of mapped) deleteMapping(nextMap, entry.groupKey, payload.windowId);
      const resolvedGroupKey = payload.groupKey || mapped[0]?.groupKey || '';
      if (resolvedGroupKey) {
        const targetMapping = mapped.find(entry => entry.groupId === payload.targetGroupId);
        const origin = targetMapping?.origin === ORIGIN_CREATED ? ORIGIN_CREATED : ORIGIN_ADOPTED;
        setMapping(nextMap, resolvedGroupKey, payload.windowId, payload.targetGroupId, origin);
      }
      if (!sessionMapsEqual(nextMap, map)) await writeSessionMap(nextMap);

      const target = snapshot.groupById.get(payload.targetGroupId);
      const refreshed = await refreshSnapshotAfterWrites(payload.windowId, snapshot);
      const nativeGroups = buildNativeState(refreshed.snapshot, nextMap);
      return {
        ok: true,
        action: 'merge',
        windowId: payload.windowId,
        target: groupDetails(target, allTabs),
        mergedGroupIds: payload.sourceGroupIds,
        state: {
          mapping: nextMap,
          sessionMap: nextMap,
          queryComplete: refreshed.queryComplete,
          nativeGroups,
          liveGroups: nativeGroups,
        },
      };
    }

    async function queryState(payload) {
      const map = await readSessionMap();
      if (payload.windowId != null) {
        const snapshot = await queryWindowSnapshot(payload.windowId);
        const nextMap = reconcileWindowMappings(map, payload.windowId, snapshot.liveGroups);
        if (!sessionMapsEqual(nextMap, map)) await writeSessionMap(nextMap);
        await removeLegacyLocalMetaOnce();
        const nativeGroups = buildNativeState(snapshot, nextMap);
        return {
          ok: true,
          action: 'get-state',
          state: {
            mapping: nextMap,
            sessionMap: nextMap,
            liveGroups: nativeGroups,
            windows: [{
              windowId: payload.windowId,
              nativeGroups,
            }],
          },
        };
      }

      let groups;
      try {
        groups = await chromeApi.tabGroups.query({});
      } catch (error) {
        throw new CoordinatorError('GLOBAL_QUERY_FAILED', error?.message || 'could not query live Chrome groups');
      }
      if (!Array.isArray(groups)) {
        throw new CoordinatorError('GLOBAL_QUERY_FAILED', 'Chrome returned an invalid live group list');
      }
      const validGlobalGroup = group => isRecord(group) &&
        Number.isInteger(group.id) && group.id >= 0 &&
        Number.isInteger(group.windowId) && group.windowId >= 0;
      if (!groups.every(validGlobalGroup) ||
          new Set(groups.map(group => Number(group.id))).size !== groups.length) {
        throw new CoordinatorError('GLOBAL_QUERY_FAILED', 'Chrome returned a malformed live group list');
      }
      const windowIds = [...new Set(groups.map(group => Number(group.windowId)).filter(Number.isInteger))];
      const windows = [];
      let nextMap = cloneSessionMap(map);
      for (const windowId of windowIds) {
        const snapshot = await queryWindowSnapshot(windowId);
        nextMap = reconcileWindowMappings(nextMap, windowId, snapshot.liveGroups);
        windows.push({ windowId, snapshot });
      }
      const liveWindowIds = new Set(windowIds.map(String));
      for (const [groupKey, windowMap] of Object.entries(nextMap)) {
        for (const windowIdKey of Object.keys(windowMap)) {
          if (!liveWindowIds.has(windowIdKey)) deleteMapping(nextMap, groupKey, Number(windowIdKey));
        }
      }
      if (!sessionMapsEqual(nextMap, map)) await writeSessionMap(nextMap);
      const renderedWindows = windows.map(({ windowId, snapshot }) => ({
        windowId,
        nativeGroups: buildNativeState(snapshot, nextMap),
      }));
      await removeLegacyLocalMetaOnce();
      return {
        ok: true,
        action: 'get-state',
        state: {
          mapping: nextMap,
          sessionMap: nextMap,
          liveGroups: renderedWindows.flatMap(windowState => windowState.nativeGroups),
          windows: renderedWindows,
        },
      };
    }

    function scheduleSync(payload) {
      const windowKey = payload.allWindows ? '*' : String(payload.windowId);
      let slot = syncSlots.get(windowKey);
      if (!slot) {
        slot = { scheduled: false, latest: null, waiters: [] };
        syncSlots.set(windowKey, slot);
      }
      slot.latest = payload;

      const promise = new Promise(resolve => {
        slot.waiters.push(resolve);
      });

      if (!slot.scheduled) {
        slot.scheduled = true;
        enqueueOperation(async () => {
          slot.scheduled = false;
          const latest = slot.latest;
          const waiters = slot.waiters.splice(0);
          slot.latest = null;
          let result;
          try {
            result = await performSync(await applyAuthoritativeSyncSetting(latest));
          } catch (error) {
            result = asErrorResult('sync', error);
          }
          for (const resolve of waiters) resolve(result);
          if (!slot.scheduled && slot.latest) {
            // A newer snapshot arrived while this one was running. Re-enter via
            // scheduleSync so it is placed after operations already in queue.
            const pending = slot.latest;
            const pendingWaiters = slot.waiters.splice(0);
            slot.latest = null;
            const pendingPromise = scheduleSync(pending);
            pendingPromise.then(nextResult => pendingWaiters.forEach(resolve => resolve(nextResult)));
          }
          if (!slot.scheduled && !slot.latest && slot.waiters.length === 0) syncSlots.delete(windowKey);
          return result;
        });
      }

      return promise;
    }

    function sync(input) {
      let payload;
      try {
        payload = validateSyncPayload(input);
      } catch (error) {
        return Promise.resolve(asErrorResult('sync', error));
      }
      return scheduleSync(payload);
    }

    function merge(input) {
      let payload;
      try {
        payload = validateMergePayload(input);
      } catch (error) {
        return Promise.resolve(asErrorResult('merge', error));
      }
      return enqueueOperation(async () => {
        try {
          return await performMerge(payload);
        } catch (error) {
          return asErrorResult('merge', error);
        }
      });
    }

    function getState(input = {}) {
      let payload;
      try {
        payload = validateGetStatePayload(input);
      } catch (error) {
        return Promise.resolve(asErrorResult('get-state', error));
      }
      return enqueueOperation(async () => {
        try {
          return await queryState(payload);
        } catch (error) {
          return asErrorResult('get-state', error);
        }
      });
    }

    function dispatch(input) {
      let payload;
      try {
        payload = validateDispatchPayload(input);
      } catch (error) {
        return Promise.resolve(asErrorResult(input?.action || 'unknown', error));
      }
      if (payload.action === 'sync') return scheduleSync(payload);
      if (payload.action === 'merge') return merge(payload);
      return getState(payload);
    }

    return {
      dispatch,
      sync,
      merge,
      getState,
    };
  }

  const api = {
    SESSION_MAP_KEY,
    LEGACY_LOCAL_META_KEY,
    ORIGIN_CREATED,
    ORIGIN_ADOPTED,
    createChromeTabGroupsCoordinator,
    validateSyncPayload,
    validateMergePayload,
    validateGetStatePayload,
    normalizeSessionMap,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.TabHarborChromeTabGroupsCoordinator = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
