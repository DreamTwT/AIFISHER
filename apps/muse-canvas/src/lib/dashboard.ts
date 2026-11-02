import { getEditor } from '../store/editor';
import { setUI } from '../store/ui';
import { captureThumbnail } from './exportCanvas';

/**
 * 打开画布库：先切换界面，缩略图在后台补生成并刷新卡片，
 * 避免大画布截图（约 1s）挡住用户操作。
 */
export function openProjectDashboard(): void {
  const editor = getEditor();
  editor.clearSelection();
  setUI({ dashboardOpen: true });
  void captureThumbnail()
    .then(async (thumb) => {
      if (!thumb) return;
      editor.setThumbnail(thumb);
      await editor.saveNow();
      window.dispatchEvent(new CustomEvent('muse:thumbnail-updated'));
    })
    .catch(() => {
      // 截图失败不影响画布库使用
    });
}
