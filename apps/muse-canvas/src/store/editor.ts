import { uid } from '../lib/util';
import { boundsOf, snapToGrid } from '../model/geometry';
import type { Rect } from '../model/types';
import {
  childrenOfGroup,
  cloneSubgraph,
  connect,
  duplicateNodes,
  makeGroup,
  nodeMap,
  removeEdges,
  removeNodes,
  syncGroupBounds,
  ungroup,
  wouldCreateCycle,
} from '../model/graph';
import { createNode } from '../model/factory';
import type { CreateNodeOptions } from '../model/factory';
import { normalizeDoc } from '../model/schema';
import type {
  Camera,
  CanvasDoc,
  CanvasNode,
  ChatNode,
  Edge,
  GenerateNode,
  ID,
  NodeKind,
  Project,
} from '../model/types';
import { saveProject } from './db';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface HistoryEntry {
  doc: CanvasDoc;
  label: string;
}

export interface EditorState {
  project: Project;
  selection: ID[];
  edgeSelection: ID[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  saveState: SaveState;
  lastSavedAt?: number;
  gestureLabel?: string;
}

const HISTORY_LIMIT = 120;

/** 撤销 / 重做后，运行中的任务引用已经失效，避免节点永远转圈 */
function resetRunning(doc: CanvasDoc): CanvasDoc {
  let changed = false;
  const nodes = doc.nodes.map((n) => {
    if ((n.kind === 'generate' || n.kind === 'chat') && (n.status === 'running' || n.status === 'queued')) {
      changed = true;
      return { ...n, status: 'idle' as const, taskId: undefined, progress: 0 };
    }
    return n;
  });
  return changed ? { ...doc, nodes } : doc;
}

export interface ClipboardPayload {
  nodes: CanvasNode[];
  edges: Edge[];
}

class EditorStore {
  private state: EditorState;
  private listeners = new Set<() => void>();
  private gesture: { snapshot: CanvasDoc; label: string } | null = null;
  private edit: { nodeId: ID; snapshot: CanvasDoc; timer: ReturnType<typeof setTimeout> } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private saving = false;
  private saveAgain = false;

  constructor(project: Project) {
    this.state = {
      project,
      selection: [],
      edgeSelection: [],
      past: [],
      future: [],
      saveState: 'saved',
    };
  }

  getSnapshot = (): EditorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private set(patch: Partial<EditorState> | ((prev: EditorState) => EditorState)) {
    this.state = typeof patch === 'function' ? patch(this.state) : { ...this.state, ...patch };
    this.emit();
  }

  getDoc(): CanvasDoc {
    return this.state.project.doc;
  }

  getNode(id: ID | undefined): CanvasNode | undefined {
    if (!id) return undefined;
    return this.state.project.doc.nodes.find((n) => n.id === id);
  }

  getSelectedNodes(): CanvasNode[] {
    const map = nodeMap(this.state.project.doc);
    return this.state.selection.map((id) => map.get(id)).filter((n): n is CanvasNode => Boolean(n));
  }

  getSelectionBounds(): Rect | null {
    return boundsOf(this.getSelectedNodes());
  }

  nextZ(): number {
    return Math.max(0, ...this.state.project.doc.nodes.map((n) => n.z)) + 1;
  }

  // ---------------------------------------------------------------- 工程

  loadProject(project: Project) {
    this.flushEdit();
    this.gesture = null;
    this.state = {
      project,
      selection: [],
      edgeSelection: [],
      past: [],
      future: [],
      saveState: 'saved',
      lastSavedAt: project.updatedAt,
    };
    this.emit();
  }

  setProjectName(name: string) {
    const trimmed = name.trim() || '未命名画布';
    this.set((prev) => ({
      ...prev,
      project: { ...prev.project, name: trimmed, updatedAt: Date.now() },
      saveState: 'dirty',
    }));
    this.scheduleSave();
  }

  setThumbnail(dataUrl: string) {
    this.set((prev) => ({ ...prev, project: { ...prev.project, thumbnail: dataUrl } }));
    this.scheduleSave();
  }

  setCamera(camera: Camera) {
    this.set((prev) => ({ ...prev, project: { ...prev.project, camera } }));
    this.scheduleSave();
  }

