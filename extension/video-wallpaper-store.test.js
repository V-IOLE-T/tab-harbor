'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./wallpaper-test-helpers.cjs');

// Event-driven transaction double: requests succeed before commit, and an
// injected quota abort rolls back the entire transaction after request success.
function database() {
  const records = new Map();
  const state = { abortNext: false, closed: 0, records };
  state.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        objectStoreNames: { contains: () => true },
        close() { state.closed++; },
        transaction(name, mode) {
          const staged = new Map(records);
          let pending = 0; let finished = false; let scheduled = false;
          const tx = {
            abort() {
              if (finished) throw new Error('finished');
              finished = true;
              tx.error = new Error('transaction aborted');
              tx.onabort?.();
            },
            objectStore() {
              const req = operation => {
                pending++;
                const result = {};
                queueMicrotask(() => {
                  result.result = operation();
                  result.onsuccess?.();
                  pending--;
                  schedule();
                });
                return result;
              };
              return {
                put: (value, key) => req(() => { staged.set(key, value); return key; }),
                get: key => req(() => staged.get(key)),
                delete: key => req(() => staged.delete(key)),
              };
            },
          };
          function schedule() {
            if (scheduled) return;
            scheduled = true;
            setImmediate(() => {
              scheduled = false;
              if (finished || pending) return;
              if (mode === 'readwrite' && state.abortNext) {
                state.abortNext = false;
                tx.abort();
              } else {
                finished = true;
                if (mode === 'readwrite') {
                  records.clear(); for (const [k, v] of staged) records.set(k, v);
                }
                tx.oncomplete?.();
              }
            });
          }
          schedule();
          return tx;
        },
      };
      request.onsuccess?.();
    });
    return request;
  } };
  const env = context({ indexedDB: state.indexedDB });
  env.load('video-wallpaper-store.js');
  state.api = env.scope.TabHarborVideoWallpaperStore;
  return state;
}

test('IDB stores blobs under unique immutable identities and reloads the requested resource', async () => {
  const { api } = database();
  const first = await api.saveVideoBlob(new Blob(['first'], { type: 'video/webm' }), { name: 'first.webm' });
  const second = await api.saveVideoBlob(new Blob(['second']), { name: 'second.webm' });
  assert.notEqual(first.resourceId, second.resourceId);
  assert.equal(await (await api.getVideoRecord(first.resourceId)).blob.text(), 'first');
  assert.equal(await (await api.getVideoRecord(second.resourceId)).blob.text(), 'second');
  assert.equal(await api.getVideoRecord('unknown'), null);
  assert.equal(await api.getVideoRecord(), null, 'staging must not replace current');
});

test('quota abort after put success rejects save and preserves the prior video', async () => {
  const state = database(); const { api } = state;
  const first = await api.saveVideoBlob(new Blob(['old']));
  await api.promoteVideoBlob(first.resourceId);
  state.abortNext = true;
  await assert.rejects(api.saveVideoBlob(new Blob(['replacement'])), /abort/);
  assert.equal(await (await api.getVideoRecord()).blob.text(), 'old');
  assert.equal(state.records.size, 2, 'aborted replacement must not survive');
  assert.ok(state.closed >= 4);
});

test('failed preference commit can delete staged media without touching current', async () => {
  const { api } = database();
  const first = await api.saveVideoBlob(new Blob(['old']));
  await api.promoteVideoBlob(first.resourceId);
  const staged = await api.saveVideoBlob(new Blob(['new']));
  await api.clearVideoBlob(staged.resourceId);
  assert.equal(await api.hasVideoBlob(staged.resourceId), false);
  assert.equal(await (await api.getVideoRecord()).blob.text(), 'old');
  await api.clearVideoBlob(first.resourceId);
  assert.equal(await api.getVideoRecord(), null);
});

test('missing resource promotion aborts and does not corrupt current pointer', async () => {
  const { api } = database();
  const meta = await api.saveVideoBlob(new Blob(['old']));
  await api.promoteVideoBlob(meta.resourceId);
  await assert.rejects(api.promoteVideoBlob('missing'), /missing/);
  assert.equal((await api.getVideoRecord()).meta.resourceId, meta.resourceId);
});

test('unavailable IDB degrades reads and rejects writes, and empty blobs are rejected', async () => {
  const env = context(); env.load('video-wallpaper-store.js');
  const api = env.scope.TabHarborVideoWallpaperStore;
  assert.equal(await api.getVideoRecord('missing'), null);
  await assert.rejects(api.saveVideoBlob(new Blob(['video'])), /unavailable/);
  await assert.rejects(api.saveVideoBlob(new Blob([])), /empty/);
});
