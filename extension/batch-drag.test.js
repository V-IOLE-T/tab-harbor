'use strict';

// Behavioral + source-contract tests for the dashboard tab-row multi-select
// and batch-drag feature (commit 40378a8 and its follow-up fixes).
//
// Unlike the regex-only ui-regression tests, the first group here EXECUTES the
// real order-building helpers extracted from dashboard-runtime.js, so a wrong
// drop position or a duplicated chip actually fails the test.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimeJs = fs.readFileSync(path.join(__dirname, 'dashboard-runtime.js'), 'utf8');
const uiHelpersJs = fs.readFileSync(path.join(__dirname, 'ui-helpers.js'), 'utf8');

// ---------------------------------------------------------------------------
// Extract a top-level `function NAME(...) { ... }` body by brace matching.
// ---------------------------------------------------------------------------
function extractFn(source, name) {
  const re = new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(source);
  if (!m) throw new Error(`function ${name} not found`);
  // Skip the parameter list (which may itself contain braces for destructured
  // defaults) and start at the function body brace.
  const closeParen = source.indexOf(')', m.index);
  if (closeParen === -1) throw new Error(`function ${name} has no parameter close`);
  let i = source.indexOf('{', closeParen);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(m.index, i + 1);
}

function extractConst(source, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\{[^}]*\\};`);
  const m = re.exec(source);
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}

function chipNode(id) {
  return { dataset: { chipSortId: id } };
}

function placeholderNode() {
  return { __placeholder: true };
}

// ---------------------------------------------------------------------------
// Behavioral: buildBatchOrderedIdsFromList
// ---------------------------------------------------------------------------
test('buildBatchOrderedIdsFromList places the whole batch at the drop point', () => {
  const fn = new Function(`${extractFn(runtimeJs, 'buildBatchOrderedIdsFromList')}\nreturn buildBatchOrderedIdsFromList;`)();
  const list = (children) => ({ children });

  // Batch dragged below the last row.
  globalThis.pageChipPlaceholderEl = placeholderNode();
  assert.deepEqual(
    fn(list([chipNode('A'), chipNode('B'), chipNode('C'), chipNode('D'), chipNode('E'), globalThis.pageChipPlaceholderEl]), ['B', 'C', 'D']),
    ['A', 'E', 'B', 'C', 'D']
  );

  // Batch dragged to the top.
  globalThis.pageChipPlaceholderEl = placeholderNode();
  assert.deepEqual(
    fn(list([globalThis.pageChipPlaceholderEl, chipNode('A'), chipNode('B'), chipNode('C'), chipNode('D'), chipNode('E')]), ['B', 'C', 'D']),
    ['B', 'C', 'D', 'A', 'E']
  );

  // Non-contiguous selection {A, C} dropped at the placeholder between C and D.
  globalThis.pageChipPlaceholderEl = placeholderNode();
  assert.deepEqual(
    fn(list([chipNode('A'), chipNode('B'), chipNode('C'), globalThis.pageChipPlaceholderEl, chipNode('D')]), ['A', 'C']),
    ['B', 'A', 'C', 'D']
  );

  // Unselected row dragged while others are selected: only the dragged row moves.
  globalThis.pageChipPlaceholderEl = placeholderNode();
  assert.deepEqual(
    fn(list([chipNode('A'), chipNode('B'), chipNode('C'), globalThis.pageChipPlaceholderEl, chipNode('D')]), ['A']),
    ['B', 'C', 'A', 'D']
  );

  // Batch containing a row foreign to this list (cross-card selection dropped
  // on the source card): the foreign row is ignored, the rest reorders.
  globalThis.pageChipPlaceholderEl = placeholderNode();
  assert.deepEqual(
    fn(list([chipNode('A'), chipNode('B'), globalThis.pageChipPlaceholderEl, chipNode('C')]), ['B', 'X']),
    ['A', 'B', 'C']
  );

  // Dragged chip sits later in the DOM than the placeholder.
  globalThis.pageChipPlaceholderEl = placeholderNode();
  assert.deepEqual(
    fn(list([globalThis.pageChipPlaceholderEl, chipNode('A'), chipNode('B'), chipNode('C'), chipNode('D'), chipNode('E')]), ['C', 'D']),
    ['C', 'D', 'A', 'B', 'E']
  );

  // Drop at the bottom of a card with collapsed overflow rows: the placeholder
  // sits right before the collapsed block (index 8), so the batch lands as the
  // last VISIBLE row and must not fall into the collapsed section.
  globalThis.pageChipPlaceholderEl = placeholderNode();
  assert.deepEqual(
    fn(list([chipNode('c1'), chipNode('c2'), chipNode('c3'), chipNode('c4'), chipNode('c5'), chipNode('c6'), chipNode('c7'), chipNode('c8'), globalThis.pageChipPlaceholderEl, chipNode('c9'), chipNode('c10')]), ['c1']),
    ['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c1', 'c9', 'c10']
  );
});

test('buildBatchOrderedIdsFromList ignores non-chip children when computing the drop index', () => {
  const fn = new Function(`${extractFn(runtimeJs, 'buildBatchOrderedIdsFromList')}\nreturn buildBatchOrderedIdsFromList;`)();
  // A card with an overflow "+N more" row (no chipSortId) between A and the
  // placeholder; dropping B after the overflow row must land B between the
  // overflow row and C, not after C.
  const overflow = { dataset: {} };
  globalThis.pageChipPlaceholderEl = placeholderNode();
  const list = { children: [chipNode('A'), overflow, globalThis.pageChipPlaceholderEl, chipNode('B'), chipNode('C')] };
  assert.deepEqual(fn(list, ['B']), ['A', 'B', 'C']);
});

// ---------------------------------------------------------------------------
// Behavioral: buildBatchMergeGroupTitle
// ---------------------------------------------------------------------------
test('buildBatchMergeGroupTitle derives the group name from tab content', () => {
  // Load the REAL friendlyDomain from ui-helpers.js — a stubbed weaker domain
  // function would let a broken friendlyDomain call stay green (C1).
  const fn = new Function(`
    ${extractConst(uiHelpersJs, 'FRIENDLY_DOMAINS')}
    ${extractFn(uiHelpersJs, 'capitalize')}
    ${extractFn(uiHelpersJs, 'friendlyDomain')}
    ${extractFn(runtimeJs, 'buildBatchMergeGroupTitle')}
    return buildBatchMergeGroupTitle;
  `)();
  // id → { url, title }: 0-2 same domain, 3 a different domain, 4 unresolvable.
  const tabs = [
    { id: 0, url: 'https://github.com/foo', title: 'Foo · GitHub' },
    { id: 1, url: 'https://github.com/bar', title: 'Bar · GitHub' },
    { id: 2, url: 'https://github.com/baz', title: 'Baz · GitHub' },
    { id: 3, url: 'https://news.ycombinator.com/item', title: 'HN item' },
    { id: 4, url: 'chrome://settings', title: 'Settings page' },
  ];
  globalThis.getTabsByIds = (ids) => tabs.filter(t => ids.includes(t.id));
  globalThis.runtimeT = null;

  // Single domain → bare site name; github.com keeps its canonical casing.
  assert.equal(fn([0, 1, 2]), 'GitHub');
  // Mixed domains → most frequent domain with a ×count suffix.
  assert.equal(fn([0, 1, 3]), 'GitHub ×2');
  // Non-brand domain goes through the real friendlyDomain mapping.
  assert.equal(fn([3]), 'Hacker News');
  // Unresolvable URL → first tab's title.
  assert.equal(fn([4]), 'Settings page');
  delete globalThis.getTabsByIds;
  delete globalThis.runtimeT;
});

test('mergeTabsIntoChromeGroup reports update failure after group creation (C5)', async () => {
  const fn = new Function(`${extractFn(runtimeJs, 'mergeTabsIntoChromeGroup')}\nreturn mergeTabsIntoChromeGroup;`)();
  globalThis.chrome = {
    tabs: { get: async id => ({ id, windowId: 7, pinned: false }) },
  };
  globalThis.performChromeGroupMutation = async () => ({
    groupId: 901,
    mergedTabIds: [1, 2],
    updated: false,
  });
  const result = await fn([1, 2], { title: 'X', color: 'blue' });
  assert.equal(result.groupId, 901);
  assert.deepEqual(result.mergedTabIds, [1, 2]);
  assert.equal(result.updated, false);
  delete globalThis.performChromeGroupMutation;
  delete globalThis.chrome;
});

test('mergeTabsIntoChromeGroup resolves a function title from the merged ids (C2)', async () => {
  // Count-based labels must use the ACTUAL merged ids — stale ids dropped by
  // live preflight/background revalidation would otherwise inflate the title.
  const fn = new Function(`${extractFn(runtimeJs, 'mergeTabsIntoChromeGroup')}\nreturn mergeTabsIntoChromeGroup;`)();
  globalThis.chrome = {
    tabs: {
      get: async id => {
        if (id === 2) throw new Error('stale');
        return { id, windowId: 7, pinned: false };
      },
    },
  };
  const mutations = [];
  globalThis.performChromeGroupMutation = async (operation, payload) => {
    mutations.push({ operation, payload });
    return { groupId: 902, mergedTabIds: payload.tabIds, updated: true };
  };
  const result = await fn([1, 2, 3], { title: (ids) => `Open tabs (${ids.length})`, color: 'blue' });
  assert.equal(result.groupId, 902);
  assert.deepEqual(result.mergedTabIds, [1, 3]);
  // The title is derived from the 2 merged ids, not the 3 requested ones.
  assert.deepEqual(mutations[0], {
    operation: 'create',
    payload: {
      windowId: 7,
      tabIds: [1, 3],
      orderedTabIds: [1, 3],
      title: 'Open tabs (2)',
      color: 'blue',
    },
  });
  // A plain string title still works (backwards compatible).
  await fn([1], { title: 'Fixed', color: 'red' });
  assert.equal(mutations[1].payload.title, 'Fixed');
  assert.equal(mutations[1].payload.color, 'red');
  delete globalThis.performChromeGroupMutation;
  delete globalThis.chrome;
});

test('sleepTabsByIds classifies stale, active, failed and discarded tabs (C4)', async () => {
  const fn = new Function(`${extractFn(runtimeJs, 'sleepTabsByIds')}\nreturn sleepTabsByIds;`)();
  globalThis.chrome = {
    tabs: {
      get: async (id) => id === 1 ? { id: 1, active: false } : id === 2 ? { id: 2, active: true } : id === 3 ? { id: 3, active: false } : null,
    },
  };
  globalThis.discardTab = async (id) => id === 1;
  const result = await fn([1, 2, 3, 4], { skipActive: true });
  assert.equal(result.discarded, 1);
  assert.equal(result.skippedActive, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.stale, 1);
  delete globalThis.chrome;
  delete globalThis.discardTab;
});

test('closeTabsSafely keeps every window last tab and tolerates vanished ids (C4)', async () => {
  const fn = new Function(`${extractFn(runtimeJs, 'closeTabsSafely')}\nreturn closeTabsSafely;`)();
  const removed = [];
  globalThis.queryTabsForDashboardWindow = async () => [
    { id: 1, windowId: 7 },
    { id: 2, windowId: 7 },
    { id: 3, windowId: 8 },
  ];
  globalThis.ensureWindowsKeepLastTab = (allTabs, toCloseIds) => {
    const toClose = new Set(toCloseIds);
    const byWindow = new Map();
    for (const t of allTabs) {
      if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
      byWindow.get(t.windowId).push(t.id);
    }
    for (const ids of byWindow.values()) {
      if (ids.length && ids.every(id => toClose.has(id))) {
        toClose.delete(ids[0]);
      }
    }
    return [...toClose];
  };
  globalThis.chrome = { tabs: { remove: async (id) => removed.push(id) } };
  globalThis.playCloseSound = () => {};
  const result = await fn([1, 2, 3]);
  assert.equal(result.closedCount, 1);
  assert.deepEqual(removed, [2]);
  delete globalThis.queryTabsForDashboardWindow;
  delete globalThis.ensureWindowsKeepLastTab;
  delete globalThis.chrome;
  delete globalThis.playCloseSound;
});

// ---------------------------------------------------------------------------
// Behavioral: buildCrossGroupTargetOrder
// ---------------------------------------------------------------------------
test('buildCrossGroupTargetOrder moves the whole batch contiguously without duplicates', () => {
  const fn = new Function(`${extractFn(runtimeJs, 'buildCrossGroupTargetOrder')}\nreturn buildCrossGroupTargetOrder;`)();

  // Target card already contains X (a selected row of this card); batch
  // [B, X] dropped between A and D must land as one contiguous block.
  globalThis.pageChipPlaceholderEl = placeholderNode();
  const list = { children: [chipNode('A'), globalThis.pageChipPlaceholderEl, chipNode('X'), chipNode('D')] };
  assert.deepEqual(fn(list, ['B', 'X']), ['A', 'B', 'X', 'D']);

  // Batch appended at the end when there is no placeholder.
  globalThis.pageChipPlaceholderEl = null;
  assert.deepEqual(fn({ children: [chipNode('A'), chipNode('D')] }, ['B', 'X']), ['A', 'D', 'B', 'X']);

  // Non-chip children before the placeholder must not skew the insert index.
  const overflow = { dataset: {} };
  globalThis.pageChipPlaceholderEl = placeholderNode();
  const list2 = { children: [chipNode('A'), overflow, globalThis.pageChipPlaceholderEl, chipNode('X'), chipNode('D')] };
  assert.deepEqual(fn(list2, ['B', 'X']), ['A', 'B', 'X', 'D']);
});

// ---------------------------------------------------------------------------
// Behavioral: normalizeGroupTabOrderState keeps the first occurrence
// ---------------------------------------------------------------------------
test('normalizeGroupTabOrderState dedupes keeping the first occurrence', () => {
  const fn = new Function(`${extractFn(runtimeJs, 'normalizeGroupTabOrderState')}\nreturn normalizeGroupTabOrderState;`)();
  assert.deepEqual(fn({ g: ['A', 'B', 'X', 'X', 'D'] }).g, ['A', 'B', 'X', 'D']);
});

// ---------------------------------------------------------------------------
// Behavioral: getMovingPageChipIds — snapshot preference + visual DOM order
// ---------------------------------------------------------------------------
test('getMovingPageChipIds prefers the drag-start snapshot and keeps visual order', () => {
  // Stub `document` with two cards: card1 [A, B, C], card2 [X].
  const fakeDocument = {
    querySelectorAll: () => [
      { querySelectorAll: () => [chipNode('A'), chipNode('B'), chipNode('C')] },
      { querySelectorAll: () => [chipNode('X')] },
    ],
  };
  const fn = new Function(
    `${extractFn(runtimeJs, 'orderChipIdsByDom')}\n${extractFn(runtimeJs, 'getMovingPageChipIds')}\nreturn getMovingPageChipIds;`
  )();

  globalThis.document = fakeDocument;

  // No snapshot: dragged row is selected -> whole selection, in DOM order even
  // if the user toggled rows in a different order (X toggled first).
  globalThis.pageChipDragState = null;
  globalThis.selectedPageChipIds = new Set(['X', 'B']);
  globalThis.draggedPageChipId = 'B';
  assert.deepEqual(fn(), ['B', 'X']);

  // No snapshot: dragged row not selected -> only the dragged row.
  globalThis.draggedPageChipId = 'A';
  assert.deepEqual(fn(), ['A']);

  // Snapshot wins even when the live selection changed mid-drag (Escape).
  globalThis.pageChipDragState = { movingChipIds: ['B', 'C'] };
  globalThis.selectedPageChipIds = new Set();
  globalThis.draggedPageChipId = 'B';
  assert.deepEqual(fn(), ['B', 'C']);
});

// ---------------------------------------------------------------------------
// Source contracts for the flow-level fixes (would regress silently otherwise)
// ---------------------------------------------------------------------------
test('same-group reorder commits use the drag-start snapshot, not the live selection', () => {
  assert.match(runtimeJs, /if \(targetGroupKey && targetGroupKey === sourceGroupKey && targetListEl\) \{[\s\S]{0,400}const movingIds = getMovingPageChipIds\(\);\s*const orderIds = buildBatchOrderedIdsFromList\(targetListEl, movingIds\);/);
});

test('Escape cancels an in-flight drag before clearing the selection', () => {
  assert.match(runtimeJs, /if \(e\.key !== 'Escape'\) return;[\s\S]{0,300}if \(pageChipCommitInFlight\) return;[\s\S]{0,200}if \(draggedPageChipId && pageChipDragState\) \{\s*clearPageChipDragState\(\{ removeNode: false \}\);/);
});

test('handle press that never moved toggles; completed drags are never clicks', () => {
  assert.match(runtimeJs, /if \(!pageChipDragState\.moved && finalDistance < 4\) \{/);
});

test('whole-row drag: the row body arms the same drag as the handle', () => {
  // The handle is the visible grip, but a press anywhere on the row body
  // arms the drag too — no need to aim for the 30px grip.
  assert.match(runtimeJs, /if \(chipItem && !chipAction && e\.button === 0\) \{/);
  assert.match(runtimeJs, /const dragHandleEl = chipHandle \|\| item;/);
  assert.match(runtimeJs, /originatedFromHandle: Boolean\(chipHandle\),/);
});

test('a completed drag suppresses the click that follows it', () => {
  // The click dispatched right after pointerup must not activate the tab; the
  // suppression is set synchronously in pointerup, before the async commit.
  assert.match(runtimeJs, /suppressPageChipClickUntil = Date\.now\(\) \+ 250;\s*updateDraggedPageChipPosition\(e\.clientX, e\.clientY\);/);
});

test('multi-select mode: clicking a row toggles it instead of activating the tab', () => {
  // While a selection exists, focus-tab becomes a toggle: the row body never
  // jumps to the tab in batch mode.
  assert.match(runtimeJs, /if \(action === 'focus-tab'\) \{/);
  assert.match(runtimeJs, /if \(selectedPageChipIds\.size > 0\) \{\s*if \(key\) \{[\s\S]{0,300}if \(e\.shiftKey && pageChipSelectionAnchorId\) \{\s*selectPageChipRange\(key, pageChipSelectionAnchorId\);\s*\} else \{\s*togglePageChipSelection\(key\);/);
  // A plain body click (no selection yet) stays a click and activates the tab.
  assert.match(runtimeJs, /const tabUrl = actionEl\.dataset\.tabUrl;\s*const tabId = actionEl\.dataset\.tabId \|\| '';\s*if \(tabUrl \|\| tabId\) await focusTab\(tabUrl, tabId\);/);
  // Body presses only toggle on click while a selection is active.
  assert.match(runtimeJs, /const toggleAsClick = pageChipDragState\.originatedFromHandle\s*\|\| selectedPageChipIds\.size > 0\s*\|\| e\.shiftKey;/);
  // Deselecting the last row must not make the follow-up click jump to it;
  // the guard checks key + window only (no keydown bypass — row bodies are
  // not keyboard-focusable, so a recent keydown must not re-toggle the row).
  assert.match(runtimeJs, /const toggleGuardHit = Boolean\(key\)\s*&& pageChipPointerToggleGuard\.key === key\s*&& Date\.now\(\) < pageChipPointerToggleGuard\.until;\s*if \(toggleGuardHit\) return;/);
  assert.doesNotMatch(runtimeJs, /toggleGuardHit = Boolean\(key\)[\s\S]{0,2000}(Date\.now\(\) - pageChipLastKeydownAt > 120)/);
});

test('section header above all cards adds global close-duplicates and merge-all', () => {
  // buildOpenTabsSectionActions drives both render paths of the open-tabs
  // section header; close-duplicates appears only while some card-visible URL
  // is duplicated anywhere in the window (getRealTabs scope — internal pages
  // and the dashboard's own new-tab page never inflate the count).
  assert.match(runtimeJs, /function buildOpenTabsSectionActions\(\) \{[\s\S]{0,500}const counts = \{\};\s*for \(const tab of getRealTabs\(\)\) \{[\s\S]{0,200}const dupeUrls = Object\.entries\(counts\)\s*\.filter\(\(\[, c\]\) => c > 1\)/);
  assert.match(runtimeJs, /data-action="dedup-keep-one" data-dupe-urls="\$\{dupeUrlsEncoded\}"/);
  assert.match(runtimeJs, /data-action="group-card-tabs" data-scope="all"/);
  assert.match(runtimeJs, /openTabsSectionCount\.innerHTML = buildOpenTabsSectionActions\(\);/);
  // The all-scope branch collects every card's ordered unique tabs.
  assert.match(runtimeJs, /const scope = actionEl\.dataset\.scope \|\| '';/);
  assert.match(runtimeJs, /if \(scope === 'all'\) \{[\s\S]{0,300}for \(const g of domainGroups\) \{[\s\S]{0,200}getOrderedUniqueTabsForGroup\(g\)/);
});

test('merge-all is titled with its live merged tab count and delegates writes to the coordinator', () => {
  // The group title reflects what was ACTUALLY merged (scope="all" excludes
  // pinned and non-restorable tabs), so the count is part of the label. The
  // label is resolved from the merged ids AFTER the stale-retry, so a stale
  // id dropped between render and click cannot inflate the title count.
  assert.match(runtimeJs, /const label = scope === 'all'\s*\?\s*\(mergedIds\) => \(runtimeT \? runtimeT\('mergeAllGroupTitle', \{ count: mergedIds\.length \}\) : `Open tabs \(\$\{mergedIds\.length\}\)`\)/);
  // The page drops stale/pinned ids for an accurate label, while the service
  // worker revalidates them again immediately before the serialized write.
  assert.match(runtimeJs, /async function mergeTabsIntoChromeGroup\(tabIds, \{ title, color \}\) \{/);
  assert.match(runtimeJs, /const tab = await chrome\.tabs\.get\(tabId\);/);
  assert.match(runtimeJs, /const label = typeof title === 'function' \? title\(liveIds\) : title;/);
  assert.match(runtimeJs, /const response = await performChromeGroupMutation\('create', \{\s*windowId,\s*tabIds: liveIds,\s*orderedTabIds: liveIds,/);
  const i18nJs = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8');
  assert.match(i18nJs, /mergeAllGroupTitle: 'Open tabs \(\{count\}\)'/);
  assert.match(i18nJs, /mergeAllGroupTitle: '打开的标签页 \(\{count\}\)'/);
});

test('every re-render re-syncs the batch bar so the header title stays consistent', () => {
  // renderOpenTabsArea ends by re-applying the selection classes, which also
  // re-runs syncPageChipBatchBar — a full refresh while rows are selected
  // restores the "N selected" title instead of leaving it on "Open tabs".
  assert.match(runtimeJs, /\/\/ Re-apply the selection highlight and prune ids whose rows are gone; this[\s\S]{0,400}refreshPageChipSelectionClasses\(\);/);
});

test('merge-all skips pinned tabs; the tab snapshot carries the pinned flag', () => {
  // The section-header merge folds every card's tabs into one Chrome group
  // but leaves pinned tabs outside it.
  assert.match(runtimeJs, /if \(tab\?\.pinned\) continue;/);
  assert.match(runtimeJs, /pinned:\s*Boolean\(t\.pinned\),/);
});

test('close-single-tab tolerates a tab that vanished before the click', () => {
  // removeOpenTabByIdOrUrl wraps chrome.tabs.remove in try/catch so a stale id
  // cannot produce an unhandled rejection that skips the toast/animation.
  assert.match(runtimeJs, /async function removeOpenTabByIdOrUrl\(tabId, tabUrl\) \{[\s\S]{0,200}try \{[\s\S]{0,120}await chrome\.tabs\.remove\(numericTabId\);[\s\S]{0,80}\} catch \{\s*\/\* tab already gone[\s\S]{0,80}return null;/);
});

test('close-duplicates keeps every window\'s last tab like the other close paths', () => {
  // closeDuplicatesByUrls routes removals through closeTabsSafely, which uses
  // ensureWindowsKeepLastTab, so deduplication can never close a window (or,
  // for the last window, Chrome).
  assert.match(runtimeJs, /async function closeTabsSafely\(tabIds,\s*\{ playSound = true \} = \{\}\) \{[\s\S]{0,400}const safeToClose = ensureWindowsKeepLastTab\(allTabs, tabIds\);/);
  assert.match(runtimeJs, /async function closeDuplicatesByUrls\(urls,\s*\{ keepOne = true, playSound = true \} = \{\}\) \{/);
  assert.match(runtimeJs, /return closeTabsSafely\(toClose, \{ playSound \}\);/);
});

test('the card-header actions wrapper left no orphaned .actions CSS rule', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.doesNotMatch(css, /\.actions\s*\{/);
});

test('user-created Chrome groups become first-class cards; their tabs leave domain grouping', () => {
  // Tab snapshot carries native group membership + strip position.
  assert.match(runtimeJs, /groupId:\s*Number\.isInteger\(t\.groupId\) && t\.groupId >= 0 \? t\.groupId : -1,/);
  assert.match(runtimeJs, /index:\s*Number\.isInteger\(t\.index\) \? t\.index : 0,/);
  // buildDomainGroups reads authoritative live state from the coordinator and
  // only uses the old page query as a read-only failure fallback.
  assert.match(runtimeJs, /liveStateResponse = await loadChromeTabGroupLiveState\(Number\(dashboardWindowId\)\);/);
  assert.match(runtimeJs, /if \(!liveStateResponse\?\.ok && typeof queryUserChromeGroups === 'function'\) \{/);
  assert.match(runtimeJs, /nativeChromeGroups = dashboardWindowId == null\s*\? \[\]\s*: await queryUserChromeGroups\(Number\(dashboardWindowId\)\);/);
  assert.match(runtimeJs, /const automaticNativeGroupIds = chromeTabGroupsEnabled[\s\S]{0,160}nativeAnalysis\.uniqueCandidateGroupIds/);
  assert.match(runtimeJs, /const userChromeGroups = \(nativeChromeGroups \|\| \[\]\)\.filter\(group =>\s*!automaticNativeGroupIds\.has/);
  assert.match(runtimeJs, /const chromeOwnedTabIds = new Set\(\(userChromeGroups \|\| \[\]\)\.flatMap\(group => group\.tabIds \|\| \[\]\)\.map\(Number\)\);/);
  assert.match(runtimeJs, /if \(chromeOwnedTabIds\.has\(tab\.id\)\) continue;/);
  // Chrome cards render first, in tab-strip order, with no toggle gate.
  assert.match(runtimeJs, /const chromeCards = \(userChromeGroups \|\| \[\]\)\s*\.map\(group => \{/);
  assert.match(runtimeJs, /domain: `\$\{CHROME_GROUP_PREFIX\}\$\{groupId\}`,/);
  assert.match(runtimeJs, /isChromeGroup: true,/);
  assert.match(runtimeJs, /chromeGroupId: groupId,/);
  assert.match(runtimeJs, /if \(chromeCards\.length > 0\) \{\s*domainGroups = \[\.\.\.chromeCards, \.\.\.applyGroupOrder\(\[\.\.\.manualGroups, \.\.\.automaticGroups\], groupOrderState\)\];/);
  // Native groups are recognized live; the import pipeline is retired. The
  // function must ALWAYS return false — a conditional false (e.g. flag-gated)
  // would re-enable the retired pipeline, so the unconditional form is the
  // behavioral anchor.
  assert.match(runtimeJs, /function shouldImportChromeGroupsIntoSessionState\(\) \{[\s\S]{0,400}return false;\s*\}/);
  assert.doesNotMatch(runtimeJs, /function shouldImportChromeGroupsIntoSessionState\(\) \{[\s\S]{0,400}return true/);
});

test('dragging into a Chrome group card joins the native group; dragging out ungroups', () => {
  // Target is a user Chrome group: join with that groupId, muted, and abort on
  // failure instead of silently clearing session state (C1).
  assert.match(runtimeJs, /if \(targetGroup\?\.isChromeGroup && targetGroup\.chromeGroupId != null\) \{[\s\S]{0,300}if \(typeof muteChromeGroupEvents === 'function'\) muteChromeGroupEvents\(\);[\s\S]{0,300}await groupTabsWithStaleRetryIntoGroup\(Number\(targetGroup\.chromeGroupId\), draggedTabIds\);/);
  // Leaving a Chrome group card detaches the batch (domain/manual/new targets).
  assert.match(runtimeJs, /if \(sourceGroups\.some\(group => group\?\.isChromeGroup\)\) \{[\s\S]{0,200}if \(typeof muteChromeGroupEvents === 'function'\) muteChromeGroupEvents\(\);[\s\S]{0,200}await ungroupTabsWithStaleRetry\(draggedTabIds\);/);
  // New-group creation ungroups every moving tab that lives in a Chrome group.
  assert.match(runtimeJs, /const chromeOwnedMovingTabIds = allMovingCollected\.tabIds\.filter\(id => \{[\s\S]{0,300}await ungroupTabsWithStaleRetry\(chromeOwnedMovingTabIds\);/);
  // In-group reorder on a Chrome card reorders the native group's tabs.
  assert.match(runtimeJs, /if \(sourceGroup\?\.isChromeGroup && sourceGroup\.chromeGroupId != null[\s\S]{0,200}await reorderGroupedTabs\(Number\(sourceGroup\.chromeGroupId\), orderIds\.map\(String\), windowId\);/);
});

test('reorderGroupedTabs normalizes string chip tokens to numeric tab ids', () => {
  const syncJs = fs.readFileSync(path.join(__dirname, 'chrome-tab-groups-sync.js'), 'utf8');
  assert.match(syncJs, /const desiredIds = desiredTabIds\s*\.map\(id => Number\(id\)\)\s*\.filter\(Number\.isInteger\);/);
  assert.match(syncJs, /sendCoordinatorRequest\('merge', \{\s*operation: 'reorder',\s*windowId: targetWindowId,\s*targetGroupId,\s*tabIds: desiredIds,/);
  assert.doesNotMatch(syncJs, /chrome\.tabs\.move\s*\(/);
});

test('card refresh is not gated by the import suppression window', () => {
  // The subscription always schedules a live-card read. During a short echo
  // suppression window it waits for that window to expire instead of dropping
  // the refresh. Background and direct listeners share a read-only refresh
  // timer, while the import schedule remains toggle- and suppression-gated.
  assert.match(runtimeJs, /subscribeToChromeTabGroupChanges\(\(event = \{\}\) => \{/);
  assert.match(runtimeJs, /if \(!isChromeGroupEventForCurrentDashboard\(event\)\) return;/);
  assert.match(runtimeJs, /const suppressionRemaining = Math\.max\(0, \(window\.__suppressAutoRefreshUntil \|\| 0\) - Date\.now\(\)\);/);
  assert.match(runtimeJs, /scheduleTabDrivenDashboardRefresh\(suppressionRemaining \+ 200\);/);
  assert.match(runtimeJs, /async function renderDashboard\(\{ syncChromeGroups = true \} = \{\}\)[\s\S]{0,180}if \(!syncChromeGroups\) return;/);
  assert.match(runtimeJs, /await renderDashboard\(\{ syncChromeGroups: false \}\);/);
  assert.match(runtimeJs, /if \(tabDrivenDashboardRefreshRunning \|\| !tabDrivenDashboardRefreshDirty\) return;/);
  assert.match(runtimeJs, /tabDrivenDashboardRefreshRunning = true;\s*tabDrivenDashboardRefreshDirty = false;/);
  assert.match(runtimeJs, /finally \{\s*tabDrivenDashboardRefreshRunning = false;\s*if \(tabDrivenDashboardRefreshDirty\) \{[\s\S]{0,220}armTabDrivenDashboardRefresh\(tabDrivenDashboardRefreshDelayMs\);/);
  assert.match(runtimeJs, /if \(tabDrivenDashboardRefreshRunning\) return;\s*armTabDrivenDashboardRefresh\(tabDrivenDashboardRefreshDelayMs\);/);
  assert.match(runtimeJs, /async function initializeDashboardRuntime\(\)[\s\S]{0,900}setupTabChangeListener\(\);\s*tabDrivenDashboardRefreshRunning = true;\s*try \{/);
  assert.match(runtimeJs, /await renderDashboard\(\);\s*\} finally \{\s*tabDrivenDashboardRefreshRunning = false;\s*if \(tabDrivenDashboardRefreshDirty\) \{\s*armTabDrivenDashboardRefresh\(tabDrivenDashboardRefreshDelayMs\);/);
  assert.match(runtimeJs, /if \(suppressionRemaining > 0\) \{\s*scheduleTabDrivenDashboardRefresh\(suppressionRemaining \+ 200\);\s*return;/);
  assert.doesNotMatch(runtimeJs, /if \(Date\.now\(\) < \(window\.__suppressAutoRefreshUntil \|\| 0\)\) \{\s*return;/);
  assert.match(runtimeJs, /if \(chromeTabGroupsEnabled && !isChromeTabGroupsImportSuppressed\(\)\) \{\s*scheduleChromeTabGroupsImport\(\);/);
});

test('a tab dragged into a native group outside the dashboard drops its manual assignment (C14)', () => {
  // The subscription callback watches events carrying a tab/groupId and clears
  // the manual session-group assignment for tabs that now belong to a native
  // group, so the next render cannot show them in two cards. tabs.onAttached
  // has no tab object, so the callback also resolves a raw tabId live.
  assert.match(runtimeJs, /const eventTab = event\?\.tab;/);
  assert.match(runtimeJs, /eventTab\?\.groupId \?\? event\?\.changeInfo\?\.groupId \?\? event\?\.attachInfo\?\.groupId \?\? -1/);
  assert.match(runtimeJs, /const rawTabId = eventTab\?\.id != null \? Number\(eventTab\.id\) : \(event\?\.tabId != null \? Number\(event\.tabId\) : null\);/);
  assert.match(runtimeJs, /const isAttachEvent = event\?\.source === 'tabs\.onAttached';/);
  assert.match(runtimeJs, /const resolveCleanup = async \(tabId\) => \{/);
  assert.match(runtimeJs, /const live = await chrome\.tabs\.get\(tabId\);/);
  assert.match(runtimeJs, /if \(rawTabId != null && \(Number\(eventGroupId\) >= 0 \|\| isAttachEvent\)\) \{\s*void resolveCleanup\(rawTabId\);/);
  assert.match(runtimeJs, /clearTabsFromSessionGroups\(sessionGroupsState, \[tabId\]\);/);
  // C6: the cleanup does NOT write the raw nextState back in a .then — that
  // would clobber saveSessionGroups' normalized assignment.
  assert.match(runtimeJs, /void saveSessionGroups\(nextState\);/);
  assert.doesNotMatch(runtimeJs, /void saveSessionGroups\(nextState\)\.then\(\(\) => \{\s*if \(sessionGroupsState\) sessionGroupsState = nextState;/);
});

test('cross-card drop into a Chrome group persists the FULL drop order (C7)', () => {
  // After chrome.tabs.group, the native group is reordered to the complete
  // panel order (existing rows + batch at the placeholder), not just the batch
  // tail order; a stale windowId is never used.
  assert.match(runtimeJs, /const firstWindowId = draggedTabIds\.length\s*\? \(await chrome\.tabs\.get\(draggedTabIds\[0\]\)\.catch\(\(\) => null\)\)\?\.windowId/);
  assert.match(runtimeJs, /if \(firstWindowId != null && typeof reorderGroupedTabs === 'function'\) \{/);
  assert.match(runtimeJs, /const fullTargetOrder = targetListEl\s*\?\s*buildCrossGroupTargetOrder\(targetListEl, movingChipIds\)\s*: \[\];/);
  assert.match(runtimeJs, /const orderForNative = fullTargetOrder\.length\s*\?\s*fullTargetOrder\s*: draggedTabIds\.map\(String\);/);
  assert.match(runtimeJs, /reorderGroupedTabs\(Number\(targetGroup\.chromeGroupId\), orderForNative\.map\(String\), Number\(firstWindowId\)\)/);
});

test('sleep/discard failures reset the refresh suppression window (C8)', () => {
  // Every path that raises __suppressAutoRefreshUntil must reset it before an
  // early return, or the next 2s of auto-refresh are silently dropped.
  const suppressSets = (runtimeJs.match(/window\.__suppressAutoRefreshUntil = Date\.now\(\) \+ 2000;/g) || []).length;
  const resets = (runtimeJs.match(/window\.__suppressAutoRefreshUntil = 0;/g) || []).length;
  assert.ok(suppressSets >= 6, `expected >=6 suppress sets, got ${suppressSets}`);
  assert.ok(resets >= 6, `expected >=6 resets, got ${resets}`);
  // Failed single-tab discard resets.
  assert.match(runtimeJs, /if \(failed > 0 \|\| discarded === 0\) \{\s*window\.__suppressAutoRefreshUntil = 0;/);
  // Failed group/all sleep resets.
  assert.match(runtimeJs, /if \(discarded === 0\) \{\s*window\.__suppressAutoRefreshUntil = 0;/);
  // Batch merge: group-creation failure, session-cleanup failure and the
  // group-card/global merge paths all reset before returning (C2).
  assert.match(runtimeJs, /catch \(err\) \{\s*window\.__suppressAutoRefreshUntil = 0;\s*showToast\(runtimeT \? runtimeT\('toastGroupCreateFailed'\)/);
  assert.match(runtimeJs, /await finishBatchAction\(\{ clearSelection: true \}\);\s*showToast\(runtimeT \? runtimeT\('toastBatchMergeCleanupFailed'\)/);
});

test('chrome group cards survive a lagging tab snapshot with a placeholder row (C12)', () => {
  // A tab id the openTabs snapshot has not materialized yet falls back to a
  // minimal placeholder instead of emptying the whole card.
  assert.match(runtimeJs, /const live = openTabs\.find\(t => Number\(t\.id\) === Number\(id\)\);/);
  assert.match(runtimeJs, /return live \|\| \{ id: Number\(id\), url: '', title: '', windowId: Number\(group\.windowId\), groupId \};/);
});

test('chrome group cards pass through custom hex colors and map named enum colors', () => {
  // Chrome 132+ custom group colors come back as raw hex; named enum colors
  // (including newer orange) map to dashboard accents. Anything unmatched
  // falls back to the grey bar instead of an invalid CSS value.
  assert.match(runtimeJs, /orange: '#d98a4b',/);
  assert.match(runtimeJs, /CHROME_GROUP_COLOR_MAP\[group\.chromeGroupColor\] \|\| \(String\(group\.chromeGroupColor \|\| ''\)\.startsWith\('#'\) \? group\.chromeGroupColor : ''\)/);
});

test('merge-all skips user-created Chrome group cards', () => {
  assert.match(runtimeJs, /if \(scope === 'all'\) \{[\s\S]{0,400}if \(g\.isChromeGroup\) continue;/);
});

test('renaming a Chrome group card renames the native Chrome group', () => {
  assert.match(runtimeJs, /if \(group\.isChromeGroup && group\.chromeGroupId != null\) \{[\s\S]{0,300}await performChromeGroupMutation\('update', \{\s*windowId,\s*targetGroupId: Number\(group\.chromeGroupId\),\s*changes: \{ title: cleanName \}/);
});

test('chrome group cards tint their name and row drag handles with the native color', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  // No separate top bar: the group color lives on the card name and the tab
  // rows' drag handles (hover/focus keep the same tint).
  assert.doesNotMatch(css, /\.mission-card\.chrome-group-card::before/);
  // The NAME uses the pure native group color so it visually matches the
  // group chip in the browser tab strip; hover/focus feedback is an underline
  // (keyboard focus stays visible without relying on color contrast). The
  // drag handles keep the pure group color too.
  assert.match(css, /\.mission-card\.chrome-group-card \.mission-name \{\s*color:\s*var\(--chrome-group-color, var\(--ink\)\);/);
  assert.match(css, /\.mission-card\.chrome-group-card \.mission-rename-trigger:hover \.mission-name,[\s\S]{0,400}text-decoration:\s*underline;/);
  assert.match(css, /\.mission-card\.chrome-group-card \.chip-reorder-handle \{\s*color:\s*var\(--chrome-group-color,/);
  assert.match(css, /\.mission-card\.chrome-group-card \.chip-reorder-handle:hover,[\s\S]{0,300}color:\s*color-mix\(in srgb, var\(--chrome-group-color, var\(--ink\)\) 55%, var\(--ink\)\);/);
  // The tint is exposed on the handle as a CSS variable (not an inline color)
  // so the sheet's hover/focus rules can still recolor it.
  assert.match(runtimeJs, /const chromeGroupColor = group\?\.isChromeGroup\s*\?[\s\S]{0,160}CHROME_GROUP_COLOR_MAP\[group\.chromeGroupColor\][\s\S]{0,80}startsWith\('#'\)/);
  assert.match(runtimeJs, /class="drawer-reorder-handle chip-reorder-handle" type="button" data-chip-drag-handle="tab"[\s\S]{0,160}\$\{chromeGroupColor \? ` style="--chrome-group-color:\$\{chromeGroupColor\}"` : ''\}/);
  assert.doesNotMatch(runtimeJs, /function darkenHexColor/);
  assert.match(runtimeJs, /const CHROME_GROUP_COLOR_MAP = \{[\s\S]{0,300}cyan: '#5ba8b3',/);
});

test('an invalidated extension context recovers by reloading the page once', () => {
  // Extension reload/update while the dashboard is open makes every chrome.*
  // call throw "Extension context invalidated". The refresh catch detects it
  // and reloads the page once so it rebinds to the live context.
  assert.match(runtimeJs, /function isExtensionContextInvalidated\(err\) \{[\s\S]{0,200}\/Extension context invalidated\/i/);
  assert.match(runtimeJs, /let extensionContextInvalidatedHandled = false;[\s\S]{0,200}if \(extensionContextInvalidatedHandled\) return;[\s\S]{0,250}location\.reload\(\);/);
  assert.match(runtimeJs, /console\.warn\('\[tab-harbor\] Failed to refresh dashboard:', err\);\s*if \(isExtensionContextInvalidated\(err\)\) recoverFromInvalidatedExtensionContext\(\);/);
  // User-triggered chrome calls after invalidation reject too — the global
  // unhandled-rejection net routes them to the same single recovery.
  assert.match(runtimeJs, /window\.addEventListener\('unhandledrejection', \(event\) => \{[\s\S]{0,200}isExtensionContextInvalidated\(event\?\.reason\)\) recoverFromInvalidatedExtensionContext\(\);/);
});

test('pointerup parks the placeholder at the release point (fast-flick fix)', () => {
  assert.match(runtimeJs, /if \(!stickyIsNonSource\) \{\s*(?:\/\/[^\n]*\n\s*)*previewPageChipOrder\(e\.clientX, e\.clientY\);/);
});

test('dragging a tab chip near the top/bottom edge auto-scrolls the page', () => {
  assert.match(runtimeJs, /const PAGE_CHIP_EDGE_SCROLL_ZONE = 64;/);
  assert.match(runtimeJs, /function stopPageChipAutoScroll\(\) \{/);
  assert.match(runtimeJs, /function updatePageChipAutoScroll\(clientX, clientY\) \{/);
  assert.match(runtimeJs, /window\.scrollBy\(0, delta\);/);
  assert.match(runtimeJs, /previewPageChipOrder\(x, y\);/);
  assert.match(runtimeJs, /function clearPageChipDragState\(\{ removeNode = false \} = \{\}\) \{\s*stopPageChipAutoScroll\(\);/);
  assert.match(runtimeJs, /pageChipDragState\.lastClientX = e\.clientX;\s*pageChipDragState\.lastClientY = e\.clientY;/);
  assert.match(runtimeJs, /previewPageChipOrder\(e\.clientX, e\.clientY\);\s*updatePageChipAutoScroll\(e\.clientX, e\.clientY\);/);
  assert.match(runtimeJs, /async function finishPageChipDrag\(\) \{\s*if \(!draggedPageChipId \|\| !pageChipDragState\) return false;[\s\S]{0,160}stopPageChipAutoScroll\(\);/);
});

test('chip drags refuse a second pointer (re-entrancy guard)', () => {
  assert.match(runtimeJs, /if \(pageChipDragState \|\| draggedPageChipId\) return;/);
});

test('selection state is exposed via aria-pressed on the handle', () => {
  assert.match(runtimeJs, /handle\.setAttribute\('aria-pressed', selected \? 'true' : 'false'\)/);
  assert.match(runtimeJs, /data-chip-drag-handle="tab" aria-pressed="\$\{isSelected \? 'true' : 'false'\}"/);
  assert.match(runtimeJs, /runtimeT\('dragReorderTabSelect'\)/);
});

test('cross-group order builder removes batch rows from the existing order before inserting', () => {
  assert.match(runtimeJs, /\.filter\(id => !movingSet\.has\(id\)\)/);
  assert.match(runtimeJs, /const movingSet = new Set\(\(movingIds \|\| \[\]\)\.map\(String\)\.filter\(Boolean\)\);[\s\S]{0,400}\.filter\(id => !movingSet\.has\(id\)\)/);
});

test('moving set is ordered by visual DOM position', () => {
  assert.match(runtimeJs, /function orderChipIdsByDom\(ids\) \{/);
  assert.match(runtimeJs, /return orderChipIdsByDom\(ids\);/);
});

test('stale selection ids are pruned and the batch bar follows the selection', () => {
  assert.match(runtimeJs, /for \(const id of selectedPageChipIds\) \{\s*if \(!seen\.has\(id\)\) \{\s*selectedPageChipIds\.delete\(id\);\s*if \(pageChipSelectionAnchorId === id\) pageChipSelectionAnchorId = '';/);
  assert.match(runtimeJs, /function clearPageChipSelection\(\) \{\s*selectedPageChipIds\.clear\(\);\s*pageChipSelectionAnchorId = '';/);
  assert.match(runtimeJs, /function syncPageChipBatchBar\(\) \{/);
  assert.match(runtimeJs, /function selectPageChipRange\(targetId, anchorId\) \{/);
});

test('keyboard activation toggles selection; pointer clicks stay on the pointerup path', () => {
  assert.match(runtimeJs, /if \(e\.detail === 0 && !\(draggedPageChipId && pageChipDragState\)\) \{/);
});

test('batch actions run in user order: clear, dedup, merge, sleep, save, close', () => {
  // The bar renders left-to-right: clear selection, close selected
  // duplicates, merge into Chrome group, sleep (conditional), save, close.
  const barHtml = runtimeJs.match(/bar\.innerHTML = `([\s\S]*?)`;/)?.[1] || '';
  const order = [
    'clear-chip-selection',
    'batch-dedup-selection',
    'batch-merge-chrome-group',
    'batch-discard-tabs',
    'batch-save-session',
    'batch-close-tabs',
  ];
  let cursor = 0;
  for (const action of order) {
    const idx = barHtml.indexOf(`data-action="${action}"`);
    assert.ok(idx !== -1, `missing batch action ${action}`);
    assert.ok(idx >= cursor, `batch action ${action} out of order`);
    cursor = idx;
  }
  // Every batch action is an icon button with a themed tooltip, matching the
  // section-header icon actions (aria-label + data-tooltip + inline SVG).
  assert.match(runtimeJs, /data-action="batch-close-tabs" aria-label="\$\{runtimeT \? runtimeT\('batchCloseTabs'\) : 'Close selected'\}" data-tooltip="\$\{runtimeT \? runtimeT\('batchCloseTabs'\) : 'Close selected'\}">\$\{ICONS\.close\}/);
  assert.match(runtimeJs, /data-action="batch-discard-tabs" aria-label="\$\{runtimeT \? runtimeT\('batchSleepTabs'\) : 'Sleep selected'\}" data-tooltip="\$\{runtimeT \? runtimeT\('batchSleepTabs'\) : 'Sleep selected'\}">\$\{ICONS\.moon\}/);
  assert.match(runtimeJs, /data-action="batch-merge-chrome-group" aria-label="\$\{runtimeT \? runtimeT\('batchMergeChromeGroup'\) : 'Merge into Chrome group'\}" data-tooltip="\$\{runtimeT \? runtimeT\('batchMergeChromeGroup'\) : 'Merge into Chrome group'\}">\$\{ICONS\.mergeGroup\}/);
  assert.match(runtimeJs, /data-action="batch-dedup-selection" aria-label="\$\{runtimeT \? runtimeT\('batchCloseDuplicates'\) : 'Close selected duplicates'\}" data-tooltip="\$\{runtimeT \? runtimeT\('batchCloseDuplicates'\) : 'Close selected duplicates'\}">\$\{ICONS\.closeDuplicates\}/);
  assert.match(runtimeJs, /data-action="batch-save-session" aria-label="\$\{runtimeT \? runtimeT\('batchSaveSession'\) : 'Save session'\}" data-tooltip="\$\{runtimeT \? runtimeT\('batchSaveSession'\) : 'Save session'\}">\$\{ICONS\.archive\}/);
  assert.match(runtimeJs, /data-action="clear-chip-selection" aria-label="\$\{runtimeT \? runtimeT\('batchClearSelection'\) : 'Clear selection'\}" data-tooltip="\$\{runtimeT \? runtimeT\('batchClearSelection'\) : 'Clear selection'\}">\$\{ICONS\.deselect\}/);
  assert.match(runtimeJs, /openSessionPickerForTabs\(tabIds, 'selected'\)/);
  // The batch buttons are 30px icon buttons with tooltips, and their tooltips
  // are registered in the shared tooltip CSS (hover + focus-visible).
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /\.page-chip-batch-action \[data-tooltip\]::after,|\.page-chip-batch-action\[data-tooltip\]::after,/);
  assert.match(css, /\.page-chip-batch-action\[data-tooltip\]:hover::after,/);
  assert.match(css, /\.page-chip-batch-action svg \{\s*width: 14px;\s*height: 14px;/);
});

test('batch dedup closes duplicates inside the selection only, keeping one per URL', () => {
  // The handler scopes dedup to the selected tab ids (getTabsByIds), keeps the
  // active copy, and routes removals through ensureWindowsKeepLastTab.
  assert.match(runtimeJs, /if \(action === 'batch-dedup-selection'\) \{/);
  assert.match(runtimeJs, /const tabIds = getSelectedBatchTabIds\(\);/);
  assert.match(runtimeJs, /const \{ closedCount, closedTabIds \} = await closeDuplicatesInSelection\(tabIds\);/);
  assert.match(runtimeJs, /const chipTabIds = getPageChipTabIdMap\(\);/);
  assert.match(runtimeJs, /const keptChipIds = \[\.\.\.selectedPageChipIds\]\.filter\(chipId => \{/);
  assert.match(runtimeJs, /await finishBatchAction\(\{ keptChipIds \}\)/);
  assert.match(runtimeJs, /toastBatchClosedDuplicates', \{ count: closedCount \}\)/);
  assert.match(runtimeJs, /toastBatchNoDuplicates/);
  const i18nJs = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8');
  assert.match(i18nJs, /batchCloseDuplicates: 'Close selected duplicates'/);
  assert.match(i18nJs, /batchCloseDuplicates: '关闭选中重复标签'/);
  assert.match(i18nJs, /toastBatchClosedDuplicates: 'Closed \{count\} duplicate tabs'/);
  assert.match(i18nJs, /toastBatchClosedDuplicates: '已关闭 \{count\} 个重复标签页'/);
  assert.match(i18nJs, /toastBatchNoDuplicates: 'No duplicate tabs in selection'/);
  assert.match(i18nJs, /toastBatchNoDuplicates: '所选标签页中没有重复'/);
});

test('batch merge folds the selection into one new Chrome tab group, muted', () => {
  // The batch bar button maps to its own handler.
  assert.match(runtimeJs, /if \(action === 'batch-merge-chrome-group'\) \{/);
  // Pinned tabs stay outside the merged group; tabs already inside a Chrome
  // group ARE merged (chrome.tabs.group moves them out of the source group).
  assert.match(runtimeJs, /const pinnedIds = new Set\(\(openTabs \|\| \[\]\)\.filter\(t => t\?\.pinned\)\.map\(t => Number\(t\.id\)\)\);/);
  assert.match(runtimeJs, /const tabIds = allSelected\.filter\(id => !pinnedIds\.has\(id\)\);/);
  assert.doesNotMatch(runtimeJs, /const chromeGroupTabIds = new Set\(\);/);
  assert.match(runtimeJs, /if \(!tabIds\.length\) \{\s*showToast\(runtimeT \? runtimeT\('toastBatchMergeNoEligible'\)[^\n]*;\s*return;\s*\}\s*beginBatchAction\(\);/);
  assert.match(runtimeJs, /window\.__suppressAutoRefreshUntil = 0;\s*showToast\(runtimeT \? runtimeT\('toastGroupCreateFailed'\)/);
  assert.match(runtimeJs, /if \(typeof muteChromeGroupEvents === 'function'\) muteChromeGroupEvents\(\);/);
  assert.match(runtimeJs, /mergeResult = await mergeTabsIntoChromeGroup\(tabIds, \{ title, color \}\);/);
  // The name is resolved from the ACTUAL merged ids (stale ids dropped by the
  // retry must not drive the group name).
  assert.match(runtimeJs, /const title = \(mergedIds\) => buildBatchMergeGroupTitle\(mergedIds\);/);
  assert.match(runtimeJs, /const response = await performChromeGroupMutation\('create', \{[\s\S]{0,220}title: String\(label \|\| ''\),\s*color: String\(color \|\| 'grey'\),/);
  // Merged groups rotate through the accent palette (starting past grey), so
  // consecutive merges are visibly different colors instead of always grey.
  assert.match(runtimeJs, /let chromeGroupMergeColorIndex = 1;/);
  assert.match(runtimeJs, /runtimeAssignGroupColor\('all', chromeGroupMergeColorIndex\+\+\)/);
  // Tabs leaving dashboard groups drop their manual assignments.
  assert.match(runtimeJs, /clearTabsFromSessionGroups\(sessionGroupsState, mergedTabIds\);/);
  assert.match(runtimeJs, /pruneSessionGroups\(nextState, getOpenTabIdsForSessionPruning\(\)\);/);
  const i18nJs = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8');
  assert.match(i18nJs, /batchMergeChromeGroup: 'Merge into Chrome group'/);
  assert.match(i18nJs, /batchMergeChromeGroup: '合并为 Chrome 标签组'/);
  assert.match(i18nJs, /batchMergeGroupTitle: 'Selected \(\{count\}\)'/);
  assert.match(i18nJs, /batchMergeGroupTitle: '所选标签页 \(\{count\}\)'/);
  assert.match(i18nJs, /toastBatchMergedChromeGroup: 'Merged \{count\} tabs into a Chrome tab group'/);
  assert.match(i18nJs, /toastBatchMergedChromeGroup: '已将 \{count\} 个标签页合并为 Chrome 标签组'/);
});

test('batch merge names the group from the selected tabs content (domain heuristic)', () => {
  // Chrome exposes no content-aware naming API (tabGroups only has
  // create/get/move/query/update; the browser's AI Tab Organizer is UI-only),
  // so the name is derived locally: most frequent domain wins, single-domain
  // selections use the bare site name, mixed selections append the count;
  // unresolvable URLs fall back to the first tab's title.
  assert.match(runtimeJs, /function buildBatchMergeGroupTitle\(tabIds\) \{/);
  assert.match(runtimeJs, /const rawUrl = String\(tab\?\.url \|\| ''\);/);
  assert.match(runtimeJs, /new URL\(rawUrl\)\.hostname/);
  assert.match(runtimeJs, /counts\.size === 1 \? label : `\$\{label\} ×\$\{topCount\}`/);
  assert.match(runtimeJs, /friendlyDomain\(topDomain\)/);
  assert.match(runtimeJs, /tabs\.find\(t => t\?\.title\)\?\.title/);
});

test('batch close never closes a window\'s last tab', () => {
  assert.match(runtimeJs, /async function closeTabsSafely\(tabIds,\s*\{ playSound = true \} = \{\}\) \{[\s\S]{0,400}const allTabs = await queryTabsForDashboardWindow\(\);\s*const safeToClose = ensureWindowsKeepLastTab\(allTabs, tabIds\);/);
  assert.match(runtimeJs, /if \(closedCount > 0 && playSound\) playCloseSound\(\);/);
});

test('finishBatchAction syncs selection UI and always resets the refresh suppression', () => {
  // The batch bar/highlight must update immediately (not only after render),
  // and the suppression window must be closed even if renderDashboard rejects.
  assert.match(runtimeJs, /refreshPageChipSelectionClasses\(\);\s*try \{[\s\S]{0,200}await renderDashboard\(\);\s*updateBackToTopVisibility\(\);\s*\} finally \{\s*window\.__suppressAutoRefreshUntil = 0;\s*\}/);
});

test('persisted group order never stores __chrome_group__ keys', () => {
  const fn = new Function(`${extractFn(runtimeJs, 'buildPersistentGroupOrderReplacingKey')}\nreturn buildPersistentGroupOrderReplacingKey;`)();
  globalThis.domainGroups = [
    { domain: 'github.com' },
    { domain: '__chrome_group__:1' },
    { domain: '__session_group__:abc' },
  ];
  // Replacing a normal key keeps non-chrome keys and inserts the replacement.
  assert.deepEqual(fn('news.ycombinator.com', 'github.com'), ['news.ycombinator.com', '__session_group__:abc']);
  // A chrome replacement key is never persisted into the durable order, and
  // the replaced non-chrome key stays in the order.
  assert.deepEqual(fn('__chrome_group__:2', 'github.com'), ['github.com', '__session_group__:abc']);
  delete globalThis.domainGroups;
});

test('saveGroupOrder filters chrome-group keys and loadGroupOrder cleans legacy residue', () => {
  // C23: the single storage entry point must never write session-local Chrome
  // group ids into the durable card order, and a pre-filter residue must be
  // cleaned on load.
  assert.match(runtimeJs, /const chromeKey = \/\^__chrome_group__:/);
  assert.match(runtimeJs, /const cleanSessionOrder = \(nextState\?\.sessionOrder \|\| \[\]\)\.map\(String\)\.filter\(key => key && !chromeKey\.test\(key\)\);/);
  assert.match(runtimeJs, /if \(cleanSessionOrder\.length !== \(groupOrderState\.sessionOrder \|\| \[\]\)\.length/);
});

test('batch sleep distinguishes failed from skipped-active tabs', () => {
  assert.match(runtimeJs, /if \(discarded > 0\) \{[\s\S]{0,300}showToast\(runtimeT \? runtimeT\('toastTabsDiscarded', \{ count: discarded \}\)[\s\S]{0,200}toastTabDiscardFailed[\s\S]{0,300}toastBatchSleepNone/);
  // Batch sleep keeps the selection on every selected chip that is still open,
  // matching the dedup behavior (stale ids are pruned by the re-render). It
  // resolves through the DOM so chip sort ids from every card are preserved.
  assert.match(runtimeJs, /function getPageChipTabIdMap\(\) \{/);
  assert.match(runtimeJs, /const chipTabIds = getPageChipTabIdMap\(\);/);
  assert.match(runtimeJs, /const tabIds = \[\.\.\.selectedPageChipIds\]\s*\.map\(chipId => chipTabIds\.get\(String\(chipId\)\)\)\s*\.filter\(tabId => tabId != null\);/);
  assert.match(runtimeJs, /const \{ discarded, failed, skippedActive, stale, resultsByTabId \} = await sleepTabsByIds\(tabIds, \{ skipActive: true \}\);/);
  assert.match(runtimeJs, /const keptChipIds = \[\.\.\.selectedPageChipIds\]\.filter\(chipId => \{/);
  assert.match(runtimeJs, /await finishBatchAction\(\{ keptChipIds \}\)/);
});

test('sleeping a stale (ghost) chip re-renders instead of silently corrupting grouping', () => {
  // sleepTabsByIds detects a tab id that no longer exists in Chrome via a live
  // chrome.tabs.get and counts it as stale; the per-chip handler re-renders to
  // drop the ghost row and prune its dangling assignment.
  assert.match(runtimeJs, /async function sleepTabsByIds\(tabIds,\s*\{ skipActive = true \} = \{\}\) \{/);
  assert.match(runtimeJs, /const tasks = \(tabIds \|\| \[\]\)\.map\(async \(rawTabId\) => \{/);
  assert.match(runtimeJs, /const settled = await Promise\.all\(tasks\);/);
  assert.match(runtimeJs, /if \(stale > 0\) \{\s*(?:\/\/[^\n]*\n\s*)*await fetchOpenTabs\(\);\s*await loadSessionGroups\(getOpenTabIdsForSessionPruning\(\)\);\s*await renderDashboard\(\);\s*updateBackToTopVisibility\(\);\s*window\.__suppressAutoRefreshUntil = 0;\s*showToast\(runtimeT \? runtimeT\('toastTabAlreadyClosed'\)/);
  // Batch sleep uses the same helper and keeps only chips whose tab id is in
  // resultsByTabId (stale ids are excluded by the helper).
  assert.match(runtimeJs, /const \{ discarded, failed, skippedActive, stale, resultsByTabId \} = await sleepTabsByIds\(tabIds, \{ skipActive: true \}\);/);
  assert.match(runtimeJs, /} else if \(stale > 0\) \{\s*showToast\(runtimeT \? runtimeT\('toastTabAlreadyClosed'\) : 'Tab already closed'\);/);
});

test('close-duplicates and merge-group are header icon actions left of the sleep action', () => {
  assert.match(runtimeJs, /const dedupButton = hasDupes \? `\s*<button class="group-action-icon" type="button" data-action="dedup-keep-one" data-dupe-urls="\$\{dupeUrlsEncoded\}" aria-label="\$\{dedupLabel\}" data-tooltip="\$\{dedupLabel\}">/);
  // The merge action is hidden on cards that already ARE a Chrome group.
  assert.match(runtimeJs, /const mergeGroupButton = group\.isChromeGroup \? '' : `\s*<button class="group-action-icon" type="button" data-action="group-card-tabs" data-domain-id="\$\{stableId\}" aria-label="\$\{runtimeT \? runtimeT\('groupCardTabsLabel'\)/);
  // Close-duplicates sits leftmost, then merge, then the sleep icon.
  assert.match(runtimeJs, /<div class="mission-actions">\s*\$\{dedupButton\}\s*\$\{mergeGroupButton\}\s*\$\{sleepControlEnabled \? `/);
  // Chrome group cards carry their native group id and color for the bar.
  assert.match(runtimeJs, /class="mission-card domain-card \$\{hasDupes \? 'has-amber-bar' : 'has-neutral-bar'\}\$\{group\.isChromeGroup \? ' chrome-group-card' : ''\}"[\s\S]{0,200}data-chrome-group-id="\$\{group\.chromeGroupId\}"[\s\S]{0,120}--chrome-group-color:\$\{chromeColor\}/);
});

