'use strict';

/**
 * Search-field suggestion logic — pure, testable helpers.
 *
 * This module only builds and filters suggestion rows. Rendering and Chrome
 * API access live in dashboard-runtime.js; everything here is a pure function
 * of its inputs so it can run under `node --test` without a browser.
 */

/* ----------------------------------------------------------------
   Normalization
   ---------------------------------------------------------------- */

function normalizeSuggestionText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeSuggestionUrl(value = '') {
  return String(value || '').trim();
}

function normalizeFolderPath(value = '') {
  if (Array.isArray(value)) {
    return value
      .map(part => {
        if (part && typeof part === 'object') return String(part.title || '').trim();
        return String(part || '').trim();
      })
      .filter(Boolean)
      .join(' / ');
  }
  return String(value || '').trim();
}

/**
 * Simple relevance score: 0 = no match, higher = better.
 * Matches title, URL, label and bookmark folder path with prefix/word bonuses.
 */
function scoreSuggestion(item, queryTokens) {
  const text = normalizeSuggestionText(item.title || item.label || item.url || '');
  const supportingText = normalizeSuggestionText([
    item.label || '',
    item.folderPath || '',
  ].join(' '));
  const urlText = normalizeSuggestionText(item.url || '');
  if ((!text && !supportingText && !urlText) || !queryTokens.length) return 0;

  let score = 0;
  const haystack = text;

  for (const token of queryTokens) {
    if (!token) continue;
    let matched = false;
    if (haystack.startsWith(token)) score += 8;
    else if (haystack.includes(token)) score += 4;
    if (haystack.includes(token)) matched = true;
    if (supportingText.includes(token)) {
      score += 2;
      matched = true;
    }
    if (urlText.includes(token)) {
      score += 2;
      matched = true;
    }
    // Word-boundary bonus: token appears at a word start.
    const wordMatch = new RegExp(`(^|[\\s./:_-])${escapeRegExp(token)}`, 'i');
    if (wordMatch.test(haystack)) score += 3;
    if (!matched) return 0;
  }
  return score;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ----------------------------------------------------------------
   Source builders
   ---------------------------------------------------------------- */

function buildOpenTabSuggestions(tabs = []) {
  const seen = new Set();
  const rows = [];
  for (const tab of tabs) {
    const url = normalizeSuggestionUrl(tab?.url);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    rows.push({
      type: 'tab',
      url,
      title: tab.title || url,
      favIconUrl: tab.favIconUrl || '',
      tabId: tab.id != null ? tab.id : null,
      windowId: tab.windowId,
    });
  }
  return rows;
}

function buildQuickShortcutSuggestions(shortcuts = []) {
  const seen = new Set();
  const rows = [];
  for (const shortcut of shortcuts || []) {
    const url = normalizeSuggestionUrl(shortcut?.url);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    rows.push({
      type: 'shortcut',
      url,
      title: shortcut.label || url,
      label: shortcut.label || '',
      favIconUrl: shortcut.icon || '',
    });
  }
  return rows;
}

/**
 * Builds bookmark rows from either a flat list or Chrome's nested bookmark
 * tree. Flat rows may provide folderPath directly; tree rows derive it from
 * their ancestor folder titles.
 */
function buildBookmarkSuggestions(bookmarks = []) {
  const roots = Array.isArray(bookmarks)
    ? bookmarks
    : (bookmarks && typeof bookmarks === 'object' ? [bookmarks] : []);
  const seen = new Set();
  const visited = new Set();
  const rows = [];

  function visit(node, ancestorFolders = []) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);

    const url = normalizeSuggestionUrl(node.url);
    if (url && !seen.has(url)) {
      seen.add(url);
      rows.push({
        type: 'bookmark',
        bookmarkId: node.id != null ? String(node.id) : '',
        title: node.title || url,
        url,
        folderPath: normalizeFolderPath(node.folderPath)
          || normalizeFolderPath(node.path)
          || ancestorFolders.join(' / '),
      });
    }

    const folderTitle = url ? '' : String(node.title || '').trim();
    const childAncestors = folderTitle
      ? [...ancestorFolders, folderTitle]
      : ancestorFolders;
    for (const child of Array.isArray(node.children) ? node.children : []) {
      visit(child, childAncestors);
    }
  }

  for (const root of roots) visit(root);
  return rows;
}

function getSessionCollection(sessions = []) {
  if (Array.isArray(sessions)) return sessions;
  if (Array.isArray(sessions?.sessions)) return sessions.sessions;
  return sessions && typeof sessions === 'object' ? [sessions] : [];
}

function getSessionTabs(session = {}) {
  const tabs = [];
  const appendTabs = items => {
    if (Array.isArray(items)) tabs.push(...items);
  };

  // Current Tab Harbor sessions store tabs directly on each session. The
  // additional shapes keep imported/legacy window snapshots searchable too.
  for (const snapshot of [session, session?.session].filter(Boolean)) {
    appendTabs(snapshot.tabs);
    appendTabs(snapshot.window?.tabs);
    for (const windowSnapshot of Array.isArray(snapshot.windows) ? snapshot.windows : []) {
      appendTabs(windowSnapshot?.tabs);
    }
    if (snapshot.tab) tabs.push(snapshot.tab);
  }

  return tabs;
}

