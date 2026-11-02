import { describe, expect, it } from 'vitest';
import { Editor } from '../core/editor';
import { createNode, starterProject } from '../core/factory';
import { edgeCurve, fitCamera, wouldCycle } from '../core/geometry';
import { sanitizeDoc, sanitizeProjectFile } from '../core/schema';
import { aspectSize } from '../core/types';

describe('weft graph core', () => {
  it('starter project has two warps, one weft and a weave', () => {
    const project = starterProject();
    expect(project.doc.nodes.filter((node) => node.kind === 'prompt')).toHaveLength(2);
    expect(project.doc.nodes.filter((node) => node.kind === 'render')).toHaveLength(1);
    expect(project.doc.threads).toHaveLength(4);
    expect(project.camera.z).toBe(1);
  });

  it('rejects duplicate and cyclic threads', () => {
    const project = starterProject();
    const [first, second] = project.doc.threads;
    expect(wouldCycle(project.doc, second.to, first.from)).toBe(true);
    const editor = new Editor(project);
    expect(editor.connect(first.from, first.to)).toBe(false);
    expect(editor.connect(second.to, first.from)).toBe(false);
    expect(editor.doc.threads).toHaveLength(4);
  });

  it('composes upstream prompts in order and appends local text', () => {
    const project = starterProject();
    const render = project.doc.nodes.find((node) => node.kind === 'render')!;
    const editor = new Editor(project);
    const prompt = editor.effectivePrompt(render.id);
    expect(prompt).toContain('海边印刷所');
    expect(prompt).toContain('anamorphic still');
    editor.updateNode(render.id, { prompt: 'extra local note' });
    expect(editor.effectivePrompt(render.id)).toContain('extra local note');
  });

  it('undoes and redoes node creation', () => {
    const editor = new Editor(starterProject());
    const before = editor.doc.nodes.length;
    editor.addNode('prompt', 100, 100, { text: 'one' });
    expect(editor.doc.nodes.length).toBe(before + 1);
    expect(editor.undo()).toBe(true);
    expect(editor.doc.nodes.length).toBe(before);
    expect(editor.redo()).toBe(true);
    expect(editor.doc.nodes.length).toBe(before + 1);
  });

  it('groups a node with its auto connections when record=false', () => {
    const editor = new Editor(starterProject());
    const prompt = editor.doc.nodes.find((node) => node.kind === 'prompt')!;
    const count = editor.doc.nodes.length;
    editor.begin();
    const render = editor.addNode('render', 800, 0, {}, false);
    expect(editor.connect(prompt.id, render.id, false)).toBe(true);
    editor.end(true);
    expect(editor.doc.threads.some((thread) => thread.from === prompt.id && thread.to === render.id)).toBe(true);
    editor.undo();
    expect(editor.doc.nodes.length).toBe(count);
    expect(editor.doc.threads.some((thread) => thread.to === render.id)).toBe(false);
  });

  it('creates backwards edges without self-intersecting control points', () => {
    const from = createNode('render', 400, 0);
    const to = createNode('prompt', -200, 100);
    const curve = edgeCurve(from, to);
    expect(curve.c1.x).toBeGreaterThan(curve.start.x);
    expect(curve.c2.x).toBeLessThan(curve.end.x);
    expect(curve.mid.y).toBeLessThan(curve.start.y);
  });

  it('sanitizes imported documents and drops dangling threads', () => {
    const doc = sanitizeDoc({
      nodes: [
        { id: 'a', kind: 'prompt', x: 0, y: 0, text: 'hello', role: 'style' },
        { id: 'b', kind: 'render', x: 40, y: 0, count: 12, aspect: 'banana' },
        { id: 'c', kind: 'nope' },
      ],
      threads: [
        { id: 't1', from: 'a', to: 'b' },
        { id: 't2', from: 'b', to: 'missing' },
        { id: 't3', from: 'a', to: 'a' },
        { id: 't4', from: 'a', to: 'b' },
      ],
    });
    expect(doc.nodes).toHaveLength(2);
    expect(doc.threads).toHaveLength(1);
    const render = doc.nodes[1];
    expect(render.kind).toBe('render');
    if (render.kind === 'render') {
      expect(render.count).toBe(4);
      expect(render.aspect).toBe('4:5');
    }
  });

  it('rejects files from other tools', () => {
    expect(() => sanitizeProjectFile({ format: 'other' })).toThrow();
  });

  it('fit camera keeps content inside the viewport', () => {
    const nodes = [
      createNode('prompt', -500, -200),
      createNode('render', 500, 200),
    ];
    const camera = fitCamera(nodes, 1200, 800, 60);
    expect(camera.z).toBeGreaterThan(0.2);
    const left = -500 * camera.z + camera.x;
    const top = -200 * camera.z + camera.y;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it('computes aspect sizes consistently', () => {
    expect(aspectSize('1:1', 1000)).toEqual({ w: 1000, h: 1000 });
    expect(aspectSize('16:9', 1600)).toEqual({ w: 1600, h: 900 });
    expect(aspectSize('9:16', 1000)).toEqual({ w: 563, h: 1000 });
  });
});
