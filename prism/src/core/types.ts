/**
 * PRISM — 核心数据模型
 *
 * 文档只描述画布：节点、连线、位置与参数。
 * 相机、选择、素材二进制都不进入文档，便于撤销与导出。
 */

export type ID = string;

export type NodeKind = 'prompt' | 'render' | 'image' | 'weave' | 'video' | 'clip';

export type RunState = 'idle' | 'running' | 'done' | 'error';

export type Aspect = '1:1' | '4:5' | '3:4' | '16:9' | '9:16' | '3:2';

export const ASPECTS: { id: Aspect; label: string; w: number; h: number }[] = [
  { id: '1:1', label: '1 : 1', w: 1, h: 1 },
  { id: '4:5', label: '4 : 5', w: 4, h: 5 },
  { id: '3:4', label: '3 : 4', w: 3, h: 4 },
  { id: '16:9', label: '16 : 9', w: 16, h: 9 },
  { id: '9:16', label: '9 : 16', w: 9, h: 16 },
  { id: '3:2', label: '3 : 2', w: 3, h: 2 },
];

export interface NodeBase {
  id: ID;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
}

export interface PromptNode extends NodeBase {
  kind: 'prompt';
  text: string;
  role: 'direction' | 'style' | 'note';
}

export interface RenderNode extends NodeBase {
  kind: 'render';
  /** 留空时只使用上游提示词 */
  prompt: string;
  aspect: Aspect;
  count: number;
  seed: number | null;
  assetIds: ID[];
  status: RunState;
  progress: number;
  error?: string;
}

export interface ImageNode extends NodeBase {
  kind: 'image';
  assetId?: ID;
  caption: string;
}

export interface VideoNode extends NodeBase {
  kind: 'video';
  /** 留空时只使用上游提示词 */
  prompt: string;
  aspect: Aspect;
  seconds: number;
  seed: number | null;
  assetIds: ID[];
  status: RunState;
  progress: number;
  error?: string;
}

export interface ClipNode extends NodeBase {
  kind: 'clip';
  assetId?: ID;
  caption: string;
}

export interface WeaveNode extends NodeBase {
  kind: 'weave';
  columns: number;
  gap: number;
  caption: string;
}

export type SceneNode = PromptNode | RenderNode | ImageNode | WeaveNode | VideoNode | ClipNode;

export interface Thread {
  id: ID;
  from: ID;
  to: ID;
}

/** 编组只是逻辑容器：不参与提示词计算，也不改变连线。 */
export interface Group {
  id: ID;
  name: string;
  nodeIds: ID[];
}

export interface Doc {
  version: 1;
  nodes: SceneNode[];
  threads: Thread[];
  groups: Group[];
}

export interface Camera {
  x: number;
  y: number;
  z: number;
}

export interface Project {
  id: ID;
  name: string;
  doc: Doc;
  camera: Camera;
  createdAt: number;
  updatedAt: number;
  thumb?: string;
}

export interface AssetMeta {
  id: ID;
  name: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  createdAt: number;
  source: 'upload' | 'render';
  /** 缺省视为图片 */
  kind?: 'image' | 'video';
  /** 视频时长（秒），仅视频素材有 */
  duration?: number;
  prompt?: string;
  seed?: number;
  model?: string;
  /** 生成模式，例如「图生视频」；仅生成素材有 */
  mode?: string;
}

export interface AssetRecord extends AssetMeta {
  blob: Blob;
}

export interface Settings {
  endpoint: string;
  apiKey: string;
  model: string;
  /** 视频模型；留空时沿用图像模型 */
  videoModel?: string;
  demo: boolean;
  concurrency: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  w: number;
  h: number;
}

export const NODE_LABEL: Record<NodeKind, string> = {
  prompt: '文本',
  render: '生成',
  image: '图片',
  weave: '拼图',
  video: '视频生成',
  clip: '视频',
};

/** 视频节点最多接 4 个参考（图片或视频）。 */
export const MAX_VIDEO_REFS = 4;

export const NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
  prompt: { w: 300, h: 214 },
  render: { w: 356, h: 462 },
  image: { w: 320, h: 322 },
  weave: { w: 386, h: 318 },
  video: { w: 360, h: 452 },
  clip: { w: 320, h: 322 },
};

export function aspectSize(aspect: Aspect, edge = 1024): { w: number; h: number } {
  const item = ASPECTS.find((a) => a.id === aspect) ?? ASPECTS[0];
  if (item.w >= item.h) return { w: edge, h: Math.round((edge * item.h) / item.w) };
  return { w: Math.round((edge * item.w) / item.h), h: edge };
}

export function isPrompt(node: SceneNode): node is PromptNode {
  return node.kind === 'prompt';
}

export function isRender(node: SceneNode): node is RenderNode {
  return node.kind === 'render';
}

export function isImage(node: SceneNode): node is ImageNode {
  return node.kind === 'image';
}

export function isWeave(node: SceneNode): node is WeaveNode {
  return node.kind === 'weave';
}
