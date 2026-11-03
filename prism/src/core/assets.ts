import { getAssetRecord, listAssetRecords, putAsset, removeAssetRecord } from './db';
import type { AssetMeta, AssetRecord, ID } from './types';
import { imageSize, loadImage, uid } from './util';

interface Entry {
  meta: AssetMeta;
  blob: Blob;
  url: string;
  image?: HTMLImageElement;
  poster?: string;
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
  if (entry.meta.kind === 'video') {
    if (entry.poster) {
      const image = new Image();
      image.onload = () => {
        entry.image = image;
        emit();
      };
      image.src = entry.poster;
    }
    return;
  }
  const image = new Image();
  image.onload = () => {
    entry.image = image;
    emit();
  };
  image.src = entry.url;
}

function probeVideo(blob: Blob): Promise<{ width: number; height: number; duration: number; poster: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const fail = (): void => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      reject(new Error('视频无法读取'));
    };
    const capture = (): void => {
      if (settled) return;
      settled = true;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      const scale = Math.min(1, 640 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      let poster = '';
      try {
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        poster = canvas.toDataURL('image/jpeg', 0.8);
      } catch {
        poster = '';
      }
      URL.revokeObjectURL(url);
      resolve({ width, height, duration: Number.isFinite(video.duration) ? video.duration : 0, poster });
    };
    video.onloadedmetadata = () => {
      const target = Number.isFinite(video.duration) ? Math.min(1, video.duration * 0.15) : 0;
      if (target > 0) video.currentTime = target;
      else capture();
    };
    video.onseeked = capture;
    video.onerror = fail;
    video.src = url;
    window.setTimeout(fail, 8000);
  });
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
      if (record.kind === 'video') {
        void probeVideo(record.blob)
          .then((probe) => {
            entry.poster = probe.poster;
            if (!entry.meta.duration) entry.meta.duration = probe.duration;
            attachImage(entry);
            emit();
          })
          .catch(() => {});
      } else {
        attachImage(entry);
      }
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

export function getAssetPoster(id: ID | undefined): string | undefined {
  return id ? entries.get(id)?.poster : undefined;
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
  mode?: string;
}

export async function addAsset(blob: Blob, options: AddAssetOptions = {}): Promise<AssetMeta> {
  const id = uid('a');
  const isVideo = blob.type.startsWith('video/');
  let width = 0;
  let height = 0;
  let duration: number | undefined;
  let poster: string | undefined;
  if (isVideo) {
    try {
      const probe = await probeVideo(blob);
      width = probe.width;
      height = probe.height;
      duration = probe.duration;
      poster = probe.poster;
    } catch {
      width = 1280;
      height = 720;
    }
  } else if (blob.type.startsWith('image/')) {
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
    name: options.name ?? `${isVideo ? '视频' : '图片'} ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
    mime: blob.type || 'application/octet-stream',
    kind: isVideo ? 'video' : 'image',
    width,
    height,
    size: blob.size,
    createdAt: Date.now(),
    source: options.source ?? 'upload',
    duration,
    prompt: options.prompt,
    seed: options.seed,
    model: options.model,
    mode: options.mode,
  };
  const record: AssetRecord = { ...meta, blob };
  await putAsset(record);
  const entry: Entry = { meta, blob, url: URL.createObjectURL(blob), poster };
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
  if (meta.kind === 'video') {
    void probeVideo(blob)
      .then((probe) => {
        entry.poster = probe.poster;
        if (!entry.meta.duration) entry.meta.duration = probe.duration;
        attachImage(entry);
        emit();
      })
      .catch(() => {});
  } else {
    attachImage(entry);
  }
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
    if (entry.meta.kind === 'video') {
      if (!entry.poster) return undefined;
      const image = await loadImage(entry.poster);
      entry.image = image;
      return image;
    }
    const image = await loadImage(entry.url);
    entry.image = image;
    return image;
  } catch {
    return undefined;
  }
}
