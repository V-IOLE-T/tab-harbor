'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Mock globals needed at module load time
globalThis.TabHarborI18n = {};

// Prevent top-level DOM code from throwing
globalThis.document = {
  addEventListener: () => {},
  createElement: () => ({ style: {} }),
  getElementById: () => null,
};
globalThis.window = globalThis;

require('./ui-helpers.js');

const {
  friendlyDomain,
  stripTitleNoise,
  cleanTitle,
  smartTitle,
  capitalize,
} = globalThis;

// ---- capitalize ----

test('capitalize uppercases first letter', () => {
  assert.equal(capitalize('github'), 'Github');
  assert.equal(capitalize('hello world'), 'Hello world');
});

test('capitalize handles empty string', () => {
  assert.equal(capitalize(''), '');
});

test('capitalize handles null/undefined', () => {
  assert.equal(capitalize(null), '');
  assert.equal(capitalize(undefined), '');
});

// ---- friendlyDomain ----

test('friendlyDomain returns friendly name for known domains', () => {
  assert.equal(friendlyDomain('github.com'), 'GitHub');
  assert.equal(friendlyDomain('www.github.com'), 'GitHub');
  assert.equal(friendlyDomain('youtube.com'), 'YouTube');
  assert.equal(friendlyDomain('mail.google.com'), 'Gmail');
  assert.equal(friendlyDomain('developer.mozilla.org'), 'MDN');
  assert.equal(friendlyDomain('chatgpt.com'), 'ChatGPT');
  assert.equal(friendlyDomain('claude.ai'), 'Claude');
  assert.equal(friendlyDomain('news.ycombinator.com'), 'Hacker News');
});

test('friendlyDomain handles substack subdomains', () => {
  assert.equal(friendlyDomain('example.substack.com'), "Example's Substack");
});

test('friendlyDomain handles github.io pages', () => {
  assert.equal(friendlyDomain('myproject.github.io'), 'Myproject (GitHub Pages)');
});

test('friendlyDomain strips www and TLD then capitalizes unknown domains', () => {
  assert.equal(friendlyDomain('www.example.org'), 'Example');
  assert.equal(friendlyDomain('mail.somecompany.co.uk'), 'Mail Somecompany');
});

test('friendlyDomain capitalizes multi-part unknown domains', () => {
  assert.equal(friendlyDomain('api.internal.example.com'), 'Api Internal Example');
});

test('friendlyDomain handles empty/null input', () => {
  assert.equal(friendlyDomain(''), '');
  assert.equal(friendlyDomain(null), '');
  assert.equal(friendlyDomain(undefined), '');
});

test('friendlyDomain handles local-files special domain', () => {
  assert.equal(friendlyDomain('local-files'), 'Local Files');
});

// ---- stripTitleNoise ----

test('stripTitleNoise removes notification count prefix', () => {
  assert.equal(stripTitleNoise('(3) GitHub'), 'GitHub');
  assert.equal(stripTitleNoise('(99+) Messages'), 'Messages');
});

test('stripTitleNoise removes inline notification counts', () => {
  assert.equal(stripTitleNoise('Inbox (5+) new'), 'Inbox new');
  assert.equal(stripTitleNoise('Title (1,234)'), 'Title');
});

test('stripTitleNoise removes email noise after dash separators', () => {
  assert.equal(stripTitleNoise('Check - user@example.com'), 'Check');
  assert.equal(stripTitleNoise('Inbox – admin@site.org mail'), 'Inbox mail');
});

test('stripTitleNoise removes bare email addresses', () => {
  assert.equal(stripTitleNoise('Contact user@example.com here'), 'Contact  here');
});

test('stripTitleNoise handles on X: replacement', () => {
  assert.equal(stripTitleNoise('Post on X: hello world'), 'Post: hello world');
});

test('stripTitleNoise strips trailing / X', () => {
  assert.equal(stripTitleNoise('Share / X'), 'Share');
  assert.equal(stripTitleNoise('Article  / X'), 'Article');
});

test('stripTitleNoise returns clean title unchanged', () => {
  assert.equal(stripTitleNoise('Clean Title'), 'Clean Title');
  assert.equal(stripTitleNoise('No noise here'), 'No noise here');
});

test('stripTitleNoise trims whitespace', () => {
  assert.equal(stripTitleNoise('  Title  '), 'Title');
});

test('stripTitleNoise handles empty string', () => {
  assert.equal(stripTitleNoise(''), '');
});

// ---- cleanTitle ----

test('cleanTitle strips suffix when it matches exact domain', () => {
  assert.equal(cleanTitle('My Page - example.com', 'example.com'), 'My Page');
  assert.equal(cleanTitle('Dashboard | example.com', 'www.example.com'), 'Dashboard');
});

test('cleanTitle strips suffix when it matches friendly domain (capitalized)', () => {
  // friendlyDomain('example.com') → 'Example'. suffix 'Example' matches.
  assert.equal(cleanTitle('Dashboard | Example', 'example.com'), 'Dashboard');
});

test('cleanTitle strips suffix when it matches domain without TLD', () => {
  // friendlyDomain('example.com') → 'Example'. suffix 'example' matches domain without .com
  // Title must be >= 5 chars after stripping
  assert.equal(cleanTitle('Welcome Page — example', 'example.com'), 'Welcome Page');
});

