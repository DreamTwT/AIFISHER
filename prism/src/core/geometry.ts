import type { Camera, Doc, Group, NodeKind, Point, Rect, SceneNode, Thread } from './types';

export function screenToWorld(point: Point, camera: Camera): Point {
  return { x: (point.x - camera.x) / camera.z, y: (point.y - camera.y) / camera.z };
}

export function worldToScreen(point: Point, camera: Camera): Point {
  return { x: point.x * camera.z + camera.x, y: point.y * camera.z + camera.y };
}

export function nodeRect(node: SceneNode): Rect {
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalizedRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** 与绘制一致的圆角矩形命中；不再把四个圆角外的透明区域算作节点。 */
export function pointInNode(point: Point, node: SceneNode, radius = 6): boolean {
  const rect = nodeRect(node);
  if (point.x < rect.x || point.x > rect.x + rect.w || point.y < rect.y || point.y > rect.y + rect.h) {
    return false;
  }
  const r = Math.max(0, Math.min(radius, rect.w / 2, rect.h / 2));
  if (!r) return true;
  const cx = Math.max(rect.x + r, Math.min(point.x, rect.x + rect.w - r));
  const cy = Math.max(rect.y + r, Math.min(point.y, rect.y + rect.h - r));
  return (point.x - cx) ** 2 + (point.y - cy) ** 2 <= r * r;
}

export function nodeAt(doc: Doc, point: Point): SceneNode | undefined {
  for (let i = doc.nodes.length - 1; i >= 0; i -= 1) {
    if (pointInNode(point, doc.nodes[i])) return doc.nodes[i];
  }
  return undefined;
}

/** 框选：只有完全落在框内的节点才会被选中，避免擦到边缘就带走整组节点。 */
export function rectContainsNode(rect: Rect, node: SceneNode, tolerance = 0): boolean {
  return (
    node.x >= rect.x - tolerance &&
    node.y >= rect.y - tolerance &&
    node.x + node.w <= rect.x + rect.w + tolerance &&
    node.y + node.h <= rect.y + rect.h + tolerance
  );
}

/** 点击编组顶部的标题带即可选中整组。 */
export function groupTitleAt(doc: Doc, point: Point, tab = 32): Group | undefined {
  const groups = doc.groups ?? [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const bounds = groupBounds(groups[i], doc);
    if (!bounds) continue;
    if (point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + tab) {
      return groups[i];
    }
  }
  return undefined;
}

export function groupBounds(group: Group, doc: Doc, padding = 20, tab = 24): Rect | undefined {
  const ids = new Set(group.nodeIds);
  const nodes = doc.nodes.filter((node) => ids.has(node.id));
  if (!nodes.length) return undefined;
  const bounds = contentBounds(nodes);
  return {
    x: bounds.x - padding,
    y: bounds.y - padding - tab,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2 + tab,
  };
}

/** 每种节点能接收哪些上游。没有可接上游的节点不画左侧接口。 */
const ACCEPTS: Record<NodeKind, NodeKind[]> = {
  prompt: [],
  render: ['prompt'],
  image: [],
  weave: ['image', 'render'],
};

export function portVisible(node: SceneNode, side: 'in' | 'out'): boolean {
  return side === 'in' ? ACCEPTS[node.kind].length > 0 : node.kind !== 'weave';
}

export function canLink(from: SceneNode, to: SceneNode): boolean {
  if (from.id === to.id) return false;
  return ACCEPTS[to.kind].includes(from.kind);
}

export function portPoint(node: SceneNode, side: 'in' | 'out'): Point {
  return { x: side === 'in' ? node.x : node.x + node.w, y: node.y + node.h * 0.5 };
}

export interface EdgeCurve {
  start: Point;
  end: Point;
  c1: Point;
  c2: Point;
  mid: Point;
}

export function edgeCurve(from: SceneNode, to: SceneNode): EdgeCurve {
  const start = portPoint(from, 'out');
  const end = portPoint(to, 'in');
  const forward = end.x - start.x;
  let c1: Point;
  let c2: Point;
  if (forward > 80) {
    const distance = Math.max(56, forward * 0.45);
    c1 = { x: start.x + distance, y: start.y };
    c2 = { x: end.x - distance, y: end.y };
  } else {
    // 反向连线：绕到节点下方/上方，避免直接折回压住卡片
    const lift = end.y >= start.y ? 1 : -1;
    const spread = Math.max(86, Math.abs(end.y - start.y) * 0.32);
    c1 = { x: start.x + 86, y: start.y + lift * spread };
    c2 = { x: end.x - 86, y: end.y + lift * spread };
  }
  const mid = cubicAt(start, c1, c2, end, 0.5);
  return { start, end, c1, c2, mid };
}

export function cubicAt(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const mt = 1 - t;
  const x = mt * mt * mt * a.x + 3 * mt * mt * t * b.x + 3 * mt * t * t * c.x + t * t * t * d.x;
  const y = mt * mt * mt * a.y + 3 * mt * mt * t * b.y + 3 * mt * t * t * c.y + t * t * t * d.y;
  return { x, y };
}

export function edgePath(curve: EdgeCurve): string {
  return `M ${curve.start.x} ${curve.start.y} C ${curve.c1.x} ${curve.c1.y}, ${curve.c2.x} ${curve.c2.y}, ${curve.end.x} ${curve.end.y}`;
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function edgeAt(doc: Doc, point: Point, threshold: number): Thread | undefined {
  const map = new Map(doc.nodes.map((node) => [node.id, node]));
  for (const thread of doc.threads) {
    const from = map.get(thread.from);
    const to = map.get(thread.to);
    if (!from || !to) continue;
    const curve = edgeCurve(from, to);
    let previous = curve.start;
    for (let i = 1; i <= 18; i += 1) {
      const next = cubicAt(curve.start, curve.c1, curve.c2, curve.end, i / 18);
      if (distanceToSegment(point, previous, next) <= threshold) return thread;
      previous = next;
    }
  }
  return undefined;
}

export function contentBounds(nodes: SceneNode[]): Rect {
  if (!nodes.length) return { x: -300, y: -200, w: 600, h: 400 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + node.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function fitCamera(nodes: SceneNode[], width: number, height: number, padding = 90): Camera {
  const bounds = contentBounds(nodes);
  const zoom = nodes.length
    ? Math.max(
        0.16,
        Math.min(1.2, Math.min((width - padding * 2) / bounds.w, (height - padding * 2) / bounds.h)),
      )
    : 1;
  return {
    x: width / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.h / 2) * zoom,
    z: zoom,
  };
}

export function snapPoint(point: Point, grid = 8): Point {
  return { x: Math.round(point.x / grid) * grid, y: Math.round(point.y / grid) * grid };
}

export function snapValue(value: number, grid = 8): number {
  return Math.round(value / grid) * grid;
}

export function intersects(rect: Rect, node: SceneNode): boolean {
  return rectsOverlap(rect, nodeRect(node));
}

/** 检查加入 from → to 后是否会形成环 */
export function wouldCycle(doc: Doc, from: string, to: string): boolean {
  if (from === to) return true;
  const outgoing = new Map<string, string[]>();
  for (const thread of doc.threads) {
    const list = outgoing.get(thread.from) ?? [];
    list.push(thread.to);
    outgoing.set(thread.from, list);
  }
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

export function upstreamIds(doc: Doc, nodeId: string): string[] {
  const incoming = new Map<string, string[]>();
  for (const thread of doc.threads) {
    const list = incoming.get(thread.to) ?? [];
    list.push(thread.from);
    incoming.set(thread.to, list);
  }
  const result: string[] = [];
  const stack = [...(incoming.get(nodeId) ?? [])];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    stack.push(...(incoming.get(id) ?? []));
  }
  return result;
}
