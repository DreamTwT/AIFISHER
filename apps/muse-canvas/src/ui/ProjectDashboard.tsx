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
    window.addEventListener('muse:thumbnail-updated', handler);
    return () => window.removeEventListener('muse:thumbnail-updated', handler);
  }, []);

  if (!ui.dashboardOpen) return null;
  const close = () => setUI({ dashboardOpen: false });

  return (
    <div className="dashboard" onPointerDown={(event) => event.stopPropagation()}>
      <div className="dashboard-inner">
        <div className="dashboard-head">
          <div className="dashboard-title">
            <h1>画布库</h1>
            <p>本地优先 · 自动保存 · 随时导出迁移</p>
          </div>
          <div className="dashboard-actions">
            <button className="btn" onClick={() => setTab(tab === 'projects' ? 'templates' : 'projects')}>
              {tab === 'projects' ? <Sparkles size={12} /> : <Layers size={12} />}
              {tab === 'projects' ? '从模板开始' : '返回画布库'}
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
              <h2>Templates</h2>
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
              <h2>Projects</h2>
              <span className="line" />
              <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>
                {projects.length} 个画布
              </span>
            </div>
            {loading ? (
              <div className="template-card" style={{ opacity: 0.6 }}>
                正在读取本地画布…
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
                  新建空白画布
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
                        title="复制画布"
                        onClick={async (event) => {
                          event.stopPropagation();
                          await duplicateProjectById(project.id);
                          await refresh();
                          toast('已复制画布', 'success');
                        }}
                      >
                        <Copy size={11} />
                      </button>
                      <button
                        title="删除画布"
                        onClick={async (event) => {
                          event.stopPropagation();
                          if (!window.confirm(`删除画布「${project.name}」？该操作不可撤销。`)) return;
                          await deleteProjectById(project.id);
                          await refresh();
                          toast('画布已删除', 'success');
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

        <div className="dashboard-foot">
          <span>MUSE CANVAS · LOCAL FIRST</span>
          <span>素材与工程保存在当前浏览器 · 建议定期导出工程文件</span>
        </div>
      </div>
    </div>
  );
}

