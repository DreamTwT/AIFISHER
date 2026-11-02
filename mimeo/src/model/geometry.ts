import type { Camera, CanvasNode, Rect, Vec } from './types';
import { clamp } from '../lib/util';

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;
export const GRID = 20;

export const nodeRect = (n: Pick<CanvasNode, 'x' | 'y' | 'w' | 'h'>): Rect => ({
  x: n.x,
  y: n.y,
  w: n.w,
  h: n.h,
});

export function boundsOf(nodes: Pick<CanvasNode, 'x' | 'y' | 'w' | 'h'>[]): Rect | null {
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function inflateRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function pointInRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function normalizeRect(a: Vec, b: Vec): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function screenToWorld(screen: Vec, camera: Camera, origin: Vec = { x: 0, y: 0 }): Vec {
  return {
    x: (screen.x - origin.x - camera.x) / camera.zoom,
    y: (screen.y - origin.y - camera.y) / camera.zoom,
  };
}

export function worldToScreen(world: Vec, camera: Camera, origin: Vec = { x: 0, y: 0 }): Vec {
  return {
    x: world.x * camera.zoom + camera.x + origin.x,
    y: world.y * camera.zoom + camera.y + origin.y,
  };
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

export function zoomAt(camera: Camera, screen: Vec, nextZoom: number, origin: Vec = { x: 0, y: 0 }): Camera {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(screen, camera, origin);
  return {
    zoom,
    x: screen.x - origin.x - world.x * zoom,
    y: screen.y - origin.y - world.y * zoom,
  };
}

/** 让 rect 适配到视口，返回新的相机 */
export function fitCamera(
  rect: Rect,
  viewport: { w: number; h: number },
  padding = 96,
  maxZoom = 1,
): Camera {
  if (rect.w <= 0 || rect.h <= 0) return { x: viewport.w / 2, y: viewport.h / 2, zoom: 1 };
  const zoom = clamp(
    Math.min((viewport.w - padding * 2) / rect.w, (viewport.h - padding * 2) / rect.h),
    MIN_ZOOM,
    maxZoom,
  );
  return {
    zoom,
    x: (viewport.w - rect.w * zoom) / 2 - rect.x * zoom,
    y: (viewport.h - rect.h * zoom) / 2 - rect.y * zoom,
  };
}

export function centerOn(rect: Rect, viewport: { w: number; h: number }, zoom: number): Camera {
  return {
    zoom,
    x: viewport.w / 2 - (rect.x + rect.w / 2) * zoom,
    y: viewport.h / 2 - (rect.y + rect.h / 2) * zoom,
  };
}

export interface EdgeGeometry {
  d: string;
  mid: Vec;
}

/** 端口位置：左侧输入，右侧输出 */
export function portPosition(node: CanvasNode, side: 'left' | 'right'): Vec {
  return {
    x: node.x + (side === 'right' ? node.w : 0),
    y: node.y + node.h / 2,
  };
}

export function edgePath(from: Vec, to: Vec): EdgeGeometry {
  const dx = Math.max(48, Math.abs(to.x - from.x) * 0.5);
  const c1 = { x: from.x + dx, y: from.y };
  const c2 = { x: to.x - dx, y: to.y };
  return {
    d: `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`,
    mid: {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
    },
  };
}

export function snapToGrid(value: number, size = GRID): number {
  return Math.round(value / size) * size;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: { axis: 'x' | 'y'; at: number; from: number; to: number }[];
}

/**
 * 对齐吸附：以拖动矩形与其他节点的边缘/中线做比较，
 * 阈值按屏幕像素折算，保证任何缩放级别手感一致。
 */
export function computeSnap(
  moving: Rect,
  others: Rect[],
  threshold: number,
  options: { grid: boolean; zoom: number },
): SnapResult {
  const result: SnapResult = { dx: 0, dy: 0, guides: [] };
  if (!others.length && !options.grid) return result;
  const t = threshold;
  const movingX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const movingY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  let bestX: { delta: number; guide: SnapResult['guides'][number] } | null = null;
  let bestY: { delta: number; guide: SnapResult['guides'][number] } | null = null;

  for (const r of others) {
    const targetX = [r.x, r.x + r.w / 2, r.x + r.w];
    const targetY = [r.y, r.y + r.h / 2, r.y + r.h];
    for (const mx of movingX) {
      for (const tx of targetX) {
        const delta = tx - mx;
        if (Math.abs(delta) <= t && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          const top = Math.min(moving.y, r.y);
          const bottom = Math.max(moving.y + moving.h, r.y + r.h);
          bestX = { delta, guide: { axis: 'x', at: tx, from: top, to: bottom } };
        }
      }
    }
    for (const my of movingY) {
      for (const ty of targetY) {
        const delta = ty - my;
        if (Math.abs(delta) <= t && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          const left = Math.min(moving.x, r.x);
          const right = Math.max(moving.x + moving.w, r.x + r.w);
          bestY = { delta, guide: { axis: 'y', at: ty, from: left, to: right } };
        }
      }
    }
  }

  if (bestX) {
    result.dx = bestX.delta;
    result.guides.push(bestX.guide);
  } else if (options.grid) {
    result.dx = snapToGrid(moving.x) - moving.x;
  }
  if (bestY) {
    result.dy = bestY.delta;
    result.guides.push(bestY.guide);
  } else if (options.grid) {
    result.dy = snapToGrid(moving.y) - moving.y;
  }
  return result;
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
