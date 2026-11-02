import { createNode } from '../model/factory';
import type { CanvasNode, NodeKind } from '../model/types';
import { getEditor } from '../store/editor';

/** 在画布可视区域中心创建节点，并轻微错开避免重叠 */
export function insertNodeAtViewportCenter(kind: NodeKind, extra: Partial<CanvasNode> = {}): CanvasNode {
  const editor = getEditor();
  const host = document.querySelector<HTMLElement>('.canvas-host');
  const rect = host?.getBoundingClientRect();
  const camera = editor.getSnapshot().project.camera;
  const centerX = ((rect?.width ?? 1200) / 2 - camera.x) / camera.zoom;
  const centerY = ((rect?.height ?? 800) / 2 - camera.y) / camera.zoom;
  const base = createNode(kind, {});
  const jitter = (editor.getSnapshot().project.doc.nodes.length % 6) * 18;
  const node = editor.addNode(kind, {
    x: Math.round(centerX - base.w / 2 + jitter),
    y: Math.round(centerY - base.h / 2 + jitter),
    ...(extra as object),
  });
  return node;
}

export function focusNode(id: string) {
  const editor = getEditor();
  editor.select(id);
  const node = editor.getNode(id);
  if (!node) return;
  const host = document.querySelector<HTMLElement>('.canvas-host');
  const rect = host?.getBoundingClientRect();
  if (!rect) return;
  const zoom = Math.min(1, Math.max(0.5, cameraZoom()));
  editor.setCamera({
    zoom,
    x: rect.width / 2 - (node.x + node.w / 2) * zoom,
    y: rect.height / 2 - (node.y + node.h / 2) * zoom,
  });
}

function cameraZoom(): number {
  return getEditor().getSnapshot().project.camera.zoom;
}
