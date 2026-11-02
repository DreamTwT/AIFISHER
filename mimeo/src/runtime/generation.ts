import { uid } from '../lib/util';
import { blobToDataURL } from '../lib/util';
import { collectContext, composeNegative, composePrompt, topologicalOrder } from '../model/graph';
import type { AssetMeta, ChatNode, GenerateNode, ID, TaskInfo } from '../model/types';
import { addAsset, getAssetBlob } from '../store/assets';
import { getEditor } from '../store/editor';
import {
  chatModelOptions,
  getSettings,
  imageModelOptions,
  resolveChatModel,
  resolveImageModel,
} from '../store/settings';
import { toast, updateTask, upsertTask } from '../store/ui';
import { acquireSlot, setConcurrencyProvider } from './limiter';
import { chatWithProvider, friendlyError, generateImageWithProvider, type ChatMessage } from './providers';

const controllers = new Map<ID, AbortController>();
let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;
  setConcurrencyProvider(() => getSettings().concurrency);
  window.addEventListener('beforeunload', () => {
    for (const controller of controllers.values()) controller.abort();
  });
}

export function isNodeRunning(nodeId: ID): boolean {
  return controllers.has(nodeId);
}

export function runningNodeIds(): ID[] {
  return [...controllers.keys()];
}

export function cancelNodeRun(nodeId: ID): void {
  controllers.get(nodeId)?.abort();
}

export function cancelAllRuns(): void {
  for (const controller of controllers.values()) controller.abort();
}

function newTask(nodeId: ID, kind: 'image' | 'chat', label: string): TaskInfo {
  const task: TaskInfo = {
    id: uid('task'),
    nodeId,
    kind,
    label,
    status: 'queued',
    progress: 0,
    startedAt: Date.now(),
  };
  upsertTask(task);
  return task;
}

async function resolveReferenceBlobs(
  images: { assetId?: string; url?: string; title: string }[],
): Promise<{ blob: Blob; name: string }[]> {
  const out: { blob: Blob; name: string }[] = [];
  for (const image of images.slice(0, 4)) {
    try {
      if (image.assetId) {
        const blob = getAssetBlob(image.assetId);
        if (blob) out.push({ blob, name: `${image.title || 'reference'}.${blob.type.includes('png') ? 'png' : 'webp'}` });
      } else if (image.url) {
        const response = await fetch(image.url, { mode: 'cors' });
        if (response.ok) {
          const blob = await response.blob();
          out.push({ blob, name: `${image.title || 'reference'}.png` });
        }
      }
    } catch (error) {
      console.warn('[mimeo] 参考图读取失败', error);
    }
  }
  return out;
}

/** 把参考图转成 data URL 供 vision 模型使用 */
async function referenceDataUrls(
  images: { assetId?: string; url?: string; title: string }[],
): Promise<string[]> {
  const urls: string[] = [];
  for (const image of images.slice(0, 3)) {
    try {
      if (image.assetId) {
        const blob = getAssetBlob(image.assetId);
        if (blob) urls.push(await blobToDataURL(blob));
      } else if (image.url) {
        urls.push(image.url);
      }
    } catch {
      // 忽略单张参考图失败
    }
  }
  return urls;
}

