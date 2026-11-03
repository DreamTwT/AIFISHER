import { createNode, createProject, emptyDoc, starterProject } from './factory';
import type {
  Camera,
  Doc,
  Group,
  ID,
  NodeKind,
  Project,
  SceneNode,
} from './types';
import { canLink, wouldCycle } from './geometry';
import { deepClone, uid } from './util';

type Patch = Record<string, unknown>;

const HISTORY_LIMIT = 60;

export class Editor {
  project: Project;
  selection = new Set<ID>();
  threadSelection = new Set<ID>();
  tool: 'select' | 'hand' = 'select';
  dirty = false;

  private listeners = new Set<() => void>();
  private undoStack: Doc[] = [];
  private redoStack: Doc[] = [];
  private transaction: Doc | null = null;
  private nudgeAt = 0;
  private nudgeKey = '';

  constructor(project?: Project) {
    this.project = project ?? starterProject();
    this.ensureGroups();
  }

  get doc(): Doc {
    return this.project.doc;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  load(project: Project): void {
    this.project = project;
    this.ensureGroups();
    this.selection.clear();
    this.threadSelection.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.transaction = null;
    this.dirty = false;
    this.emit();
  }

  newProject(): void {
    const project = createProject();
    this.project = project;
    this.selection.clear();
    this.threadSelection.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = true;
    this.emit();
  }

  setProjectName(name: string): void {
    this.project.name = name.trim() || '未命名项目';
    this.project.updatedAt = Date.now();
    this.dirty = true;
    this.emit();
  }

  setCamera(camera: Camera, silent = false): void {
    this.project.camera = camera;
    if (!silent) this.emit();
  }

  setTool(tool: 'select' | 'hand'): void {
    this.tool = tool;
    this.emit();
  }

/**
 * 普通点击只选一个节点。要选中整组，传 group.nodeIds，
 * 或者点击编组顶部的标题带、在检查器里点“选中整组”。
 */
  select(ids: ID[], additive = false): void {
    if (!additive) this.selection.clear();
    ids.forEach((id) => this.selection.add(id));
    if (ids.length) this.threadSelection.clear();
    this.emit();
  }

  toggleSelect(id: ID): void {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.threadSelection.clear();
    this.emit();
  }

  groupFor(nodeId: ID): Group | undefined {
    return (this.doc.groups ?? []).find((group) => group.nodeIds.includes(nodeId));
  }

  selectionGroup(): Group | undefined {
    if (this.selection.size < 2) return undefined;
    return (this.doc.groups ?? []).find(
      (group) =>
        group.nodeIds.length === this.selection.size &&
        group.nodeIds.every((nodeId) => this.selection.has(nodeId)),
    );
  }

  groupSelection(name?: string): Group | undefined {
    if (this.selection.size < 2) return undefined;
    this.ensureGroups();
    const existing = this.selectionGroup();
    if (existing) return existing;
    const before = deepClone(this.doc);
    const members = new Set(this.selection);
    const kept: Group[] = [];
    for (const group of this.doc.groups ?? []) {
      const rest = group.nodeIds.filter((nodeId) => !members.has(nodeId));
      if (rest.length >= 2) kept.push({ ...group, nodeIds: rest });
    }
    const groups = this.doc.groups ?? [];
    let index = 1;
    while (groups.some((group) => group.name === `组 ${String(index).padStart(2, '0')}`)) index += 1;
    const group: Group = {
      id: uid('g'),
      name: name?.trim() || `组 ${String(index).padStart(2, '0')}`,
      nodeIds: [...this.selection],
    };
    this.doc.groups = [...kept, group];
    this.commit(before);
    return group;
  }

  ungroupSelection(): boolean {
    if (!this.selection.size) return false;
    const exact = this.selectionGroup();
    const groups = this.doc.groups ?? [];
    const before = deepClone(this.doc);
    if (exact) {
      this.doc.groups = groups.filter((group) => group.id !== exact.id);
    } else {
      this.doc.groups = groups
        .map((group) =>
          group.nodeIds.some((nodeId) => this.selection.has(nodeId))
            ? { ...group, nodeIds: group.nodeIds.filter((nodeId) => !this.selection.has(nodeId)) }
            : group,
        )
        .filter((group) => group.nodeIds.length >= 2);
    }
    this.commit(before);
    return true;
  }

  renameGroup(id: ID, name: string, record = true): void {
    const group = (this.doc.groups ?? []).find((item) => item.id === id);
    if (!group) return;
    const before = record ? deepClone(this.doc) : null;
    group.name = name.trim() || '未命名编组';
    this.project.updatedAt = Date.now();
    this.dirty = true;
    if (before) this.commit(before);
    else this.emit();
  }

  private ensureGroups(): void {
    if (!Array.isArray(this.project.doc.groups)) this.project.doc.groups = [];
  }

  private pruneGroups(): void {
    if (!Array.isArray(this.doc.groups)) {
      this.doc.groups = [];
      return;
    }
    const alive = new Set(this.doc.nodes.map((node) => node.id));
    const claimed = new Set<ID>();
    this.doc.groups = this.doc.groups
      .map((group) => {
        const nodeIds: ID[] = [];
        for (const id of group.nodeIds) {
          if (!alive.has(id) || claimed.has(id)) continue;
          claimed.add(id);
          nodeIds.push(id);
        }
        return { ...group, nodeIds };
      })
      .filter((group) => group.nodeIds.length >= 2);
  }

  selectThread(id: ID): void {
    this.threadSelection = new Set([id]);
    this.selection.clear();
    this.emit();
  }

  clearSelection(): void {
    this.selection.clear();
    this.threadSelection.clear();
    this.emit();
  }

  selectAll(): void {
    this.selection = new Set(this.doc.nodes.map((node) => node.id));
    this.threadSelection.clear();
    this.emit();
  }

  node(id: ID): SceneNode | undefined {
    return this.doc.nodes.find((node) => node.id === id);
  }

  selectedNodes(): SceneNode[] {
    return this.doc.nodes.filter((node) => this.selection.has(node.id));
  }

  addNode(kind: NodeKind, x: number, y: number, patch: Patch = {}, record = true): SceneNode {
    const before = deepClone(this.doc);
    const node = createNode(kind, x, y, patch as Partial<SceneNode>);
    if (kind === 'prompt') node.title = String(patch.title ?? '文本');
    this.doc.nodes.push(node);
    this.selection = new Set([node.id]);
    if (record) this.commit(before);
    else {
      this.dirty = true;
      this.emit();
    }
    return node;
  }

  updateNode(id: ID, patch: Patch, record = false): void {
    const node = this.node(id);
    if (!node) return;
    const before = record ? deepClone(this.doc) : null;
    Object.assign(node, patch);
    this.project.updatedAt = Date.now();
    this.dirty = true;
    if (before) this.commit(before);
    else this.emit();
  }

  moveSelection(dx: number, dy: number): void {
    for (const node of this.doc.nodes) {
      if (this.selection.has(node.id)) {
        node.x += dx;
        node.y += dy;
      }
    }
    this.dirty = true;
  }

  resizeNode(id: ID, w: number, h: number): void {
    const node = this.node(id);
    if (!node) return;
    node.w = Math.max(240, Math.min(720, w));
    node.h = Math.max(150, Math.min(760, h));
    this.dirty = true;
  }

  begin(): void {
    if (!this.transaction) this.transaction = deepClone(this.doc);
  }

  end(changed = true): void {
    if (!this.transaction) return;
    if (changed) this.commit(this.transaction);
    this.transaction = null;
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(deepClone(this.doc));
    this.project.doc = previous;
    this.pruneSelection();
    this.dirty = true;
    this.nudgeAt = 0;
    this.nudgeKey = '';
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(deepClone(this.doc));
    this.project.doc = next;
    this.pruneSelection();
    this.dirty = true;
    this.nudgeAt = 0;
    this.nudgeKey = '';
    this.emit();
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  connect(from: ID, to: ID, record = true): boolean {
    const source = this.node(from);
    const target = this.node(to);
    if (!source || !target) return false;
    if (!canLink(source, target)) return false;
    if (this.doc.threads.some((thread) => thread.from === from && thread.to === to)) return false;
    if (wouldCycle(this.doc, from, to)) return false;
    const before = deepClone(this.doc);
    this.doc.threads.push({ id: uid('t'), from, to });
    if (record) this.commit(before);
    else {
      this.dirty = true;
      this.emit();
    }
    return true;
  }

  disconnect(threadId: ID): void {
    const before = deepClone(this.doc);
    this.doc.threads = this.doc.threads.filter((thread) => thread.id !== threadId);
    this.threadSelection.delete(threadId);
    this.commit(before);
  }

  /** 删除素材后清空节点里对它的引用；素材文件本身由 assets 层移除。 */
  removeAssetReferences(assetId: ID): boolean {
    const before = deepClone(this.doc);
    let changed = false;
    for (const node of this.doc.nodes) {
      if (node.kind === 'render' && node.assetIds.includes(assetId)) {
        node.assetIds = node.assetIds.filter((id) => id !== assetId);
        if (!node.assetIds.length) {
          node.status = 'idle';
          node.progress = 0;
        }
        changed = true;
      } else if (node.kind === 'image' && node.assetId === assetId) {
        node.assetId = undefined;
        changed = true;
      }
    }
    if (changed) this.commit(before);
    return changed;
  }

  /** 方向键微调：连续按键合并成一次撤销。 */
  nudgeSelection(dx: number, dy: number): boolean {
    if (!this.selection.size || (!dx && !dy)) return false;
    const now = Date.now();
    const key = [...this.selection].sort().join('|');
    const merge = key === this.nudgeKey && now - this.nudgeAt < 700;
    const before = deepClone(this.doc);
    for (const node of this.selectedNodes()) {
      node.x += dx;
      node.y += dy;
    }
    this.project.updatedAt = now;
    this.dirty = true;
    if (merge) {
      this.redoStack = [];
      this.emit();
    } else {
      this.commit(before);
    }
    this.nudgeAt = now;
    this.nudgeKey = key;
    return true;
  }

  /** 从某个节点上摘掉生成结果；素材本身仍留在素材库。 */
  removeNodeOutput(nodeId: ID, assetId?: ID): boolean {
    const node = this.node(nodeId);
    if (!node) return false;
    if (node.kind === 'render' && node.status === 'running') return false;
    const before = deepClone(this.doc);
    if (node.kind === 'render') {
      node.assetIds = assetId ? node.assetIds.filter((id) => id !== assetId) : [];
      if (!node.assetIds.length) {
        node.status = 'idle';
        node.progress = 0;
      }
    } else if (node.kind === 'image' && (!assetId || node.assetId === assetId)) {
      node.assetId = undefined;
      node.caption = '';
    } else {
      return false;
    }
    this.commit(before);
    return true;
  }

  deleteSelection(): void {
    if (!this.selection.size && !this.threadSelection.size) return;
    const before = deepClone(this.doc);
    const ids = this.selection;
    this.doc.nodes = this.doc.nodes.filter((node) => !ids.has(node.id));
    this.doc.threads = this.doc.threads.filter(
      (thread) =>
        !this.threadSelection.has(thread.id) && !ids.has(thread.from) && !ids.has(thread.to),
    );
    this.pruneGroups();
    this.selection.clear();
    this.threadSelection.clear();
    this.commit(before);
  }

  duplicateSelection(): void {
    if (!this.selection.size) return;
    this.ensureGroups();
    const before = deepClone(this.doc);
    const map = new Map<ID, ID>();
    const clones: SceneNode[] = [];
    for (const node of this.doc.nodes) {
      if (!this.selection.has(node.id)) continue;
      const copy = deepClone(node);
      copy.id = uid(node.kind);
      copy.x += 36;
      copy.y += 36;
      copy.title = `${node.title} 副本`;
      if (copy.kind === 'render') {
        copy.assetIds = [...copy.assetIds];
        copy.status = 'idle';
        copy.progress = 0;
        copy.error = undefined;
      }
      map.set(node.id, copy.id);
      clones.push(copy);
      this.doc.nodes.push(copy);
    }
    for (const thread of this.doc.threads) {
      if (map.has(thread.from) && map.has(thread.to)) {
        this.doc.threads.push({
          id: uid('t'),
          from: map.get(thread.from)!,
          to: map.get(thread.to)!,
        });
      }
    }
    for (const group of [...(this.doc.groups ?? [])]) {
      if (!group.nodeIds.every((id) => map.has(id))) continue;
      this.doc.groups.push({
        id: uid('g'),
        name: `${group.name} 副本`,
        nodeIds: group.nodeIds.map((id) => map.get(id)!),
      });
    }
    this.selection = new Set(clones.map((node) => node.id));
    this.threadSelection.clear();
    this.commit(before);
  }

  bringToFront(): void {
    if (!this.selection.size) return;
    const selected = this.doc.nodes.filter((node) => this.selection.has(node.id));
    const rest = this.doc.nodes.filter((node) => !this.selection.has(node.id));
    this.doc.nodes = [...rest, ...selected];
    this.emit();
  }

  replaceDoc(doc: Doc): void {
    const before = deepClone(this.doc);
    if (!Array.isArray(doc.groups)) doc.groups = [];
    this.project.doc = doc;
    this.pruneSelection();
    this.commit(before);
  }

  setDirty(value: boolean): void {
    this.dirty = value;
    this.emit();
  }

  markSaved(): void {
    this.dirty = false;
    this.project.updatedAt = Date.now();
    this.emit();
  }

  outgoing(nodeId: ID): ID[] {
    return this.doc.threads.filter((thread) => thread.from === nodeId).map((thread) => thread.to);
  }

  incoming(nodeId: ID): ID[] {
    return this.doc.threads.filter((thread) => thread.to === nodeId).map((thread) => thread.from);
  }

  upstream(nodeId: ID): SceneNode[] {
    const result: SceneNode[] = [];
    const stack = this.incoming(nodeId);
    const seen = new Set<ID>();
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = this.node(id);
      if (node) {
        result.push(node);
        stack.push(...this.incoming(id));
      }
    }
    return result;
  }

  inputAssets(nodeId: ID): ID[] {
    const ids: ID[] = [];
    for (const node of this.upstream(nodeId)) {
      if (node.kind === 'image' && node.assetId) ids.push(node.assetId);
      if (node.kind === 'render') ids.push(...node.assetIds);
    }
    return ids;
  }

  effectivePrompt(nodeId: ID): string {
    const node = this.node(nodeId);
    if (!node || node.kind !== 'render') return '';
    const upstream = this.upstream(nodeId)
      .filter((item): item is Extract<SceneNode, { kind: 'prompt' }> => item.kind === 'prompt' && item.text.trim().length > 0)
      .reverse()
      .map((item) => item.text.trim());
    return [...upstream, node.prompt.trim()].filter(Boolean).join('\n\n');
  }

  private commit(before: Doc): void {
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.project.updatedAt = Date.now();
    this.dirty = true;
    this.transaction = null;
    this.nudgeAt = 0;
    this.nudgeKey = '';
    this.emit();
  }

  private pruneSelection(): void {
    this.pruneGroups();
    const nodeIds = new Set(this.doc.nodes.map((node) => node.id));
    const threadIds = new Set(this.doc.threads.map((thread) => thread.id));
    this.selection = new Set([...this.selection].filter((id) => nodeIds.has(id)));
    this.threadSelection = new Set([...this.threadSelection].filter((id) => threadIds.has(id)));
  }
}

export function blankDoc(): Doc {
  return emptyDoc();
}
