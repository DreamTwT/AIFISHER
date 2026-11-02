/**
 * MUSE Canvas 数据模型
 *
 * 设计目标：
 * - 文档（nodes + edges）与界面状态（相机、选择）分离，撤销栈只记录文档；
 * - 所有素材通过 asset id 引用，二进制存放在 IndexedDB，导出时再内联；
 * - 节点联合类型保持可判别，序列化升级集中在 schema.ts。
 */

export type ID = string;

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AspectRatio = '1:1' | '4:5' | '3:4' | '2:3' | '16:9' | '9:16' | '3:2' | '21:9';

export const ASPECTS: { id: AspectRatio; label: string; w: number; h: number }[] = [
  { id: '1:1', label: '方形 1:1', w: 1, h: 1 },
  { id: '4:5', label: '竖版 4:5', w: 4, h: 5 },
  { id: '3:4', label: '竖版 3:4', w: 3, h: 4 },
  { id: '2:3', label: '竖版 2:3', w: 2, h: 3 },
  { id: '16:9', label: '横板 16:9', w: 16, h: 9 },
  { id: '9:16', label: '竖屏 9:16', w: 9, h: 16 },
  { id: '3:2', label: '横板 3:2', w: 3, h: 2 },
  { id: '21:9', label: '宽银幕 21:9', w: 21, h: 9 },
];

export type TaskStatus = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'canceled';

export type NodeKind = 'prompt' | 'image' | 'video' | 'audio' | 'generate' | 'chat' | 'group';

export interface BaseNode {
  id: ID;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  /** 画布内层叠顺序，越大越靠上 */
  z: number;
  locked?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type PromptRole = 'prompt' | 'style' | 'note' | 'negative';

export interface PromptNode extends BaseNode {
  kind: 'prompt';
  text: string;
  role: PromptRole;
}

export type MediaSource = 'upload' | 'generation' | 'url';

export interface ImageNode extends BaseNode {
  kind: 'image';
  assetId?: ID;
  url?: string;
  caption?: string;
  source: MediaSource;
}

export interface VideoNode extends BaseNode {
  kind: 'video';
  assetId?: ID;
  url?: string;
  caption?: string;
  source: MediaSource;
}

export interface AudioNode extends BaseNode {
  kind: 'audio';
  assetId?: ID;
  url?: string;
  caption?: string;
  source: MediaSource;
  duration?: number;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface GenerateNode extends BaseNode {
  kind: 'generate';
  prompt: string;
  negative: string;
  model?: ModelRef;
  aspect: AspectRatio;
  count: number;
  seed: number | null;
  /** 生成结果，按时间倒序追加 */
  outputs: ID[];
  activeOutput: number;
  status: TaskStatus;
  progress: number;
  error?: string;
  taskId?: string;
  elapsedMs?: number;
  autoRun?: boolean;
}

export interface ChatNode extends BaseNode {
  kind: 'chat';
  system: string;
  prompt: string;
  output: string;
  model?: ModelRef;
  temperature: number;
  status: TaskStatus;
  error?: string;
  taskId?: string;
  /** 历史消息（保留最近若干轮，便于继续追问） */
  turns: { role: 'user' | 'assistant'; content: string; at: number }[];
}

export interface GroupNode extends BaseNode {
  kind: 'group';
  memberIds: ID[];
  color: string;
  collapsed?: boolean;
}

export type CanvasNode =
  | PromptNode
  | ImageNode
  | VideoNode
  | AudioNode
  | GenerateNode
  | ChatNode
  | GroupNode;

export type NodeOf<K extends NodeKind> = Extract<CanvasNode, { kind: K }>;

export interface Edge {
  id: ID;
  from: ID;
  to: ID;
  createdAt: number;
}

export interface CanvasDoc {
  version: number;
  nodes: CanvasNode[];
  edges: Edge[];
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  /** 首次进入时自动适配内容，用户操作后清除 */
  auto?: boolean;
}

export interface ProjectMeta {
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  /** 最近一次快照生成的小尺寸预览（dataURL），用于项目卡片 */
  thumbnail?: string;
}

export interface Project extends ProjectMeta {
  doc: CanvasDoc;
  camera: Camera;
}

export type ProviderKind = 'demo' | 'openai-chat' | 'openai-image';

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  /** 可选模型列表，逗号分隔；留空使用内置建议 */
  models: string[];
  vision?: boolean;
  enabled: boolean;
}

export interface Settings {
  providers: ProviderConfig[];
  defaultImageModel?: ModelRef;
  defaultChatModel?: ModelRef;
  grid: boolean;
  snap: boolean;
  autoRunOnConnect: boolean;
  showMinimap: boolean;
  concurrency: number;
  /** 素材以原始质量保存；关闭后大图会被压缩以节省空间 */
  keepOriginal: boolean;
}

export interface TaskInfo {
  id: ID;
  nodeId: ID;
  kind: 'image' | 'chat';
  label: string;
  status: TaskStatus;
  progress: number;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface Toast {
  id: ID;
  kind: 'info' | 'success' | 'error';
  message: string;
  actionLabel?: string;
  action?: () => void;
}

export interface AssetMeta {
  id: ID;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: number;
  source: MediaSource;
  /** 生成该素材时使用的提示词，便于回查 */
  prompt?: string;
  model?: string;
  seed?: number;
}

export interface Asset extends AssetMeta {
  blob: Blob;
}

export interface GeneratedImage {
  blob: Blob;
  width: number;
  height: number;
  seed: number;
  prompt: string;
  model: string;
  /** 生成所消耗的时间，用于界面反馈 */
  elapsedMs: number;
}

export interface GenerationInput {
  prompt: string;
  negative: string;
  aspect: AspectRatio;
  count: number;
  seed: number | null;
  referenceImages: { blob: Blob; name: string }[];
  signal: AbortSignal;
  onProgress?: (value: number, note?: string) => void;
}

export interface GenerationResult {
  images: GeneratedImage[];
}

export interface ProviderAdapter {
  kind: ProviderKind;
  generateImage(input: GenerationInput, config: ProviderConfig, model: string): Promise<GenerationResult>;
  chat(
    messages: { role: 'system' | 'user' | 'assistant'; content: string | { type: 'text' | 'image_url'; text?: string; imageUrl?: string }[] }[],
    config: ProviderConfig,
    model: string,
    opts: { signal: AbortSignal; temperature?: number; onDelta?: (text: string) => void },
  ): Promise<string>;
}