  // ---------------------------------------------------------------- 文档基元

  private snapshotDoc(): CanvasDoc {
    return this.state.project.doc;
  }

  private pushHistory(snapshot: CanvasDoc, label: string) {
    const past = [...this.state.past, { doc: snapshot, label }].slice(-HISTORY_LIMIT);
    this.state = { ...this.state, past, future: [] };
  }

  private applyDoc(
    doc: CanvasDoc,
    options: { history?: boolean; label?: string; touch?: boolean } = {},
  ) {
    const { history = true, label = '编辑画布', touch = true } = options;
    if (doc === this.state.project.doc) return;
    const prev = this.state.project.doc;
    if (history) this.pushHistory(prev, label);
    const now = Date.now();
    const project: Project = {
      ...this.state.project,
      doc,
      updatedAt: touch ? now : this.state.project.updatedAt,
    };
    this.state = {
      ...this.state,
      project,
      saveState: 'dirty',
    };
    this.sanitizeSelection();
    this.emit();
    this.scheduleSave();
  }

  private sanitizeSelection() {
    const nodeIds = new Set(this.state.project.doc.nodes.map((n) => n.id));
    const edgeIds = new Set(this.state.project.doc.edges.map((e) => e.id));
    const selection = this.state.selection.filter((id) => nodeIds.has(id));
    const edgeSelection = this.state.edgeSelection.filter((id) => edgeIds.has(id));
    if (selection.length !== this.state.selection.length || edgeSelection.length !== this.state.edgeSelection.length) {
      this.state = { ...this.state, selection, edgeSelection };
    }
  }

  updateDoc(updater: (doc: CanvasDoc) => CanvasDoc, options: { history?: boolean; label?: string } = {}) {
    const next = updater(this.state.project.doc);
    if (next === this.state.project.doc) return;
    this.applyDoc(next, { history: options.history ?? true, label: options.label });
  }

  replaceDoc(doc: CanvasDoc, label = '替换文档') {
    this.applyDoc(normalizeDoc(doc), { history: true, label });
  }

  // ---------------------------------------------------------------- 手势 / 连续编辑

  beginGesture(label: string) {
    if (this.gesture) return;
    this.flushEdit();
    this.gesture = { snapshot: this.state.project.doc, label };
    this.set((prev) => ({ ...prev, gestureLabel: label }));
  }

  updateGesture(updater: (doc: CanvasDoc) => CanvasDoc) {
    const next = updater(this.state.project.doc);
    if (next === this.state.project.doc) return;
    this.set((prev) => ({
      ...prev,
      project: { ...prev.project, doc: next, updatedAt: Date.now() },
      saveState: 'dirty',
    }));
    this.sanitizeSelection();
    this.emit();
    this.scheduleSave();
  }

  commitGesture() {
    if (!this.gesture) return;
    const { snapshot, label } = this.gesture;
    this.gesture = null;
    if (snapshot !== this.state.project.doc) this.pushHistory(snapshot, label);
    this.set((prev) => ({ ...prev, gestureLabel: undefined, saveState: 'dirty' }));
    this.scheduleSave();
  }

  cancelGesture() {
    if (!this.gesture) return;
    const { snapshot } = this.gesture;
    this.gesture = null;
    this.set((prev) => ({
      ...prev,
      project: { ...prev.project, doc: snapshot },
      gestureLabel: undefined,
    }));
    this.sanitizeSelection();
    this.emit();
  }

  /**
   * 文本类输入使用合并编辑：连续输入只产生一条撤销记录。
   * 700ms 无输入或失焦后自动封口。
   */
  editNode(id: ID, patch: Partial<CanvasNode>) {
    if (!this.edit || this.edit.nodeId !== id) {
      this.flushEdit();
      const snapshot = this.state.project.doc;
      const timer = setTimeout(() => this.flushEdit(), 700);
      this.edit = { nodeId: id, snapshot, timer };
    } else {
      clearTimeout(this.edit.timer);
      this.edit.timer = setTimeout(() => this.flushEdit(), 700);
    }
    const doc = this.patchNodeDoc(this.state.project.doc, id, patch);
    this.set((prev) => ({
      ...prev,
      project: { ...prev.project, doc, updatedAt: Date.now() },
      saveState: 'dirty',
    }));
    this.scheduleSave();
  }

