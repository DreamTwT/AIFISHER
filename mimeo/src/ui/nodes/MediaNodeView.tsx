import { memo, useRef, useState } from 'react';
import { Download, Maximize2, Play, Upload, Trash2, RefreshCw } from 'lucide-react';
import type { AudioNode, ImageNode, VideoNode } from '../../model/types';
import { addAsset, removeAsset } from '../../store/assets';
import { getEditor } from '../../store/editor';
import { getSettings } from '../../store/settings';
import { toast } from '../../store/ui';
import { downloadBlob, formatBytes } from '../../lib/util';
import { emit } from '../bus';
import { useAsset, useEditorState } from '../hooks';

type MediaNode = ImageNode | VideoNode | AudioNode;

async function replaceWithFile(node: MediaNode, file: File) {
  try {
    const meta = await addAsset(file, {
      name: file.name.replace(/\.[^.]+$/, ''),
      source: 'upload',
      keepOriginal: getSettings().keepOriginal,
    });
    const patch: Partial<MediaNode> = { assetId: meta.id, source: 'upload', url: undefined };
    if (meta.width && meta.height) {
      const bodyHeight = Math.min(680, Math.max(140, (node.w * meta.height) / meta.width));
      patch.h = Math.round(bodyHeight + 36);
    }
    getEditor().patchNode(node.id, patch, { label: '替换素材' });
    toast('素材已更新', 'success');
  } catch (error) {
    toast(error instanceof Error ? error.message : '素材导入失败', 'error');
  }
}

function MediaNodeViewInner({ node }: { node: MediaNode }) {
  const { meta, url } = useAsset(node.assetId);
  const { selection } = useEditorState();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = selection.includes(node.id);
  const resolvedUrl = url ?? node.url;
  const mediaType = node.kind;

  const openLightbox = () => {
    if (resolvedUrl) {
      emit('asset:open', {
        assetId: node.assetId,
        url: resolvedUrl,
        title: node.title,
        prompt: meta?.prompt,
      });
    }
  };

  const download = async () => {
    if (!resolvedUrl) return;
    try {
      const blob = await fetch(resolvedUrl).then((r) => r.blob());
      const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
      downloadBlob(blob, `${node.title || 'asset'}.${ext}`);
    } catch {
      toast('下载失败', 'error');
    }
  };

  const clear = async () => {
    const assetId = node.assetId;
    getEditor().patchNode(node.id, { assetId: undefined, url: undefined }, { label: '移除素材' });
    if (assetId) {
      try {
        await removeAsset(assetId);
      } catch {
        // 素材可能仍被其他节点引用，忽略
      }
    }
  };

  const sizeLabel = meta?.width && meta?.height ? `${meta.width}×${meta.height}` : undefined;

  return (
    <>
      <div
        className="media-wrap"
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void replaceWithFile(node, file);
        }}
        style={dragOver ? { boxShadow: 'inset 0 0 0 2px rgba(221,59,36,.75)' } : undefined}
      >
        {resolvedUrl ? (
          mediaType === 'image' ? (
            <img
              className="media-img"
              src={resolvedUrl}
              alt={node.title}
              draggable={false}
              onDoubleClick={openLightbox}
            />
          ) : mediaType === 'video' ? (
            <video
              className="media-video"
              src={resolvedUrl}
              controls
              playsInline
              preload="metadata"
              onPointerDown={(event) => event.stopPropagation()}
            />
          ) : (
            <div style={{ width: '100%' }}>
              <div className="audio-bars" aria-hidden>
                {Array.from({ length: 44 }).map((_, i) => (
                  <i
                    key={i}
                    style={{
                      height: `${18 + Math.abs(Math.sin(i * 1.7 + (node.id.length % 7))) * 70}%`,
                      opacity: 0.3 + (i % 6) / 12,
                    }}
                  />
                ))}
              </div>
              <audio
                className="media-audio"
                src={resolvedUrl}
                controls
                preload="metadata"
                onPointerDown={(event) => event.stopPropagation()}
              />
            </div>
          )
        ) : (
          <div className="media-empty">
            <span className="icon-ring">
              <Upload size={17} strokeWidth={1.6} />
            </span>
            <strong>拖入{mediaType === 'image' ? '图片' : mediaType === 'video' ? '视频' : '音频'}，或点击上传</strong>
            <span>文件保存在本机浏览器，不会上传到服务器</span>
            <button
              className="btn small"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={11} /> 选择文件
            </button>
          </div>
        )}

        {resolvedUrl && (
          <>
            <div className="media-badges">
              <span className="media-badge">
                {(meta?.mime || '').split('/')[1]?.toUpperCase() || mediaType.toUpperCase()}
              </span>
              {sizeLabel && <span className="media-badge">{sizeLabel}</span>}
            </div>
            <div className="media-actions">
              <button
                className="media-action"
                title="查看大图"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={openLightbox}
              >
                <Maximize2 size={12} />
              </button>
              <button
                className="media-action"
                title="下载"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void download()}
              >
                <Download size={12} />
              </button>
              <button
                className="media-action"
                title="替换"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => inputRef.current?.click()}
              >
                <RefreshCw size={12} />
              </button>
              <button
                className="media-action"
                title="移除素材"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void clear()}
              >
                <Trash2 size={12} />
              </button>
            </div>
            {node.caption && mediaType !== 'audio' ? (
              <div className="media-caption">
                <span className="truncate">{node.caption}</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="node-foot" style={{ borderTop: 'none', padding: '0 9px 6px', minHeight: 22 }}>
        <span className="mono" style={{ fontSize: 9 }}>
          {meta ? formatBytes(meta.size) : node.url ? '远程素材' : '未选择素材'}
        </span>
        <span style={{ flex: 1 }} />
        {selected && resolvedUrl && mediaType === 'image' ? (
          <button
            className="node-head-btn"
            style={{ width: 20, height: 18, fontSize: 9 }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openLightbox}
          >
            <Play size={9} /> 预览
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={mediaType === 'image' ? 'image/*' : mediaType === 'video' ? 'video/*' : 'audio/*'}
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void replaceWithFile(node, file);
          event.target.value = '';
        }}
      />
    </>
  );
}

export const MediaNodeView = memo(MediaNodeViewInner);
