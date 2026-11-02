import type { Camera, Doc, Point, Rect, SceneNode, Thread } from './types';

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

export function nodeAt(doc: Doc, point: Point): SceneNode | undefined {
  for (let i = doc.nodes.length - 1; i >= 0; i -= 1) {
    if (pointInRect(point, nodeRect(doc.nodes[i]))) return doc.nodes[i];
  }
  return undefined;
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
