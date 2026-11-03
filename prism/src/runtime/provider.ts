import { imageSizeFor, settings, videoSizeFor } from '../core/settings';
import type { Aspect } from '../core/types';
import { sleep } from '../core/util';

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


interface VideoJob {
  id?: string;
  status?: string;
  progress?: number;
  error?: { message?: string } | string;
  data?: { b64_json?: string; url?: string }[];
}

function extensionFor(type: string): string {
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('webm')) return 'webm';
  if (type.includes('quicktime')) return 'mov';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  return 'png';
}

/**
 * 视频生成走 Sora 风格的异步任务接口：
 * POST /videos → 轮询 GET /videos/{id} → GET /videos/{id}/content。
 * 多张参考图以重复的 input_reference 字段上传，兼容支持多参考的网关。
 */
export async function renderVideoWithProvider(
  prompt: string,
  aspect: Aspect,
  seconds: number,
  references: Blob[],
  signal: AbortSignal,
  onProgress?: (value: number) => void,
): Promise<Blob> {
  const config = settings();
  const endpoint = config.endpoint.replace(/\/+$/, '');
  const form = new FormData();
  form.append('model', config.videoModel?.trim() || config.model);
  form.append('prompt', prompt);
  form.append('size', videoSizeFor(aspect));
  form.append('seconds', String(seconds));
  references.slice(0, 4).forEach((blob, index) => {
    const type = blob.type || 'image/png';
    const file = new File([blob], `reference-${index + 1}.${extensionFor(type)}`, { type });
    form.append('input_reference', file);
  });

  const response = await fetch(`${endpoint}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as VideoJob;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || `视频服务返回 ${response.status}`);
  }
  if (payload.data?.length) {
    const item = payload.data[0];
    if (item.b64_json) return base64ToBlob(item.b64_json);
    if (item.url) return urlToBlob(item.url);
  }
  if (!payload.id) throw new Error('视频服务没有返回任务编号');

  const started = Date.now();
  let job = payload;
  while (job.status !== 'completed' && job.status !== 'failed') {
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    if (Date.now() - started > 10 * 60 * 1000) throw new Error('视频生成超时，请稍后重试');
    await sleep(2500);
    const poll = await fetch(`${endpoint}/videos/${payload.id}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal,
    });
    job = (await poll.json().catch(() => ({}))) as VideoJob;
    if (!poll.ok) {
      throw new Error(typeof job.error === 'string' ? job.error : job.error?.message || `视频服务返回 ${poll.status}`);
    }
    if (typeof job.progress === 'number') onProgress?.(Math.max(0, Math.min(96, Math.round(job.progress))));
  }
  if (job.status === 'failed') {
    throw new Error(typeof job.error === 'string' ? job.error : job.error?.message || '视频生成失败');
  }
  onProgress?.(98);
  const content = await fetch(`${endpoint}/videos/${payload.id}/content`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal,
  });
  if (!content.ok) throw new Error(`视频下载失败（${content.status}）`);
  const blob = await content.blob();
  return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: 'video/mp4' });
}
