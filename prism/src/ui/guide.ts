import { icon } from './icons';

export function openGuide(): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop guide-backdrop';
  backdrop.innerHTML = `
    <div class="guide-modal" role="dialog" aria-modal="true" aria-label="使用手册">
      <header class="guide-head">
        <div>
          <div class="eyebrow">PRISM HANDBOOK / 使用手册</div>
          <h2>从提示词到成品。</h2>
        </div>
        <button class="icon-btn" data-act="close" aria-label="关闭">${icon('close', 18)}</button>
      </header>
      <div class="guide-scroll">
        <div class="guide-hero">
          <svg viewBox="0 0 240 120" aria-hidden="true">
            <g stroke="currentColor" stroke-width="1" opacity=".16">
              ${Array.from({ length: 12 }, (_, index) => `<line x1="${index * 20 + 10}" y1="6" x2="${index * 20 + 10}" y2="114" />`).join('')}
              ${Array.from({ length: 6 }, (_, index) => `<line x1="6" y1="${index * 20 + 10}" x2="234" y2="${index * 20 + 10}" />`).join('')}
            </g>
            <rect x="26" y="34" width="52" height="44" rx="3" fill="none" stroke="#6fe3ff" stroke-width="1.5" />
            <rect x="103" y="26" width="46" height="60" rx="3" fill="#6fe3ff" opacity=".16" stroke="#6fe3ff" stroke-width="1.5" />
            <rect x="174" y="40" width="40" height="36" rx="3" fill="none" stroke="#ffb184" stroke-width="1.5" />
            <path d="M78 56 H103" stroke="#6fe3ff" stroke-width="1.5" />
            <path d="M149 56 H174" stroke="#ffb184" stroke-width="1.5" />
          </svg>
          <p>PRISM 是一张本机优先的 AI 图像与视频工作流画布：文本写提示词，生成出图或出视频，图片与视频做素材，拼图做排版。所有内容都保存在你自己的浏览器里。</p>
        </div>

        <section>
          <span class="guide-no">01</span>
          <h3>六种节点</h3>
          <div class="guide-grid">
            <div><b>文本 · TEXT</b><span>写提示词、方向、风格与光线。本身不出图，连线后成为下游节点的输入。</span></div>
            <div><b>生成 · GENERATE</b><span>调用真实模型或离线示例。可设置画幅、张数、种子，也可以补充本地提示词。</span></div>
            <div><b>图片 · IMAGE</b><span>一张现有图片。可上传、从素材库放入，双击查看大图与来源信息。</span></div>
            <div><b>拼图 · COLLAGE</b><span>把直接连入的图片按列排成一张版面，可单独导出 PNG。</span></div>
            <div><b>视频生成 · VIDEO</b><span>接文本与参考（图片/视频），生成 2–12 秒视频；可设画幅、时长与种子。</span></div>
            <div><b>视频 · CLIP</b><span>一段现有视频。拖入或从素材库放入，作为视频节点的参考或单独预览。</span></div>
          </div>
        </section>

        <section>
          <span class="guide-no">02</span>
          <h3>在画布底部写提示词</h3>
          <p>点击文本或生成节点，画布正下方会出现对应的输入区。直接输入即可实时写回节点，<kbd>⌘↵</kbd> 运行，<kbd>Esc</kbd> 收起；双击节点会直接聚焦输入区。</p>
          <p>生成节点的提示词 = 所有上游文本（按距离排序）+ 底部输入区里的本地补充。留空则只读取上游，适合把“画面”和“风格”拆成两个文本节点分别维护。</p>
        </section>

        <section>
          <span class="guide-no">03</span>
          <h3>连线与接口</h3>
          <p>从节点右侧的圆点按住，拖到另一个节点上松手。连线有方向，会拒绝形成循环的连接；点击连线可以选中它，再按退格删除。</p>
          <p>只有真正能连接的接口才会出现：文本只能接到生成，图片和生成只能接到拼图。所以文本和图片没有左侧接口，拼图没有右侧接口。拖到不兼容的节点上时，预览线会变红并给出提示。</p>
        </section>

        <section>
          <span class="guide-no">04</span>
          <h3>框选与编组</h3>
          <p>在空白处拖出选框：只有完全落在框内的节点才会被选中，擦到边缘不会误选。普通点击只选中一个节点；点击编组顶部标题带，或按住 <kbd>Alt</kbd> 点击组内节点，才会选中整组。</p>
          <p>双击编组标题可以直接改名，也可以在标题上右键选择“重命名编组”。选中整组后，拖动、复制、删除都按整组处理。</p>
          <p>选中两个以上节点，按 <kbd>⌘G</kbd> 编组，<kbd>⇧⌘G</kbd> 解散。编组会画出虚线框，拖动、复制、删除都作为一组处理；它不会改变连线，也不参与提示词合成。多选检查器里可以直接改组名。</p>
          <p>拖动节点或整组时，边缘与中心会在 7px 内吸附到其他节点的边缘与中心，并出现青色参考线；按住 <kbd>⌘/Ctrl</kbd> 拖动可临时关闭吸附。方向键微调 1px，<kbd>⇧</kbd> + 方向键微调 10px。</p>
        </section>

        <section>
          <span class="guide-no">05</span>
          <h3>接上真实模型</h3>
          <p>打开右上角“设置”，填入任意 OpenAI 兼容的图像接口：Base URL、API Key、模型名。PRISM 会向 <code>/images/generations</code> 发请求，同时兼容 <code>b64_json</code> 与 <code>url</code> 两种返回。</p>
          <p>关闭“离线示例”后，生成节点会走真实接口；如果模型不支持一次多张，会自动退化为逐张请求。Key 只保存在本机 <code>localStorage</code>，不会上传到任何第三方服务。</p>
        </section>

        <section>
          <span class="guide-no">06</span>
          <h3>视频生成与多参考</h3>
          <p>视频生成节点的左侧接口同时接受文本、图片和视频：文本进入提示词，图片与视频成为参考，最多取前 4 个；超过时检查器会提示只取前 4 个。</p>
          <p>参考可以来自图片节点、拖进画布的 MP4/WebM（会自动成为视频素材节点），也可以直接连上游视频节点的结果，做视频生视频。画幅限 16:9 / 9:16 / 1:1，时长 2–12 秒。</p>
          <p>离线示例会用浏览器的 <code>MediaRecorder</code> 录一段程序化动画；真实接口走 Sora 风格的 <code>/videos</code> 异步任务，参考以 <code>input_reference</code> 上传。</p>
        </section>

        <section>
          <span class="guide-no">07</span>
          <h3>删除素材</h3>
          <p>素材库右上角的“多选”可以一次勾选多张：批量放入画布，或一次性删除。多选时 <kbd>⌘A</kbd> 全选，<kbd>Esc</kbd> 退出多选。</p>
          <p>素材库卡片右上角的删除按钮、图片详情页的“删除素材”，会真正删掉本机图片，并清空画布中引用它的节点。这是可以撤销的：按 <kbd>⌘Z</kbd> 能恢复节点里的图片引用。</p>
          <p>如果只是想让某个节点不再用这张图，用节点右键的“清空生成结果”“移除图片”，或检查器缩略图右上角的删除按钮。素材仍留在素材库，随时可以再放回来。</p>
        </section>

        <section>
          <span class="guide-no">08</span>
          <h3>保存、导出与备份</h3>
          <p>项目自动保存在浏览器 IndexedDB。导出 JSON 时，画布里用到的图片会以 data URL 一并打包，换一台机器也能完整还原。整幅画布 PNG、拼图 PNG、素材总览 PNG 都可以直接下载。</p>
          <p>清理浏览器站点数据会删除本地项目。重要的项目请定期导出 JSON。</p>
        </section>

        <section>
          <span class="guide-no">09</span>
          <h3>键盘</h3>
          <div class="keys-table">
            <div><kbd>⌘K</kbd><span>命令面板</span></div>
            <div><kbd>⌘S</kbd><span>保存</span></div>
            <div><kbd>T / G / V / W / I</kbd><span>新增文本 / 生成 / 视频 / 拼图 / 图片节点</span></div>
            <div><kbd>⌘G / ⇧⌘G</kbd><span>编组 / 解散编组</span></div>
            <div><kbd>Alt + 点击</kbd><span>选中整组</span></div>
            <div><kbd>双击组标题</kbd><span>重命名编组</span></div>
            <div><kbd>方向键 / ⇧ + 方向键</kbd><span>微调 1px / 10px</span></div>
            <div><kbd>R</kbd><span>生成选中的节点</span></div>
            <div><kbd>⌘↵</kbd><span>生成全部</span></div>
            <div><kbd>F</kbd><span>适应画面</span></div>
            <div><kbd>空格 + 拖</kbd><span>平移画布</span></div>
            <div><kbd>⌘ / Ctrl + 滚轮</kbd><span>缩放</span></div>
            <div><kbd>P</kbd><span>素材总览</span></div>
            <div><kbd>?</kbd><span>打开这本手册</span></div>
          </div>
        </section>

        <section>
          <span class="guide-no">10</span>
          <h3>一句话原则</h3>
          <p class="guide-quote">先把提示词写清楚，再让生成节点去试；一次只改一个变量。</p>
        </section>
        <footer class="guide-foot">PRISM · 本机优先的 AI 图像与视频工作台</footer>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  backdrop.querySelector('[data-act="close"]')?.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
}
