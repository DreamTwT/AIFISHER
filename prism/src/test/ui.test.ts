// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../core/assets', () => {
  const make = (index: number) => ({
    id: `asset-${index}`,
    name: `测试图 0${index}`,
    mime: 'image/png',
    width: 1024,
    height: 1024,
    size: 2048,
    createdAt: 1_700_000_000_000 + index,
    source: 'upload',
  });
  const assets = [make(1), make(2), make(3)];
  return {
    allAssets: () => assets,
    subscribeAssets: () => () => {},
    getAssetUrl: () => undefined,
    getAssetImage: () => undefined,
    getAssetMeta: (id: string) => assets.find((asset) => asset.id === id),
    addAsset: async () => assets[0],
  };
});
import { Editor } from '../core/editor';
import { createNode, createProject, starterProject } from '../core/factory';
import { groupBounds } from '../core/geometry';
import type { ID, SceneNode } from '../core/types';
import { openAssetDetail, openLibrary } from '../ui/library';
import { renderInspector } from '../ui/inspector';
import { Viewport, type ViewportHooks } from '../ui/viewport';

const ctx = (): CanvasRenderingContext2D =>
  new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'measureText') return () => ({ width: 42 });
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (key === 'getImageData') return () => ({ data: [] });
        return () => undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  (globalThis as unknown as { Path2D: unknown }).Path2D = class {
    constructor(_path?: string) {}
  };
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) => window.clearTimeout(handle)) as typeof cancelAnimationFrame;
  HTMLCanvasElement.prototype.getContext = (() => ctx()) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  proto.hasPointerCapture = () => true;
  Element.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
});

function mountViewport(project = starterProject()): { viewport: Viewport; editor: Editor; host: HTMLElement } {
  const editor = new Editor(project);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const rect = { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800, toJSON: () => ({}) };
  host.getBoundingClientRect = () => rect as DOMRect;
  const hooks: ViewportHooks = {
    onChange: () => {},
    onToast: () => {},
    onOpenImage: () => {},
    onPickImage: () => {},
    onPickVideo: () => {},
    onEditText: () => {},
    onInteractionEnd: () => {},
  };
  const viewport = new Viewport(host, editor, hooks);
  viewport.canvas.getBoundingClientRect = () => rect as DOMRect;
  return { viewport, editor, host };
}

function fire(target: HTMLElement, type: string, init: MouseEventInit, pointer = true): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  if (pointer) Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

function clickNode(target: HTMLElement, node: SceneNode, init: MouseEventInit = {}): void {
  const x = node.x + node.w / 2;
  const y = node.y + node.h / 2;
  fire(target, 'pointerdown', { ...init, clientX: x, clientY: y, button: 0 });
  fire(target, 'pointerup', { ...init, clientX: x, clientY: y, button: 0 });
}

describe('canvas pointer behaviour', () => {
  it('selects only the clicked node, and the whole group with Alt', () => {
    const { viewport, editor } = mountViewport();
    const group = editor.doc.groups[0];
    const first = editor.node(group.nodeIds[0])!;
    const second = editor.node(group.nodeIds[1])!;

    clickNode(viewport.canvas, first);
    expect(editor.selection.size).toBe(1);
    expect(editor.selection.has(first.id)).toBe(true);

    clickNode(viewport.canvas, second, { shiftKey: true });
    expect(editor.selection.size).toBe(2);

    clickNode(viewport.canvas, first, { altKey: true });
    expect(editor.selection.size).toBe(group.nodeIds.length);
    expect(editor.selectionGroup()?.id).toBe(group.id);
  });

  it('snaps a dragged node to a neighbouring edge', () => {
    const project = createProject();
    const a = createNode('prompt', 0, 0);
    const b = createNode('prompt', 100, 400);
    project.doc.nodes = [a, b];
    const { viewport, editor } = mountViewport(project);
    const x = a.w / 2;
    const y = a.h / 2;
    fire(viewport.canvas, 'pointerdown', { clientX: x, clientY: y, button: 0 });
    fire(viewport.canvas, 'pointermove', { clientX: x + 95, clientY: y + 40, button: 0 });
    expect(editor.node(a.id)?.x).toBe(100);
    expect(editor.node(a.id)?.y).toBe(40);
    fire(viewport.canvas, 'pointerup', { clientX: x + 95, clientY: y + 40, button: 0 });

    fire(viewport.canvas, 'pointerdown', { clientX: x + 100, clientY: y + 40, button: 0 });
    fire(viewport.canvas, 'pointermove', { clientX: x + 195, clientY: y + 80, button: 0, metaKey: true });
    expect(editor.node(a.id)?.x).toBe(195);
    fire(viewport.canvas, 'pointerup', { clientX: x + 195, clientY: y + 80, button: 0 });
  });

  it('renders video controls with an empty reference slot', () => {
    const editor = new Editor(starterProject());
    const video = createNode('video', 0, 0);
    editor.doc.nodes.push(video);
    editor.select([video.id]);
    const host = document.createElement('div');
    renderInspector(host, {
      editor,
      run: () => {},
      stop: () => {},
      openImage: () => {},
      removeOutput: () => {},
      pickImage: () => {},
      pickVideo: () => {},
      pickFromLibrary: () => {},
      exportWeave: () => {},
      openLibrary: () => {},
      openContactSheet: () => {},
      refresh: () => {},
      toast: () => {},
    });
    expect(host.textContent).toContain('视频生成');
    expect(host.textContent).toContain('参考');
    expect(host.querySelector('.reference-empty')).not.toBeNull();
    host.remove();
  });

  it('renames a group from its title on the canvas', () => {
    const { viewport, editor, host } = mountViewport();
    const group = editor.doc.groups[0];
    const bounds = groupBounds(group, editor.doc)!;
    fire(viewport.canvas, 'dblclick', {
      clientX: bounds.x + 40,
      clientY: bounds.y + 12,
      button: 0,
    });
    const input = host.querySelector<HTMLInputElement>('.group-inline-editor');
    expect(input).not.toBeNull();
    input!.value = '新的编组名';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(editor.doc.groups.find((item) => item.id === group.id)?.name).toBe('新的编组名');
    expect(host.querySelector('.group-inline-editor')).toBeNull();
  });
});

