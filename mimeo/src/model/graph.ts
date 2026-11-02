import { uid } from '../lib/util';
import { boundsOf, inflateRect } from './geometry';
import { createEdge, createNode } from './factory';
import type {
  CanvasDoc,
  CanvasNode,
  Edge,
  ID,
  ImageNode,
  NodeKind,
  PromptNode,
  Rect,
} from './types';

export function nodeMap(doc: CanvasDoc): Map<ID, CanvasNode> {
  return new Map(doc.nodes.map((n) => [n.id, n]));
}

export function incomingEdges(doc: CanvasDoc, nodeId: ID): Edge[] {
  return doc.edges.filter((e) => e.to === nodeId);
}

export function outgoingEdges(doc: CanvasDoc, nodeId: ID): Edge[] {
  return doc.edges.filter((e) => e.from === nodeId);
}

export function connectionExists(doc: CanvasDoc, from: ID, to: ID): boolean {
  return doc.edges.some((e) => e.from === from && e.to === to);
}

/** 防止把节点连成环（生成 / 对话节点执行时依赖 DAG） */
export function wouldCreateCycle(doc: CanvasDoc, from: ID, to: ID): boolean {
  if (from === to) return true;
  const stack = [to];
  const seen = new Set<ID>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const e of doc.edges) if (e.from === current) stack.push(e.to);
  }
  return false;
}

export function connect(doc: CanvasDoc, from: ID, to: ID): CanvasDoc | null {
  if (from === to) return null;
  if (connectionExists(doc, from, to)) return null;
  if (wouldCreateCycle(doc, from, to)) return null;
  return { ...doc, edges: [...doc.edges, createEdge(from, to)] };
}

export interface ContextText {
  nodeId: ID;
  title: string;
  role: string;
  text: string;
  depth: number;
}

export interface ContextImage {
  nodeId: ID;
  title: string;
  assetId?: ID;
  url?: string;
  caption?: string;
  depth: number;
}

export interface NodeContext {
  texts: ContextText[];
  negatives: ContextText[];
  images: ContextImage[];
  missing: ContextText[];
}

/**
 * 沿输入连线向上游收集创作上下文。
 * 提示词 / 对话输出会拼进文本，图像节点与生成结果会成为参考图。
 */
export function collectContext(
  doc: CanvasDoc,
  nodeId: ID,
  options: { maxDepth?: number; excludeRoles?: string[] } = {},
): NodeContext {
  const { maxDepth = 6, excludeRoles = [] } = options;
  const nodes = nodeMap(doc);
  const result: NodeContext = { texts: [], negatives: [], images: [], missing: [] };
  const visited = new Set<ID>([nodeId]);
  const queue: { id: ID; depth: number }[] = [];
  for (const e of doc.edges) if (e.to === nodeId) queue.push({ id: e.from, depth: 1 });

  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);
    const node = nodes.get(id);
    if (!node) continue;

    switch (node.kind) {
      case 'prompt': {
        const prompt = node as PromptNode;
        if (prompt.text.trim() && !excludeRoles.includes(prompt.role)) {
          const item: ContextText = {
            nodeId: node.id,
            title: node.title,
            role: prompt.role,
            text: prompt.text.trim(),
            depth,
          };
          if (prompt.role === 'negative') result.negatives.push(item);
          else result.texts.push(item);
        } else if (!prompt.text.trim()) {
          result.missing.push({
            nodeId: node.id,
            title: node.title,
            role: prompt.role,
            text: '',
            depth,
          });
        }
        break;
      }
      case 'chat': {
        const text = (node.output || node.prompt).trim();
        if (text) {
          result.texts.push({
            nodeId: node.id,
            title: node.title,
            role: 'assistant',
            text,
            depth,
          });
        }
        break;
      }
      case 'image': {
        const image = node as ImageNode;
        result.images.push({
          nodeId: node.id,
          title: node.title,
          assetId: image.assetId,
          url: image.url,
          caption: image.caption,
          depth,
        });
        break;
      }
      case 'generate': {
        const assetId = node.outputs[node.activeOutput] ?? node.outputs[0];
        if (assetId) {
          result.images.push({
            nodeId: node.id,
            title: node.title,
            assetId,
            caption: node.prompt,
            depth,
          });
        }
        break;
      }
      case 'video':
      case 'audio':
      case 'group':
        break;
    }

    if (node.kind !== 'group') {
      for (const e of doc.edges) if (e.to === id) queue.push({ id: e.from, depth: depth + 1 });
    }
  }

  // 近处的输入优先
  result.texts.sort((a, b) => a.depth - b.depth);
  result.negatives.sort((a, b) => a.depth - b.depth);
  result.images.sort((a, b) => a.depth - b.depth);
  return result;
}

