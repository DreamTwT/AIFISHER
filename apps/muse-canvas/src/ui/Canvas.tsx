import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ChevronDown,
  Copy,
  Crosshair,
  Grid3x3,
  Group as GroupIcon,
  Magnet,
  Maximize,
  Minus,
  MousePointer2,
  Play,
  Plus,
  Trash2,
  Ungroup,
} from 'lucide-react';
import type { Camera, CanvasNode, ID, Rect, Vec } from '../model/types';
import {
  boundsOf,
  clampZoom,
  computeSnap,
  fitCamera,
  inflateRect,
  normalizeRect,
  zoomAt,
} from '../model/geometry';
import { getEditor } from '../store/editor';
import { setUI, toast } from '../store/ui';
import { getSettings, updateSettings } from '../store/settings';
import { addAsset } from '../store/assets';
import { runSelectedNodes, runningNodeIds } from '../runtime/generation';
import { on } from './bus';
import { useEditorState, useSettings } from './hooks';
import { Edges } from './Edges';
import { NodeView } from './nodes/NodeView';
import { Minimap } from './Minimap';
import type { ResizeDir } from './nodes/NodeShell';

interface CanvasProps {
  tool: 'select' | 'hand';
  setTool: (tool: 'select' | 'hand') => void;
  inspectorOpen: boolean;
}

type Gesture =
  | { type: 'pan'; pointerId: number; startClient: Vec; startCamera: Camera }
  | { type: 'marquee'; pointerId: number; startWorld: Vec; base: ID[] }
  | {
      type: 'node';
      pointerId: number;
      startClient: Vec;
      ids: ID[];
      start: Map<ID, Vec>;
      moved: boolean;
      captured?: boolean;
    }
  | {
      type: 'resize';
      pointerId: number;
      nodeId: ID;
      dir: ResizeDir;
      startClient: Vec;
      startRect: Rect;
      zoom: number;
      moved: boolean;
    }
  | {
      type: 'connect';
      pointerId: number;
      from: ID;
      fromPoint: Vec;
      startClient: Vec;
      moved: boolean;
      targetId?: ID;
      valid?: boolean;
    };

const MIN_W = 200;
const MIN_H = 132;

function groupMembersOf(node: CanvasNode, nodes: CanvasNode[], out = new Set<ID>()): Set<ID> {
  if (node.kind !== 'group') return out;
  for (const id of node.memberIds) {
    if (out.has(id)) continue;
    out.add(id);
    const child = nodes.find((n) => n.id === id);
    if (child?.kind === 'group') groupMembersOf(child, nodes, out);
  }
  return out;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'button, input, textarea, select, a, audio, video, [contenteditable="true"], [data-no-drag]',
    ),
  );
}

