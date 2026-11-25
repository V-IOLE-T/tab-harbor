'use strict';

// Media is staged under an immutable resource ID before preferences commit.
// The current pointer is a convenience for legacy callers; dashboard playback
// always reads the ID in preferences, so failed imports cannot replace it.
(function attachVideoWallpaperStore(globalScope) {
  const DB_NAME = 'tab-harbor-media';
  const DB_VERSION = 1;
  const STORE_NAME = 'videos';
  const CURRENT_KEY = 'current';

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!globalScope.indexedDB) return reject(new Error('IndexedDB is unavailable'));
      const request = globalScope.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open media database'));
      request.onblocked = () => reject(new Error('Media database is blocked'));
    });
  }

  async function withStore(mode, run) {
    const db = await openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, mode);
      // A request succeeding does not mean its transaction committed (quota,
      // disk and abort failures can arrive afterwards).
      const committed = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('Media transaction failed'));
      });
      try {
        const [result] = await Promise.all([
          Promise.resolve().then(() => run(tx.objectStore(STORE_NAME))),
          committed,
        ]);
        return result;
      } catch (error) {
        // A callback failure must abort its writes too. Consume the abort
        // rejection before closing so no detached transaction can commit.
        try { tx.abort(); } catch { /* transaction already finished */ }
        await committed.catch(() => {});
        throw error;
      }
    } finally {
      db.close();
    }
  }

  function resourceKey(resourceId) { return `video:${resourceId}`; }

  async function saveVideoBlob(blob, meta = {}) {
    if (!blob || !Number.isFinite(blob.size) || blob.size <= 0) throw new Error('Video blob is empty');
    const resourceId = globalScope.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const record = { blob, meta: {
      resourceId,
      name: String(meta.name || ''),
      type: String(meta.type || blob.type || ''),
      size: blob.size,
      width: Math.round(Number(meta.width) || 0),
      height: Math.round(Number(meta.height) || 0),
      duration: Number(meta.duration) || 0,
      savedAt: new Date().toISOString(),
    } };
    await withStore('readwrite', store => requestToPromise(store.put(record, resourceKey(resourceId))));
    return record.meta;
  }

  async function getVideoRecord(resourceId = '') {
    try {
      return await withStore('readonly', async store => {
        let record = await requestToPromise(store.get(resourceId ? resourceKey(resourceId) : CURRENT_KEY));
        if (record?.resourceId && !record.blob) {
          record = await requestToPromise(store.get(resourceKey(record.resourceId)));
        }
        return record?.blob ? record : null;
      });
    } catch { return null; }
  }

  async function promoteVideoBlob(resourceId) {
    await withStore('readwrite', async store => {
      const record = await requestToPromise(store.get(resourceKey(resourceId)));
      if (!record?.blob) throw new Error('Video resource is missing');
      await requestToPromise(store.put({ resourceId }, CURRENT_KEY));
    });
  }

  async function hasVideoBlob(resourceId) { return (await getVideoRecord(resourceId)) !== null; }

  async function clearVideoBlob(resourceId = '') {
    await withStore('readwrite', async store => {
      if (!resourceId) return requestToPromise(store.delete(CURRENT_KEY));
      const current = await requestToPromise(store.get(CURRENT_KEY));
      await requestToPromise(store.delete(resourceKey(resourceId)));
      if (current?.resourceId === resourceId) await requestToPromise(store.delete(CURRENT_KEY));
    });
    return true;
  }

  const api = { CURRENT_KEY, DB_NAME, DB_VERSION, STORE_NAME, clearVideoBlob,
    getVideoRecord, hasVideoBlob, openDatabase, promoteVideoBlob, saveVideoBlob };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.TabHarborVideoWallpaperStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
