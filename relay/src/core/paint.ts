import type { Camera, Doc, Group, ID, Point, Rect, SceneNode, Thread } from './types';
import { NODE_LABEL } from './types';
import { edgeCurve, edgePath, groupBounds, nodeRect, portPoint } from './geometry';

export const KIND_COLOR: Record<SceneNode['kind'], string> = {
  prompt: '#d18a5f',
  render: '#d6f26b',
  image: '#8fa9d9',
  weave: '#e39a9a',
};

const INK = '#101612';
const SILK = '#e9e1cc';
const SILK_2 = '#ded3b9';
const BORDER = '#33433a';
const GRID_X = 'rgba(214, 242, 107, 0.05)';
const GRID_Y = 'rgba(233, 225, 204, 0.04)';
const MUTED = '#68766b';

export interface ConnectPreview {
  from: ID;
  to: Point;
  valid: boolean;
}

export interface PaintOptions {
  doc: Doc;
  camera: Camera;
  width: number;
  height: number;
  selection: Set<ID>;
  threadSelection: Set<ID>;
  hoverNode?: ID;
  hoverPort?: 'in' | 'out';
  marquee?: Rect;
  connect?: ConnectPreview;
  grid?: boolean;
  getImage: (assetId: ID | undefined) => HTMLImageElement | undefined;
  /** 屏幕画布用 devicePixelRatio，导出画布保持 1 */
  pixelRatio?: number;
  /** 导出时不带编组辅助框 */
  showGroups?: boolean;
  minimal?: boolean;
}

interface Ctx extends CanvasRenderingContext2D {}