export function Canvas({ tool, setTool, inspectorOpen }: CanvasProps) {
  const state = useEditorState();
  const settings = useSettings();
  const editor = getEditor();
  const doc = state.project.doc;
  const selection = state.selection;
  const selectedEdges = state.edgeSelection;
  const hostRef = useRef<HTMLDivElement>(null);

  const [camera, setCameraState] = useState<Camera>(() => state.project.camera);
  const cameraRef = useRef(camera);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const viewportRef = useRef(viewport);
  const [activeGesture, setActiveGesture] = useState<Gesture['type'] | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<{ axis: 'x' | 'y'; at: number; from: number; to: number }[]>([]);
  const [preview, setPreview] = useState<{ from: Vec; to: Vec; valid?: boolean } | null>(null);
  const [connectTarget, setConnectTarget] = useState<{ id: ID; valid: boolean } | null>(null);
  const [zoomMenu, setZoomMenu] = useState(false);
  const [hoverWorld, setHoverWorld] = useState<Vec | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pointerClient = useRef<Vec>({ x: 0, y: 0 });
  const spaceDown = useRef(false);
  const dragOver = useRef(false);

  const setCamera = useCallback((next: Camera | ((prev: Camera) => Camera)) => {
    const value = typeof next === 'function' ? next(cameraRef.current) : next;
    const safe = { ...value, zoom: clampZoom(value.zoom) };
    cameraRef.current = safe;
    setCameraState(safe);
  }, []);

  const toWorld = useCallback((clientX: number, clientY: number): Vec => {
    const rect = hostRef.current?.getBoundingClientRect();
    const cam = cameraRef.current;
    return {
      x: (clientX - (rect?.left ?? 0) - cam.x) / cam.zoom,
      y: (clientY - (rect?.top ?? 0) - cam.y) / cam.zoom,
    };
  }, []);

  // 相机持久化（节流）
  useEffect(() => {
    const timer = setTimeout(() => editor.setCamera(camera), 300);
    return () => clearTimeout(timer);
  }, [camera, editor]);

  // 切换工程时重置视角
  const projectIdRef = useRef(state.project.id);
  useEffect(() => {
    if (projectIdRef.current !== state.project.id) {
      projectIdRef.current = state.project.id;
      setCamera(state.project.camera);
    }
  }, [state.project.id, state.project.camera, setCamera]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = { w: entry.contentRect.width, h: entry.contentRect.height };
      viewportRef.current = next;
      setViewport(next);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const fitAll = useCallback(
    (padding = 96, maxZoom = 1) => {
      const bounds = boundsOf(doc.nodes);
      if (!bounds) return;
      setCamera({ ...fitCamera(bounds, viewportRef.current, padding, maxZoom), auto: false });
    },
    [doc.nodes, setCamera],
  );

  // 首次打开或新建模板时，按真实视口重新适配（避免不同屏幕下内容被裁切）
  const autoFitRef = useRef<string>('');
  useEffect(() => {
    if (viewport.w < 10 || viewport.h < 10) return;
    if (!state.project.camera.auto) return;
    if (autoFitRef.current === state.project.id) return;
    autoFitRef.current = state.project.id;
    const bounds = boundsOf(doc.nodes);
    if (!bounds) return;
    const next = { ...fitCamera(bounds, viewport, 100, 0.92), auto: false };
    setCamera(next);
    editor.setCamera(next);
  }, [viewport, state.project.id, state.project.camera.auto, doc.nodes, setCamera, editor]);

  const fitSelection = useCallback(() => {
    const nodes = doc.nodes.filter((n) => selection.includes(n.id));
    const bounds = boundsOf(nodes);
    if (!bounds) {
      fitAll();
      return;
    }
    setCamera(fitCamera(inflateRect(bounds, 40), viewportRef.current, 80, 1.2));
  }, [doc.nodes, selection, fitAll, setCamera]);

  const zoomTo = useCallback(
    (zoom: number, anchor?: Vec) => {
      const center = anchor ?? { x: viewportRef.current.w / 2, y: viewportRef.current.h / 2 };
      setCamera((cam) => zoomAt(cam, center, zoom));
    },
    [setCamera],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      setCamera((cam) =>
        zoomAt(cam, { x: viewportRef.current.w / 2, y: viewportRef.current.h / 2 }, cam.zoom * factor),
      );
    },
    [setCamera],
  );

  const focusNode = useCallback(
    (id: ID) => {
      const node = doc.nodes.find((n) => n.id === id);
      if (!node) return;
      const zoom = Math.max(0.55, Math.min(1, cameraRef.current.zoom));
      setCamera({
        zoom,
        x: viewportRef.current.w / 2 - (node.x + node.w / 2) * zoom,
        y: viewportRef.current.h / 2 - (node.y + node.h / 2) * zoom,
      });
    },
    [doc.nodes, setCamera],
  );

  // 外部命令
  useEffect(() => {
    const offFit = on('canvas:fit', ({ target }) => {
      if (target === 'selection') fitSelection();
      else fitAll();
    });
    const offZoom = on('canvas:zoom', ({ step, value }) => {
      if (typeof value === 'number') zoomTo(value);
      else if (step) zoomBy(step > 0 ? 1.2 : 1 / 1.2);
    });
    const offCenter = on('canvas:center', ({ x, y, zoom }) => {
      const z = zoom ?? cameraRef.current.zoom;
      setCamera({
        zoom: z,
        x: viewportRef.current.w / 2 - x * z,
        y: viewportRef.current.h / 2 - y * z,
      });
    });
    return () => {
      offFit();
      offZoom();
      offCenter();
    };
  }, [fitAll, fitSelection, zoomBy, zoomTo, setCamera]);

  // 空格临时抓手
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isInteractiveTarget(event.target)) {
        spaceDown.current = true;
        hostRef.current?.classList.add('grabbing');
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceDown.current = false;
        hostRef.current?.classList.remove('grabbing');
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // 滚轮：Ctrl / ⌘ / Alt 缩放，其余平移
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handler = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        event.preventDefault();
        const rect = host.getBoundingClientRect();
        const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const factor = Math.exp(-event.deltaY * 0.0018);
        setCamera((cam) => zoomAt(cam, anchor, cam.zoom * factor));
      } else {
        event.preventDefault();
        const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        setCamera((cam) => ({ ...cam, x: cam.x - dx, y: cam.y - dy }));
      }
    };
    host.addEventListener('wheel', handler, { passive: false });
    return () => host.removeEventListener('wheel', handler);
  }, [setCamera]);

  const moveIdsFor = useCallback(
    (node: CanvasNode, baseSelection: ID[]): { ids: ID[]; start: Map<ID, Vec> } => {
      const set = new Set<ID>();
      const list = baseSelection.includes(node.id) ? baseSelection : [node.id];
      for (const id of list) {
        const target = doc.nodes.find((n) => n.id === id);
        if (!target) continue;
        set.add(id);
        if (target.kind === 'group') {
          for (const member of groupMembersOf(target, doc.nodes)) set.add(member);
        }
      }
      const start = new Map<ID, Vec>();
      for (const id of set) {
        const n = doc.nodes.find((x) => x.id === id);
        if (n) start.set(id, { x: n.x, y: n.y });
      }
      return { ids: [...set], start };
    },
    [doc.nodes],
  );

  const onNodePointerDown = useCallback(
    (event: React.PointerEvent, node: CanvasNode) => {
      if (event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;
      if (spaceDown.current || tool === 'hand') return;
      event.stopPropagation();

      let base: ID[];
      if (event.shiftKey) {
        const wasSelected = selection.includes(node.id);
        editor.select(node.id, { toggle: true });
        if (wasSelected) return;
        base = [...new Set([...selection, node.id])];
      } else if (selection.includes(node.id)) {
        base = selection;
      } else {
        editor.select(node.id);
        base = [node.id];
      }
      if (node.locked) return;

      const { ids, start } = moveIdsFor(node, base);
      editor.beginGesture(node.kind === 'group' ? '移动分组' : '移动节点');
      gestureRef.current = {
        type: 'node',
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        ids,
        start,
        moved: false,
      };
      setActiveGesture('node');
    },
    [editor, moveIdsFor, selection, tool],
  );

  const onPortPointerDown = useCallback(
    (event: React.PointerEvent, node: CanvasNode, side: 'left' | 'right') => {
      event.stopPropagation();
      if (event.button !== 0) return;
      if (side === 'left') {
        const edge = doc.edges.find((e) => e.to === node.id);
        if (edge) {
          editor.selectEdges(edge.id);
          toast('已选中这条输入连线，按 Delete 可删除', 'info');
        } else {
          toast('从其他节点右侧的输出圆点拖到这里即可连接', 'info');
        }
        return;
      }
      hostRef.current?.setPointerCapture(event.pointerId);
      const fromPoint = { x: node.x + node.w, y: node.y + node.h / 2 };
      gestureRef.current = {
        type: 'connect',
        pointerId: event.pointerId,
        from: node.id,
        fromPoint,
        startClient: { x: event.clientX, y: event.clientY },
        moved: false,
      };
      const world = toWorld(event.clientX, event.clientY);
      setPreview({ from: fromPoint, to: world, valid: true });
      setActiveGesture('connect');
    },
    [doc.edges, editor, toWorld],
  );

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent, node: CanvasNode, dir: ResizeDir) => {
      event.stopPropagation();
      if (event.button !== 0 || node.locked) return;
      hostRef.current?.setPointerCapture(event.pointerId);
      editor.select(node.id);
      editor.beginGesture('调整节点大小');
      gestureRef.current = {
        type: 'resize',
        pointerId: event.pointerId,
        nodeId: node.id,
        dir,
        startClient: { x: event.clientX, y: event.clientY },
        startRect: { x: node.x, y: node.y, w: node.w, h: node.h },
        zoom: cameraRef.current.zoom,
        moved: false,
      };
      setActiveGesture('resize');
    },
    [editor],
  );

  const onHostPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button === 2) return;
      const isPan = event.button === 1 || tool === 'hand' || spaceDown.current;
      const insideNode = (event.target as HTMLElement | null)?.closest?.('.node');
      if (!isPan && insideNode) return;
      const host = hostRef.current;
      if (!host) return;
      if (isPan) {
        event.preventDefault();
        host.setPointerCapture(event.pointerId);
        gestureRef.current = {
          type: 'pan',
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          startCamera: { ...cameraRef.current },
        };
        setActiveGesture('pan');
        return;
      }
      if (event.button !== 0) return;
      const world = toWorld(event.clientX, event.clientY);
      const base = event.shiftKey ? selection : [];
      if (!event.shiftKey) editor.clearSelection();
      host.setPointerCapture(event.pointerId);
      gestureRef.current = {
        type: 'marquee',
        pointerId: event.pointerId,
        startWorld: world,
        base,
      };
      setMarquee({ x: world.x, y: world.y, w: 0, h: 0 });
      setActiveGesture('marquee');
    },
    [editor, selection, toWorld, tool],
  );

  const finishGesture = useCallback(
    (event: React.PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gestureRef.current = null;
      setActiveGesture(null);
      setGuides([]);
      setPreview(null);
      setConnectTarget(null);
      setMarquee(null);
      const host = hostRef.current;
      if (host?.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId);

      if (gesture.type === 'pan') {
        editor.setCamera(cameraRef.current);
        return;
      }
      if (gesture.type === 'node') {
        if (gesture.moved) {
          const movedIds = new Set(gesture.ids);
          editor.updateGesture((current) => {
            let next = current;
            for (const group of current.nodes) {
              if (group.kind !== 'group') continue;
              if (group.memberIds.some((id) => movedIds.has(id))) {
                next = {
                  ...next,
                  nodes: next.nodes.map((n) => {
                    if (n.id !== group.id || n.kind !== 'group') return n;
                    const members = next.nodes.filter(
                      (m) => n.memberIds.includes(m.id) && m.kind !== 'group',
                    );
                    const bounds = boundsOf(members);
                    if (!bounds) return n;
                    return {
                      ...n,
                      x: bounds.x - 28,
                      y: bounds.y - 44,
                      w: Math.max(240, bounds.w + 56),
                      h: Math.max(160, bounds.h + 72),
                    };
                  }),
                };
              }
            }
            return next;
          });
        }
        editor.commitGesture();
        return;
      }
      if (gesture.type === 'resize') {
        editor.commitGesture();
        return;
      }
      if (gesture.type === 'connect') {
        if (!gesture.moved) return;
        if (gesture.targetId) {
          if (gesture.valid) {
            const ok = editor.connectNodes(gesture.from, gesture.targetId);
            if (ok) {
              toast('已连接', 'success');
              const target = editor.getNode(gesture.targetId);
              const autoRun =
                target?.kind === 'generate'
                  ? target.autoRun || getSettings().autoRunOnConnect
                  : getSettings().autoRunOnConnect;
              if (target && (target.kind === 'generate' || target.kind === 'chat') && autoRun) {
                void import('../runtime/generation').then((mod) => mod.runNode(target.id));
              }
            }
          } else {
            const reason = editor.canConnect(gesture.from, gesture.targetId).reason;
            toast(reason ?? '无法连接这两个节点', 'error');
          }
        } else {
          const world = toWorld(event.clientX, event.clientY);
          setUI({
            nodeMenu: {
              x: event.clientX,
              y: event.clientY,
              worldX: world.x,
              worldY: world.y,
              connectFrom: gesture.from,
            },
          });
        }
        return;
      }
      if (gesture.type === 'marquee') {
        const rect = normalizeRect(gesture.startWorld, toWorld(event.clientX, event.clientY));
        if (rect.w > 3 || rect.h > 3) {
          const picked = doc.nodes
            .filter((n) => n.kind !== 'group' && rectIntersectsNode(rect, n))
            .map((n) => n.id);
          editor.select([...new Set([...gesture.base, ...picked])]);
        }
      }
    },
    [doc.nodes, editor, toWorld],
  );

  const grantResize = useCallback(
    (nodeId: ID, rect: Rect) => {
      editor.updateGesture((current) => ({
        ...current,
        nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, ...rect } : n)),
      }));
    },
    [editor],
  );

  const onHostPointerMove = useCallback(
    (event: React.PointerEvent) => {
      pointerClient.current = { x: event.clientX, y: event.clientY };
      const world = toWorld(event.clientX, event.clientY);
      setHoverWorld(world);
      const gesture = gestureRef.current;
      if (!gesture) return;
      const startClient = 'startClient' in gesture ? gesture.startClient : null;
      const dx = startClient ? event.clientX - startClient.x : 0;
      const dy = startClient ? event.clientY - startClient.y : 0;

      if (gesture.type === 'pan') {
        setCamera({ ...gesture.startCamera, x: gesture.startCamera.x + dx, y: gesture.startCamera.y + dy });
        return;
      }

      if (gesture.type === 'node') {
        const z = cameraRef.current.zoom;
        let dxWorld = dx / z;
        let dyWorld = dy / z;
        if (!gesture.moved && Math.abs(dx) + Math.abs(dy) > 3) {
          gesture.moved = true;
          // 拖拽真正开始后再捕获指针：按下就捕获会让 click/dblclick 改投到画布，
          // 节点里的图片、链接等交互会全部失效。
          hostRef.current?.setPointerCapture(event.pointerId);
          gesture.captured = true;
        }
        const moving = [...gesture.start.entries()].map(([id, start]) => {
          const node = doc.nodes.find((n) => n.id === id)!;
          return { ...node, x: start.x + dxWorld, y: start.y + dyWorld };
        });
        const movingRect = boundsOf(moving);
        if (movingRect && (settings.snap || settings.grid)) {
          const idSet = new Set(gesture.ids);
          const others = doc.nodes
            .filter((n) => !idSet.has(n.id) && n.kind !== 'group' && !n.locked)
            .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
          const snap = computeSnap(movingRect, others, 6 / z, {
            grid: settings.grid,
            zoom: z,
          });
          dxWorld += snap.dx;
          dyWorld += snap.dy;
          setGuides(snap.guides);
        } else {
          setGuides([]);
        }
        editor.updateGesture((current) => ({
          ...current,
          nodes: current.nodes.map((n) => {
            const startPos = gesture.start.get(n.id);
            if (!startPos) return n;
            return { ...n, x: startPos.x + dxWorld, y: startPos.y + dyWorld };
          }),
        }));
        return;
      }

      if (gesture.type === 'resize') {
        const z = gesture.zoom;
        const ddx = dx / z;
        const ddy = dy / z;
        const rect = gesture.startRect;
        let { x, y, w, h } = rect;
        if (gesture.dir.includes('e')) w = Math.max(MIN_W, rect.w + ddx);
        if (gesture.dir.includes('s')) h = Math.max(MIN_H, rect.h + ddy);
        if (gesture.dir.includes('w')) {
          w = Math.max(MIN_W, rect.w - ddx);
          x = rect.x + rect.w - w;
        }
        if (gesture.dir.includes('n')) {
          h = Math.max(MIN_H, rect.h - ddy);
          y = rect.y + rect.h - h;
        }
        grantResize(gesture.nodeId, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
        gesture.moved = Math.abs(ddx) + Math.abs(ddy) > 2;
        return;
      }

      if (gesture.type === 'connect') {
        if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
        let targetId: ID | undefined;
        let valid = false;
        const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        const nodeEl = el?.closest('[data-node-id]') as HTMLElement | null;
        if (nodeEl) {
          targetId = nodeEl.dataset.nodeId;
          if (targetId && targetId !== gesture.from) {
            valid = editor.canConnect(gesture.from, targetId).ok;
          }
        }
        gesture.targetId = targetId;
        gesture.valid = valid;
        setConnectTarget(targetId && targetId !== gesture.from ? { id: targetId, valid } : null);
        setPreview({ from: gesture.fromPoint, to: world, valid: targetId ? valid : undefined });
        return;
      }

      if (gesture.type === 'marquee') {
        setMarquee(normalizeRect(gesture.startWorld, world));
      }
    },
    [
      doc.nodes,
      editor,
      setCamera,
      settings.grid,
      settings.snap,
      toWorld,
    ],
  );

  const onCanvasContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const world = toWorld(event.clientX, event.clientY);
      setUI({ contextMenu: { x: event.clientX, y: event.clientY, worldX: world.x, worldY: world.y } });
    },
    [toWorld],
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: CanvasNode) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selection.includes(node.id)) editor.select(node.id);
      const world = toWorld(event.clientX, event.clientY);
      setUI({
        contextMenu: { x: event.clientX, y: event.clientY, worldX: world.x, worldY: world.y, nodeId: node.id },
      });
    },
    [editor, selection, toWorld],
  );

  const onOpenMenu = useCallback(
    (event: React.MouseEvent, node: CanvasNode) => {
      event.stopPropagation();
      if (!selection.includes(node.id)) editor.select(node.id);
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const world = toWorld(rect.left, rect.bottom);
      setUI({
        contextMenu: { x: rect.left, y: rect.bottom + 2, worldX: world.x, worldY: world.y, nodeId: node.id },
      });
    },
    [editor, selection, toWorld],
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (isInteractiveTarget(event.target)) return;
      if ((event.target as HTMLElement | null)?.closest?.('.node')) return;
      const world = toWorld(event.clientX, event.clientY);
      const node = editor.addNode('prompt', {
        x: Math.round(world.x - 160),
        y: Math.round(world.y - 80),
      });
      requestAnimationFrame(() => {
        const el = hostRef.current?.querySelector<HTMLTextAreaElement>(
          `[data-node-id="${node.id}"] textarea`,
        );
        el?.focus();
      });
    },
    [editor, toWorld],
  );

  const handleFiles = useCallback(
    async (files: File[], world: Vec) => {
      let offset = 0;
      for (const file of files) {
        const kind = file.type.startsWith('video/')
          ? 'video'
          : file.type.startsWith('audio/')
            ? 'audio'
            : file.type.startsWith('image/')
              ? 'image'
              : null;
        if (!kind) {
          toast(`不支持的素材类型：${file.name}`, 'error');
          continue;
        }
        try {
          const meta = await addAsset(file, {
            name: file.name.replace(/\.[^.]+$/, ''),
            source: 'upload',
            keepOriginal: getSettings().keepOriginal,
          });
          let w = kind === 'image' ? 360 : kind === 'video' ? 420 : 360;
          let h = 36 + (kind === 'image' ? 400 : kind === 'video' ? 280 : 150);
          if (kind === 'image' && meta.width && meta.height) {
            const imgW = 360;
            h = 36 + Math.min(600, Math.max(160, (imgW * meta.height) / meta.width));
            w = imgW;
          }
          if (kind === 'video') h = 36 + 250;
          const node = editor.addNode(kind, {
            x: Math.round(world.x + offset),
            y: Math.round(world.y + offset),
            w,
            h,
            select: false,
          });
          editor.patchNode(node.id, { assetId: meta.id, source: 'upload' }, { label: '插入素材' });
          offset += 28;
        } catch (error) {
          toast(error instanceof Error ? error.message : '素材导入失败', 'error');
        }
      }
    },
    [editor],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragOver.current = false;
      const world = toWorld(event.clientX, event.clientY);
      const assetId = event.dataTransfer.getData('application/x-muse-asset');
      if (assetId) {
        editor.addMediaNode('image', assetId, {
          x: Math.round(world.x - 150),
          y: Math.round(world.y - 170),
          w: 340,
          h: 400,
        });
        return;
      }
      const files = [...event.dataTransfer.files];
      if (files.length) void handleFiles(files, world);
    },
    [editor, handleFiles, toWorld],
  );

  const running = useMemo(() => new Set(runningNodeIds()), [doc.nodes]);
  const selectionNodes = useMemo(
    () => doc.nodes.filter((n) => selection.includes(n.id)),
    [doc.nodes, selection],
  );
  const selectedKinds = [...new Set(selectionNodes.map((n) => n.kind))];
  const hasRunnableSelected = selectionNodes.some((n) => n.kind === 'generate' || n.kind === 'chat');
  const hasGroupSelected = selectionNodes.some((n) => n.kind === 'group');

  const zoomLabel = `${Math.round(camera.zoom * 100)}%`;

  return (
    <div
      className={`canvas-host${activeGesture === 'pan' ? ' panning' : ''}`}
      ref={hostRef}
      data-tool={tool}
      onPointerDown={onHostPointerDown}
      onPointerMove={onHostPointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
      onDoubleClick={onDoubleClick}
      onContextMenu={onCanvasContextMenu}
      onDragOver={(event) => {
        event.preventDefault();
        dragOver.current = true;
      }}
      onDrop={onDrop}
      style={{
        backgroundImage: settings.grid
          ? undefined
          : 'none',
      }}
    >
      <div
        className="canvas-grid"
        style={{
          backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
          opacity: settings.grid ? 1 : 0,
        }}
      />
      <div className="canvas-vignette" />

      <div
        className="world"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        <Edges
          doc={doc}
          selectedEdges={selectedEdges}
          preview={preview}
          runningNodes={running}
          onSelectEdge={(id, additive) => editor.selectEdges(id, additive)}
          onDeleteEdge={(id) => editor.deleteEdge(id)}
        />

        {doc.nodes.map((node) => (
          <NodeView
            key={node.id}
            node={node}
            selected={selection.includes(node.id)}
            zoom={camera.zoom}
            onNodePointerDown={onNodePointerDown}
            onNodeContextMenu={onNodeContextMenu}
            onPortPointerDown={onPortPointerDown}
            onResizePointerDown={onResizePointerDown}
            onOpenMenu={onOpenMenu}
            connectTarget={connectTarget?.id === node.id ? 'in' : null}
            connectInvalid={
              connectTarget?.id === node.id ? !connectTarget.valid : Boolean(activeGesture === 'connect')
            }
            connectionActive={activeGesture === 'connect'}
          />
        ))}

        {guides.map((guide, index) =>
          guide.axis === 'x' ? (
            <div
              key={`gx-${index}`}
              className="align-guide v"
              style={{ left: guide.at, top: guide.from, height: guide.to - guide.from }}
            />
          ) : (
            <div
              key={`gy-${index}`}
              className="align-guide h"
              style={{ top: guide.at, left: guide.from, width: guide.to - guide.from }}
            />
          ),
        )}

        {marquee ? (
          <div
            className="marquee"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          />
        ) : null}
      </div>

      {doc.nodes.length === 0 && (
        <div className="canvas-empty">
          <div className="canvas-empty-inner">
            <MousePointer2 size={20} />
            <strong>空白画布，双击开始</strong>
            <span>或者从左下角添加节点 / 应用模板</span>
            <div className="keys">
              <span className="kbd">双击</span>
              <span className="kbd">⌘K</span>
              <span className="kbd">T</span>
            </div>
          </div>
        </div>
      )}

      {/* 左下角缩放 */}
      <div className="canvas-hud zoom-hud" onPointerDown={(event) => event.stopPropagation()}>
        <button className="hud-btn" onClick={() => zoomBy(1 / 1.2)} title="缩小">
          <Minus size={12} />
        </button>
        <button
          className="hud-btn zoom-label"
          onClick={() => setZoomMenu((value) => !value)}
          title="缩放选项"
        >
          {zoomLabel}
          <ChevronDown size={9} />
        </button>
        <button className="hud-btn" onClick={() => zoomBy(1.2)} title="放大">
          <Plus size={12} />
        </button>
        <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 2px' }} />
        <button className="hud-btn" onClick={() => fitAll()} title="适应画布（⌘0）">
          <Maximize size={12} />
        </button>
        <button className="hud-btn" onClick={fitSelection} title="适应选择（⇧1）">
          <Crosshair size={12} />
        </button>
        {zoomMenu ? (
          <div className="zoom-menu">
            <button onClick={() => { zoomTo(1); setZoomMenu(false); }}>
              100% <span className="kbd">⌘1</span>
            </button>
            <button onClick={() => { zoomTo(0.5); setZoomMenu(false); }}>
              50%
            </button>
            <button onClick={() => { fitAll(); setZoomMenu(false); }}>
              适应画布 <span className="kbd">⌘0</span>
            </button>
            <button onClick={() => { fitSelection(); setZoomMenu(false); }}>
              适应选择
            </button>
          </div>
        ) : null}
        <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 2px' }} />
        <button
          className={`hud-btn${settings.grid ? ' on' : ''}`}
          onClick={() => updateSettings((prev) => ({ ...prev, grid: !prev.grid }))}
          title="网格与对齐参考"
          style={settings.grid ? { color: 'var(--gold)' } : undefined}
        >
          <Grid3x3 size={12} />
        </button>
        <button
          className="hud-btn"
          onClick={() => updateSettings((prev) => ({ ...prev, snap: !prev.snap }))}
          title="智能吸附"
          style={settings.snap ? { color: 'var(--teal)' } : undefined}
        >
          <Magnet size={12} />
        </button>
      </div>

      {settings.showMinimap && (
        <Minimap
          doc={doc}
          camera={camera}
          viewport={viewport}
          onNavigate={(world) =>
            setCamera({
              ...cameraRef.current,
              x: viewportRef.current.w / 2 - world.x * cameraRef.current.zoom,
              y: viewportRef.current.h / 2 - world.y * cameraRef.current.zoom,
            })
          }
          onToggle={() => updateSettings((prev) => ({ ...prev, showMinimap: false }))}
        />
      )}

      {selection.length > 0 && (
        <SelectionToolbar
          count={selection.length}
          kinds={selectedKinds}
          canAlign={selection.length > 1}
          canDistribute={selection.length > 2}
          hasRunnable={hasRunnableSelected}
          hasGroup={hasGroupSelected}
          onAlign={(mode) => editor.alignSelection(mode)}
          onDistribute={(axis) => editor.distributeSelection(axis)}
          onGroup={() => editor.groupSelection()}
          onUngroup={() => editor.ungroupSelection()}
          onDuplicate={() => editor.duplicateSelection()}
          onDelete={() => editor.deleteSelection()}
          onRun={() => runSelectedNodes()}
          onFit={fitSelection}
        />
      )}

      <div className="canvas-hint">
        {tool === 'hand' || spaceDown.current
          ? '拖动画布平移 · ⌘/Ctrl + 滚轮缩放'
          : `${hoverWorld ? `x ${Math.round(hoverWorld.x)} · y ${Math.round(hoverWorld.y)}` : '空白处拖动框选'} · 空格拖动 · 双击新建提示词 · ${inspectorOpen ? '⌘K 命令' : ''}`}
      </div>
    </div>
  );
}

