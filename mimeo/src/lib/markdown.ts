import { escapeHtml } from './util';

/**
 * 极简 Markdown 渲染器：只支持对话输出里真正会用到的子集，
 * 白名单式输出，杜绝模型返回 HTML 造成的注入。
 */
export function renderMarkdown(source: string): string {
  const escaped = escapeHtml(source.replace(/\r\n/g, '\n'));
  const lines = escaped.split('\n');
  const out: string[] = [];
  let inCode = false;
  let inList: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      flushParagraph();
      closeList();
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
      } else {
        out.push('<pre class="md-code"><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level + 2}>${inline(heading[2])}</h${level + 2}>`);
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(line.trim())) {
      flushParagraph();
      closeList();
      out.push('<hr />');
      continue;
    }
    const quote = /^&gt;\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushParagraph();
      const next = ul ? 'ul' : 'ol';
      if (inList !== next) {
        closeList();
        out.push(`<${next}>`);
        inList = next;
      }
      out.push(`<li>${inline((ul ?? ol)![ul ? 1 : 2])}</li>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('');
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>',
    );
}
