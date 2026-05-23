'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escapeHtmlAttribute,
  getFallbackLabel,
  getPageOriginFaviconUrl,
  getGoogleFaviconUrl,
  getGroupIcon,
  getPrimaryDomain,
  getIconSources,
  getFaviconUrl,
} = require('./icon-utils.js');

test('getIconSources prefers real favicon before domain fallback', () => {
  const iconData = getIconSources({
    favIconUrl: 'https://example.com/favicon.ico',
    url: 'https://www.example.com/page',
  }, 32);

  assert.equal(iconData.hostname, 'www.example.com');
  assert.equal(iconData.primaryDomain, 'example.com');
  assert.deepEqual(iconData.sources, [
    'https://example.com/favicon.ico',
    'https://www.example.com/favicon.ico',
    'https://www.google.com/s2/favicons?domain=example.com&sz=32',
    'https://www.google.com/s2/favicons?domain=www.example.com&sz=32',
  ]);
});

test('getGroupIcon falls back to google favicon when tab has no real favicon', () => {
  const iconData = getGroupIcon({
    tabs: [{ url: 'https://chatgpt.com/c/test' }],
  }, 'ChatGPT', 32);

  assert.equal(iconData.src, 'https://chatgpt.com/favicon.ico');
  assert.equal(iconData.fallbackSrc, 'https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32');
  assert.equal(iconData.fallbackLabel, 'C');
});

test('getFallbackLabel derives stable initials from labels and hosts', () => {
  assert.equal(getFallbackLabel('GitHub Issues', 'github.com'), 'GI');
  assert.equal(getFallbackLabel('', 'www.wikipedia.org'), 'WI');
  assert.equal(getGoogleFaviconUrl('github.com', 16), 'https://www.google.com/s2/favicons?domain=github.com&sz=16');
  assert.equal(getPageOriginFaviconUrl('https://www.ict.ac.cn/yjsjy/zsxx/sszs/202605/t20260511_8199682.html'), 'https://www.ict.ac.cn/favicon.ico');
});

test('getPrimaryDomain collapses regular subdomains but preserves common hosted tenants', () => {
  assert.equal(getPrimaryDomain('foo.example.com'), 'example.com');
  assert.equal(getPrimaryDomain('foo.bar.example.co.uk'), 'example.co.uk');
  assert.equal(getPrimaryDomain('ict.ac.cn'), 'ict.ac.cn');
  assert.equal(getPrimaryDomain('myproject.github.io'), 'myproject.github.io');
  assert.equal(getPrimaryDomain('writer.substack.com'), 'writer.substack.com');
});

test('getIconSources skips unstable browser internal favicon urls', () => {
  const iconData = getIconSources({
    favIconUrl: 'chrome://favicon2/?pageUrl=https%3A%2F%2Fwww.ict.ac.cn',
    url: 'https://www.ict.ac.cn/yjsjy/zsxx/sszs/202605/t20260511_8199682.html',
  }, 32);

  assert.deepEqual(iconData.sources, [
    'https://www.ict.ac.cn/favicon.ico',
    'https://www.google.com/s2/favicons?domain=ict.ac.cn&sz=32',
    'https://www.google.com/s2/favicons?domain=www.ict.ac.cn&sz=32',
  ]);
});

test('getFaviconUrl builds fallback URL from URL string input (no chrome runtime)', () => {
  const result = getFaviconUrl('https://www.example.com/page');
  assert.equal(result.source, '');
  assert.equal(result.url, '');
  assert.equal(result.fallback, 'https://www.example.com/favicon.ico');
});

test('getFaviconUrl returns empty result for empty input', () => {
  const result = getFaviconUrl({});
  assert.equal(result.url, '');
  assert.equal(result.source, '');
  assert.equal(result.fallback, '');
});

test('getFaviconUrl returns empty result for non-HTTP URL', () => {
  const result = getFaviconUrl('chrome://extensions/');
  assert.equal(result.url, '');
  assert.equal(result.source, '');
  assert.equal(result.fallback, '');
});

test('getFaviconUrl builds fallback URL from options object', () => {
  const result = getFaviconUrl({ domain: 'github.com', size: 64 });
  assert.equal(result.fallback, 'https://github.com/favicon.ico');
});

test('getFaviconUrl defaults size to 128 for string input', () => {
  const result = getFaviconUrl('https://example.com');
  assert.ok(result.url === '' || result.url.includes('size=128'),
    'Chrome URL should use size=128 when available');
});

test('getFaviconUrl respects custom size in options', () => {
  const result = getFaviconUrl({ domain: 'example.com', size: 32 });
  assert.ok(result.url === '' || result.url.includes('size=32'),
    'Chrome URL should use custom size when available');
});

test('getFaviconUrl generates chrome _favicon URL when chrome runtime is available', () => {
  const savedGetURL = globalThis.chrome?.runtime?.getURL;
  globalThis.chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://abc/${path}`,
    },
  };
  try {
    const result = getFaviconUrl({ domain: 'https://example.com/path', size: 32 });
    assert.ok(result.url.startsWith('chrome-extension://abc/_favicon/'), 'Chrome URL should use _favicon path');
    assert.ok(result.url.includes('pageUrl='), 'Chrome URL should include pageUrl param');
    assert.ok(result.url.includes('size=32'), 'Chrome URL should include size param');
    assert.equal(result.fallback, 'https://example.com/favicon.ico');
  } finally {
    if (savedGetURL) {
      globalThis.chrome = { runtime: { getURL: savedGetURL } };
    } else {
      delete globalThis.chrome;
    }
  }
});

test('escapeHtmlAttribute protects custom tooltip text', () => {
  assert.equal(
    escapeHtmlAttribute('ChatGPT "Projects" & Notes'),
    'ChatGPT &quot;Projects&quot; &amp; Notes'
  );
});
