import { blobToDataURL, dataURLToBlob, uid } from '../lib/util';
import { DOC_VERSION } from './factory';
import type {
  AspectRatio,
  Asset,
  AssetMeta,
  Camera,
  CanvasDoc,
  CanvasNode,
  ChatNode,
  Edge,
  GenerateNode,
  ID,
  NodeKind,
  Project,
  ProviderConfig,
  Settings,
} from './types';
import { ASPECTS } from './types';

const KINDS: NodeKind[] = ['prompt', 'image', 'video', 'audio', 'generate', 'chat', 'group'];
const ASPECT_IDS = new Set(ASPECTS.map((a) => a.id));

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const bool = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;
const aspect = (value: unknown): AspectRatio =>
  typeof value === 'string' && ASPECT_IDS.has(value as AspectRatio) ? (value as AspectRatio) : '1:1';

function normalizeNode(raw: unknown, index: number): CanvasNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind as NodeKind;
  if (!KINDS.includes(kind)) return null;
  const id = typeof r.id === 'string' && r.id ? r.id : uid(kind);
  const now = Date.now();
  const base = {
    id,
    kind,
    x: num(r.x, 0),
    y: num(r.y, 0),
    w: Math.max(80, num(r.w, 320)),
    h: Math.max(60, num(r.h, 220)),
    title: str(r.title, ''),
    z: num(r.z, index + 1),
    locked: bool(r.locked),
    createdAt: num(r.createdAt, now),
    updatedAt: num(r.updatedAt, now),
  };
  switch (kind) {
    case 'prompt':
      return {
        ...base,
        kind,
        text: str(r.text),
        role: (['prompt', 'style', 'note', 'negative'] as const).includes(r.role as never)
          ? (r.role as 'prompt' | 'style' | 'note' | 'negative')
          : 'prompt',
      };
    case 'image':
      return {
        ...base,
        kind,
        assetId: str(r.assetId) || undefined,
        url: str(r.url) || undefined,
        caption: str(r.caption) || undefined,
        source: r.source === 'generation' || r.source === 'url' ? r.source : 'upload',
      };
    case 'video':
      return {
        ...base,
        kind,
        assetId: str(r.assetId) || undefined,
        url: str(r.url) || undefined,
        caption: str(r.caption) || undefined,
        source: r.source === 'generation' || r.source === 'url' ? r.source : 'upload',
      };
    case 'audio':
      return {
        ...base,
        kind,
        assetId: str(r.assetId) || undefined,
        url: str(r.url) || undefined,
        caption: str(r.caption) || undefined,
        source: r.source === 'generation' || r.source === 'url' ? r.source : 'upload',
        duration: typeof r.duration === 'number' ? r.duration : undefined,
      };
    case 'generate': {
      const outputs = Array.isArray(r.outputs) ? r.outputs.filter((x): x is string => typeof x === 'string') : [];
      return {
        ...base,
        kind,
        prompt: str(r.prompt),
        negative: str(r.negative),
        model:
          r.model && typeof r.model === 'object'
            ? {
                providerId: str((r.model as Record<string, unknown>).providerId, 'demo'),
                modelId: str((r.model as Record<string, unknown>).modelId, 'muse-1'),
              }
            : undefined,
        aspect: aspect(r.aspect),
        count: Math.min(4, Math.max(1, num(r.count, 1))),
        seed: typeof r.seed === 'number' ? r.seed : null,
        outputs,
        activeOutput: Math.min(Math.max(0, outputs.length - 1), Math.max(0, num(r.activeOutput, 0))),
        status: 'idle',
        progress: 0,
        autoRun: bool(r.autoRun),
      };
    }
    case 'chat': {
      const turns = Array.isArray(r.turns)
        ? r.turns
            .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
            .map((t) => ({
              role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
              content: str(t.content),
              at: num(t.at, now),
            }))
        : [];
      return {
        ...base,
        kind,
        system: str(r.system),
        prompt: str(r.prompt),
        output: str(r.output),
        model:
          r.model && typeof r.model === 'object'
            ? {
                providerId: str((r.model as Record<string, unknown>).providerId, 'demo'),
                modelId: str((r.model as Record<string, unknown>).modelId, 'muse-chat'),
              }
            : undefined,
        temperature: Math.max(0, Math.min(2, num(r.temperature, 0.7))),
        status: 'idle',
        turns,
      };
    }
    case 'group':
      return {
        ...base,
        kind,
        memberIds: Array.isArray(r.memberIds)
          ? r.memberIds.filter((x): x is string => typeof x === 'string')
          : [],
        color: str(r.color, 'amber'),
        collapsed: bool(r.collapsed),
      };
  }
}