  flushEdit() {
    if (!this.edit) return;
    const { snapshot, timer } = this.edit;
    clearTimeout(timer);
    this.edit = null;
    if (snapshot !== this.state.project.doc) {
      this.pushHistory(snapshot, '编辑内容');
      this.set((prev) => ({ ...prev }));
    }
    this.scheduleSave();
  }

  private patchNodeDoc(doc: CanvasDoc, id: ID, patch: Partial<CanvasNode>): CanvasDoc {
    let changed = false;
    const nodes = doc.nodes.map((n) => {
      if (n.id !== id) return n;
      changed = true;
      return { ...n, ...patch, updatedAt: Date.now() } as CanvasNode;
    });
    return changed ? { ...doc, nodes } : doc;
  }

  patchNode(id: ID, patch: Partial<CanvasNode>, options: { history?: boolean; label?: string; edit?: boolean } = {}) {
    if (options.edit) {
      this.editNode(id, patch);
      return;
    }
    const doc = this.patchNodeDoc(this.state.project.doc, id, patch);
    if (doc === this.state.project.doc) return;
    this.applyDoc(doc, { history: options.history ?? true, label: options.label ?? '更新节点' });
  }

  /** 静默更新：用于流式输出、进度、状态，不写撤销栈 */
  patchNodeSilent(id: ID, patch: Partial<CanvasNode>) {
    const doc = this.patchNodeDoc(this.state.project.doc, id, patch);
    if (doc === this.state.project.doc) return;
    this.set((prev) => ({
      ...prev,
      project: { ...prev.project, doc, updatedAt: Date.now() },
      saveState: 'dirty',
    }));
    this.scheduleSave();
  }

  patchNodeSilentIf(id: ID, updater: (node: CanvasNode) => Partial<CanvasNode> | null) {
    const node = this.getNode(id);
    if (!node) return;
    const patch = updater(node);
    if (patch) this.patchNodeSilent(id, patch);
  }

  // ---------------------------------------------------------------- 选择

  select(ids: ID | ID[], options: { additive?: boolean; toggle?: boolean } = {}) {
    const list = Array.isArray(ids) ? ids : [ids];
    let selection = list;
    if (options.additive || options.toggle) {
      const set = new Set(this.state.selection);
      for (const id of list) {
        if (options.toggle && set.has(id)) set.delete(id);
        else set.add(id);
      }
      selection = [...set];
    }
    this.set((prev) => ({ ...prev, selection, edgeSelection: [] }));
  }

  selectEdges(ids: ID | ID[], additive = false) {
    const list = Array.isArray(ids) ? ids : [ids];
    const edgeSelection = additive ? [...new Set([...this.state.edgeSelection, ...list])] : list;
    this.set((prev) => ({ ...prev, edgeSelection, selection: [] }));
  }

  clearSelection() {
    if (!this.state.selection.length && !this.state.edgeSelection.length) return;
    this.set((prev) => ({ ...prev, selection: [], edgeSelection: [] }));
  }

  selectAll() {
    this.set((prev) => ({
      ...prev,
      selection: prev.project.doc.nodes.filter((n) => !n.locked).map((n) => n.id),
      edgeSelection: [],
    }));
  }

  // ---------------------------------------------------------------- 节点

  addNode(kind: NodeKind, options: CreateNodeOptions & { select?: boolean } = {}): CanvasNode {
    const node = createNode(kind, {
      ...options,
      z: this.nextZ(),
    });
    const doc = { ...this.state.project.doc, nodes: [...this.state.project.doc.nodes, node] };
    this.applyDoc(doc, { label: `添加${node.title}` });
    if (options.select !== false) this.select(node.id);
    return node;
  }

  addMediaNode(kind: 'image' | 'video' | 'audio', assetId: string, options: Partial<CanvasNode> = {}) {
    const node = createNode(kind, { z: this.nextZ(), ...options });
    const sized = { ...node, assetId, ...options } as CanvasNode;
    const doc = { ...this.state.project.doc, nodes: [...this.state.project.doc.nodes, sized] };
    this.applyDoc(doc, { label: '插入素材' });
    this.select(sized.id);
    return sized;
  }