test('merge/duplicate actions reuse the icon-button style of sleep/save/close', () => {
  const helperJs = fs.readFileSync(path.join(__dirname, 'ui-helpers.js'), 'utf8');
  assert.match(helperJs, /mergeGroup: `<svg[\s\S]*<\/svg>`/);
  assert.match(helperJs, /closeDuplicates: `<svg[\s\S]*<\/svg>`/);
  assert.doesNotMatch(runtimeJs, /data-action="group-card-tabs"[\s\S]{0,120}class="action-btn"/);
});

test('per-chip duplicate count badges are not rendered', () => {
  // The "(Nx)" text badge on duplicated rows is gone; the duplicate detection
  // (card badge, dedup action, border highlight) stays.
  assert.doesNotMatch(runtimeJs, /chip-dupe-badge/);
  assert.doesNotMatch(runtimeJs, /dupeTag/);
  assert.match(runtimeJs, /\$\{count > 1 \? ' chip-has-dupes' : ''\}/);
});

test('the bottom of the tab list keeps the same hairline as the middle rows', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /\.page-chip \{\s*[\s\S]{0,200}border-bottom: 1px solid rgba\(154, 145, 138, 0\.12\);/);
  assert.doesNotMatch(css, /\.page-chip:last-child,[\s\S]*\.page-chip-overflow \{\s*border-bottom: none;/);
});

