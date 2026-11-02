import { icon } from './icons';

export function openGuide(): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop guide-backdrop';
  backdrop.innerHTML = `
    <div class="guide-modal" role="dialog" aria-modal="true" aria-label="织坊手册">
      <header class="guide-head">
        <div>
          <div class="eyebrow">JACQUARD HANDBOOK / 织坊手册</div>
          <h2>把意图，织成画。</h2>
        </div>
        <button class="icon-btn" data-act="close" aria-label="关闭">${icon('close', 18)}</button>
      </header>
      <div class="guide-scroll">
        <div class="guide-hero">
          <svg viewBox="0 0 240 120" aria-hidden="true">
            <g stroke="currentColor" stroke-width="1" opacity=".55">
              ${Array.from({ length: 24 }, (_, index) => `<line x1="${index * 10 + 2}" y1="6" x2="${index * 10 + 2}" y2="114" />`).join('')}
            </g>
            <g stroke="currentColor" stroke-width="1" opacity=".22">
              ${Array.from({ length: 10 }, (_, index) => `<line x1="6" y1="${index * 12 + 4}" x2="234" y2="${index * 12 + 4}" />`).join('')}
            </g>
            <rect x="38" y="30" width="62" height="60" fill="none" stroke="#d6f26b" stroke-width="1.5" />
            <rect x="116" y="44" width="46" height="32" fill="#d6f26b" opacity=".2" />
            <rect x="176" y="24" width="30" height="72" fill="none" stroke="#d18a5f" stroke-width="1.5" />
            <path d="M100 60 H116" stroke="#d6f26b" stroke-width="1.5" />
            <path d="M162 60 H176" stroke="#d18a5f" stroke-width="1.5" />
          </svg>
          <p>提花（JACQUARD）是一台节点式的 AI 织造台：经线给方向，纬线出样张，布样可拼，织片成版。名字取自 1801 年的提花织机——穿孔卡让机器第一次记住图案。所有东西都留在你自己的浏览器里。</p>
        </div>

        <section>
          <span class="guide-no">01</span>
          <h3>四种节点</h3>
          <div class="guide-grid">
            <div><b>经线 · PROMPT</b><span>写方向、质地、光线。它不直接出图，但会顺着连线进入下游纬线。</span></div>
            <div><b>纬线 · RENDER</b><span>真正调用模型或离线样例织机。可设画幅、张数、种子；也可以写本地提示词。</span></div>
            <div><b>布样 · IMAGE</b><span>一张已经存在的图。可上传、可从布样库放入，也可以双击打开大图。</span></div>
            <div><b>织片 · WEAVE</b><span>把直接连进来的布样排版成一块版，按列数、间距组合，整块导出。</span></div>
          </div>
        </section>

        <section>
          <span class="guide-no">02</span>
          <h3>怎么连线</h3>
          <p>从节点右侧的圆点按住，拖到另一个节点上松手。线是有方向的，提花会拒绝会让图变成环的连线。点击线本身可以选中它，再按退格剪断。</p>
          <p>纬线的提示词 = 所有上游经线（按远近顺序）+ 自己的补充。留空就只吃上游，这适合把“方向”和“质地”拆开维护。</p>
        </section>

        <section>
          <span class="guide-no">03</span>
          <h3>框选与编组</h3>
          <p>在空白处拖出选框：只有完全落在框内的节点才会被选中，擦到边缘不会误选。普通点击编组里的节点会选中整组；按住 <kbd>Alt</kbd> 点击或双击，则进入组内只选一个。</p>
          <p>选中两个以上节点，按 <kbd>⌘G</kbd> 编组，<kbd>⇧⌘G</kbd> 解散。编组会画出虚线框，拖动、复制、删除都作为一组处理；它不会改变连线，也不会参与提示词合成。多选检查器里可以直接改组名。</p>
        </section>

        <section>
          <span class="guide-no">04</span>
          <h3>接上真实模型</h3>
          <p>打开右上角“设置”，填入任意 OpenAI 兼容的图像接口：Base URL、API Key、模型名。提花会向 <code>/images/generations</code> 发请求，同时兼容 <code>b64_json</code> 与 <code>url</code> 两种返回。</p>
          <p>关闭“离线样例织机”后，纬线会走真实接口；如果模型不支持一次多张，提花会自动退化为逐张请求。Key 只保存在本机 <code>localStorage</code>，不会上传到任何第三方服务。</p>
        </section>

        <section>
          <span class="guide-no">05</span>
          <h3>保存、导出与备份</h3>
          <p>工程自动保存在浏览器 IndexedDB。导出 JSON 时，画布里用到的布样会以 data URL 一并打包，换一台机器也能完整还原。整幅画布 PNG、单块织片 PNG、印样总览 PNG 都可以直接下载。</p>
          <p>浏览器清站点数据会删掉本地工程。重要的织机请定期导出 JSON。</p>
        </section>

        <section>
          <span class="guide-no">06</span>
          <h3>键盘</h3>
          <div class="keys-table">
            <div><kbd>⌘K</kbd><span>命令面板</span></div>
            <div><kbd>⌘S</kbd><span>保存</span></div>
            <div><kbd>T / G / W</kbd><span>新增经线 / 纬线 / 织片</span></div>
            <div><kbd>⌘G / ⇧⌘G</kbd><span>编组 / 解散编组</span></div>
            <div><kbd>Alt + 点击</kbd><span>进入编组，只选一个节点</span></div>
            <div><kbd>R</kbd><span>织出选中的纬线</span></div>
            <div><kbd>⌘↵</kbd><span>织完所有纬线</span></div>
            <div><kbd>F</kbd><span>适应画面</span></div>
            <div><kbd>空格 + 拖</kbd><span>平移画布</span></div>
            <div><kbd>⌘ / Ctrl + 滚轮</kbd><span>缩放</span></div>
            <div><kbd>P</kbd><span>印样总览</span></div>
            <div><kbd>?</kbd><span>打开这本手册</span></div>
          </div>
        </section>

        <section>
          <span class="guide-no">07</span>
          <h3>一句话原则</h3>
          <p class="guide-quote">先把方向写清楚，再让纬线去试。不要一次织满整块布。</p>
        </section>
        <footer class="guide-foot">提花 JACQUARD · 本机优先的 AI 织造台</footer>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = (): void => backdrop.remove();
  backdrop.querySelector('[data-act="close"]')?.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}
