import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Download,
  FolderKanban,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  ListChecks,
  Play,
  Redo2,
  Settings,
  Undo2,
  Upload,
  PanelRight,
} from 'lucide-react';
import { useEditorState, useTasks, useUIState } from './hooks';
import { getEditor } from '../store/editor';
import { setUI, toast } from '../store/ui';
import { runAllNodes } from '../runtime/generation';
import { exportPng, exportProjectFile } from '../lib/exports';
import { importProjectFile } from '../store/session';
import { openProjectDashboard } from '../lib/dashboard';
import { emit } from './bus';

interface TopBarProps {
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

export function TopBar({ inspectorOpen, onToggleInspector }: TopBarProps) {
  const state = useEditorState();
  const ui = useUIState();
  const tasks = useTasks();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(state.project.name);
  const [exportOpen, setExportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setName(state.project.name), [state.project.name]);

  useEffect(() => {
    if (!exportOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [exportOpen]);

  const activeCount = Object.values(tasks).filter(
    (t) => t.status === 'running' || t.status === 'queued',
  ).length;

  const saveLabel =
    state.saveState === 'saving'
      ? '保存中…'
      : state.saveState === 'dirty'
        ? '未保存'
        : state.saveState === 'error'
          ? '保存失败'
          : '已保存';

  const commitName = () => {
    setEditing(false);
    getEditor().setProjectName(name);
  };

  const openDashboard = () => {
    openProjectDashboard();
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <span className="brand-mark">M</span>
          <span className="brand-word">MUSE</span>
        </div>

        {editing ? (
          <input
            className="project-title-input"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName();
              if (event.key === 'Escape') {
                setName(state.project.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button className="project-title truncate" onClick={() => setEditing(true)} title="重命名画布">
            <span className="truncate">{state.project.name}</span>
            <ChevronDown size={11} style={{ color: 'var(--faint)', flex: 'none' }} />
          </button>
        )}

        <span className={`save-state ${state.saveState}`}>
          <span className="save-dot" />
          {saveLabel}
        </span>
        <span className="chip" title="本地优先">
          <Layers size={9} /> {state.project.doc.nodes.length} 节点
        </span>
      </div>

      <div className="topbar-right">
        <button
          className="topbar-btn"
          title="撤销 ⌘Z"
          disabled={!state.past.length}
          onClick={() => getEditor().undo()}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="topbar-btn"
          title="重做 ⇧⌘Z"
          disabled={!state.future.length}
          onClick={() => getEditor().redo()}
        >
          <Redo2 size={15} />
        </button>

        <span className="topbar-sep" />

        <button
          className="topbar-btn"
          title="运行整张画布（按依赖顺序）"
          onClick={() => void runAllNodes()}
        >
          <Play size={14} />
          <span style={{ fontSize: 11.5 }}>运行</span>
        </button>

        <button
          className={`topbar-btn${ui.assetsOpen ? ' on' : ''}`}
          title="素材库"
          onClick={() => setUI((prev) => ({ ...prev, assetsOpen: !prev.assetsOpen }))}
        >
          <ImageIcon size={15} />
        </button>

        <button
          className={`topbar-btn${ui.taskPanelOpen ? ' on' : ''}`}
          title="任务中心"
          onClick={() => setUI((prev) => ({ ...prev, taskPanelOpen: !prev.taskPanelOpen }))}
        >
          <ListChecks size={15} />
          {activeCount > 0 ? <span className="task-badge">{activeCount}</span> : null}
        </button>

        <button
          className={`topbar-btn${inspectorOpen ? ' on' : ''}`}
          title="属性面板"
          onClick={onToggleInspector}
        >
          <PanelRight size={15} />
        </button>

        <span className="topbar-sep" />

        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            className={`topbar-btn${exportOpen ? ' on' : ''}`}
            title="导出 / 导入"
            onClick={() => setExportOpen((value) => !value)}
          >
            <Download size={15} />
            <ChevronDown size={10} />
          </button>
          {exportOpen ? (
            <div className="context-menu" style={{ position: 'absolute', right: 0, top: 36, left: 'auto' }}>
              <div className="menu-label">导出</div>
              <button
                className="menu-item"
                onClick={() => {
                  setExportOpen(false);
                  void exportProjectFile(true);
                }}
              >
                <Download size={13} className="menu-icon" /> 工程文件（含素材）
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setExportOpen(false);
                  void exportProjectFile(false);
                }}
              >
                <Download size={13} className="menu-icon" /> 工程文件（轻量）
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setExportOpen(false);
                  void exportPng('all');
                }}
              >
                <Layers size={13} className="menu-icon" /> 整张画布 PNG
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setExportOpen(false);
                  void exportPng('view');
                }}
              >
                <ImageIcon size={13} className="menu-icon" /> 当前视图 PNG
              </button>
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  setExportOpen(false);
                  fileRef.current?.click();
                }}
              >
                <Upload size={13} className="menu-icon" /> 导入工程…
              </button>
            </div>
          ) : null}
        </div>

        <button className="topbar-btn" title="画布库 / 模板" onClick={() => void openDashboard()}>
          <FolderKanban size={15} />
        </button>

        <button
          className="topbar-btn"
          title="设置"
          onClick={() => emit('settings:open', {})}
        >
          <Settings size={15} />
        </button>

        <button
          className="topbar-btn"
          title="快捷键与帮助"
          onClick={() => setUI({ helpOpen: true })}
        >
          <HelpCircle size={15} />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            await importProjectFile(file);
            toast('工程已导入', 'success');
            setUI({ dashboardOpen: false });
          } catch (error) {
            toast(error instanceof Error ? error.message : '导入失败', 'error');
          }
        }}
      />
    </header>
  );
}
