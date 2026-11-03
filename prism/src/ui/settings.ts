import { settings, updateSettings } from '../core/settings';
import { icon } from './icons';
import { showToast } from './toast';

export interface SettingsOptions {
  onSaved?: () => void;
}

export function openSettings(options: SettingsOptions = {}): void {
  const config = settings();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop settings-backdrop';
  backdrop.innerHTML = `
    <div class="settings-modal" role="dialog" aria-modal="true" aria-label="设置与接口">
      <header class="settings-head">
        <div>
          <div class="eyebrow">SETTINGS / 设置</div>
          <h2>设置与接口</h2>
        </div>
        <button class="icon-btn" data-act="close" aria-label="关闭">${icon('close', 17)}</button>
      </header>
      <div class="settings-body">
        <section class="settings-section">
          <div class="setting-row">
            <div><strong>离线示例</strong><p>不联网，用程序化纹理生成图片与短视频，方便先摸清节点关系。</p></div>
            <label class="switch"><input type="checkbox" data-field="demo" ${config.demo ? 'checked' : ''} /><span></span></label>
          </div>
        </section>
        <section class="settings-section">
          <h3>OpenAI 兼容图像接口</h3>
          <label class="field"><span class="field-head"><span>Base URL</span><span class="field-hint">不要带 /images/generations</span></span><input class="text-input" data-field="endpoint" value="${escapeAttr(config.endpoint)}" placeholder="https://api.openai.com/v1" /></label>
          <label class="field"><span class="field-head"><span>API Key</span><span class="field-hint">只存本机</span></span><span class="key-wrap"><input class="text-input" type="password" data-field="apiKey" value="${escapeAttr(config.apiKey)}" placeholder="sk-…" autocomplete="off" /><button type="button" class="btn tiny" data-act="reveal">显示</button></span></label>
          <label class="field"><span class="field-head"><span>图像模型</span><span class="field-hint">需支持图像生成</span></span><input class="text-input" data-field="model" value="${escapeAttr(config.model)}" placeholder="gpt-image-1" /></label>
          <label class="field"><span class="field-head"><span>视频模型</span><span class="field-hint">留空则沿用图像模型</span></span><input class="text-input" data-field="videoModel" value="${escapeAttr(config.videoModel ?? '')}" placeholder="sora-2" /></label>
          <label class="field"><span class="field-head"><span>并行生成</span><span class="field-hint">同时运行的任务数</span></span><input type="range" min="1" max="3" step="1" data-field="concurrency" value="${config.concurrency}" /><output data-out="concurrency">${config.concurrency}</output></label>
          <p class="settings-note">视频走 Sora 风格接口：<code>/videos</code> 建任务，轮询 <code>/videos/{id}</code>，完成后从 <code>/videos/{id}/content</code> 下载。参考图以 <code>input_reference</code> 上传，最多 4 个。不同服务对画幅、张数、种子的支持不一致，遇到 4xx 时先只留 1 张、改成 1:1 再试。</p>
        </section>
        <section class="settings-section connection">
          <div class="connection-state"><span class="dot"></span><span data-out="state">${config.demo ? '离线示例' : config.apiKey ? '已填写密钥，可以测试' : '还没有密钥'}</span></div>
          <button class="btn" data-act="test">${icon('refresh', 15)} 测试连接</button>
        </section>
      </div>
      <footer class="settings-foot">
        <span>设置保存在本机；不清站点数据就不会丢。</span>
        <div>
          <button class="btn" data-act="close">取消</button>
          <button class="btn primary" data-act="save">${icon('check', 15)} 保存设置</button>
        </div>
      </footer>
    </div>`;
  document.body.appendChild(backdrop);

  const field = (name: string): HTMLInputElement | null =>
    backdrop.querySelector<HTMLInputElement>(`[data-field="${name}"]`);

  const read = (): void => {
    updateSettings({
      demo: field('demo')?.checked ?? true,
      endpoint: field('endpoint')?.value.trim() ?? '',
      apiKey: field('apiKey')?.value.trim() ?? '',
      model: field('model')?.value.trim() ?? '',
      videoModel: field('videoModel')?.value.trim() ?? '',
      concurrency: Number(field('concurrency')?.value ?? 2),
    });
    const state = backdrop.querySelector<HTMLElement>('[data-out="state"]');
    if (state) {
      state.textContent = settings().demo
        ? '离线示例'
        : settings().apiKey
          ? '已填写密钥，可以测试'
          : '还没有密钥';
    }
    const output = backdrop.querySelector<HTMLOutputElement>('[data-out="concurrency"]');
    if (output) output.textContent = String(settings().concurrency);
  };

  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };

  backdrop.querySelectorAll<HTMLInputElement>('[data-field]').forEach((input) => {
    input.addEventListener('input', read);
    input.addEventListener('change', read);
  });
  backdrop.querySelector('[data-act="reveal"]')?.addEventListener('click', (event) => {
    const input = field('apiKey');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    (event.currentTarget as HTMLButtonElement).textContent = input.type === 'password' ? '显示' : '隐藏';
  });
  backdrop.querySelector('[data-act="test"]')?.addEventListener('click', async () => {
    read();
    const current = settings();
    if (current.demo) {
      showToast('当前是离线示例：不需要连接', 'info');
      return;
    }
    if (!current.endpoint || !current.apiKey) {
      showToast('先填写 Base URL 和 API Key', 'error');
      return;
    }
    const state = backdrop.querySelector<HTMLElement>('[data-out="state"]');
    if (state) state.textContent = '正在连接…';
    try {
      const response = await fetch(`${current.endpoint.replace(/\/+$/, '')}/models`, {
        headers: { Authorization: `Bearer ${current.apiKey}` },
      });
      if (!response.ok) throw new Error(`服务返回 ${response.status}`);
      if (state) state.textContent = '连接正常';
      showToast('接口连接正常', 'success');
    } catch (error) {
      if (state) state.textContent = '连接失败';
      showToast(error instanceof Error ? error.message : '连接失败', 'error');
    }
  });
  backdrop.querySelectorAll('[data-act="close"]').forEach((button) => button.addEventListener('click', close));
  backdrop.querySelector('[data-act="save"]')?.addEventListener('click', () => {
    read();
    options.onSaved?.();
    close();
    showToast('设置已保存', 'success');
  });
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      close();
    }
  };
  document.addEventListener('keydown', onKey);
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
