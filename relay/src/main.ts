import { startApp } from './ui/app';

void startApp().catch((error) => {
  console.error('[relay] 启动失败', error);
  const fallback = document.createElement('div');
  fallback.className = 'boot-error';
  fallback.innerHTML = `<strong>画布没有启动。</strong><p>${error instanceof Error ? error.message : '未知错误'}</p>`;
  document.body.appendChild(fallback);
});
