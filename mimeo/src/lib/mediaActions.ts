import { getEditor } from '../store/editor';
import { getAssetBlob, getAssetMeta } from '../store/assets';
import { toast } from '../store/ui';
import { downloadBlob } from './util';
import { insertNodeAtViewportCenter } from './insert';

export function addMediaNodeFromAsset(assetId: string) {
  const meta = getAssetMeta(assetId);
  if (!meta) return;
  const kind = meta.mime.startsWith('video/') ? 'video' : meta.mime.startsWith('audio/') ? 'audio' : 'image';
  const w = 360;
  const h =
    kind === 'image' && meta.width && meta.height
      ? Math.round(36 + Math.min(560, Math.max(160, (w * meta.height) / meta.width)))
      : kind === 'video'
        ? 300
        : 190;
  const node = insertNodeAtViewportCenter(kind, { w, h });
  getEditor().patchNode(node.id, { assetId, source: meta.source }, { label: '插入素材' });
}

export async function downloadAsset(assetId: string) {
  const blob = getAssetBlob(assetId);
  const meta = getAssetMeta(assetId);
  if (!blob) {
    toast('素材不可用', 'error');
    return;
  }
  const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
  downloadBlob(blob, `${meta?.name || 'asset'}.${ext}`);
}
