import { addAsset, allAssets, getAssetImage, getAssetUrl, subscribeAssets } from '../core/assets';
import type { AssetMeta, ID } from '../core/types';
import { formatBytes, formatWhen } from '../core/util';
import { pickFiles } from './files';
import { icon } from './icons';
import { showToast } from './toast';

export interface LibraryOptions {
  onUse: (assetId: ID) => void;
  /** 批量放入画布；不传时素材库只提供多选删除 */
  onUseMany?: (assetIds: ID[]) => void;
  onDelete?: (assetId: ID) => boolean | Promise<boolean>;
  onDeleteMany?: (assetIds: ID[]) => boolean | Promise<boolean>;
}

export function openLibrary(options: LibraryOptions): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop library-backdrop';
  backdrop.innerHTML = `
    <div class="library-modal" role="dialog" aria-modal="true" aria-label="素材库">
      <header class="library-head">
        <div class="library-title">
          <div class="eyebrow">LIBRARY / 素材库</div>
          <h2>所有素材</h2>
        </div>
        <div class="library-tools">
          <label class="search-box">${icon('search', 15)}<input type="search" placeholder="按名称或提示词搜索" /></label>
          <button class="btn" data-act="select">${icon('check', 15)} 多选</button>
          <button class="btn" data-act="upload">${icon('upload', 15)} 放入新图片</button>
          <button class="icon-btn" data-act="close" aria-label="关闭">${icon('close', 17)}</button>
        </div>
      </header>
      <div class="library-grid"></div>
      <div class="library-bulk" hidden>
        <span class="bulk-count">选择要处理的图片</span>
        <button class="btn" data-act="all">全选</button>
        <button class="btn" data-act="none">清空选择</button>
        <span class="bulk-spacer"></span>
        ${options.onUseMany ? '<button class="btn primary" data-act="place" disabled>放入画布</button>' : ''}
        <button class="btn danger" data-act="delete" disabled>删除所选</button>
      </div>
      <footer class="library-foot"><span class="library-stat"></span><span>图片保存在本机 IndexedDB，可随项目一并导出</span></footer>
    </div>`;
  document.body.appendChild(backdrop);

  const modal = backdrop.querySelector<HTMLElement>('.library-modal')!;
  const grid = backdrop.querySelector<HTMLElement>('.library-grid')!;
  const search = backdrop.querySelector<HTMLInputElement>('.search-box input')!;
  const stat = backdrop.querySelector<HTMLElement>('.library-stat')!;
  const bulk = backdrop.querySelector<HTMLElement>('.library-bulk')!;
  const bulkCount = backdrop.querySelector<HTMLElement>('.bulk-count')!;
  const allBtn = backdrop.querySelector<HTMLButtonElement>('[data-act="all"]')!;
  const selectBtn = backdrop.querySelector<HTMLButtonElement>('[data-act="select"]')!;
  const placeBtn = backdrop.querySelector<HTMLButtonElement>('[data-act="place"]');
  const deleteBtn = backdrop.querySelector<HTMLButtonElement>('[data-act="delete"]')!;
  const picked = new Set<ID>();
  let query = '';
  let picking = false;

  const visibleAssets = (): AssetMeta[] =>
    allAssets().filter((asset) => {
      if (!query) return true;
      return `${asset.name} ${asset.prompt ?? ''} ${asset.model ?? ''}`.toLowerCase().includes(query);
    });

  const syncBulk = (): void => {
    const count = picked.size;
    bulkCount.textContent = count ? `已选 ${count} 张` : '选择要处理的图片';
    if (placeBtn) placeBtn.disabled = count === 0;
    deleteBtn.disabled = count === 0;
    const visible = visibleAssets();
    const allPicked = visible.length > 0 && visible.every((asset) => picked.has(asset.id));
    allBtn.textContent = allPicked ? '取消全选' : '全选';
    selectBtn.classList.toggle('active', picking);
    selectBtn.setAttribute('aria-pressed', String(picking));
    selectBtn.innerHTML = picking ? `${icon('close', 15)} 退出多选` : `${icon('check', 15)} 多选`;
  };

  const paintPicked = (): void => {
    grid.querySelectorAll<HTMLElement>('.asset-card').forEach((item) => {
      item.classList.toggle('picked', Boolean(item.dataset.assetId && picked.has(item.dataset.assetId)));
    });
    syncBulk();
  };

  const render = (): void => {
    const assets = visibleAssets();
    const ids = new Set(allAssets().map((asset) => asset.id));
    for (const id of [...picked]) if (!ids.has(id)) picked.delete(id);
    stat.textContent = `${allAssets().length} 张图片 · ${assets.length} 张显示`;
    modal.classList.toggle('selecting', picking);
    bulk.hidden = !picking;
    syncBulk();
    if (!assets.length) {
      grid.innerHTML = `
        <div class="library-empty">
          <div class="empty-mark">${icon('image', 28)}</div>
          <p>这里还没有图片。</p>
          <span>生成一张，或把本机图片拖进画布。</span>
        </div>`;
      return;
    }
    grid.innerHTML = '';
    assets.forEach((asset) => grid.appendChild(card(asset)));
  };

  const togglePick = (assetId: ID): void => {
    if (picked.has(assetId)) picked.delete(assetId);
    else picked.add(assetId);
    paintPicked();
  };

  const card = (asset: AssetMeta): HTMLElement => {
    const item = document.createElement('div');
    item.className = 'asset-card';
    item.dataset.assetId = asset.id;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    if (picked.has(asset.id)) item.classList.add('picked');
    const url = getAssetUrl(asset.id);
    item.innerHTML = `
      <span class="asset-check">${icon('check', 13)}</span>
      <div class="asset-thumb">${url ? `<img alt="" src="${url}" loading="lazy" />` : '<span>NO PREVIEW</span>'}</div>
      <div class="asset-body">
        <strong>${escape(asset.name)}</strong>
        <span>${asset.width}×${asset.height} · ${formatBytes(asset.size)}</span>
        <span class="asset-when">${formatWhen(asset.createdAt)}${asset.seed ? ` · S${asset.seed}` : ''}</span>
      </div>
      <span class="asset-use">放入画布 ${icon('arrow', 13)}</span>
      <button type="button" class="asset-delete" title="删除素材" aria-label="删除素材">${icon('trash', 13)}</button>`;
    item.addEventListener('click', () => {
      if (picking) {
        togglePick(asset.id);
        return;
      }
      options.onUse(asset.id);
      close();
      showToast('图片已放入画布', 'success');
    });
    item.addEventListener('keydown', (event) => {
      if (event.target !== item) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        item.click();
      }
    });
    const remove = item.querySelector<HTMLButtonElement>('.asset-delete')!;
    remove.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await options.onDelete?.(asset.id);
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
    showToast(`已放入 ${files.length} 张图片`, 'success');
  };

  const toggleSelectMode = (): void => {
    picking = !picking;
    picked.clear();
    render();
  };

  const selectAll = (): void => {
    const visible = visibleAssets();
    if (!visible.length) return;
    const allPicked = visible.every((asset) => picked.has(asset.id));
    for (const asset of visible) {
      if (allPicked) picked.delete(asset.id);
      else picked.add(asset.id);
    }
    paintPicked();
  };

  const placePicked = (): void => {
    if (!picked.size || !options.onUseMany) return;
    options.onUseMany([...picked]);
    close();
  };

  const deletePicked = async (): Promise<void> => {
    if (!picked.size) return;
    const ids = [...picked];
    const removed = options.onDeleteMany
      ? await options.onDeleteMany(ids)
      : await (async () => {
          let ok = true;
          for (const id of ids) {
            const result = await options.onDelete?.(id);
            if (result === false) ok = false;
          }
          return ok;
        })();
    if (!removed) return;
    picked.clear();
    render();
  };

  backdrop.querySelector('[data-act="close"]')?.addEventListener('click', close);
  backdrop.querySelector('[data-act="upload"]')?.addEventListener('click', upload);
  selectBtn.addEventListener('click', toggleSelectMode);
  allBtn.addEventListener('click', selectAll);
  backdrop.querySelector('[data-act="none"]')?.addEventListener('click', () => {
    picked.clear();
    paintPicked();
  });
  placeBtn?.addEventListener('click', placePicked);
  deleteBtn.addEventListener('click', () => void deletePicked());
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    render();
  });
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  const unsubscribe = subscribeAssets(render);
  onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (picking) toggleSelectMode();
      else close();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && picking) {
      event.preventDefault();
      selectAll();
    }
  };
  document.addEventListener('keydown', onKey);
  render();
  window.setTimeout(() => search.focus(), 30);
}