export function paintScene(ctx: Ctx, options: PaintOptions): void {
  const { camera, width, height, doc } = options;
  const dpr = options.pixelRatio && options.pixelRatio > 0 ? options.pixelRatio : 1;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0c1411';
  ctx.fillRect(0, 0, width, height);

  if (options.grid !== false) drawGrid(ctx, camera, width, height);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.z, camera.z);

  if (options.showGroups !== false) {
    for (const group of doc.groups ?? []) drawGroupFrame(ctx, group, options);
  }

  const map = new Map(doc.nodes.map((node) => [node.id, node]));
  for (const thread of doc.threads) {
    const from = map.get(thread.from);
    const to = map.get(thread.to);
    if (from && to) drawThread(ctx, thread, from, to, options);
  }

  for (const node of doc.nodes) drawNode(ctx, node, options, camera.z);

  if (options.connect) {
    const from = map.get(options.connect.from);
    if (from) {
      const start = portPoint(from, 'out');
      const color = options.connect.valid ? '#d6f26b' : '#e07d6d';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 / camera.z;
      ctx.setLineDash([7 / camera.z, 6 / camera.z]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.bezierCurveTo(start.x + 70, start.y, options.connect.to.x - 70, options.connect.to.y, options.connect.to.x, options.connect.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(options.connect.to.x, options.connect.to.y, 5 / camera.z, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (options.marquee) {
    ctx.fillStyle = 'rgba(214, 242, 107, 0.08)';
    ctx.strokeStyle = 'rgba(214, 242, 107, 0.8)';
    ctx.lineWidth = 1 / camera.z;
    ctx.fillRect(options.marquee.x, options.marquee.y, options.marquee.w, options.marquee.h);
    ctx.strokeRect(options.marquee.x, options.marquee.y, options.marquee.w, options.marquee.h);
  }

  ctx.restore();
}

function drawGrid(ctx: Ctx, camera: Camera, width: number, height: number): void {
  const xStart = ((camera.x % (96 * camera.z)) + 96 * camera.z) % (96 * camera.z);
  const yStep = 11 * camera.z;
  const yStart = ((camera.y % yStep) + yStep) % yStep;

  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID_Y;
  ctx.beginPath();
  if (yStep > 5) {
    for (let y = yStart; y < height; y += yStep) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
    }
  }
  ctx.stroke();

  ctx.strokeStyle = GRID_X;
  ctx.beginPath();
  if (96 * camera.z > 12) {
    for (let x = xStart; x < width; x += 96 * camera.z) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
    }
  }
  ctx.stroke();

  // 画布暗角
  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

const GROUP_INKS = ['#7fa08f', '#c08b6a', '#8b93c2', '#b58fb0', '#b7a06a'];

function groupInk(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return GROUP_INKS[hash % GROUP_INKS.length];
}

function drawGroupFrame(ctx: Ctx, group: Group, options: PaintOptions): void {
  const bounds = groupBounds(group, options.doc);
  if (!bounds) return;
  const selected = group.nodeIds.length > 0 && group.nodeIds.every((id) => options.selection.has(id));
  const ink = groupInk(group.id);
  const zoom = options.camera.z;

  ctx.save();
  ctx.fillStyle = selected ? 'rgba(214, 242, 107, 0.035)' : 'rgba(233, 225, 204, 0.014)';
  roundedRect(ctx, bounds.x, bounds.y, bounds.w, bounds.h, 14);
  ctx.fill();
  ctx.strokeStyle = selected ? 'rgba(214, 242, 107, 0.68)' : 'rgba(233, 225, 204, 0.16)';
  ctx.lineWidth = 1.1 / zoom;
  ctx.setLineDash([7 / zoom, 7 / zoom]);
  ctx.stroke();
  ctx.setLineDash([]);

  // 标签页
  ctx.font = '600 10px Inter, "PingFang SC", "Noto Sans SC", sans-serif';
  const label = truncate(ctx, group.name || '未命名编组', 180);
  const labelW = Math.min(bounds.w, ctx.measureText(label).width + 26);
  ctx.fillStyle = selected ? 'rgba(214, 242, 107, 0.12)' : 'rgba(12, 20, 17, 0.82)';
  roundedRect(ctx, bounds.x + 8, bounds.y + 6, labelW, 18, 5);
  ctx.fill();
  ctx.strokeStyle = selected ? 'rgba(214, 242, 107, 0.55)' : 'rgba(233, 225, 204, 0.2)';
  ctx.lineWidth = 0.8 / zoom;
  ctx.stroke();
  ctx.fillStyle = selected ? '#d6f26b' : ink;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bounds.x + 17, bounds.y + 15.5);
  ctx.restore();
}

function drawThread(ctx: Ctx, thread: Thread, from: SceneNode, to: SceneNode, options: PaintOptions): void {
  const curve = edgeCurve(from, to);
  const path = edgePath(curve);
  const selected = options.threadSelection.has(thread.id);
  const color = selected ? '#d6f26b' : KIND_COLOR[from.kind];

  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(2, 8, 6, 0.6)';
  ctx.lineWidth = 7;
  ctx.stroke(new Path2D(path));

  ctx.strokeStyle = color;
  ctx.globalAlpha = selected ? 0.95 : 0.58;
  ctx.lineWidth = selected ? 2.4 : 1.7;
  ctx.stroke(new Path2D(path));

  ctx.globalAlpha = selected ? 0.4 : 0.18;
  ctx.strokeStyle = '#f3ecd9';
  ctx.lineWidth = 0.9;
  ctx.setLineDash([3, 9]);
  ctx.stroke(new Path2D(path));
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // 箭头
  const angle = Math.atan2(curve.end.y - curve.c2.y, curve.end.x - curve.c2.x);
  const size = 7;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(curve.end.x - Math.cos(angle - 0.5) * size, curve.end.y - Math.sin(angle - 0.5) * size);
  ctx.lineTo(curve.end.x, curve.end.y);
  ctx.lineTo(curve.end.x - Math.cos(angle + 0.5) * size, curve.end.y - Math.sin(angle + 0.5) * size);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (selected) {
    ctx.fillStyle = '#0c1411';
    ctx.strokeStyle = '#d6f26b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(curve.mid.x, curve.mid.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#d6f26b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(curve.mid.x - 3.4, curve.mid.y - 3.4);
    ctx.lineTo(curve.mid.x + 3.4, curve.mid.y + 3.4);
    ctx.moveTo(curve.mid.x + 3.4, curve.mid.y - 3.4);
    ctx.lineTo(curve.mid.x - 3.4, curve.mid.y + 3.4);
    ctx.stroke();
  }
}

function drawNode(ctx: Ctx, node: SceneNode, options: PaintOptions, zoom: number): void {
  const rect = nodeRect(node);
  const selected = options.selection.has(node.id);
  const hovered = options.hoverNode === node.id;
  const accent = KIND_COLOR[node.kind];

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.46)';
  ctx.shadowBlur = 22 / zoom;
  ctx.shadowOffsetY = 8 / zoom;
  ctx.fillStyle = SILK;
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 6);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 6);
  ctx.clip();

  // 纸面纹理
  ctx.fillStyle = 'rgba(124, 101, 65, 0.045)';
  for (let x = rect.x; x < rect.x + rect.w; x += 7) {
    ctx.fillRect(x, rect.y, 0.6, rect.h);
  }

  ctx.fillStyle = SILK_2;
  ctx.fillRect(rect.x, rect.y, rect.w, 40);
  ctx.fillStyle = accent;
  ctx.fillRect(rect.x, rect.y, rect.w, 4);

  // 节点标题
  ctx.fillStyle = INK;
  ctx.font = '600 13px Inter, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'middle';
  const title = truncate(ctx, node.title || NODE_LABEL[node.kind], rect.w - 100);
  ctx.fillText(title, rect.x + 14, rect.y + 23);

  ctx.fillStyle = accent;
  ctx.font = '600 8px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(NODE_LABEL[node.kind].toUpperCase(), rect.x + rect.w - 14, rect.y + 23);
  ctx.textAlign = 'left';

  if (node.kind === 'render') drawRenderBody(ctx, node, options, rect);
  else if (node.kind === 'prompt') drawPromptBody(ctx, node, rect);
  else if (node.kind === 'image') drawImageBody(ctx, node, options, rect);
  else drawWeaveBody(ctx, node, options, rect);

  ctx.restore();

  ctx.strokeStyle = selected ? '#d6f26b' : hovered ? '#7b8e7f' : BORDER;
  ctx.lineWidth = selected ? 1.8 : 1.1;
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 6);
  ctx.stroke();

  if (selected) drawSelection(ctx, rect, zoom);

  // 端口
  const inPoint = portPoint(node, 'in');
  const outPoint = portPoint(node, 'out');
  const r = 5.5 / zoom;
  drawPort(ctx, inPoint, r, accent, options.hoverPort === 'in');
  drawPort(ctx, outPoint, r, accent, options.hoverPort === 'out');

  if (selected) {
    const size = 9 / zoom;
    ctx.fillStyle = '#d6f26b';
    ctx.strokeStyle = '#0c1411';
    ctx.lineWidth = 1.4 / zoom;
    ctx.fillRect(rect.x + rect.w - size / 2 - 2 / zoom, rect.y + rect.h - size / 2 - 2 / zoom, size, size);
    ctx.strokeRect(rect.x + rect.w - size / 2 - 2 / zoom, rect.y + rect.h - size / 2 - 2 / zoom, size, size);
  }
}