test('touch/pen synthesized clicks do not double-toggle the row', () => {
  assert.match(runtimeJs, /let pageChipPointerToggleGuard = \{ key: '', until: 0 \};/);
  assert.match(runtimeJs, /pageChipPointerToggleGuard = \{ key: String\(draggedPageChipId \|\| ''\), until: Date\.now\(\) \+ 400 \};/);
  assert.match(runtimeJs, /if \(pageChipPointerToggleGuard\.key === key[\s\S]{0,200}Date\.now\(\) - pageChipLastKeydownAt > 120\) return;/);
  assert.match(runtimeJs, /pageChipLastKeydownAt = Date\.now\(\);/);
});

test('batch drag badge counts only rows that will actually reorder on the source group', () => {
  assert.match(runtimeJs, /inListCount = movingIds\.filter\(id => \[\.\.\.listEl\.children\]\.some\(n => String\(n\.dataset\?\.chipSortId \|\| ''\) === String\(id\)\)\)\.length;/);
});

test('selection clears after cross-group moves and new-group creation', () => {
  assert.match(runtimeJs, /logPageChipDragDebug\('finish-group-move', \{ groupKey: movedGroup\.groupKey, groupName: movedGroup\.groupName \}\);\s*(?:\/\/[^\n]*\n\s*)*clearPageChipSelection\(\);/);
  assert.match(runtimeJs, /logPageChipDragDebug\('finish-new-group', \{ groupName: createdGroup\.name \}\);\s*(?:\/\/[^\n]*\n\s*)*clearPageChipSelection\(\);/);
});

