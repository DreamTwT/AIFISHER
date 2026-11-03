import { imageSizeFor, settings } from '../core/settings';
import type { Aspect } from '../core/types';

interface ImageResponse {
  data?: {
    b64_json?: string;
    url?: string;
  }[];
  error?: { message?: string };
}

export function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

async function urlToBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片下载失败（${response.status}）`);
  return response.blob();
}

async function requestImages(
  prompt: string,
  aspect: Aspect,
  count: number,
  _seed: number,
  signal: AbortSignal,
): Promise<Blob[]> {
  const config = settings();
  const endpoint = config.endpoint.replace(/\/+$/, '');
  const response = await fetch(`${endpoint}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      n: count,
      size: imageSizeFor(aspect),
    }),
    signal,
  });

  const payload = (await response.json().catch(() => ({}))) as ImageResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `图像服务返回 ${response.status}`);
  }
  const items = payload.data ?? [];
  if (!items.length) throw new Error('图像服务没有返回结果');

  const blobs: Blob[] = [];
  for (const item of items) {
    if (item.b64_json) blobs.push(base64ToBlob(item.b64_json));
    else if (item.url) blobs.push(await urlToBlob(item.url));
  }
  if (!blobs.length) throw new Error('返回结果中没有可读取的图片');
  return blobs;
}

/**
 * 调用 OpenAI 兼容图像接口。
 * 某些模型不支持 n > 1，失败时退化为逐张请求。
 */
export async function renderWithProvider(
  prompt: string,
  aspect: Aspect,
  count: number,
  _seed: number,
  signal: AbortSignal,
): Promise<Blob[]> {
  try {
    return await requestImages(prompt, aspect, count, _seed, signal);
  } catch (error) {
    if (count <= 1 || signal.aborted) throw error;
    const results: Blob[] = [];
    for (let i = 0; i < count; i += 1) {
      const blob = await requestImages(prompt, aspect, 1, _seed + i, signal);
      results.push(...blob);
    }
    return results;
  }
}

export function validateProvider(): string | null {
  const config = settings();
  if (!config.endpoint.trim()) return '请填写 Base URL';
  if (!config.apiKey.trim()) return '请填写 API Key';
  if (!config.model.trim()) return '请填写模型名称';
  if (!/^https?:\/\//.test(config.endpoint.trim())) return 'Base URL 需要以 http:// 或 https:// 开头';
  return null;
}
