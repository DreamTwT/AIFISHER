import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Download,
  Lock,
  Maximize2,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Unlock,
  Ungroup,
  X,
} from 'lucide-react';
import type {
  AspectRatio,
  AudioNode,
  CanvasNode,
  ChatNode,
  GenerateNode,
  ImageNode,
  PromptNode,
  VideoNode,
} from '../model/types';
import { ASPECTS } from '../model/types';
import { collectContext } from '../model/graph';
import { getEditor } from '../store/editor';
import { listAssetEntries } from '../store/assets';
import {
  chatModelOptions,
  imageModelOptions,
  resolveChatModel,
  resolveImageModel,
} from '../store/settings';
import { setUI, toast } from '../store/ui';
import { cancelNodeRun, runNode } from '../runtime/generation';
import { copyText, downloadBlob, formatBytes, formatRelativeTime } from '../lib/util';
import { focusNode } from '../lib/insert';
import { emit } from './bus';
import { kindLabel, useAsset, useAssetVersion, useEditorState, useSettings } from './hooks';

interface InspectorProps {
  onClose: () => void;
}

export function Inspector({ onClose }: InspectorProps) {
  const state = useEditorState();
  const selection = state.selection;
  const nodes = state.project.doc.nodes.filter((n) => selection.includes(n.id));
  const single = nodes.length === 1 ? nodes[0] : null;

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <h3>{single ? kindLabel[single.kind] : '画布'}</h3>
        <span className="spacer" />
        <button className="node-head-btn" onClick={onClose} title="收起属性面板">
          <X size={13} />
        </button>
      </div>
      <div className="inspector-body">
        {single ? <NodeInspector node={single} /> : nodes.length > 1 ? <MultiInspector /> : <Overview />}
      </div>
    </aside>
  );
}

