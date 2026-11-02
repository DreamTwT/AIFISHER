import { useEffect, useRef } from 'react';
import type { Camera, CanvasDoc, CanvasNode } from '../model/types';
import { boundsOf, inflateRect } from '../model/geometry';
import { kindAccent } from './hooks';

const MAP_W = 208;
const MAP_H = 124;
const PAD = 14;

interface MinimapProps {
  doc: CanvasDoc;
  camera: Camera;
  viewport: { w: number; h: number };
  onNavigate: (world: { x: number; y: number }) => void;
  onToggle?: () => void;
}

export function Minimap({ doc, camera, viewport, onNavigate, onToggle }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = MAP_W * dpr;
    canvas.height = MAP_H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MAP_W, MAP_H);

    const viewWorld = {
      x: -camera.x / camera.zoom,
      y: -camera.y / camera.zoom,
      w: viewport.w / camera.zoom,
      h: viewport.h / camera.zoom,
    };
    const nodeBounds = boundsOf(doc.nodes) ?? { x: 0, y: 0, w: 800, h: 600 };
    const bounds = inflateRect(
      {
        x: Math.min(nodeBounds.x, viewWorld.x),
        y: Math.min(nodeBounds.y, viewWorld.y),
        w: 0,
        h: 0,
      },
      0,
    );
    bounds.w = Math.max(nodeBounds.x + nodeBounds.w, viewWorld.x + viewWorld.w) - bounds.x;
    bounds.h = Math.max(nodeBounds.y + nodeBounds.h, viewWorld.y + viewWorld.h) - bounds.y;

    const scale = Math.min((MAP_W - PAD * 2) / bounds.w, (MAP_H - PAD * 2) / bounds.h);
    const offsetX = PAD + (MAP_W - PAD * 2 - bounds.w * scale) / 2;
    const offsetY = PAD + (MAP_H - PAD * 2 - bounds.h * scale) / 2;
    const project = (x: number, y: number) => ({
      x: offsetX + (x - bounds.x) * scale,
      y: offsetY + (y - bounds.y) * scale,
    });

    // 节点
    const groups = doc.nodes.filter((n) => n.kind === 'group');
    const others = doc.nodes.filter((n) => n.kind !== 'group');
    const drawNode = (node: CanvasNode) => {
      const p = project(node.x, node.y);
      const w = Math.max(2, node.w * scale);
      const h = Math.max(2, node.h * scale);
      const accent = kindAccent[node.kind];
      ctx.globalAlpha = node.kind === 'group' ? 0.18 : 0.55;
      ctx.fillStyle = accent;
      roundRect(ctx, p.x, p.y, w, h, Math.min(3, w / 2, h / 2));
      ctx.fill();
      if (node.kind !== 'group') {
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    groups.forEach(drawNode);
    others.forEach(drawNode);

    // 视野（最后绘制，避免被节点覆盖）
    const view = project(viewWorld.x, viewWorld.y);
    ctx.fillStyle = 'rgba(232, 201, 138, 0.05)';
    ctx.strokeStyle = 'rgba(232, 201, 138, 0.75)';
    ctx.lineWidth = 1;
    ctx.fillRect(view.x, view.y, viewWorld.w * scale, viewWorld.h * scale);
    ctx.strokeRect(view.x, view.y, viewWorld.w * scale, viewWorld.h * scale);
  }, [doc, camera, viewport]);

  const navigate = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * MAP_W;
    const y = ((event.clientY - rect.top) / rect.height) * MAP_H;
    // 反推：与绘制时相同的 bounds / scale
    const viewWorld = {
      x: -camera.x / camera.zoom,
      y: -camera.y / camera.zoom,
      w: viewport.w / camera.zoom,
      h: viewport.h / camera.zoom,
    };
    const nodeBounds = boundsOf(doc.nodes) ?? { x: 0, y: 0, w: 800, h: 600 };
    const minX = Math.min(nodeBounds.x, viewWorld.x);
    const minY = Math.min(nodeBounds.y, viewWorld.y);
    const maxX = Math.max(nodeBounds.x + nodeBounds.w, viewWorld.x + viewWorld.w);
    const maxY = Math.max(nodeBounds.y + nodeBounds.h, viewWorld.y + viewWorld.h);
    const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    const scale = Math.min((MAP_W - PAD * 2) / bounds.w, (MAP_H - PAD * 2) / bounds.h);
    const offsetX = PAD + (MAP_W - PAD * 2 - bounds.w * scale) / 2;
    const offsetY = PAD + (MAP_H - PAD * 2 - bounds.h * scale) / 2;
    onNavigate({
      x: bounds.x + (x - offsetX) / scale,
      y: bounds.y + (y - offsetY) / scale,
    });
  };

  return (
    <div className="minimap" onPointerDown={(event) => event.stopPropagation()}>
      <div className="minimap-head">
        <span>Minimap</span>
        <button className="hud-btn" style={{ height: 18, fontSize: 9 }} onClick={onToggle}>
          隐藏
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="minimap-canvas"
        style={{ height: MAP_H }}
        onPointerDown={(event) => {
          event.stopPropagation();
          dragging.current = true;
          (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
          navigate(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) navigate(event);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
        }}
      />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
