import { useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Download, ImageOff, X } from 'lucide-react';
import { downloadDataUrl } from '../lib/exportCanvas';
import type { CanvasNode } from '../model/types';
import { getAssetMeta, getAssetUrl } from '../store/assets';
import { setUI, toast } from '../store/ui';
import { useAssetVersion, useEditorState, useUIState, kindLabel } from './hooks';

interface Plate {
  id: string;
  assetId?: string;
  url?: string;
  title: string;
  kind: CanvasNode['kind'];
  prompt?: string;
  meta?: string;
}

function stamp(): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function collectPlates(nodes: CanvasNode[]): Plate[] {
  const plates: Plate[] = [];
  for (const node of [...nodes].sort((a, b) => a.x - b.x || a.y - b.y)) {
    if (node.kind === 'image') {
      if (!node.assetId && !node.url) continue;
      const meta = getAssetMeta(node.assetId);
      plates.push({
        id: node.id,
        assetId: node.assetId,
        url: node.url,
        title: node.title,
        kind: node.kind,
        prompt: meta?.prompt ?? node.caption,
        meta: meta ? `${meta.width ?? '?'} × ${meta.height ?? '?'}` : undefined,
      });
    } else if (node.kind === 'generate') {
      node.outputs.forEach((assetId, index) => {
        const meta = getAssetMeta(assetId);
        plates.push({
          id: `${node.id}-${index}`,
          assetId,
          title: `${node.title} · ${String(index + 1).padStart(2, '0')}`,
          kind: 'generate',
          prompt: meta?.prompt ?? node.prompt,
          meta: meta ? `${meta.width ?? '?'} × ${meta.height ?? '?'}` : undefined,
        });
      });
    }
  }
  return plates;
}

export function ContactSheet() {
  const ui = useUIState();
  const { project } = useEditorState();
  useAssetVersion();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const plates = useMemo(() => collectPlates(project.doc.nodes), [project.doc.nodes]);

  if (!ui.contactSheetOpen) return null;

  const close = () => setUI({ contactSheetOpen: false });

  const exportSheet = async () => {
    const el = sheetRef.current;
    if (!el || exporting) return;
    setExporting(true);
    toast('正在装订印样…', 'info');
    try {
      const dataUrl = await toPng(el, {
        pixelRatio: 2,
        backgroundColor: '#f1e9db',
        filter: (node) => !(node instanceof HTMLElement && node.dataset.sheetHide === '1'),
      });
      const d = new Date();
      const pad = (v: number) => String(v).padStart(2, '0');
      await downloadDataUrl(
        dataUrl,
        `mimeo-contact-sheet-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`,
      );
      toast('印样 PNG 已导出', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '导出印样失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="contact-sheet" onPointerDown={close}>
      <div
        className="contact-sheet-paper"
        ref={sheetRef}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="sheet-head">
          <div className="sheet-brand">
            <span className="sheet-mark">M</span>
            <span className="mono">MIMEO / PROOF SHEET</span>
          </div>
          <div className="sheet-title">
            <h2>印样总览</h2>
            <p>
              {project.name} · 共 {plates.length} 张 · {stamp()}
            </p>
          </div>
          <div className="sheet-actions" data-sheet-hide="1">
            <button className="btn small" onClick={() => void exportSheet()} disabled={exporting}>
              <Download size={11} /> {exporting ? '装订中…' : '导出印样 PNG'}
            </button>
            <button className="btn small icon" title="关闭 ⇧P" onClick={close}>
              <X size={13} />
            </button>
          </div>
        </header>

        {plates.length ? (
          <div className="plate-grid">
            {plates.map((plate, index) => {
              const url = plate.url ?? getAssetUrl(plate.assetId);
              return (
                <button
                  key={plate.id}
                  className="plate"
                  title={plate.prompt ?? plate.title}
                  onClick={() =>
                    setUI({
                      contactSheetOpen: false,
                      lightbox: {
                        assetId: plate.assetId,
                        url: plate.url,
                        title: plate.title,
                        prompt: plate.prompt,
                      },
                    })
                  }
                >
                  <span className="plate-frame">
                    {url ? (
                      <img src={url} alt={plate.title} loading="lazy" />
                    ) : (
                      <span className="plate-missing">
                        <ImageOff size={18} />
                      </span>
                    )}
                    <span className="plate-index">{String(index + 1).padStart(2, '0')}</span>
                  </span>
                  <span className="plate-caption">
                    <span className="plate-title truncate">{plate.title}</span>
                    <span className="plate-meta mono">
                      {kindLabel[plate.kind]}
                      {plate.meta ? ` / ${plate.meta}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="sheet-empty">
            <div className="sheet-empty-mark">—</div>
            <strong>还没有可装订的印张</strong>
            <p>在画布上生成图像，或把本地素材拖进来，印样会自动按画布位置排好。</p>
            <div className="sheet-empty-keys">
              <span className="kbd">G</span> 生成图像
              <span className="kbd">T</span> 添加提示词
            </div>
          </div>
        )}

        <footer className="sheet-foot">
          <span>MIMEO · LOCAL PRINT STUDIO</span>
          <span>
            {plates.length} PLATE{plates.length === 1 ? '' : 'S'} / 2× PROOF
          </span>
        </footer>

        <span className="crop-mark tl" />
        <span className="crop-mark tr" />
        <span className="crop-mark bl" />
        <span className="crop-mark br" />
      </div>
    </div>
  );
}