export function normalizeDoc(raw: unknown): CanvasDoc {
  if (!raw || typeof raw !== 'object') return { version: DOC_VERSION, nodes: [], edges: [] };
  const r = raw as Record<string, unknown>;
  const nodesRaw = Array.isArray(r.nodes) ? r.nodes : [];
  const nodes = nodesRaw
    .map((n, i) => normalizeNode(n, i))
    .filter((n): n is CanvasNode => n !== null);
  const ids = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = (Array.isArray(r.edges) ? r.edges : [])
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map((e) => ({
      id: str(e.id) || uid('e'),
      from: str(e.from),
      to: str(e.to),
      createdAt: num(e.createdAt, Date.now()),
    }))
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);

  // 分组引用清理
  for (const n of nodes) {
    if (n.kind === 'group') n.memberIds = n.memberIds.filter((id) => ids.has(id) && id !== n.id);
  }
  return { version: DOC_VERSION, nodes, edges };
}

export function normalizeCamera(raw: unknown): Camera {
  if (!raw || typeof raw !== 'object') return { x: 0, y: 0, zoom: 1 };
  const r = raw as Record<string, unknown>;
  return {
    x: num(r.x, 0),
    y: num(r.y, 0),
    zoom: Math.min(3, Math.max(0.15, num(r.zoom, 1))),
  };
}

export function normalizeProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('工程文件格式无效');
  const r = raw as Record<string, unknown>;
  const doc = normalizeDoc(r.doc ?? r);
  const now = Date.now();
  return {
    id: str(r.id) || uid('p'),
    name: str(r.name, '导入的画布'),
    createdAt: num(r.createdAt, now),
    updatedAt: num(r.updatedAt, now),
    nodeCount: doc.nodes.length,
    thumbnail: str(r.thumbnail) || undefined,
    doc,
    camera: normalizeCamera(r.camera),
  };
}

export interface ProjectExport {
  format: 'muse-canvas';
  version: number;
  exportedAt: number;
  project: Omit<Project, 'thumbnail'>;
  assets?: {
    id: ID;
    name: string;
    mime: string;
    width?: number;
    height?: number;
    duration?: number;
    createdAt: number;
    source: AssetMeta['source'];
    prompt?: string;
    model?: string;
    seed?: number;
    dataUrl: string;
  }[];
}

export async function serializeProject(
  project: Project,
  assets: Asset[],
  options: { embedAssets: boolean },
): Promise<string> {
  const payload: ProjectExport = {
    format: 'muse-canvas',
    version: DOC_VERSION,
    exportedAt: Date.now(),
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      nodeCount: project.doc.nodes.length,
      doc: project.doc,
      camera: project.camera,
    },
  };
  if (options.embedAssets) {
    payload.assets = await Promise.all(
      assets.map(async (asset) => ({
        id: asset.id,
        name: asset.name,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
        createdAt: asset.createdAt,
        source: asset.source,
        prompt: asset.prompt,
        model: asset.model,
        seed: asset.seed,
        dataUrl: await blobToDataURL(asset.blob),
      })),
    );
  }
  return JSON.stringify(payload, null, 2);
}

export interface ImportResult {
  project: Project;
  assets: { meta: AssetMeta; blob: Blob }[];
}

