import { useEffect, useRef } from 'react';
import {
  Frame,
  Image as ImageIcon,
  ImagePlus,
  MessageSquarePlus,
  Sparkles,
  Type,
} from 'lucide-react';
import type { NodeKind } from '../model/types';
import { getEditor } from '../store/editor';
import { setUI, toast } from '../store/ui';
import { NODE_DEFAULTS } from '../model/factory';
import { getSettings } from '../store/settings';
import { runNode } from '../runtime/generation';
import { useUIState } from './hooks';

const ITEMS: { kind: NodeKind; label: string; hint: string; icon: typeof Type }[] = [
  { kind: 'prompt', label: '提示词', hint: '文字输入 · 文本上下文', icon: Type },
  { kind: 'generate', label: '图像生成', hint: '文生图 / 图生图', icon: Sparkles },
  { kind: 'chat', label: '对话模型', hint: '分镜、脚本、提示词扩写', icon: MessageSquarePlus },
  { kind: 'image', label: '图像节点', hint: '上传或引用一张图', icon: ImagePlus },
  { kind: 'group', label: '分组', hint: '把相关节点收在一起', icon: Frame },
];

export function NodeMenu() {
  const ui = useUIState();
  const menu = ui.nodeMenu;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setUI({ nodeMenu: null });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 260);
  const y = Math.min(menu.y, window.innerHeight - 330);

  const create = (kind: NodeKind) => {
    const editor = getEditor();
    const defaults = NODE_DEFAULTS[kind];
    const node = editor.addNode(kind, {
      x: Math.round(menu.worldX - defaults.w / 2),
      y: Math.round(menu.worldY - defaults.h / 2),
    });
    if (menu.connectFrom) {
      const ok = editor.connectNodes(menu.connectFrom, node.id);
      if (ok) {
        toast('已创建节点并连接', 'success');
        const autoRun =
          node.kind === 'generate' ? node.autoRun || getSettings().autoRunOnConnect : getSettings().autoRunOnConnect;
        if ((node.kind === 'generate' || node.kind === 'chat') && autoRun) {
          void runNode(node.id);
        }
      } else {
        toast(editor.canConnect(menu.connectFrom, node.id).reason ?? '连接失败', 'error');
      }
    }
    setUI({ nodeMenu: null });
  };

  return (
    <div
      className="context-menu"
      ref={ref}
      style={{ left: x, top: y, minWidth: 260 }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="menu-label">创建并连接</div>
      {ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button key={item.kind} className="menu-item" onClick={() => create(item.kind)}>
            <Icon size={14} className="menu-icon" />
            <span style={{ flex: 1 }}>
              {item.label}
              <span style={{ display: 'block', color: 'var(--faint)', fontSize: 9.5 }}>{item.hint}</span>
            </span>
          </button>
        );
      })}
      <div className="menu-sep" />
      <button className="menu-item" onClick={() => setUI({ nodeMenu: null })}>
        <ImageIcon size={13} className="menu-icon" /> 取消
      </button>
    </div>
  );
}