function rectIntersectsNode(rect: Rect, node: CanvasNode): boolean {
  return !(
    rect.x + rect.w < node.x ||
    node.x + node.w < rect.x ||
    rect.y + rect.h < node.y ||
    node.y + node.h < rect.y
  );
}

function SelectionToolbar({
  count,
  kinds,
  canAlign,
  canDistribute,
  hasRunnable,
  hasGroup,
  onAlign,
  onDistribute,
  onGroup,
  onUngroup,
  onDuplicate,
  onDelete,
  onRun,
  onFit,
}: {
  count: number;
  kinds: string[];
  canAlign: boolean;
  canDistribute: boolean;
  hasRunnable: boolean;
  hasGroup: boolean;
  onAlign: (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void;
  onDistribute: (axis: 'x' | 'y') => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRun: () => void;
  onFit: () => void;
}) {
  return (
    <div className="selection-toolbar" onPointerDown={(event) => event.stopPropagation()}>
      <span className="count">{count} 个节点</span>
      <span className="sep" />
      <button className="sel-btn" title="适应选择" onClick={onFit}>
        <Crosshair size={12} />
      </button>
      {hasRunnable ? (
        <button className="sel-btn" title="运行选中节点" onClick={onRun}>
          <Play size={12} /> 运行
        </button>
      ) : null}
      {canAlign ? (
        <>
          <span className="sep" />
          <button className="sel-btn" title="左对齐" onClick={() => onAlign('left')}>
            <AlignStartVertical size={12} />
          </button>
          <button className="sel-btn" title="水平居中" onClick={() => onAlign('hcenter')}>
            <AlignCenterVertical size={12} />
          </button>
          <button className="sel-btn" title="右对齐" onClick={() => onAlign('right')}>
            <AlignEndVertical size={12} />
          </button>
          <button className="sel-btn" title="顶对齐" onClick={() => onAlign('top')}>
            <AlignStartHorizontal size={12} />
          </button>
          <button className="sel-btn" title="垂直居中" onClick={() => onAlign('vcenter')}>
            <AlignCenterHorizontal size={12} />
          </button>
          <button className="sel-btn" title="底对齐" onClick={() => onAlign('bottom')}>
            <AlignEndHorizontal size={12} />
          </button>
        </>
      ) : null}
      {canDistribute ? (
        <>
          <span className="sep" />
          <button className="sel-btn" title="水平分布" onClick={() => onDistribute('x')}>
            <AlignHorizontalSpaceAround size={12} />
          </button>
          <button className="sel-btn" title="垂直分布" onClick={() => onDistribute('y')}>
            <AlignVerticalSpaceAround size={12} />
          </button>
        </>
      ) : null}
      <span className="sep" />
      {hasGroup ? (
        <button className="sel-btn" title="取消分组" onClick={onUngroup}>
          <Ungroup size={12} /> 取消分组
        </button>
      ) : (
        <button className="sel-btn" title="分组（⌘G）" onClick={onGroup} disabled={count < 1}>
          <GroupIcon size={12} /> 分组
        </button>
      )}
      <button className="sel-btn" title="复制（⌘D）" onClick={onDuplicate}>
        <Copy size={12} />
      </button>
      <button className="sel-btn danger" title="删除（Delete）" onClick={onDelete}>
        <Trash2 size={12} />
      </button>
      <span className="sr-only">{kinds.join(',')}</span>
    </div>
  );
}
