import { downloadText } from './util';
import { downloadDataUrl, exportCanvasPng } from './exportCanvas';
import { exportProjectPayload } from '../store/session';
import { toast } from '../store/ui';

function timestamp(): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export async function exportProjectFile(embedAssets: boolean): Promise<void> {
  try {
    toast(embedAssets ? '正在打包工程与素材…' : '正在导出工程…', 'info');
    const text = await exportProjectPayload(embedAssets);
    const name = `muse-${timestamp()}.json`;
    downloadText(text, name);
    toast(embedAssets ? '工程已导出（含素材）' : '工程已导出（轻量）', 'success');
  } catch (error) {
    toast(error instanceof Error ? error.message : '导出失败', 'error');
  }
}

export async function exportPng(scope: 'view' | 'all'): Promise<void> {
  try {
    toast('正在渲染画布…', 'info');
    const dataUrl = await exportCanvasPng(scope);
    await downloadDataUrl(dataUrl, `muse-canvas-${scope}-${timestamp()}.png`);
    toast('PNG 已导出', 'success');
  } catch (error) {
    toast(error instanceof Error ? error.message : '导出图片失败', 'error');
  }
}
