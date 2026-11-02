import { Circle, CircleCheck, CircleX, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { cancelNodeRun, runNode } from '../runtime/generation';
import { clearFinishedTasks, setUI } from '../store/ui';
import { focusNode } from '../lib/insert';
import { useTasks, useUIState } from './hooks';

export function TaskCenter() {
  const ui = useUIState();
  const tasks = useTasks();
  if (!ui.taskPanelOpen) return null;
  const list = Object.values(tasks).sort((a, b) => b.startedAt - a.startedAt);

  return (
    <div className="task-panel" onPointerDown={(event) => event.stopPropagation()}>
      <div className="task-panel-head">
        <h3>任务中心</h3>
        <span className="chip">{list.length}</span>
        <span style={{ flex: 1 }} />
        <button className="hud-btn" title="清理已完成" onClick={clearFinishedTasks}>
          <Trash2 size={11} />
        </button>
        <button className="hud-btn" onClick={() => setUI({ taskPanelOpen: false })}>
          <X size={12} />
        </button>
      </div>
      <div className="task-list">
        {list.length === 0 ? (
          <div className="task-empty">还没有任务。运行生成或对话节点后，进度会显示在这里。</div>
        ) : (
          list.map((task) => (
            <div key={task.id} className="task-item">
              <span className={`task-icon ${task.status}`}>
                {task.status === 'running' || task.status === 'queued' ? (
                  <Loader2 size={12} className="spin" />
                ) : task.status === 'done' ? (
                  <CircleCheck size={12} />
                ) : task.status === 'error' ? (
                  <CircleX size={12} />
                ) : (
                  <Circle size={12} />
                )}
              </span>
              <div className="task-main">
                <div className="task-label">{task.label}</div>
                <div className="task-sub">
                  {task.status === 'running'
                    ? `${Math.round(task.progress * 100)}%`
                    : task.status === 'queued'
                      ? '排队中'
                      : task.status === 'done'
                        ? '完成'
                        : task.status === 'error'
                          ? task.error ?? '失败'
                          : '已取消'}
                </div>
                {task.status === 'running' ? (
                  <div className="task-progress">
                    <span style={{ width: `${Math.max(3, task.progress * 100)}%` }} />
                  </div>
                ) : null}
              </div>
              <div className="task-actions">
                {(task.status === 'running' || task.status === 'queued') && (
                  <button title="取消任务" onClick={() => cancelNodeRun(task.nodeId)}>
                    <X size={11} />
                  </button>
                )}
                {(task.status === 'error' || task.status === 'canceled') && (
                  <button title="重试" onClick={() => void runNode(task.nodeId)}>
                    <RotateCcw size={11} />
                  </button>
                )}
                <button
                  title="定位节点"
                  onClick={() => {
                    focusNode(task.nodeId);
                    setUI({ taskPanelOpen: false });
                  }}
                >
                  <Circle size={9} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
