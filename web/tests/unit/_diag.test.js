import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

describe('诊断：fake-indexeddb 是否注入', () => {
  it('indexedDB 存在', () => {
    expect(typeof indexedDB).toBe('object');
    expect(indexedDB).not.toBeUndefined();
  });

  it('IDBKeyRange 存在', () => {
    expect(typeof IDBKeyRange).not.toBeUndefined();
  });

  it('open + 简单读写', async () => {
    const req = indexedDB.open('diag', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('items', { keyPath: 'id' });
    };
    const db = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(db).toBeTruthy();
    expect(db.objectStoreNames.contains('items')).toBe(true);

    // 写入
    await new Promise((resolve, reject) => {
      const tx = db.transaction('items', 'readwrite');
      tx.objectStore('items').put({ id: 1, name: 'A' });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // 读取
    const got = await new Promise((resolve, reject) => {
      const r = db.transaction('items', 'readonly').objectStore('items').get(1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    expect(got).toEqual({ id: 1, name: 'A' });

    db.close();
  });

  it('deleteDatabase 能 resolve', async () => {
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase('diag');
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      r.onblocked = () => resolve();
    });
    expect(true).toBe(true);
  });
});
