import { allAssets, getAssetMeta, getAssetUrl } from '../core/assets';
import type { Editor } from '../core/editor';
import type { Group, ID, ImageNode, PromptNode, RenderNode, SceneNode, WeaveNode } from '../core/types';
import { ASPECTS as ASPECT_LIST, NODE_LABEL } from '../core/types';
import { formatBytes } from '../core/util';
import { icon } from './icons';

export interface InspectorDeps {
  editor: Editor;
  run: (nodeId: ID) => void;
  stop: (nodeId: ID) => void;
  openImage: (assetId: ID) => void;
  pickImage: (nodeId: ID) => void;
  pickFromLibrary: (nodeId: ID) => void;
  exportWeave: (nodeId: ID) => void;
  openLibrary: () => void;
  openContactSheet: () => void;
  refresh: () => void;
  toast: (message: string, kind?: 'info' | 'success' | 'error') => void;
}

export function renderInspector(host: HTMLElement, deps: InspectorDeps): void {
  const { editor } = deps;
  host.innerHTML = '';
  const head = document.createElement('header');
  head.className = 'inspector-head';
  head.innerHTML = `<span>检查器</span><span class="inspector-head-right"><span class="inspector-mode">${editor.selection.size} 选中</span><button class="icon-btn inspector-close" data-act="inspector" aria-label="收起检查器">${icon('closePanel', 15)}</button></span>`;
  host.appendChild(head);

  const body = document.createElement('div');
  body.className = 'inspector-body';
  host.appendChild(body);

  const selected = editor.selectedNodes();
  if (editor.threadSelection.size) {
    const thread = editor.doc.threads.find((item) => editor.threadSelection.has(item.id));
    if (thread) {
      renderThread(body, thread, deps);
      return;
    }
  }
  if (selected.length > 1) {
    renderMulti(body, selected, deps);
    return;
  }
  if (selected.length === 1) {
    const node = selected[0];
    if (node.kind === 'prompt') renderPrompt(body, node, deps);
    else if (node.kind === 'render') renderRender(body, node, deps);
    else if (node.kind === 'image') renderImage(body, node, deps);
    else renderWeave(body, node, deps);
    renderCommon(body, node, deps);
    renderMembership(body, node, deps);
    return;
  }
  renderOverview(body, deps);
}

function renderOverview(host: HTMLElement, deps: InspectorDeps): void {
  const { editor } = deps;
  const prompts = editor.doc.nodes.filter((node) => node.kind === 'prompt').length;
  const renders = editor.doc.nodes.filter((node) => node.kind === 'render').length;
  const assets = allAssets().length;
  const section = document.createElement('section');
  section.className = 'panel-section overview';
  section.innerHTML = `
    <div class="eyebrow">PROJECT / 织机</div>
    <h2>${escape(editor.project.name)}</h2>
    <div class="stat-grid">
      <div><strong>${prompts}</strong><span>经线</span></div>
      <div><strong>${renders}</strong><span>纬线</span></div>
      <div><strong>${assets}</strong><span>布样</span></div>
    </div>
    <p class="panel-note">在画布上双击空白处新建经线；从节点右侧的圆点拖一条线到下一位，就能把意图传下去。</p>`;
  host.appendChild(section);

  const quick = document.createElement('section');
  quick.className = 'panel-section';
  quick.innerHTML = '<div class="eyebrow">START / 起织</div>';
  const grid = document.createElement('div');
  grid.className = 'quick-grid';
  const items: { kind: 'prompt' | 'render' | 'weave' | 'image'; label: string; hint: string }[] = [
    { kind: 'prompt', label: '经线', hint: 'T' },
    { kind: 'render', label: '纬线', hint: 'G' },
    { kind: 'weave', label: '织片', hint: 'W' },
    { kind: 'image', label: '布样', hint: 'I' },
  ];
  for (const item of items) {
    const button = document.createElement('button');
    button.className = 'quick-tile';
    button.innerHTML = `${icon(item.kind === 'prompt' ? 'prompt' : item.kind === 'render' ? 'render' : item.kind === 'weave' ? 'weave' : 'image', 18)}<span>${item.label}</span><kbd>${item.hint}</kbd>`;
    button.addEventListener('click', () => {
      if (item.kind === 'image') deps.openLibrary();
      else window.dispatchEvent(new CustomEvent('jacquard:add-node', { detail: item.kind }));
    });
    grid.appendChild(button);
  }
  quick.appendChild(grid);
  host.appendChild(quick);

  const tips = document.createElement('section');
  tips.className = 'panel-section';
  tips.innerHTML = `
    <div class="eyebrow">WEAVE NOTES / 织法</div>
    <ol class="notes-list">
      <li><strong>经线</strong>是方向与质地，连线后自动成为下游纬线的提示词。</li>
      <li><strong>纬线</strong>可以留空，只吃上游；也可以自己补一句。</li>
      <li><strong>织片</strong>只收直接连进来的布样，适合排版后整块导出。</li>
      <li>按 <kbd>⌘K</kbd> 打开命令面板，按 <kbd>P</kbd> 看印样总览。</li>
    </ol>`;
  host.appendChild(tips);

  const foot = document.createElement('div');
  foot.className = 'overview-foot';
  const lib = document.createElement('button');
  lib.className = 'btn';
  lib.innerHTML = `${icon('folder', 15)} 打开布样库`;
  lib.addEventListener('click', deps.openLibrary);
  const sheet = document.createElement('button');
  sheet.className = 'btn';
  sheet.innerHTML = `${icon('grid', 15)} 印样总览`;
  sheet.addEventListener('click', deps.openContactSheet);
  foot.append(lib, sheet);
  host.appendChild(foot);
}