export function composePrompt(own: string, context: NodeContext): string {
  const parts = [own.trim()];
  const seen = new Set<string>();
  if (own.trim()) seen.add(own.trim().toLowerCase());
  for (const item of context.texts) {
    const text = item.role === 'assistant' ? item.text : item.text;
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(text);
  }
  return parts.filter(Boolean).join('\n\n');
}

export function composeNegative(own: string, context: NodeContext): string {
  const parts = [own.trim(), ...context.negatives.map((n) => n.text)];
  return parts.filter(Boolean).join(', ');
}

export const RUNNABLE_KINDS: NodeKind[] = ['chat', 'generate'];

/** 生成 / 对话节点的执行顺序（上游优先），环会被跳过并返回警告 */
export function topologicalOrder(doc: CanvasDoc): { order: ID[]; cycles: ID[] } {
  const runnable = doc.nodes.filter((n) => RUNNABLE_KINDS.includes(n.kind));
  const runnableIds = new Set(runnable.map((n) => n.id));
  const edges = doc.edges.filter((e) => runnableIds.has(e.from) && runnableIds.has(e.to));
  const indeg = new Map<ID, number>();
  const adj = new Map<ID, ID[]>();
  for (const n of runnable) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const queue = runnable.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: ID[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indeg.get(next) ?? 1) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  const cycles = runnable.filter((n) => !order.includes(n.id)).map((n) => n.id);
  return { order, cycles };
}

export function childrenOfGroup(doc: CanvasDoc, groupId: ID): CanvasNode[] {
  const group = doc.nodes.find((n) => n.id === groupId && n.kind === 'group');
  if (!group || group.kind !== 'group') return [];
  const members = new Set(group.memberIds);
  return doc.nodes.filter((n) => members.has(n.id));
}

export function groupBoundsOf(doc: CanvasDoc, groupId: ID, padding = 28): Rect | null {
  const children = childrenOfGroup(doc, groupId).filter((n) => n.kind !== 'group');
  const bounds = boundsOf(children);
  return bounds ? inflateRect(bounds, padding) : null;
}

/** 克隆一组节点与它们之间的连线，自动重映射 id（用于粘贴与模板实例化） */
export function cloneSubgraph(
  nodes: CanvasNode[],
  edges: Edge[],
  offset = { x: 0, y: 0 },
): { nodes: CanvasNode[]; edges: Edge[] } {
  const idMap = new Map<ID, ID>();
  const now = Date.now();
  for (const n of nodes) idMap.set(n.id, uid(n.kind));
  const cloned = nodes.map((n) => {
    const base = {
      ...n,
      id: idMap.get(n.id)!,
      x: n.x + offset.x,
      y: n.y + offset.y,
      z: n.z + 0.5,
      createdAt: now,
      updatedAt: now,
    } as CanvasNode;
    if (base.kind === 'group') {
      return {
        ...base,
        memberIds: base.memberIds.map((id) => idMap.get(id)).filter((id): id is ID => Boolean(id)),
      };
    }
    if (base.kind === 'generate') {
      return {
        ...base,
        taskId: undefined,
        status: 'idle' as const,
        progress: 0,
        error: undefined,
      };
    }
    if (base.kind === 'chat') {
      return { ...base, taskId: undefined, status: 'idle' as const, error: undefined };
    }
    return base;
  });
  const clonedEdges = edges
    .filter((e) => idMap.has(e.from) && idMap.has(e.to))
    .map((e) => ({
      ...e,
      id: uid('e'),
      from: idMap.get(e.from)!,
      to: idMap.get(e.to)!,
      createdAt: now,
    }));
  return { nodes: cloned, edges: clonedEdges };
}

export function removeNodes(doc: CanvasDoc, ids: ID[]): CanvasDoc {
  const remove = new Set(ids);
  const nodes = doc.nodes
    .filter((n) => !remove.has(n.id))
    .map((n) => {
      if (n.kind === 'group') {
        const memberIds = n.memberIds.filter((id) => !remove.has(id));
        return memberIds.length === n.memberIds.length ? n : { ...n, memberIds };
      }
      return n;
    });
  const edges = doc.edges.filter((e) => !remove.has(e.from) && !remove.has(e.to));
  return { ...doc, nodes, edges };
}

