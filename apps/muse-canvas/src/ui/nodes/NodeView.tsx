import { memo } from 'react';
import { MoreHorizontal, Play, Square } from 'lucide-react';
import type { CanvasNode } from '../../model/types';
import { cancelNodeRun, runNode } from '../../runtime/generation';
import type { NodeShellProps } from './NodeShell';
import { NodeShell } from './NodeShell';
import { PromptNodeView } from './PromptNodeView';
import { MediaNodeView } from './MediaNodeView';
import { GenerateNodeView } from './GenerateNodeView';
import { ChatNodeView } from './ChatNodeView';
import { GroupNodeView } from './GroupNodeView';

interface NodeViewProps {
  node: CanvasNode;
  selected: boolean;
  zoom: number;
  onNodePointerDown: NodeShellProps['onNodePointerDown'];
  onNodeContextMenu: NodeShellProps['onNodeContextMenu'];
  onPortPointerDown: NodeShellProps['onPortPointerDown'];
  onResizePointerDown: NodeShellProps['onResizePointerDown'];
  onOpenMenu: (event: React.MouseEvent, node: CanvasNode) => void;
  connectTarget?: 'in' | 'out' | null;
  connectInvalid?: boolean;
  connectionActive?: boolean;
}

function NodeViewInner({
  node,
  selected,
  zoom,
  onNodePointerDown,
  onNodeContextMenu,
  onPortPointerDown,
  onResizePointerDown,
  onOpenMenu,
  connectTarget,
  connectInvalid,
  connectionActive,
}: NodeViewProps) {
  const running =
    (node.kind === 'generate' || node.kind === 'chat') &&
    (node.status === 'running' || node.status === 'queued');
  const runnable = node.kind === 'generate' || node.kind === 'chat';

  return (
    <NodeShell
      node={node}
      selected={selected}
      zoom={zoom}
      onNodePointerDown={onNodePointerDown}
      onNodeContextMenu={onNodeContextMenu}
      onPortPointerDown={onPortPointerDown}
      onResizePointerDown={onResizePointerDown}
      connectTarget={connectTarget}
      connectInvalid={connectInvalid}
      connectionActive={connectionActive}
      headActions={
        <>
          {runnable ? (
            <button
              className="node-head-btn"
              title={running ? '停止生成' : '运行节点'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (running) cancelNodeRun(node.id);
                else void runNode(node.id);
              }}
            >
              {running ? <Square size={10} /> : <Play size={10} />}
            </button>
          ) : null}
          <button
            className="node-head-btn"
            title="更多操作"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => onOpenMenu(event, node)}
          >
            <MoreHorizontal size={12} />
          </button>
        </>
      }
    >
      {node.kind === 'prompt' && <PromptNodeView node={node} />}
      {(node.kind === 'image' || node.kind === 'video' || node.kind === 'audio') && (
        <MediaNodeView node={node} />
      )}
      {node.kind === 'generate' && <GenerateNodeView node={node} />}
      {node.kind === 'chat' && <ChatNodeView node={node} />}
      {node.kind === 'group' && <GroupNodeView node={node} />}
    </NodeShell>
  );
}

export const NodeView = memo(NodeViewInner);
