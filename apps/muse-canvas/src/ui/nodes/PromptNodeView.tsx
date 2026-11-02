import { memo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { PromptNode } from '../../model/types';
import { getEditor } from '../../store/editor';
import { copyText } from '../../lib/util';
import { toast } from '../../store/ui';
import { useEditorState } from '../hooks';

const ROLE_LABEL: Record<PromptNode['role'], string> = {
  prompt: '提示词',
  style: '风格',
  note: '备注',
  negative: '负面词',
};

const PLACEHOLDER: Record<PromptNode['role'], string> = {
  prompt: '描述你想生成的画面…',
  style: '描述统一的视觉风格：光线、色彩、镜头、质感…',
  note: '写下思路、参考链接或待办…',
  negative: '不希望出现的元素，用逗号分隔…',
};

function PromptNodeViewInner({ node }: { node: PromptNode }) {
  const { selection } = useEditorState();
  const [copied, setCopied] = useState(false);
  const selected = selection.includes(node.id);
  const selectedCount = selection.length;

  const copy = async () => {
    if (await copyText(node.text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <>
      <textarea
        className={`prompt-editor${node.role === 'note' ? ' note' : ''}`}
        value={node.text}
        placeholder={PLACEHOLDER[node.role]}
        spellCheck={false}
        onChange={(event) => getEditor().editNode(node.id, { text: event.target.value })}
        onFocus={() => {
          if (!selected) getEditor().select(node.id);
        }}
        onBlur={() => getEditor().flushEdit()}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (!selected) getEditor().select(node.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') (event.target as HTMLTextAreaElement).blur();
        }}
      />
      <div className="node-foot">
        <span className="prompt-role">{ROLE_LABEL[node.role]}</span>
        {node.role === 'note' ? null : (
          <span className="mono" style={{ fontSize: 9 }}>
            {node.text.length} 字
          </span>
        )}
        <span style={{ flex: 1 }} />
        {selectedCount > 1 && node.role === 'prompt' ? (
          <span className="faint" style={{ fontSize: 9 }}>
            已选 {selectedCount}
          </span>
        ) : null}
        <button className="node-head-btn" onClick={copy} title="复制文字" style={{ width: 20, height: 20 }}>
          {copied ? <Check size={11} className="copy-flash" /> : <Copy size={11} />}
        </button>
      </div>
    </>
  );
}

export const PromptNodeView = memo(PromptNodeViewInner);

export function promptSummary(node: PromptNode): string {
  const text = node.text.trim().replace(/\s+/g, ' ');
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function toastCopy() {
  toast('已复制到剪贴板', 'success');
}
