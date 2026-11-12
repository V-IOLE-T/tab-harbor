'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimeJs = fs.readFileSync(path.join(__dirname, 'dashboard-runtime.js'), 'utf8');

function extractFn(source, name) {
  const match = new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!match) throw new Error(`function ${name} not found`);
  const closeParen = source.indexOf(')', match.index);
  let index = source.indexOf('{', closeParen);
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(match.index, index + 1);
}

function extractObjectConst(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`const ${name} not found`);
  let index = source.indexOf('{', start);
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, source.indexOf(';', index) + 1);
}

function deferred() {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
}

function createManualTimer() {
  const timerId = { kind: 'hitokoto-timeout' };
  let callback = null;
  let delay = null;
  let clearCalls = 0;
  return {
    setTimeout(nextCallback, nextDelay) {
      callback = nextCallback;
      delay = nextDelay;
      return timerId;
    },
    clearTimeout(clearedTimerId) {
      assert.equal(clearedTimerId, timerId);
      clearCalls += 1;
    },
    fire() {
      assert.equal(typeof callback, 'function');
      callback();
    },
    getDelay: () => delay,
    getClearCalls: () => clearCalls,
  };
}

function createFetchHitokotoHarness(fetchImpl, timer = createManualTimer()) {
  const source = `${extractFn(runtimeJs, 'fetchHitokoto')}\nreturn fetchHitokoto;`;
  const fetchHitokoto = new Function(
    'fetch',
    'AbortController',
    'setTimeout',
    'clearTimeout',
    source,
  )(
    fetchImpl,
    AbortController,
    timer.setTimeout,
    timer.clearTimeout,
  );
  return { fetchHitokoto, timer };
}

function createStorage(initialEntries = []) {
  let rawValue = JSON.stringify(initialEntries);
  let readCount = 0;
  return {
    api: {
      getItem() {
        readCount += 1;
        return rawValue;
      },
      setItem(_key, value) {
        rawValue = String(value);
      },
    },
    getEntries() {
      return JSON.parse(rawValue);
    },
    getReadCount() {
      return readCount;
    },
    replace(entries) {
      rawValue = JSON.stringify(entries);
    },
  };
}

function createHarness({ storage, enabled = true, fetchQueue = [] } = {}) {
  const cache = storage || createStorage();
  const writes = { text: 0, from: 0 };
  const hitokotoEl = { style: { display: 'unset' } };
  let textValue = '';
  let fromValue = '';
  const textEl = {
    get textContent() { return textValue; },
    set textContent(value) {
      writes.text += 1;
      textValue = String(value);
    },
  };
  const fromEl = {
    get textContent() { return fromValue; },
    set textContent(value) {
      writes.from += 1;
      fromValue = String(value);
    },
  };
  const elements = {
    hitokoto: hitokotoEl,
    hitokotoText: textEl,
    hitokotoFrom: fromEl,
  };
  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
  };
  let fetchCalls = 0;
  const fetchHitokoto = () => {
    fetchCalls += 1;
    const next = fetchQueue.shift();
    return next?.promise || Promise.resolve(null);
  };

  const functionNames = [
    'normalizeHitokotoEntry',
    'getHitokotoCache',
    'saveHitokotoCache',
    'addHitokotoToCache',
    'setHitokotoContent',
    'lockHitokotoForCurrentPage',
    'renderCachedHitokoto',
    'warmHitokotoCacheInBackground',
    'syncHitokotoForCurrentPage',
  ];
  const source = `
    const HITOKOTO_CACHE_KEY = 'hitokotoCache';
    const HITOKOTO_CACHE_LIMIT = 5;
    ${extractObjectConst(runtimeJs, 'hitokotoPageState')}
    let themePreferences = { hitokotoEnabled: initialEnabled };
    ${functionNames.map(name => extractFn(runtimeJs, name)).join('\n')}
    return {
      getState: () => hitokotoPageState,
      setEnabled: value => { themePreferences.hitokotoEnabled = value === true; },
      sync: syncHitokotoForCurrentPage,
      warm: warmHitokotoCacheInBackground,
    };
  `;
  const lifecycle = new Function(
    'localStorage',
    'document',
    'fetchHitokoto',
    'initialEnabled',
    source,
  )(cache.api, document, fetchHitokoto, enabled);

  return {
    ...lifecycle,
    cache,
    getFetchCalls: () => fetchCalls,
    hitokotoEl,
    textEl,
    fromEl,
    writes,
  };
}