function renderPrompt(host: HTMLElement, node: PromptNode, deps: InspectorDeps): void {
  const { editor } = deps;
  const section = sectionBase('prompt', node);
  section.appendChild(titleField(node, deps));

  const roles = document.createElement('div');
  roles.className = 'segmented three';
  (['direction', 'style', 'note'] as PromptNode['role'][]).forEach((role) => {
    const button = document.createElement('button');
    button.className = node.role === role ? 'active' : '';
    button.textContent = role === 'direction' ? '方向' : role === 'style' ? '质地' : '备注';
    button.addEventListener('click', () => {
      editor.updateNode(node.id, { role }, true);
      deps.refresh();
    });
    roles.appendChild(button);
  });
  section.appendChild(fieldLabel('类型', roles));

  const area = textArea(node.text, '写下织造方向：主体、气氛、光线、禁忌…', (value) => {
    editor.updateNode(node.id, { text: value });
  });
  section.appendChild(fieldLabel('内容', area, `${node.text.length} 字符`));
  host.appendChild(section);
}

function renderRender(host: HTMLElement, node: RenderNode, deps: InspectorDeps): void {
  const { editor } = deps;
  const section = sectionBase('render', node);
  section.appendChild(titleField(node, deps));

  const promptArea = textArea(node.prompt, '留空则只使用上游经线…', (value) => {
    editor.updateNode(node.id, { prompt: value });
  });
  section.appendChild(fieldLabel('补充提示词', promptArea, '会拼在上游经线之后'));

  const upstream = editor.effectivePrompt(node.id);
  const effective = document.createElement('div');
  effective.className = 'effective-prompt';
  effective.innerHTML = `<div class="eyebrow">EFFECTIVE PROMPT</div><p>${escape(upstream || '还没有可用的提示词')}</p>`;
  section.appendChild(effective);

  const aspectGrid = document.createElement('div');
  aspectGrid.className = 'aspect-grid';
  ASPECT_LIST.forEach((aspect) => {
    const button = document.createElement('button');
    button.className = node.aspect === aspect.id ? 'active' : '';
    button.title = aspect.label;
    button.innerHTML = `<span class="aspect-shape" style="aspect-ratio:${aspect.w}/${aspect.h}"></span><span>${aspect.label}</span>`;
    button.addEventListener('click', () => {
      editor.updateNode(node.id, { aspect: aspect.id }, true);
      deps.refresh();
    });
    aspectGrid.appendChild(button);
  });
  section.appendChild(fieldLabel('画幅', aspectGrid));

  const row = document.createElement('div');
  row.className = 'inline-fields';
  row.append(
    numberField('张数', node.count, 1, 4, (value) => {
      editor.updateNode(node.id, { count: value }, true);
      deps.refresh();
    }),
    numberField('种子', node.seed ?? 0, 0, 99999999, (value) => {
      editor.updateNode(node.id, { seed: value || null }, true);
    }),
  );
  section.appendChild(row);

  const thumbs = document.createElement('div');
  thumbs.className = 'render-thumbs';
  if (!node.assetIds.length) {
    thumbs.innerHTML = '<div class="thumb-empty">还没有样张</div>';
  } else {
    node.assetIds.forEach((assetId, index) => {
      const meta = getAssetMeta(assetId);
      const url = getAssetUrl(assetId);
      const button = document.createElement('button');
      button.className = 'render-thumb';
      button.title = '打开样张';
      button.innerHTML = `${url ? `<img alt="" src="${url}" />` : ''}<span>${String(index + 1).padStart(2, '0')}</span>`;
      button.addEventListener('click', () => deps.openImage(assetId));
      thumbs.appendChild(button);
    });
  }
  section.appendChild(fieldLabel(`样张 · ${node.assetIds.length}`, thumbs));

  const actions = document.createElement('div');
  actions.className = 'run-row';
  if (node.status === 'running') {
    const stop = document.createElement('button');
    stop.className = 'btn wide danger';
    stop.innerHTML = `${icon('close', 15)} 停下（${node.progress}%）`;
    stop.addEventListener('click', () => deps.stop(node.id));
    actions.appendChild(stop);
  } else {
    const run = document.createElement('button');
    run.className = 'btn primary wide';
    run.innerHTML = `${icon('play', 15)} ${node.status === 'done' ? '再织一次' : '开始织造'}`;
    run.addEventListener('click', () => deps.run(node.id));
    actions.appendChild(run);
  }
  section.appendChild(actions);
  if (node.error) {
    const error = document.createElement('div');
    error.className = 'inline-error';
    error.textContent = node.error;
    section.appendChild(error);
  }
  host.appendChild(section);
}

