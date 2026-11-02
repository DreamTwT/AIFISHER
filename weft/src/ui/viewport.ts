import type { Editor } from '../core/editor';
import { addAsset, getAssetImage, subscribeAssets } from '../core/assets';
import {
  edgeAt,
  fitCamera,
  nodeAt,
  normalizedRect,
  pointInRect,
  portPoint,
  screenToWorld,
  snapPoint,
  wouldCycle,
} from '../core/geometry';
import { paintScene, type ConnectPreview } from '../core/paint';
import type { ID, Point, Rect, SceneNode } from '../core/types';
import { clamp, isTextTarget } from '../core/util';

type Mode =
  | { type: 'pan'; start: Point; camera: { x: number; y: number } }
  | { type: 'drag'; start: Point; nodes: Map<ID, Point>; moved: boolean }
  | { type: 'resize'; start: Point; id: ID; w: number; h: number }
  | { type: 'connect'; from: ID; current: Point; valid: boolean }
  | { type: 'marquee'; start: Point; current: Point; additive: boolean };

export interface ViewportHooks {
  onChange: () => void;
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  onOpenImage: (assetId: ID) => void;
  onPickImage: (nodeId: ID) => void;
  onInteractionEnd: () => void;
}

export class Viewport {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 1;
  private height = 1;
  private raf = 0;
  private mode: Mode | null = null;
  private pointerId: number | null = null;
  private space = false;
  private hoverNode?: ID;
  private hoverPort?: 'in' | 'out';
  private connectPreview: ConnectPreview | null = null;
  private marquee: Rect | null = null;
  private grid = true;
  private inline: HTMLTextAreaElement | null = null;
  private inlineNodeId: ID | null = null;
  private menu: HTMLElement | null = null;
  private disposed = false;

  constructor(
    private host: HTMLElement,
    private editor: Editor,
    private hooks: ViewportHooks,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'weft-canvas';
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 不可用');
    this.ctx = ctx;

    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('dragover', (event) => event.preventDefault());
    this.canvas.addEventListener('drop', this.onDrop);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointerdown', this.onGlobalPointer, true);
    editor.subscribe(() => this.request());
    subscribeAssets(() => this.request());
    this.request();
  }

  dispose(): void {
    this.disposed = true;
    this.closeInline();
    this.closeMenu();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointerdown', this.onGlobalPointer, true);
    cancelAnimationFrame(this.raf);
    this.host.replaceChildren();
  }

  resize(): void {
    const rect = this.host.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.request();
  }

  setGrid(value: boolean): void {
    this.grid = value;
    this.request();
  }

  toggleGrid(): boolean {
    this.grid = !this.grid;
    this.request();
    return this.grid;
  }

  invalidate(): void {
    this.request();
  }

  ensureVisible(node: { x: number; y: number; w: number; h: number }): void {
    const camera = this.editor.project.camera;
    const left = node.x * camera.z + camera.x;
    const top = node.y * camera.z + camera.y;
    const right = (node.x + node.w) * camera.z + camera.x;
    const bottom = (node.y + node.h) * camera.z + camera.y;
    const margin = 48;
    let dx = 0;
    let dy = 0;
    if (left < margin) dx = margin - left;
    else if (right > this.width - margin) dx = this.width - margin - right;
    if (top < margin) dy = margin - top;
    else if (bottom > this.height - margin) dy = this.height - margin - bottom;
    if (!dx && !dy) return;
    this.editor.setCamera({ ...camera, x: camera.x + dx, y: camera.y + dy });
  }

  fit(padding = 64): void {
    const camera = fitCamera(this.editor.doc.nodes, this.width, this.height, padding);
    this.editor.setCamera(camera);
    this.request();
  }

  zoomAt(factor: number, screen?: Point): void {
    const point = screen ?? { x: this.width / 2, y: this.height / 2 };
    const camera = this.editor.project.camera;
    const world = screenToWorld(point, camera);
    const next = clamp(camera.z * factor, 0.14, 2.6);
    this.editor.setCamera({
      z: next,
      x: point.x - world.x * next,
      y: point.y - world.y * next,
    });
    this.request();
  }

  setZoom(z: number): void {
    this.zoomAt(z / this.editor.project.camera.z);
  }

  addAtCenter(kind: 'prompt' | 'render' | 'image' | 'weave'): void {
    const camera = this.editor.project.camera;
    const world = screenToWorld({ x: this.width / 2, y: this.height / 2 }, camera);
    this.editor.addNode(kind, Math.round(world.x - 150), Math.round(world.y - 110));
  }