function drawSelection(ctx: Ctx, rect: Rect, zoom: number): void {
  const pad = 5 / zoom;
  const length = 10 / zoom;
  const x = rect.x - pad;
  const y = rect.y - pad;
  const w = rect.w + pad * 2;
  const h = rect.h + pad * 2;
  ctx.strokeStyle = '#d6f26b';
  ctx.lineWidth = 1.4 / zoom;
  ctx.beginPath();
  ctx.moveTo(x, y + length);
  ctx.lineTo(x, y);
  ctx.lineTo(x + length, y);
  ctx.moveTo(x + w - length, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + length);
  ctx.moveTo(x + w, y + h - length);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - length, y + h);
  ctx.moveTo(x + length, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - length);
  ctx.stroke();
}

function drawPort(ctx: Ctx, point: Point, radius: number, color: string, hovered: boolean): void {
  ctx.fillStyle = '#0c1411';
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius + (hovered ? 2 : 0), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = hovered ? 2.2 : 1.4;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(1.5, radius * 0.32), 0, Math.PI * 2);
  ctx.fill();
}

function drawPromptBody(ctx: Ctx, node: SceneNode, rect: Rect): void {
  if (node.kind !== 'prompt') return;
  const x = rect.x + 15;
  let y = rect.y + 58;
  ctx.fillStyle = node.role === 'style' ? '#8a6a44' : '#7d5334';
  ctx.font = '600 8px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
  const label = node.role === 'style' ? 'STYLE' : node.role === 'note' ? 'NOTE' : 'PROMPT';
  ctx.fillText(label, x, y);
  y += 18;

  ctx.fillStyle = node.text.trim() ? INK : MUTED;
  ctx.font = '11.5px Inter, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  const text = node.text.trim() || '写下提示词，或连接上游节点。';
  wrapText(ctx, text, rect.w - 30, 16.5, 7).forEach((line) => {
    ctx.fillText(line, x, y);
    y += 16.5;
  });

  ctx.fillStyle = 'rgba(16, 22, 18, 0.42)';
  ctx.font = '8px ui-monospace, "Noto Sans SC", monospace';
  ctx.fillText(`${node.text.trim().length} 字符`, x, rect.y + rect.h - 14);
}