function renderImage(host: HTMLElement, node: ImageNode, deps: InspectorDeps): void {
  const { editor } = deps;
  const section = sectionBase('image', node);
  section.appendChild(titleField(node, deps));

  const preview = document.createElement('div');
  preview.className = 'inspector-preview';
  const url = getAssetUrl(node.assetId);
  if (url) {
    preview.innerHTML = `<img alt="" src="${url}" />`;
    preview.addEventListener('click', () => node.assetId && deps.openImage(node.assetId));
    preview.title = '打开大图';
  } else {
    preview.innerHTML = '<span>还没有布样</span>';
  }
  section.appendChild(preview);

  const actions = document.createElement('div');
  actions.className = 'inline-fields stretch';
  const replace = document.createElement('button');
  replace.className = 'btn';
  replace.innerHTML = `${icon('upload', 14)} 替换`;
  replace.addEventListener('click', () => deps.pickImage(node.id));
  const library = document.createElement('button');
  library.className = 'btn';
  library.innerHTML = `${icon('folder', 14)} 布样库`;
  library.addEventListener('click', () => deps.pickFromLibrary(node.id));
  actions.append(replace, library);
  section.appendChild(actions);

  const caption = textInput(node.caption, '给这块布样一个名字…', (value) => {
    editor.updateNode(node.id, { caption: value });
  });
  section.appendChild(fieldLabel('说明', caption));
  const meta = getAssetMeta(node.assetId);
  if (meta) {
    const info = document.createElement('p');
    info.className = 'panel-note mono';
    info.textContent = `${meta.width}×${meta.height} · ${formatBytes(meta.size)} · ${meta.source === 'upload' ? '上传' : meta.model || '织样'}`;
    section.appendChild(info);
  }
  host.appendChild(section);
}

