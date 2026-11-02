import { assetToImage, getAssetBlob, getAssetImage, getAssetMeta, importAsset } from '../core/assets';
import type { Editor } from '../core/editor';
import { contentBounds } from '../core/geometry';
import { paintScene } from '../core/paint';
import { collectAssetIds, normalizeImported, type ProjectAsset, type ProjectFile } from '../core/schema';
import type { ID, SceneNode } from '../core/types';
import { blobToDataURL, canvasBlob, dataURLToBlob, downloadBlob, downloadText, timestampName } from '../core/util';

export async function exportProject(editor: Editor): Promise<void> {
  const assets: ProjectAsset[] = [];
  for (const assetId of collectAssetIds(editor.doc)) {
    const blob = getAssetBlob(assetId);
    const meta = getAssetMeta(assetId);
    if (!blob || !meta) continue;
    assets.push({ meta, data: await blobToDataURL(blob) });
  }
  const file: ProjectFile = {
    format: 'jacquard-project',
    version: 1,
    exportedAt: Date.now(),
    project: editor.project,
    assets,
  };
  downloadText(JSON.stringify(file, null, 2), `${timestampName('jacquard')}.json`);
}

export async function importProject(editor: Editor, file: File): Promise<void> {
  const raw = JSON.parse(await file.text()) as Record<string, unknown>;
  const normalized = normalizeImported(raw);
  for (const asset of normalized.assets) {
    try {
      const blob = await dataURLToBlob(asset.data);
      const meta = { ...asset.meta, size: blob.size || asset.meta.size };
      await importAsset(meta, blob);
    } catch (error) {
      console.warn('[jacquard] 布样导入失败', asset.meta.name, error);
    }
  }
  editor.load(normalized.project);
}

export function exportCanvas(editor: Editor, view: { width: number; height: number }): void {
  const bounds = contentBounds(editor.doc.nodes);
  const pad = 96;
  const sourceW = Math.max(640, bounds.w + pad * 2);
  const sourceH = Math.max(480, bounds.h + pad * 2);
  const scale = Math.min(2, 4096 / sourceW, 4096 / sourceH);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sourceW * scale);
  canvas.height = Math.round(sourceH * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const camera = {
    x: (pad - bounds.x) * scale,
    y: (pad - bounds.y) * scale,
    z: scale,
  };
  paintScene(ctx, {
    doc: editor.doc,
    camera,
    width: canvas.width,
    height: canvas.height,
    selection: new Set(),
    threadSelection: new Set(),
    grid: false,
    showGroups: false,
    getImage: (id) => getAssetImage(id),
  });
  canvasBlob(canvas).then((blob) => {
    downloadBlob(blob, `${timestampName('jacquard-canvas')}.png`);
  });
  void view;
}

export function collectIncomingAssets(editor: Editor, node: SceneNode): ID[] {
  const ids: ID[] = [];
  for (const thread of editor.doc.threads) {
    if (thread.to !== node.id) continue;
    const source = editor.node(thread.from);
    if (!source) continue;
    if (source.kind === 'image' && source.assetId) ids.push(source.assetId);
    if (source.kind === 'render') ids.push(...source.assetIds);
  }
  return ids;
}

export async function exportWeave(editor: Editor, node: SceneNode): Promise<void> {
  if (node.kind !== 'weave') return;
  const ids = collectIncomingAssets(editor, node);
  const images = await Promise.all(ids.map((id) => assetToImage(id)));
  const width = 1700;
  const pad = 90;
  const columns = Math.max(1, Math.min(4, node.columns));
  const gap = Math.max(6, node.gap * 1.6);
  const cellW = (width - pad * 2 - gap * (columns - 1)) / columns;
  const cellH = cellW * 1.18;
  const rows = Math.max(1, Math.ceil(Math.max(1, images.length) / columns));
  const headerH = 168;
  const footerH = 112;
  const height = headerH + rows * cellH + (rows - 1) * gap + footerH;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ece3d1';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(30, 36, 30, 0.14)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, canvas.height);
    ctx.stroke();
  }

  ctx.fillStyle = '#141a15';
  ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
  ctx.fillText('JACQUARD / 提花', pad, 58);
  ctx.font = '600 34px Inter, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(node.caption || node.title || '织片', pad, 102);
  ctx.font = '11px ui-monospace, "Noto Sans SC", monospace';
  ctx.fillStyle = 'rgba(20, 26, 21, 0.56)';
  ctx.fillText(`${editor.project.name}  ·  ${images.length} 张布样  ·  ${new Date().toLocaleDateString('zh-CN')}`, pad, 130);
  ctx.strokeStyle = 'rgba(20, 26, 21, 0.5)';
  ctx.beginPath();
  ctx.moveTo(pad, 148.5);
  ctx.lineTo(width - pad, 148.5);
  ctx.stroke();

  for (let index = 0; index < Math.max(1, images.length); index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = pad + col * (cellW + gap);
    const y = headerH + row * (cellH + gap);
    ctx.fillStyle = '#d6c9ae';
    ctx.fillRect(x, y, cellW, cellH);
    const image = images[index];
    if (image) drawCover(ctx, image, x, y, cellW, cellH);
    ctx.fillStyle = 'rgba(20, 26, 21, 0.62)';
    ctx.font = '10px ui-monospace, "Noto Sans SC", monospace';
    ctx.fillText(String(index + 1).padStart(2, '0'), x, y + cellH - 14);
  }

  if (!images.length) {
    ctx.fillStyle = 'rgba(20, 26, 21, 0.4)';
    ctx.font = '14px Inter, "PingFang SC", sans-serif';
    ctx.fillText('这块织片还没有接上布样。', pad, headerH + 80);
  }

  const footY = canvas.height - footerH / 2;
  ctx.strokeStyle = 'rgba(20, 26, 21, 0.3)';
  ctx.beginPath();
  ctx.moveTo(pad, footY - 30);
  ctx.lineTo(width - pad, footY - 30);
  ctx.stroke();
  ctx.fillStyle = 'rgba(20, 26, 21, 0.52)';
  ctx.font = '10px ui-monospace, "Noto Sans SC", monospace';
  ctx.fillText('WOVEN ON JACQUARD', pad, footY);
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toISOString().slice(0, 10), width - pad, footY);
  ctx.textAlign = 'left';

  const blob = await canvasBlob(canvas);
  downloadBlob(blob, `${timestampName('jacquard-weave')}.png`);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(
    image,
    (image.naturalWidth - sw) / 2,
    (image.naturalHeight - sh) / 2,
    sw,
    sh,
    x,
    y,
    w,
    h,
  );
}
