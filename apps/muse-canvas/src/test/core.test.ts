import { describe, expect, it } from 'vitest';
import { createEdge, createNode, createProject } from '../model/factory';
import {
  cloneSubgraph,
  collectContext,
  composePrompt,
  connect,
  duplicateNodes,
  makeGroup,
  removeNodes,
  topologicalOrder,
  wouldCreateCycle,
} from '../model/graph';
import { computeSnap, edgePath, fitCamera } from '../model/geometry';
import { deserializeProject, normalizeDoc, normalizeProject, serializeProject } from '../model/schema';
import type { CanvasNode, GenerateNode, PromptNode } from '../model/types';

function prompt(text: string, role: PromptNode['role'] = 'prompt'): PromptNode {
  return createNode('prompt', { x: 0, y: 0, text, role }) as PromptNode;
}

describe('graph', () => {
  it('沿连线收集上游文本与参考图', () => {
    const base = prompt('港口，雨后的黄昏');
    const style = prompt('cinematic, 35mm', 'style');
    const gen = createNode('generate', { x: 400, y: 0 }) as GenerateNode;
    const doc = {
      version: 3,
      nodes: [base, style, gen],
      edges: [createEdge(base.id, gen.id), createEdge(style.id, gen.id)],
    };
    const context = collectContext(doc, gen.id);
    expect(context.texts).toHaveLength(2);
    expect(context.texts[0].text).toContain('港口');
    expect(composePrompt('自己的补充', context)).toContain('cinematic');
    expect(composePrompt('自己的补充', context).startsWith('自己的补充')).toBe(true);
  });

  it('阻止环路并允许合法连接', () => {
    const a = createNode('chat');
    const b = createNode('generate');
    const doc = { version: 3, nodes: [a, b], edges: [createEdge(a.id, b.id)] };
    expect(wouldCreateCycle(doc, b.id, a.id)).toBe(true);
    expect(connect(doc, b.id, a.id)).toBeNull();
    const c = createNode('prompt');
    const extended = { ...doc, nodes: [...doc.nodes, c] };
    expect(connect(extended, c.id, b.id)?.edges).toHaveLength(2);
  });

  it('按依赖顺序运行节点', () => {
    const a = createNode('prompt');
    const b = createNode('chat');
    const c = createNode('generate');
    const doc = {
      version: 3,
      nodes: [a, b, c],
      edges: [createEdge(a.id, b.id), createEdge(b.id, c.id)],
    };
    const { order, cycles } = topologicalOrder(doc);
    expect(cycles).toHaveLength(0);
    expect(order.indexOf(b.id)).toBeLessThan(order.indexOf(c.id));
  });

  it('删除分组保留子节点，复制子图重映射 id', () => {
    const a = createNode('prompt');
    const b = createNode('generate');
    const grouped = makeGroup(
      { version: 3, nodes: [a, b], edges: [] },
      [a.id, b.id],
      '测试分组',
    )!;
    const withoutGroup = removeNodes(grouped.doc, [grouped.groupId]);
    expect(withoutGroup.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());

    const cloned = cloneSubgraph([a, b], [createEdge(a.id, b.id)], { x: 40, y: 40 });
    expect(cloned.nodes.every((n) => n.id !== a.id && n.id !== b.id)).toBe(true);
    expect(cloned.edges).toHaveLength(1);
    expect(cloned.nodes[0].x).toBe(a.x + 40);

    const dup = duplicateNodes({ version: 3, nodes: [a, b], edges: [] }, [a.id]);
    expect(dup.newIds).toHaveLength(1);
  });
});

describe('geometry', () => {
  it('拖动时吸附到相邻节点的边缘', () => {
    const snap = computeSnap(
      { x: 102, y: 0, w: 100, h: 100 },
      [{ x: 0, y: 0, w: 100, h: 100 }],
      8,
      { grid: false, zoom: 1 },
    );
    expect(snap.dx).toBe(-2);
    expect(snap.guides.length).toBeGreaterThan(0);
  });

  it('适配视角保持内容居中', () => {
    const camera = fitCamera({ x: 300, y: 200, w: 400, h: 200 }, { w: 1000, h: 800 }, 100, 1);
    expect(camera.zoom).toBeGreaterThan(0);
    expect(camera.x + 500 * camera.zoom).toBeCloseTo(500, 0);
  });

  it('贝塞尔路径包含端点', () => {
    const path = edgePath({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(path.d).toContain('M 0 0');
    expect(path.d).toContain('100 50');
    expect(path.mid).toEqual({ x: 50, y: 25 });
  });
});

describe('schema', () => {
  it('清洗未知字段与非法的连接', () => {
    const doc = normalizeDoc({
      version: 99,
      nodes: [
        { id: 'a', kind: 'prompt', x: 10, y: 20, w: -5, h: 100, text: 'hi', junk: true },
        { id: 'b', kind: 'unknown' },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'missing' },
        { id: 'e2', from: 'a', to: 'a' },
      ],
    });
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].w).toBe(80);
    expect(doc.edges).toHaveLength(0);
    expect(doc.version).toBe(3);
  });

  it('工程导入导出保持结构', async () => {
    const project = createProject('测试画布');
    const node = createNode('generate', { prompt: '测试', aspect: '16:9', count: 2 });
    project.doc.nodes.push(node);
    const text = await serializeProject(project, [], { embedAssets: false });
    expect(text).toContain('muse-canvas');
    const imported = await deserializeProject(text);
    expect(imported.project.name).toBe('测试画布');
    expect(imported.project.id).not.toBe(project.id);
    expect(imported.project.doc.nodes).toHaveLength(1);
    const restored = imported.project.doc.nodes[0] as GenerateNode;
    expect(restored.aspect).toBe('16:9');
    expect(restored.count).toBe(2);
  });

  it('接受没有 format 字段的旧工程', () => {
    const project = normalizeProject({ name: '旧工程', nodes: [], edges: [] });
    expect(project.name).toBe('旧工程');
    expect(project.doc.version).toBe(3);
  });
});

describe('store', () => {
  it('撤销栈记录一次拖动', async () => {
    const { createEditorStore } = await import('../store/editor');
    const project = createProject('store test');
    const node = createNode('prompt', { x: 0, y: 0, text: 'a' }) as CanvasNode;
    project.doc.nodes.push(node);
    const store = createEditorStore(project);
    store.beginGesture('拖动');
    store.moveNodesBy([node.id], 40, 20);
    store.commitGesture();
    expect(store.getNode(node.id)?.x).toBe(40);
    expect(store.getSnapshot().past).toHaveLength(1);
    store.undo();
    expect(store.getNode(node.id)?.x).toBe(0);
    store.redo();
    expect(store.getNode(node.id)?.x).toBe(40);
    store.dispose();
  });
});
