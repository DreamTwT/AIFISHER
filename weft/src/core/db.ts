import type { AssetMeta, AssetRecord, ID, Project } from './types';

const DB_NAME = 'weft-studio';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const ASSETS = 'assets';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
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