export async function runGenerateNode(nodeId: ID): Promise<boolean> {
  ensureInit();
  const store = getEditor();
  const node = store.getNode(nodeId);
  if (!node || node.kind !== 'generate') return false;
  if (controllers.has(nodeId)) {
    toast('这个节点正在生成中，请稍候', 'info');
    return false;
  }

  const settings = getSettings();
  const resolved = resolveImageModel(node.model ?? settings.defaultImageModel, settings);
  if (!resolved) {
    toast('没有可用的图像模型，请先在设置中添加模型服务', 'error', {
      actionLabel: '打开设置',
      action: () => window.dispatchEvent(new CustomEvent('mimeo:open-settings')),
    });
    return false;
  }
  if (!imageModelOptions(settings).some((o) => o.provider.id === resolved.provider.id)) {
    toast('当前图像模型不可用，请在设置中检查服务状态', 'error');
    return false;
  }

  const doc = store.getDoc();
  const context = collectContext(doc, nodeId);
  const prompt = composePrompt(node.prompt, context);
  const negative = composeNegative(node.negative, context);
  if (!prompt.trim() && !context.images.length) {
    toast('请先填写提示词，或从左侧连接提示词 / 参考图节点', 'error');
    return false;
  }

  const controller = new AbortController();
  controllers.set(nodeId, controller);
  const task = newTask(nodeId, 'image', `图像生成 · ${node.title}`);
  store.beginGesture('生成图像');
  store.setGenerateState(nodeId, { status: 'queued', progress: 0, taskId: task.id, error: undefined });

  let release: (() => void) | null = null;
  try {
    release = await acquireSlot(controller.signal);
    store.setGenerateState(nodeId, { status: 'running', progress: 0.04 });
    updateTask(task.id, { status: 'running', progress: 0.04 });

    const references = await resolveReferenceBlobs(context.images);
    const startedAt = Date.now();
    const result = await generateImageWithProvider(resolved.provider, resolved.model, {
      prompt,
      negative,
      aspect: node.aspect,
      count: node.count,
      seed: node.seed,
      referenceImages: references,
      signal: controller.signal,
      onProgress: (value, note) => {
        if (controller.signal.aborted) return;
        store.setGenerateState(nodeId, { status: 'running', progress: Math.min(0.99, value) });
        updateTask(task.id, { progress: Math.min(0.99, value), label: note ? `图像生成 · ${note}` : task.label });
      },
    });

    const current = store.getNode(nodeId);
    if (!current || current.kind !== 'generate' || current.taskId !== task.id) {
      throw new DOMException('任务已取消', 'AbortError');
    }

    const assets: AssetMeta[] = [];
    for (const image of result.images) {
      assets.push(
        await addAsset(image.blob, {
          name: `${node.title} · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
          source: 'generation',
          prompt,
          model: `${resolved.model}`,
          seed: image.seed,
          width: image.width,
          height: image.height,
        }),
      );
    }
    if (!assets.length) throw new Error('没有得到可用图像');

    const latest = store.getNode(nodeId);
    if (!latest || latest.kind !== 'generate' || latest.taskId !== task.id) {
      throw new DOMException('任务已取消', 'AbortError');
    }
    const outputs = [...assets.map((a) => a.id), ...latest.outputs].slice(0, 80);
    store.patchNodeSilent(nodeId, {
      outputs,
      activeOutput: 0,
      status: 'done',
      progress: 1,
      error: undefined,
      seed: result.images[0]?.seed ?? latest.seed,
      elapsedMs: Date.now() - startedAt,
    });
    store.commitGesture();
    updateTask(task.id, { status: 'done', progress: 1, endedAt: Date.now() });
    toast(`已生成 ${assets.length} 张图像`, 'success', {
      actionLabel: '查看',
      action: () => window.dispatchEvent(new CustomEvent('mimeo:open-asset', { detail: { assetId: assets[0].id } })),
    });
    return true;
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    if (aborted) {
      store.setGenerateState(nodeId, { status: 'canceled', progress: 0, error: undefined });
      updateTask(task.id, { status: 'canceled', endedAt: Date.now() });
    } else {
      const message = friendlyError(error);
      store.setGenerateState(nodeId, { status: 'error', progress: 0, error: message });
      updateTask(task.id, { status: 'error', error: message, endedAt: Date.now() });
      toast(`生成失败：${message}`, 'error', {
        actionLabel: '重试',
        action: () => void runGenerateNode(nodeId),
      });
    }
    store.commitGesture();
    return false;
  } finally {
    controllers.delete(nodeId);
    release?.();
  }
}

export async function runChatNode(nodeId: ID): Promise<boolean> {
  ensureInit();
  const store = getEditor();
  const node = store.getNode(nodeId);
  if (!node || node.kind !== 'chat') return false;
  if (controllers.has(nodeId)) {
    toast('这个节点正在生成中，请稍候', 'info');
    return false;
  }
  const settings = getSettings();
  const resolved = resolveChatModel(node.model ?? settings.defaultChatModel, settings);
  if (!resolved) {
    toast('没有可用的对话模型，请先在设置中添加模型服务', 'error', {
      actionLabel: '打开设置',
      action: () => window.dispatchEvent(new CustomEvent('mimeo:open-settings')),
    });
    return false;
  }

  const context = collectContext(store.getDoc(), nodeId);
  const contextText = context.texts.map((t) => `${t.title}：${t.text}`).join('\n\n');
  const prompt = node.prompt.trim() || (contextText ? '请基于上游上下文给出下一步创作建议。' : '');
  if (!prompt) {
    toast('请先输入问题，或连接提示词节点作为上下文', 'error');
    return false;
  }

  const controller = new AbortController();
  controllers.set(nodeId, controller);
  const task = newTask(nodeId, 'chat', `对话生成 · ${node.title}`);
  store.beginGesture('对话生成');
  store.setChatState(nodeId, { status: 'queued', taskId: task.id, error: undefined, output: '' });

  let release: (() => void) | null = null;
  try {
    release = await acquireSlot(controller.signal);
    store.setChatState(nodeId, { status: 'running' });
    updateTask(task.id, { status: 'running' });

    const messages: ChatMessage[] = [];
    const systemParts = [node.system.trim()];
    if (contextText) systemParts.push(`# 上游画布上下文\n${contextText}`);
    if (systemParts.filter(Boolean).length) {
      messages.push({ role: 'system', content: systemParts.filter(Boolean).join('\n\n') });
    }
    for (const turn of node.turns.slice(-8)) messages.push({ role: turn.role, content: turn.content });

    let imageUrls: string[] = [];
    if (resolved.provider.vision) imageUrls = await referenceDataUrls(context.images);
    if (imageUrls.length) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...imageUrls.map((url) => ({ type: 'image_url' as const, imageUrl: url })),
        ],
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    let full = '';
    let lastPaint = 0;
    const onDelta = (chunk: string) => {
      full += chunk;
      const now = performance.now();
      if (now - lastPaint > 60) {
        lastPaint = now;
        store.setChatState(nodeId, { output: full });
        updateTask(task.id, { progress: Math.min(0.9, 0.08 + full.length / 600) });
      }
    };
    const text = await chatWithProvider(resolved.provider, resolved.model, messages, {
      signal: controller.signal,
      temperature: node.temperature,
      onDelta,
    });

    const current = store.getNode(nodeId);
    if (!current || current.kind !== 'chat' || current.taskId !== task.id) {
      throw new DOMException('任务已取消', 'AbortError');
    }
    const turns = [
      ...current.turns,
      { role: 'user' as const, content: prompt, at: Date.now() },
      { role: 'assistant' as const, content: text || full, at: Date.now() },
    ].slice(-12);
    store.patchNodeSilent(nodeId, {
      output: text || full,
      turns,
      status: 'done',
      error: undefined,
      taskId: undefined,
    } satisfies Partial<ChatNode>);
    store.commitGesture();
    updateTask(task.id, { status: 'done', progress: 1, endedAt: Date.now() });
    toast('对话已完成', 'success');
    return true;
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    if (aborted) {
      store.setChatState(nodeId, { status: 'canceled', error: undefined });
      updateTask(task.id, { status: 'canceled', endedAt: Date.now() });
    } else {
      const message = friendlyError(error);
      store.setChatState(nodeId, { status: 'error', error: message });
      updateTask(task.id, { status: 'error', error: message, endedAt: Date.now() });
      toast(`对话失败：${message}`, 'error', {
        actionLabel: '重试',
        action: () => void runChatNode(nodeId),
      });
    }
    store.commitGesture();
    return false;
  } finally {
    controllers.delete(nodeId);
    release?.();
  }
}

export function runNode(nodeId: ID): Promise<boolean> {
  const node = getEditor().getNode(nodeId);
  if (!node) return Promise.resolve(false);
  if (node.kind === 'generate') return runGenerateNode(nodeId);
  if (node.kind === 'chat') return runChatNode(nodeId);
  toast('这个节点没有可执行的任务', 'info');
  return Promise.resolve(false);
}

export function runSelectedNodes(): void {
  const nodes = getEditor().getSelectedNodes();
  const runnable = nodes.filter((n): n is GenerateNode | ChatNode => n.kind === 'generate' || n.kind === 'chat');
  if (!runnable.length) {
    toast('请选择图像生成或对话节点', 'info');
    return;
  }
  for (const node of runnable) void runNode(node.id);
}

/** 按依赖分层并行执行整张画布 */
export async function runAllNodes(): Promise<void> {
  const store = getEditor();
  const { order, cycles } = topologicalOrder(store.getDoc());
  if (!order.length) {
    toast('画布中还没有可运行的节点', 'info');
    return;
  }
  if (cycles.length) toast(`检测到 ${cycles.length} 个循环依赖节点，已跳过`, 'error');
  const nodes = store.getDoc().nodes;
  const depth = new Map<ID, number>();
  for (const id of order) {
    const incoming = store.getDoc().edges.filter((e) => e.to === id && depth.has(e.from));
    depth.set(id, incoming.length ? Math.max(...incoming.map((e) => depth.get(e.from)! + 1)) : 0);
  }
  const layers = new Map<number, ID[]>();
  for (const id of order) {
    const d = depth.get(id) ?? 0;
    layers.set(d, [...(layers.get(d) ?? []), id]);
  }
  const sorted = [...layers.entries()].sort((a, b) => a[0] - b[0]);
  toast(`开始运行 ${order.length} 个节点（${nodes.filter((n) => n.kind === 'chat' || n.kind === 'generate').length} 个可执行）`, 'info');
  for (const [, ids] of sorted) {
    await Promise.all(ids.map((id) => runNode(id)));
  }
}

export function hasUsableImageModel(): boolean {
  return imageModelOptions().length > 0;
}

export function hasUsableChatModel(): boolean {
  return chatModelOptions().length > 0;
}
