import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Copy,
  Film,
  FolderPlus,
  Layers,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import type { ProjectMeta } from '../model/types';
import { listProjects } from '../store/db';
import {
  createBlankProject,
  deleteProjectById,
  duplicateProjectById,
  importProjectFile,
  newProjectFromTemplate,
  switchProject,
  TEMPLATES,
} from '../store/session';
import { setUI, toast } from '../store/ui';
import { formatRelativeTime } from '../lib/util';
import { useEditorState, useUIState } from './hooks';
import { emit } from './bus';

export function ProjectDashboard() {
  const ui = useUIState();
  const state = useEditorState();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'projects' | 'templates'>('projects');

  const refresh = async () => {
    const list = await listProjects();
    setProjects(list);
    setLoading(false);
  };

  useEffect(() => {
    if (ui.dashboardOpen) void refresh();
  }, [ui.dashboardOpen]);

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener('mimeo:thumbnail-updated', handler);
    return () => window.removeEventListener('mimeo:thumbnail-updated', handler);
  }, []);

  if (!ui.dashboardOpen) return null;
  const close = () => setUI({ dashboardOpen: false });

  return (
    <div className="dashboard" onPointerDown={(event) => event.stopPropagation()}>
      <div className="dashboard-inner">
        <div className="dash-mast">
          <span className="dash-stamp">M</span>
          <span className="mono">MIMEO / LOCAL PRINT STUDIO</span>
          <span className="dash-rule" />
          <span className="mono">EDITION 01 · HONG KONG</span>
        </div>
        <div className="dashboard-head">
          <div className="dashboard-title">
            <h1>作品库</h1>
            <p>原稿、印张与配方，都留在这台机器上。</p>
          </div>
          <div className="dashboard-actions">
            <button className="btn" onClick={() => setTab(tab === 'projects' ? 'templates' : 'projects')}>
              {tab === 'projects' ? <Sparkles size={12} /> : <Layers size={12} />}
              {tab === 'projects' ? '选一张版式' : '返回作品库'}
            </button>
            <button
              className="btn"
              onClick={async () => {
                await createBlankProject();
                close();
              }}
            >
              <Plus size={12} /> 新建空白
            </button>
            <button className="btn" onClick={async () => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json,application/json';
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                  await importProjectFile(file);
                  close();
                  toast('工程已导入', 'success');
                } catch (error) {
                  toast(error instanceof Error ? error.message : '导入失败', 'error');
                }
              };
              input.click();
            }}>
              <Upload size={12} /> 导入
            </button>
            <button className="dialog-close" onClick={close}>
              <X size={16} />
            </button>
          </div>
        </div>

        {tab === 'templates' ? (
          <>
            <div className="section-head">
              <h2>Formats / 版式</h2>
              <span className="line" />
            </div>
            <div className="template-grid">
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  className="template-card"
                  onClick={async () => {
                    await newProjectFromTemplate(template.id);
                    close();
                    toast(`已创建「${template.name}」`, 'success');
                  }}
                >
                  <span className={`template-preview tp-${template.id}`} aria-hidden="true">
                    {template.id === 'storyboard' ? (
                      <Film size={22} strokeWidth={1.5} />
                    ) : template.id === 'character' ? (
                      <UserRound size={22} strokeWidth={1.5} />
                    ) : template.id === 'product' ? (
                      <ShoppingBag size={22} strokeWidth={1.5} />
                    ) : (
                      <Plus size={22} strokeWidth={1.5} />
                    )}
                  </span>
                  <span className="template-body">
                    <span className="template-tag">{template.tag}</span>
                    <strong>{template.name}</strong>
                    <p>{template.description}</p>
                    <span className="template-cta">
                      使用模板 <ArrowRight size={11} />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="section-head">
              <h2>Works / 原稿</h2>
              <span className="line" />
              <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>
                {projects.length} 个原稿
              </span>
            </div>
            {loading ? (
              <div className="template-card" style={{ opacity: 0.6 }}>
                正在读取本地原稿…
              </div>
            ) : (
              <div className="project-grid">
                <button
                  className="project-card new"
                  onClick={async () => {
                    await createBlankProject();
                    close();
                  }}
                >
                  <FolderPlus size={18} />
                  新建空白原稿
                </button>
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="project-card"
                    role="button"
                    tabIndex={0}
                    onClick={async () => {
                      const ok = await switchProject(project.id);
                      if (!ok) {
                        toast('画布不存在或已被删除', 'error');
                        void refresh();
                        return;
                      }
                      close();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') (event.currentTarget as HTMLElement).click();
                    }}
                  >
                    <div className="project-cover">
                      {project.thumbnail ? (
                        <img src={project.thumbnail} alt="" />
                      ) : (
                        <>
                          <div className="cover-pattern" />
                          <div className="cover-label">{project.nodeCount} NODES</div>
                        </>
                      )}
                    </div>
                    <div className="project-body">
                      <div className="project-name">{project.name}</div>
                      <div className="project-meta">
                        <span>{formatRelativeTime(project.updatedAt)}</span>
                        <span>·</span>
                        <span>{project.nodeCount} 节点</span>
                        {project.id === state.project.id ? (
                          <span className="chip gold" style={{ height: 16, fontSize: 8.5 }}>
                            当前
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="project-card-actions">
                      <button
                        title="复制原稿"
                        onClick={async (event) => {
                          event.stopPropagation();
                          await duplicateProjectById(project.id);
                          await refresh();
                          toast('已复制原稿', 'success');
                        }}
                      >
                        <Copy size={11} />
                      </button>
                      <button
                        title="删除原稿"
                        onClick={async (event) => {
                          event.stopPropagation();
                          if (!window.confirm(`删除原稿「${project.name}」？该操作不可撤销。`)) return;
                          await deleteProjectById(project.id);
                          await refresh();
                          toast('原稿已删除', 'success');
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="dash-guide">
          <div className="section-head">
            <h2>Press Notes / 印坊手册</h2>
            <span className="line" />
            <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>
              三步走完一张作品
            </span>
          </div>
          <div className="guide-grid">
            <button
              className="guide-card"
              onClick={() => {
                close();
                emit('settings:open', { tab: 'providers' });
              }}
            >
              <span className="guide-no mono">01</span>
              <strong>接入模型</strong>
              <p>填入任意 OpenAI 兼容的图像或对话服务，Key 只留在本机。也可以先用离线样例引擎走通流程。</p>
              <span className="guide-cta mono">OPEN SETTINGS →</span>
            </button>
            <button
              className="guide-card"
              onClick={() => {
                close();
                setUI({ helpOpen: true });
              }}
            >
              <span className="guide-no mono">02</span>
              <strong>在画布上配方</strong>
              <p>提示词、参考图、生成与对话节点用连线组成工序。拖出端口即可连接，R 只跑选中的一段。</p>
              <span className="guide-cta mono">READ THE MANUAL →</span>
            </button>
            <button
              className="guide-card"
              onClick={() => {
                close();
                setUI({ contactSheetOpen: true });
              }}
            >
              <span className="guide-no mono">03</span>
              <strong>印样与交付</strong>
              <p>用印样总览检查整批画面，导出 PNG 印样、整张画布或含素材的工程文件，交给下一位创作者。</p>
              <span className="guide-cta mono">OPEN PROOF SHEET →</span>
            </button>
          </div>
        </div>

        <div className="dashboard-foot">
          <span>MIMEO · LOCAL PRINT STUDIO</span>
          <span>素材与工程保存在当前浏览器 · 建议定期导出工程文件</span>
        </div>
      </div>
    </div>
  );
}