  insertNodes(nodes: CanvasNode[], edges: Edge[] = [], label = '插入节点') {
    if (!nodes.length) return;
    const ids = new Set(this.state.project.doc.nodes.map((n) => n.id));
    const safeNodes = nodes.filter((n) => !ids.has(n.id));
    if (!safeNodes.length) return;
    const nodeIds = new Set([...ids, ...safeNodes.map((n) => n.id)]);
    const safeEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
    const doc = {
      ...this.state.project.doc,
      nodes: [...this.state.project.doc.nodes, ...safeNodes],
      edges: [...this.state.project.doc.edges, ...safeEdges],
    };
    this.applyDoc(doc, { label });
    this.select(safeNodes.map((n) => n.id));
  }

  deleteSelection() {
    const ids = this.state.selection;
    const edgeIds = this.state.edgeSelection;
    if (!ids.length && !edgeIds.length) return;
    let doc = this.state.project.doc;
    if (ids.length) {
      // 删除分组只移除容器，子节点保持原位
      doc = removeNodes(doc, ids);
    }
    if (edgeIds.length) doc = removeEdges(doc, edgeIds);
    this.applyDoc(doc, { label: '删除' });
    this.clearSelection();
  }

  duplicateSelection(offset = { x: 44, y: 44 }) {
    let ids = this.state.selection;
    if (!ids.length) return;
    const doc = this.state.project.doc;
    const groupIds = doc.nodes.filter((n) => n.kind === 'group' && ids.includes(n.id)).map((n) => n.id);
    const expanded = new Set(ids);
    for (const groupId of groupIds) {
      for (const child of childrenOfGroup(doc, groupId)) expanded.add(child.id);
    }
    ids = [...expanded];
    const result = duplicateNodes(doc, ids, offset);
    if (!result.newIds.length) return;
    this.applyDoc(result.doc, { label: '复制节点' });
    this.select(result.newIds);
  }

  copySelection(): ClipboardPayload | null {
    const doc = this.state.project.doc;
    let ids = this.state.selection;
    if (!ids.length) return null;
    const groupIds = doc.nodes.filter((n) => n.kind === 'group' && ids.includes(n.id)).map((n) => n.id);
    const expanded = new Set(ids);
    for (const groupId of groupIds) for (const child of childrenOfGroup(doc, groupId)) expanded.add(child.id);
    const nodes = doc.nodes.filter((n) => expanded.has(n.id));
    const edges = doc.edges.filter((e) => expanded.has(e.from) && expanded.has(e.to));
    return { nodes, edges };
  }

  paste(payload: ClipboardPayload, offset = { x: 60, y: 60 }) {
    if (!payload.nodes.length) return;
    const { nodes, edges } = cloneSubgraph(payload.nodes, payload.edges, offset);
    this.insertNodes(nodes, edges, '粘贴节点');
  }

  addOutputs(
    nodeId: ID,
    assetIds: ID[],
    meta: { seed?: number | null; elapsedMs?: number } = {},
  ) {
    const node = this.getNode(nodeId);
    if (!node || node.kind !== 'generate') return;
    const patch: Partial<GenerateNode> = {
      outputs: [...assetIds, ...node.outputs].slice(0, 80),
      activeOutput: 0,
      status: 'done',
      progress: 1,
      error: undefined,
      elapsedMs: meta.elapsedMs,
      ...(typeof meta.seed === 'number' ? { seed: meta.seed } : {}),
    };
    this.patchNode(nodeId, patch, { label: '生成结果' });
  }

  setGenerateState(
    nodeId: ID,
    patch: Partial<Pick<GenerateNode, 'status' | 'progress' | 'error' | 'taskId' | 'elapsedMs'>>,
  ) {
    this.patchNodeSilent(nodeId, patch as Partial<CanvasNode>);
  }

  setChatState(
    nodeId: ID,
    patch: Partial<Pick<ChatNode, 'status' | 'error' | 'taskId' | 'output' | 'turns'>>,
  ) {
    this.patchNodeSilent(nodeId, patch as Partial<CanvasNode>);
  }

  // ---------------------------------------------------------------- 连线

