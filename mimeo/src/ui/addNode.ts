import { NODE_DEFAULTS } from '../model/factory';
import type { CanvasNode, NodeKind } from '../model/types';
import { getEditor } from '../store/editor';

export function addNodeAt(
  kind: NodeKind,
  worldX: number,
  worldY: number,
  extra: Partial<CanvasNode> = {},
): CanvasNode {
  const defaults = NODE_DEFAULTS[kind];
  const editor = getEditor();
  return editor.addNode(kind, {
    x: Math.round(worldX - defaults.w / 2),
    y: Math.round(worldY - defaults.h / 2),
    ...(extra as object),
  });
}
