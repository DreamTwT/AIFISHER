import { normalizeDoc, normalizeCamera } from '../model/schema';
import type { Asset, Camera, CanvasDoc, ID, Project, ProjectMeta } from '../model/types';

const DB_NAME = 'muse-canvas';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_DOCS = 'documents';
const STORE_ASSETS = 'assets';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_DOCS)) db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        const store = db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'));
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('数据库操作失败'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('数据库事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('数据库事务取消'));
  });
}

interface ProjectRecord extends ProjectMeta {
  camera?: Camera;
}

interface DocRecord {
  id: ID;
  doc: CanvasDoc;
  camera: Camera;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_PROJECTS, 'readonly');
  const records = await requestToPromise(tx.objectStore(STORE_PROJECTS).getAll() as IDBRequest<ProjectRecord[]>);
  await txDone(tx);
  return records
    .map(({ camera: _camera, ...meta }) => meta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: ID): Promise<Project | null> {
  const db = await openDb();
  const tx = db.transaction([STORE_PROJECTS, STORE_DOCS], 'readonly');
  const meta = await requestToPromise(
    tx.objectStore(STORE_PROJECTS).get(id) as IDBRequest<ProjectRecord | undefined>,
  );
  const docRecord = await requestToPromise(
    tx.objectStore(STORE_DOCS).get(id) as IDBRequest<DocRecord | undefined>,
  );
  await txDone(tx);
  if (!meta || !docRecord) return null;
  return {
    ...meta,
    doc: normalizeDoc(docRecord.doc),
    camera: normalizeCamera(docRecord.camera),
  };
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_PROJECTS, STORE_DOCS], 'readwrite');
  const meta: ProjectRecord = {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    nodeCount: project.doc.nodes.length,
    thumbnail: project.thumbnail,
  };
  tx.objectStore(STORE_PROJECTS).put(meta);
  tx.objectStore(STORE_DOCS).put({ id: project.id, doc: project.doc, camera: project.camera });
  await txDone(tx);
}

export async function deleteProject(id: ID): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_PROJECTS, STORE_DOCS], 'readwrite');
  tx.objectStore(STORE_PROJECTS).delete(id);
  tx.objectStore(STORE_DOCS).delete(id);
  await txDone(tx);
}

export async function putAsset(asset: Asset): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_ASSETS, 'readwrite');
  tx.objectStore(STORE_ASSETS).put(asset);
  await txDone(tx);
}

export async function getAsset(id: ID): Promise<Asset | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_ASSETS, 'readonly');
  const asset = await requestToPromise(tx.objectStore(STORE_ASSETS).get(id) as IDBRequest<Asset | undefined>);
  await txDone(tx);
  return asset ?? null;
}

export async function listAssets(): Promise<Asset[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_ASSETS, 'readonly');
  const assets = await requestToPromise(tx.objectStore(STORE_ASSETS).getAll() as IDBRequest<Asset[]>);
  await txDone(tx);
  return assets.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteAsset(id: ID): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_ASSETS, 'readwrite');
  tx.objectStore(STORE_ASSETS).delete(id);
  await txDone(tx);
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_PROJECTS, STORE_DOCS, STORE_ASSETS], 'readwrite');
  tx.objectStore(STORE_PROJECTS).clear();
  tx.objectStore(STORE_DOCS).clear();
  tx.objectStore(STORE_ASSETS).clear();
  await txDone(tx);
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