  canConnect(from: ID, to: ID): { ok: boolean; reason?: string } {
    if (from === to) return { ok: false, reason: '不能连接到自身' };
    const doc = this.state.project.doc;
    const fromNode = this.getNode(from);
    const toNode = this.getNode(to);
    if (!fromNode || !toNode) return { ok: false, reason: '节点不存在' };
    if (fromNode.kind === 'group' || toNode.kind === 'group') return { ok: false, reason: '分组不参与连接' };
    if (fromNode.kind === 'audio' || fromNode.kind === 'video') {
      return { ok: false, reason: '音频 / 视频节点暂不支持作为生成输入' };
    }
    if (doc.edges.some((e) => e.from === from && e.to === to)) return { ok: false, reason: '已经连接' };
    if (wouldCreateCycle(doc, from, to)) return { ok: false, reason: '连接会形成环路' };
    return { ok: true };
  }

  connectNodes(from: ID, to: ID): boolean {
    const check = this.canConnect(from, to);
    if (!check.ok) return false;
    const doc = connect(this.state.project.doc, from, to);
    if (!doc) return false;
    this.applyDoc(doc, { label: '连接节点' });
    return true;
  }

  deleteEdge(id: ID) {
    const doc = removeEdges(this.state.project.doc, [id]);
    this.applyDoc(doc, { label: '删除连线' });
  }

  // ---------------------------------------------------------------- 分组 / 排列

  groupSelection() {
    const doc = this.state.project.doc;
    const ids = this.state.selection;
    if (!ids.length) return;
    const result = makeGroup(doc, ids.filter((id) => this.getNode(id)?.kind !== 'group'));
    if (!result) return;
    this.applyDoc(result.doc, { label: '创建分组' });
    this.select(result.groupId);
  }

  ungroupSelection() {
    const groups = this.getSelectedNodes().filter((n) => n.kind === 'group');
    if (!groups.length) return;
    let doc = this.state.project.doc;
    for (const group of groups) doc = ungroup(doc, group.id);
    const childIds = groups.flatMap((g) => (g.kind === 'group' ? g.memberIds : []));
    this.applyDoc(doc, { label: '取消分组' });
    this.select(childIds);
  }

  bringToFront() {
    const doc = this.state.project.doc;
    const selected = new Set(this.state.selection);
    if (!selected.size) return;
    let z = this.nextZ();
    const nodes = doc.nodes.map((n) => (selected.has(n.id) ? { ...n, z: z++ } : n));
    this.applyDoc({ ...doc, nodes }, { label: '置于顶层' });
  }

  sendToBack() {
    const doc = this.state.project.doc;
    const selected = new Set(this.state.selection);
    if (!selected.size) return;
    const minZ = Math.min(...doc.nodes.map((n) => n.z));
    let z = minZ - selected.size;
    const nodes = doc.nodes.map((n) => (selected.has(n.id) ? { ...n, z: z++ } : n));
    this.applyDoc({ ...doc, nodes }, { label: '置于底层' });
  }

  alignSelection(mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
    const nodes = this.getSelectedNodes();
    if (nodes.length < 2) return;
    const bounds = boundsOf(nodes);
    if (!bounds) return;
    const selected = new Set(nodes.map((n) => n.id));
    const doc = this.state.project.doc;
    const next = doc.nodes.map((n) => {
      if (!selected.has(n.id)) return n;
      switch (mode) {
        case 'left':
          return { ...n, x: bounds.x };
        case 'right':
          return { ...n, x: bounds.x + bounds.w - n.w };
        case 'hcenter':
          return { ...n, x: bounds.x + (bounds.w - n.w) / 2 };
        case 'top':
          return { ...n, y: bounds.y };
        case 'bottom':
          return { ...n, y: bounds.y + bounds.h - n.h };
        case 'vcenter':
          return { ...n, y: bounds.y + (bounds.h - n.h) / 2 };
      }
    });
    this.applyDoc({ ...doc, nodes: next }, { label: '对齐节点' });
  }

