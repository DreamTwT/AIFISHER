import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Database,
  Info,
  KeyRound,
  Plus,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { ProviderConfig, Settings } from '../model/types';
import {
  MODEL_SUGGESTIONS,
  PROVIDER_PRESETS,
  getSettings,
  imageModelOptions,
  chatModelOptions,
  providerKindLabel,
  replaceSettings,
  resetSettings,
  updateSettings,
} from '../store/settings';
import { clearAll, estimateStorage } from '../store/db';
import { setUI, toast } from '../store/ui';
import { formatBytes } from '../lib/util';
import { verifyProvider } from '../runtime/providers';
import { useSettings, useUIState } from './hooks';

const TABS = [
  { id: 'providers', label: '模型服务', icon: Zap },
  { id: 'canvas', label: '画布与生成', icon: SlidersHorizontal },
  { id: 'data', label: '数据与存储', icon: Database },
  { id: 'about', label: '关于与快捷键', icon: Info },
];

export function SettingsDialog() {
  const ui = useUIState();
  const settings = useSettings();
  const [tab, setTab] = useState(ui.settingsTab || 'providers');

  useEffect(() => {
    if (ui.settingsOpen) setTab(ui.settingsTab || 'providers');
  }, [ui.settingsOpen, ui.settingsTab]);

  if (!ui.settingsOpen) return null;
  const close = () => setUI({ settingsOpen: false });

  return (
    <div className="overlay" onPointerDown={close}>
      <div className="settings" onPointerDown={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <Settings2 size={16} style={{ color: 'var(--gold)' }} />
          <h2>设置</h2>
          <span className="sub">仅保存在当前浏览器</span>
          <button className="dialog-close" onClick={close}>
            <X size={15} />
          </button>
        </div>
        <div className="settings-main">
          <nav className="settings-nav">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={tab === item.id ? 'on' : ''} onClick={() => setTab(item.id)}>
                  <Icon size={13} /> {item.label}
                </button>
              );
            })}
          </nav>
          <div className="settings-content">
            {tab === 'providers' && <ProvidersTab settings={settings} />}
            {tab === 'canvas' && <CanvasTab settings={settings} />}
            {tab === 'data' && <DataTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProvidersTab({ settings }: { settings: Settings }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    updateSettings((prev) => ({
      ...prev,
      providers: prev.providers.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider)),
    }));
  };

  const addPreset = (preset: Omit<ProviderConfig, 'id'>) => {
    const id = `prov_${Math.random().toString(36).slice(2, 9)}`;
    updateSettings((prev) => ({
      ...prev,
      providers: [...prev.providers, { ...preset, id }],
    }));
    setExpanded(id);
    toast(`已添加「${preset.name}」，填入 API Key 后即可使用`, 'info');
  };

  const removeProvider = (provider: ProviderConfig) => {
    if (provider.kind === 'demo') return;
    if (!window.confirm(`删除服务「${provider.name}」？已生成的内容不会受影响。`)) return;
    updateSettings((prev) => ({
      ...prev,
      providers: prev.providers.filter((p) => p.id !== provider.id),
    }));
  };

  return (
    <>
      <h3 className="settings-section-title">模型服务</h3>
      <p className="settings-desc">
        支持任意 OpenAI 兼容的图像 / 对话服务。Key 只写入本机 localStorage，不会上传；清空浏览器数据后需要重新填写。
        内置「离线样例引擎」无需 Key，可用于熟悉画布与流程调试。
        浏览器会直接请求你填写的 Base URL，请确认该服务允许跨域（CORS）；若被拦截，请填写你自己的转发地址。
      </p>

      {settings.providers.map((provider) => {
        const open = expanded === provider.id;
        return (
          <div className="provider-card" key={provider.id}>
            <div
              className="provider-card-head"
              onClick={() => setExpanded(open ? null : provider.id)}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: provider.enabled ? 'var(--green)' : 'var(--faint)',
                  flex: 'none',
                }}
              />
              <span className="provider-name">{provider.name}</span>
              <span className="provider-kind">{providerKindLabel(provider.kind)}</span>
              <span style={{ flex: 1 }} />
              {provider.apiKey && provider.kind !== 'demo' ? (
                <span className="chip gold">
                  <KeyRound size={8} /> 已配置
                </span>
              ) : null}
              <ChevronDown
                size={13}
                style={{ color: 'var(--faint)', transform: open ? 'rotate(180deg)' : undefined }}
              />
            </div>
            {open ? (
              <div className="provider-card-body">
                <div className="provider-grid">
                  <div className="field">
                    <label>名称</label>
                    <input
                      className="input"
                      value={provider.name}
                      onChange={(event) => updateProvider(provider.id, { name: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>类型</label>
                    <select
                      className="select"
                      value={provider.kind}
                      disabled={provider.kind === 'demo'}
                      onChange={(event) =>
                        updateProvider(provider.id, { kind: event.target.value as ProviderConfig['kind'] })
                      }
                    >
                      <option value="demo">离线样例引擎</option>
                      <option value="openai-image">图像生成（OpenAI 兼容）</option>
                      <option value="openai-chat">对话补全（OpenAI 兼容）</option>
                    </select>
                  </div>
                </div>
                {provider.kind !== 'demo' ? (
                  <>
                    <div className="field">
                      <label>Base URL</label>
                      <input
                        className="input mono"
                        placeholder="https://api.openai.com/v1"
                        value={provider.baseUrl}
                        onChange={(event) => updateProvider(provider.id, { baseUrl: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>API Key</label>
                      <input
                        className="input mono"
                        type="password"
                        placeholder="sk-…"
                        value={provider.apiKey}
                        onChange={(event) => updateProvider(provider.id, { apiKey: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>模型（逗号分隔）</label>
                      <input
                        className="input mono"
                        placeholder={MODEL_SUGGESTIONS[provider.kind].join(', ')}
                        value={provider.models.join(', ')}
                        onChange={(event) =>
                          updateProvider(provider.id, {
                            models: event.target.value
                              .split(',')
                              .map((m) => m.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </div>
                    <div className="toggle-row">
                      <div>
                        <div className="tr-label">支持图像理解</div>
                        <div className="tr-desc">启用后会把上游参考图作为视觉输入发送</div>
                      </div>
                      <button
                        className={`switch${provider.vision ? ' on' : ''}`}
                        onClick={() => updateProvider(provider.id, { vision: !provider.vision })}
                      />
                    </div>
                  </>
                ) : null}
                <div className="toggle-row">
                  <div>
                    <div className="tr-label">启用</div>
                    <div className="tr-desc">停用后模型不会出现在选择器中</div>
                  </div>
                  <button
                    className={`switch${provider.enabled ? ' on' : ''}`}
                    onClick={() => updateProvider(provider.id, { enabled: !provider.enabled })}
                  />
                </div>
                <div className="inspector-actions">
                  <button
                    className="btn small"
                    onClick={async () => {
                      try {
                        const message = await verifyProvider(provider);
                        toast(message, 'success');
                      } catch (error) {
                        toast(error instanceof Error ? error.message : '连接失败', 'error');
                      }
                    }}
                  >
                    <Check size={11} /> 测试连接
                  </button>
                  {provider.kind !== 'demo' ? (
                    <button className="btn small danger" onClick={() => removeProvider(provider)}>
                      <Trash2 size={11} /> 删除服务
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="preset-grid">
        {PROVIDER_PRESETS.map((preset) => (
          <button key={preset.name} className="preset-card" onClick={() => addPreset(preset)}>
            <Plus size={11} style={{ marginRight: 4 }} />
            {preset.name}
            <span>{preset.baseUrl}</span>
          </button>
        ))}
      </div>

      <div className="divider" />
      <h3 className="settings-section-title">默认模型</h3>
      <div className="provider-grid">
        <div className="field">
          <label>图像生成</label>
          <select
            className="select"
            value={
              settings.defaultImageModel
                ? `${settings.defaultImageModel.providerId}::${settings.defaultImageModel.modelId}`
                : ''
            }
            onChange={(event) => {
              const [providerId, modelId] = event.target.value.split('::');
              updateSettings((prev) => ({ ...prev, defaultImageModel: { providerId, modelId } }));
            }}
          >
            {imageModelOptions(settings).map((option) => (
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
          <label>对话</label>
          <select
            className="select"
            value={
              settings.defaultChatModel
                ? `${settings.defaultChatModel.providerId}::${settings.defaultChatModel.modelId}`
                : ''
            }
            onChange={(event) => {
              const [providerId, modelId] = event.target.value.split('::');
              updateSettings((prev) => ({ ...prev, defaultChatModel: { providerId, modelId } }));
            }}
          >
            {chatModelOptions(settings).map((option) => (
              <option
                key={`${option.ref.providerId}::${option.ref.modelId}`}
                value={`${option.ref.providerId}::${option.ref.modelId}`}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

function CanvasTab({ settings }: { settings: Settings }) {
  return (
    <>
      <h3 className="settings-section-title">画布行为</h3>
      <p className="settings-desc">这些选项会立即生效，并保存在本机。</p>
      <div className="toggle-row">
        <div>
          <div className="tr-label">点阵网格</div>
          <div className="tr-desc">绘制的网格会随缩放变化，同时用于对齐吸附</div>
        </div>
        <button
          className={`switch${settings.grid ? ' on' : ''}`}
          onClick={() => updateSettings((prev) => ({ ...prev, grid: !prev.grid }))}
        />
      </div>
      <div className="toggle-row">
        <div>
          <div className="tr-label">智能吸附</div>
          <div className="tr-desc">拖动节点时对齐到其他节点的边缘与中线，并显示参考线</div>
        </div>
        <button
          className={`switch${settings.snap ? ' on' : ''}`}
          onClick={() => updateSettings((prev) => ({ ...prev, snap: !prev.snap }))}
        />
      </div>
      <div className="toggle-row">
        <div>
          <div className="tr-label">小地图</div>
          <div className="tr-desc">右下角显示画布全貌与当前视口</div>
        </div>
        <button
          className={`switch${settings.showMinimap ? ' on' : ''}`}
          onClick={() => updateSettings((prev) => ({ ...prev, showMinimap: !prev.showMinimap }))}
        />
      </div>
      <div className="toggle-row">
        <div>
          <div className="tr-label">连线后自动运行</div>
          <div className="tr-desc">为新建的生成节点默认打开「自动运行」</div>
        </div>
        <button
          className={`switch${settings.autoRunOnConnect ? ' on' : ''}`}
          onClick={() => updateSettings((prev) => ({ ...prev, autoRunOnConnect: !prev.autoRunOnConnect }))}
        />
      </div>
      <div className="toggle-row">
        <div>
          <div className="tr-label">保留原始素材</div>
          <div className="tr-desc">关闭后，超过 2048px 的图片会压缩为 WebP 以节省空间</div>
        </div>
        <button
          className={`switch${settings.keepOriginal ? ' on' : ''}`}
          onClick={() => updateSettings((prev) => ({ ...prev, keepOriginal: !prev.keepOriginal }))}
        />
      </div>
      <div className="toggle-row">
        <div>
          <div className="tr-label">并发生成任务</div>
          <div className="tr-desc">同时运行的生成 / 对话任务上限</div>
        </div>
        <div className="inspector-row">
          <input
            className="range"
            type="range"
            min={1}
            max={4}
            value={settings.concurrency}
            onChange={(event) =>
              updateSettings((prev) => ({ ...prev, concurrency: Number(event.target.value) }))
            }
          />
          <span className="mono" style={{ width: 16, color: 'var(--text-soft)' }}>
            {settings.concurrency}
          </span>
        </div>
      </div>
    </>
  );
}

function DataTab() {
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void estimateStorage().then(setUsage);
  }, []);
  const percent = usage && usage.quota ? Math.min(100, (usage.usage / usage.quota) * 100) : 0;

  return (
    <>
      <h3 className="settings-section-title">本地存储</h3>
      <p className="settings-desc">
        工程文档、素材与设置都保存在本机浏览器（IndexedDB / localStorage）。更换浏览器或清理站点数据会丢失内容，
        建议定期导出工程。
      </p>
      <div className="provider-card">
        <div className="provider-card-body" style={{ paddingTop: 12 }}>
          <div className="inspector-row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12 }}>已使用空间</span>
            <span className="mono" style={{ fontSize: 11 }}>
              {usage ? `${formatBytes(usage.usage)} / ${formatBytes(usage.quota)}` : '统计中…'}
            </span>
          </div>
          <div className="storage-bar">
            <span style={{ width: `${Math.max(2, percent)}%` }} />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>
            浏览器通常会给每个站点数百 MB 到数 GB 的配额；素材越多占用越大。
          </div>
        </div>
      </div>
      <div className="divider" />
      <h3 className="settings-section-title">维护</h3>
      <div className="inspector-actions">
        <button
          className="btn small"
          onClick={() => {
            resetSettings();
            toast('设置已重置', 'success');
          }}
        >
          重置设置
        </button>
        <button
          className="btn small danger"
          onClick={async () => {
            if (!window.confirm('清空全部本地数据？所有画布、素材与设置都会消失，且无法恢复。')) return;
            await clearAll();
            replaceSettings(getSettings());
            toast('本地数据已清空，正在刷新…', 'info');
            setTimeout(() => window.location.reload(), 700);
          }}
        >
          清空全部本地数据
        </button>
      </div>
      <div className="hint-box" style={{ marginTop: 12 }}>
        当前版本没有云端同步。需要迁移时，用顶栏「导出 → 工程文件（含素材）」生成一个 JSON，再在另一台设备导入。
      </div>
    </>
  );
}

function AboutTab() {
  return (
    <>
      <h3 className="settings-section-title">MUSE 缪斯画布</h3>
      <p className="settings-desc">
        一张本地优先的节点式创作画布：把提示词、参考图、图像生成与对话模型连接起来，
        在一张无限画布上完成从灵感到成品的迭代。
      </p>
      <div className="meta-list">
        <div className="row">
          <span>版本</span>
          <span>1.0.0</span>
        </div>
        <div className="row">
          <span>数据</span>
          <span>本地优先，无账号</span>
        </div>
        <div className="row">
          <span>图像服务</span>
          <span>OpenAI 兼容 / 离线引擎</span>
        </div>
        <div className="row">
          <span>对话服务</span>
          <span>OpenAI 兼容 SSE</span>
        </div>
      </div>

      <div className="divider" />
      <h3 className="settings-section-title">快捷键</h3>
      <table className="shortcut-table">
        <tbody>
          {[
            ['命令面板', '⌘/Ctrl + K'],
            ['撤销 / 重做', '⌘/Ctrl + Z / ⇧Z'],
            ['复制 / 粘贴 / 复制节点', '⌘/Ctrl + C / V / D'],
            ['全选', '⌘/Ctrl + A'],
            ['分组 / 取消分组', '⌘/Ctrl + G / ⇧G'],
            ['运行选中节点', 'R'],
            ['运行整张画布', '⇧R'],
            ['适应画布 / 100%', '⌘/Ctrl + 0 / 1'],
            ['缩放', '⌘/Ctrl + 滚轮'],
            ['平移画布', '空格拖动 / 滚轮 / H'],
            ['删除选中', 'Delete'],
            ['新建提示词', '双击空白处 / T'],
          ].map(([label, key]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="mono">{key}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint-box" style={{ marginTop: 14 }}>
        API Key 与生成内容只属于你。图像 / 对话服务按各服务商规则计费，本工具不提供免费额度。
      </div>
    </>
  );
}
