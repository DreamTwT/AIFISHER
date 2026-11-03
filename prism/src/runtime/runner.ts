import { addAsset } from '../core/assets';
import type { Editor } from '../core/editor';
import { hasLiveProvider, settings } from '../core/settings';
import type { Aspect, ID } from '../core/types';
import { hashString, sleep, uid } from '../core/util';
import { renderSample } from './demo';
import { renderWithProvider, validateProvider } from './provider';

const controllers = new Map<ID, AbortController>();

export function isRunning(): boolean {
  return controllers.size > 0;
}

export function cancelRender(nodeId: ID): void {
  controllers.get(nodeId)?.abort();
  controllers.delete(nodeId);
}

export interface RunOptions {
  notify?: (message: string, kind?: 'info' | 'success' | 'error') => void;
}

export async function runRender(editor: Editor, nodeId: ID, options: RunOptions = {}): Promise<void> {
  const node = editor.node(nodeId);
  if (!node || node.kind !== 'render') return;
  if (controllers.has(nodeId)) return;

  const prompt = editor.effectivePrompt(nodeId).trim();
  if (!prompt) {
    options.notify?.('生成节点还没有提示词：写一句，或把文本连进来', 'error');
    editor.updateNode(nodeId, { status: 'error', error: '缺少提示词', progress: 0 });
    return;
  }
  if (!hasLiveProvider()) {
    const configError = validateProvider();
    if (!settings().demo && configError) {
      options.notify?.(configError, 'error');
      editor.updateNode(nodeId, { status: 'error', error: configError, progress: 0 });
      return;
    }
  }

  const controller = new AbortController();
  controllers.set(nodeId, controller);
  const count = Math.max(1, Math.min(4, node.count));
  const seed = node.seed ?? hashString(prompt + nodeId);
  editor.updateNode(nodeId, { status: 'running', progress: 0, error: undefined });

  try {
    const produced: ID[] = [];
    for (let index = 0; index < count; index += 1) {
      if (controller.signal.aborted) break;
      const blob = hasLiveProvider()
        ? (await renderWithProvider(prompt, node.aspect as Aspect, 1, seed + index, controller.signal))[0]
        : await demoImage(prompt, node.aspect as Aspect, seed, index);
      if (controller.signal.aborted) break;
      const meta = await addAsset(blob, {
        name: `${node.title && node.title !== '生成' ? node.title : '生成结果'} · ${String(index + 1).padStart(2, '0')}`,
        source: 'render',
        prompt,
        seed: seed + index,
        model: hasLiveProvider() ? settings().model : 'prism-sample',
      });
      produced.push(meta.id);
      const current = editor.node(nodeId);
      const existing = current?.kind === 'render' ? current.assetIds : [];
      editor.updateNode(
        nodeId,
        {
          assetIds: [...existing, meta.id],
          progress: Math.round(((index + 1) / count) * 100),
        },
        false,
      );
    }
    editor.updateNode(nodeId, {
      status: 'done',
      progress: 100,
      assetIds: produced.length ? produced : node.assetIds,
    });
    options.notify?.(`已生成 ${produced.length} 张图片`, 'success');
  } catch (error) {
    if (controller.signal.aborted) {
      editor.updateNode(nodeId, { status: 'idle', progress: 0 });
      options.notify?.('已停下这个生成任务', 'info');
    } else {
      const message = error instanceof Error ? error.message : '生成失败';
      editor.updateNode(nodeId, { status: 'error', error: message, progress: 0 });
      options.notify?.(message, 'error');
    }
  } finally {
    controllers.delete(nodeId);
  }
}

async function demoImage(prompt: string, aspect: Aspect, seed: number, index: number): Promise<Blob> {
  await sleep(420 + index * 140);
  return renderSample(prompt, aspect, seed, index);
}

export async function runSelection(editor: Editor, options: RunOptions = {}): Promise<void> {
  const targets = editor
    .selectedNodes()
    .filter((node) => node.kind === 'render')
    .map((node) => node.id);
  if (!targets.length) {
    options.notify?.('先选中一个生成节点', 'info');
    return;
  }
  await Promise.all(targets.map((id) => runRender(editor, id, options)));
}

export async function runAll(editor: Editor, options: RunOptions = {}): Promise<void> {
  const targets = editor.doc.nodes.filter((node) => node.kind === 'render').map((node) => node.id);
  if (!targets.length) {
    options.notify?.('画布上还没有生成节点', 'info');
    return;
  }
  const queue = [...targets];
  const concurrency = Math.max(1, Math.min(3, settings().concurrency));
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const id = queue.shift();
      if (id) await runRender(editor, id, options);
    }
  });
  await Promise.all(workers);
}

/** 供测试与导入使用 */
export function newRunId(): string {
  return uid('run');
}