test('cleanTitle strips suffix when domain includes suffix', () => {
  assert.equal(cleanTitle('API Reference - api', 'api.example.com'), 'API Reference');
});

test('cleanTitle keeps title when suffix does not match domain', () => {
  assert.equal(cleanTitle('GitHub - awesome-org', 'github.com'), 'GitHub - awesome-org');
  assert.equal(cleanTitle('Random Text | unrelated site', 'example.com'), 'Random Text | unrelated site');
});

test('cleanTitle keeps short cleaned titles (under 5 chars)', () => {
  assert.equal(cleanTitle('AB - example.com', 'example.com'), 'AB - example.com');
});

test('cleanTitle handles all separator types', () => {
  assert.equal(cleanTitle('Title · example.com', 'example.com'), 'Title');
  assert.equal(cleanTitle('Title – example.com', 'example.com'), 'Title');
  assert.equal(cleanTitle('Title — example.com', 'example.com'), 'Title');
});

test('cleanTitle strips www from domain before matching', () => {
  assert.equal(cleanTitle('Page - www.example.com', 'www.example.com'), 'Page - www.example.com');
});

test('cleanTitle handles empty title or hostname', () => {
  assert.equal(cleanTitle('', 'example.com'), '');
  assert.equal(cleanTitle('Title', ''), 'Title');
});

test('cleanTitle handles separator with domain-friendly-includes match', () => {
  // friendlyDomain('example.com') returns 'Example' (stripped TLD + capitalized)
  // 'example.com'.toLowerCase().includes('example') → true ✓
  assert.equal(cleanTitle('Site Name - example', 'example.com'), 'Site Name');
});

test('cleanTitle handles known domain friendly names in suffix matching', () => {
  // friendlyDomain('github.com') returns 'GitHub'
  assert.equal(cleanTitle('My Repos - GitHub', 'github.com'), 'My Repos');
  assert.equal(cleanTitle('Dashboard | GitHub', 'github.com'), 'Dashboard');
});

// ---- smartTitle ----

test('smartTitle returns YouTube Video for youtube watch pages with URL-like title', () => {
  assert.equal(smartTitle('https://www.youtube.com/watch?v=abc', 'https://www.youtube.com/watch?v=abc'), 'YouTube Video');
  assert.equal(smartTitle('', 'https://www.youtube.com/watch?v=abc'), 'YouTube Video');
});

test('smartTitle returns original title for youtube watch with meaningful title', () => {
  assert.equal(smartTitle('Cool Video', 'https://www.youtube.com/watch?v=abc'), 'Cool Video');
});

test('smartTitle returns Post by @username for x.com status URLs with URL-like title', () => {
  assert.equal(smartTitle('https://x.com/jack/status/123', 'https://x.com/jack/status/123'), 'Post by @jack');
  assert.equal(smartTitle('', 'https://twitter.com/elonmusk/status/456'), 'Post by @elonmusk');
});

test('smartTitle returns original title for x.com status with meaningful title', () => {
  assert.equal(smartTitle('Interesting take', 'https://x.com/user/status/789'), 'Interesting take');
});

test('smartTitle returns GitHub issue title for issue URLs with URL-like title', () => {
  assert.equal(
    smartTitle('https://github.com/owner/repo/issues/42', 'https://github.com/owner/repo/issues/42'),
    'owner/repo Issue #42'
  );
});

test('smartTitle returns GitHub PR title for PR URLs with URL-like title', () => {
  assert.equal(
    smartTitle('', 'https://github.com/owner/repo/pull/100'),
    'owner/repo PR #100'
  );
});

test('smartTitle returns URL as title when original title is empty', () => {
  assert.equal(smartTitle('', 'https://www.example.com/path'), 'https://www.example.com/path');
});

test('smartTitle returns title when it is not URL-like', () => {
  assert.equal(smartTitle('My Page Title', 'https://www.example.com'), 'My Page Title');
});

test('smartTitle handles empty URL', () => {
  assert.equal(smartTitle('Title', ''), 'Title');
  assert.equal(smartTitle('', ''), '');
});

test('smartTitle handles invalid URL gracefully', () => {
  assert.equal(smartTitle('', 'not-a-url'), '');
});

test('smartTitle does not treat youtube non-watch pages as video', () => {
  assert.equal(
    smartTitle('', 'https://www.youtube.com/results?search_query=foo'),
    'https://www.youtube.com/results?search_query=foo'
  );
});

test('smartTitle does not mangle title that starts with hostname but is actual text', () => {
  // titleIsUrl checks title.startsWith(hostname) — but the real title is text
  // e.g. "github.com is great" with url "https://github.com"
  const label = smartTitle('github.com is great', 'https://github.com');
  assert.equal(label, 'github.com is great');
});

test('smartTitle handles Reddit post URLs', () => {
  assert.equal(
    smartTitle('https://www.reddit.com/r/programming/comments/abc/title', 'https://www.reddit.com/r/programming/comments/abc/title'),
    'r/programming post'
  );
});

test('capitalize handles empty string', () => {
  assert.equal(capitalize(''), '');
});

test('capitalize handles single character', () => {
  assert.equal(capitalize('a'), 'A');
});