export function removeEdges(doc: CanvasDoc, ids: ID[]): CanvasDoc {
  const remove = new Set(ids);
  return { ...doc, edges: doc.edges.filter((e) => !remove.has(e.id)) };
}

export function duplicateNodes(
  doc: CanvasDoc,
  ids: ID[],
  offset = { x: 48, y: 48 },
): { doc: CanvasDoc; newIds: ID[] } {
  const selected = doc.nodes.filter((n) => ids.includes(n.id));
  if (!selected.length) return { doc, newIds: [] };
  const idMap = new Map<ID, ID>();
  const now = Date.now();
  const clones = selected.map((n) => {
    const id = uid(n.kind);
    idMap.set(n.id, id);
    return {
      ...n,
      id,
      x: n.x + offset.x,
      y: n.y + offset.y,
      z: n.z + (n.kind === 'group' ? 0.1 : 1),
      createdAt: now,
      updatedAt: now,
      ...(n.kind === 'generate'
        ? { taskId: undefined, status: 'idle' as const, progress: 0, error: undefined }
        : {}),
      ...(n.kind === 'chat' ? { taskId: undefined, status: 'idle' as const, error: undefined } : {}),
    } as CanvasNode;
  });
  const cloned = clones.map((n) => {
    if (n.kind === 'group') {
      return {
        ...n,
        memberIds: n.memberIds.map((id) => idMap.get(id)).filter((id): id is ID => Boolean(id)),
      };
    }
    return n;
  });
  const newEdges = doc.edges
    .filter((e) => idMap.has(e.from) && idMap.has(e.to))
    .map((e) => ({ ...e, id: uid('e'), from: idMap.get(e.from)!, to: idMap.get(e.to)!, createdAt: now }));
  return {
    doc: { ...doc, nodes: [...doc.nodes, ...cloned], edges: [...doc.edges, ...newEdges] },
    newIds: clones.map((n) => n.id),
  };
}

export function makeGroup(doc: CanvasDoc, ids: ID[], title = '分组'): { doc: CanvasDoc; groupId: ID } | null {
  const members = doc.nodes.filter((n) => ids.includes(n.id) && n.kind !== 'group');
  if (members.length < 1) return null;
  const bounds = boundsOf(members);
  if (!bounds) return null;
  const minZ = Math.min(...members.map((n) => n.z));
  const group = createNode('group', {
    x: bounds.x - 32,
    y: bounds.y - 56,
    w: bounds.w + 64,
    h: bounds.h + 88,
  });
  group.title = title;
  group.z = minZ - 0.5;
  if (group.kind === 'group') group.memberIds = members.map((n) => n.id);
  const zShift = members.map((n) => ({ ...n, z: n.z + 0.5 }));
  const nodes = doc.nodes.map((n) => zShift.find((m) => m.id === n.id) ?? n);
  return { doc: { ...doc, nodes: [...nodes, { ...group, kind: 'group' } as CanvasNode] }, groupId: group.id };
}

export function syncGroupBounds(doc: CanvasDoc, groupId: ID, padding = 28): CanvasDoc {
  const group = doc.nodes.find((n) => n.id === groupId);
  if (!group || group.kind !== 'group') return doc;
  const bounds = groupBoundsOf(doc, groupId, padding);
  if (!bounds) return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === groupId
        ? {
            ...n,
            x: bounds.x,
            y: bounds.y,
            w: Math.max(bounds.w, 220),
            h: Math.max(bounds.h, 140),
            updatedAt: Date.now(),
          }
        : n,
    ),
  };
}

export function ungroup(doc: CanvasDoc, groupId: ID): CanvasDoc {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== groupId),
    edges: doc.edges.filter((e) => e.from !== groupId && e.to !== groupId),
  };
}

export function nodeTitle(node: CanvasNode): string {
  if (node.title) return node.title;
  switch (node.kind) {
    case 'prompt':
      return '提示词';
    case 'image':
      return '图像';
    case 'video':
      return '视频';
    case 'audio':
      return '音频';
    case 'generate':
      return '图像生成';
    case 'chat':
      return '对话模型';
    case 'group':
      return '分组';
  }
}

export function nodesInRect(doc: CanvasDoc, rect: Rect, filter?: (n: CanvasNode) => boolean): CanvasNode[] {
  return doc.nodes.filter((n) => {
    if (filter && !filter(n)) return false;
    return (
      n.x < rect.x + rect.w &&
      n.x + n.w > rect.x &&
      n.y < rect.y + rect.h &&
      n.y + n.h > rect.y
    );
  });
}

export function sortForRender(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((a, b) => a.z - b.z);
}