export interface AssetDetailOptions {
  onUse?: (assetId: ID) => void;
  onDelete?: (assetId: ID) => boolean | Promise<boolean>;
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
        <div class="detail-top"><div class="eyebrow">ASSET / 图片</div><button class="icon-btn" data-act="close" aria-label="关闭">${icon('close', 16)}</button></div>
        <h2>${escape(asset.name)}</h2>
        <dl>
          <div><dt>尺寸</dt><dd>${image ? `${image.naturalWidth} × ${image.naturalHeight}` : `${asset.width} × ${asset.height}`}</dd></div>
          <div><dt>来源</dt><dd>${asset.source === 'upload' ? '上传' : asset.model || '本机生成'}</dd></div>
          ${asset.seed ? `<div><dt>种子</dt><dd>${asset.seed}</dd></div>` : ''}
          <div><dt>时间</dt><dd>${formatWhen(asset.createdAt)}</dd></div>
        </dl>
        ${asset.prompt ? `<div class="detail-prompt"><div class="eyebrow">PROMPT</div><p>${escape(asset.prompt)}</p></div>` : ''}
        <div class="detail-actions">
          ${options.onUse ? `<button class="btn primary" data-act="use">${icon('plus', 15)} 放入画布</button>` : ''}
          ${asset.prompt ? `<button class="btn" data-act="copy">复制提示词</button>` : ''}
          ${options.onDelete ? `<button class="btn danger" data-act="delete">${icon('trash', 15)} 删除素材</button>` : ''}
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
  backdrop.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    const removed = await options.onDelete?.(asset.id);
    if (removed) close();
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