function renderWeave(host: HTMLElement, node: WeaveNode, deps: InspectorDeps): void {
  const { editor } = deps;
  const section = sectionBase('weave', node);
  section.appendChild(titleField(node, deps));
  const incoming = editor.doc.threads.filter((thread) => thread.to === node.id);
  const count = incoming.reduce((sum, thread) => {
    const source = editor.node(thread.from);
    if (!source) return sum;
    if (source.kind === 'image') return sum + (source.assetId ? 1 : 0);
    if (source.kind === 'render') return sum + source.assetIds.length;
    return sum;
  }, 0);

  const columns = document.createElement('div');
  columns.className = 'segmented four';
  [1, 2, 3, 4].forEach((value) => {
    const button = document.createElement('button');
    button.className = node.columns === value ? 'active' : '';
    button.textContent = String(value);
    button.addEventListener('click', () => {
      editor.updateNode(node.id, { columns: value }, true);
      deps.refresh();
    });
    columns.appendChild(button);
  });
  section.appendChild(fieldLabel('列数', columns));

  const gap = document.createElement('input');
  gap.type = 'range';
  gap.min = '0';
  gap.max = '24';
  gap.value = String(node.gap);
  gap.addEventListener('input', () => editor.updateNode(node.id, { gap: Number(gap.value) }));
  gap.addEventListener('change', () => editor.end(true));
  gap.addEventListener('pointerdown', () => editor.begin());
  section.appendChild(fieldLabel('间距', gap, `${node.gap}px`));

  const caption = textInput(node.caption, '织片标题 / 记录…', (value) => {
    editor.updateNode(node.id, { caption: value });
  });
  section.appendChild(fieldLabel('标题', caption));

  const info = document.createElement('div');
  info.className = 'weave-info';
  info.innerHTML = `<span>${count} 张布样</span><span>${incoming.length} 条连线</span>`;
  section.appendChild(info);

  const exportButton = document.createElement('button');
  exportButton.className = 'btn wide';
  exportButton.innerHTML = `${icon('download', 15)} 导出这块织片 PNG`;
  exportButton.disabled = !count;
  exportButton.addEventListener('click', () => deps.exportWeave(node.id));
  section.appendChild(exportButton);
  host.appendChild(section);
}

function renderThread(host: HTMLElement, thread: { id: ID; from: ID; to: ID }, deps: InspectorDeps): void {
  const { editor } = deps;
  const from = editor.node(thread.from);
  const to = editor.node(thread.to);
  const section = document.createElement('section');
  section.className = 'panel-section';
  section.innerHTML = `
    <div class="eyebrow">THREAD / 连线</div>
    <h2>${from?.title ?? '未知'} <span class="muted">→</span> ${to?.title ?? '未知'}</h2>
    <p class="panel-note">这条线把 ${from ? NODE_LABEL[from.kind] : '节点'} 的输出，交给 ${to ? NODE_LABEL[to.kind] : '节点'}。删除线不会删除节点。</p>`;
  const remove = document.createElement('button');
  remove.className = 'btn wide danger';
  remove.innerHTML = `${icon('trash', 15)} 剪断这条线`;
  remove.addEventListener('click', () => editor.disconnect(thread.id));
  section.appendChild(remove);
  host.appendChild(section);
}

