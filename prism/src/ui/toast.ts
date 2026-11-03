let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.className = 'toasts';
  document.body.appendChild(host);
  return host;
}

export function showToast(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  const container = ensureHost();
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('in'));
  window.setTimeout(() => {
    toast.classList.remove('in');
    window.setTimeout(() => toast.remove(), 260);
  }, kind === 'error' ? 4200 : 2800);
}
