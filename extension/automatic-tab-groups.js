'use strict';

(function attachAutomaticTabGroups(globalScope) {
  const LANDING_GROUP_KEY = '__landing-pages__';
  const AUTOMATIC_RULE_OVERRIDES_VERSION = 1;
  const AUTOMATIC_GROUP_COLORS = Object.freeze([
    'grey',
    'red',
    'green',
    'pink',
    'purple',
    'cyan',
    'orange',
  ]);
  const BASE_LANDING_PAGE_PATTERNS = Object.freeze([
    { hostname: 'mail.google.com', test: (_pathname, href) =>
        !href.includes('#inbox') && !href.includes('#sent') && !href.includes('#search/') },
    { hostname: 'x.com', pathExact: ['/home'] },
    { hostname: 'www.linkedin.com', pathExact: ['/'] },
    { hostname: 'github.com', pathExact: ['/'] },
    { hostname: 'www.youtube.com', pathExact: ['/'] },
  ]);

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function matchesHostnameSuffix(hostname = '', suffix = '') {
    const normalizedHostname = String(hostname || '')
      .trim()
      .toLowerCase()
      .replace(/\.+$/, '');
    const normalizedSuffix = String(suffix || '')
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, '');
    if (!normalizedHostname || !normalizedSuffix) return false;
    return normalizedHostname === normalizedSuffix ||
      normalizedHostname.endsWith(`.${normalizedSuffix}`);
  }

  function getUrlUtils() {
    return globalScope.TabHarborTabUrlUtils || {};
  }

  function getIconUtils() {
    return globalScope.TabOutIconUtils || {};
  }

  function getCanonicalUrl(tab = {}) {
    const rawUrl = String(tab.rawUrl || tab.url || '');
    const canonicalize = getUrlUtils().getCanonicalTabUrl;
    return typeof canonicalize === 'function' ? canonicalize(rawUrl) : rawUrl.trim();
  }

  function isRestorableUrl(url = '') {
    const isRestorable = getUrlUtils().isRestorableTabUrl;
    if (typeof isRestorable === 'function') return isRestorable(url);
    try {
      const protocol = new URL(String(url || '')).protocol;
      return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
    } catch {
      return false;
    }
  }

  function getAutomaticLandingPagePatterns(extraPatterns = []) {
    const extras = Array.isArray(extraPatterns) ? extraPatterns : [];
    return [...BASE_LANDING_PAGE_PATTERNS, ...extras];
  }

  function normalizeRuleHostnameFields(rule = {}) {
    const normalized = {};
    if (typeof rule.hostname === 'string' && rule.hostname) {
      normalized.hostname = rule.hostname;
    } else if (rule.hostnameEndsWith) {
      normalized.hostnameEndsWith = String(rule.hostnameEndsWith);
    }
    return normalized;
  }

  /**
   * createAutomaticGroupingRuleOverrides()
   *
   * Converts page-only config.local.js rules into the declarative subset the
   * background worker can safely consume from chrome.storage.local. Function
   * predicates are deliberately never serialized; their presence marks the
   * snapshot dashboard-only so background reconciliation fails closed instead
   * of applying a different grouping policy.
   */
  function createAutomaticGroupingRuleOverrides(input = {}) {
    const landingPagePatterns = [];
    const customGroups = [];
    let backgroundSafe = true;

    for (const rule of Array.isArray(input.landingPagePatterns) ? input.landingPagePatterns : []) {
      if (!isRecord(rule)) continue;
      const hostnameFields = normalizeRuleHostnameFields(rule);
      if (!hostnameFields.hostname && !hostnameFields.hostnameEndsWith) continue;
      if (typeof rule.test === 'function') backgroundSafe = false;

      const normalized = { ...hostnameFields };
      if (rule.pathPrefix) normalized.pathPrefix = String(rule.pathPrefix);
      if (Array.isArray(rule.pathExact)) {
        normalized.pathExact = rule.pathExact.filter(value => typeof value === 'string');
      }
      landingPagePatterns.push(normalized);
    }

    for (const rule of Array.isArray(input.customGroups) ? input.customGroups : []) {
      if (!isRecord(rule) || !rule.groupKey) continue;
      const hostnameFields = normalizeRuleHostnameFields(rule);
      if (!hostnameFields.hostname && !hostnameFields.hostnameEndsWith) continue;

      const normalized = {
        ...hostnameFields,
        groupKey: String(rule.groupKey),
        groupLabel: String(rule.groupLabel || ''),
      };
      if (rule.pathPrefix) normalized.pathPrefix = String(rule.pathPrefix);
      customGroups.push(normalized);
    }

    return {
      version: AUTOMATIC_RULE_OVERRIDES_VERSION,
      backgroundSafe,
      landingPagePatterns,
      customGroups,
    };
  }

  function normalizeStoredAutomaticGroupingRuleOverrides(value) {
    if (!isRecord(value) || value.version !== AUTOMATIC_RULE_OVERRIDES_VERSION ||
        typeof value.backgroundSafe !== 'boolean' ||
        !Array.isArray(value.landingPagePatterns) || !Array.isArray(value.customGroups)) {
      return null;
    }
    const normalized = createAutomaticGroupingRuleOverrides(value);
    normalized.backgroundSafe = value.backgroundSafe === true && normalized.backgroundSafe;
    return normalized;
  }

  function isAutomaticLandingPage(url = '', patterns = getAutomaticLandingPagePatterns()) {
    try {
      const parsed = new URL(String(url || ''));
      const source = Array.isArray(patterns) ? patterns : getAutomaticLandingPagePatterns();
      return source.some(pattern => {
        if (!isRecord(pattern)) return false;
        const hostnameMatch = pattern.hostname
          ? parsed.hostname === pattern.hostname
          : pattern.hostnameEndsWith
            ? matchesHostnameSuffix(parsed.hostname, pattern.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (typeof pattern.test === 'function') return Boolean(pattern.test(parsed.pathname, String(url || '')));
        if (pattern.pathPrefix) return parsed.pathname.startsWith(pattern.pathPrefix);
        if (Array.isArray(pattern.pathExact)) return pattern.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch {
      return false;
    }
  }

  function getAutomaticTabGroupDefinition(tab = {}, options = {}) {
    const url = getCanonicalUrl(tab);
    if (!url || !isRestorableUrl(url)) return null;

    const landingPatterns = getAutomaticLandingPagePatterns(options.landingPagePatterns);
    if (isAutomaticLandingPage(url, landingPatterns)) {
      return { groupKey: LANDING_GROUP_KEY, label: '' };
    }

    try {
      const parsed = new URL(url);
      const customGroups = Array.isArray(options.customGroups) ? options.customGroups : [];
      const customRule = customGroups.find(rule => {
        if (!isRecord(rule)) return false;
        const hostMatch = rule.hostname
          ? parsed.hostname === rule.hostname
          : rule.hostnameEndsWith
            ? matchesHostnameSuffix(parsed.hostname, rule.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        return rule.pathPrefix ? parsed.pathname.startsWith(rule.pathPrefix) : true;
      });
      if (customRule?.groupKey) {
        return {
          groupKey: String(customRule.groupKey),
          label: String(customRule.groupLabel || ''),
        };
      }
      if (parsed.protocol === 'file:') {
        return { groupKey: 'local-files', label: '' };
      }
      const getPrimaryDomain = getIconUtils().getPrimaryDomain;
      const hostname = typeof getPrimaryDomain === 'function'
        ? getPrimaryDomain(parsed.hostname)
        : parsed.hostname;
      return hostname ? { groupKey: hostname, label: '' } : null;
    } catch {
      return null;
    }
  }

  function getAutomaticGroupDisplayTitle(definition = {}, options = {}) {
    const groupKey = String(definition.groupKey || '');
    if (!groupKey) return '';
    const labelOverrides = isRecord(options.labelOverrides) ? options.labelOverrides : {};
    if (labelOverrides[groupKey]) return String(labelOverrides[groupKey]).trim();
    if (definition.label) return String(definition.label).trim();
    if (groupKey === LANDING_GROUP_KEY) {
      return String(options.homepagesLabel || 'Homepages').trim() || 'Homepages';
    }
    const friendlyDomain = getIconUtils().friendlyDomain;
    const title = typeof friendlyDomain === 'function' ? friendlyDomain(groupKey) : groupKey;
    return String(title || groupKey).trim();
  }

  function assignAutomaticGroupColor(groupKey = '', index = 0) {
    if (String(groupKey) === LANDING_GROUP_KEY) return 'yellow';
    const normalizedIndex = Number.isInteger(Number(index)) ? Math.max(0, Number(index)) : 0;
    return AUTOMATIC_GROUP_COLORS[normalizedIndex % AUTOMATIC_GROUP_COLORS.length];
  }

  function normalizeAutomaticTabs(tabs = [], windowId = null) {
    const targetWindowId = Number(windowId);
    const hasTargetWindow = windowId !== null && windowId !== '' && Number.isInteger(targetWindowId);
    return (Array.isArray(tabs) ? tabs : [])
      .filter(tab => isRecord(tab))
      .filter(tab => !hasTargetWindow || Number(tab.windowId) === targetWindowId)
      .map(tab => {
        const id = Number(tab.id);
        const url = getCanonicalUrl(tab);
        return {
          ...tab,
          id,
          url,
          rawUrl: String(tab.rawUrl || tab.url || ''),
          windowId: Number(tab.windowId),
          groupId: Number.isInteger(Number(tab.groupId)) && Number(tab.groupId) >= 0
            ? Number(tab.groupId)
            : -1,
          index: Number.isInteger(Number(tab.index)) ? Number(tab.index) : 0,
          pinned: tab.pinned === true,
        };
      })
      .filter(tab => Number.isInteger(tab.id) && isRestorableUrl(tab.url));
  }

  function analyzeNativeChromeGroups(options = {}) {
    const windowId = Number(options.windowId);
    const tabs = normalizeAutomaticTabs(options.tabs, windowId);
    const nativeGroups = Array.isArray(options.nativeGroups) ? options.nativeGroups : [];
    const definitionOptions = {
      landingPagePatterns: options.landingPagePatterns,
      customGroups: options.customGroups,
    };
    const titleOptions = {
      labelOverrides: options.labelOverrides,
      homepagesLabel: options.homepagesLabel,
    };
    const sessionAssignments = isRecord(options.sessionGroups?.assignments)
      ? options.sessionGroups.assignments
      : {};
    const tabById = new Map(tabs.map(tab => [Number(tab.id), tab]));
    const mappedGroupIds = new Set();
    const mappedKeysByGroupId = new Map();
    const rawMappedKeysByGroupId = new Map();
    const reconcilableCreatedGroupIds = new Set();
    const unsafeMappedGroupKeys = new Set();
    const candidatesByKey = new Map();

    for (const group of nativeGroups) {
      if (!isRecord(group) || (Number.isInteger(windowId) && Number(group.windowId) !== windowId)) continue;
      const groupId = Number(group.id ?? group.groupId);
      if (!Number.isInteger(groupId) || groupId < 0) continue;
      const mappings = (Array.isArray(group.mappings) ? group.mappings : [])
        .filter(mapping => mapping?.groupKey);
      for (const mapping of mappings) {
        rawMappedKeysByGroupId.set(groupId, String(mapping.groupKey));
      }

      const readable = group.shared !== true && group.queryComplete !== false &&
        Array.isArray(group.tabIds) && group.tabIds.length > 0;
      const definitions = readable
        ? group.tabIds.map(tabId => getAutomaticTabGroupDefinition(tabById.get(Number(tabId)), definitionOptions))
        : [];
      const pureDefinition = definitions.length > 0 && definitions.every(Boolean) &&
        definitions.every(definition => definition.groupKey === definitions[0].groupKey)
        ? definitions[0]
        : null;
      const logicalKey = String(pureDefinition?.groupKey || '');
      const displayTitle = pureDefinition
        ? getAutomaticGroupDisplayTitle(pureDefinition, titleOptions)
        : '';

      let safeMapping = null;
      if (mappings.length === 1) {
        const mapping = mappings[0];
        const mappingKey = String(mapping.groupKey);
        const titleMatches = String(group.title || '') === displayTitle;
        const hasManualAssignments = group.tabIds.some(tabId =>
          Boolean(sessionAssignments[String(tabId)])
        );
        // Chrome keeps a tab's native groupId when that tab navigates to a
        // different domain. A complete, non-shared group created by Tab
        // Harbor is therefore safe to reconcile member-by-member even while
        // its old mapping no longer describes every live member. Adopted and
        // user-owned groups deliberately do not receive this permission.
        const canReconcileCreatedMapping = mapping.origin === 'created' &&
          readable && definitions.length > 0 && definitions.every(Boolean) &&
          !hasManualAssignments;
        if (canReconcileCreatedMapping) {
          reconcilableCreatedGroupIds.add(groupId);
        }
        const safe = readable && logicalKey === mappingKey &&
          (mapping.origin === 'created' || titleMatches);
        if (safe) {
          safeMapping = mapping;
          mappedGroupIds.add(groupId);
          mappedKeysByGroupId.set(groupId, mappingKey);
        } else {
          // Keep the stale source mapping frozen until the coordinator has
          // successfully moved every explicitly planned destination member.
          // This preserve bit is also the coordinator's proof that the pure
          // policy observed a real created-group domain drift this round.
          unsafeMappedGroupKeys.add(mappingKey);
        }
      } else if (mappings.length > 1) {
        mappings.forEach(mapping => unsafeMappedGroupKeys.add(String(mapping.groupKey)));
      }

      if (!pureDefinition || (mappings.length > 0 && !safeMapping)) continue;
      const titleMatches = String(group.title || '') === displayTitle;
      if (!titleMatches && safeMapping?.origin !== 'created') continue;
      const candidate = { ...group, id: groupId, groupId, groupKey: logicalKey, displayTitle };
      if (!candidatesByKey.has(logicalKey)) candidatesByKey.set(logicalKey, []);
      candidatesByKey.get(logicalKey).push(candidate);
    }

    const uniqueCandidateGroupIds = new Set();
    const allCandidateGroupIds = new Set();
    const candidateKeysByGroupId = new Map();
    const conflicts = [];
    for (const [groupKey, candidates] of candidatesByKey.entries()) {
      candidates.sort((left, right) =>
        Number(left.minIndex ?? Number.MAX_SAFE_INTEGER) -
          Number(right.minIndex ?? Number.MAX_SAFE_INTEGER) ||
        Number(left.groupId) - Number(right.groupId)
      );
      for (const candidate of candidates) {
        const groupId = Number(candidate.id ?? candidate.groupId);
        allCandidateGroupIds.add(groupId);
        candidateKeysByGroupId.set(groupId, groupKey);
      }
      if (candidates.length === 1) {
        uniqueCandidateGroupIds.add(Number(candidates[0].id ?? candidates[0].groupId));
      } else if (candidates.length > 1) {
        conflicts.push({
          groupKey,
          reason: 'multiple-candidates',
          title: candidates[0].displayTitle || getAutomaticGroupDisplayTitle({ groupKey }, titleOptions),
          candidates,
        });
      }
    }

    return {
      mappedGroupIds,
      mappedKeysByGroupId,
      rawMappedKeysByGroupId,
      reconcilableCreatedGroupIds,
      unsafeMappedGroupKeys,
      candidatesByKey,
      candidateKeysByGroupId,
      uniqueCandidateGroupIds,
      allCandidateGroupIds,
      conflicts,
    };
  }

  function getTabOrderTokens(tab = {}) {
    const tokens = [];
    if (tab.id != null) tokens.push(String(tab.id));
    if (tab.url) tokens.push(String(tab.url));
    return [...new Set(tokens.filter(Boolean))];
  }

  function orderTabsForGroup(tabs = [], groupKey = '', groupTabOrder = {}) {
    const orderIds = isRecord(groupTabOrder) && Array.isArray(groupTabOrder[String(groupKey)])
      ? groupTabOrder[String(groupKey)].map(id => String(id)).filter(Boolean)
      : [];
    if (orderIds.length === 0) return tabs.slice();
    const orderIndex = new Map(orderIds.map((id, index) => [id, index]));
    return tabs
      .map((tab, originalIndex) => {
        const match = getTabOrderTokens(tab)
          .map(token => orderIndex.get(token))
          .find(index => Number.isInteger(index));
        return {
          tab,
          originalIndex,
          order: Number.isInteger(match) ? match : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((left, right) => left.order - right.order || left.originalIndex - right.originalIndex)
      .map(entry => entry.tab);
  }

  function buildAutomaticChromeSyncSnapshot(input = {}) {
    const windowId = Number(input.windowId);
    const tabs = normalizeAutomaticTabs(input.tabs, windowId);
    const definitionOptions = {
      landingPagePatterns: input.landingPagePatterns,
      customGroups: input.customGroups,
    };
    const titleOptions = {
      labelOverrides: input.labelOverrides,
      homepagesLabel: input.homepagesLabel,
    };
    const analysis = analyzeNativeChromeGroups({
      ...input,
      windowId,
      tabs,
    });
    const assignments = isRecord(input.sessionGroups?.assignments)
      ? input.sessionGroups.assignments
      : {};
    const groupsByKey = new Map();

    for (const tab of tabs) {
      const nativeGroupId = Number(tab.groupId);
      const belongsToMappedNativeGroup = Number.isInteger(nativeGroupId) &&
        analysis.mappedGroupIds.has(nativeGroupId);
      const belongsToReconcilableCreatedGroup = Number.isInteger(nativeGroupId) &&
        analysis.reconcilableCreatedGroupIds.has(nativeGroupId);
      const rawMappedGroupKey = Number.isInteger(nativeGroupId)
        ? analysis.rawMappedKeysByGroupId.get(nativeGroupId) || ''
        : '';
      const belongsToCandidateNativeGroup = Number.isInteger(nativeGroupId) &&
        analysis.allCandidateGroupIds.has(nativeGroupId);
      const assignedGroupId = assignments[String(tab.id)];
      const definition = getAutomaticTabGroupDefinition(tab, definitionOptions);
      const isUngrouped = !Number.isInteger(nativeGroupId) || nativeGroupId < 0;
      const eligible = !tab.pinned && definition &&
        (isUngrouped || belongsToMappedNativeGroup || belongsToReconcilableCreatedGroup ||
          belongsToCandidateNativeGroup ||
          rawMappedGroupKey === definition.groupKey) &&
        (!assignedGroupId || belongsToMappedNativeGroup || belongsToCandidateNativeGroup ||
          rawMappedGroupKey === definition.groupKey);
      if (!eligible) continue;

      const groupKey = String(definition.groupKey);
      if (!groupsByKey.has(groupKey)) {
        groupsByKey.set(groupKey, { groupKey, label: definition.label || '', tabs: [] });
      }
      groupsByKey.get(groupKey).tabs.push(tab);
    }

    let colorIndex = 0;
    const groups = [...groupsByKey.values()].map(group => {
      const orderedTabs = orderTabsForGroup(group.tabs, group.groupKey, input.groupTabOrder);
      const color = assignAutomaticGroupColor(group.groupKey, colorIndex);
      colorIndex += 1;
      return {
        groupKey: group.groupKey,
        title: getAutomaticGroupDisplayTitle(group, titleOptions),
        color,
        collapsed: true,
        tabIds: orderedTabs.map(tab => Number(tab.id)).filter(Number.isInteger),
      };
    }).filter(group => group.groupKey && group.tabIds.length > 0);

    return {
      windowId,
      preserveGroupKeys: [...analysis.unsafeMappedGroupKeys],
      groups,
      analysis,
    };
  }

  const api = {
    AUTOMATIC_RULE_OVERRIDES_VERSION,
    matchesHostnameSuffix,
    createAutomaticGroupingRuleOverrides,
    normalizeStoredAutomaticGroupingRuleOverrides,
    getAutomaticLandingPagePatterns,
    isAutomaticLandingPage,
    getAutomaticTabGroupDefinition,
    getAutomaticGroupDisplayTitle,
    analyzeNativeChromeGroups,
    buildAutomaticChromeSyncSnapshot,
    assignAutomaticGroupColor,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.TabHarborAutomaticTabGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
