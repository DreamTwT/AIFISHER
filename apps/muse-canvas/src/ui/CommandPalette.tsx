import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  Copy,
  Download,
  FolderKanban,
  Frame,
  Grid3x3,
  ImagePlus,
  Images,
  Keyboard,
  Layers,
  Maximize,
  MessageSquarePlus,
  Minus,
  PanelRight,
  Play,
  Plus,
  Redo2,
  Settings,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Upload,
  ZoomIn,
} from 'lucide-react';
import type { NodeKind } from '../model/types';
import { getEditor } from '../store/editor';
import { setUI, toast } from '../store/ui';
import { updateSettings } from '../store/settings';
import { runAllNodes, runSelectedNodes } from '../runtime/generation';
import { exportProjectFile } from '../lib/exports';
import { insertNodeAtViewportCenter } from '../lib/insert';
import { emit } from './bus';
import { useUIState } from './hooks';

interface Command {
  id: string;
  group: string;
  label: string;
  keywords: string;
  icon: typeof Type;
  run: () => void;
}

const ICONS = {
  prompt: Type,
  generate: Sparkles,
  chat: MessageSquarePlus,
  image: ImagePlus,
  group: Frame,
};

function addNode(kind: NodeKind) {
  insertNodeAtViewportCenter(kind);
}

const COMMANDS: Command[] = [
  { id: 'add-prompt', group: '添加', label: '添加提示词节点', keywords: 'prompt text 提示词 文本', icon: ICONS.prompt, run: () => addNode('prompt') },
  { id: 'add-generate', group: '添加', label: '添加图像生成节点', keywords: 'image generate 生成 绘图', icon: ICONS.generate, run: () => addNode('generate') },
  { id: 'add-chat', group: '添加', label: '添加对话模型节点', keywords: 'chat llm 对话 模型', icon: ICONS.chat, run: () => addNode('chat') },
  { id: 'add-image', group: '添加', label: '添加图像节点', keywords: 'image 图片 素材', icon: ICONS.image, run: () => addNode('image') },
  { id: 'add-group', group: '添加', label: '把选中节点分组', keywords: 'group 分组 frame', icon: ICONS.group, run: () => getEditor().groupSelection() },

  { id: 'run-selected', group: '运行', label: '运行选中的节点', keywords: 'run 运行 执行', icon: Play, run: () => runSelectedNodes() },
  { id: 'run-all', group: '运行', label: '运行整张画布', keywords: 'run all 全画布 工作流', icon: Layers, run: () => void runAllNodes() },

  { id: 'undo', group: '编辑', label: '撤销', keywords: 'undo 撤销', icon: Undo2, run: () => getEditor().undo() },
  { id: 'redo', group: '编辑', label: '重做', keywords: 'redo 重做', icon: Redo2, run: () => getEditor().redo() },
  { id: 'duplicate', group: '编辑', label: '复制选中节点', keywords: 'duplicate copy 复制', icon: Copy, run: () => getEditor().duplicateSelection() },
  { id: 'delete', group: '编辑', label: '删除选中内容', keywords: 'delete remove 删除', icon: Trash2, run: () => getEditor().deleteSelection() },
  { id: 'align-left', group: '编辑', label: '左对齐', keywords: 'align 对齐', icon: AlignLeft, run: () => getEditor().alignSelection('left') },
  { id: 'ungroup', group: '编辑', label: '取消分组', keywords: 'ungroup 取消分组', icon: Ungroup, run: () => getEditor().ungroupSelection() },

  { id: 'fit', group: '视图', label: '适应整张画布', keywords: 'fit zoom 适应 缩放', icon: Maximize, run: () => emit('canvas:fit', { target: 'all' }) },
  { id: 'fit-selection', group: '视图', label: '聚焦选中节点', keywords: 'focus selection 聚焦', icon: ZoomIn, run: () => emit('canvas:fit', { target: 'selection' }) },
  { id: 'zoom-in', group: '视图', label: '放大', keywords: 'zoom in 放大', icon: Plus, run: () => emit('canvas:zoom', { step: 1 }) },
  { id: 'zoom-out', group: '视图', label: '缩小', keywords: 'zoom out 缩小', icon: Minus, run: () => emit('canvas:zoom', { step: -1 }) },
  { id: 'toggle-grid', group: '视图', label: '显示 / 隐藏网格', keywords: 'grid 网格', icon: Grid3x3, run: () => updateSettings((prev) => ({ ...prev, grid: !prev.grid })) },
  { id: 'toggle-minimap', group: '视图', label: '显示 / 隐藏小地图', keywords: 'minimap 小地图', icon: Grid3x3, run: () => updateSettings((prev) => ({ ...prev, showMinimap: !prev.showMinimap })) },

  { id: 'assets', group: '文件', label: '打开素材库', keywords: 'assets 素材 图片', icon: Images, run: () => setUI({ assetsOpen: true }) },
  { id: 'dashboard', group: '文件', label: '画布库与模板', keywords: 'dashboard project 项目 模板', icon: FolderKanban, run: () => emit('project:open-dashboard', {}) },
  { id: 'export-json', group: '文件', label: '导出工程（含素材）', keywords: 'export json 导出 工程', icon: Download, run: () => void exportProjectFile(true) },
  { id: 'export-png', group: '文件', label: '导出当前视图 PNG', keywords: 'export png 导出 图片', icon: Download, run: () => void import('../lib/exports').then((m) => m.exportPng('view')) },
  { id: 'import', group: '文件', label: '从本地导入工程', keywords: 'import 导入', icon: Upload, run: () => emit('project:import', {} as never) },
  { id: 'settings', group: '文件', label: '打开设置', keywords: 'settings 设置 模型', icon: Settings, run: () => emit('settings:open', {}) },
  { id: 'help', group: '文件', label: '快捷键与帮助', keywords: 'help shortcuts 帮助 快捷键', icon: Keyboard, run: () => setUI({ helpOpen: true }) },
  { id: 'inspector', group: '视图', label: '展开 / 收起属性面板', keywords: 'inspector 属性 面板', icon: PanelRight, run: () => window.dispatchEvent(new CustomEvent('muse:toggle-inspector')) },
];

