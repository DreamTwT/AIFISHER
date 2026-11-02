import { toPng } from 'html-to-image';
import { emit } from '../ui/bus';
import { getEditor } from '../store/editor';
import { nextFrame } from './util';

function canvasHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.canvas-host');
}

export async function downloadDataUrl(dataUrl: string, filename: string): Promise<void> {
  // data: URL 在部分浏览器/无头环境下会被下载管理器忽略，转成 Blob 更可靠
  const blob = await (await fetch(dataUrl)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

interface CaptureOptions {
  pixelRatio?: number;
  hideSelection?: boolean;
}

async function captureHost(options: CaptureOptions = {}): Promise<string | null> {
  const host = canvasHost();
  if (!host) return null;
  await nextFrame();
  host.classList.add('exporting');
  try {
    const dataUrl = await toPng(host, {
      pixelRatio: options.pixelRatio ?? 2,
      backgroundColor: '#f1e9db',
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        if (node.dataset.exportHide === '1') return false;
        return true;
      },
    });
    return dataUrl;
  } finally {
    host.classList.remove('exporting');
  }
}

/** 导出 PNG：scope=all 时临时适配整张画布，导出后恢复视角 */
export async function exportCanvasPng(scope: 'view' | 'all' = 'view'): Promise<string> {
  const host = canvasHost();
  const editor = getEditor();
  const restore = { ...editor.getSnapshot().project.camera };
  const rect = host?.getBoundingClientRect();
  const viewportW = rect?.width ?? 1440;
  const viewportH = rect?.height ?? 900;

  if (scope === 'all') {
    emit('canvas:fit', { target: 'all' });
    await new Promise((resolve) => setTimeout(resolve, 340));
  }
  const dataUrl = await captureHost({ pixelRatio: 2 });
  if (scope === 'all') {
    const center = {
      x: (viewportW / 2 - restore.x) / restore.zoom,
      y: (viewportH / 2 - restore.y) / restore.zoom,
    };
    emit('canvas:center', { x: center.x, y: center.y, zoom: restore.zoom });
  }
  if (!dataUrl) throw new Error('画布尚未准备好');
  return dataUrl;
}

export async function captureThumbnail(): Promise<string | null> {
  try {
    return await captureHost({ pixelRatio: 0.4 });
  } catch (error) {
    console.warn('[mimeo] 缩略图生成失败', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return null;
  }
}