test('expanded overflow rows are full rows: handle, sort id, selection, drag', () => {
  assert.match(runtimeJs, /function buildPageChipHtml\(tab, group, urlCounts = \{\}, collapsed = false\) \{/);
  assert.match(runtimeJs, /data-chip-sort-id="\$\{safeSortId\}" data-chip-group-id="\$\{safeGroupId\}"/);
  assert.match(runtimeJs, /const pageChips = orderedTabs\.map\(\(tab, index\) => buildPageChipHtml\(tab, group, urlCounts, index >= 8 && !isOverflowExpanded\)\)\.join\(''\)/);
  // Overflow rows are direct list children collapsed with a CSS class — not a
  // hidden wrapper that would break drag ordering and selection.
  assert.doesNotMatch(runtimeJs, /page-chips-overflow/);
  assert.match(runtimeJs, /\$\{collapsed \? ' page-chip--collapsed' : ''\}/);
});

test('expanded overflow state survives re-renders (drag commits, refreshes)', () => {
  assert.match(runtimeJs, /let expandedPageChipGroupKeys = new Set\(\);/);
  assert.match(runtimeJs, /const isOverflowExpanded = expandedPageChipGroupKeys\.has\(String\(group\.domain\)\);/);
  assert.match(runtimeJs, /\(extraCount > 0 && !isOverflowExpanded \? buildOverflowChips\(extraCount\) : ''\)/);
  assert.match(runtimeJs, /if \(groupKey\) expandedPageChipGroupKeys\.add\(groupKey\);/);
  assert.match(runtimeJs, /for \(const key of expandedPageChipGroupKeys\) \{[\s\S]{0,200}expandedPageChipGroupKeys\.delete\(key\);/);
});

test('expand action reveals collapsed chips as regular list rows', () => {
  assert.match(runtimeJs, /if \(action === 'expand-chips'\) \{[\s\S]{0,300}const collapsed = cardEl \? \[\.\.\.cardEl\.querySelectorAll\('\.page-chip--collapsed'\)\] : \[\];\s*collapsed\.forEach\(chip => chip\.classList\.remove\('page-chip--collapsed'\)\);/);
});

test('collapsed overflow rows are hidden with CSS only', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /\.page-chip--collapsed \{\s*display: none;/);
});

test('drops at the bottom of a card stay in the visible section (overflow fix)', () => {
  // Collapsed rows must never be placeholder insertion candidates, and a drop
  // below the last visible row parks the placeholder before the collapsed block.
  assert.match(runtimeJs, /\[\.\.\.listEl\.querySelectorAll\('\[data-chip-sort-id\]:not\(\.is-dragging\):not\(\.page-chip--collapsed\)'\)\]/);
  assert.match(runtimeJs, /const firstCollapsed = listEl\.querySelector\('\.page-chip--collapsed'\);\s*if \(firstCollapsed\) listEl\.insertBefore\(placeholder, firstCollapsed\);/);
});

test('same-group commit falls back to a re-render when the placeholder is missing', () => {
  assert.match(runtimeJs, /requiresOpenTabsRebuild = !pageChipPlaceholderEl;/);
});

test('dropping outside any target cancels the drag instead of removing rows', () => {
  assert.match(runtimeJs, /logPageChipDragDebug\('finish-dead-zone-cancel', \{ moved \}\);\s*clearPageChipDragState\(\{ removeNode: false \}\);\s*return true;/);
});

test('range selection only walks visible rows (collapsed rows excluded)', () => {
  assert.match(runtimeJs, /const rows = \[\.\.\.card\.querySelectorAll\('\.page-chip\[data-chip-sort-id\]:not\(\.page-chip--collapsed\)'\)\];/);
});

test('Space on a focused handle keeps the native button activation (no keydown preventDefault)', () => {
  assert.match(runtimeJs, /document\.addEventListener\('keydown', \(e\) => \{\s*pageChipLastKeydownAt = Date\.now\(\);\s*if \(e\.key !== 'Escape'\) return;/);
});

test('keyboard expansion hands focus to the first revealed row', () => {
  assert.match(runtimeJs, /if \(e\.detail === 0\) \{\s*const firstHandle = collapsed\[0\]\?\.querySelector\('\[data-chip-drag-handle="tab"\]'\);\s*if \(firstHandle\) firstHandle\.focus\(\);/);
});

// ---------------------------------------------------------------------------
// Audit follow-up (2026-08): behavioral tests for the page's thin mutation
// clients. Stale/pinned filtering and the actual Chrome writes now belong to
// the serialized background coordinator (covered by its integration tests).
// ---------------------------------------------------------------------------

test('groupTabsWithStaleRetry delegates new-group creation to the background coordinator', async () => {
  const fn = new Function(`${extractFn(runtimeJs, 'groupTabsWithStaleRetry')}\nreturn groupTabsWithStaleRetry;`)();
  const calls = [];
  globalThis.getWindowIdForChromeGroupTabs = async ids => {
    assert.deepEqual(ids, [1, 2, 3]);
    return 7;
  };
  globalThis.performChromeGroupMutation = async (operation, payload) => {
    calls.push({ operation, payload });
    return { groupId: 901, mergedTabIds: [1, 2] };
  };
  const result = await fn([1, 2, 3]);
  assert.equal(result.groupId, 901);
  assert.deepEqual(result.mergedTabIds, [1, 2]);
  assert.deepEqual(calls, [{
    operation: 'create',
    payload: {
      windowId: 7,
      tabIds: [1, 2, 3],
      orderedTabIds: [1, 2, 3],
      title: '',
      color: 'grey',
    },
  }]);
  delete globalThis.getWindowIdForChromeGroupTabs;
  delete globalThis.performChromeGroupMutation;
});

test('groupTabsWithStaleRetry fails before messaging when no window can be resolved', async () => {
  const fn = new Function(`${extractFn(runtimeJs, 'groupTabsWithStaleRetry')}\nreturn groupTabsWithStaleRetry;`)();
  globalThis.getWindowIdForChromeGroupTabs = async () => null;
  globalThis.performChromeGroupMutation = async () => { throw new Error('must not run'); };
  await assert.rejects(() => fn([1, 2]), /resolve the Chrome tab-group window/);
  delete globalThis.getWindowIdForChromeGroupTabs;
  delete globalThis.performChromeGroupMutation;
});

test('groupTabsWithStaleRetry surfaces coordinator failures', async () => {
  const fn = new Function(`${extractFn(runtimeJs, 'groupTabsWithStaleRetry')}\nreturn groupTabsWithStaleRetry;`)();
  globalThis.getWindowIdForChromeGroupTabs = async () => 7;
  globalThis.performChromeGroupMutation = async () => { throw new Error('grouping denied'); };
  await assert.rejects(() => fn([1, 2]), /grouping denied/);
  delete globalThis.getWindowIdForChromeGroupTabs;
  delete globalThis.performChromeGroupMutation;
});

test('groupTabsWithStaleRetryIntoGroup delegates an existing-group join', async () => {
  const fn = new Function(`${extractFn(runtimeJs, 'groupTabsWithStaleRetryIntoGroup')}\nreturn groupTabsWithStaleRetryIntoGroup;`)();
  const calls = [];
  globalThis.getWindowIdForChromeGroupTabs = async () => 8;
  globalThis.performChromeGroupMutation = async (operation, payload) => {
    calls.push({ operation, payload });
    return { groupId: 902, tabIds: payload.tabIds };
  };
  const result = await fn(902, [1, 2, 3]);
  assert.equal(result.groupId, 902);
  assert.deepEqual(calls, [{
    operation: 'join',
    payload: { windowId: 8, targetGroupId: 902, tabIds: [1, 2, 3] },
  }]);
  delete globalThis.getWindowIdForChromeGroupTabs;
  delete globalThis.performChromeGroupMutation;
});

test('ungroupTabsWithStaleRetry delegates membership removal', async () => {
  const fn = new Function(`${extractFn(runtimeJs, 'ungroupTabsWithStaleRetry')}\nreturn ungroupTabsWithStaleRetry;`)();
  const calls = [];
  globalThis.getWindowIdForChromeGroupTabs = async () => 9;
  globalThis.performChromeGroupMutation = async (operation, payload) => {
    calls.push({ operation, payload });
    return { tabIds: [1, 3] };
  };
  await fn([1, 2, 3]);
  assert.deepEqual(calls, [{
    operation: 'ungroup',
    payload: { windowId: 9, tabIds: [1, 2, 3] },
  }]);
  delete globalThis.getWindowIdForChromeGroupTabs;
  delete globalThis.performChromeGroupMutation;
});

// ---------------------------------------------------------------------------
// Audit follow-up: defense-in-depth contracts and coverage gaps (C13/C16/C17/
// C22 + dedup suppression ordering).
// ---------------------------------------------------------------------------

test('every batch handler is guarded by batchActionInFlight and resets it in finally (C22)', () => {
  // Per-handler: the guard sits right before the flag is raised and the body
  // is wrapped in try, so a double-click cannot start a second operation.
  for (const action of ['batch-close-tabs', 'batch-discard-tabs', 'batch-dedup-selection', 'batch-merge-chrome-group']) {
    assert.match(runtimeJs, new RegExp(
      `if \\(action === '${action}'\\) \\{[\\s\\S]{0,160}if \\(batchActionInFlight\\) return;[\\s\\S]{0,80}batchActionInFlight = true;[\\s\\S]{0,80}try \\{`
    ));
  }
  // Shared shape: every handler's finally resets the flag and the refresh
  // suppression, so even a failed render cannot leave the 2s window open.
  assert.match(runtimeJs, /finally \{\s*batchActionInFlight = false;\s*window\.__suppressAutoRefreshUntil = 0;\s*\}/);
});

test('dedup-keep-one raises the refresh suppression only after the no-op checks', () => {
  // The suppression window must come after the empty checks: an early return
  // can never leak a 2s auto-refresh block.
  assert.match(runtimeJs, /if \(chromeGroup \? chromeTabIds\.length === 0 : urls\.length === 0\) return;[\s\S]{0,80}window\.__suppressAutoRefreshUntil = Date\.now\(\) \+ 2000;/);
});

test('placeholder rows never render save/close controls and never count as duplicates (C13)', () => {
  assert.match(runtimeJs, /\$\{!isPlaceholder \? `<button class="chip-action chip-session-save"/);
  assert.match(runtimeJs, /\$\{!isPlaceholder \? `<button class="chip-action chip-close"/);
  // urlCounts skips rows without a URL so placeholder rows cannot look
  // duplicated against each other.
  assert.match(runtimeJs, /for \(const tab of tabs\) \{[\s\S]{0,80}if \(!tab\.url\) continue;[\s\S]{0,120}urlCounts\[tab\.url\]/);
});

test('turning the Chrome-group sync toggle off tears down managed mirrors (C16)', () => {
  // The dashboard asks the background coordinator for a session-wide sweep;
  // adopted mappings remain native while every created mapping is cleaned.
  // A failed sweep remains explicitly pending and is retried.
  assert.match(runtimeJs, /if \(!enable\) \{[\s\S]{0,120}cleanupResponse = await requestChromeTabGroupCleanup\(\);/);
  assert.match(runtimeJs, /response\?\.ok[\s\S]{0,120}scheduleChromeTabGroupCleanupRetry\(\);/);
  assert.match(runtimeJs, /allWindows: !chromeTabGroupsEnabled/);
});

test('the retired-import early return sits before the in-flight flag is raised (C17)', () => {
  // The early return must sit before the in-flight flag is raised: the
  // short-circuit cannot pay for fetch/load/storage work or leave the flag
  // raised.
  assert.match(runtimeJs, /if \(!shouldImportChromeGroupsIntoSessionState\(\)\) \{[\s\S]{0,80}disableChromeTabGroupsImportModeForLocalEdits\(\);\s*return;[\s\S]{0,200}chromeTabGroupsImportInFlight = true/);
});

test('chrome-group query failure uses a read-only fallback while background sync fails closed (C6/C7)', () => {
  // Successful coordinator state is authoritative. The page-side query only
  // runs when that read fails, keeping cards visible without granting the page
  // ownership of native-group writes.
  assert.match(runtimeJs, /if \(!liveStateResponse\?\.ok && typeof queryUserChromeGroups === 'function'\) \{/);
  assert.match(runtimeJs, /nativeChromeGroups = dashboardWindowId == null\s*\? \[\]\s*: await queryUserChromeGroups\(Number\(dashboardWindowId\)\);/);
  assert.match(runtimeJs, /chromeTabGroupSnapshotAuthoritative = false;/);
  assert.match(runtimeJs, /if \(chromeTabGroupsEnabled && !chromeTabGroupSnapshotAuthoritative\) \{[\s\S]{0,180}NON_AUTHORITATIVE_SNAPSHOT/);
  assert.match(runtimeJs, /preserveGroupKeys: chromeTabGroupsEnabled \? chromeTabGroupPreserveKeys : \[\]/);
  assert.match(runtimeJs, /const response = await sendChromeTabGroupRequest\('sync-chrome-tab-groups', \{/);
  assert.doesNotMatch(runtimeJs, /chrome\.tabs\.(?:group|ungroup|move)\s*\(/);
  assert.doesNotMatch(runtimeJs, /chrome\.tabGroups\.update\s*\(/);
});

// ---------------------------------------------------------------------------
// Audit follow-up (2026-08): behavioral tests for the unified close/dedup
// helpers — the URL-matching branches and the keep-one selection were only
// mirrored by regex assertions before.
// ---------------------------------------------------------------------------

test('closeTabsByUrlsSafely matches hostnames, exact URLs and file:// exactly', async () => {
  const fn = new Function(`${extractFn(runtimeJs, 'closeTabsByUrlsSafely')}\nreturn closeTabsByUrlsSafely;`)();
  let captured = null;
  globalThis.runtimeGetCanonicalTabUrl = (url) => url;
  globalThis.getTabCanonicalUrl = (tab) => String(tab?.url || '');
  globalThis.queryTabsForDashboardWindow = async () => [
    { id: 1, windowId: 1, url: 'https://example.com/a' },
    { id: 2, windowId: 1, url: 'https://example.com/b' },
    { id: 3, windowId: 1, url: 'https://other.org/x' },
    { id: 4, windowId: 1, url: 'file:///tmp/note.md' },
    { id: 5, windowId: 1, url: 'https://sub.example.com/c' },
  ];
  globalThis.closeTabsSafely = async (ids) => {
    captured = ids;
    return { closedCount: ids.length, closedTabIds: new Set(ids) };
  };

  // Hostname match is exact (no subdomain folding): example.com covers the
  // two example.com tabs; the subdomain and other hosts stay.
  await fn(['https://example.com/'], { exact: false, playSound: false });
  assert.deepEqual(captured.sort(), [1, 2]);
  // Exact match: only the identical URL.
  captured = null;
  await fn(['https://example.com/a'], { exact: true, playSound: false });
  assert.deepEqual(captured, [1]);
  // file:// URLs are always matched exactly, never by hostname.
  captured = null;
  await fn(['file:///tmp/note.md'], { exact: false, playSound: false });
  assert.deepEqual(captured, [4]);
  // Unparseable input URLs are skipped, nothing closes.
  captured = null;
  await fn(['not a url'], { exact: false, playSound: false });
  assert.deepEqual(captured, []);

  delete globalThis.runtimeGetCanonicalTabUrl;
  delete globalThis.getTabCanonicalUrl;
  delete globalThis.queryTabsForDashboardWindow;
  delete globalThis.closeTabsSafely;
});

test('closeDuplicatesByUrls keeps the active copy when keepOne is set', async () => {
  const fn = new Function(`${extractFn(runtimeJs, 'closeDuplicatesByUrls')}\nreturn closeDuplicatesByUrls;`)();
  let captured = null;
  globalThis.runtimeGetCanonicalTabUrl = (url) => url;
  globalThis.getTabCanonicalUrl = (tab) => String(tab?.url || '');
  globalThis.queryTabsForDashboardWindow = async () => [
    { id: 1, windowId: 1, url: 'https://example.com/x', active: false },
    { id: 2, windowId: 1, url: 'https://example.com/x', active: true },
    { id: 3, windowId: 1, url: 'https://example.com/y', active: false },
  ];
  globalThis.closeTabsSafely = async (ids) => {
    captured = ids;
    return { closedCount: ids.length, closedTabIds: new Set(ids) };
  };

  // keepOne: the active copy (2) survives.
  await fn(['https://example.com/x'], { keepOne: true, playSound: false });
  assert.deepEqual(captured, [1]);
  // keepOne=false: every copy closes.
  captured = null;
  await fn(['https://example.com/x'], { keepOne: false, playSound: false });
  assert.deepEqual(captured.sort(), [1, 2]);
  // No matches → nothing closes.
  captured = null;
  await fn(['https://nowhere.example'], { keepOne: true, playSound: false });
  assert.deepEqual(captured, []);

  delete globalThis.runtimeGetCanonicalTabUrl;
  delete globalThis.getTabCanonicalUrl;
  delete globalThis.queryTabsForDashboardWindow;
  delete globalThis.closeTabsSafely;
});

test('ensureWindowsKeepLastTab never empties a window (real implementation)', () => {
  const fn = new Function(`${extractFn(runtimeJs, 'ensureWindowsKeepLastTab')}\nreturn ensureWindowsKeepLastTab;`)();
  const allTabs = [
    { id: 1, windowId: 7, active: true },
    { id: 2, windowId: 7, active: false },
    { id: 3, windowId: 8, active: false },
  ];
  // Window 7 would lose both tabs: the active one (1) is kept. Window 8's
  // only tab (3) is kept too.
  assert.deepEqual(fn(allTabs, [1, 2, 3]), [2]);
  // A window with tabs outside the close set is not protected: 1 is closable.
  assert.deepEqual(fn(allTabs, [1]), [1]);
  // A single-tab window whose only tab is in the close set is protected.
  assert.deepEqual(fn([{ id: 9, windowId: 9, active: false }], [9]), []);
});

// ---------------------------------------------------------------------------
// Behavioral: restore-created tabs start ASLEEP (discard-on-restore)
// ---------------------------------------------------------------------------

test('openSavedTabsInCurrentWindow discards every background tab but keeps the first active one loaded', async () => {
  const fn = new Function(`
    ${extractFn(runtimeJs, 'discardTab')}
    ${extractFn(runtimeJs, 'discardRestoredTabAfterCommit')}
    ${extractFn(runtimeJs, 'openSavedTabsInCurrentWindow')}
    return openSavedTabsInCurrentWindow;
  `)();

  const discarded = [];
  globalThis.getCurrentWindowId = async () => 501;
  globalThis.chrome = {
    windows: { getCurrent: async () => ({ id: 501 }) },
    tabs: {
      create: async (opts) => ({
        id: opts.url === 'https://a.test' ? 1001 : opts.url === 'https://b.test' ? 1002 : 1003,
        url: opts.url,
        active: !!opts.active,
        windowId: opts.windowId ?? 501,
      }),
      // The restored tabs are already committed (url set) so the discard
      // helper sleeps them immediately instead of polling.
      get: async (id) => ({
        id,
        url: id === 1001 ? 'https://a.test' : id === 1002 ? 'https://b.test' : 'https://c.test',
        active: false,
      }),
      discard: async (id) => { discarded.push(Number(id)); },
      query: async () => [],
    },
  };

  const result = await fn([
    { url: 'https://a.test' },
    { url: 'https://b.test' },
    { url: 'https://c.test' },
  ]);

  // The first tab is created active and must NOT be discarded; the two
  // background tabs are discarded once their navigation commits (restored
  // tabs start asleep so a large session does not load every page at once).
  assert.deepEqual(discarded, [1002, 1003]);
  // The restored id list is unaffected by the discards.
  assert.deepEqual(result.restoredTabs.map(t => t.id), [1001, 1002, 1003]);
  delete globalThis.getCurrentWindowId;
  delete globalThis.chrome;
});

test('openSavedTabsInNewWindow discards every background tab of the restored session', async () => {
  const fn = new Function(`
    ${extractFn(runtimeJs, 'discardTab')}
    ${extractFn(runtimeJs, 'discardRestoredTabAfterCommit')}
    ${extractFn(runtimeJs, 'openSavedTabsInNewWindow')}
    return openSavedTabsInNewWindow;
  `)();

  const discarded = [];
  globalThis.chrome = {
    windows: {
      create: async (opts) => ({ id: 502, tabs: [{ id: 2001, url: opts.url, active: true }] }),
    },
    tabs: {
      create: async (opts) => ({
        id: opts.url === 'https://a.test' ? 2001 : opts.url === 'https://b.test' ? 2002 : 2003,
        url: opts.url,
        active: !!opts.active,
        windowId: opts.windowId ?? 502,
      }),
      get: async (id) => ({
        id,
        url: id === 2001 ? 'https://a.test' : id === 2002 ? 'https://b.test' : 'https://c.test',
        active: false,
      }),
      discard: async (id) => { discarded.push(Number(id)); },
      query: async () => [],
    },
  };

  const result = await fn([
    { url: 'https://a.test' },
    { url: 'https://b.test' },
    { url: 'https://c.test' },
  ]);

  // The first tab comes from windows.create (active) and is never discarded.
  assert.deepEqual(discarded, [2002, 2003]);
  assert.deepEqual(result.restoredTabs.map(t => t.id), [2001, 2002, 2003]);
  delete globalThis.chrome;
});
