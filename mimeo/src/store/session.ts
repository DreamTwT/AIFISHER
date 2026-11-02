import { uid } from '../lib/util';
import { boundsOf, fitCamera } from '../model/geometry';
import { createEdge, createNode, createProject, emptyDoc } from '../model/factory';
import { cloneSubgraph, nodeMap } from '../model/graph';
import { normalizeDoc, normalizeProject } from '../model/schema';
import { templateById, TEMPLATES, buildStarterProject } from '../model/templates';
import type { CanvasDoc, CanvasNode, Edge, ID, Project } from '../model/types';
import { getAssetBlob, getAssetMeta, hydrateAssets, importAsset } from './assets';
import { createEditorStore, getEditor, hasEditor } from './editor';
import { deleteProject, getProject, listProjects, saveProject } from './db';

const LAST_KEY = 'mimeo.last-project';
let bootPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
let current: Project | null = null;

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentProject(): Project | null {
  return current;
}

function adopt(project: Project, persist = true) {
  current = project;
  try {
    localStorage.setItem(LAST_KEY, project.id);
  } catch {
    // 隐私模式下忽略
  }
  createEditorStore(project);
  if (persist) void saveProject(project);
  emit();
}

export function bootstrapSession(): Promise<void> {
  // React StrictMode 会重复调用 effect，用同一个 Promise 防止生成多份示例工程
  if (!bootPromise) bootPromise = runBootstrap();
  return bootPromise;
}

async function runBootstrap(): Promise<void> {
  await hydrateAssets();
  const lastId = (() => {
    try {
      return localStorage.getItem(LAST_KEY);
    } catch {
      return null;
    }
  })();
  let project: Project | null = null;
  if (lastId) project = await getProject(lastId);
  if (!project) {
    const projects = await listProjects();
    if (projects.length) project = await getProject(projects[0].id);
  }
  if (!project) {
    project = await buildStarterProject();
    await saveProject(project);
  }
  adopt(project, false);
}

export async function switchProject(id: ID): Promise<boolean> {
  if (hasEditor()) await getEditor().saveNow();
  const project = await getProject(id);
  if (!project) return false;
  adopt(project, false);
  return true;
}

export async function openProject(project: Project): Promise<void> {
  if (hasEditor()) await getEditor().saveNow();
  await saveProject(project);
  adopt(project, false);
}

export function templateProject(templateId: string, name?: string): Project {
  const template = templateById(templateId);
  const now = Date.now();
  let nodes: CanvasNode[] = [];
  let edges: Edge[] = [];
  if (template) {
    const built = template.build();
    nodes = built.nodes;
    edges = built.edges;
    for (const node of nodes) {
      node.createdAt = now;
      node.updatedAt = now;
    }
  } else {
    const prompt = createNode('prompt', { x: 0, y: 0, w: 340, h: 240, title: '提示词' });
    nodes = [prompt];
  }
  let camera: import('../model/types').Camera = { x: 0, y: 0, zoom: 0.9, auto: true };
  const bounds = boundsOf(nodes);
  if (bounds) camera = { ...fitCamera(bounds, { w: 1400, h: 860 }, 120, 0.9), auto: true };
  return {
    id: uid('p'),
    name: name ?? template?.name ?? '未命名画布',
    createdAt: now,
    updatedAt: now,
    nodeCount: nodes.length,
    doc: { ...emptyDoc(), nodes, edges },
    camera,
  };
}

export async function newProjectFromTemplate(templateId: string, name?: string): Promise<void> {
  if (hasEditor()) await getEditor().saveNow();
  const project = templateProject(templateId, name);
  adopt(project);
}

export async function createBlankProject(name = '未命名画布'): Promise<void> {
  if (hasEditor()) await getEditor().saveNow();
  const project = createProject(name);
  adopt(project);
}

export async function deleteProjectById(id: ID): Promise<void> {
  await deleteProject(id);
  if (current?.id === id) {
    const projects = await listProjects();
    if (projects.length) {
      const next = await getProject(projects[0].id);
      if (next) adopt(next, false);
    } else {
      const project = await buildStarterProject();
      await saveProject(project);
      adopt(project, false);
    }
  }
  emit();
}

export async function duplicateProjectById(id: ID): Promise<void> {
  const source = await getProject(id);
  if (!source) return;
  const doc = normalizeDoc(source.doc);
  const idMap = new Map<ID, ID>();
  const nodes = doc.nodes.map((node) => {
    const nextId = uid(node.kind);
    idMap.set(node.id, nextId);
    return { ...node, id: nextId, createdAt: Date.now(), updatedAt: Date.now() } as CanvasNode;
  });
  const remapped = nodes.map((node) =>
    node.kind === 'group'
      ? { ...node, memberIds: node.memberIds.map((member) => idMap.get(member) ?? member) }
      : node,
  );
  const edges = doc.edges
    .filter((e) => idMap.has(e.from) && idMap.has(e.to))
    .map((e) => ({ ...e, id: uid('e'), from: idMap.get(e.from)!, to: idMap.get(e.to)! }));
  await saveProject({
    ...source,
    id: uid('p'),
    name: `${source.name} 副本`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    doc: { ...doc, nodes: remapped, edges },
    camera: source.camera,
    thumbnail: source.thumbnail,
  });
  emit();
}

export async function importProjectFile(file: File): Promise<void> {
  const text = await file.text();
  const { deserializeProject } = await import('../model/schema');
  const result = await deserializeProject(text);
  for (const asset of result.assets) {
    await importAsset(asset.meta, asset.blob);
  }
  await openProject(result.project);
}

export async function exportProjectPayload(embedAssets: boolean): Promise<string> {
  const { serializeProject } = await import('../model/schema');
  const editor = getEditor();
  const project = editor.getSnapshot().project;
  const used = new Set<ID>();
  for (const node of project.doc.nodes) {
    if (node.kind === 'image' || node.kind === 'video' || node.kind === 'audio') {
      if (node.assetId) used.add(node.assetId);
    }
    if (node.kind === 'generate') for (const id of node.outputs) used.add(id);
  }
  const assets = [];
  if (embedAssets) {
    for (const id of used) {
      const meta = getAssetMeta(id);
      const blob = getAssetBlob(id);
      if (meta && blob) assets.push({ ...meta, blob });
    }
  }
  return serializeProject(project, assets, { embedAssets });
}

export { TEMPLATES, cloneSubgraph, nodeMap };
