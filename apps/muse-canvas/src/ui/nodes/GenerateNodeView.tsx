import { memo, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  Download,
  Image as ImageIcon,
  Maximize2,
  Play,
  Settings2,
  Shuffle,
  Square,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import type { AspectRatio, GenerateNode } from '../../model/types';
import { ASPECTS } from '../../model/types';
import { collectContext } from '../../model/graph';
import { getEditor } from '../../store/editor';
import { imageModelOptions } from '../../store/settings';
import { toast } from '../../store/ui';
import { downloadBlob, formatDuration } from '../../lib/util';
import { cancelNodeRun, runGenerateNode } from '../../runtime/generation';
import { emit } from '../bus';
import { useAsset, useEditorState, useSettings } from '../hooks';

const RATIO: Record<AspectRatio, string> = {
  '1:1': '1 / 1',
  '4:5': '4 / 5',
  '3:4': '3 / 4',
  '2:3': '2 / 3',
  '16:9': '16 / 9',
  '9:16': '9 / 16',
  '3:2': '3 / 2',
  '21:9': '21 / 9',
};

function GenerateNodeViewInner({ node }: { node: GenerateNode }) {
  const { project, selection } = useEditorState();
  const settings = useSettings();
  const context = useMemo(() => collectContext(project.doc, node.id), [project.doc, node.id]);
  const activeId = node.outputs[node.activeOutput] ?? node.outputs[0];
  const { meta, url } = useAsset(activeId);
  const options = useMemo(() => imageModelOptions(settings), [settings]);
  const resolvedModel = node.model ?? settings.defaultImageModel;
  const currentValue = resolvedModel ? `${resolvedModel.providerId}::${resolvedModel.modelId}` : '';
  const currentOption =
    options.find((o) => `${o.ref.providerId}::${o.ref.modelId}` === currentValue) ??
    options.find((o) => o.provider.id === resolvedModel?.providerId) ??
    options[0];
  const running = node.status === 'running' || node.status === 'queued';
  const selected = selection.includes(node.id);
  const stageRef = useRef<HTMLDivElement>(null);

  const run = () => {
    if (running) {
      cancelNodeRun(node.id);
      return;
    }
    void runGenerateNode(node.id);
  };

  const download = async () => {
    if (!url) return;
    try {
      const blob = await fetch(url).then((r) => r.blob());
      downloadBlob(blob, `${node.title || 'generation'}.webp`);
    } catch {
      toast('下载失败', 'error');
    }
  };

  const patch = (value: Partial<GenerateNode>, label = '调整生成参数') => {
    getEditor().patchNode(node.id, value as never, { label });
  };

  const changeModel = (value: string) => {
    const [providerId, modelId] = value.split('::');
    if (!providerId || !modelId) return;
    patch({ model: { providerId, modelId } }, '切换模型');
  };

  return (
    <>
      <textarea
        className="gen-prompt"
        value={node.prompt}
        placeholder={
          context.texts.length
            ? '可补充你自己的描述；留空则直接使用连线上游文本'
            : '描述画面；或从左侧连接提示词节点'
        }
        spellCheck={false}
        onChange={(event) => getEditor().editNode(node.id, { prompt: event.target.value })}
        onBlur={() => getEditor().flushEdit()}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (!selected) getEditor().select(node.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') (event.target as HTMLTextAreaElement).blur();
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            getEditor().flushEdit();
            run();
          }
        }}
      />

      <div className="gen-context">
        {context.texts.length === 0 && context.images.length === 0 ? (
          <span className="gen-context-empty">未连接输入 · 直接用上方提示词生成</span>
        ) : (
          <>
            {context.texts.slice(0, 3).map((text) => (
              <span key={text.nodeId} className="gen-context-chip" title={text.text}>
                <span className="dot" />
                {text.title}
              </span>
            ))}
            {context.images.slice(0, 3).map((image) => (
              <span key={`${image.nodeId}-img`} className="gen-context-chip" title="参考图">
                <ImageIcon size={9} /> {image.title}
              </span>
            ))}
            {context.texts.length + context.images.length > 6 ? (
              <span className="gen-context-empty">+{context.texts.length + context.images.length - 6}</span>
            ) : null}
          </>
        )}
      </div>

      <div className="gen-stage" ref={stageRef}>
        {running && (
          <>
            <div className="gen-progress">
              <span style={{ width: `${Math.max(4, Math.round(node.progress * 100))}%` }} />
            </div>
            <div className="gen-running-badge">
              <RefreshCw size={9} className="spin" />
              {node.status === 'queued' ? '排队中' : `生成中 ${Math.round(node.progress * 100)}%`}
            </div>
          </>
        )}

        {url ? (
          <div className="gen-stage-inner">
            <div className="gen-shot" style={{ ['--ratio' as string]: RATIO[node.aspect] }}>
              <img
                src={url}
                alt={node.title}
                draggable={false}
                onDoubleClick={() =>
                  emit('asset:open', {
                    assetId: activeId,
                    url,
                    title: node.title,
                    prompt: meta?.prompt,
                  })
                }
              />
              <div className="media-actions">
                <button
                  className="media-action"
                  title="查看大图"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() =>
                    emit('asset:open', {
                      assetId: activeId,
                      url: url!,
                      title: node.title,
                      prompt: meta?.prompt,
                    })
                  }
                >
                  <Maximize2 size={11} />
                </button>
                <button
                  className="media-action"
                  title="下载"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => void download()}
                >
                  <Download size={11} />
                </button>
              </div>
              <div className="media-badges">
                <span className="media-badge">
                  {meta?.width && meta?.height ? `${meta.width}×${meta.height}` : node.aspect}
                </span>
                {meta?.seed != null ? (
                  <span className="media-badge">#{String(meta.seed).slice(-6)}</span>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="gen-empty">
            <span className="ring">
              <Sparkles size={18} strokeWidth={1.6} />
            </span>
            <strong>{running ? '正在生成画面' : '还没有生成结果'}</strong>
            <p>
              {running
                ? '离线样例引擎通常几秒内完成；接入在线模型后按服务商速度生成。'
                : '点击下方「运行」；也可以连上提示词与参考图后再生成。'}
            </p>
            {running ? <div className="node-skeleton" /> : null}
          </div>
        )}

        {node.status === 'error' && node.error ? (
          <div className="gen-error">
            <AlertTriangle size={12} style={{ flex: 'none', marginTop: 1 }} />
            <span style={{ flex: 1 }}>{node.error}</span>
            <button
              className="toast-action"
              style={{ color: 'var(--gold)' }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void runGenerateNode(node.id)}
            >
              重试
            </button>
          </div>
        ) : null}
      </div>

      {node.outputs.length > 1 && (
        <div className="gen-thumbs">
          {node.outputs.slice(0, 24).map((id, index) => (
            <OutputThumb
              key={id}
              assetId={id}
              active={index === node.activeOutput}
              onSelect={() => getEditor().patchNodeSilent(node.id, { activeOutput: index })}
            />
          ))}
        </div>
      )}

      <div className="gen-controls">
        <div className="gen-row">
          <select
            className="gen-mini-select"
            value={node.aspect}
            title="画面比例"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => patch({ aspect: event.target.value as AspectRatio })}
          >
            {ASPECTS.map((aspect) => (
              <option key={aspect.id} value={aspect.id}>
                {aspect.id}
              </option>
            ))}
          </select>
          <select
            className="gen-mini-select"
            value={node.count}
            title="生成数量"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => patch({ count: Number(event.target.value) })}
          >
            {[1, 2, 3, 4].map((count) => (
              <option key={count} value={count}>
                {count} 张
              </option>
            ))}
          </select>
          <span className="gen-seed" title="随机种子，留空为每次随机">
            <span style={{ opacity: 0.6 }}>seed</span>
            <input
              value={node.seed ?? ''}
              placeholder="随机"
              inputMode="numeric"
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const raw = event.target.value.replace(/[^\d]/g, '');
                patch({ seed: raw ? Number(raw) : null }, '设置种子');
              }}
            />
            <button
              title="随机种子"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => patch({ seed: Math.floor(Math.random() * 999999) }, '随机种子')}
            >
              <Shuffle size={10} />
            </button>
          </span>
          <button className={`gen-run${running ? ' stop' : ''}`} onClick={run} disabled={!options.length}>
            {running ? <Square size={11} /> : <Play size={11} fill="currentColor" />}
            {running ? '停止' : '运行'}
          </button>
        </div>
        <div className="gen-row">
          <Settings2 size={10} style={{ color: 'var(--faint)' }} />
          {options.length ? (
            <select
              className="gen-mini-select"
              style={{ maxWidth: 190, flex: 1 }}
              value={currentOption ? `${currentOption.ref.providerId}::${currentOption.ref.modelId}` : ''}
              title="生成模型"
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => changeModel(event.target.value)}
            >
              {options.map((option) => (
                <option key={`${option.ref.providerId}::${option.ref.modelId}`} value={`${option.ref.providerId}::${option.ref.modelId}`}>
                  {option.ref.modelId}
                </option>
              ))}
            </select>
          ) : (
            <button
              className="gen-mini-select"
              style={{ flex: 1, textAlign: 'left', color: 'var(--gold)' }}
              onClick={() => emit('settings:open', { tab: 'providers' })}
            >
              添加模型服务…
            </button>
          )}
          <span className="gen-status">
            {node.status === 'done'
              ? `${node.outputs.length} 张${node.elapsedMs ? ` · ${formatDuration(node.elapsedMs)}` : ''}`
              : node.status === 'error'
                ? '失败'
                : node.status === 'canceled'
                  ? '已取消'
                  : currentOption?.provider.kind === 'demo'
                    ? '离线样例'
                    : '就绪'}
          </span>
        </div>
      </div>
    </>
  );
}

function OutputThumb({
  assetId,
  active,
  onSelect,
}: {
  assetId: string;
  active: boolean;
  onSelect: () => void;
}) {
  const { url } = useAsset(assetId);
  return (
    <button
      className={`gen-thumb${active ? ' on' : ''}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onSelect}
      title="切换展示结果"
    >
      {url ? <img src={url} alt="" draggable={false} /> : null}
    </button>
  );
}

export const GenerateNodeView = memo(GenerateNodeViewInner);

export function generateSummary(node: GenerateNode): string {
  return node.prompt.trim() || `${node.aspect} · ${node.count} 张`;
}

