import { useEffect } from 'react';
import { Copy, Download, ImagePlus, Info, X } from 'lucide-react';
import { addMediaNodeFromAsset, downloadAsset } from '../lib/mediaActions';
import { copyText, formatBytes } from '../lib/util';
import { setUI, toast } from '../store/ui';
import { useAsset, useUIState } from './hooks';

export function Lightbox() {
  const ui = useUIState();
  const lightbox = ui.lightbox;
  const { meta, url } = useAsset(lightbox?.assetId);
  const resolved = url ?? lightbox?.url;

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUI({ lightbox: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  if (!lightbox) return null;
  const close = () => setUI({ lightbox: null });

  return (
    <div className="lightbox" onPointerDown={close}>
      <div className="lightbox-stage" onPointerDown={(event) => event.stopPropagation()}>
        {resolved ? <img className="lightbox-img" src={resolved} alt={lightbox.title ?? ''} /> : null}
        <button className="lightbox-close" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <aside className="lightbox-side" onPointerDown={(event) => event.stopPropagation()}>
        <div>
          <h3>{lightbox.title ?? meta?.name ?? '素材'}</h3>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 4 }}>
            {meta ? `${meta.mime} · ${meta.width ?? '?'}×${meta.height ?? '?'} · ${formatBytes(meta.size)}` : ''}
          </div>
        </div>

        <div className="inspector-actions">
          <button
            className="btn small"
            onClick={() => {
              if (!lightbox.assetId) return;
              addMediaNodeFromAsset(lightbox.assetId);
              close();
            }}
          >
            <ImagePlus size={11} /> 插入画布
          </button>
          <button
            className="btn small"
            onClick={() => {
              if (lightbox.assetId) void downloadAsset(lightbox.assetId);
              else if (resolved) window.open(resolved, '_blank', 'noopener');
            }}
          >
            <Download size={11} /> 下载
          </button>
        </div>

        {(lightbox.prompt || meta?.prompt) && (
          <section className="inspector-section">
            <h4>提示词</h4>
            <div className="hint-box" style={{ maxHeight: 220, overflowY: 'auto', userSelect: 'text' }}>
              {lightbox.prompt ?? meta?.prompt}
            </div>
            <button
              className="btn small"
              onClick={async () => {
                await copyText((lightbox.prompt ?? meta?.prompt) || '');
                toast('提示词已复制', 'success');
              }}
            >
              <Copy size={11} /> 复制
            </button>
          </section>
        )}

        <section className="inspector-section">
          <h4>信息</h4>
          <div className="meta-list">
            <div className="row">
              <span>来源</span>
              <span>{meta?.source === 'generation' ? 'AI 生成' : meta?.source === 'url' ? '远程素材' : '本地素材'}</span>
            </div>
            {meta?.model && (
              <div className="row">
                <span>模型</span>
                <span>{meta.model}</span>
              </div>
            )}
            {meta?.seed != null && (
              <div className="row">
                <span>种子</span>
                <span>{meta.seed}</span>
              </div>
            )}
            {meta?.createdAt && (
              <div className="row">
                <span>创建</span>
                <span>{new Date(meta.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
              </div>
            )}
          </div>
        </section>

        <div className="hint-box" style={{ marginTop: 'auto' }}>
          <Info size={11} /> 双击画布上的图像也可以打开这里；Esc 关闭。
        </div>
      </aside>
    </div>
  );
}
