import { memo } from 'react';
import type { CanvasDoc, Vec } from '../model/types';
import { edgePath, portPosition } from '../model/geometry';
import { nodeMap } from '../model/graph';

export interface EdgePreview {
  from: Vec;
  to: Vec;
  valid?: boolean;
}

interface EdgesProps {
  doc: CanvasDoc;
  selectedEdges: string[];
  preview: EdgePreview | null;
  runningNodes: Set<string>;
  onSelectEdge: (id: string, additive: boolean) => void;
  onDeleteEdge: (id: string) => void;
}

function EdgesInner({
  doc,
  selectedEdges,
  preview,
  runningNodes,
  onSelectEdge,
  onDeleteEdge,
}: EdgesProps) {
  const nodes = nodeMap(doc);
  return (
    <svg className="edges-svg" aria-hidden>
      {doc.edges.map((edge) => {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        if (!from || !to) return null;
        const start = portPosition(from, 'right');
        const end = portPosition(to, 'left');
        const path = edgePath(start, end);
        const selected = selectedEdges.includes(edge.id);
        const flow = runningNodes.has(edge.to);
        return (
          <g key={edge.id} className={`edge-group${selected ? ' selected' : ''}${flow ? ' flow' : ''}`}>
            <path
              className="edge-hit"
              d={path.d}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectEdge(edge.id, event.shiftKey);
              }}
            />
            <path className="edge-path" d={path.d} />
            <path
              className="edge-arrow"
              d={`M ${end.x - 15} ${end.y - 4.5} L ${end.x - 8.5} ${end.y} L ${end.x - 15} ${end.y + 4.5}`}
            />
            {selected ? (
              <g
                className="edge-delete"
                transform={`translate(${path.mid.x}, ${path.mid.y})`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onDeleteEdge(edge.id);
                }}
              >
                <circle r="10" fill="#1c1c22" stroke="rgba(232,201,138,.7)" strokeWidth="1" />
                <path
                  d="M -3.2 -3.2 L 3.2 3.2 M 3.2 -3.2 L -3.2 3.2"
                  stroke="#e8c98a"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </g>
            ) : null}
          </g>
        );
      })}
      {preview ? (
        <path
          className="connection-preview"
          d={edgePath(preview.from, preview.to).d}
          style={
            preview.valid === false
              ? { stroke: 'var(--red)', strokeDasharray: '4 4' }
              : undefined
          }
        />
      ) : null}
    </svg>
  );
}

export const Edges = memo(EdgesInner);