export function CommandPalette() {
  const ui = useUIState();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (command) =>
        command.label.toLowerCase().includes(q) ||
        command.group.toLowerCase().includes(q) ||
        command.keywords.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (!ui.paletteOpen) return;
    setQuery('');
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [ui.paletteOpen]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.palette-item.on');
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!ui.paletteOpen) return null;

  const close = () => setUI({ paletteOpen: false });
  const run = (command: Command) => {
    close();
    command.run();
    toast(command.label, 'info');
  };

  return (
    <>
      <div
        className="overlay"
        style={{ background: 'rgba(4,4,6,.45)', alignItems: 'flex-start', padding: 0 }}
        onPointerDown={close}
      />
      <div className="palette" onPointerDown={(event) => event.stopPropagation()}>
        <div className="palette-input-wrap">
          <Type size={15} style={{ color: 'var(--faint)' }} />
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            placeholder="搜索命令、节点或动作…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((value) => Math.min(filtered.length - 1, value + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((value) => Math.max(0, value - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const command = filtered[index];
                if (command) run(command);
              } else if (event.key === 'Escape') {
                close();
              }
            }}
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="palette-empty">没有匹配的命令。试试「生成」「导出」「设置」。</div>
          ) : (
            filtered.map((command, i) => {
              const Icon = command.icon;
              const showGroup = i === 0 || filtered[i - 1].group !== command.group;
              return (
                <div key={command.id}>
                  {showGroup ? <div className="palette-group-label">{command.group}</div> : null}
                  <button
                    className={`palette-item${i === index ? ' on' : ''}`}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => run(command)}
                  >
                    <span className="pi-icon">
                      <Icon size={13} />
                    </span>
                    <span>{command.label}</span>
                    <span className="pi-desc">{command.group}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="palette-foot">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> 选择
          </span>
          <span>
            <span className="kbd">↵</span> 执行
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <span className="kbd">⌘K</span> 打开
          </span>
        </div>
      </div>
    </>
  );
}
