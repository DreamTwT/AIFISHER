import { allAssets, getAssetImage } from '../core/assets';
import type { Editor } from '../core/editor';
import type { AssetMeta } from '../core/types';
import { downloadBlob, timestampName } from '../core/util';
import { icon } from './icons';
import { showToast } from './toast';

const INK = '#182019';
const PAPER = '#ece3d1';

export function buildContactSheet(editor: Editor, assets: AssetMeta[]): HTMLCanvasElement {
  const width = 1900;
  const pad = 84;
  const columns = assets.length > 8 ? 4 : 3;
  const gap = 22;
  const maxRows = 5;
  const shown = assets.slice(0, columns * maxRows);
  const rows = Math.max(1, Math.ceil(shown.length / columns));
  const cellW = (width - pad * 2 - gap * (columns - 1)) / columns;
  const cellH = cellW * 1.2;
  const headerH = 214;
  const footerH = 110;
  const height = Math.min(4096, headerH + rows * (cellH + 46) + footerH);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 布纹
  ctx.strokeStyle = 'rgba(24, 32, 25, 0.075)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 44) {
    ctx.strokeStyle = 'rgba(24, 32, 25, 0.035)';
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }

  // 标记
  ctx.fillStyle = INK;
  ctx.font = '600 15px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
  ctx.fillText('WEFT / 纬', pad, 62);
  ctx.font = '600 46px Inter, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('印样总览', pad, 114);
  ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
  ctx.fillStyle = 'rgba(24, 32, 25, 0.58)';
  ctx.fillText('CONTACT SHEET / 试织记录', pad, 142);

  ctx.textAlign = 'right';
  ctx.fillStyle = INK;
  ctx.font = '600 15px Inter, "PingFang SC", sans-serif';
  ctx.fillText(editor.project.name, width - pad, 70);
  ctx.fillStyle = 'rgba(24, 32, 25, 0.56)';
  ctx.font = '11px ui-monospace, "Noto Sans SC", monospace';
  ctx.fillText(`${assets.length} 张样张  ·  ${new Date().toLocaleDateString('zh-CN')}`, width - pad, 96);
  ctx.fillText('ARCHIVE 01', width - pad, 116);
  ctx.textAlign = 'left';

  ctx.strokeStyle = 'rgba(24, 32, 25, 0.62)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(pad, 174.5);
  ctx.lineTo(width - pad, 174.5);
  ctx.stroke();

  if (!shown.length) {
    ctx.fillStyle = 'rgba(24, 32, 25, 0.42)';
    ctx.font = '15px Inter, "PingFang SC", sans-serif';
    ctx.fillText('还没有布样。织出第一张，样张就会排在这里。', pad, headerH + 80);
  }

  shown.forEach((asset, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = pad + col * (cellW + gap);
    const y = headerH + row * (cellH + 46);
    ctx.fillStyle = '#d7cbb3';
    ctx.fillRect(x, y, cellW, cellH);
    const image = getAssetImage(asset.id);
    if (image && image.naturalWidth) drawCover(ctx, image, x, y, cellW, cellH);
    else {
      ctx.fillStyle = 'rgba(24, 32, 25, 0.34)';
      ctx.font = '10px ui-monospace, "Noto Sans SC", monospace';
      ctx.fillText('NO PREVIEW', x + 12, y + 26);
    }
    ctx.strokeStyle = 'rgba(24, 32, 25, 0.24)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);

    ctx.fillStyle = INK;
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
    ctx.fillText(String(index + 1).padStart(2, '0'), x, y + cellH + 19);
    ctx.fillStyle = 'rgba(24, 32, 25, 0.58)';
    ctx.font = '10px ui-monospace, "Noto Sans SC", monospace';
    const label = asset.name.length > 34 ? `${asset.name.slice(0, 33)}…` : asset.name;
    ctx.fillText(label, x + 26, y + cellH + 19);
    ctx.textAlign = 'right';
    ctx.fillText(asset.seed ? `S${asset.seed}` : asset.source === 'upload' ? 'UPLOAD' : 'SAMPLE', x + cellW, y + cellH + 19);
    ctx.textAlign = 'left';
  });

  const footerY = canvas.height - footerH + 40;
  ctx.strokeStyle = 'rgba(24, 32, 25, 0.3)';
  ctx.beginPath();
  ctx.moveTo(pad, footerY - 26);
  ctx.lineTo(width - pad, footerY - 26);
  ctx.stroke();
  ctx.fillStyle = 'rgba(24, 32, 25, 0.5)';
  ctx.font = '10px ui-monospace, "Noto Sans SC", monospace';
  ctx.fillText('WOVEN ON WEFT · LOCAL ARCHIVE', pad, footerY);
  ctx.textAlign = 'right';
  const hidden = assets.length - shown.length;
  ctx.fillText(hidden > 0 ? `+${hidden} MORE IN LIBRARY` : 'ALL SAMPLES INCLUDED', width - pad, footerY);
  ctx.textAlign = 'left';

  return canvas;
}

export async function openContactSheet(editor: Editor): Promise<void> {
  const assets = allAssets();
  const canvas = buildContactSheet(editor, assets);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    showToast('样张渲染失败', 'error');
    return;
  }
  const url = URL.createObjectURL(blob);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet-modal" role="dialog" aria-modal="true" aria-label="印样总览">
      <div class="sheet-head">
        <div>
          <div class="eyebrow">CONTACT SHEET</div>
          <h2>印样总览</h2>
        </div>
        <div class="sheet-actions">
          <span class="sheet-count">${assets.length} 张布样</span>
          <button class="btn" data-act="download">${icon('download', 15)} 下载 PNG</button>
          <button class="icon-btn" data-act="close" aria-label="关闭">${icon('close', 17)}</button>
        </div>
      </div>
      <div class="sheet-scroll"><img alt="印样总览" src="${url}" /></div>
      <div class="sheet-foot">按原始分辨率导出 · 汇总本机布样库</div>
    </div>`;
  document.body.appendChild(backdrop);
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  const close = (): void => {
    URL.revokeObjectURL(url);
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };
  backdrop.querySelector('[data-act="close"]')?.addEventListener('click', close);
  backdrop.querySelector('[data-act="download"]')?.addEventListener('click', () => {
    downloadBlob(blob, `${timestampName('proof-sheet')}.png`);
    showToast('印样总览已下载', 'success');
  });
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
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
