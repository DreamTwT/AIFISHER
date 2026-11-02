import type { AspectRatio, GenerationInput, GenerationResult, GeneratedImage, ProviderConfig } from '../model/types';
import { hashString } from '../lib/util';
import { renderDemoImage, streamDemoChat } from './demoEngine';

export interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  imageUrl?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

const ACCENT = '网络请求失败';

function normalizeBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('请先在设置中填写 Base URL');
  return trimmed;
}

function abortError(): DOMException {
  return new DOMException('任务已取消', 'AbortError');
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const message =
      typeof json.error === 'string'
        ? json.error
        : json.error?.message ?? json.message ?? text.slice(0, 240);
    return message || `HTTP ${response.status}`;
  } catch {
    return text.slice(0, 240) || `HTTP ${response.status}`;
  }
}

export function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '任务已取消';
  if (error instanceof TypeError) return '无法连接服务（可能是网络、CORS 或 Base URL 配置问题）';
  if (error instanceof Error) return error.message;
  return ACCENT;
}

function sizeForAspect(aspect: AspectRatio): { size: string; width: number; height: number } {
  switch (aspect) {
    case '16:9':
    case '3:2':
    case '21:9':
      return { size: '1536x1024', width: 1536, height: 1024 };
    case '9:16':
    case '3:4':
    case '4:5':
    case '2:3':
      return { size: '1024x1536', width: 1024, height: 1536 };
    default:
      return { size: '1024x1024', width: 1024, height: 1024 };
  }
}

