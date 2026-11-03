import { addAsset, allAssets, assetsVersion, getAssetMeta, getAssetUrl, hydrateAssets, subscribeAssets } from '../core/assets';
import { listProjects, putProject, removeProject } from '../core/db';
import { Editor } from '../core/editor';
import { contentBounds, rectsOverlap } from '../core/geometry';
import { starterProject, STARTER_SAMPLE_PROMPT } from '../core/factory';
import { hasLiveProvider, settings, subscribeSettings } from '../core/settings';
import { NODE_LABEL, NODE_SIZE, type ID, type NodeKind, type Project } from '../core/types';
import { formatWhen, isTextTarget } from '../core/util';
import { renderSample } from '../runtime/demo';
import { exportCanvas, exportProject, exportWeave, importProject } from '../runtime/export';
import { cancelRender, runAll, runRender, runSelection } from '../runtime/runner';
import { buildCommands, openPalette, type Command } from './commands';
import { openContactSheet } from './contactsheet';
import { pickFiles } from './files';
import { openGuide } from './guide';
import { icon } from './icons';
import { renderInspector } from './inspector';
import { openAssetDetail, openLibrary } from './library';
import { openSettings } from './settings';
import { showToast } from './toast';
import { Viewport } from './viewport';
import './../styles/app.css';

export async function startApp(): Promise<void> {
  const app = new App();
  await app.mount();
}

class App {
  private editor = new Editor();
  private viewport!: Viewport;
  private projects: Project[] = [];
  private lastSignature = '';
  private lastAssetVersion = -1;
  private lastSaved = 0;
  private saveTimer = 0;
  private sheetOpen = false;
  private inspectorOpen = true;
  private started = false;
  private minimapRaf = 0;

  private stage!: HTMLElement;
  private inspectorHost!: HTMLElement;
  private filmstrip!: HTMLElement;
  private minimap!: HTMLCanvasElement;
  private projectNameEl!: HTMLElement;
  private providerEl!: HTMLElement;
  private providerLabel!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private zoomLabel!: HTMLElement;
  private statusLeft!: HTMLElement;
  private statusMiddle!: HTMLElement;
  private savedLabel!: HTMLElement;
  private emptyEl!: HTMLElement;
  private composerEl!: HTMLElement;
  private composerInput!: HTMLTextAreaElement;
  private composerKind!: HTMLElement;
  private composerName!: HTMLElement;
  private composerCount!: HTMLElement;
  private composerRun!: HTMLButtonElement;
  private composerNodeId: ID | null = null;
  private composerDismissedFor: ID | null = null;
  private composerSelectionKey = '';
  private composerStartValue = '';
  private appEl!: HTMLElement;
  private commands: Command[] = [];