test('hitokoto locks the cached entry once and background warm never replaces current page text', async () => {
  const warm = deferred();
  const cache = createStorage([{ hitokoto: 'Locked', from: 'Cache' }]);
  const page = createHarness({ storage: cache, fetchQueue: [warm] });

  assert.equal(page.sync(), true);
  assert.equal(page.textEl.textContent, 'Locked');
  assert.equal(page.fromEl.textContent, ' — Cache');
  assert.equal(page.cache.getReadCount(), 1);
  assert.equal(page.getFetchCalls(), 1);
  assert.deepEqual(page.writes, { text: 1, from: 1 });

  cache.replace([{ hitokoto: 'External storage change' }]);
  page.sync();
  assert.equal(page.textEl.textContent, 'Locked');
  assert.equal(page.cache.getReadCount(), 1);
  assert.deepEqual(page.writes, { text: 1, from: 1 });

  warm.resolve({ hitokoto: 'For the next tab', from: 'Network' });
  await page.getState().warmPromise;
  page.sync();

  assert.equal(page.textEl.textContent, 'Locked');
  assert.equal(page.getFetchCalls(), 1);
  assert.equal(page.cache.getReadCount(), 2, 'the extra read only deduplicates the warmed cache');
  assert.deepEqual(page.writes, { text: 1, from: 1 });
  assert.equal(cache.getEntries()[0].hitokoto, 'For the next tab');
});

test('hitokoto toggle hides and restores the same page-locked entry', () => {
  const warm = deferred();
  const cache = createStorage([{ hitokoto: 'Stay with this page', from_who: 'Author' }]);
  const page = createHarness({ storage: cache, enabled: false, fetchQueue: [warm] });

  assert.equal(page.sync(), false);
  assert.equal(page.hitokotoEl.style.display, 'none');
  assert.equal(page.cache.getReadCount(), 1);
  assert.deepEqual(page.writes, { text: 0, from: 0 });

  cache.replace([{ hitokoto: 'Newer cache value' }]);
  page.setEnabled(true);
  assert.equal(page.sync(), true);
  assert.equal(page.textEl.textContent, 'Stay with this page');
  assert.equal(page.hitokotoEl.style.display, '');
  assert.equal(page.getFetchCalls(), 1);

  page.setEnabled(false);
  page.sync();
  assert.equal(page.hitokotoEl.style.display, 'none');
  assert.equal(page.textEl.textContent, 'Stay with this page');

  page.setEnabled(true);
  page.sync();
  assert.equal(page.hitokotoEl.style.display, '');
  assert.equal(page.textEl.textContent, 'Stay with this page');
  assert.equal(page.cache.getReadCount(), 1);
  assert.equal(page.getFetchCalls(), 1);
  assert.deepEqual(page.writes, { text: 1, from: 1 });
});

test('empty hitokoto cache stays empty in current page and warm only seeds the next page', async () => {
  const warm = deferred();
  const cache = createStorage([]);
  const currentPage = createHarness({ storage: cache, fetchQueue: [warm] });

  assert.equal(currentPage.sync(), false);
  currentPage.sync();
  assert.equal(currentPage.getFetchCalls(), 1);
  assert.equal(currentPage.textEl.textContent, '');
  assert.equal(currentPage.getState().locked, true);
  assert.equal(currentPage.getState().entry, null);

  warm.resolve({ hitokoto: 'Available to a later tab', from: 'Warm cache' });
  await currentPage.getState().warmPromise;
  currentPage.sync();
  assert.equal(currentPage.textEl.textContent, '');
  assert.deepEqual(currentPage.writes, { text: 0, from: 0 });
  assert.equal(currentPage.getFetchCalls(), 1);

  const nextWarm = deferred();
  const nextPage = createHarness({ storage: cache, fetchQueue: [nextWarm] });
  assert.equal(nextPage.sync(), true);
  assert.equal(nextPage.textEl.textContent, 'Available to a later tab');
  assert.equal(currentPage.textEl.textContent, '');
});

test('fetchHitokoto clears its timeout after success and fetch rejection', async () => {
  const success = createFetchHitokotoHarness(async () => ({
    ok: true,
    json: async () => ({ hitokoto: 'Network entry' }),
  }));
  assert.deepEqual(await success.fetchHitokoto(125), { hitokoto: 'Network entry' });
  assert.equal(success.timer.getDelay(), 125);
  assert.equal(success.timer.getClearCalls(), 1);

  const rejected = createFetchHitokotoHarness(async () => {
    throw new Error('network unavailable');
  });
  assert.equal(await rejected.fetchHitokoto(250), null);
  assert.equal(rejected.timer.getDelay(), 250);
  assert.equal(rejected.timer.getClearCalls(), 1);
});

test('fetchHitokoto timeout remains active until response JSON finishes', async () => {
  const bodyStarted = deferred();
  let requestSignal = null;
  const request = createFetchHitokotoHarness(async (_url, options = {}) => {
    requestSignal = options.signal;
    return {
      ok: true,
      json() {
        bodyStarted.resolve();
        return new Promise((_resolve, reject) => {
          requestSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    };
  });

  const resultPromise = request.fetchHitokoto(375);
  await bodyStarted.promise;
  assert.equal(request.timer.getClearCalls(), 0, 'the timeout must remain armed while the body is pending');
  request.timer.fire();

  assert.equal(await resultPromise, null);
  assert.equal(requestSignal.aborted, true);
  assert.equal(request.timer.getDelay(), 375);
  assert.equal(request.timer.getClearCalls(), 1);
});