function base64ToBlob(base64: string, mime = 'image/png'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function imageResultFromResponse(
  data: { b64_json?: string; url?: string }[],
  prompt: string,
  model: string,
  seed: number,
  startedAt: number,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<GeneratedImage[]> {
  return Promise.all(
    data.map(async (item) => {
      if (item.b64_json) {
        return {
          blob: base64ToBlob(item.b64_json),
          width,
          height,
          seed,
          prompt,
          model,
          elapsedMs: Date.now() - startedAt,
        };
      }
      if (!item.url) throw new Error('服务返回了空结果');
      const res = await fetch(item.url, { signal });
      if (!res.ok) throw new Error(`下载生成结果失败（${res.status}）`);
      const blob = await res.blob();
      return {
        blob,
        width,
        height,
        seed,
        prompt,
        model,
        elapsedMs: Date.now() - startedAt,
      };
    }),
  );
}

async function generateOpenAIImages(
  config: ProviderConfig,
  model: string,
  input: GenerationInput,
): Promise<GenerationResult> {
  const sized = sizeForAspect(input.aspect);
  // DALL·E 3 只接受 1024×1024 / 1792×1024 / 1024×1792；gpt-image 系列支持 1536 长边
  const dalle3 = model.includes('dall-e-3');
  const size = dalle3
    ? sized.width > sized.height
      ? '1792x1024'
      : sized.height > sized.width
        ? '1024x1792'
        : '1024x1024'
    : sized.size;
  const width = dalle3 ? (size === '1792x1024' ? 1792 : 1024) : sized.width;
  const height = dalle3 ? (size === '1024x1792' ? 1792 : 1024) : sized.height;
  const startedAt = Date.now();
  const seed = input.seed ?? hashString(input.prompt + Date.now());
  const images: GeneratedImage[] = [];
  const batch = dalle3 ? 1 : input.count;
  let remaining = input.count;

  while (remaining > 0) {
    const n = Math.min(batch, remaining);
    const prompt = [input.prompt, input.negative ? `\nAvoid: ${input.negative}` : ''].join('');
    const useEdits = input.referenceImages.length > 0 && model.startsWith('gpt-image');
    const endpoint = useEdits
      ? `${normalizeBase(config.baseUrl)}/images/edits`
      : `${normalizeBase(config.baseUrl)}/images/generations`;

    let body: BodyInit;
    const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` };
    if (useEdits) {
      const form = new FormData();
      form.set('model', model);
      form.set('prompt', prompt);
      form.set('n', String(n));
      form.set('size', size);
      for (const [index, ref] of input.referenceImages.slice(0, 4).entries()) {
        form.set(index === 0 ? 'image' : 'image[]', ref.blob, ref.name || `reference-${index}.png`);
      }
      body = form;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        model,
        prompt,
        n,
        size,
        ...(model.startsWith('gpt-image') ? { quality: 'high' } : { response_format: 'b64_json' }),
      });
    }

    input.onProgress?.(0.12, '提交请求');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: input.signal,
    });
    if (!response.ok) throw new Error(await readError(response));
    const json = (await response.json()) as {
      data?: { b64_json?: string; url?: string }[];
      error?: { message?: string };
    };
    if (json.error) throw new Error(json.error.message ?? '图像服务返回错误');
    if (!json.data?.length) throw new Error('服务没有返回图像');
    input.onProgress?.(0.8, '下载结果');
    images.push(
      ...(await imageResultFromResponse(json.data, input.prompt, model, seed, startedAt, width, height, input.signal)),
    );
    remaining -= n;
  }

  input.onProgress?.(1, '完成');
  return { images };
}

async function generateDemo(
  _config: ProviderConfig,
  model: string,
  input: GenerationInput,
): Promise<GenerationResult> {
  const images: GeneratedImage[] = [];
  const turbo = model.includes('turbo');
  const startedAt = Date.now();
  for (let i = 0; i < input.count; i++) {
    if (input.signal.aborted) throw abortError();
    const seed = input.seed != null ? input.seed + i : (hashString(input.prompt) + i * 7919) >>> 0;
    input.onProgress?.(0.08 + (i / input.count) * 0.85, `绘制第 ${i + 1} / ${input.count} 张`);
    await sleep(turbo ? 180 : 420, input.signal);
    const result = await renderDemoImage({
      prompt: `${input.prompt} ${input.negative}`,
      aspect: input.aspect,
      seed,
    });
    images.push({
      blob: result.blob,
      width: result.width,
      height: result.height,
      seed,
      prompt: input.prompt,
      model,
      elapsedMs: Date.now() - startedAt,
    });
    await sleep(turbo ? 90 : 160, input.signal);
  }
  input.onProgress?.(1, '完成');
  return { images };
}

export async function generateImageWithProvider(
  config: ProviderConfig,
  model: string,
  input: GenerationInput,
): Promise<GenerationResult> {
  if (!config.enabled) throw new Error(`服务「${config.name}」已停用`);
  switch (config.kind) {
    case 'demo':
      return generateDemo(config, model, input);
    case 'openai-image':
      if (!config.apiKey && !/localhost|127\.0\.0\.1/.test(config.baseUrl)) {
        throw new Error('请先在设置中填写该服务的 API Key');
      }
      return generateOpenAIImages(config, model, input);
    case 'openai-chat':
      throw new Error('该服务是对话服务，不能用于图像生成');
  }
}

function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: message.content.map((part) =>
        part.type === 'text'
          ? { type: 'text', text: part.text ?? '' }
          : { type: 'image_url', image_url: { url: part.imageUrl, detail: 'high' } },
      ),
    };
  });
}

export async function chatWithProvider(
  config: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  options: { signal: AbortSignal; temperature?: number; onDelta?: (text: string) => void },
): Promise<string> {
  if (!config.enabled) throw new Error(`服务「${config.name}」已停用`);

  if (config.kind === 'demo') {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const prompt =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : lastUser?.content?.map((p) => p.text ?? '').join('\n') ?? '';
    const system = messages.find((m) => m.role === 'system');
    return streamDemoChat({
      prompt,
      contextText: typeof system?.content === 'string' ? system.content : '',
      onDelta: options.onDelta ?? (() => {}),
      signal: options.signal,
    });
  }

  if (config.kind === 'openai-image') throw new Error('该服务是图像服务，不能用于对话');
  if (!config.apiKey && !/localhost|127\.0\.0\.1/.test(config.baseUrl)) {
    throw new Error('请先在设置中填写该服务的 API Key');
  }

  const response = await fetch(`${normalizeBase(config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: toOpenAIMessages(messages),
      temperature: options.temperature ?? 0.7,
      stream: true,
    }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  if (!response.body) {
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content ?? '';
    options.onDelta?.(text);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string }; message?: { content?: string } }[];
          error?: { message?: string };
        };
        if (json.error) throw new Error(json.error.message ?? '对话服务返回错误');
        const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? '';
        if (delta) {
          full += delta;
          options.onDelta?.(delta);
        }
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }
  return full;
}

/** 设置页的连通性检查：优先调用 /models，避免产生生成费用 */
export async function verifyProvider(config: ProviderConfig): Promise<string> {
  if (config.kind === 'demo') return '离线样例引擎可用';
  if (!config.apiKey && !/localhost|127\.0\.0\.1/.test(config.baseUrl)) {
    throw new Error('尚未填写 API Key');
  }
  const response = await fetch(`${normalizeBase(config.baseUrl)}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!response.ok) throw new Error(await readError(response));
  const json = (await response.json()) as { data?: { id?: string }[] };
  const count = json.data?.length ?? 0;
  return count ? `连接成功，可用模型 ${count} 个` : '连接成功';
}
