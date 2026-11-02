import { useEffect, useRef } from 'react';
import {
  Copy,
  Download,
  Frame,
  Group as GroupIcon,
  Image as ImageIcon,
  ImagePlus,
  Lock,
  Maximize,
  MessageSquarePlus,
  Play,
  Sparkles,
  Trash2,
  Type,
  Ungroup,
  Unlock,
  ArrowUpToLine,
  ArrowDownToLine,
  Settings2,
} from 'lucide-react';
import { getEditor } from '../store/editor';
import { setUI, toast } from '../store/ui';
import { runAllNodes, runNode } from '../runtime/generation';
import { exportPng } from '../lib/exports';
import { copyText, downloadBlob } from '../lib/util';
import { getAssetBlob, getAssetUrl } from '../store/assets';
import { emit } from './bus';
import { useUIState } from './hooks';
import { addNodeAt } from './addNode';

export function ContextMenu() {
  const ui = useUIState();
  const menu = ui.contextMenu;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setUI({ contextMenu: null });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu) return null;
  const editor = getEditor();
  const node = menu.nodeId ? editor.getNode(menu.nodeId) : undefined;
  const edge = menu.edgeId ? editor.getSnapshot().project.doc.edges.find((e) => e.id === menu.edgeId) : undefined;
  const x = Math.min(menu.x, window.innerWidth - 230);
  const y = Math.min(menu.y, window.innerHeight - 380);
  const close = () => setUI({ contextMenu: null });

  const action = (fn: () => void) => () => {
    fn();
    close();
  };

  if (node) {
    const isGenerate = node.kind === 'generate';
    const assetId = node.kind === 'generate' ? node.outputs[node.activeOutput] : node.kind === 'image' ? node.assetId : undefined;
    return (
      <div className="context-menu" ref={ref} style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
        <div className="menu-label">{node.title || '节点'}</div>
        {(node.kind === 'generate' || node.kind === 'chat') && (
          <button className="menu-item" onClick={action(() => void runNode(node.id))}>
            <Play size={13} className="menu-icon" /> 运行节点
          </button>
        )}
        <button className="menu-item" onClick={action(() => editor.duplicateSelection())}>
          <Copy size={13} className="menu-icon" /> 复制 <span className="shortcut">⌘D</span>
        </button>
        {node.kind === 'prompt' && (
          <button
            className="menu-item"
            onClick={action(() => {
              void copyText(node.text);
              toast('提示词已复制', 'success');
            })}
          >
            <Copy size={13} className="menu-icon" /> 复制文字
          </button>
        )}
        {node.kind === 'generate' && (
          <button
            className="menu-item"
            onClick={action(() => {
              void copyText(node.prompt);
              toast('提示词已复制', 'success');
            })}
          >
            <Copy size={13} className="menu-icon" /> 复制提示词
          </button>
        )}
        {assetId && (
          <button
            className="menu-item"
            onClick={action(() => {
              const url = getAssetUrl(assetId);
              if (url) emit('asset:open', { assetId, url, title: node.title });
            })}
          >
            <Maximize size={13} className="menu-icon" /> 查看大图
          </button>
        )}
        {assetId && (
          <button
            className="menu-item"
            onClick={action(() => {
              const blob = getAssetBlob(assetId);
              if (blob) downloadBlob(blob, `${node.title || 'asset'}.${blob.type.split('/')[1] ?? 'png'}`);
              else toast('素材不可用', 'error');
            })}
          >
            <Download size={13} className="menu-icon" /> 下载图片
          </button>
        )}
        <div className="menu-sep" />
        {node.kind === 'group' ? (
          <button className="menu-item" onClick={action(() => editor.ungroupSelection())}>
            <Ungroup size={13} className="menu-icon" /> 取消分组
          </button>
        ) : (
          <button
            className="menu-item"
            onClick={action(() => {
              if (editor.getSnapshot().selection.length < 2) {
                toast('至少选择两个节点才能分组', 'info');
                return;
              }
              editor.groupSelection();
            })}
          >
            <GroupIcon size={13} className="menu-icon" /> 创建分组
          </button>
        )}
        <button className="menu-item" onClick={action(() => editor.bringToFront())}>
          <ArrowUpToLine size={13} className="menu-icon" /> 置于顶层
        </button>
        <button className="menu-item" onClick={action(() => editor.sendToBack())}>
          <ArrowDownToLine size={13} className="menu-icon" /> 置于底层
        </button>
        <button
          className="menu-item"
          onClick={action(() =>
            editor.patchNode(node.id, { locked: !node.locked }, { label: node.locked ? '解锁' : '锁定' }),
          )}
        >
          {node.locked ? <Unlock size={13} className="menu-icon" /> : <Lock size={13} className="menu-icon" />}
          {node.locked ? '解锁' : '锁定'}
        </button>
        <button className="menu-item" onClick={action(() => emit('settings:open', {}))}>
          <Settings2 size={13} className="menu-icon" /> 节点设置
        </button>
        <div className="menu-sep" />
        <button className="menu-item danger" onClick={action(() => editor.deleteSelection())}>
          <Trash2 size={13} className="menu-icon" /> 删除 <span className="shortcut">Del</span>
        </button>
      </div>
    );
  }

  if (edge) {
    return (
      <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
        <button className="menu-item danger" onClick={action(() => editor.deleteEdge(edge.id))}>
          <Trash2 size={13} className="menu-icon" /> 删除连线
        </button>
      </div>
    );
  }

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      <div className="menu-label">添加到画布</div>
      <button className="menu-item" onClick={action(() => addNodeAt('prompt', menu.worldX, menu.worldY))}>
        <Type size={13} className="menu-icon" /> 提示词
      </button>
      <button className="menu-item" onClick={action(() => addNodeAt('generate', menu.worldX, menu.worldY))}>
        <Sparkles size={13} className="menu-icon" /> 图像生成
      </button>
      <button className="menu-item" onClick={action(() => addNodeAt('chat', menu.worldX, menu.worldY))}>
        <MessageSquarePlus size={13} className="menu-icon" /> 对话模型
      </button>
      <button className="menu-item" onClick={action(() => addNodeAt('image', menu.worldX, menu.worldY))}>
        <ImagePlus size={13} className="menu-icon" /> 图像节点
      </button>
      <button className="menu-item" onClick={action(() => addNodeAt('group', menu.worldX, menu.worldY))}>
        <Frame size={13} className="menu-icon" /> 空白分组
      </button>
      <div className="menu-sep" />
      <button className="menu-item" onClick={action(() => void runAllNodes())}>
        <Play size={13} className="menu-icon" /> 运行整张画布
      </button>
      <button className="menu-item" onClick={action(() => void exportPng('view'))}>
        <ImageIcon size={13} className="menu-icon" /> 导出当前视图
      </button>
      <button className="menu-item" onClick={action(() => emit('canvas:fit', { target: 'all' }))}>
        <Maximize size={13} className="menu-icon" /> 适应画布 <span className="shortcut">⌘0</span>
      </button>
    </div>
  );
}
