import { uid } from '../lib/util';
import type {
  AudioNode,
  Camera,
  CanvasDoc,
  CanvasNode,
  ChatNode,
  Edge,
  GenerateNode,
  GroupNode,
  ID,
  ImageNode,
  NodeKind,
  Project,
  PromptNode,
  PromptRole,
  VideoNode,
} from './types';

export const DOC_VERSION = 3;

export const NODE_DEFAULTS: Record<NodeKind, { w: number; h: number; title: string }> = {
  prompt: { w: 320, h: 228, title: '提示词' },
  image: { w: 340, h: 400, title: '图像' },
  video: { w: 400, h: 292, title: '视频' },
  audio: { w: 340, h: 180, title: '音频' },
  generate: { w: 392, h: 552, title: '图像生成' },
  chat: { w: 424, h: 500, title: '对话模型' },
  group: { w: 520, h: 380, title: '分组' },
};

export function nodeBase(kind: NodeKind, x: number, y: number, z: number, patch: Partial<CanvasNode> = {}) {
  const now = Date.now();
  const defaults = NODE_DEFAULTS[kind];
  return {
    id: uid(kind),
    kind,
    x: Math.round(x),
    y: Math.round(y),
    w: defaults.w,
    h: defaults.h,
    title: defaults.title,
    z,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

export interface CreateNodeOptions {
  x?: number;
  y?: number;
  z?: number;
  title?: string;
  w?: number;
  h?: number;
  text?: string;
  prompt?: string;
  system?: string;
  output?: string;
  negative?: string;
  temperature?: number;
  role?: PromptRole;
  aspect?: import('./types').AspectRatio;
  count?: number;
  seed?: number | null;
}

export function createNode(kind: NodeKind, options: CreateNodeOptions = {}): CanvasNode {
  const { x = 0, y = 0, z = 1, title, w, h } = options;
  const base = nodeBase(kind, x, y, z);
  if (title) base.title = title;
  if (w) base.w = w;
  if (h) base.h = h;
  switch (kind) {
    case 'prompt':
      return {
        ...base,
        kind,
        text: options.text ?? '',
        role: options.role ?? 'prompt',
      } as PromptNode;
    case 'image':
      return { ...base, kind, source: 'upload' } as ImageNode;
    case 'video':
      return { ...base, kind, source: 'upload' } as VideoNode;
    case 'audio':
      return { ...base, kind, source: 'upload' } as AudioNode;
    case 'generate':
      return {
        ...base,
        kind,
        prompt: options.prompt ?? options.text ?? '',
        negative: options.negative ?? '',
        aspect: options.aspect ?? '1:1',
        count: options.count ?? 1,
        seed: options.seed ?? null,
        outputs: [],
        activeOutput: 0,
        status: 'idle',
        progress: 0,
        autoRun: false,
      } as GenerateNode;
    case 'chat':
      return {
        ...base,
        kind,
        system:
          options.system ??
          '你是一位资深创意总监与提示词工程师。请用中文给出具体、可执行的建议。',
        prompt: options.prompt ?? options.text ?? '',
        output: options.output ?? '',
        temperature: options.temperature ?? 0.7,
        status: 'idle',
        turns: [],
      } as ChatNode;
    case 'group':
      return {
        ...base,
        kind,
        memberIds: [],
        color: 'amber',
      } as GroupNode;
  }
}

export function createEdge(from: ID, to: ID): Edge {
  return { id: uid('e'), from, to, createdAt: Date.now() };
}

export function emptyDoc(): CanvasDoc {
  return { version: DOC_VERSION, nodes: [], edges: [] };
}

export function emptyCamera(): Camera {
  return { x: 0, y: 0, zoom: 1, auto: true };
}

export function createProject(name = '未命名画布'): Project {
  const now = Date.now();
  return {
    id: uid('p'),
    name,
    createdAt: now,
    updatedAt: now,
    nodeCount: 0,
    doc: emptyDoc(),
    camera: emptyCamera(),
  };
}