  screenPoint(event: PointerEvent | WheelEvent | MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  toWorld(point: Point): Point {
    return screenToWorld(point, this.editor.project.camera);
  }

  toScreen(point: Point): Point {
    const camera = this.editor.project.camera;
    return { x: point.x * camera.z + camera.x, y: point.y * camera.z + camera.y };
  }

  beginInlineEdit(node: SceneNode): void {
    if (node.kind !== 'prompt' && node.kind !== 'render') return;
    this.closeInline();
    const camera = this.editor.project.camera;
    const screen = this.toScreen({ x: node.x, y: node.y });
    const area = document.createElement('textarea');
    area.className = 'inline-editor';
    area.value = node.kind === 'prompt' ? node.text : node.prompt;
    area.style.left = `${screen.x + 12}px`;
    area.style.top = `${screen.y + (40 + 34) * camera.z}px`;
    area.style.width = `${Math.max(160, (node.w - 24) * camera.z)}px`;
    area.style.height = `${Math.max(90, (node.h - 100) * camera.z)}px`;
    area.style.fontSize = `${Math.max(11, 12 * camera.z)}px`;
    area.placeholder = node.kind === 'prompt' ? '写下方向…' : '补充提示词，留空则使用上游经线…';
    this.host.appendChild(area);
    this.inline = area;
    this.inlineNodeId = node.id;
    this.editor.begin();
    area.addEventListener('input', () => {
      if (node.kind === 'prompt') this.editor.updateNode(node.id, { text: area.value });
      else this.editor.updateNode(node.id, { prompt: area.value });
      this.request();
    });
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeInline();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        this.closeInline();
      }
      event.stopPropagation();
    });
    area.addEventListener('blur', () => this.closeInline());
    window.setTimeout(() => {
      area.focus();
      area.select();
    }, 20);
  }

  closeInline(): void {
    if (!this.inline) return;
    const area = this.inline;
    this.inline = null;
    const node = this.inlineNodeId ? this.editor.node(this.inlineNodeId) : undefined;
    this.inlineNodeId = null;
    if (node && (node.kind === 'prompt' || node.kind === 'render')) {
      const value = area.value;
      if (node.kind === 'prompt') this.editor.updateNode(node.id, { text: value });
      else this.editor.updateNode(node.id, { prompt: value });
    }
    area.remove();
    this.editor.end(true);
    this.request();
  }

  private request = (): void => {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  };

  private draw(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    paintScene(this.ctx, {
      doc: this.editor.doc,
      camera: this.editor.project.camera,
      width: this.width,
      height: this.height,
      selection: this.editor.selection,
      threadSelection: this.editor.threadSelection,
      hoverNode: this.hoverNode,
      hoverPort: this.hoverPort,
      marquee: this.marquee ?? undefined,
      connect: this.connectPreview ?? undefined,
      grid: this.grid,
      getImage: (id) => getAssetImage(id),
    });
    this.hooks.onChange();
  }

  private portAt(point: Point): { node: SceneNode; side: 'in' | 'out' } | null {
    const camera = this.editor.project.camera;
    const world = this.toWorld(point);
    for (let i = this.editor.doc.nodes.length - 1; i >= 0; i -= 1) {
      const node = this.editor.doc.nodes[i];
      for (const side of ['in', 'out'] as const) {
        const port = portPoint(node, side);
        const screen = { x: port.x * camera.z + camera.x, y: port.y * camera.z + camera.y };
        if (Math.hypot(screen.x - point.x, screen.y - point.y) < 13) return { node, side };
      }
    }
    return null;
  }

  private resizeHandleAt(point: Point): SceneNode | null {
    if (!this.editor.selection.size) return null;
    const id = [...this.editor.selection][0];
    const node = this.editor.node(id);
    if (!node) return null;
    const screen = this.toScreen({ x: node.x + node.w, y: node.y + node.h });
    return Math.hypot(screen.x - point.x, screen.y - point.y) < 13 ? node : null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button === 2) return;
    if (this.inline) this.closeInline();
    this.closeMenu();
    const point = this.screenPoint(event);
    const world = this.toWorld(point);
    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);

    if (event.button === 1 || this.space || this.editor.tool === 'hand') {
      this.mode = {
        type: 'pan',
        start: point,
        camera: { x: this.editor.project.camera.x, y: this.editor.project.camera.y },
      };
      this.canvas.classList.add('panning');
      return;
    }

    const port = this.portAt(point);
    if (port && port.side === 'out') {
      this.mode = { type: 'connect', from: port.node.id, current: world, valid: true };
      this.connectPreview = { from: port.node.id, to: world, valid: true };
      return;
    }

    const handle = this.resizeHandleAt(point);
    if (handle) {
      this.editor.begin();
      this.mode = { type: 'resize', start: world, id: handle.id, w: handle.w, h: handle.h };
      return;
    }

    const node = nodeAt(this.editor.doc, world);
    if (node) {
      if (event.shiftKey) {
        this.editor.toggleSelect(node.id);
      } else if (!this.editor.selection.has(node.id)) {
        this.editor.select([node.id]);
      }
      if (!this.editor.selection.has(node.id)) return;
      this.editor.bringToFront();
      const starts = new Map<ID, Point>();
      for (const item of this.editor.selectedNodes()) starts.set(item.id, { x: item.x, y: item.y });
      this.editor.begin();
      this.mode = { type: 'drag', start: world, nodes: starts, moved: false };
      return;
    }

    const thread = edgeAt(this.editor.doc, world, 8 / this.editor.project.camera.z);
    if (thread) {
      this.editor.selectThread(thread.id);
      return;
    }

    if (!event.shiftKey) this.editor.clearSelection();
    this.mode = {
      type: 'marquee',
      start: world,
      current: world,
      additive: event.shiftKey,
    };
    this.marquee = { x: world.x, y: world.y, w: 0, h: 0 };
    this.request();
  };

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.screenPoint(event);
    const world = this.toWorld(point);

    if (!this.mode) {
      const port = this.portAt(point);
      const node = nodeAt(this.editor.doc, world);
      const nextPort = port?.side;
      const nextNode = port?.node.id ?? node?.id;
      if (nextPort !== this.hoverPort || nextNode !== this.hoverNode) {
        this.hoverPort = nextPort;
        this.hoverNode = nextNode;
        this.canvas.classList.toggle('over-port', Boolean(port));
        this.request();
      }
      return;
    }

    if (this.mode.type === 'pan') {
      this.editor.setCamera(
        {
          ...this.editor.project.camera,
          x: this.mode.camera.x + (point.x - this.mode.start.x),
          y: this.mode.camera.y + (point.y - this.mode.start.y),
        },
        true,
      );
      this.request();
      return;
    }

    if (this.mode.type === 'drag') {
      const dx = world.x - this.mode.start.x;
      const dy = world.y - this.mode.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) this.mode.moved = true;
      for (const [id, start] of this.mode.nodes) {
        const node = this.editor.node(id);
        if (!node) continue;
        node.x = start.x + dx;
        node.y = start.y + dy;
      }
      this.editor.dirty = true;
      this.request();
      return;
    }

    if (this.mode.type === 'resize') {
      const node = this.editor.node(this.mode.id);
      if (node) {
        node.w = Math.max(250, this.mode.w + (world.x - this.mode.start.x));
        node.h = Math.max(150, this.mode.h + (world.y - this.mode.start.y));
        this.editor.dirty = true;
        this.request();
      }
      return;
    }

    if (this.mode.type === 'connect') {
      const target = nodeAt(this.editor.doc, world);
      const from = this.mode.from;
      const valid = Boolean(
        target &&
          target.id !== from &&
          !wouldCycle(this.editor.doc, from, target.id) &&
          !this.editor.doc.threads.some((thread) => thread.from === from && thread.to === target.id),
      );
      this.mode.current = world;
      this.mode.valid = valid;
      this.connectPreview = { from: this.mode.from, to: world, valid };
      this.request();
      return;
    }

    if (this.mode.type === 'marquee') {
      this.mode.current = world;
      this.marquee = normalizedRect(this.mode.start, world);
      this.request();
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== null && this.canvas.hasPointerCapture(this.pointerId)) {
      this.canvas.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    const mode = this.mode;
    this.mode = null;
    this.canvas.classList.remove('panning');

    if (!mode) return;
    const point = this.screenPoint(event);
    const world = this.toWorld(point);

    if (mode.type === 'drag') {
      this.editor.end(mode.moved);
    } else if (mode.type === 'resize') {
      this.editor.end(true);
    } else if (mode.type === 'connect') {
      const target = nodeAt(this.editor.doc, world);
      if (target && target.id !== mode.from) {
        const ok = this.editor.connect(mode.from, target.id);
        if (!ok) this.hooks.onToast('这条线会打结，换一个方向试试', 'error');
      }
      this.connectPreview = null;
      this.editor.emit();
    } else if (mode.type === 'marquee') {
      const rect = normalizedRect(mode.start, mode.current);
      this.marquee = null;
      if (rect.w > 3 || rect.h > 3) {
        const ids = this.editor.doc.nodes.filter((node) => {
          return (
            rect.x < node.x + node.w &&
            rect.x + rect.w > node.x &&
            rect.y < node.y + node.h &&
            rect.y + rect.h > node.y
          );
        }).map((node) => node.id);
        this.editor.select(ids, mode.additive);
      }
      this.request();
    }
    this.hooks.onInteractionEnd();
  };

  private onPointerLeave = (): void => {
    if (this.mode) return;
    if (this.hoverNode || this.hoverPort) {
      this.hoverNode = undefined;
      this.hoverPort = undefined;
      this.canvas.classList.remove('over-port');
      this.request();
    }
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const point = this.screenPoint(event);
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.0022);
      this.zoomAt(factor, point);
      return;
    }
    this.editor.setCamera(
      {
        ...this.editor.project.camera,
        x: this.editor.project.camera.x - event.deltaX,
        y: this.editor.project.camera.y - event.deltaY,
      },
      true,
    );
    this.request();
  };

  private onDoubleClick = (event: MouseEvent): void => {
    const point = this.screenPoint(event);
    const world = this.toWorld(point);
    const node = nodeAt(this.editor.doc, world);
    if (node) {
      this.editor.select([node.id]);
      if (node.kind === 'prompt' || node.kind === 'render') {
        this.beginInlineEdit(node);
      } else if (node.kind === 'image' && node.assetId) {
        this.hooks.onOpenImage(node.assetId);
      } else if (node.kind === 'image') {
        this.hooks.onPickImage(node.id);
      }
      return;
    }
    const prompt = this.editor.addNode('prompt', snapPoint(world).x, snapPoint(world).y);
    this.beginInlineEdit(prompt);
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const point = this.screenPoint(event);
    const world = this.toWorld(point);
    const node = nodeAt(this.editor.doc, world);
    if (node) this.editor.select([node.id]);
    this.openMenu(event.clientX, event.clientY, world, node);
  };

  private openMenu(clientX: number, clientY: number, world: Point, node?: SceneNode): void {
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'weft-menu';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    const add = (label: string, hint: string, action: () => void, danger = false) => {
      const button = document.createElement('button');
      button.className = `weft-menu-item${danger ? ' danger' : ''}`;
      button.innerHTML = `<span>${label}</span><kbd>${hint}</kbd>`;
      button.addEventListener('click', () => {
        this.closeMenu();
        action();
      });
      menu.appendChild(button);
    };
    if (node) {
      if (node.kind === 'render') add('织出样张', 'R', () => window.dispatchEvent(new CustomEvent('weft:run-node', { detail: node.id })));
      add('再织一份', '⌘D', () => {
        this.editor.select([node.id]);
        this.editor.duplicateSelection();
      });
      add('删除节点', 'Del', () => {
        this.editor.select([node.id]);
        this.editor.deleteSelection();
      }, true);
      const sep = document.createElement('div');
      sep.className = 'weft-menu-sep';
      menu.appendChild(sep);
    }
    add('添加经线', 'T', () => {
      const created = this.editor.addNode('prompt', snapPoint(world).x, snapPoint(world).y);
      this.beginInlineEdit(created);
    });
    add('添加纬线', 'G', () => {
      this.editor.addNode('render', snapPoint(world).x, snapPoint(world).y);
    });
    add('添加织片', 'W', () => {
      this.editor.addNode('weave', snapPoint(world).x, snapPoint(world).y);
    });
    this.host.appendChild(menu);
    this.menu = menu;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) menu.style.left = `${clientX - rect.width}px`;
    if (rect.bottom > window.innerHeight - 8) menu.style.top = `${clientY - rect.height}px`;
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  private onGlobalPointer = (event: PointerEvent): void => {
    if (this.menu && !this.menu.contains(event.target as Node)) this.closeMenu();
  };

  private onDrop = async (event: DragEvent): Promise<void> => {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    const point = this.screenPoint(event);
    const world = this.toWorld(point);
    for (let index = 0; index < files.length; index += 1) {
      const meta = await addAsset(files[index], { name: files[index].name });
      const node = this.editor.addNode('image', world.x + index * 40, world.y + index * 40, {
        assetId: meta.id,
        caption: files[index].name,
        title: '布样',
      });
      node.w = 320;
      node.h = 322;
      this.editor.emit();
    }
    this.hooks.onToast(`已放入 ${files.length} 张布样`, 'success');
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isTextTarget(event.target)) return;
    if (event.code === 'Space') {
      this.space = true;
      this.canvas.classList.add('hand-ready');
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      this.space = false;
      this.canvas.classList.remove('hand-ready');
    }
  };

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** 导出或缩略图时临时使用 */
  paintForExport(ctx: CanvasRenderingContext2D, width: number, height: number, camera = this.editor.project.camera): void {
    paintScene(ctx, {
      doc: this.editor.doc,
      camera,
      width,
      height,
      selection: new Set(),
      threadSelection: new Set(),
      getImage: (id) => getAssetImage(id),
      minimal: true,
    });
  }
}

/** 让读屏与测试可以使用节点矩形 */
export function hitNode(editor: Editor, point: Point): SceneNode | undefined {
  return nodeAt(editor.doc, point);
}

export function contains(rect: Rect, node: SceneNode): boolean {
  return pointInRect({ x: node.x, y: node.y }, rect);
}
