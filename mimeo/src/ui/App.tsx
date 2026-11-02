import { useCallback, useEffect, useRef, useState } from 'react';
import { loadImageSize } from '../lib/util';
import { getEditor, type ClipboardPayload } from '../store/editor';
import { isTypingTarget } from '../lib/util';
import { addAsset } from '../store/assets';
import { getSettings } from '../store/settings';
import {
  bootstrapSession,
  importProjectFile,
  subscribeSession,
} from '../store/session';
import { getUI, setUI, toast } from '../store/ui';
import { openProjectDashboard } from '../lib/dashboard';
import { insertNodeAtViewportCenter } from '../lib/insert';
import { runAllNodes, runSelectedNodes } from '../runtime/generation';
import { on, legacyOn } from './bus';
import { TopBar } from './TopBar';
import { LeftRail } from './LeftRail';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { CommandPalette } from './CommandPalette';
import { ContextMenu } from './ContextMenu';
import { NodeMenu } from './NodeMenu';
import { SettingsDialog } from './SettingsDialog';
import { AssetLibrary } from './AssetLibrary';
import { ProjectDashboard } from './ProjectDashboard';
import { TaskCenter } from './TaskCenter';
import { Toasts } from './Toasts';
import { Lightbox } from './Lightbox';
import { HelpDialog } from './HelpDialog';
import { ContactSheet } from './ContactSheet';

