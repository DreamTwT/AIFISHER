/**
 * 简易并发闸门：生成任务按设置中的并发数排队，
 * 排队中的任务仍可取消（AbortSignal）。
 */

interface Waiting {
  resolve: () => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

let running = 0;
let waiting: Waiting[] = [];

function pump() {
  while (waiting.length) {
    const limit = getLimit();
    if (running >= limit) return;
    const next = waiting.shift()!;
    next.signal.removeEventListener('abort', next.onAbort);
    if (next.signal.aborted) {
      next.reject(new DOMException('任务已取消', 'AbortError'));
      continue;
    }
    running += 1;
    next.resolve();
  }
}

let limitProvider: () => number = () => 2;

export function setConcurrencyProvider(provider: () => number) {
  limitProvider = provider;
}

function getLimit(): number {
  try {
    return Math.max(1, Math.min(4, limitProvider() || 2));
  } catch {
    return 2;
  }
}

export function acquireSlot(signal: AbortSignal): Promise<() => void> {
  const release = () => {
    running = Math.max(0, running - 1);
    pump();
  };
  if (signal.aborted) return Promise.reject(new DOMException('任务已取消', 'AbortError'));
  if (running < getLimit()) {
    running += 1;
    return Promise.resolve(release);
  }
  return new Promise((resolve, reject) => {
    const entry: Waiting = {
      resolve: () => resolve(release),
      reject,
      signal,
      onAbort: () => {
        waiting = waiting.filter((w) => w !== entry);
        reject(new DOMException('任务已取消', 'AbortError'));
      },
    };
    signal.addEventListener('abort', entry.onAbort, { once: true });
    waiting.push(entry);
  });
}

export function queueDepth(): number {
  return waiting.length;
}