function renderMulti(host: HTMLElement, nodes: SceneNode[], deps: InspectorDeps): void {
  const { editor } = deps;
  const section = document.createElement('section');
  section.className = 'panel-section';
  section.innerHTML = `
    <div class="eyebrow">MULTI / 多选</div>
    <h2>${nodes.length} 个节点</h2>
    <p class="panel-note">可以整体拖动，或按左/上对齐。连线不会被批量重排。</p>`;
  const align = document.createElement('div');
  align.className = 'inline-fields stretch';
  const left = document.createElement('button');
  left.className = 'btn';
  left.textContent = '左对齐';
  left.addEventListener('click', () => {
    editor.begin();
    const min = Math.min(...nodes.map((node) => node.x));
    nodes.forEach((node) => (node.x = min));
    editor.end(true);
  });
  const top = document.createElement('button');
  top.className = 'btn';
  top.textContent = '顶对齐';
  top.addEventListener('click', () => {
    editor.begin();
    const min = Math.min(...nodes.map((node) => node.y));
    nodes.forEach((node) => (node.y = min));
    editor.end(true);
  });
  align.append(left, top);
  section.appendChild(align);

  const group = editor.selectionGroup();
  if (group) {
    section.appendChild(groupCard(group, deps, false));
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'group-create';
    const create = document.createElement('button');
    create.className = 'btn wide';
    create.innerHTML = `${icon('group', 15)} 编组选中节点 <kbd>⌘G</kbd>`;
    create.addEventListener('click', () => {
      editor.groupSelection();
      deps.toast(`已编组 ${editor.selection.size} 个节点`, 'success');
      deps.refresh();
    });
    wrap.appendChild(create);
    if (nodes.some((node) => editor.groupFor(node.id))) {
      const note = document.createElement('p');
      note.className = 'panel-note';
      note.textContent = '其中一些节点已在别的编组里；编组后会把它们移入新组。';
      wrap.appendChild(note);
    }
    section.appendChild(wrap);
  }

  const actions = document.createElement('div');
  actions.className = 'inline-fields stretch';
  const dup = document.createElement('button');
  dup.className = 'btn';
  dup.innerHTML = `${icon('layers', 14)} 再织一份`;
  dup.addEventListener('click', () => editor.duplicateSelection());
  const del = document.createElement('button');
  del.className = 'btn danger';
  del.innerHTML = `${icon('trash', 14)} 删除`;
  del.addEventListener('click', () => editor.deleteSelection());
  actions.append(dup, del);
  section.appendChild(actions);
  host.appendChild(section);
}

function renderMembership(host: HTMLElement, node: SceneNode, deps: InspectorDeps): void {
  const group = deps.editor.groupFor(node.id);
  if (!group) return;
  host.appendChild(groupCard(group, deps, true));
}

function groupCard(group: Group, deps: InspectorDeps, compact: boolean): HTMLElement {
  const { editor } = deps;
  const card = document.createElement('div');
  card.className = `group-card${compact ? ' compact' : ''}`;
  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = compact ? 'IN GROUP / 所属编组' : 'GROUP / 编组';
  card.appendChild(eyebrow);

  const input = document.createElement('input');
  input.className = 'title-input group-name';
  input.value = group.name;
  input.placeholder = '编组名称';
  input.title = '点击改名';
  input.addEventListener('focus', () => editor.begin());
  input.addEventListener('input', () => editor.renameGroup(group.id, input.value, false));
  input.addEventListener('blur', () => {
    editor.renameGroup(group.id, input.value, false);
    editor.end(true);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    event.stopPropagation();
  });
  card.appendChild(input);

  const note = document.createElement('p');
  note.className = 'panel-note';
  note.textContent = `与另外 ${Math.max(0, group.nodeIds.length - 1)} 个节点同组。拖动、复制、删除会作为一组处理；按住 Alt 点击可只选其中一个。`;
  card.appendChild(note);

  const row = document.createElement('div');
  row.className = 'group-foot';
  if (compact) {
    const pick = document.createElement('button');
    pick.className = 'btn tiny';
    pick.textContent = '选中整组';
    pick.addEventListener('click', () => {
      editor.select(group.nodeIds);
      deps.refresh();
    });
    row.appendChild(pick);
  }
  const out = document.createElement('button');
  out.className = 'btn tiny danger';
  out.textContent = compact ? '移出编组' : '解散编组';
  out.addEventListener('click', () => {
    editor.ungroupSelection();
    deps.toast('已解散编组', 'success');
    deps.refresh();
  });
  row.appendChild(out);
  card.appendChild(row);
  return card;
}