export async function deserializeProject(text: string): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.format && raw.format !== 'muse-canvas') throw new Error('不是 MUSE 画布工程文件');
  const project = normalizeProject(raw.project ?? raw);
  const idMap = new Map<string, string>();
  const assets: { meta: AssetMeta; blob: Blob }[] = [];
  if (Array.isArray(raw.assets)) {
    for (const item of raw.assets) {
      if (!item || typeof item !== 'object') continue;
      const a = item as Record<string, unknown>;
      const dataUrl = str(a.dataUrl);
      if (!dataUrl.startsWith('data:')) continue;
      const blob = await dataURLToBlob(dataUrl);
      const oldId = str(a.id);
      const newId = uid('a');
      if (oldId) idMap.set(oldId, newId);
      assets.push({
        blob,
        meta: {
          id: newId,
          name: str(a.name, '素材'),
          mime: str(a.mime, blob.type || 'application/octet-stream'),
          size: blob.size,
          width: typeof a.width === 'number' ? a.width : undefined,
          height: typeof a.height === 'number' ? a.height : undefined,
          duration: typeof a.duration === 'number' ? a.duration : undefined,
          createdAt: num(a.createdAt, Date.now()),
          source: (['upload', 'generation', 'url'] as const).includes(a.source as never)
            ? (a.source as AssetMeta['source'])
            : 'upload',
          prompt: str(a.prompt) || undefined,
          model: str(a.model) || undefined,
          seed: typeof a.seed === 'number' ? a.seed : undefined,
        },
      });
    }
  }
  const mapId = (id?: string) => (id ? idMap.get(id) ?? id : undefined);
  project.doc = {
    ...project.doc,
    nodes: project.doc.nodes.map((node) => {
      if (node.kind === 'image' || node.kind === 'video' || node.kind === 'audio') {
        return { ...node, assetId: mapId(node.assetId) };
      }
      if (node.kind === 'generate') {
        return {
          ...(node as GenerateNode),
          outputs: (node as GenerateNode).outputs.map((id) => mapId(id) ?? id),
        };
      }
      return node;
    }),
  };
  // 导入的工程一律分配新 id，避免覆盖现有画布
  project.id = uid('p');
  project.updatedAt = Date.now();
  return { project, assets };
}

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const providers: ProviderConfig[] = Array.isArray(r.providers)
    ? r.providers
        .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
        .map((p) => ({
          id: str(p.id) || uid('prov'),
          name: str(p.name, '自定义服务'),
          kind: (['demo', 'openai-chat', 'openai-image'] as const).includes(p.kind as never)
            ? (p.kind as ProviderConfig['kind'])
            : 'openai-chat',
          baseUrl: str(p.baseUrl),
          apiKey: str(p.apiKey),
          models: Array.isArray(p.models)
            ? p.models.filter((m): m is string => typeof m === 'string')
            : [],
          vision: bool(p.vision),
          enabled: p.enabled !== false,
        }))
    : [];
  return {
    providers,
    defaultImageModel:
      r.defaultImageModel && typeof r.defaultImageModel === 'object'
        ? {
            providerId: str((r.defaultImageModel as Record<string, unknown>).providerId),
            modelId: str((r.defaultImageModel as Record<string, unknown>).modelId),
          }
        : undefined,
    defaultChatModel:
      r.defaultChatModel && typeof r.defaultChatModel === 'object'
        ? {
            providerId: str((r.defaultChatModel as Record<string, unknown>).providerId),
            modelId: str((r.defaultChatModel as Record<string, unknown>).modelId),
          }
        : undefined,
    grid: bool(r.grid, true),
    snap: bool(r.snap, true),
    autoRunOnConnect: bool(r.autoRunOnConnect, false),
    showMinimap: bool(r.showMinimap, true),
    concurrency: Math.min(4, Math.max(1, num(r.concurrency, 2))),
    keepOriginal: bool(r.keepOriginal, true),
  };
}

export function defaultSettings(): Settings {
  return normalizeSettings({
    providers: [
      {
        id: 'demo',
        name: '内置样例引擎（离线）',
        kind: 'demo',
        baseUrl: '',
        apiKey: '',
        models: ['muse-1', 'muse-1-turbo'],
        enabled: true,
      },
    ],
    defaultImageModel: { providerId: 'demo', modelId: 'muse-1' },
    defaultChatModel: { providerId: 'demo', modelId: 'muse-chat' },
    grid: true,
    snap: true,
    showMinimap: true,
    concurrency: 2,
    keepOriginal: true,
  });
}

export function isPromptNode(node: CanvasNode): node is Extract<CanvasNode, { kind: 'prompt' }> {
  return node.kind === 'prompt';
}

export function isChatNode(node: CanvasNode): node is ChatNode {
  return node.kind === 'chat';
}