  distributeSelection(axis: 'x' | 'y') {
    const nodes = this.getSelectedNodes();
    if (nodes.length < 3) return;
    const sorted = [...nodes].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
    const start = axis === 'x' ? Math.min(...sorted.map((n) => n.x)) : Math.min(...sorted.map((n) => n.y));
    const end =
      axis === 'x'
        ? Math.max(...sorted.map((n) => n.x + n.w))
        : Math.max(...sorted.map((n) => n.y + n.h));
    const total = sorted.reduce((sum, n) => sum + (axis === 'x' ? n.w : n.h), 0);
    const gap = (end - start - total) / (sorted.length - 1);
    let cursor = start;
    const patches = new Map<ID, number>();
    for (const n of sorted) {
      patches.set(n.id, cursor);
      cursor += (axis === 'x' ? n.w : n.h) + gap;
    }
    const doc = this.state.project.doc;
    const next = doc.nodes.map((n) =>
      patches.has(n.id)
        ? axis === 'x'
          ? { ...n, x: patches.get(n.id)! }
          : { ...n, y: patches.get(n.id)! }
        : n,
    );
    this.applyDoc({ ...doc, nodes: next }, { label: '平均分布' });
  }

  moveNodesBy(ids: ID[], dx: number, dy: number, options: { snap?: boolean; grid?: boolean } = {}) {
    if (!ids.length || (!dx && !dy)) return;
    const selected = new Set(ids);
    // 分组内节点跟随分组移动由 UI 处理；这里只移动被选中的节点
    this.updateGesture((doc) => ({
      ...doc,
      nodes: doc.nodes.map((n) => {
        if (!selected.has(n.id)) return n;
        let x = n.x + dx;
        let y = n.y + dy;
        if (options.grid) {
          x = snapToGrid(x);
          y = snapToGrid(y);
        }
        return { ...n, x, y };
      }),
    }));
  }

  syncGroup(groupId: ID) {
    this.updateDoc((doc) => syncGroupBounds(doc, groupId), { label: '更新分组范围' });
  }

  // ---------------------------------------------------------------- 撤销重做

  undo(): boolean {
    this.flushEdit();
    if (this.gesture) this.commitGesture();
    const { past, future, project } = this.state;
    if (!past.length) return false;
    const entry = past[past.length - 1];
    this.state = {
      ...this.state,
      project: { ...project, doc: resetRunning(entry.doc), updatedAt: Date.now() },
      past: past.slice(0, -1),
      future: [...future, { doc: project.doc, label: entry.label }],
      saveState: 'dirty',
    };
    this.sanitizeSelection();
    this.emit();
    this.scheduleSave();
    return true;
  }

  redo(): boolean {
    this.flushEdit();
    const { past, future, project } = this.state;
    if (!future.length) return false;
    const entry = future[future.length - 1];
    this.state = {
      ...this.state,
      project: { ...project, doc: resetRunning(entry.doc), updatedAt: Date.now() },
      past: [...past, { doc: project.doc, label: entry.label }],
      future: future.slice(0, -1),
      saveState: 'dirty',
    };
    this.sanitizeSelection();
    this.emit();
    this.scheduleSave();
    return true;
  }

  // ---------------------------------------------------------------- 保存

  private scheduleSave() {
    if (this.disposed) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, 700);
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.disposed) return;
    this.flushEdit();
    if (this.saving) {
      this.saveAgain = true;
      return;
    }
    this.saving = true;
    const project = this.state.project;
    this.set({ saveState: 'saving' });
    try {
      await saveProject({ ...project, nodeCount: project.doc.nodes.length });
      this.set({ saveState: 'saved', lastSavedAt: Date.now() });
    } catch (error) {
      console.error('[muse] 保存失败', error);
      this.set({ saveState: 'error' });
    } finally {
      this.saving = false;
      if (this.saveAgain) {
        this.saveAgain = false;
        void this.saveNow();
      }
    }
  }

  dispose() {
    this.disposed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.edit) clearTimeout(this.edit.timer);
  }
}


let store: EditorStore | null = null;

export function createEditorStore(project: Project): EditorStore {
  store?.dispose();
  store = new EditorStore(project);
  return store;
}

export function getEditor(): EditorStore {
  if (!store) throw new Error('编辑器尚未初始化');
  return store;
}

export function hasEditor(): boolean {
  return store !== null;
}

export type { CanvasNode, Edge, Project, Rect };