function renderCommon(host: HTMLElement, node: SceneNode, deps: InspectorDeps): void {
  const { editor } = deps;
  const section = document.createElement('section');
  section.className = 'panel-section';
  section.innerHTML = '<div class="eyebrow">POSITION / 位置</div>';
  const grid = document.createElement('div');
  grid.className = 'coords-grid';
  const addCoord = (label: string, value: number, key: 'x' | 'y' | 'w' | 'h') => {
    const wrapper = document.createElement('label');
    wrapper.innerHTML = `<span>${label}</span>`;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(Math.round(value));
    input.addEventListener('focus', () => editor.begin());
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) {
        if (key === 'w' || key === 'h') editor.updateNode(node.id, { [key]: Math.max(220, parsed) });
        else editor.updateNode(node.id, { [key]: parsed });
      }
      editor.end(true);
    });
    wrapper.appendChild(input);
    grid.appendChild(wrapper);
  };
  addCoord('X', node.x, 'x');
  addCoord('Y', node.y, 'y');
  addCoord('W', node.w, 'w');
  addCoord('H', node.h, 'h');
  section.appendChild(grid);

  const actions = document.createElement('div');
  actions.className = 'inline-fields stretch';
  const dup = document.createElement('button');
  dup.className = 'btn';
  dup.innerHTML = `${icon('layers', 14)} 复制`;
  dup.addEventListener('click', () => editor.duplicateSelection());
  const del = document.createElement('button');
  del.className = 'btn danger';
  del.innerHTML = `${icon('trash', 14)} 删除`;
  del.addEventListener('click', () => editor.deleteSelection());
  actions.append(dup, del);
  section.appendChild(actions);
  host.appendChild(section);
}

function sectionBase(kind: SceneNode['kind'], node: SceneNode): HTMLElement {
  const section = document.createElement('section');
  section.className = `panel-section node-panel kind-${kind}`;
  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.innerHTML = `<span class="eyebrow-dot" style="background:${kindColor(kind)}"></span>${NODE_LABEL[kind]} / ${node.id.slice(0, 12)}`;
  section.appendChild(eyebrow);
  return section;
}

function titleField(node: SceneNode, deps: InspectorDeps): HTMLElement {
  const input = document.createElement('input');
  input.className = 'title-input';
  input.value = node.title;
  input.placeholder = '节点标题';
  input.addEventListener('focus', () => deps.editor.begin());
  input.addEventListener('input', () => deps.editor.updateNode(node.id, { title: input.value }));
  input.addEventListener('blur', () => deps.editor.end(true));
  return input;
}

function fieldLabel(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const field = document.createElement('label');
  field.className = 'field';
  const head = document.createElement('div');
  head.className = 'field-head';
  const name = document.createElement('span');
  name.textContent = label;
  head.appendChild(name);
  if (hint) {
    const tail = document.createElement('span');
    tail.className = 'field-hint';
    tail.textContent = hint;
    head.appendChild(tail);
  }
  field.append(head, control);
  return field;
}

function textArea(value: string, placeholder: string, onInput: (value: string) => void): HTMLTextAreaElement {
  const area = document.createElement('textarea');
  area.className = 'inspector-textarea';
  area.value = value;
  area.placeholder = placeholder;
  area.rows = 5;
  area.addEventListener('input', () => onInput(area.value));
  area.addEventListener('focus', () => window.dispatchEvent(new CustomEvent('jacquard:begin-edit')));
  area.addEventListener('blur', () => window.dispatchEvent(new CustomEvent('jacquard:end-edit')));
  return area;
}

function textInput(value: string, placeholder: string, onInput: (value: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'text-input';
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener('input', () => onInput(input.value));
  input.addEventListener('focus', () => window.dispatchEvent(new CustomEvent('jacquard:begin-edit')));
  input.addEventListener('blur', () => window.dispatchEvent(new CustomEvent('jacquard:end-edit')));
  return input;
}

function numberField(
  label: string,
  value: number,
  min: number,
  max: number,
  onChange: (value: number) => void,
): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'number-field';
  wrapper.innerHTML = `<span>${label}</span>`;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener('change', () => {
    const parsed = Math.max(min, Math.min(max, Math.round(Number(input.value) || min)));
    input.value = String(parsed);
    onChange(parsed);
  });
  wrapper.appendChild(input);
  return wrapper;
}

function kindColor(kind: SceneNode['kind']): string {
  return kind === 'prompt' ? '#d18a5f' : kind === 'render' ? '#9bbf45' : kind === 'image' ? '#8fa9d9' : '#d08a8a';
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
