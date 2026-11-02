import { memo, type ReactNode } from 'react';
import {
  AudioLines,
  Film,
  Frame,
  Image as ImageIcon,
  MessagesSquare,
  Sparkles,
  Type,
} from 'lucide-react';
import type { CanvasNode, NodeKind } from '../../model/types';
import { kindLabel } from '../hooks';

const ICONS: Record<NodeKind, typeof Type> = {
  prompt: Type,
  image: ImageIcon,
  video: Film,
  audio: AudioLines,
  generate: Sparkles,
  chat: MessagesSquare,
  group: Frame,
};

const RESIZE_DIRS = ['nw', 'ne', 'se', 'sw'] as const;
export type ResizeDir = (typeof RESIZE_DIRS)[number];

export interface NodeShellProps {
  node: CanvasNode;
  selected: boolean;
  zoom: number;
  children: ReactNode;
  headActions?: ReactNode;
  foot?: ReactNode;
  onNodePointerDown: (event: React.PointerEvent, node: CanvasNode) => void;
  onNodeContextMenu: (event: React.MouseEvent, node: CanvasNode) => void;
  onPortPointerDown: (event: React.PointerEvent, node: CanvasNode, side: 'left' | 'right') => void;
  onResizePointerDown: (event: React.PointerEvent, node: CanvasNode, dir: ResizeDir) => void;
  connectTarget?: 'in' | 'out' | null;
  connectInvalid?: boolean;
  connectionActive?: boolean;
}

function NodeShellInner({
  node,
  selected,
  children,
  headActions,
  foot,
  onNodePointerDown,
  onNodeContextMenu,
  onPortPointerDown,
  onResizePointerDown,
  connectTarget,
  connectInvalid,
  connectionActive,
}: NodeShellProps) {
  const Icon = ICONS[node.kind];
  const isGroup = node.kind === 'group';
  const showOut = node.kind !== 'group' && node.kind !== 'video' && node.kind !== 'audio';

  return (
    <article
      className={`node kind-${node.kind}${selected ? ' selected' : ''}${node.locked ? ' locked' : ''}`}
      data-node-id={node.id}
      data-node-kind={node.kind}
      style={{
        transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
        width: node.w,
        height: node.h,
        zIndex: Math.round(node.z * 10) + 10,
      }}
      onPointerDown={(event) => onNodePointerDown(event, node)}
      onContextMenu={(event) => onNodeContextMenu(event, node)}
    >
      <div className="node-clip">
        <div className="node-accent" />
      </div>

      {isGroup ? (
        <div className="group-head">
          <span className="node-icon" style={{ width: 18, height: 18 }}>
            <Icon size={12} strokeWidth={1.8} />
          </span>
          <span className="group-title">{node.title}</span>
          <span className="group-count">
            {node.kind === 'group' ? `${node.memberIds.length} 个节点` : ''}
          </span>
          <div className="node-head-actions pinned">{headActions}</div>
        </div>
      ) : (
        <header className="node-head">
          <span className="node-icon">
            <Icon size={12} strokeWidth={1.8} />
          </span>
          <span className="node-title">{node.title}</span>
          <span className="node-kind-label">{kindLabel[node.kind]}</span>
          <div className="node-head-actions">{headActions}</div>
        </header>
      )}

      <div className="node-body">{children}</div>
      {foot ? <div className="node-foot">{foot}</div> : null}

      {!isGroup && (
        <>
          <div
            className={`port in${connectTarget === 'in' ? ' is-target' : ''}`}
            onPointerDown={(event) => onPortPointerDown(event, node, 'left')}
            onPointerUp={(event) => event.stopPropagation()}
            title="输入：从其他节点连接到这里"
          >
            <span className="port-dot" />
          </div>
          {showOut && (
            <div
              className={`port out${connectionActive ? ' active' : ''}${connectInvalid ? ' invalid' : ''}`}
              onPointerDown={(event) => onPortPointerDown(event, node, 'right')}
              onPointerUp={(event) => event.stopPropagation()}
              title="输出：拖到其他节点建立连接"
            >
              <span className="port-dot" />
            </div>
          )}
        </>
      )}

      {selected &&
        RESIZE_DIRS.map((dir) => (
          <div
            key={dir}
            className={`resize-handle ${dir}`}
            onPointerDown={(event) => onResizePointerDown(event, node, dir)}
          />
        ))}
    </article>
  );
}

export const NodeShell = memo(NodeShellInner);
