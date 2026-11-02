export interface CanvasEvents {
  'canvas:fit': { target?: 'all' | 'selection' };
  'canvas:zoom': { step?: number; value?: number };
  'canvas:center': { x: number; y: number; zoom?: number };
  'canvas:export-png': { scope?: 'all' | 'view' };
  'settings:open': { tab?: string };
  'asset:open': { assetId?: string; url?: string; title?: string; prompt?: string };
  'project:open-dashboard': Record<string, never>;
  'palette:open': Record<string, never>;
  'project:import': Record<string, never>;
}

type Handler<K extends keyof CanvasEvents> = (payload: CanvasEvents[K]) => void;

export function emit<K extends keyof CanvasEvents>(event: K, payload: CanvasEvents[K] = {} as CanvasEvents[K]) {
  window.dispatchEvent(new CustomEvent(event, { detail: payload }));
}

export function on<K extends keyof CanvasEvents>(event: K, handler: Handler<K>): () => void {
  const wrapped = (nativeEvent: Event) => handler((nativeEvent as CustomEvent<CanvasEvents[K]>).detail);
  window.addEventListener(event, wrapped);
  return () => window.removeEventListener(event, wrapped);
}

// 兼容旧式自定义事件命名（原生成模块里使用的 muse:*）
export function legacyOn(name: string, handler: (detail: unknown) => void): () => void {
  const wrapped = (event: Event) => handler((event as CustomEvent).detail);
  window.addEventListener(name, wrapped);
  return () => window.removeEventListener(name, wrapped);
}

