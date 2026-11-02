import { defaultSettings, normalizeSettings } from '../model/schema';
import type { ModelRef, ProviderConfig, ProviderKind, Settings } from '../model/types';

const KEY = 'mimeo.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings();
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

let settings: Settings = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('[mimeo] 设置保存失败', error);
  }
}

export function getSettings(): Settings {
  return settings;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateSettings(patch: Partial<Settings> | ((prev: Settings) => Settings)): void {
  settings =
    typeof patch === 'function'
      ? patch(settings)
      : normalizeSettings({ ...settings, ...patch });
  persist();
  listeners.forEach((l) => l());
}

export function replaceSettings(next: Settings): void {
  settings = normalizeSettings(next);
  persist();
  listeners.forEach((l) => l());
}

export function resetSettings(): void {
  settings = defaultSettings();
  persist();
  listeners.forEach((l) => l());
}

export function providerSupports(provider: ProviderConfig, kind: 'image' | 'chat'): boolean {
  if (!provider.enabled) return false;
  if (provider.kind === 'demo') return true;
  return kind === 'image' ? provider.kind === 'openai-image' : provider.kind === 'openai-chat';
}

export function providerKindLabel(kind: ProviderKind): string {
  switch (kind) {
    case 'demo':
      return '离线样例';
    case 'openai-chat':
      return '对话补全（OpenAI 兼容）';
    case 'openai-image':
      return '图像生成（OpenAI 兼容）';
  }
}

export const MODEL_SUGGESTIONS: Record<ProviderKind, string[]> = {
  demo: ['mimeo-1', 'mimeo-1-turbo', 'mimeo-chat'],
  'openai-chat': ['gpt-4o-mini', 'gpt-4o', 'deepseek-chat', 'qwen-plus', 'qwen-vl-max', 'llama3.2'],
  'openai-image': ['gpt-image-1', 'dall-e-3', 'flux-1.1-pro', 'seedream-4.0'],
};

export function modelsFor(provider: ProviderConfig): string[] {
  const list = provider.models.map((m) => m.trim()).filter(Boolean);
  return list.length ? list : MODEL_SUGGESTIONS[provider.kind];
}

export interface ModelOption {
  ref: ModelRef;
  label: string;
  provider: ProviderConfig;
}

export function imageModelOptions(current: Settings = settings): ModelOption[] {
  const options: ModelOption[] = [];
  for (const provider of current.providers) {
    if (!providerSupports(provider, 'image')) continue;
    for (const model of modelsFor(provider)) {
      options.push({
        ref: { providerId: provider.id, modelId: model },
        label: `${model} · ${provider.name}`,
        provider,
      });
    }
  }
  return options;
}

export function chatModelOptions(current: Settings = settings): ModelOption[] {
  const options: ModelOption[] = [];
  for (const provider of current.providers) {
    if (!providerSupports(provider, 'chat')) continue;
    for (const model of modelsFor(provider)) {
      options.push({
        ref: { providerId: provider.id, modelId: model },
        label: `${model} · ${provider.name}`,
        provider,
      });
    }
  }
  return options;
}

export function findProvider(providerId: string | undefined, current: Settings = settings): ProviderConfig | undefined {
  return current.providers.find((p) => p.id === providerId);
}

export function resolveImageModel(
  ref: ModelRef | undefined,
  current: Settings = settings,
): { provider: ProviderConfig; model: string } | null {
  const option = ref
    ? imageModelOptions(current).find(
        (o) => o.ref.providerId === ref.providerId && o.ref.modelId === ref.modelId,
      )
    : undefined;
  if (option) return { provider: option.provider, model: option.ref.modelId };
  const fallback = imageModelOptions(current)[0];
  return fallback ? { provider: fallback.provider, model: fallback.ref.modelId } : null;
}

export function resolveChatModel(
  ref: ModelRef | undefined,
  current: Settings = settings,
): { provider: ProviderConfig; model: string } | null {
  const demo = current.providers.find((p) => p.kind === 'demo' && p.enabled);
  const option = ref
    ? chatModelOptions(current).find(
        (o) => o.ref.providerId === ref.providerId && o.ref.modelId === ref.modelId,
      )
    : undefined;
  if (option) return { provider: option.provider, model: option.ref.modelId };
  const fallback = chatModelOptions(current)[0];
  if (fallback) return { provider: fallback.provider, model: fallback.ref.modelId };
  if (demo) return { provider: demo, model: 'mimeo-chat' };
  return null;
}

export const PROVIDER_PRESETS: Omit<ProviderConfig, 'id'>[] = [
  {
    name: 'OpenAI',
    kind: 'openai-image',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: ['gpt-image-1'],
    enabled: true,
  },
  {
    name: 'OpenAI 对话',
    kind: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: ['gpt-4o-mini'],
    vision: true,
    enabled: true,
  },
  {
    name: 'DeepSeek',
    kind: 'openai-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    models: ['deepseek-chat'],
    enabled: true,
  },
  {
    name: '通义千问',
    kind: 'openai-chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    models: ['qwen-plus', 'qwen-vl-max'],
    vision: true,
    enabled: true,
  },
  {
    name: '本地 Ollama',
    kind: 'openai-chat',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: 'ollama',
    models: ['llama3.2', 'qwen2.5-vl'],
    vision: true,
    enabled: true,
  },
];
