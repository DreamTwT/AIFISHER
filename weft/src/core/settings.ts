import type { Aspect, Settings } from './types';

const KEY = 'weft.settings.v1';

const DEFAULTS: Settings = {
  endpoint: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-image-1',
  demo: true,
  concurrency: 2,
};

let current: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function settings(): Settings {
  return current;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // 本地存储不可用时只保留在当前会话
  }
  listeners.forEach((listener) => listener());
}

export function hasLiveProvider(): boolean {
  return Boolean(current.endpoint.trim() && current.apiKey.trim() && !current.demo);
}

export function imageSizeFor(aspect: Aspect): string {
  switch (aspect) {
    case '1:1':
      return '1024x1024';
    case '4:5':
    case '3:4':
    case '9:16':
      return '1024x1536';
    case '16:9':
    case '3:2':
      return '1536x1024';
  }
}
