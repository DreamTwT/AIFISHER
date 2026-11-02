import type { Camera, Doc, ID, NodeKind, Project, SceneNode } from './types';
import { NODE_SIZE } from './types';
import { uid } from './util';

export function emptyDoc(): Doc {
  return { version: 1, nodes: [], threads: [] };
}

export function createNode(kind: NodeKind, x: number, y: number, patch: Partial<SceneNode> = {}): SceneNode {
  const size = NODE_SIZE[kind];
  const base = {
    id: uid(kind),
    kind,
    x,
    y,
    w: size.w,
    h: size.h,
    title: '',
  };
  switch (kind) {
    case 'prompt':
      return {
        ...base,
        kind,
        title: '经线',
        text: '',
        role: 'direction',
        ...patch,
      } as SceneNode;
    case 'render':
      return {
        ...base,
        kind,
        title: '纬线',
        prompt: '',
        aspect: '4:5',
        count: 2,
        seed: null,
        assetIds: [],
        status: 'idle',
        progress: 0,
        ...patch,
      } as SceneNode;
    case 'image':
      return {
        ...base,
        kind,
        title: '布样',
        assetId: undefined,
        caption: '',
        ...patch,
      } as SceneNode;
    case 'weave':
      return {
        ...base,
        kind,
        title: '织片',
        columns: 2,
        gap: 8,
        caption: '',
        ...patch,
      } as SceneNode;
  }
}

export function createProject(name = '未命名织机'): Project {
  const now = Date.now();
  return {
    id: uid('p'),
    name,
    doc: emptyDoc(),
    camera: { x: 0, y: 0, z: 1 },
    createdAt: now,
    updatedAt: now,
  };
}

export function starterProject(): Project {
  const project = createProject('潮汐工坊 · 001');
  const direction = createNode('prompt', -620, -170, {
    title: '织造方向',
    role: 'direction',
    text:
      '一座被潮汐包围的海边印刷所。清晨的雾、湿透的木板、晾在绳上的半成品布。\n' +
      '画面要安静、克制，像一张被海水泡过的旧样张。',
  });
  const style = createNode('prompt', -620, 90, {
    title: '质地与光线',
    role: 'style',
    text: 'anamorphic still, soft dawn light, raw linen texture, muted teal and rust, 35mm grain, quiet composition',
  });
  const render = createNode('render', -250, -170, {
    title: '主幅 · 潮汐样张',
    prompt: '',
    aspect: '4:5',
    count: 2,
    seed: 8128,
  });
  const sample = createNode('image', -250, 330, {
    title: '布样 · 初织',
    caption: '第一块试织样',
  });
  const weave = createNode('weave', 190, -40, {
    title: '织片 · 样本页',
    columns: 3,
    gap: 10,
    caption: '潮汐工坊 / 试织记录',
  });

  project.doc = {
    version: 1,
    nodes: [direction, style, render, sample, weave],
    threads: [
      { id: uid('t'), from: direction.id, to: render.id },
      { id: uid('t'), from: style.id, to: render.id },
      { id: uid('t'), from: render.id, to: weave.id },
      { id: uid('t'), from: sample.id, to: weave.id },
    ],
  };
  return project;
}

export function cameraFor(project: Project, width: number, height: number): Camera {
  const nodes = project.doc.nodes;
  if (!nodes.length) return { x: width / 2, y: height / 2, z: 0.9 };
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
  const zoom = Math.max(
    0.18,
    Math.min(1.05, Math.min((width - 160) / (maxX - minX), (height - 160) / (maxY - minY))),
  );
  return {
    x: width / 2 - ((minX + maxX) / 2) * zoom,
    y: height / 2 - ((minY + maxY) / 2) * zoom,
    z: zoom,
  };
}

/** 示例织片的占位提示词，第一次启动时用于生成一张离线样张 */
export const STARTER_SAMPLE_PROMPT =
  'a quiet seaside print studio at dawn, wet linen, fog, rust and deep teal, cinematic still, 35mm grain';


export function findNode(doc: Doc, id: ID): SceneNode | undefined {
  return doc.nodes.find((node) => node.id === id);
}
