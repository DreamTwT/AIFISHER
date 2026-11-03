import { describe, expect, it } from 'vitest';
import { Editor } from '../core/editor';
import { createNode, starterProject } from '../core/factory';
import { DEFAULT_MOTION_PROMPT, videoMode, videoPrompt } from '../core/modes';
import {
  canLink,
  edgeCurve,
  fitCamera,
  groupBounds,
  groupTitleAt,
  pointInNode,
  portVisible,
  rectContainsNode,
  snapRect,
  wouldCycle,
} from '../core/geometry';
import { sanitizeDoc, sanitizeProjectFile } from '../core/schema';
import { aspectSize } from '../core/types';

describe('prism graph core', () => {
  it('starter project has two text nodes, one generate node and one collage', () => {
    const project = starterProject();
    expect(project.doc.nodes.filter((node) => node.kind === 'prompt')).toHaveLength(2);
    expect(project.doc.nodes.filter((node) => node.kind === 'render')).toHaveLength(1);
    expect(project.doc.threads).toHaveLength(4);
    expect(project.doc.groups).toHaveLength(1);
    expect(project.camera.z).toBe(1);
  });

  it('only exposes ports that can accept or emit a connection', () => {
    const prompt = createNode('prompt', 0, 0);
    const render = createNode('render', 400, 0);
    const image = createNode('image', 800, 0);
    const weave = createNode('weave', 1200, 0);
    expect(portVisible(prompt, 'in')).toBe(false);
    expect(portVisible(prompt, 'out')).toBe(true);
    expect(portVisible(render, 'in')).toBe(true);
    expect(portVisible(render, 'out')).toBe(true);
    expect(portVisible(image, 'in')).toBe(false);
    expect(portVisible(image, 'out')).toBe(true);
    expect(portVisible(weave, 'in')).toBe(true);
    expect(portVisible(weave, 'out')).toBe(false);
    expect(canLink(prompt, render)).toBe(true);
    expect(canLink(render, weave)).toBe(true);
    expect(canLink(image, weave)).toBe(true);
    expect(canLink(prompt, weave)).toBe(false);
    expect(canLink(render, render)).toBe(false);
    expect(canLink(image, render)).toBe(false);
  });

  it('refuses connections the target cannot consume', () => {
    const editor = new Editor(starterProject());
    const prompt = editor.doc.nodes.find((node) => node.kind === 'prompt')!;
    const image = editor.doc.nodes.find((node) => node.kind === 'image')!;
    const before = editor.doc.threads.length;
    expect(editor.connect(prompt.id, image.id)).toBe(false);
    expect(editor.doc.threads).toHaveLength(before);
  });

  it('selects one node on click and the whole group only when asked', () => {
    const project = starterProject();
    const group = project.doc.groups[0];
    const editor = new Editor(project);
    editor.select([group.nodeIds[0]]);
    expect(editor.selection.size).toBe(1);
    expect(editor.selection.has(group.nodeIds[0])).toBe(true);
    editor.select(group.nodeIds);
    expect(editor.selection.size).toBe(group.nodeIds.length);
    expect(editor.selectionGroup()?.id).toBe(group.id);
  });

  it('drops generated images from a node while the library keeps them', () => {
    const editor = new Editor(starterProject());
    const render = editor.doc.nodes.find((node) => node.kind === 'render');
    expect(render?.kind).toBe('render');
    if (render?.kind !== 'render') return;
    render.assetIds = ['asset-a', 'asset-b'];
    render.status = 'done';
    expect(editor.removeNodeOutput(render.id, 'asset-a')).toBe(true);
    expect(render.assetIds).toEqual(['asset-b']);
    expect(editor.removeNodeOutput(render.id)).toBe(true);
    expect(render.assetIds).toEqual([]);
    expect(render.status).toBe('idle');
    expect(editor.undo()).toBe(true);
    const restored = editor.node(render.id);
    expect(restored?.kind === 'render' ? restored.assetIds : []).toEqual(['asset-b']);
  });

  it('clears several deleted assets in one history step', () => {
    const editor = new Editor(starterProject());
    const render = editor.doc.nodes.find((node) => node.kind === 'render');
    const image = createNode('image', 0, 0);
    editor.doc.nodes.push(image);
    if (render?.kind === 'render') render.assetIds = ['a', 'b'];
    if (image.kind === 'image') image.assetId = 'b';
    expect(editor.removeAssetReferences(['a', 'b'])).toBe(true);
    if (render?.kind === 'render') expect(render.assetIds).toEqual([]);
    if (image.kind === 'image') expect(image.assetId).toBeUndefined();
    expect(editor.undo()).toBe(true);
    const restoredRender = editor.node(render!.id);
    const restoredImage = editor.node(image.id);
    expect(restoredRender?.kind === 'render' ? restoredRender.assetIds : []).toEqual(['a', 'b']);
    expect(restoredImage?.kind === 'image' ? restoredImage.assetId : undefined).toBe('b');
  });

  it('clears every canvas reference when an asset is deleted', () => {
    const editor = new Editor(starterProject());
    const render = editor.doc.nodes.find((node) => node.kind === 'render');
    const image = createNode('image', 0, 0);
    editor.doc.nodes.push(image);
    if (render?.kind === 'render') render.assetIds = ['gone', 'kept'];
    if (image.kind === 'image') image.assetId = 'gone';
    expect(editor.removeAssetReferences('gone')).toBe(true);
    if (render?.kind === 'render') expect(render.assetIds).toEqual(['kept']);
    if (image.kind === 'image') expect(image.assetId).toBeUndefined();
    expect(editor.removeAssetReferences('gone')).toBe(false);
  });

  it('accepts video generation inputs and keeps video assets separate', () => {
    const project = starterProject();
    const prompt = project.doc.nodes.find((node) => node.kind === 'prompt')!;
    const image = createNode('image', -300, 600, { assetId: 'img-1' });
    const clip = createNode('clip', 0, 600, { assetId: 'clip-1' });
    const video = createNode('video', 300, 0, { prompt: 'slow push in', aspect: '9:16', seconds: 8 });
    const generated = createNode('render', 600, 600, { assetIds: ['render-1'] });
    project.doc.nodes.push(image, clip, video, generated);
    project.doc.threads.push(
      { id: 't-v1', from: prompt.id, to: video.id },
      { id: 't-v2', from: image.id, to: video.id },
      { id: 't-v3', from: clip.id, to: video.id },
      { id: 't-v4', from: generated.id, to: video.id },
    );
    const editor = new Editor(project);
    expect(portVisible(video, 'in')).toBe(true);
    expect(portVisible(video, 'out')).toBe(true);
    expect(portVisible(clip, 'in')).toBe(false);
    expect(portVisible(clip, 'out')).toBe(true);
    expect(canLink(image, video)).toBe(true);
    expect(canLink(clip, video)).toBe(true);
    expect(canLink(generated, video)).toBe(true);
    expect(editor.referenceAssets(video.id)).toEqual(['img-1', 'clip-1', 'render-1']);
    expect(editor.effectivePrompt(video.id)).toContain('slow push in');
    expect(editor.effectivePrompt(video.id)).toContain(prompt.text);
  });

  it('sanitizes video nodes and clamps the duration', () => {
    const doc = sanitizeDoc({
      nodes: [
        {
          id: 'v',
          kind: 'video',
          prompt: '夜晚的列车',
          aspect: '9:16',
          seconds: 99,
          assetIds: ['asset-v'],
          status: 'running',
        },
      ],
    });
    const node = doc.nodes[0];
    expect(node.kind).toBe('video');
    if (node.kind !== 'video') return;
    expect(node.aspect).toBe('9:16');
    expect(node.seconds).toBe(12);
    expect(node.assetIds).toEqual(['asset-v']);
    expect(node.status).toBe('idle');
  });

  it('groups, renames, duplicates and ungroups with undo', () => {
    const editor = new Editor(starterProject());
    const prompts = editor.doc.nodes.filter((node) => node.kind === 'prompt');
    editor.select([prompts[0].id]);
    editor.select([prompts[1].id], true);
    const group = editor.groupSelection('新的组');
    expect(group?.nodeIds).toHaveLength(2);
    editor.renameGroup(group!.id, '改过的组');
    expect(editor.selectionGroup()?.name).toBe('改过的组');
    editor.duplicateSelection();
    expect(editor.doc.groups.some((item) => item.name === '改过的组 副本')).toBe(true);
    editor.undo();
    editor.select([prompts[0].id, prompts[1].id]);
    expect(editor.ungroupSelection()).toBe(true);
    expect(editor.selectionGroup()).toBeUndefined();
    editor.undo();
    expect(editor.selectionGroup()?.name).toBe('改过的组');
  });

  it('hit tests rounded corners and requires full containment for box selection', () => {
    const node = createNode('prompt', 0, 0);
    expect(pointInNode({ x: 100, y: 100 }, node)).toBe(true);
    expect(pointInNode({ x: 0.5, y: 0.5 }, node)).toBe(false);
    expect(rectContainsNode({ x: -1, y: -1, w: 10, h: 10 }, node)).toBe(false);
    expect(rectContainsNode({ x: -1, y: -1, w: node.w + 2, h: node.h + 2 }, node)).toBe(true);
  });

  it('selects a group from its title band', () => {
    const project = starterProject();
    const group = project.doc.groups[0];
    const bounds = groupBounds(group, project.doc)!;
    expect(groupTitleAt(project.doc, { x: bounds.x + 10, y: bounds.y + 10 })?.id).toBe(group.id);
    expect(groupTitleAt(project.doc, { x: bounds.x + 10, y: bounds.y + 60 })).toBeUndefined();
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
    expect(doc.groups).toEqual([]);
    const render = doc.nodes[1];
    expect(render.kind).toBe('render');
    if (render.kind === 'render') {
      expect(render.count).toBe(4);
      expect(render.aspect).toBe('4:5');
    }
  });

  it('sanitizes groups and never puts one node in two groups', () => {
    const doc = sanitizeDoc({
      nodes: [
        { id: 'a', kind: 'prompt' },
        { id: 'b', kind: 'prompt' },
        { id: 'c', kind: 'prompt' },
      ],
      groups: [
        { id: 'g1', name: '一', nodeIds: ['a', 'b', 'b', 'missing'] },
        { id: 'g2', name: '二', nodeIds: ['b', 'c'] },
        { id: 'g3', name: '空', nodeIds: ['a'] },
      ],
    });
    expect(doc.groups).toHaveLength(1);
    expect(doc.groups[0].nodeIds).toEqual(['a', 'b']);
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

  it('snaps a dragged rect to neighbouring edges and centers', () => {
    const other = { x: 100, y: 0, w: 200, h: 100 };
    const edge = snapRect({ x: 95, y: 300, w: 100, h: 100 }, [other], 7);
    expect(edge.dx).toBe(5);
    expect(edge.guides.x).toContain(100);
    expect(edge.dy).toBe(0);

    const center = snapRect({ x: 145, y: 300, w: 100, h: 100 }, [other], 7);
    expect(center.dx).toBe(5);
    expect(center.guides.x).toContain(200);

    const free = snapRect({ x: 400, y: 300, w: 100, h: 100 }, [other], 7);
    expect(free.dx).toBe(0);
    expect(free.guides.x).toHaveLength(0);
  });

  it('nudges the selection and merges repeated arrow presses', () => {
    const editor = new Editor(starterProject());
    const node = editor.doc.nodes[0];
    const start = node.x;
    editor.select([node.id]);
    editor.nudgeSelection(1, 0);
    editor.nudgeSelection(1, 0);
    editor.nudgeSelection(0, 10);
    expect(editor.node(node.id)?.x).toBe(start + 2);
    expect(editor.node(node.id)?.y).toBe(node.y);
    expect(editor.undo()).toBe(true);
    expect(editor.node(node.id)?.x).toBe(start);
  });

  it('maps prompt and references to t2v, i2v and it2v', () => {
    expect(videoMode('', 0)).toBe('t2v');
    expect(videoMode('镜头推进', 0)).toBe('t2v');
    expect(videoMode('', 1)).toBe('i2v');
    expect(videoMode('', 4)).toBe('i2v');
    expect(videoMode('镜头推进', 1)).toBe('it2v');
    expect(videoPrompt('', 1)).toBe(DEFAULT_MOTION_PROMPT);
    expect(videoPrompt('  ', 2)).toBe(DEFAULT_MOTION_PROMPT);
    expect(videoPrompt('镜头推进', 2)).toBe('镜头推进');
    expect(videoPrompt('', 0)).toBe('');
  });

  it('computes aspect sizes consistently', () => {
    expect(aspectSize('1:1', 1000)).toEqual({ w: 1000, h: 1000 });
    expect(aspectSize('16:9', 1600)).toEqual({ w: 1600, h: 900 });
    expect(aspectSize('9:16', 1000)).toEqual({ w: 563, h: 1000 });
  });
});
