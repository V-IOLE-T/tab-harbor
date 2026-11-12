'use strict';

// Behavioral tests for the search-suggestion pure logic (extension/search-suggestions.js).
// These execute the real module under node --test, mirroring batch-drag.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
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
} = require(path.join(__dirname, 'search-suggestions.js'));

test('buildOpenTabSuggestions dedupes by URL and keeps tab ids', () => {
  const rows = buildOpenTabSuggestions([
    { url: 'https://a.example/', title: 'A', id: 1, windowId: 2 },
    { url: 'https://a.example/', title: 'A dup', id: 3, windowId: 2 },
    { url: 'https://b.example/', title: 'B', id: 4, windowId: 2 },
    { url: '', title: 'no url', id: 5 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'tab');
  assert.equal(rows[0].tabId, 1);
  assert.equal(rows[1].url, 'https://b.example/');
});

test('buildQuickShortcutSuggestions labels rows with the shortcut label', () => {
  const rows = buildQuickShortcutSuggestions([
    { url: 'https://x.example/', label: 'X' },
    { url: 'https://y.example/', label: '' },
  ]);
  assert.equal(rows[0].type, 'shortcut');
  assert.equal(rows[0].title, 'X');
  assert.equal(rows[1].title, 'https://y.example/');
});

test('buildBookmarkSuggestions preserves Chinese titles and derives nested folder paths', () => {
  const rows = buildBookmarkSuggestions([
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: '书签栏',
          children: [
            {
              id: '2',
              title: '项目资料',
              children: [
                { id: '3', title: '中文开发文档', url: 'https://docs.example.cn/zh/' },
              ],
            },
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(rows, [{
    type: 'bookmark',
    bookmarkId: '3',
    title: '中文开发文档',
    url: 'https://docs.example.cn/zh/',
    folderPath: '书签栏 / 项目资料',
  }]);
  assert.equal(filterSuggestions(rows, '中文')[0].bookmarkId, '3');
  assert.equal(filterSuggestions(rows, '项目资料')[0].bookmarkId, '3');
});

test('buildBookmarkSuggestions accepts flattened bookmark-model paths', () => {
  const rows = buildBookmarkSuggestions([{
    id: 'flat-1',
    title: '已标准化书签',
    url: 'https://flat.example/',
    path: [
      { id: 'bar', title: '书签栏' },
      { id: 'folder', title: '阅读' },
    ],
  }]);

  assert.equal(rows[0].folderPath, '书签栏 / 阅读');
});

test('buildSessionTabSuggestions flattens sessions and dedupes URLs', () => {
  const rows = buildSessionTabSuggestions([
    {
      name: 'Work',
      tabs: [
        { url: 'https://s1.example/', title: 'S1' },
        { url: 'https://s1.example/', title: 'S1 dup' },
        { url: 'https://s2.example/', title: 'S2' },
      ],
    },
    { name: 'Other', tabs: [] },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'session');
  assert.equal(rows[0].label, 'Work');
});

test('buildSessionTabSuggestions expands direct and nested window session tabs', () => {
  const rows = buildSessionTabSuggestions({
    sessions: [
      {
        name: '研究会话',
        tabs: [{ url: 'https://direct.example/', title: '直接标签' }],
      },
      {
        session: {
          name: '导入会话',
          windows: [
            { tabs: [{ url: 'https://nested-a.example/', title: '嵌套 A' }] },
            { tabs: [{ url: 'https://nested-b.example/', title: '嵌套 B' }] },
          ],
        },
      },
    ],
  });

  assert.deepEqual(rows.map(row => row.url), [
    'https://direct.example/',
    'https://nested-a.example/',
    'https://nested-b.example/',
  ]);
  assert.equal(rows[1].label, '导入会话');
});

test('buildHistorySuggestions normalizes history items', () => {
  const rows = buildHistorySuggestions([
    { url: 'https://h.example/', title: 'H', visitCount: 5, lastVisitTime: 100 },
    { url: 'https://h.example/', title: 'H dup' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'history');
  assert.equal(rows[0].visitCount, 5);
});

test('scoreSuggestion prefers title prefix over loose URL match', () => {
  const titleMatch = scoreSuggestion(
    { title: 'React Docs', url: 'https://react.dev/' },
    ['react']
  );
  const urlOnly = scoreSuggestion(
    { title: 'Something Else', url: 'https://react.dev/' },
    ['react']
  );
  assert.ok(titleMatch > urlOnly, 'title match should outrank URL-only match');
  assert.ok(titleMatch > 0);
});

test('scoreSuggestion returns 0 when no token matches', () => {
  assert.equal(scoreSuggestion({ title: 'Apple', url: 'https://apple.com/' }, ['banana']), 0);
});

test('filterSuggestions returns everything when query is empty, capped at 12', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    type: 'history',
    url: `https://site${i}.example/`,
    title: `Site ${i}`,
  }));
  const filtered = filterSuggestions(rows, '');
  assert.equal(filtered.length, 12);
});

test('filterSuggestions groups by source order: tabs, shortcuts, bookmarks, sessions, history', () => {
  const rows = [
    { type: 'history', url: 'https://h.example/', title: 'H site' },
    { type: 'tab', url: 'https://t.example/', title: 'T site' },
    { type: 'shortcut', url: 'https://s.example/', title: 'S site' },
    { type: 'bookmark', url: 'https://b.example/', title: 'B site' },
    { type: 'session', url: 'https://se.example/', title: 'SE site' },
  ];
  const filtered = filterSuggestions(rows, 'site');
  assert.deepEqual(filtered.map(r => r.type), ['tab', 'shortcut', 'bookmark', 'session', 'history']);
});

// @lat: [[tests#书签镜像验收#纵向列表与书签 favicon 偏好]]
test('bookmark suggestion favicons are opt-in and never use network fallbacks', () => {
  const bookmark = { type: 'bookmark', url: 'https://example.com/' };
  const chromeFavicon = 'chrome-extension://abcdefghijklmnop/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2F&size=16';
  const siteFallback = 'https://example.com/favicon.ico';
  const serviceFallback = 'https://www.google.com/s2/favicons?domain=example.com&sz=16';

  assert.deepEqual(
    selectSuggestionIconSources(bookmark, [chromeFavicon, siteFallback, serviceFallback]),
    { faviconUrl: '', fallbackUrl: '' },
  );
  assert.deepEqual(
    selectSuggestionIconSources(
      bookmark,
      [siteFallback, chromeFavicon, serviceFallback],
      { bookmarksShowFavicons: true },
    ),
    { faviconUrl: chromeFavicon, fallbackUrl: '' },
  );
  assert.deepEqual(
    selectSuggestionIconSources(
      bookmark,
      [
        siteFallback,
        'chrome-extension://abcdefghijklmnop/images/icon.png',
        serviceFallback,
      ],
      { bookmarksShowFavicons: true },
    ),
    { faviconUrl: '', fallbackUrl: '' },
  );
});

test('non-bookmark suggestion icons retain their existing first fallback', () => {
  assert.deepEqual(
    selectSuggestionIconSources(
      { type: 'tab' },
      ['https://example.com/icon.png', 'https://example.com/favicon.ico'],
      { bookmarksShowFavicons: false },
    ),
    {
      faviconUrl: 'https://example.com/icon.png',
      fallbackUrl: 'https://example.com/favicon.ico',
    },
  );
});

test('dedupeSuggestionsByUrl uses tab, shortcut, bookmark, session, history priority', () => {
  const shared = 'https://shared.example/';
  const shortcutWins = 'https://shortcut.example/';
  const bookmarkWins = 'https://bookmark.example/';
  const sessionWins = 'https://session.example/';
  const rows = dedupeSuggestionsByUrl([
    { type: 'history', url: shared, title: 'History' },
    { type: 'session', url: shared, title: 'Session' },
    { type: 'bookmark', url: shared, title: 'Bookmark' },
    { type: 'shortcut', url: shared, title: 'Shortcut' },
    { type: 'tab', url: shared, title: 'Tab' },
    { type: 'history', url: shortcutWins, title: 'History shortcut' },
    { type: 'bookmark', url: shortcutWins, title: 'Bookmark shortcut' },
    { type: 'shortcut', url: shortcutWins, title: 'Shortcut winner' },
    { type: 'history', url: bookmarkWins, title: 'History bookmark' },
    { type: 'session', url: bookmarkWins, title: 'Session bookmark' },
    { type: 'bookmark', url: bookmarkWins, title: 'Bookmark winner' },
    { type: 'history', url: sessionWins, title: 'History session' },
    { type: 'session', url: sessionWins, title: 'Session winner' },
  ]);

  assert.deepEqual(rows.map(row => [row.url, row.type]), [
    [shared, 'tab'],
    [shortcutWins, 'shortcut'],
    [bookmarkWins, 'bookmark'],
    [sessionWins, 'session'],
  ]);
});

test('assembleSuggestions unions all sources and filters by query', () => {
  const out = assembleSuggestions(
    {
      tabs: [{ url: 'https://t.example/', title: 'Open Tab', id: 1 }],
      shortcuts: [{ url: 'https://s.example/', title: 'Quick Link' }],
      bookmarks: [{ id: 'b1', url: 'https://b.example/', title: 'Bookmarked Page', folderPath: 'Work' }],
      sessions: [{ name: 'Sess', tabs: [{ url: 'https://se.example/', title: 'Saved Page' }] }],
      history: [{ url: 'https://h.example/', title: 'Old Page' }],
    },
    'example'
  );
  assert.equal(out.length, 5);
  assert.deepEqual(
    out.map(r => r.type).sort(),
    ['bookmark', 'history', 'session', 'shortcut', 'tab']
  );
});

test('assembleSuggestions removes duplicate URLs across sources', () => {
  const url = 'https://same.example/';
  const out = assembleSuggestions({
    tabs: [{ id: 7, url, title: 'Open copy' }],
    shortcuts: [{ url, label: 'Shortcut copy' }],
    bookmarks: [{ id: 'bookmark-7', url, title: '书签副本', folderPath: '工作' }],
    sessions: [{ name: 'Saved', tabs: [{ url, title: 'Session copy' }] }],
    history: [{ url, title: 'History copy' }],
  }, 'same');

  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'tab');
  assert.equal(out[0].tabId, 7);
});

test('assembleSuggestions filters out non-matching sources', () => {
  const out = assembleSuggestions(
    {
      tabs: [{ url: 'https://t.example/', title: 'Open Tab', id: 1 }],
      shortcuts: [{ url: 'https://s.example/', title: 'Quick Link' }],
      sessions: [{ name: 'Sess', tabs: [{ url: 'https://se.example/', title: 'Saved Page' }] }],
      history: [{ url: 'https://h.example/', title: 'Old Page' }],
    },
    'saved'
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'session');
});
