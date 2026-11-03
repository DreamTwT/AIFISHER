import { icon } from './icons';

export type CreationMode = 't2i' | 't2v' | 'i2v' | 'it2v';

interface ModeCard {
  id: CreationMode;
  code: string;
  name: string;
  flow: string;
  detail: string;
}

const MODES: ModeCard[] = [
  {
    id: 't2i',
    code: 'T2I',
    name: '文生图',
    flow: '文本 → 图片',
    detail: '写提示词，生成一张或一组静态图。适合封面、分镜和素材。',
  },
  {
    id: 't2v',
    code: 'T2V',
    name: '文生视频',
    flow: '文本 → 视频',
    detail: '只靠提示词生成短片。文字负责画面、运镜和节奏。',
  },
  {
    id: 'i2v',
    code: 'I2V',
    name: '图生视频',
    flow: '图片 → 视频',
    detail: '选一张图作为首帧；不写提示词也能生成，会补上默认运镜。',
  },
  {
    id: 'it2v',
    code: 'IT2V',
    name: '图文生视频',
    flow: '图片 + 文本 → 视频',
    detail: '图片提供首帧，文字描述运动；两者一起送入视频模型。',
  },
];

/** 四种模式是入口，不是两套割裂的功能：创建后都落在同一张无限画布上。 */
export function openModeLauncher(onPick: (mode: CreationMode) => void): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop mode-backdrop';
  backdrop.innerHTML = `
    <div class="mode-modal" role="dialog" aria-modal="true" aria-label="选择创作模式">
      <header class="mode-head">
        <div>
          <div class="eyebrow">NEW WORK / 创作模式</div>
          <h2>四种模式，一张无限画布。</h2>
        </div>
        <button class="icon-btn" data-act="close" aria-label="关闭">${icon('close', 17)}</button>
      </header>
      <p class="mode-lead">模式只决定输入是什么。进入画布后，文本、图片、视频节点可以继续接、继续改。</p>
      <div class="mode-cards">
        ${MODES.map(
          (mode) => `
          <button class="mode-card" type="button" data-mode="${mode.id}">
            <span class="mode-code">${mode.code}</span>
            <strong>${mode.name}</strong>
            <span class="mode-flow">${mode.flow}</span>
            <p>${mode.detail}</p>
          </button>`,
        ).join('')}
      </div>
      <footer class="mode-foot">画布无限：按住空格向任意方向拖动，<kbd>⌘</kbd> 滚轮缩放。节点放到哪里都可以。</footer>
    </div>`;
  document.body.appendChild(backdrop);

  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector('[data-act="close"]')?.addEventListener('click', close);
  backdrop.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode as CreationMode;
      close();
      onPick(mode);
    });
  });
  document.addEventListener('keydown', onKey);
  backdrop.querySelector<HTMLButtonElement>('[data-mode]')?.focus();
}
