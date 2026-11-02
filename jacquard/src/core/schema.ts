import type { AssetMeta, Doc, Group, NodeKind, Project, SceneNode, Thread } from './types';
import { ASPECTS } from './types';

export interface ProjectAsset {
  meta: AssetMeta;
  data: string;
}

export interface ProjectFile {
  format: 'jacquard-project' | 'weft-project';
  version: 1;
  exportedAt: number;
  project: Project;
  assets: ProjectAsset[];
}

const KINDS: NodeKind[] = ['prompt', 'render', 'image', 'weave'];

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function id(value: unknown, prefix: string, seen: Set<string>): string {
  const candidate = text(value);
  if (candidate && !seen.has(candidate)) {
    seen.add(candidate);
    return candidate;
  }
  const generated = `${prefix}-${seen.size + 1}-${Math.random().toString(36).slice(2, 7)}`;
  seen.add(generated);
  return generated;
}

export function sanitizeDoc(input: unknown): Doc {
  const raw = (input ?? {}) as Record<string, unknown>;
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const seen = new Set<string>();
  const nodes: SceneNode[] = [];

  for (const item of rawNodes) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const kind = KINDS.includes(record.kind as NodeKind) ? (record.kind as NodeKind) : null;
    if (!kind) continue;
    const base = {
      id: id(record.id, kind, seen),
      x: number(record.x, 0),
      y: number(record.y, 0),
      w: Math.max(240, Math.min(760, number(record.w, 320))),
      h: Math.max(140, Math.min(820, number(record.h, 300))),
      title: text(record.title, kind === 'prompt' ? '经线' : kind === 'render' ? '纬线' : kind === 'image' ? '布样' : '织片'),
    };
    if (kind === 'prompt') {
      const role = record.role === 'style' || record.role === 'note' ? record.role : 'direction';
      nodes.push({ ...base, kind, text: text(record.text), role });
    } else if (kind === 'render') {
      const aspect = ASPECTS.some((itemAspect) => itemAspect.id === record.aspect)
        ? (record.aspect as SceneNode extends { aspect: infer A } ? A : never)
        : ('4:5' as const);
      const status =
        record.status === 'running' || record.status === 'done' || record.status === 'error'
          ? record.status
          : 'idle';
      nodes.push({
        ...base,
        kind,
        prompt: text(record.prompt),
        aspect: aspect as never,
        count: Math.max(1, Math.min(4, Math.round(number(record.count, 2)))),
        seed: typeof record.seed === 'number' ? record.seed : null,
        assetIds: Array.isArray(record.assetIds)
          ? record.assetIds.filter((value): value is string => typeof value === 'string')
          : [],
        status: status === 'running' ? 'idle' : status,
        progress: Math.max(0, Math.min(100, number(record.progress, status === 'done' ? 100 : 0))),
        error: typeof record.error === 'string' ? record.error : undefined,
      });
    } else if (kind === 'image') {
      nodes.push({
        ...base,
        kind,
        assetId: typeof record.assetId === 'string' ? record.assetId : undefined,
        caption: text(record.caption),
      });
    } else {
      nodes.push({
        ...base,
        kind,
        columns: Math.max(1, Math.min(4, Math.round(number(record.columns, 2)))),
        gap: Math.max(0, Math.min(24, number(record.gap, 8))),
        caption: text(record.caption),
      });
    }
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawThreads = Array.isArray(raw.threads) ? raw.threads : [];
  const threadSeen = new Set<string>();
  const threads: Thread[] = [];
  for (const item of rawThreads) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const from = text(record.from);
    const to = text(record.to);
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) continue;
    if (threads.some((thread) => thread.from === from && thread.to === to)) continue;
    threads.push({ id: id(record.id, 'thread', threadSeen), from, to });
  }

  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  const groupSeen = new Set<string>();
  const claimed = new Set<string>();
  const groups: Group[] = [];
  for (const item of rawGroups) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const members: string[] = [];
    for (const value of Array.isArray(record.nodeIds) ? record.nodeIds : []) {
      if (typeof value !== 'string' || !nodeIds.has(value) || claimed.has(value)) continue;
      if (members.includes(value)) continue;
      members.push(value);
    }
    if (members.length < 2) continue;
    members.forEach((member) => claimed.add(member));
    groups.push({
      id: id(record.id, 'group', groupSeen),
      name: text(record.name, `组 ${groups.length + 1}`),
      nodeIds: members,
    });
  }

  return { version: 1, nodes, threads, groups };
}

export function sanitizeProject(input: unknown): Project {
  const raw = (input ?? {}) as Record<string, unknown>;
  const now = Date.now();
  const cameraRaw = (raw.camera ?? {}) as Record<string, unknown>;
  return {
    id: text(raw.id, `p-${now}`),
    name: text(raw.name, '导入的织机'),
    doc: sanitizeDoc(raw.doc),
    camera: {
      x: number(cameraRaw.x, 0),
      y: number(cameraRaw.y, 0),
      z: Math.max(0.12, Math.min(3, number(cameraRaw.z, 1))),
    },
    createdAt: number(raw.createdAt, now),
    updatedAt: number(raw.updatedAt, now),
    thumb: typeof raw.thumb === 'string' ? raw.thumb : undefined,
  };
}

export function sanitizeProjectFile(input: unknown): ProjectFile {
  const raw = (input ?? {}) as Record<string, unknown>;
  if (raw.format !== 'jacquard-project' && raw.format !== 'weft-project') {
    throw new Error('不是 JACQUARD 工程文件');
  }
  const project = sanitizeProject(raw.project);
  const assets: ProjectAsset[] = [];
  if (Array.isArray(raw.assets)) {
    for (const item of raw.assets) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const metaRaw = (record.meta ?? {}) as Record<string, unknown>;
      if (typeof record.data !== 'string' || !metaRaw.id) continue;
      assets.push({
        meta: {
          id: text(metaRaw.id),
          name: text(metaRaw.name, '导入布样'),
          mime: text(metaRaw.mime, 'image/png'),
          width: number(metaRaw.width, 0),
          height: number(metaRaw.height, 0),
          size: number(metaRaw.size, 0),
          createdAt: number(metaRaw.createdAt, Date.now()),
          source: metaRaw.source === 'upload' ? 'upload' : 'render',
          prompt: typeof metaRaw.prompt === 'string' ? metaRaw.prompt : undefined,
          seed: typeof metaRaw.seed === 'number' ? metaRaw.seed : undefined,
          model: typeof metaRaw.model === 'string' ? metaRaw.model : undefined,
        },
        data: record.data,
      });
    }
  }
  return { format: 'jacquard-project', version: 1, exportedAt: number(raw.exportedAt, Date.now()), project, assets };
}

export function collectAssetIds(doc: Doc): string[] {
  const ids = new Set<string>();
  for (const node of doc.nodes) {
    if (node.kind === 'image' && node.assetId) ids.add(node.assetId);
    if (node.kind === 'render') node.assetIds.forEach((assetId) => ids.add(assetId));
  }
  return [...ids];
}

export function usedAssets(doc: Doc): string[] {
  return collectAssetIds(doc);
}

/** 兼容可能的旧字段 */
export function normalizeImported(raw: Record<string, unknown>): ProjectFile {
  if (raw.format === 'jacquard-project' || raw.format === 'weft-project') return sanitizeProjectFile(raw);
  const project = sanitizeProject(raw.project ?? raw);
  return { format: 'jacquard-project', version: 1, exportedAt: Date.now(), project, assets: [] };
}