function Overview() {
  const state = useEditorState();
  useAssetVersion();
  const editor = getEditor();
  const doc = state.project.doc;
  const assets = listAssetEntries();
  const imageCount = assets.filter((a) => a.meta.mime.startsWith('image/')).length;

  return (
    <>
      <section className="inspector-section">
        <h4>工程概览</h4>
        <div className="overview-stat">
          <div className="stat-card">
            <strong>{doc.nodes.length}</strong>
            <span>节点</span>
          </div>
          <div className="stat-card">
            <strong>{doc.edges.length}</strong>
            <span>连接</span>
          </div>
          <div className="stat-card">
            <strong>{imageCount}</strong>
            <span>素材图像</span>
          </div>
          <div className="stat-card">
            <strong>{doc.nodes.filter((n) => n.kind === 'generate').length}</strong>
            <span>生成节点</span>
          </div>
        </div>
        <div className="meta-list">
          <div className="row">
            <span>创建时间</span>
            <span>{new Date(state.project.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
          <div className="row">
            <span>最后修改</span>
            <span>{formatRelativeTime(state.project.updatedAt)}</span>
          </div>
          <div className="row">
            <span>存储位置</span>
            <span>浏览器 IndexedDB</span>
          </div>
        </div>
      </section>

      <section className="inspector-section">
        <h4>节点索引</h4>
        <div className="node-list">
          {doc.nodes.length === 0 ? (
            <div className="hint-box">画布还是空的。双击空白处，或从左侧工具栏添加第一个节点。</div>
          ) : (
            [...doc.nodes]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 30)
              .map((node) => (
                <button key={node.id} className="node-list-item" onClick={() => focusNode(node.id)}>
                  <span className="kind-dot" style={{ background: accentOf(node) }} />
                  <span className="truncate" style={{ flex: 1 }}>
                    {node.title || kindLabel[node.kind]}
                  </span>
                  <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>
                    {kindLabel[node.kind]}
                  </span>
                </button>
              ))
          )}
        </div>
  </section>

      <section className="inspector-section">
        <h4>快速开始</h4>
        <div className="hint-box">
          <b>拖线</b>：从节点右侧圆点拖到另一个节点，建立输入关系。
          <br />
          <b>运行</b>：选中生成 / 对话节点后按 <span className="kbd">R</span>。
          <br />
          <b>自动保存</b>：所有改动实时写入本机，可随时关闭页面。
        </div>
        <div className="inspector-actions">
          <button className="btn small" onClick={() => emit('settings:open', { tab: 'providers' })}>
            配置模型
          </button>
          <button className="btn small" onClick={() => setUI({ assetsOpen: true })}>
            素材库
          </button>
          <button className="btn small" onClick={() => emit('palette:open', {})}>
            命令面板
          </button>
        </div>
      </section>

      <section className="inspector-section">
        <h4>画布设置</h4>
        <SettingsToggles />
      </section>
    </>
  );
}

function SettingsToggles() {
  const settings = useSettings();
  const toggle = (key: 'grid' | 'snap' | 'showMinimap' | 'autoRunOnConnect') => {
    import('../store/settings').then((mod) =>
      mod.updateSettings((prev) => ({ ...prev, [key]: !prev[key] })),
    );
  };
  return (
    <>
      <div className="toggle-row">
        <div>
          <div className="tr-label">显示网格</div>
          <div className="tr-desc">点阵背景与网格吸附</div>
        </div>
        <button className={`switch${settings.grid ? ' on' : ''}`} onClick={() => toggle('grid')} />
      </div>
      <div className="toggle-row">
        <div>
          <div className="tr-label">智能对齐</div>
          <div className="tr-desc">拖动时显示参考线并吸附</div>
        </div>
        <button className={`switch${settings.snap ? ' on' : ''}`} onClick={() => toggle('snap')} />
      </div>
      <div className="toggle-row">
        <div>
          <div className="tr-label">小地图</div>
          <div className="tr-desc">右下角鸟瞰视图</div>
        </div>
        <button className={`switch${settings.showMinimap ? ' on' : ''}`} onClick={() => toggle('showMinimap')} />
      </div>
      <div className="toggle-row">
        <div>
          <div className="tr-label">连接后自动运行</div>
          <div className="tr-desc">连线到已开启自动运行的节点时立即生成</div>
        </div>
        <button
          className={`switch${settings.autoRunOnConnect ? ' on' : ''}`}
          onClick={() => toggle('autoRunOnConnect')}
        />
      </div>
    </>
  );
}

function MultiInspector() {
  const state = useEditorState();
  const nodes = state.project.doc.nodes.filter((n) => state.selection.includes(n.id));
  const editor = getEditor();
  const bounds = nodes.length
    ? {
        x: Math.min(...nodes.map((n) => n.x)),
        y: Math.min(...nodes.map((n) => n.y)),
      }
    : { x: 0, y: 0 };
  return (
    <>
      <section className="inspector-section">
        <h4>已选择 {nodes.length} 个节点</h4>
        <div className="hint-box">
          选中范围的左上角位于 x {Math.round(bounds.x)} · y {Math.round(bounds.y)}。
          <br />
          拖动任意一个节点会一起移动；也可以使用下方对齐与分布。
        </div>
      </section>
      <section className="inspector-section">
        <h4>对齐</h4>
        <div className="inspector-grid">
          {(
            [
              ['left', '左对齐'],
              ['hcenter', '水平居中'],
              ['right', '右对齐'],
              ['top', '顶对齐'],
              ['vcenter', '垂直居中'],
              ['bottom', '底对齐'],
            ] as const
          ).map(([mode, label]) => (
            <button key={mode} className="btn small" onClick={() => editor.alignSelection(mode)}>
              {label}
            </button>
          ))}
        </div>
        <div className="inspector-actions">
          <button className="btn small" onClick={() => editor.distributeSelection('x')}>
            水平分布
          </button>
          <button className="btn small" onClick={() => editor.distributeSelection('y')}>
            垂直分布
          </button>
        </div>
      </section>
      <section className="inspector-section">
        <h4>操作</h4>
        <div className="inspector-actions">
          <button className="btn small" onClick={() => editor.groupSelection()}>
            创建分组
          </button>
          <button className="btn small" onClick={() => editor.duplicateSelection()}>
            复制
          </button>
          <button className="btn small danger" onClick={() => editor.deleteSelection()}>
            删除
          </button>
        </div>
      </section>
    </>
  );
}

function NodeInspector({ node }: { node: CanvasNode }) {
  const editor = getEditor();
  const patch = (value: Partial<CanvasNode>, label = '修改节点') =>
    editor.patchNode(node.id, value, { label });
  const edit = (value: Partial<CanvasNode>) => editor.editNode(node.id, value);

  return (
    <>
      <section className="inspector-section">
        <div className="field">
          <label>标题</label>
          <input
            className="input"
            value={node.title}
            onChange={(event) => edit({ title: event.target.value })}
            onBlur={() => editor.flushEdit()}
          />
        </div>
        <div className="meta-list">
          <div className="row">
            <span>类型</span>
            <span>{kindLabel[node.kind]}</span>
          </div>
          <div className="row">
            <span>更新时间</span>
            <span>{formatRelativeTime(node.updatedAt)}</span>
          </div>
          <div className="row">
            <span>层级 z</span>
            <span>{Math.round(node.z * 10) / 10}</span>
          </div>
        </div>
      </section>

      {node.kind === 'prompt' && <PromptFields node={node} />}
      {node.kind === 'image' && <ImageFields node={node} />}
      {node.kind === 'video' && <VideoFields node={node} />}
      {node.kind === 'audio' && <AudioFields node={node} />}
      {node.kind === 'generate' && <GenerateFields node={node} />}
      {node.kind === 'chat' && <ChatFields node={node} />}
      {node.kind === 'group' && <GroupFields node={node} />}

      <section className="inspector-section">
        <h4>位置与尺寸</h4>
        <div className="inspector-grid">
          <NumberField label="X" value={node.x} onChange={(x) => edit({ x })} onBlur={() => editor.flushEdit()} />
          <NumberField label="Y" value={node.y} onChange={(y) => edit({ y })} onBlur={() => editor.flushEdit()} />
          <NumberField
            label="宽"
            value={node.w}
            min={120}
            onChange={(w) => edit({ w })}
            onBlur={() => editor.flushEdit()}
          />
          <NumberField
            label="高"
            value={node.h}
            min={80}
            onChange={(h) => edit({ h })}
            onBlur={() => editor.flushEdit()}
          />
        </div>
      </section>

      <section className="inspector-section">
        <h4>操作</h4>
        <div className="inspector-actions">
          <button className="btn small" onClick={() => editor.duplicateSelection()}>
            <Copy size={11} /> 复制
          </button>
          <button className="btn small" onClick={() => patch({ locked: !node.locked })}>
            {node.locked ? <Unlock size={11} /> : <Lock size={11} />}
            {node.locked ? '解锁' : '锁定'}
          </button>
          <button className="btn small" onClick={() => editor.bringToFront()}>
            <ArrowUpToLine size={11} /> 置顶
          </button>
          <button className="btn small" onClick={() => editor.sendToBack()}>
            <ArrowDownToLine size={11} /> 置底
          </button>
        </div>
        <div className="inspector-actions">
          <button className="btn small danger" onClick={() => editor.deleteSelection()}>
            <Trash2 size={11} /> 删除节点
          </button>
        </div>
      </section>
    </>
  );
}

function PromptFields({ node }: { node: PromptNode }) {
  const editor = getEditor();
  return (
    <section className="inspector-section">
      <h4>提示词</h4>
      <div className="segmented">
        {(
          [
            ['prompt', '正向'],
            ['style', '风格'],
            ['negative', '负面'],
            ['note', '备注'],
          ] as const
        ).map(([role, label]) => (
          <button
            key={role}
            className={node.role === role ? 'on' : ''}
            onClick={() => editor.patchNode(node.id, { role }, { label: '切换提示词类型' })}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        className="textarea"
        style={{ minHeight: 160 }}
        value={node.text}
        onChange={(event) => editor.editNode(node.id, { text: event.target.value })}
        onBlur={() => editor.flushEdit()}
        placeholder="写下画面、风格或负面描述…"
      />
      <div className="inspector-actions">
        <button
          className="btn small"
          onClick={async () => {
            await copyText(node.text);
            toast('提示词已复制', 'success');
          }}
        >
          <Copy size={11} /> 复制
        </button>
        <span className="chip">{node.text.length} 字</span>
      </div>
    </section>
  );
}

function MediaInfo({ node }: { node: ImageNode | VideoNode | AudioNode }) {
  const { meta } = useAsset(node.assetId);
  return (
    <div className="meta-list">
      <div className="row">
        <span>文件</span>
        <span>{meta?.name ?? '—'}</span>
      </div>
      <div className="row">
        <span>格式</span>
        <span>{meta?.mime ?? '—'}</span>
      </div>
      <div className="row">
        <span>大小</span>
        <span>{meta ? formatBytes(meta.size) : '—'}</span>
      </div>
      {meta?.width && meta?.height ? (
        <div className="row">
          <span>尺寸</span>
          <span>
            {meta.width} × {meta.height}
          </span>
        </div>
      ) : null}
      {meta?.seed != null ? (
        <div className="row">
          <span>种子</span>
          <span>{meta.seed}</span>
        </div>
      ) : null}
      {meta?.model ? (
        <div className="row">
          <span>模型</span>
          <span>{meta.model}</span>
        </div>
      ) : null}
      {meta?.prompt ? (
        <div className="field" style={{ marginTop: 6 }}>
          <label>生成提示词</label>
          <div className="hint-box" style={{ maxHeight: 100, overflowY: 'auto' }}>
            {meta.prompt}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MediaPreview({ node }: { node: ImageNode | VideoNode | AudioNode }) {
  const { meta, url } = useAsset(node.assetId);
  const resolved = url ?? node.url;
  const editor = getEditor();
  if (!resolved) return <div className="hint-box">尚未选择素材。拖入文件，或在画布节点内上传。</div>;
  return (
    <>
      <div className="thumb-preview">
        {node.kind === 'image' ? (
          <img src={resolved} alt={node.title} />
        ) : node.kind === 'video' ? (
          <video src={resolved} controls preload="metadata" />
        ) : (
          <audio src={resolved} controls preload="metadata" />
        )}
      </div>
      <div className="inspector-actions">
        <button
          className="btn small"
          onClick={() =>
            emit('asset:open', {
              assetId: node.assetId,
              url: resolved,
              title: node.title,
              prompt: meta?.prompt,
            })
          }
        >
          <Maximize2 size={11} /> 查看
        </button>
        <button
          className="btn small"
          onClick={async () => {
            try {
              const blob = node.assetId
                ? await (await fetch(resolved)).blob()
                : await (await fetch(resolved)).blob();
              downloadBlob(blob, `${node.title || 'asset'}.${blob.type.split('/')[1] ?? 'bin'}`);
            } catch {
              toast('下载失败', 'error');
            }
          }}
        >
          <Download size={11} /> 下载
        </button>
        <button
          className="btn small"
          onClick={() => editor.patchNode(node.id, { assetId: undefined, url: undefined }, { label: '移除素材' })}
        >
          移除
        </button>
      </div>
      <MediaInfo node={node} />
    </>
  );
}

function ImageFields({ node }: { node: ImageNode }) {
  const editor = getEditor();
  return (
    <>
      <section className="inspector-section">
        <h4>图像</h4>
        <MediaPreview node={node} />
      </section>
      <section className="inspector-section">
        <h4>说明</h4>
        <textarea
          className="textarea"
          style={{ minHeight: 60 }}
          value={node.caption ?? ''}
          placeholder="给这张图加个注释，方便日后检索…"
          onChange={(event) => editor.editNode(node.id, { caption: event.target.value })}
          onBlur={() => editor.flushEdit()}
        />
      </section>
    </>
  );
}

function VideoFields({ node }: { node: VideoNode }) {
  const editor = getEditor();
  return (
    <>
      <section className="inspector-section">
        <h4>视频</h4>
        <MediaPreview node={node} />
      </section>
      <section className="inspector-section">
        <h4>说明</h4>
        <textarea
          className="textarea"
          style={{ minHeight: 60 }}
          value={node.caption ?? ''}
          onChange={(event) => editor.editNode(node.id, { caption: event.target.value })}
          onBlur={() => editor.flushEdit()}
        />
      </section>
    </>
  );
}

function AudioFields({ node }: { node: AudioNode }) {
  const editor = getEditor();
  return (
    <>
      <section className="inspector-section">
        <h4>音频</h4>
        <MediaPreview node={node} />
      </section>
      <section className="inspector-section">
        <h4>说明</h4>
        <textarea
          className="textarea"
          style={{ minHeight: 60 }}
          value={node.caption ?? ''}
          onChange={(event) => editor.editNode(node.id, { caption: event.target.value })}
          onBlur={() => editor.flushEdit()}
        />
      </section>
    </>
  );
}

function GenerateFields({ node }: { node: GenerateNode }) {
  const editor = getEditor();
  const settings = useSettings();
  const state = useEditorState();
  const options = imageModelOptions(settings);
  const resolved = resolveImageModel(node.model ?? settings.defaultImageModel, settings);
  const current = options.find(
    (o) => resolved && o.provider.id === resolved.provider.id && o.ref.modelId === resolved.model,
  );
  const context = collectContext(state.project.doc, node.id);
  const running = node.status === 'running' || node.status === 'queued';

  return (
    <>
      <section className="inspector-section">
        <h4>生成</h4>
        <div className="field">
          <label>提示词</label>
          <textarea
            className="textarea"
            style={{ minHeight: 100 }}
            value={node.prompt}
            placeholder="也可直接连接上游提示词节点"
            onChange={(event) => editor.editNode(node.id, { prompt: event.target.value })}
            onBlur={() => editor.flushEdit()}
          />
        </div>
        <div className="field">
          <label>负面提示词</label>
          <textarea
            className="textarea"
            style={{ minHeight: 52 }}
            value={node.negative}
            placeholder="不希望出现的内容"
            onChange={(event) => editor.editNode(node.id, { negative: event.target.value })}
            onBlur={() => editor.flushEdit()}
          />
        </div>
        <div className="inspector-actions">
          <button
            className="btn small primary"
            onClick={() => (running ? cancelNodeRun(node.id) : void runNode(node.id))}
          >
            {running ? <Square size={11} /> : <Play size={11} />}
            {running ? '停止生成' : '运行生成'}
          </button>
          <button
            className="btn small"
            onClick={() => {
              const prompt = [node.prompt, ...context.texts.map((t) => t.text)].filter(Boolean).join('\n\n');
              void copyText(prompt).then(() => toast('完整提示词已复制', 'success'));
            }}
          >
            <Copy size={11} /> 复制完整提示词
          </button>
        </div>
        <div className="meta-list">
          <div className="row">
            <span>上游输入</span>
            <span>
              {context.texts.length} 文本 · {context.images.length} 图像
            </span>
          </div>
          <div className="row">
            <span>结果</span>
            <span>{node.outputs.length} 张</span>
          </div>
          {node.elapsedMs ? (
            <div className="row">
              <span>上次耗时</span>
              <span>{(node.elapsedMs / 1000).toFixed(1)}s</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="inspector-section">
        <h4>参数</h4>
        <div className="field">
          <label>模型</label>
          <select
            className="select"
            value={current ? `${current.ref.providerId}::${current.ref.modelId}` : ''}
            onChange={(event) => {
              const [providerId, modelId] = event.target.value.split('::');
              editor.patchNode(node.id, { model: { providerId, modelId } }, { label: '切换图像模型' });
            }}
          >
            {options.length === 0 ? <option value="">请先配置图像服务</option> : null}
            {options.map((option) => (
              <option
                key={`${option.ref.providerId}::${option.ref.modelId}`}
                value={`${option.ref.providerId}::${option.ref.modelId}`}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>比例</label>
          <div className="inspector-grid">
            {ASPECTS.map((aspect) => (
              <button
                key={aspect.id}
                className={`btn small${node.aspect === aspect.id ? ' active' : ''}`}
                onClick={() => editor.patchNode(node.id, { aspect: aspect.id as AspectRatio }, { label: '切换比例' })}
              >
                {aspect.id}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>生成数量</label>
          <div className="segmented">
            {[1, 2, 3, 4].map((count) => (
              <button
                key={count}
                className={node.count === count ? 'on' : ''}
                onClick={() => editor.patchNode(node.id, { count }, { label: '设置数量' })}
              >
                {count} 张
              </button>
            ))}
          </div>
        </div>
        <div className="inspector-grid">
          <div className="field">
            <label>种子</label>
            <input
              className="input"
              type="number"
              value={node.seed ?? ''}
              placeholder="随机"
              onChange={(event) => {
                const value = event.target.value;
                editor.editNode(node.id, { seed: value === '' ? null : Number(value) });
              }}
              onBlur={() => editor.flushEdit()}
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button
              className="btn small"
              onClick={() => editor.patchNode(node.id, { seed: Math.floor(Math.random() * 999999) })}
            >
              <RefreshCw size={11} /> 随机种子
            </button>
          </div>
        </div>
        <div className="toggle-row">
          <div>
            <div className="tr-label">连接后自动运行</div>
            <div className="tr-desc">有新输入连入时立即生成</div>
          </div>
          <button
            className={`switch${node.autoRun ? ' on' : ''}`}
            onClick={() => editor.patchNode(node.id, { autoRun: !node.autoRun })}
          />
        </div>
        {node.outputs.length ? (
          <button
            className="btn small danger"
            onClick={() => editor.patchNode(node.id, { outputs: [], status: 'idle', activeOutput: 0 }, { label: '清空生成结果' })}
          >
            <Trash2 size={11} /> 清空生成结果
          </button>
        ) : null}
      </section>
    </>
  );
}

function ChatFields({ node }: { node: ChatNode }) {
  const editor = getEditor();
  const settings = useSettings();
  const options = chatModelOptions(settings);
  const resolved = resolveChatModel(node.model ?? settings.defaultChatModel, settings);
  const current = options.find(
    (o) => resolved && o.provider.id === resolved.provider.id && o.ref.modelId === resolved.model,
  );

  return (
    <section className="inspector-section">
      <h4>对话</h4>
      <div className="field">
        <label>模型</label>
        <select
          className="select"
          value={current ? `${current.ref.providerId}::${current.ref.modelId}` : ''}
          onChange={(event) => {
            const [providerId, modelId] = event.target.value.split('::');
            editor.patchNode(node.id, { model: { providerId, modelId } }, { label: '切换对话模型' });
          }}
        >
          {options.length === 0 ? <option value="">请先配置对话服务</option> : null}
          {options.map((option) => (
            <option
              key={`${option.ref.providerId}::${option.ref.modelId}`}
              value={`${option.ref.providerId}::${option.ref.modelId}`}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>系统提示词</label>
        <textarea
          className="textarea"
          style={{ minHeight: 90 }}
          value={node.system}
          onChange={(event) => editor.editNode(node.id, { system: event.target.value })}
          onBlur={() => editor.flushEdit()}
        />
      </div>
      <div className="field">
        <label>温度 {node.temperature.toFixed(1)}</label>
        <input
          className="range"
          type="range"
          min={0}
          max={1.5}
          step={0.1}
          value={node.temperature}
          onChange={(event) =>
            editor.editNode(node.id, { temperature: Number(event.target.value) })
          }
          onPointerUp={() => editor.flushEdit()}
        />
      </div>
      <div className="meta-list">
        <div className="row">
          <span>历史轮次</span>
          <span>{Math.floor(node.turns.length / 2)}</span>
        </div>
        <div className="row">
          <span>状态</span>
          <span>{node.status}</span>
        </div>
      </div>
      <div className="inspector-actions">
        <button className="btn small" onClick={() => void runNode(node.id)}>
          <Play size={11} /> 运行
        </button>
        <button
          className="btn small"
          onClick={() =>
            editor.patchNode(node.id, { turns: [], output: '', status: 'idle' }, { label: '清空对话' })
          }
        >
          清空对话
        </button>
      </div>
    </section>
  );
}

function GroupFields({ node }: { node: Extract<CanvasNode, { kind: 'group' }> }) {
  const editor = getEditor();
  const state = useEditorState();
  const members = state.project.doc.nodes.filter((n) => node.memberIds.includes(n.id));
  return (
    <section className="inspector-section">
      <h4>分组</h4>
      <div className="meta-list">
        <div className="row">
          <span>成员数</span>
          <span>{members.length}</span>
        </div>
      </div>
      <div className="node-list">
        {members.map((member) => (
          <button key={member.id} className="node-list-item" onClick={() => focusNode(member.id)}>
            <span className="kind-dot" style={{ background: accentOf(member) }} />
            <span className="truncate" style={{ flex: 1 }}>
              {member.title}
            </span>
          </button>
        ))}
      </div>
      <div className="inspector-actions">
        <button className="btn small" onClick={() => editor.select(node.memberIds)}>
          选中成员
        </button>
        <button className="btn small" onClick={() => editor.syncGroup(node.id)}>
          同步边界
        </button>
        <button className="btn small" onClick={() => editor.ungroupSelection()}>
          <Ungroup size={11} /> 取消分组
        </button>
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  onChange,
  onBlur,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
  onBlur: () => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type="number"
        value={Math.round(value)}
        min={min}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(min ? Math.max(min, next) : next);
        }}
        onBlur={onBlur}
      />
    </div>
  );
}

function accentOf(node: CanvasNode): string {
  return {
    prompt: '#e8c98a',
    image: '#7fc7ff',
    video: '#c3a1ff',
    audio: '#74d6c8',
    generate: '#f0a868',
    chat: '#8fe0b4',
    group: 'rgba(232,201,138,.5)',
  }[node.kind];
}

