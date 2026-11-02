import { useRef, useState } from 'react';
import {
  AudioLines,
  Download,
  Film,
  Image as ImageIcon,
  Maximize2,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { AssetMeta } from '../model/types';
import {
  addAsset,
  listAssetEntries,
  removeAsset,
} from '../store/assets';
import { getEditor } from '../store/editor';
import { getSettings } from '../store/settings';
import { setUI, toast } from '../store/ui';
import { downloadBlob, formatBytes } from '../lib/util';
import { insertNodeAtViewportCenter } from '../lib/insert';
import { emit } from './bus';
import { useAssetVersion, useUIState } from './hooks';

type Tab = 'all' | 'image' | 'video' | 'audio';

export function AssetLibrary() {
  const ui = useUIState();
  useAssetVersion();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  if (!ui.assetsOpen) return null;

  const all = listAssetEntries();
  const items = all.filter((entry) => {
    const kind = entry.meta.mime.split('/')[0];
    if (tab !== 'all' && kind !== tab) return false;
    if (query && !entry.meta.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const insert = (asset: AssetMeta) => {
    const editor = getEditor();
    const kind = asset.mime.startsWith('video/')
      ? 'video'
      : asset.mime.startsWith('audio/')
        ? 'audio'
        : 'image';
    const w = 360;
    const h =
      kind === 'image' && asset.width && asset.height
        ? Math.round(36 + Math.min(560, Math.max(160, (w * asset.height) / asset.width)))
        : kind === 'video'
          ? 300
          : 190;
    const node = insertNodeAtViewportCenter(kind, { w, h });
    editor.patchNode(node.id, { assetId: asset.id, source: 'upload' }, { label: '插入素材' });
    setUI({ assetsOpen: false });
  };

  const upload = async (files: File[]) => {
    setBusy(true);
    try {
      for (const file of files) {
        await addAsset(file, {
          name: file.name.replace(/\.[^.]+$/, ''),
          source: 'upload',
          keepOriginal: getSettings().keepOriginal,
        });
      }
      toast(`已上传 ${files.length} 个素材`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '上传失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="drawer" onPointerDown={(event) => event.stopPropagation()}>
      <div className="drawer-head">
        <ImageIcon size={14} style={{ color: 'var(--blue)' }} />
        <h3>素材库</h3>
        <span className="chip">{all.length}</span>
        <span style={{ flex: 1 }} />
        <button className="dialog-close" onClick={() => setUI({ assetsOpen: false })}>
          <X size={15} />
        </button>
      </div>

      <div className="asset-toolbar">
        <label className="asset-search">
          <Search size={12} style={{ color: 'var(--faint)' }} />
          <input
            value={query}
            placeholder="搜索素材…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="btn small" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload size={11} /> 上传
        </button>
      </div>

      <div className="asset-tabs">
        {(
          [
            ['all', '全部'],
            ['image', '图像'],
            ['video', '视频'],
            ['audio', '音频'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`asset-tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="asset-grid">
        {items.length === 0 ? (
          <div className="asset-empty">
            还没有素材。
            <br />
            拖入图片，或点击右上角上传。生成的图像也会自动归档到这里。
          </div>
        ) : (
          items.map(({ meta, url }) => (
            <div
              key={meta.id}
              className="asset-card"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-mimeo-asset', meta.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => insert(meta)}
              title={`${meta.name}\n${formatBytes(meta.size)}${meta.width ? ` · ${meta.width}×${meta.height}` : ''}`}
            >
              <div className="asset-thumb">
                {meta.mime.startsWith('image/') ? (
                  <img src={url} alt={meta.name} draggable={false} />
                ) : meta.mime.startsWith('video/') ? (
                  <Film size={22} className="file-icon" />
                ) : (
                  <AudioLines size={22} className="file-icon" />
                )}
              </div>
              <div className="asset-card-foot">
                <span>{meta.name}</span>
              </div>
              <div className="asset-card-actions">
                <button
                  title="查看"
                  onClick={(event) => {
                    event.stopPropagation();
                    emit('asset:open', { assetId: meta.id, url, title: meta.name, prompt: meta.prompt });
                  }}
                >
                  <Maximize2 size={11} />
                </button>
                <button
                  title="下载"
                  onClick={async (event) => {
                    event.stopPropagation();
                    try {
                      const blob = await fetch(url).then((r) => r.blob());
                      downloadBlob(blob, meta.name || 'asset');
                    } catch {
                      toast('下载失败', 'error');
                    }
                  }}
                >
                  <Download size={11} />
                </button>
                <button
                  title="删除素材"
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (!window.confirm('删除这个素材？引用它的节点会变为空。')) return;
                    try {
                      await removeAsset(meta.id);
                      toast('素材已删除', 'success');
                    } catch {
                      toast('删除失败', 'error');
                    }
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="drop-zone" style={{ marginBottom: 12 }}>
        拖拽素材到画布即可插入；点击卡片插入到视图中心
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        style={{ display: 'none' }}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) void upload(files);
        }}
      />
    </aside>
  );
}