function drawRenderBody(ctx: Ctx, node: SceneNode, options: PaintOptions, rect: Rect): void {
  if (node.kind !== 'render') return;
  const x = rect.x + 14;
  const top = rect.y + 52;
  const width = rect.w - 28;

  const upstreamPrompt = upstreamPrompts(options.doc, node.id).join(' ');
  const prompt = node.prompt.trim() || upstreamPrompt;
  ctx.fillStyle = prompt ? 'rgba(16, 22, 18, 0.72)' : MUTED;
  ctx.font = '10px Inter, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  const lines = wrapText(ctx, prompt || '留空则使用上游文本；也可以在这里补一句。', width, 13.5, 2);
  let y = top;
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += 13.5;
  }

  const previewTop = rect.y + 92;
  const previewH = rect.h - 92 - 44;
  const count = node.assetIds.length;
  const cols = count >= 3 ? 2 : 1;
  const gap = 5;
  const cellW = (width - gap * (cols - 1)) / cols;
  const rows = Math.max(1, Math.ceil(Math.max(1, count) / cols));
  const cellH = (previewH - gap * (rows - 1)) / rows;

  for (let index = 0; index < Math.max(1, count); index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cx = x + col * (cellW + gap);
    const cy = previewTop + row * (cellH + gap);
    ctx.fillStyle = '#15201b';
    ctx.fillRect(cx, cy, cellW, cellH);
    const image = options.getImage(node.assetIds[index]);
    if (image) drawCover(ctx, image, cx, cy, cellW, cellH);
    else {
      ctx.strokeStyle = 'rgba(233, 225, 204, 0.16)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
      ctx.fillStyle = 'rgba(233, 225, 204, 0.34)';
      ctx.font = '8px ui-monospace, "Noto Sans SC", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('EMPTY', cx + cellW / 2, cy + cellH / 2);
      ctx.textAlign = 'left';
    }
  }
  if (count && count < 3) {
    ctx.fillStyle = 'rgba(233, 225, 204, 0.4)';
    ctx.font = '8px ui-monospace, "Noto Sans SC", monospace';
    ctx.fillText(`${count} 张图片`, x, rect.y + rect.h - 28);
  }

  if (node.status === 'running') {
    ctx.fillStyle = 'rgba(8, 14, 11, 0.7)';
    ctx.fillRect(rect.x, rect.y + 40, rect.w, rect.h - 40);
    ctx.strokeStyle = '#d6f26b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2 - 10;
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#d6f26b';
    ctx.font = '600 9px ui-monospace, "Noto Sans SC", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${node.progress}%`, cx, cy + 3);
    ctx.fillStyle = 'rgba(233, 225, 204, 0.72)';
    ctx.fillText('正在生成', cx, cy + 30);
    ctx.textAlign = 'left';
  }

  if (node.status === 'error' && node.error) {
    ctx.fillStyle = '#9d4138';
    ctx.font = '9px Inter, "Noto Sans SC", sans-serif';
    ctx.fillText(truncate(ctx, node.error, width), x, rect.y + rect.h - 16);
  } else {
    ctx.fillStyle = node.status === 'done' ? '#3f6b4b' : MUTED;
    ctx.font = '8px ui-monospace, "Noto Sans SC", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(node.status === 'done' ? 'DONE' : 'READY', rect.x + rect.w - 14, rect.y + rect.h - 16);
    ctx.textAlign = 'left';
  }
}

