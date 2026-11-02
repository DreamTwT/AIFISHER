import { uid } from '../lib/util';
import type { ID, TaskInfo, Toast } from '../model/types';

export interface LightboxState {
  assetId?: string;
  url?: string;
  title?: string;
  prompt?: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  nodeId?: string;
  edgeId?: string;
}

export interface UIState {
  ready: boolean;
  bootError?: string;
  paletteOpen: boolean;
  settingsOpen: boolean;
  settingsTab: string;
  assetsOpen: boolean;
  dashboardOpen: boolean;
  taskPanelOpen: boolean;
  inspectOpen: boolean;
  shortcutsOpen: boolean;
  helpOpen: boolean;
  lightbox: LightboxState | null;
  contextMenu: ContextMenuState | null;
  nodeMenu: { x: number; y: number; worldX: number; worldY: number; connectFrom?: string } | null;
  toasts: Toast[];
  booting: boolean;
}

let state: UIState = {
  ready: false,
  paletteOpen: false,
  settingsOpen: false,
  settingsTab: 'providers',
  assetsOpen: false,
  dashboardOpen: false,
  taskPanelOpen: false,
  inspectOpen: true,
  shortcutsOpen: false,
  helpOpen: false,
  lightbox: null,
  contextMenu: null,
  nodeMenu: null,
  toasts: [],
  booting: true,
};

const listeners = new Set<() => void>();

export function getUI(): UIState {
  return state;
}

export function subscribeUI(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setUI(patch: Partial<UIState> | ((prev: UIState) => UIState)): void {
  state = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function toast(
  message: string,
  kind: Toast['kind'] = 'info',
  options: { actionLabel?: string; action?: () => void; duration?: number } = {},
): string {
  const id = uid('t');
  const item: Toast = { id, kind, message, actionLabel: options.actionLabel, action: options.action };
  setUI((prev) => ({ ...prev, toasts: [...prev.toasts.slice(-3), item] }));
  const duration = options.duration ?? (kind === 'error' ? 6500 : 3800);
  setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id: string): void {
  setUI((prev) => ({ ...prev, toasts: prev.toasts.filter((t) => t.id !== id) }));
}

/** 任务中心使用全局任务表，保持与文档解耦 */
let tasks: Record<ID, TaskInfo> = {};
const taskListeners = new Set<() => void>();

export function getTasks(): Record<ID, TaskInfo> {
  return tasks;
}

export function subscribeTasks(listener: () => void): () => void {
  taskListeners.add(listener);
  return () => taskListeners.delete(listener);
}

export function upsertTask(task: TaskInfo): void {
  tasks = { ...tasks, [task.id]: task };
  taskListeners.forEach((l) => l());
}

export function updateTask(id: ID, patch: Partial<TaskInfo>): void {
  const current = tasks[id];
  if (!current) return;
  tasks = { ...tasks, [id]: { ...current, ...patch } };
  taskListeners.forEach((l) => l());
}

export function removeTask(id: ID): void {
  const next = { ...tasks };
  delete next[id];
  tasks = next;
  taskListeners.forEach((l) => l());
}

export function clearFinishedTasks(): void {
  const next: Record<ID, TaskInfo> = {};
  for (const [id, task] of Object.entries(tasks)) {
    if (task.status === 'running' || task.status === 'queued') next[id] = task;
  }
  tasks = next;
  taskListeners.forEach((l) => l());
}

export function activeTaskCount(): number {
  return Object.values(tasks).filter((t) => t.status === 'running' || t.status === 'queued').length;
}
