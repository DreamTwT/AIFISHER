import { getAssetRecord, listAssetRecords, putAsset, removeAssetRecord } from './db';
import type { AssetMeta, AssetRecord, ID } from './types';
import { imageSize, loadImage, uid } from './util';

interface Entry {
  meta: AssetMeta;
  blob: Blob;
  url: string;
  image?: HTMLImageElement;
}

const entries = new Map<ID, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function subscribeAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assetsVersion(): number {
  return version;
}

function attachImage(entry: Entry): void {
  if (entry.image) return;
  const image = new Image();
  image.onload = () => {
    entry.image = image;
    emit();
  };
  image.src = entry.url;
}

export async function hydrateAssets(): Promise<void> {
  try {
    const records = await listAssetRecords();
    for (const record of records) {
      if (entries.has(record.id)) continue;
      const entry: Entry = {
        meta: record,
        blob: record.blob,
        url: URL.createObjectURL(record.blob),
      };
      entries.set(record.id, entry);
      attachImage(entry);
    }
    emit();
  } catch (error) {
    console.warn('[prism] 素材读取失败', error);
  }
}

export function allAssets(): AssetMeta[] {
  return [...entries.values()].map((entry) => entry.meta).sort((a, b) => b.createdAt - a.createdAt);
}

export function getAssetMeta(id: ID | undefined): AssetMeta | undefined {
  return id ? entries.get(id)?.meta : undefined;
}

export function getAssetUrl(id: ID | undefined): string | undefined {
  return id ? entries.get(id)?.url : undefined;
}

export function getAssetImage(id: ID | undefined): HTMLImageElement | undefined {
  return id ? entries.get(id)?.image : undefined;
}

export function getAssetBlob(id: ID | undefined): Blob | undefined {
  return id ? entries.get(id)?.blob : undefined;
}

export async function readAssetBlob(id: ID): Promise<Blob | undefined> {
  const local = entries.get(id);
  if (local) return local.blob;
  return (await getAssetRecord(id))?.blob;
}

export interface AddAssetOptions {
  name?: string;
  prompt?: string;
  seed?: number;
  model?: string;
  source?: 'upload' | 'render';
}

export async function addAsset(blob: Blob, options: AddAssetOptions = {}): Promise<AssetMeta> {
  const id = uid('a');
  let width = 0;
  let height = 0;
  if (blob.type.startsWith('image/')) {
    try {
      const size = await imageSize(blob);
      width = size.width;
      height = size.height;
    } catch {
      width = 1024;
      height = 1024;
    }
  }
  const meta: AssetMeta = {
    id,
    name: options.name ?? `图片 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
    mime: blob.type || 'application/octet-stream',
    width,
    height,
    size: blob.size,
    createdAt: Date.now(),
    source: options.source ?? 'upload',
    prompt: options.prompt,
    seed: options.seed,
    model: options.model,
  };
  const record: AssetRecord = { ...meta, blob };
  await putAsset(record);
  const entry: Entry = { meta, blob, url: URL.createObjectURL(blob) };
  entries.set(id, entry);
  attachImage(entry);
  emit();
  return meta;
}

export async function importAsset(meta: AssetMeta, blob: Blob): Promise<void> {
  if (entries.has(meta.id)) return;
  const record: AssetRecord = { ...meta, blob };
  await putAsset(record);
  const entry: Entry = { meta, blob, url: URL.createObjectURL(blob) };
  entries.set(meta.id, entry);
  attachImage(entry);
  emit();
}

export async function removeAsset(id: ID): Promise<void> {
  await removeAssetRecord(id);
  const entry = entries.get(id);
  if (entry) {
    URL.revokeObjectURL(entry.url);
    entries.delete(id);
  }
  emit();
}

export async function assetToImage(id: ID): Promise<HTMLImageElement | undefined> {
  const entry = entries.get(id);
  if (!entry) return undefined;
  if (entry.image) return entry.image;
  attachImage(entry);
  try {
    const image = await loadImage(entry.url);
    entry.image = image;
    return image;
  } catch {
    return undefined;
  }
}