describe('library delete entry', () => {
  it('deletes a card without placing it on the canvas', () => {
    const deleted: ID[] = [];
    let used = 0;
    openLibrary({ onUse: () => (used += 1), onDelete: (id) => (deleted.push(id), true) });
    const card = document.querySelector<HTMLElement>('.asset-card');
    expect(card).not.toBeNull();
    const remove = card!.querySelector<HTMLElement>('.asset-delete');
    expect(remove).not.toBeNull();
    remove!.click();
    expect(deleted).toEqual(['asset-1']);
    expect(used).toBe(0);
    document.querySelector('.library-backdrop')?.remove();
  });

  it('batch deletes the cards picked in select mode', async () => {
    const deleted: ID[][] = [];
    let used = 0;
    openLibrary({ onUse: () => (used += 1), onDeleteMany: (ids) => (deleted.push(ids), true) });
    document.querySelector<HTMLButtonElement>('[data-act="select"]')!.click();
    const cards = [...document.querySelectorAll<HTMLElement>('.asset-card')];
    expect(cards).toHaveLength(3);
    cards[0].click();
    cards[1].click();
    expect(cards[0].classList.contains('picked')).toBe(true);
    expect(document.querySelector('.bulk-count')?.textContent).toContain('2');
    document.querySelector<HTMLButtonElement>('[data-act="delete"]')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(deleted[0]).toEqual(['asset-1', 'asset-2']);
    expect(used).toBe(0);
    document.querySelector('.library-backdrop')?.remove();
  });

  it('places every picked card on the canvas in one action', () => {
    const placed: ID[][] = [];
    openLibrary({ onUse: () => {}, onUseMany: (ids) => placed.push(ids) });
    document.querySelector<HTMLButtonElement>('[data-act="select"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-act="all"]')!.click();
    expect(document.querySelector('.bulk-count')?.textContent).toContain('3');
    document.querySelector<HTMLButtonElement>('[data-act="place"]')!.click();
    expect(placed[0]).toEqual(['asset-1', 'asset-2', 'asset-3']);
    expect(document.querySelector('.library-backdrop')).toBeNull();
  });

  it('offers a delete action in the asset detail sheet', () => {
    let deleted = 0;
    openAssetDetail(
      {
        id: 'asset-1',
        name: '测试图',
        mime: 'image/png',
        width: 1024,
        height: 1024,
        size: 1024,
        createdAt: Date.now(),
        source: 'upload',
      },
      { onDelete: () => ((deleted += 1), true) },
    );
    const button = document.querySelector<HTMLElement>('[data-act="delete"]');
    expect(button?.textContent).toContain('删除素材');
    button?.click();
    expect(deleted).toBe(1);
    document.querySelector('.detail-backdrop')?.remove();
  });
});

describe('inspector output removal', () => {
  it('removes one generated image from the node', () => {
    const editor = new Editor(starterProject());
    const render = editor.doc.nodes.find((node) => node.kind === 'render');
    if (render?.kind !== 'render') throw new Error('missing render node');
    render.assetIds = ['a', 'b'];
    render.status = 'done';
    editor.select([render.id]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const removed: Array<[ID, ID | undefined]> = [];
    renderInspector(host, {
      editor,
      run: () => {},
      stop: () => {},
      openImage: () => {},
      removeOutput: (nodeId, assetId) => {
        removed.push([nodeId, assetId]);
        editor.removeNodeOutput(nodeId, assetId);
      },
      pickImage: () => {},
      pickVideo: () => {},
      pickFromLibrary: () => {},
      exportWeave: () => {},
      openLibrary: () => {},
      openContactSheet: () => {},
      refresh: () => {},
      toast: () => {},
    });
    const buttons = host.querySelectorAll<HTMLElement>('.thumb-remove');
    expect(buttons).toHaveLength(2);
    buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(removed[0]).toEqual([render.id, 'a']);
    const node = editor.node(render.id);
    expect(node?.kind === 'render' ? node.assetIds : []).toEqual(['b']);
    host.remove();
  });
});