function buildSessionTabSuggestions(sessions = []) {
  const seen = new Set();
  const rows = [];
  for (const session of getSessionCollection(sessions)) {
    const sessionName = session?.name || session?.session?.name || '';
    for (const tab of getSessionTabs(session)) {
      const url = normalizeSuggestionUrl(tab?.url);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      rows.push({
        type: 'session',
        url,
        title: tab.title || url,
        label: sessionName,
        favIconUrl: tab.favIconUrl || '',
      });
    }
  }
  return rows;
}

function buildHistorySuggestions(historyItems = []) {
  const seen = new Set();
  const rows = [];
  for (const item of historyItems || []) {
    const url = normalizeSuggestionUrl(item?.url);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    rows.push({
      type: 'history',
      url,
      title: item.title || url,
      favIconUrl: '',
      visitCount: item.visitCount || 0,
      lastVisitTime: item.lastVisitTime || 0,
    });
  }
  return rows;
}

/* ----------------------------------------------------------------
   Query filtering
   ---------------------------------------------------------------- */

const SUGGESTION_SOURCE_ORDER = ['tab', 'shortcut', 'bookmark', 'session', 'history'];

function getSuggestionSourceRank(type = '') {
  const index = SUGGESTION_SOURCE_ORDER.indexOf(type);
  return index >= 0 ? index : SUGGESTION_SOURCE_ORDER.length;
}

/**
 * Keeps one row per URL. Sorting by source first makes the winning row
 * deterministic even when callers pass sources in a different order.
 */
function dedupeSuggestionsByUrl(rows = []) {
  const ordered = (Array.isArray(rows) ? rows : [])
    .map((item, index) => ({ item, index }))
    .filter(entry => entry.item && typeof entry.item === 'object')
    .sort((a, b) => {
      const rankDiff = getSuggestionSourceRank(a.item.type) - getSuggestionSourceRank(b.item.type);
      return rankDiff || a.index - b.index;
    });
  const seen = new Set();
  const deduped = [];

  for (const { item } of ordered) {
    const url = normalizeSuggestionUrl(item.url);
    if (url) {
      if (seen.has(url)) continue;
      seen.add(url);
    }
    deduped.push(item);
  }
  return deduped;
}

function filterSuggestions(rows = [], query = '') {
  const dedupedRows = dedupeSuggestionsByUrl(rows);
  const q = normalizeSuggestionText(query);
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  if (!tokens.length) return dedupedRows.slice(0, 12);

  const scored = dedupedRows
    .map(item => ({ item, score: scoreSuggestion(item, tokens) }))
    .filter(entry => entry.score > 0);
  scored.sort((a, b) => {
    // Same source → score desc; different sources keep stable source order.
    if (a.item.type !== b.item.type) {
      return getSuggestionSourceRank(a.item.type) - getSuggestionSourceRank(b.item.type);
    }
    return b.score - a.score;
  });
  return scored.slice(0, 12).map(entry => entry.item);
}

/* ----------------------------------------------------------------
   Suggestion icon policy
   ---------------------------------------------------------------- */

function isChromeLocalFaviconUrl(value = '') {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'chrome-extension:' && parsed.pathname.startsWith('/_favicon/');
  } catch {
    return false;
  }
}

/**
 * Bookmark suggestion icons follow the same opt-in/privacy boundary as the
 * bookmark shelf: disabled means no image at all; enabled accepts only
 * Chrome's extension-local _favicon resource and never a site/network
 * fallback. Other suggestion sources retain the existing two-step fallback.
 */
function selectSuggestionIconSources(item = {}, sources = [], options = {}) {
  const normalizedSources = (Array.isArray(sources) ? sources : [])
    .map(source => String(source || '').trim())
    .filter(Boolean);

  if (item?.type !== 'bookmark') {
    return {
      faviconUrl: normalizedSources[0] || '',
      fallbackUrl: normalizedSources[1] || '',
    };
  }

  if (options?.bookmarksShowFavicons !== true) {
    return { faviconUrl: '', fallbackUrl: '' };
  }

  return {
    faviconUrl: normalizedSources.find(isChromeLocalFaviconUrl) || '',
    fallbackUrl: '',
  };
}

/* ----------------------------------------------------------------
   Assembly
   ---------------------------------------------------------------- */

function assembleSuggestions(sources = {}, query = '') {
  const {
    tabs = [],
    shortcuts = [],
    bookmarks = [],
    sessions = [],
    history = [],
  } = sources || {};
  const all = [
    ...buildOpenTabSuggestions(tabs),
    ...buildQuickShortcutSuggestions(shortcuts),
    ...buildBookmarkSuggestions(bookmarks),
    ...buildSessionTabSuggestions(sessions),
    ...buildHistorySuggestions(history),
  ];
  return filterSuggestions(all, query);
}

/* ----------------------------------------------------------------
   Test exposure
   ---------------------------------------------------------------- */

globalThis.TabHarborSearchSuggestions = {
  assembleSuggestions,
  buildBookmarkSuggestions,
  buildHistorySuggestions,
  buildOpenTabSuggestions,
  buildQuickShortcutSuggestions,
  buildSessionTabSuggestions,
  dedupeSuggestionsByUrl,
  filterSuggestions,
  selectSuggestionIconSources,
  scoreSuggestion,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    assembleSuggestions,
    buildBookmarkSuggestions,
    buildHistorySuggestions,
    buildOpenTabSuggestions,
    buildQuickShortcutSuggestions,
    buildSessionTabSuggestions,
    dedupeSuggestionsByUrl,
    filterSuggestions,
    selectSuggestionIconSources,
    scoreSuggestion,
  };
}
