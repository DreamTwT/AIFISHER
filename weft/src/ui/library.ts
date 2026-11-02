import { addAsset, allAssets, getAssetImage, getAssetUrl, subscribeAssets } from '../core/assets';
import type { AssetMeta, ID } from '../core/types';
import { formatBytes, formatWhen } from '../core/util';
import { pickFiles } from './files';
import { icon } from './icons';
import { showToast } from './toast';

export interface LibraryOptions {
  onUse: (assetId: ID) => void;
}

export function openLibrary(options: LibraryOptions): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop library-backdrop';
  backdrop.innerHTML = `
    <div class="library-modal" role="dialog" aria-modal="true" aria-label="布样库">
      <header class="library-head">
        <div class="library-title">
          <div class="eyebrow">SAMPLES / 布样库</div>
          <h2>所有织过的样张</h2>
        </div>
        <div class="library-tools">
          <label class="search-box">${icon('search', 15)}<input type="search" placeholder="按名称或提示词搜索" /></label>
          <button class="btn" data-act="upload">${icon('upload', 15)} 放入新布样</button>
          <button class="icon-btn" data-act="close" aria-label="关闭">${icon('close', 17)}</button>
        </div>
      </header>
      <div class="library-grid"></div>
      <footer class="library-foot"><span class="library-stat"></span><span>布样保存在本机 IndexedDB，可随工程一并导出</span></footer>
    </div>`;
  document.body.appendChild(backdrop);

  const grid = backdrop.querySelector<HTMLElement>('.library-grid')!;
  const search = backdrop.querySelector<HTMLInputElement>('.search-box input')!;
  const stat = backdrop.querySelector<HTMLElement>('.library-stat')!;
  let query = '';

  const render = (): void => {
    const assets = allAssets().filter((asset) => {
      if (!query) return true;
      return `${asset.name} ${asset.prompt ?? ''} ${asset.model ?? ''}`.toLowerCase().includes(query);
    });
    stat.textContent = `${allAssets().length} 张布样 · ${assets.length} 张显示`;
    if (!assets.length) {
      grid.innerHTML = `
        <div class="library-empty">
          <div class="empty-mark">${icon('image', 28)}</div>
          <p>这里还没有布样。</p>
          <span>织一张，或把本机图片拖进画布。</span>
        </div>`;
      return;
    }
    grid.innerHTML = '';
    assets.forEach((asset) => grid.appendChild(card(asset)));
  };

  const card = (asset: AssetMeta): HTMLElement => {
    const item = document.createElement('button');
    item.className = 'asset-card';
    const url = getAssetUrl(asset.id);
    item.innerHTML = `
      <div class="asset-thumb">${url ? `<img alt="" src="${url}" loading="lazy" />` : '<span>NO PREVIEW</span>'}</div>
      <div class="asset-body">
        <strong>${escape(asset.name)}</strong>
        <span>${asset.width}×${asset.height} · ${formatBytes(asset.size)}</span>
        <span class="asset-when">${formatWhen(asset.createdAt)}${asset.seed ? ` · S${asset.seed}` : ''}</span>
      </div>
      <span class="asset-use">放入画布 ${icon('arrow', 13)}</span>`;
    item.addEventListener('click', () => {
      options.onUse(asset.id);
      close();
      showToast('布样已放入画布', 'success');
    });
    return item;
  };

  let onKey: ((event: KeyboardEvent) => void) | null = null;
  const close = (): void => {
    unsubscribe();
    if (onKey) document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };

  const upload = async (): Promise<void> => {
    const files = (await pickFiles('image/*', true)).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    for (const file of files) await addAsset(file, { name: file.name });
    showToast(`已放入 ${files.length} 张布样`, 'success');
  };

  backdrop.querySelector('[data-act="close"]')?.addEventListener('click', close);
  backdrop.querySelector('[data-act="upload"]')?.addEventListener('click', upload);
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    render();
  });
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  const unsubscribe = subscribeAssets(render);
  onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  render();
  window.setTimeout(() => search.focus(), 30);
}

export interface AssetDetailOptions {
  onUse?: (assetId: ID) => void;
}

export function openAssetDetail(asset: AssetMeta, options: AssetDetailOptions = {}): void {
  const url = getAssetUrl(asset.id);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop detail-backdrop';
  const image = getAssetImage(asset.id);
  backdrop.innerHTML = `
    <div class="asset-detail" role="dialog" aria-modal="true">
      <div class="detail-visual">${url ? `<img alt="" src="${url}" />` : '<span>NO PREVIEW</span>'}</div>
      <aside class="detail-side">
        <div class="detail-top"><div class="eyebrow">SAMPLE / 布样</div><button class="icon-btn" data-act="close" aria-label="关闭">${icon('close', 16)}</button></div>
        <h2>${escape(asset.name)}</h2>
        <dl>
          <div><dt>尺寸</dt><dd>${image ? `${image.naturalWidth} × ${image.naturalHeight}` : `${asset.width} × ${asset.height}`}</dd></div>
          <div><dt>来源</dt><dd>${asset.source === 'upload' ? '上传' : asset.model || '本机织样'}</dd></div>
          ${asset.seed ? `<div><dt>种子</dt><dd>${asset.seed}</dd></div>` : ''}
          <div><dt>时间</dt><dd>${formatWhen(asset.createdAt)}</dd></div>
        </dl>
        ${asset.prompt ? `<div class="detail-prompt"><div class="eyebrow">PROMPT</div><p>${escape(asset.prompt)}</p></div>` : ''}
        <div class="detail-actions">
          ${options.onUse ? `<button class="btn primary" data-act="use">${icon('plus', 15)} 放入画布</button>` : ''}
          ${asset.prompt ? `<button class="btn" data-act="copy">复制提示词</button>` : ''}
        </div>
      </aside>
    </div>`;
  document.body.appendChild(backdrop);
  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  backdrop.querySelector('[data-act="close"]')?.addEventListener('click', close);
  backdrop.querySelector('[data-act="use"]')?.addEventListener('click', () => {
    options.onUse?.(asset.id);
    close();
  });
  backdrop.querySelector('[data-act="copy"]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(asset.prompt ?? '');
      showToast('提示词已复制', 'success');
    } catch {
      showToast('浏览器拒绝了剪贴板写入', 'error');
    }
  });
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
}

function escape(value: string): string {
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