  async mount(): Promise<void> {
    await hydrateAssets();
    this.projects = await listProjects();
    const current = this.projects[0];
    if (current) {
      this.editor = new Editor(current);
    } else {
      this.editor = new Editor(starterProject());
    }

    this.buildShell();
    this.appEl = document.querySelector('.app') as HTMLElement;
    this.composerEl = this.appEl.querySelector('.composer') as HTMLElement;
    this.composerInput = this.appEl.querySelector('.composer-input') as HTMLTextAreaElement;
    this.composerKind = this.appEl.querySelector('.composer-kind') as HTMLElement;
    this.composerName = this.appEl.querySelector('.composer-name') as HTMLElement;
    this.composerCount = this.appEl.querySelector('.composer-count') as HTMLElement;
    this.composerRun = this.appEl.querySelector('.composer-run') as HTMLButtonElement;

    this.viewport = new Viewport(this.stage, this.editor, {
      onChange: () => this.syncUI(),
      onToast: showToast,
      onOpenImage: (assetId) => this.openAsset(assetId),
      onPickImage: (nodeId) => void this.pickImageFor(nodeId),
      onEditText: (node) => this.focusComposer(node.id),
      onInteractionEnd: () => this.rebuildInspector(),
    });

    this.bindEvents();
    this.commands = buildCommands({
      newProject: () => void this.newProject(),
      save: () => void this.saveNow(),
      openLibrary: () => this.openLibrary(),
      openGuide,
      openSettings: () => openSettings({ onSaved: () => this.syncUI() }),
      exportProject: () => void this.exportProject(),
      exportPng: () => this.exportPng(),
      exportContactSheet: () => void this.openProof(),
      fit: () => this.viewport.fit(),
      zoomIn: () => this.viewport.zoomAt(1.2),
      zoomOut: () => this.viewport.zoomAt(1 / 1.2),
      undo: () => this.doUndo(),
      redo: () => this.doRedo(),
      deleteSelection: () => this.editor.deleteSelection(),
      duplicate: () => this.editor.duplicateSelection(),
      selectAll: () => this.editor.selectAll(),
      group: () => this.groupSelection(),
      ungroup: () => this.ungroupSelection(),
      addNode: (kind) => this.addNode(kind),
      runAll: () => void this.runAll(),
      runSelection: () => void this.runSelection(),
      toggleInspector: () => this.toggleInspector(),
      toggleContactSheet: () => this.toggleFilmstrip(),
      toggleGrid: () => {
        this.viewport.toggleGrid();
      },
      importFlow: () => void this.importFlow(),
    });

    this.editor.subscribe(() => {
      this.syncUI();
      this.scheduleSave();
    });
    subscribeAssets(() => {
      this.renderFilmstrip();
      this.syncUI();
    });
    subscribeSettings(() => this.syncUI());

    if (!current) {
      this.editor.project.camera = { x: 0, y: 0, z: 0 };
      this.viewport.fit();
      void this.seedStarterSample();
    } else if (current.camera.z > 0) {
      const rect = this.stage.getBoundingClientRect();
      if (rect.width > 10) this.viewport.resize();
    }
    if (!current || !current.camera.z) this.viewport.fit();
    if (!current) this.mobileFocus();

    this.started = true;
    this.lastSaved = Date.now();
    this.syncUI();
    this.renderFilmstrip();
    this.scheduleSave();

    window.addEventListener('beforeunload', () => {
      if (this.editor.dirty) void putProject(this.editor.project);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.editor.dirty) void putProject(this.editor.project);
    });
  }

  private buildShell(): void {
    const root = document.createElement('div');
    root.className = 'app';
    root.innerHTML = `
      <header class="topbar">
        <div class="brand" title="PRISM · 本机优先的 AI 图像工作台">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 28 28"><path d="M14 3.5 25.5 22.5H2.5Z" stroke="currentColor" stroke-width="1.35" fill="none"/><path d="M1 14h9" stroke="currentColor" stroke-width="1.1"/><path d="m12 14 4.2-3.2M12 14h5.6M12 14l4.2 3.2" stroke="currentColor" stroke-width="1" opacity=".66"/></svg>
          </span>
          <span class="brand-word">PRISM<i>AI STUDIO</i></span>
        </div>
        <button class="project-chip" data-act="projects" title="切换或重命名项目">
          <span class="project-dot"></span>
          <span class="project-name"></span>
          ${icon('chevron', 12)}
        </button>
        <span class="topbar-divider"></span>
        <button class="icon-btn" data-act="undo" title="撤销 ⌘Z" disabled>${icon('undo', 16)}</button>
        <button class="icon-btn" data-act="redo" title="重做 ⌘⇧Z" disabled>${icon('redo', 16)}</button>
        <div class="topbar-spacer"></div>
        <button class="loom-pill" data-act="settings" title="设置与接口">
          <span class="loom-dot"></span>
          <span class="loom-label">离线示例</span>
        </button>
        <span class="topbar-divider"></span>
        <button class="btn ghost" data-act="library">${icon('folder', 15)} <span class="hide-sm">素材库</span></button>
        <button class="btn ghost" data-act="sheet">${icon('grid', 15)} <span class="hide-sm">总览</span></button>
        <button class="btn ghost" data-act="guide">${icon('book', 15)} <span class="hide-sm">手册</span></button>
        <button class="btn primary" data-act="run-all" title="生成全部 ⌘↵">${icon('play', 14)} <span class="run-label">生成全部</span></button>
        <button class="icon-btn command-trigger" data-act="command" title="命令面板 ⌘K">${icon('command', 17)}</button>
      </header>
      <div class="workspace">
        <aside class="rail">
          <div class="rail-group">
            <button class="tool kind-prompt" data-add="prompt" data-tip="文本 · T">${icon('prompt', 17)}<span class="tool-badge">文</span></button>
            <button class="tool kind-render" data-add="render" data-tip="生成 · G">${icon('render', 17)}<span class="tool-badge">生</span></button>
            <button class="tool kind-weave" data-add="weave" data-tip="拼图 · W">${icon('weave', 17)}<span class="tool-badge">拼</span></button>
            <button class="tool kind-image" data-add="image" data-tip="图片 · I">${icon('image', 17)}<span class="tool-badge">图</span></button>
          </div>
          <div class="rail-sep"></div>
          <div class="rail-group">
            <button class="tool" data-act="fit" data-tip="适应画面 · F">${icon('fit', 17)}</button>
            <button class="tool" data-act="zoom-in" data-tip="放大">${icon('plus', 16)}</button>
            <button class="tool" data-act="zoom-out" data-tip="缩小">${icon('minus', 16)}</button>
            <button class="tool" data-act="group" data-tip="编组 · ⌘G">${icon('group', 17)}</button>
            <button class="tool" data-act="inspector" data-tip="检查器 · ⌘.">${icon('closePanel', 17)}</button>
          </div>
          <div class="rail-spacer"></div>
          <button class="tool rail-command" data-act="command" data-tip="命令面板 · ⌘K">${icon('spark', 17)}</button>
        </aside>
        <div class="stage-wrap">
          <div class="stage" id="stage"></div>
          <div class="composer" hidden>
            <div class="composer-top">
              <span class="composer-kind">文本</span>
              <strong class="composer-name"></strong>
              <span class="composer-count"></span>
              <button class="icon-btn composer-close" data-act="composer-close" title="收起输入区" aria-label="收起输入区">${icon('chevron', 14)}</button>
            </div>
            <textarea class="composer-input" rows="2" spellcheck="false" placeholder="写下画面、风格与光线…"></textarea>
            <div class="composer-foot">
              <span class="composer-tip"><kbd>⌘↵</kbd> 运行 · <kbd>Esc</kbd> 收起</span>
              <button class="btn primary composer-run" data-act="composer-run">${icon('play', 13)} 开始生成</button>
            </div>
          </div>
          <div class="canvas-empty" hidden>
            <div class="empty-knot">${icon('layers', 30)}</div>
            <h2>空画布</h2>
            <p>先放一个文本节点，写下提示词。</p>
            <div>
              <button class="btn primary" data-empty="prompt">${icon('plus', 15)} 新建文本节点</button>
              <button class="btn" data-empty="library">${icon('folder', 15)} 从素材开始</button>
            </div>
          </div>
          <div class="canvas-hint"><kbd>双击</kbd> 新建文本节点 <span>·</span> <kbd>空格</kbd> 拖动 <span>·</span> <kbd>⌘</kbd> 滚轮缩放 <span>·</span> 从右侧圆点拖出连线</div>
          <div class="minimap-hit" title="小地图">
            <canvas class="minimap" width="296" height="184"></canvas>
            <button class="minimap-globe" data-act="minimap-toggle" title="收起小地图">${icon('grid', 12)}</button>
          </div>
        </div>
        <aside class="inspector" id="inspector"></aside>
      </div>
      <section class="filmstrip" hidden>
        <header class="filmstrip-head">
          <div class="filmstrip-title"><span class="eyebrow">CONTACT SHEET / 总览</span><strong>本机图片</strong></div>
          <div class="filmstrip-actions">
            <button class="btn tiny" data-act="sheet-export">${icon('download', 13)} 导出总览</button>
            <button class="icon-btn" data-act="sheet-close" aria-label="收起">${icon('chevron', 15)}</button>
          </div>
        </header>
        <div class="filmstrip-track"></div>
      </section>
      <footer class="statusbar">
        <span class="status-left"></span>
        <span class="status-middle"></span>
        <span class="status-right"><span class="zoom-readout"></span><span class="save-readout"></span></span>
      </footer>`;
    document.body.appendChild(root);
    document.body.classList.add('prism-ready');

    this.stage = root.querySelector('#stage') as HTMLElement;
    this.inspectorHost = root.querySelector('#inspector') as HTMLElement;
    this.filmstrip = root.querySelector('.filmstrip') as HTMLElement;
    this.minimap = root.querySelector('.minimap') as HTMLCanvasElement;
    this.projectNameEl = root.querySelector('.project-name') as HTMLElement;
    this.providerEl = root.querySelector('.loom-pill') as HTMLElement;
    this.providerLabel = root.querySelector('.loom-label') as HTMLElement;
    this.undoBtn = root.querySelector('[data-act="undo"]') as HTMLButtonElement;
    this.redoBtn = root.querySelector('[data-act="redo"]') as HTMLButtonElement;
    this.zoomLabel = root.querySelector('.zoom-readout') as HTMLElement;
    this.statusLeft = root.querySelector('.status-left') as HTMLElement;
    this.statusMiddle = root.querySelector('.status-middle') as HTMLElement;
    this.savedLabel = root.querySelector('.save-readout') as HTMLElement;
    this.emptyEl = root.querySelector('.canvas-empty') as HTMLElement;
    this.appEl = root;
    if (window.innerWidth <= 900) {
      this.inspectorOpen = false;
      this.appEl.classList.add('inspector-closed');
    }
  }

  private bindEvents(): void {
    document.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-act], [data-add], [data-empty]');
      if (!target) return;
      const add = target.dataset.add;
      if (add) {
        this.addNode(add as 'prompt' | 'render' | 'image' | 'weave');
        return;
      }
      const empty = target.dataset.empty;
      if (empty === 'prompt') this.addNode('prompt');
      if (empty === 'library') this.openLibrary();
      const act = target.dataset.act;
      switch (act) {
        case 'projects':
          void this.openProjects();
          break;
        case 'undo':
          this.doUndo();
          break;
        case 'redo':
          this.doRedo();
          break;
        case 'library':
          this.openLibrary();
          break;
        case 'sheet':
          this.toggleFilmstrip();
          break;
        case 'guide':
          openGuide();
          break;
        case 'settings':
          openSettings({ onSaved: () => this.syncUI() });
          break;
        case 'run-all':
          void this.runAll();
          break;
        case 'command':
          openPalette(this.commands);
          break;
        case 'fit':
          this.viewport.fit();
          break;
        case 'zoom-in':
          this.viewport.zoomAt(1.2);
          break;
        case 'zoom-out':
          this.viewport.zoomAt(1 / 1.2);
          break;
        case 'sheet-export':
          void this.openProof();
          break;
        case 'sheet-close':
          this.toggleFilmstrip(false);
          break;
        case 'minimap-toggle':
          this.stage.parentElement?.classList.toggle('minimap-off');
          break;
        case 'inspector':
          this.toggleInspector();
          break;
        case 'group':
          this.groupSelection();
          break;
        case 'composer-close':
          this.dismissComposer();
          break;
        case 'composer-run':
          this.runFromComposer();
          break;
      }
    });

    this.composerInput.addEventListener('focus', () => {
      this.composerStartValue = this.composerInput.value;
      this.editor.begin();
    });
    this.composerInput.addEventListener('input', () => this.writeComposer());
    this.composerInput.addEventListener('blur', () => {
      this.editor.end(this.composerInput.value !== this.composerStartValue);
    });
    this.composerInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.composerInput.blur();
        this.dismissComposer();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        this.runFromComposer();
        return;
      }
      event.stopPropagation();
    });

    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('prism:begin-edit', () => this.editor.begin());
    window.addEventListener('prism:end-edit', () => this.editor.end(true));
    window.addEventListener('prism:refresh-inspector', () => this.rebuildInspector());
    window.addEventListener('prism:run-node', ((event: CustomEvent<ID>) => {
      void this.runNode(event.detail);
    }) as EventListener);
    window.addEventListener('prism:add-node', ((event: CustomEvent<'prompt' | 'render' | 'image' | 'weave'>) => {
      this.addNode(event.detail);
    }) as EventListener);

    this.minimap.parentElement?.addEventListener('pointerdown', (event) => {
      if (!(event.target as HTMLElement).closest('.minimap')) return;
      event.preventDefault();
      this.jumpFromMinimap(event as PointerEvent);
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (document.querySelector('.modal-backdrop, .palette-backdrop')) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette(this.commands);
      return;
    }
    if (isTextTarget(event.target)) return;

    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.saveNow();
      return;
    }
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.doRedo();
      else this.doUndo();
      return;
    }
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.editor.selectAll();
      return;
    }
    if (mod && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.editor.duplicateSelection();
      return;
    }
    if (mod && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      if (event.shiftKey) this.ungroupSelection();
      else this.groupSelection();
      return;
    }
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      void this.runAll();
      return;
    }
    if (mod && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      this.viewport.zoomAt(1.2);
      return;
    }
    if (mod && event.key === '-') {
      event.preventDefault();
      this.viewport.zoomAt(1 / 1.2);
      return;
    }
    if (mod && event.key === '.') {
      event.preventDefault();
      this.toggleInspector();
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'e') {
      event.preventDefault();
      void this.exportProject();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.editor.selection.size || this.editor.threadSelection.size) {
        event.preventDefault();
        this.editor.deleteSelection();
      }
      return;
    }
    if (event.key === 'Escape') {
      this.editor.clearSelection();
      return;
    }
    switch (event.key.toLowerCase()) {
      case 't':
        this.addNode('prompt');
        break;
      case 'g':
        if (event.shiftKey) {
          this.viewport.toggleGrid();
        } else {
          this.addNode('render');
        }
        break;
      case 'w':
        this.addNode('weave');
        break;
      case 'i':
        this.addNode('image');
        break;
      case 'r':
        void this.runSelection();
        break;
      case 'f':
        this.viewport.fit();
        break;
      case 'p':
        if (event.shiftKey) this.toggleFilmstrip();
        else void this.openProof();
        break;
      case '?':
        openGuide();
        break;
    }
  }

  private focusComposer(nodeId: ID): void {
    const node = this.editor.node(nodeId);
    if (!node || (node.kind !== 'prompt' && node.kind !== 'render')) return;
    this.composerDismissedFor = null;
    this.editor.select([nodeId], false, true);
    this.syncComposer();
    window.setTimeout(() => {
      this.composerInput.focus();
      const end = this.composerInput.value.length;
      this.composerInput.setSelectionRange(end, end);
    }, 24);
  }

  private dismissComposer(): void {
    this.composerDismissedFor = this.composerNodeId;
    if (document.activeElement === this.composerInput) this.composerInput.blur();
    this.syncComposer();
  }

  private resizeComposer(): void {
    this.composerInput.style.height = 'auto';
    this.composerInput.style.height = `${Math.min(168, Math.max(48, this.composerInput.scrollHeight))}px`;
  }

  private writeComposer(): void {
    const node = this.composerNodeId ? this.editor.node(this.composerNodeId) : undefined;
    if (!node) return;
    const value = this.composerInput.value;
    if (node.kind === 'prompt') this.editor.updateNode(node.id, { text: value });
    else if (node.kind === 'render') this.editor.updateNode(node.id, { prompt: value });
    this.composerCount.textContent = `${value.trim().length} 字符`;
    this.resizeComposer();
    const note = this.inspectorHost.querySelector<HTMLElement>(`[data-node-note="${node.id}"]`);
    if (note) note.textContent = `提示词在画布底部输入区编辑；双击卡片可直接聚焦。当前 ${value.trim().length} 字符。`;
  }

  private runFromComposer(): void {
    const node = this.composerNodeId ? this.editor.node(this.composerNodeId) : undefined;
    if (node?.kind === 'render') void this.runNode(node.id);
    else void this.runAll();
  }

  private syncComposer(): void {
    if (!this.composerEl) return;
    const key = [...this.editor.selection].sort().join(',');
    if (key !== this.composerSelectionKey) {
      this.composerSelectionKey = key;
      this.composerDismissedFor = null;
    }
    const node =
      this.editor.selection.size === 1 ? this.editor.node([...this.editor.selection][0]) : undefined;
    const usable = node && (node.kind === 'prompt' || node.kind === 'render');
    if (!usable || this.composerDismissedFor === node.id) {
      const wasFocused = document.activeElement === this.composerInput;
      this.composerEl.hidden = true;
      this.stage.parentElement?.classList.remove('composer-open');
      this.composerNodeId = null;
      if (wasFocused) this.composerInput.blur();
      return;
    }

    const switching = this.composerNodeId !== node.id;
    const value = node.kind === 'prompt' ? node.text : node.prompt;
    this.composerNodeId = node.id;
    this.composerKind.textContent = NODE_LABEL[node.kind];
    this.composerKind.className = `composer-kind kind-${node.kind}`;
    this.composerName.textContent = node.title || NODE_LABEL[node.kind];
    this.composerInput.placeholder =
      node.kind === 'prompt' ? '写下画面、风格与光线…' : '补充一句提示词；留空则读取上游文本…';
    if (switching || document.activeElement !== this.composerInput) this.composerInput.value = value;
    this.composerCount.textContent = `${value.trim().length} 字符`;
    this.composerRun.innerHTML =
      node.kind === 'render'
        ? `${icon('play', 13)} ${node.status === 'done' ? '再生成一次' : '开始生成'}`
        : `${icon('play', 13)} 生成全部`;
    this.composerEl.hidden = false;
    this.stage.parentElement?.classList.add('composer-open');
    this.resizeComposer();
  }

  private syncUI(): void {
    if (!this.started) return;
    const nodes = this.editor.doc.nodes;
    const signature = [
      [...this.editor.selection].sort().join(','),
      [...this.editor.threadSelection].sort().join(','),
      nodes.map((node) => `${node.id}:${node.kind}:${node.kind === 'render' ? `${node.status}:${node.assetIds.length}` : node.kind === 'image' ? node.assetId ?? '' : ''}`).join('|'),
      assetsVersion(),
      this.editor.doc.threads.length,
      (this.editor.doc.groups ?? []).map((group) => `${group.id}:${group.nodeIds.join(',')}`).join('|'),
    ].join('#');
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.rebuildInspector();
    }

    this.projectNameEl.textContent = this.editor.project.name;
    this.undoBtn.disabled = !this.editor.canUndo();
    this.redoBtn.disabled = !this.editor.canRedo();
    const camera = this.editor.project.camera;
    this.zoomLabel.textContent = `${Math.round(camera.z * 100)}%`;
    this.savedLabel.textContent = this.editor.dirty ? '未保存' : this.lastSaved ? `已保存 ${new Date(this.lastSaved).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}` : '';
    this.savedLabel.classList.toggle('dirty', this.editor.dirty);
    const counts = {
      prompt: nodes.filter((node) => node.kind === 'prompt').length,
      render: nodes.filter((node) => node.kind === 'render').length,
      image: nodes.filter((node) => node.kind === 'image').length,
      weave: nodes.filter((node) => node.kind === 'weave').length,
    };
    const groupCount = (this.editor.doc.groups ?? []).length;
    this.statusLeft.innerHTML = `<span class="status-mark"></span>文本 ${counts.prompt} <i></i> 生成 ${counts.render} <i></i> 图片 ${counts.image} <i></i> 拼图 ${counts.weave} <i></i> 连线 ${this.editor.doc.threads.length}${groupCount ? ` <i></i> 编组 ${groupCount}` : ''}`;
    const selectedGroup = this.editor.selectionGroup();
    this.statusMiddle.textContent = this.editor.selection.size
      ? selectedGroup
        ? `已选编组「${selectedGroup.name}」· ${this.editor.selection.size} 个节点`
        : `已选 ${this.editor.selection.size} 个节点`
      : this.editor.threadSelection.size
        ? '已选连线 · 按退格剪断'
        : '空白处拖动框选 · 从右侧圆点拖出连线';

    const live = hasLiveProvider();
    this.providerLabel.textContent = live ? settings().model || '已连接' : '离线示例';
    this.providerEl.classList.toggle('live', live);
    this.providerEl.title = live ? `${settings().endpoint} · 点击设置` : '点击接入真实模型';

    const empty = nodes.length === 0;
    this.emptyEl.hidden = !empty;
    const minimap = this.minimap.parentElement;
    if (minimap) minimap.style.display = empty ? 'none' : '';
    if (this.sheetOpen && assetsVersion() !== this.lastAssetVersion) this.renderFilmstrip();
    this.syncComposer();
    this.drawMinimap();
  }

  private rebuildInspector(): void {
    renderInspector(this.inspectorHost, {
      editor: this.editor,
      run: (nodeId) => void this.runNode(nodeId),
      stop: (nodeId) => this.stopNode(nodeId),
      openImage: (assetId) => this.openAsset(assetId),
      pickImage: (nodeId) => void this.pickImageFor(nodeId),
      pickFromLibrary: (nodeId) => this.pickFromLibrary(nodeId),
      exportWeave: (nodeId) => void this.exportWeave(nodeId),
      openLibrary: () => this.openLibrary(),
      openContactSheet: () => void this.openProof(),
      refresh: () => this.rebuildInspector(),
      toast: showToast,
    });
    this.emptyEl.hidden = this.editor.doc.nodes.length > 0;
  }

  private groupSelection(): void {
    if (this.editor.selection.size < 2) {
      showToast('先选中两个以上节点，再编组', 'info');
      return;
    }
    if (this.editor.selectionGroup()) {
      showToast('这些节点已经在同一编组里', 'info');
      return;
    }
    this.editor.groupSelection();
    showToast(`已编组 ${this.editor.selection.size} 个节点`, 'success');
    this.rebuildInspector();
  }

  private ungroupSelection(): void {
    if (!this.editor.selection.size) {
      showToast('先选中要解散的编组', 'info');
      return;
    }
    if (!this.editor.selectionGroup()) {
      const inGroup = this.editor.selectedNodes().some((node) => this.editor.groupFor(node.id));
      if (!inGroup) {
        showToast('选中的节点不在编组里', 'info');
        return;
      }
    }
    if (this.editor.ungroupSelection()) {
      showToast('已解散编组', 'success');
      this.rebuildInspector();
    }
  }

  private doUndo(): void {
    if (this.editor.undo()) this.rebuildInspector();
  }

  private doRedo(): void {
    if (this.editor.redo()) this.rebuildInspector();
  }

  private scheduleSave(): void {
    if (!this.started) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), 650);
  }

  private async saveNow(): Promise<void> {
    if (!this.editor.dirty) {
      this.syncUI();
      return;
    }
    try {
      await putProject(this.editor.project);
      this.lastSaved = Date.now();
      this.editor.dirty = false;
      this.editor.project.updatedAt = this.lastSaved;
      this.syncUI();
    } catch (error) {
      console.warn('[prism] 保存失败', error);
      showToast('本机保存失败，建议导出 JSON 备份', 'error');
    }
  }

  private async seedStarterSample(): Promise<void> {
    const sample = this.editor.doc.nodes.find((node) => node.kind === 'image' && !node.assetId);
    const render = this.editor.doc.nodes.find((node) => node.kind === 'render' && !node.assetIds.length);
    try {
      const prompt = render ? this.editor.effectivePrompt(render.id) : STARTER_SAMPLE_PROMPT;
      const sampleBlob = sample ? await renderSample(STARTER_SAMPLE_PROMPT, '4:5', 3311, 0) : null;
      if (sampleBlob && sample) {
        const meta = await addAsset(sampleBlob, {
          name: '潮汐 · 初稿',
          prompt: STARTER_SAMPLE_PROMPT,
          seed: 3311,
          model: 'prism-sample',
        });
        this.editor.updateNode(sample.id, { assetId: meta.id, caption: '潮汐 / 第一张示例图' }, true);
      }
      if (render && render.kind === 'render') {
        const ids: ID[] = [];
        for (let index = 0; index < render.count; index += 1) {
          const blob = await renderSample(prompt, render.aspect, render.seed ?? 8128, index);
          const meta = await addAsset(blob, {
            name: `潮汐结果 · ${String(index + 1).padStart(2, '0')}`,
            prompt,
            seed: (render.seed ?? 8128) + index,
            model: 'prism-sample',
          });
          ids.push(meta.id);
        }
        this.editor.updateNode(render.id, { assetIds: ids, status: 'done', progress: 100 }, true);
      }
      this.syncUI();
    } catch (error) {
      console.warn('[prism] 初始图片失败', error);
    }
  }

  private mobileFocus(): void {
    if (window.innerWidth > 900) return;
    const focus =
      this.editor.doc.nodes.find((node) => node.kind === 'render') ??
      this.editor.doc.nodes.find((node) => node.kind === 'prompt');
    if (!focus) return;
    const rect = this.stage.getBoundingClientRect();
    const zoom = Math.max(0.35, Math.min(0.68, rect.width / (focus.w + 120)));
    this.editor.setCamera({
      z: zoom,
      x: rect.width / 2 - (focus.x + focus.w / 2) * zoom,
      y: rect.height / 2 - (focus.y + focus.h / 2) * zoom,
    });
  }

  private freeSpot(kind: NodeKind, center: { x: number; y: number }): { x: number; y: number } {
    const size = NODE_SIZE[kind];
    const base = { x: center.x - size.w / 2, y: center.y - size.h / 2 };
    const candidates: { x: number; y: number; score: number }[] = [{ ...base, score: 0 }];
    const stepX = 64;
    const stepY = 54;
    for (let ring = 1; ring <= 7; ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          candidates.push({
            x: base.x + dx * stepX,
            y: base.y + dy * stepY,
            score: Math.hypot(dx, dy) + (dx < 0 ? 2.4 : 0) + (dy < 0 ? 1.2 : 0),
          });
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const candidate of candidates) {
      const rect = { x: candidate.x, y: candidate.y, w: size.w, h: size.h };
      const clash = this.editor.doc.nodes.some((node) =>
        rectsOverlap(rect, { x: node.x, y: node.y, w: node.w, h: node.h }),
      );
      if (!clash) return candidate;
    }
    return { x: base.x + this.editor.doc.nodes.length * 24, y: base.y + this.editor.doc.nodes.length * 24 };
  }

  private addNode(kind: 'prompt' | 'render' | 'image' | 'weave'): void {
    if (kind === 'image') {
      this.openLibrary();
      return;
    }
    const selected = this.editor.selectedNodes();
    const selectedPrompts = selected.filter((node) => node.kind === 'prompt');
    const selectedRenders = selected.filter((node) => node.kind === 'render');
    const camera = this.editor.project.camera;
    const rect = this.stage.getBoundingClientRect();
    let center = {
      x: (rect.width / 2 - camera.x) / camera.z,
      y: (rect.height / 2 - camera.y) / camera.z,
    };
    const size = NODE_SIZE[kind];
    if (kind === 'render' && selectedPrompts.length) {
      const anchor = selectedPrompts[selectedPrompts.length - 1];
      center = {
        x: anchor.x + anchor.w + 52 + size.w / 2,
        y: anchor.y + anchor.h / 2,
      };
    } else if (kind === 'prompt' && selectedRenders.length) {
      const anchor = selectedRenders[selectedRenders.length - 1];
      center = {
        x: anchor.x - 52 - size.w / 2,
        y: anchor.y + anchor.h / 2,
      };
    }
    const spot = this.freeSpot(kind, center);
    this.editor.begin();
    const node = this.editor.addNode(kind, Math.round(spot.x), Math.round(spot.y), {}, false);
    if (kind === 'render') {
      selectedPrompts.forEach((prompt) => this.editor.connect(prompt.id, node.id, false));
    }
    if (kind === 'prompt') {
      selectedRenders.forEach((render) => this.editor.connect(node.id, render.id, false));
    }
    this.editor.end(true);
    this.viewport.ensureVisible(node);
    this.syncUI();
    if (kind === 'prompt') this.focusComposer(node.id);
  }

  private async runNode(nodeId: ID): Promise<void> {
    await runRender(this.editor, nodeId, { notify: showToast });
    this.syncUI();
    this.scheduleSave();
  }

  private stopNode(nodeId: ID): void {
    cancelRender(nodeId);
    this.editor.updateNode(nodeId, { status: 'idle', progress: 0 });
    showToast('已停下这个生成任务', 'info');
  }

  private async runSelection(): Promise<void> {
    await runSelection(this.editor, { notify: showToast });
    this.syncUI();
  }

  private async runAll(): Promise<void> {
    const count = this.editor.doc.nodes.filter((node) => node.kind === 'render').length;
    if (!count) {
      showToast('先放一个生成节点', 'info');
      return;
    }
    showToast(`开始生成 ${count} 个节点`, 'info');
    await runAll(this.editor, { notify: showToast });
    this.syncUI();
  }

  private openLibrary(): void {
    openLibrary({
      onUse: (assetId) => {
        const camera = this.editor.project.camera;
        const rect = this.stage.getBoundingClientRect();
        const world = {
          x: (rect.width / 2 - camera.x) / camera.z,
          y: (rect.height / 2 - camera.y) / camera.z,
        };
        const meta = getAssetMeta(assetId);
        this.editor.addNode('image', Math.round(world.x - 150), Math.round(world.y - 150), {
          assetId,
          caption: meta?.name ?? '',
          title: '图片',
        });
      },
    });
  }

  private async pickImageFor(nodeId: ID): Promise<void> {
    const files = (await pickFiles('image/*', false)).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    const file = files[0];
    const meta = await addAsset(file, { name: file.name });
    this.editor.updateNode(nodeId, { assetId: meta.id, caption: file.name }, true);
    showToast('图片已替换', 'success');
  }

  private pickFromLibrary(nodeId: ID): void {
    openLibrary({
      onUse: (assetId) => {
        const meta = getAssetMeta(assetId);
        this.editor.updateNode(nodeId, { assetId, caption: meta?.name ?? '' }, true);
      },
    });
  }

  private openAsset(assetId: ID): void {
    const meta = getAssetMeta(assetId);
    if (!meta) {
      showToast('这张图片不在本机', 'error');
      return;
    }
    openAssetDetail(meta, {
      onUse: (id) => {
        const camera = this.editor.project.camera;
        const rect = this.stage.getBoundingClientRect();
        const world = {
          x: (rect.width / 2 - camera.x) / camera.z,
          y: (rect.height / 2 - camera.y) / camera.z,
        };
        this.editor.addNode('image', Math.round(world.x - 150), Math.round(world.y - 150), {
          assetId: id,
          caption: meta.name,
          title: '图片',
        });
      },
    });
  }

  private async exportWeave(nodeId: ID): Promise<void> {
    const node = this.editor.node(nodeId);
    if (!node || node.kind !== 'weave') return;
    await exportWeave(this.editor, node);
    showToast('拼图已导出', 'success');
  }

  private async openProof(): Promise<void> {
    await openContactSheet(this.editor);
  }

  private toggleFilmstrip(force?: boolean): void {
    this.sheetOpen = force ?? !this.sheetOpen;
    this.filmstrip.hidden = !this.sheetOpen;
    if (this.sheetOpen) this.renderFilmstrip();
    this.viewport.resize();
  }

  private renderFilmstrip(): void {
    if (!this.filmstrip || this.filmstrip.hidden) return;
    const track = this.filmstrip.querySelector('.filmstrip-track') as HTMLElement;
    const assets = allAssets();
    this.lastAssetVersion = assetsVersion();
    if (!assets.length) {
      track.innerHTML = '<div class="filmstrip-empty">还没有图片。生成一张，或从素材库放入一张。</div>';
      return;
    }
    track.innerHTML = '';
    assets.forEach((asset, index) => {
      const card = document.createElement('button');
      card.className = 'proof-card';
      card.title = asset.name;
      card.innerHTML = `
        <div class="proof-thumb">${getAssetUrl(asset.id) ? `<img alt="" src="${getAssetUrl(asset.id)}" loading="lazy" />` : ''}</div>
        <div class="proof-meta"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escape(asset.name)}</strong></div>`;
      card.addEventListener('click', () => this.openAsset(asset.id));
      track.appendChild(card);
    });
  }

  private toggleInspector(): void {
    this.inspectorOpen = !this.inspectorOpen;
    this.appEl.classList.toggle('inspector-closed', !this.inspectorOpen);
    this.emptyEl.hidden = this.editor.doc.nodes.length > 0;
    window.setTimeout(() => this.viewport.resize(), 180);
  }

  private async newProject(): Promise<void> {
    if (this.editor.dirty) await this.saveNow();
    this.editor.newProject();
    this.projects = await listProjects();
    this.viewport.fit();
    this.lastSignature = '';
    this.syncUI();
    this.scheduleSave();
    showToast('新项目已就绪', 'info');
  }

  private async exportProject(): Promise<void> {
    await exportProject(this.editor);
    showToast('项目 JSON 已导出（含图片）', 'success');
  }

  private exportPng(): void {
    exportCanvas(this.editor, this.viewport.size);
    showToast('整幅画布正在导出', 'info');
  }

  private async importFlow(): Promise<void> {
    const files = await pickFiles('application/json,.json', false);
    if (!files.length) return;
    try {
      await importProject(this.editor, files[0]);
      this.editor.dirty = true;
      this.viewport.fit();
      await this.saveNow();
      this.lastSignature = '';
      this.syncUI();
      showToast('项目已导入', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入失败', 'error');
    }
  }

  private async openProjects(): Promise<void> {
    this.projects = await listProjects();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop projects-backdrop';
    const rows = this.projects
      .map((project) => {
        const nodes = project.doc.nodes.length;
        const current = project.id === this.editor.project.id;
        return `
          <div class="project-row${current ? ' current' : ''}" data-id="${project.id}">
            <div class="project-swatch">${icon('layers', 18)}</div>
            <div class="project-main">
              <strong>${escape(project.name)}</strong>
              <span>${nodes} 个节点 · ${project.doc.threads.length} 条连线 · ${formatWhen(project.updatedAt)}</span>
            </div>
            ${current ? '<span class="current-badge">当前</span>' : ''}
            <button class="icon-btn row-delete" data-delete="${project.id}" aria-label="删除项目">${icon('trash', 15)}</button>
          </div>`;
      })
      .join('');
    backdrop.innerHTML = `
      <div class="projects-modal" role="dialog" aria-modal="true" aria-label="项目">
        <header>
          <div><div class="eyebrow">PROJECTS / 本机项目</div><h2>项目</h2></div>
          <button class="icon-btn" data-act="close" aria-label="关闭">${icon('close', 17)}</button>
        </header>
        <div class="project-rename">
          <label>当前项目名称</label>
          <input class="text-input" value="${escapeAttr(this.editor.project.name)}" maxlength="60" />
        </div>
        <div class="project-list">${rows || '<div class="project-empty">还没有保存过的项目。</div>'}</div>
        <footer>
          <button class="btn" data-act="import">${icon('upload', 14)} 导入 JSON</button>
          <button class="btn primary" data-act="new">${icon('plus', 14)} 新建项目</button>
        </footer>
      </div>`;
    document.body.appendChild(backdrop);
    const nameInput = backdrop.querySelector<HTMLInputElement>('.project-rename input')!;
    nameInput.addEventListener('change', () => {
      this.editor.setProjectName(nameInput.value);
      this.scheduleSave();
    });
    backdrop.querySelector('[data-act="close"]')?.addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('[data-act="new"]')?.addEventListener('click', () => {
      backdrop.remove();
      void this.newProject();
    });
    backdrop.querySelector('[data-act="import"]')?.addEventListener('click', () => {
      backdrop.remove();
      void this.importFlow();
    });
    backdrop.querySelectorAll<HTMLElement>('.project-row').forEach((row) => {
      row.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('.row-delete')) return;
        const id = row.dataset.id;
        const project = this.projects.find((item) => item.id === id);
        if (!project) return;
        backdrop.remove();
        void this.loadProject(project);
      });
    });
    backdrop.querySelectorAll<HTMLElement>('.row-delete').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = button.dataset.delete;
        if (!id) return;
        if (!window.confirm('删除这个项目？本机上的项目会消失，素材库不受影响。')) return;
        await removeProject(id);
        if (id === this.editor.project.id) {
          this.editor.newProject();
          this.viewport.fit();
        }
        this.projects = await listProjects();
        backdrop.remove();
        void this.openProjects();
        this.syncUI();
      });
    });
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) backdrop.remove();
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    };
    document.addEventListener('keydown', onKey);
  }

  private async loadProject(project: Project): Promise<void> {
    if (this.editor.dirty) await this.saveNow();
    this.editor.load(project);
    if (project.camera.z > 0) {
      this.editor.setCamera(project.camera);
      this.viewport.resize();
    } else {
      this.viewport.fit();
    }
    this.lastSignature = '';
    this.syncUI();
    showToast(`已打开「${project.name}」`, 'success');
  }

  private drawMinimap(): void {
    if (this.minimapRaf) return;
    this.minimapRaf = requestAnimationFrame(() => {
      this.minimapRaf = 0;
      const canvas = this.minimap;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(rect.width * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(9, 16, 13, 0.92)';
      ctx.fillRect(0, 0, w, h);
      const bounds = contentBounds(this.editor.doc.nodes);
      const pad = 14;
      const scale = Math.min((w - pad * 2) / Math.max(1, bounds.w), (h - pad * 2) / Math.max(1, bounds.h));
      const ox = pad + ((w - pad * 2) - bounds.w * scale) / 2;
      const oy = pad + ((h - pad * 2) - bounds.h * scale) / 2;
      for (const node of this.editor.doc.nodes) {
        ctx.fillStyle =
          node.kind === 'prompt' ? '#ffb184' : node.kind === 'render' ? '#6fe3ff' : node.kind === 'image' ? '#a7b9ff' : '#ff9fb2';
        ctx.globalAlpha = this.editor.selection.has(node.id) ? 1 : 0.65;
        ctx.fillRect(
          ox + (node.x - bounds.x) * scale,
          oy + (node.y - bounds.y) * scale,
          Math.max(2, node.w * scale),
          Math.max(2, node.h * scale),
        );
      }
      ctx.globalAlpha = 1;
      const camera = this.editor.project.camera;
      ctx.strokeStyle = 'rgba(242, 235, 214, 0.62)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        ox + (-camera.x / camera.z - bounds.x) * scale,
        oy + (-camera.y / camera.z - bounds.y) * scale,
        (this.stage.clientWidth / camera.z) * scale,
        (this.stage.clientHeight / camera.z) * scale,
      );
    });
  }

  private jumpFromMinimap(event: PointerEvent): void {
    const canvas = this.minimap;
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const bounds = contentBounds(this.editor.doc.nodes);
    const pad = 14;
    const scale = Math.min((rect.width - pad * 2) / Math.max(1, bounds.w), (rect.height - pad * 2) / Math.max(1, bounds.h));
    const ox = pad + ((rect.width - pad * 2) - bounds.w * scale) / 2;
    const oy = pad + ((rect.height - pad * 2) - bounds.h * scale) / 2;
    const world = { x: bounds.x + (point.x - ox) / scale, y: bounds.y + (point.y - oy) / scale };
    const camera = this.editor.project.camera;
    this.editor.setCamera({
      ...camera,
      x: this.stage.clientWidth / 2 - world.x * camera.z,
      y: this.stage.clientHeight / 2 - world.y * camera.z,
    });
  }

}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function escapeAttr(value: string): string {
  return escape(value);
}