export function App() {
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    bootstrapSession()
      .then(() => {
        if (!mounted) return;
        setStatus('ready');
        setVersion((v) => v + 1);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!mounted) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : '初始化失败');
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => subscribeSession(() => setVersion((v) => v + 1)), []);

  if (status === 'loading') {
    return (
      <div className="boot-screen">
        <div className="boot-inner">
          <div className="boot-mark">M</div>
          <div className="boot-text">MIMEO</div>
          <div className="boot-bar" />
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="boot-screen">
        <div className="boot-inner">
          <div className="boot-mark" style={{ color: '#c62f2f', background: '#f6e0dc' }}>
            !
          </div>
          <div style={{ color: 'var(--text-soft)', maxWidth: 420, textAlign: 'center', lineHeight: 1.7 }}>
            画布初始化失败：{error}
            <br />
            请确认浏览器允许使用本地存储（IndexedDB），或在无痕窗口之外重试。
          </div>
          <button className="btn primary" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return <EditorShell key={version} />;
}

function EditorShell() {
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    try {
      return localStorage.getItem('mimeo.inspector') !== '0';
    } catch {
      return true;
    }
  });
  const clipboard = useRef<ClipboardPayload | null>(null);

  const toggleInspector = useCallback(() => {
    setInspectorOpen((value) => {
      try {
        localStorage.setItem('mimeo.inspector', value ? '0' : '1');
      } catch {
        // 忽略
      }
      return !value;
    });
  }, []);

  const openDashboard = useCallback(() => {
    openProjectDashboard();
  }, []);

  const triggerImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await importProjectFile(file);
        setUI({ dashboardOpen: false });
        toast('工程已导入', 'success');
      } catch (error) {
        toast(error instanceof Error ? error.message : '导入失败', 'error');
      }
    };
    input.click();
  }, []);

  // 跨模块事件
  useEffect(() => {
    const offs = [
      on('settings:open', ({ tab }) => setUI({ settingsOpen: true, settingsTab: tab ?? 'providers' })),
      on('asset:open', (payload) => setUI({ lightbox: payload })),
      on('project:open-dashboard', () => void openDashboard()),
      on('project:import', triggerImport),
      on('palette:open', () => setUI({ paletteOpen: true })),
    ];
    const offSettings = legacyOn('mimeo:open-settings', () => setUI({ settingsOpen: true, settingsTab: 'providers' }));
    const offAsset = legacyOn('mimeo:open-asset', (detail) => {
      const payload = detail as { assetId?: string };
      if (payload?.assetId) setUI({ lightbox: { assetId: payload.assetId } });
    });
    const toggle = () => toggleInspector();
    window.addEventListener('mimeo:toggle-inspector', toggle);
    return () => {
      offs.forEach((off) => off());
      offSettings();
      offAsset();
      window.removeEventListener('mimeo:toggle-inspector', toggle);
    };
  }, [openDashboard, triggerImport, toggleInspector]);

  // 离开前保存
  useEffect(() => {
    const handler = () => {
      void getEditor().saveNow();
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      void getEditor().saveNow();
    };
  }, []);

  // 全局快捷键
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const uiNow = getUI();
      const mod = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);
      const key = event.key;
      const lower = key.toLowerCase();

      if (key === 'Escape') {
        // 按层级从上层往下关，避免一次关闭多个面板
        if (uiNow.contextMenu || uiNow.nodeMenu) {
          setUI({ contextMenu: null, nodeMenu: null });
          return;
        }
        if (uiNow.lightbox) {
          setUI({ lightbox: null });
          return;
        }
        if (uiNow.settingsOpen) {
          setUI({ settingsOpen: false });
          return;
        }
        if (uiNow.paletteOpen) {
          setUI({ paletteOpen: false });
          return;
        }
        if (uiNow.helpOpen) {
          setUI({ helpOpen: false });
          return;
        }
        if (uiNow.contactSheetOpen) {
          setUI({ contactSheetOpen: false });
          return;
        }
        if (uiNow.assetsOpen) {
          setUI({ assetsOpen: false });
          return;
        }
        if (uiNow.taskPanelOpen) {
          setUI({ taskPanelOpen: false });
          return;
        }
        if (uiNow.dashboardOpen) {
          setUI({ dashboardOpen: false });
          return;
        }
        getEditor().clearSelection();
        return;
      }

      if (mod && lower === 'k') {
        event.preventDefault();
        setUI({ paletteOpen: !uiNow.paletteOpen });
        return;
      }
      if (mod && lower === 's') {
        event.preventDefault();
        void getEditor().saveNow();
        toast('已保存到本机', 'success');
        return;
      }

      if (
        uiNow.settingsOpen ||
        uiNow.dashboardOpen ||
        uiNow.helpOpen ||
        uiNow.contactSheetOpen ||
        uiNow.lightbox ||
        uiNow.paletteOpen
      )
        return;
      if (typing) return;
      if (uiNow.contextMenu || uiNow.nodeMenu) setUI({ contextMenu: null, nodeMenu: null });

      const editor = getEditor();
      if (mod && lower === 'z') {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && lower === 'y') {
        event.preventDefault();
        editor.redo();
        return;
      }
      if (mod && lower === 'a') {
        event.preventDefault();
        editor.selectAll();
        return;
      }
      if (mod && lower === 'd') {
        event.preventDefault();
        editor.duplicateSelection();
        return;
      }
      if (mod && lower === 'c') {
        const selectedText = window.getSelection()?.toString();
        if (selectedText) return;
        const payload = editor.copySelection();
        if (payload) {
          clipboard.current = payload;
          event.preventDefault();
          toast('已复制节点', 'success');
        }
        return;
      }
      if (mod && lower === 'v') {
        if (clipboard.current) {
          event.preventDefault();
          editor.paste(clipboard.current);
        }
        return;
      }
      if (mod && lower === 'g') {
        event.preventDefault();
        if (event.shiftKey) editor.ungroupSelection();
        else editor.groupSelection();
        return;
      }
      if (mod && key === '0') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('canvas:fit', { detail: { target: 'all' } }));
        return;
      }
      if (mod && key === '1') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('canvas:zoom', { detail: { value: 1 } }));
        return;
      }
      if (mod && (key === '=' || key === '+')) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('canvas:zoom', { detail: { step: 1 } }));
        return;
      }
      if (mod && key === '-') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('canvas:zoom', { detail: { step: -1 } }));
        return;
      }
      if (mod && key === 'Enter') {
        event.preventDefault();
        runSelectedNodes();
        return;
      }
      if (key === 'Delete' || key === 'Backspace') {
        if (editor.getSnapshot().selection.length || editor.getSnapshot().edgeSelection.length) {
          event.preventDefault();
          editor.deleteSelection();
        }
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        const selection = editor.getSnapshot().selection;
        if (!selection.length) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
        editor.beginGesture('微调位置');
        editor.moveNodesBy(selection, dx, dy);
        editor.commitGesture();
        return;
      }

      if (mod || event.altKey) return;
      if (lower === 'v') setTool('select');
      else if (lower === 'h') setTool('hand');
      else if (lower === 'r') {
        if (event.shiftKey) void runAllNodes();
        else runSelectedNodes();
      } else if (lower === 't') {
        insertNodeAtViewportCenter('prompt');
      } else if (lower === 'g') {
        insertNodeAtViewportCenter('generate');
      } else if (lower === 'c') {
        insertNodeAtViewportCenter('chat');
      } else if (lower === 'p' && event.shiftKey) {
        setUI({ contactSheetOpen: true });
      } else if (key === '?') {
        setUI({ helpOpen: true });
      } else if (key === '!' || (event.shiftKey && key === '1')) {
        window.dispatchEvent(new CustomEvent('canvas:fit', { detail: { target: 'selection' } }));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 粘贴图片
  useEffect(() => {
    const handler = async (event: ClipboardEvent) => {
      const targets = event.clipboardData?.items;
      if (!targets) return;
      for (const item of targets) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;
          event.preventDefault();
          try {
            const meta = await addAsset(file, {
              name: '剪贴板图片',
              source: 'upload',
              keepOriginal: getSettings().keepOriginal,
            });
            const size = meta.width && meta.height ? meta : { ...(await loadImageSize(file)), ...meta };
            const w = 360;
            const h = Math.round(36 + Math.min(540, Math.max(160, (w * (size.height ?? 400)) / (size.width ?? 400))));
            const node = insertNodeAtViewportCenter('image', { w, h });
            getEditor().patchNode(node.id, { assetId: meta.id, source: 'upload' }, { label: '粘贴图片' });
            toast('已粘贴图片并插入画布', 'success');
          } catch (error) {
            toast(error instanceof Error ? error.message : '粘贴失败', 'error');
          }
          return;
        }
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, []);

  // 阻止浏览器把文件拖到页面时跳转
  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);


  return (
    <div className="app">
      <TopBar inspectorOpen={inspectorOpen} onToggleInspector={toggleInspector} />
      <div className="workspace">
        <LeftRail tool={tool} setTool={setTool} />
        <Canvas tool={tool} setTool={setTool} inspectorOpen={inspectorOpen} />
        {inspectorOpen && <Inspector onClose={toggleInspector} />}
      </div>
      <CommandPalette />
      <ContextMenu />
      <NodeMenu />
      <SettingsDialog />
      <AssetLibrary />
      <TaskCenter />
      <Lightbox />
      <HelpDialog />
      <ContactSheet />
      <ProjectDashboard />
      <Toasts />
    </div>
  );
}
