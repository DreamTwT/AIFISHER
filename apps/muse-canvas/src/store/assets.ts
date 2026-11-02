import { blobToDataURL, loadImageSize, readMediaDuration, uid } from '../lib/util';
import type { Asset, AssetMeta, MediaSource } from '../model/types';
import { deleteAsset, getAsset, listAssets, putAsset } from './db';

interface AssetEntry {
  meta: AssetMeta;
  url: string;
  blob: Blob;
}

const entries = new Map<string, AssetEntry>();
const listeners = new Set<() => void>();
let version = 0;

const notify = () => {
  version += 1;
  listeners.forEach((l) => l());
};

export function subscribeAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assetsVersion(): number {
  return version;
}

export function getAssetEntry(id: string | undefined): AssetEntry | undefined {
  return id ? entries.get(id) : undefined;
}

export function getAssetUrl(id: string | undefined): string | undefined {
  return id ? entries.get(id)?.url : undefined;
}

export function getAssetMeta(id: string | undefined): AssetMeta | undefined {
  return id ? entries.get(id)?.meta : undefined;
}

export function getAssetBlob(id: string | undefined): Blob | undefined {
  return id ? entries.get(id)?.blob : undefined;
}

export function listAssetEntries(): AssetEntry[] {
  return [...entries.values()].sort((a, b) => b.meta.createdAt - a.meta.createdAt);
}

export async function hydrateAssets(): Promise<void> {
  try {
    const assets = await listAssets();
    for (const asset of assets) {
      if (entries.has(asset.id)) continue;
      entries.set(asset.id, {
        meta: stripBlob(asset),
        blob: asset.blob,
        url: URL.createObjectURL(asset.blob),
      });
    }
    notify();
  } catch (error) {
    console.warn('[muse] 素材加载失败', error);
  }
}

function stripBlob(asset: Asset): AssetMeta {
  const { blob: _blob, ...meta } = asset;
  return meta;
}

export async function downscaleImage(blob: Blob, maxEdge = 2048): Promise<Blob> {
  if (!blob.type.startsWith('image/')) return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close();
      return blob;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.92),
    );
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

export interface AddAssetOptions {
  name?: string;
  source?: MediaSource;
  prompt?: string;
  model?: string;
  seed?: number;
  /** 已生成的图片可跳过尺寸检测 */
  width?: number;
  height?: number;
  duration?: number;
  keepOriginal?: boolean;
}

export async function addAsset(blob: Blob, options: AddAssetOptions = {}): Promise<AssetMeta> {
  const source = options.source ?? 'upload';
  const keepOriginal = options.keepOriginal ?? true;
  let finalBlob = blob;
  if (!keepOriginal && blob.type.startsWith('image/')) finalBlob = await downscaleImage(blob);

  let width = options.width;
  let height = options.height;
  const duration =
    options.duration ??
    (finalBlob.type.startsWith('audio/') || finalBlob.type.startsWith('video/')
      ? await readMediaDuration(finalBlob, finalBlob.type.startsWith('audio/') ? 'audio' : 'video')
      : undefined);
  if (finalBlob.type.startsWith('image/') && (!width || !height)) {
    try {
      const size = await loadImageSize(finalBlob);
      width = size.width;
      height = size.height;
    } catch {
      width = width ?? 1024;
      height = height ?? 1024;
    }
  }

  const meta: AssetMeta = {
    id: uid('a'),
    name: options.name ?? `素材 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
    mime: finalBlob.type || 'application/octet-stream',
    size: finalBlob.size,
    width,
    height,
    duration,
    createdAt: Date.now(),
    source,
    prompt: options.prompt,
    model: options.model,
    seed: options.seed,
  };
  const asset: Asset = { ...meta, blob: finalBlob };
  await putAsset(asset);
  entries.set(meta.id, { meta, blob: finalBlob, url: URL.createObjectURL(finalBlob) });
  notify();
  return meta;
}

/** 导入工程时保留素材 id，避免重写节点引用 */
export async function importAsset(meta: AssetMeta, blob: Blob): Promise<void> {
  const asset: Asset = { ...meta, blob };
  await putAsset(asset);
  const existing = entries.get(meta.id);
  if (existing) URL.revokeObjectURL(existing.url);
  entries.set(meta.id, { meta, blob, url: URL.createObjectURL(blob) });
  notify();
}

export async function addAssetFromFile(file: File, keepOriginal = true): Promise<AssetMeta> {
  return addAsset(file, { name: file.name.replace(/\.[^.]+$/, ''), source: 'upload', keepOriginal });
}

export async function addAssetFromUrl(url: string, name = '远程素材'): Promise<AssetMeta> {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`下载素材失败（${response.status}）`);
  const blob = await response.blob();
  return addAsset(blob, {
    name,
    source: 'url',
    keepOriginal: false,
  });
}

export async function removeAsset(id: string): Promise<void> {
  const entry = entries.get(id);
  if (entry) URL.revokeObjectURL(entry.url);
  entries.delete(id);
  notify();
  await deleteAsset(id);
}

export async function assetToDataUrl(id: string): Promise<string | null> {
  const entry = entries.get(id);
  if (!entry) {
    const asset = await getAsset(id);
    if (!asset) return null;
    return blobToDataURL(asset.blob);
  }
  return blobToDataURL(entry.blob);
}
