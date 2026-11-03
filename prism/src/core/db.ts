import type { AssetMeta, AssetRecord, ID, Project } from './types';

const DB_NAME = 'prism-studio';
const LEGACY_DBS = ['relay-studio', 'jacquard-studio', 'weft-studio'];
const DB_VERSION = 1;
const PROJECTS = 'projects';
const ASSETS = 'assets';

let dbPromise: Promise<IDBDatabase> | null = null;

function openNamed(name: string, version: number | undefined, seed: boolean): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      if (!seed) return;
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) {
        const store = db.createObjectStore(PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(ASSETS)) {
        db.createObjectStore(ASSETS, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'));
  });
}

/** 早期版本先后叫 WEFT、JACQUARD、RELAY。第一次打开新库时把旧项目与图片搬过来，避免换名字丢数据。 */
async function migrateLegacy(db: IDBDatabase): Promise<void> {
  if (!indexedDB.databases) return;
  try {
    const databases = await indexedDB.databases();
    for (const legacyName of LEGACY_DBS) {
      if (!databases.some((item) => item.name === legacyName)) continue;
      const legacy = await openNamed(legacyName, undefined, false);
      try {
        for (const storeName of [PROJECTS, ASSETS]) {
          if (!legacy.objectStoreNames.contains(storeName)) continue;
          const count = await finish(db.transaction(storeName).objectStore(storeName).count());
          if (count > 0) continue;
          const rows = await finish(
            legacy.transaction(storeName).objectStore(storeName).getAll() as IDBRequest<unknown[]>,
          );
          if (!rows.length) continue;
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            rows.forEach((row) => store.put(row));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('旧数据迁移失败'));
            tx.onabort = () => reject(tx.error ?? new Error('旧数据迁移中止'));
          });
        }
      } finally {
        legacy.close();
      }
    }
  } catch (error) {
    console.warn('[prism] 旧数据库迁移失败', error);
  }
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openNamed(DB_NAME, DB_VERSION, true).then(async (db) => {
    await migrateLegacy(db);
    return db;
  });
  return dbPromise;
}

function finish<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('数据库操作失败'));
  });
}

export async function putProject(project: Project): Promise<void> {
  const db = await open();
  await finish(db.transaction(PROJECTS, 'readwrite').objectStore(PROJECTS).put(project));
}

export async function listProjects(): Promise<Project[]> {
  const db = await open();
  const all = await finish(db.transaction(PROJECTS).objectStore(PROJECTS).getAll() as IDBRequest<Project[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: ID): Promise<Project | undefined> {
  const db = await open();
  return finish(db.transaction(PROJECTS).objectStore(PROJECTS).get(id) as IDBRequest<Project | undefined>);
}

export async function removeProject(id: ID): Promise<void> {
  const db = await open();
  await finish(db.transaction(PROJECTS, 'readwrite').objectStore(PROJECTS).delete(id));
}

export async function putAsset(record: AssetRecord): Promise<void> {
  const db = await open();
  await finish(db.transaction(ASSETS, 'readwrite').objectStore(ASSETS).put(record));
}

export async function listAssetRecords(): Promise<AssetRecord[]> {
  const db = await open();
  const all = await finish(
    db.transaction(ASSETS).objectStore(ASSETS).getAll() as IDBRequest<AssetRecord[]>,
  );
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getAssetRecord(id: ID): Promise<AssetRecord | undefined> {
  const db = await open();
  return finish(db.transaction(ASSETS).objectStore(ASSETS).get(id) as IDBRequest<AssetRecord | undefined>);
}

export async function removeAssetRecord(id: ID): Promise<void> {
  const db = await open();
  await finish(db.transaction(ASSETS, 'readwrite').objectStore(ASSETS).delete(id));
}

export function assetMeta(record: AssetRecord): AssetMeta {
  const { blob: _blob, ...meta } = record;
  return meta;
}
