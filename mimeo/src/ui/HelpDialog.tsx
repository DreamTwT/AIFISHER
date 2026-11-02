import { X } from 'lucide-react';
import { setUI } from '../store/ui';
import { useUIState } from './hooks';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: '画布',
    items: [
      ['平移', '空格拖动 / 滚轮 / H'],
      ['缩放', '⌘/Ctrl + 滚轮 / 双指捏合'],
      ['适应画布 / 100%', '⌘/Ctrl + 0 / 1'],
      ['框选', '空白处拖动'],
      ['新建提示词', '双击空白处 / T'],
      ['选择 / 抓手工具', 'V / H'],
    ],
  },
  {
    title: '节点',
    items: [
      ['连接', '从右侧圆点拖到目标节点'],
      ['移动 / 多选', '拖动 / Shift 点击'],
      ['调整尺寸', '选中后拖动边角'],
      ['运行节点', 'R / 节点标题栏 ▶'],
      ['运行整张画布', 'Shift + R'],
      ['复制 / 粘贴', '⌘/Ctrl + D / C V'],
      ['分组 / 取消分组', '⌘/Ctrl + G / ⇧G'],
      ['删除', 'Delete / Backspace'],
      ['微调位置', '方向键（Shift 加速）'],
    ],
  },
  {
    title: '文件与界面',
    items: [
      ['命令面板', '⌘/Ctrl + K'],
      ['保存', '⌘/Ctrl + S（亦自动保存）'],
      ['印样总览', 'Shift + P'],
      ['导出工程', '顶栏 → 导出'],
      ['素材库', '顶栏图片图标'],
      ['属性面板', '右上角面板按钮'],
      ['关闭浮层', 'Esc'],
    ],
  },
];

export function HelpDialog() {
  const ui = useUIState();
  if (!ui.helpOpen) return null;
  return (
    <div className="overlay" onPointerDown={() => setUI({ helpOpen: false })}>
      <div className="dialog help-dialog" onPointerDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <h2>MIMEO 使用手册</h2>
          <span className="sub">节点式 AI 视觉印坊</span>
          <button className="dialog-close" onClick={() => setUI({ helpOpen: false })}>
            <X size={15} />
          </button>
        </div>
        <div className="dialog-body">
          <p className="settings-desc" style={{ marginBottom: 18 }}>
            把提示词、参考图、图像生成与对话模型连成一条印前工序。上游文本会自动拼成下游的提示词，
            上游图像会成为下游的参考图；所有结果自动保存到本机，并进入素材库。
          </p>
          <div className="help-grid">
            {GROUPS.map((group) => (
              <section key={group.title} className="help-group">
                <h3 className="settings-section-title">{group.title}</h3>
                <ul className="shortcut-list">
                  {group.items.map(([label, key]) => (
                    <li key={label}>
                      <span className="shortcut-label">{label}</span>
                      <span className="shortcut-key mono">{key}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="hint-box" style={{ marginTop: 20 }}>
            <b>一个可靠的起点：</b>提示词节点 → 图像生成节点。选中生成节点按 R 印制；
            把满意的印张连回生成节点，就是图生图迭代。
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn primary" onClick={() => setUI({ helpOpen: false })}>
            开始印制
          </button>
        </div>
      </div>
    </div>
  );
}