function drawImageBody(ctx: Ctx, node: SceneNode, options: PaintOptions, rect: Rect): void {
  if (node.kind !== 'image') return;
  const x = rect.x + 10;
  const y = rect.y + 50;
  const w = rect.w - 20;
  const h = rect.h - 50 - 36;
  ctx.fillStyle = '#15201b';
  ctx.fillRect(x, y, w, h);
  const image = options.getImage(node.assetId);
  if (image) drawCover(ctx, image, x, y, w, h);
  else {
    ctx.strokeStyle = 'rgba(233, 225, 204, 0.22)';
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(233, 225, 204, 0.47)';
    ctx.font = '9px ui-monospace, "Noto Sans SC", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('拖入图片', x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = 'rgba(16, 22, 18, 0.56)';
  ctx.font = '9px Inter, "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.fillText(truncate(ctx, node.caption || '未命名图片', rect.w - 24), rect.x + 12, rect.y + rect.h - 16);
}

function drawWeaveBody(ctx: Ctx, node: SceneNode, options: PaintOptions, rect: Rect): void {
  if (node.kind !== 'weave') return;
  const incoming = new Map(options.doc.threads.filter((thread) => thread.to === node.id).map((thread) => [thread.from, thread]));
  const assets: ID[] = [];
  for (const source of options.doc.nodes) {
    if (!incoming.has(source.id)) continue;
    if (source.kind === 'image' && source.assetId) assets.push(source.assetId);
    if (source.kind === 'render') assets.push(...source.assetIds);
  }
  const x = rect.x + 12;
  const y = rect.y + 52;
  const w = rect.w - 24;
  const h = rect.h - 52 - 34;
  ctx.fillStyle = '#15201b';
  ctx.fillRect(x, y, w, h);

  if (!assets.length) {
    ctx.strokeStyle = 'rgba(233, 225, 204, 0.2)';
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(233, 225, 204, 0.44)';
    ctx.font = '9px ui-monospace, "Noto Sans SC", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('把图片或生成结果连进来', x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    return;
  }

  const cols = Math.max(1, Math.min(4, node.columns));
  const gap = Math.max(0, Math.min(24, node.gap));
  const rows = Math.ceil(assets.length / cols);
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = (h - gap * (rows - 1)) / rows;
  assets.forEach((assetId, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cx = x + col * (cellW + gap);
    const cy = y + row * (cellH + gap);
    const image = options.getImage(assetId);
    ctx.fillStyle = '#0f1915';
    ctx.fillRect(cx, cy, cellW, cellH);
    if (image) drawCover(ctx, image, cx, cy, cellW, cellH);
  });

  ctx.fillStyle = 'rgba(16, 22, 18, 0.55)';
  ctx.font = '9px ui-monospace, "Noto Sans SC", monospace';
  ctx.fillText(truncate(ctx, node.caption || `拼图 · ${assets.length} 张`, rect.w - 24), rect.x + 12, rect.y + rect.h - 14);
}

function drawCover(ctx: Ctx, image: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (image.naturalWidth - sw) / 2;
  const sy = (image.naturalHeight - sh) / 2;
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}

export function wrapText(
  ctx: Ctx,
  text: string,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const lines: string[] = [];
  let line = '';
  for (const char of normalized) {
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth - 14 && !last.endsWith('…')) {
      lines[maxLines - 1] = `${last.slice(0, Math.max(1, last.length - 2))}…`;
    }
  }
  return lines;
}

export function truncate(ctx: Ctx, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > width) result = result.slice(0, -1);
  return `${result}…`;
}

function upstreamPrompts(doc: Doc, nodeId: ID): string[] {
  const incoming = new Map<ID, ID[]>();
  for (const thread of doc.threads) {
    const list = incoming.get(thread.to) ?? [];
    list.push(thread.from);
    incoming.set(thread.to, list);
  }
  const nodes = new Map(doc.nodes.map((node) => [node.id, node]));
  const seen = new Set<ID>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const source of incoming.get(current) ?? []) {
      if (seen.has(source)) continue;
      seen.add(source);
      queue.push(source);
    }
  }
  return [...seen]
    .map((id) => nodes.get(id))
    .filter((node): node is SceneNode => Boolean(node && node.kind === 'prompt' && node.text.trim()))
    .map((node) => (node.kind === 'prompt' ? node.text.trim() : ''));
}

export function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function paintEmpty(ctx: Ctx, width: number, height: number): void {
  ctx.fillStyle = '#0c1411';
  ctx.fillRect(0, 0, width, height);
}
