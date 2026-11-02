import { icon } from './icons';

export interface Command {
  id: string;
  title: string;
  group: string;
  keys?: string;
  hint?: string;
  run: () => void;
}

export interface CommandActions {
  newProject: () => void;
  save: () => void;
  openLibrary: () => void;
  openGuide: () => void;
  openSettings: () => void;
  exportProject: () => void;
  exportPng: () => void;
  exportContactSheet: () => void;
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  undo: () => void;
  redo: () => void;
  deleteSelection: () => void;
  duplicate: () => void;
  selectAll: () => void;
  group: () => void;
  ungroup: () => void;
  addNode: (kind: 'prompt' | 'render' | 'image' | 'weave') => void;
  runAll: () => void;
  runSelection: () => void;
  toggleInspector: () => void;
  toggleContactSheet: () => void;
  toggleGrid: () => void;
  importFlow: () => void;
}

export function buildCommands(actions: CommandActions): Command[] {
  return [
    { id: 'new', title: '新建织机', group: '工程', keys: '⌘⇧N', run: actions.newProject },
    { id: 'save', title: '保存到本机', group: '工程', keys: '⌘S', run: actions.save },
    { id: 'library', title: '打开布样库', group: '工程', keys: '⌘O', run: actions.openLibrary },
    { id: 'import', title: '导入工程 JSON', group: '工程', run: actions.importFlow },
    { id: 'export-json', title: '导出工程 JSON', group: '工程', keys: '⌘⇧E', run: actions.exportProject },
    { id: 'export-png', title: '导出整幅画布 PNG', group: '工程', run: actions.exportPng },
    { id: 'contact', title: '导出印样总览', group: '工程', run: actions.exportContactSheet },
    { id: 'add-prompt', title: '添加经线（提示词）', group: '织造', keys: 'T', run: () => actions.addNode('prompt') },
    { id: 'add-render', title: '添加纬线（生成）', group: '织造', keys: 'G', run: () => actions.addNode('render') },
    { id: 'add-image', title: '添加布样（图片）', group: '织造', keys: 'I', run: () => actions.addNode('image') },
    { id: 'add-weave', title: '添加织片（拼版）', group: '织造', keys: 'W', run: () => actions.addNode('weave') },
    { id: 'run-all', title: '织完所有纬线', group: '织造', keys: '⌘↵', run: actions.runAll },
    { id: 'run-selection', title: '织出选中的纬线', group: '织造', keys: 'R', run: actions.runSelection },
    { id: 'undo', title: '撤销', group: '编辑', keys: '⌘Z', run: actions.undo },
    { id: 'redo', title: '重做', group: '编辑', keys: '⌘⇧Z', run: actions.redo },
    { id: 'duplicate', title: '再织一份（复制）', group: '编辑', keys: '⌘D', run: actions.duplicate },
    { id: 'delete', title: '删除选中', group: '编辑', keys: 'Del', run: actions.deleteSelection },
    { id: 'select-all', title: '全选', group: '编辑', keys: '⌘A', run: actions.selectAll },
    { id: 'group', title: '编组选中节点', group: '编辑', keys: '⌘G', run: actions.group },
    { id: 'ungroup', title: '解散编组', group: '编辑', keys: '⇧⌘G', run: actions.ungroup },
    { id: 'fit', title: '适应画面', group: '视图', keys: 'F', run: actions.fit },
    { id: 'zoom-in', title: '放大', group: '视图', keys: '⌘+', run: actions.zoomIn },
    { id: 'zoom-out', title: '缩小', group: '视图', keys: '⌘−', run: actions.zoomOut },
    { id: 'inspector', title: '显示／隐藏检查器', group: '视图', keys: '⌘.', run: actions.toggleInspector },
    { id: 'sheet', title: '显示／隐藏印样总览', group: '视图', keys: 'P', run: actions.toggleContactSheet },
    { id: 'grid', title: '显示／隐藏布纹网格', group: '视图', keys: '⇧G', run: actions.toggleGrid },
    { id: 'settings', title: '设置与接口', group: '系统', keys: '⌘,', run: actions.openSettings },
    { id: 'guide', title: '织坊手册', group: '系统', keys: '?', run: actions.openGuide },
  ];
}

export function openPalette(commands: Command[]): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'palette-backdrop';
  backdrop.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div class="palette-input">
        ${icon('search', 17)}
        <input placeholder="输入命令，例如“导出”“织片”“布样”…" autocomplete="off" spellcheck="false" />
        <kbd>ESC</kbd>
      </div>
      <div class="palette-list" role="listbox"></div>
      <div class="palette-foot"><span>↑↓ 选择</span><span>↵ 执行</span><span>${commands.length} 条命令</span></div>
    </div>`;
  document.body.appendChild(backdrop);
  const input = backdrop.querySelector('input')!;
  const list = backdrop.querySelector('.palette-list')!;
  let filtered = commands;
  let cursor = 0;

  const render = (): void => {
    const query = input.value.trim().toLowerCase();
    filtered = commands.filter((command) => {
      if (!query) return true;
      return `${command.title} ${command.group} ${command.id}`.toLowerCase().includes(query);
    });
    if (cursor >= filtered.length) cursor = Math.max(0, filtered.length - 1);
    if (!filtered.length) {
      list.innerHTML = '<div class="palette-empty">没有找到命令</div>';
      return;
    }
    list.innerHTML = '';
    filtered.forEach((command, index) => {
      const row = document.createElement('button');
      row.className = `palette-row${index === cursor ? ' active' : ''}`;
      row.innerHTML = `
        <span class="palette-group">${command.group}</span>
        <span class="palette-title">${command.title}</span>
        ${command.keys ? `<kbd>${command.keys}</kbd>` : ''}`;
      row.addEventListener('mousemove', () => {
        if (cursor !== index) {
          cursor = index;
          render();
        }
      });
      row.addEventListener('click', () => {
        close();
        command.run();
      });
      list.appendChild(row);
    });
  };

  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filtered.length) return;
      cursor = (cursor + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
      render();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = filtered[cursor];
      if (command) {
        close();
        command.run();
      }
    }
  };

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  input.addEventListener('input', () => {
    cursor = 0;
    render();
  });
  document.addEventListener('keydown', onKey, true);
  render();
  window.setTimeout(() => input.focus(), 20);
}
