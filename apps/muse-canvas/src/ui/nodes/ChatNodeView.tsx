import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Copy, MessageSquare, RotateCcw, Square, Check } from 'lucide-react';
import type { ChatNode } from '../../model/types';
import { collectContext } from '../../model/graph';
import { renderMarkdown } from '../../lib/markdown';
import { copyText } from '../../lib/util';
import { getEditor } from '../../store/editor';
import { chatModelOptions } from '../../store/settings';
import { toast } from '../../store/ui';
import { cancelNodeRun, runChatNode } from '../../runtime/generation';
import { useEditorState, useSettings } from '../hooks';

function ChatNodeViewInner({ node }: { node: ChatNode }) {
  const { project, selection } = useEditorState();
  const settings = useSettings();
  const options = useMemo(() => chatModelOptions(settings), [settings]);
  const context = useMemo(() => collectContext(project.doc, node.id), [project.doc, node.id]);
  const running = node.status === 'running' || node.status === 'queued';
  const selected = selection.includes(node.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const resolved = node.model ?? settings.defaultChatModel;
  const currentValue = resolved ? `${resolved.providerId}::${resolved.modelId}` : '';
  const current = options.find((o) => `${o.ref.providerId}::${o.ref.modelId}` === currentValue) ?? options[0];

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [node.output, node.status]);

  const send = () => {
    if (running) {
      cancelNodeRun(node.id);
      return;
    }
    if (!node.prompt.trim() && !context.texts.length) {
      toast('先输入问题，或连接提示词节点作为上下文', 'info');
      return;
    }
    getEditor().flushEdit();
    void runChatNode(node.id);
  };

  const copyOutput = async () => {
    if (await copyText(node.output)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      toast('已复制对话结果', 'success');
    }
  };

  const clear = () => {
    getEditor().patchNode(node.id, { output: '', turns: [], status: 'idle', error: undefined }, { label: '清空对话' });
  };

  return (
    <>
      <div
        className="chat-output"
        ref={scrollRef}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (!selected) getEditor().select(node.id);
        }}
      >
        {node.output ? (
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.output) }} />
        ) : running ? (
          <div className="chat-empty">
            <MessageSquare size={18} />
            <strong>正在思考…</strong>
            <p>离线样例会即时回应；接入真实对话模型后按 Token 流式输出。</p>
          </div>
        ) : (
          <div className="chat-empty">
            <MessageSquare size={18} strokeWidth={1.5} />
            <strong>让模型帮你把想法说清楚</strong>
            <p>
              {context.texts.length
                ? `已接入 ${context.texts.length} 条上游上下文，直接提问即可。`
                : '输入创作问题，或从左侧连接提示词节点，作为这次对话的上下文。'}
            </p>
          </div>
        )}
        {running && node.output ? <span className="chat-cursor" /> : null}
      </div>

      {node.status === 'error' && node.error ? <div className="chat-error">{node.error}</div> : null}

      <div className="chat-compose">
        <textarea
          className="chat-input"
          value={node.prompt}
          placeholder="继续提问…（Enter 发送，Shift + Enter 换行）"
          spellCheck={false}
          onChange={(event) => getEditor().editNode(node.id, { prompt: event.target.value })}
          onBlur={() => getEditor().flushEdit()}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (!selected) getEditor().select(node.id);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
            if (event.key === 'Escape') (event.target as HTMLTextAreaElement).blur();
          }}
        />
        <div className="chat-compose-row">
          {options.length ? (
            <select
              className="chat-model-select"
              value={current ? `${current.ref.providerId}::${current.ref.modelId}` : ''}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const [providerId, modelId] = event.target.value.split('::');
                getEditor().patchNode(node.id, { model: { providerId, modelId } }, { label: '切换对话模型' });
              }}
            >
              {options.map((option) => (
                <option
                  key={`${option.ref.providerId}::${option.ref.modelId}`}
                  value={`${option.ref.providerId}::${option.ref.modelId}`}
                >
                  {option.ref.modelId}
                </option>
              ))}
            </select>
          ) : (
            <span className="chat-meta">未配置对话模型</span>
          )}
          {context.texts.length ? <span className="chat-meta">+{context.texts.length} 上下文</span> : null}
          <span style={{ flex: 1 }} />
          {node.output ? (
            <button
              className="node-head-btn"
              title={copied ? '已复制' : '复制结果'}
              style={{ width: 22, height: 22 }}
              onClick={() => void copyOutput()}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          ) : null}
          {node.output ? (
            <button
              className="node-head-btn"
              title="清空对话"
              style={{ width: 22, height: 22 }}
              onClick={clear}
            >
              <RotateCcw size={11} />
            </button>
          ) : null}
          <button
            className={`chat-send${running ? ' stop' : ''}`}
            title={running ? '停止生成' : '发送'}
            onClick={send}
            disabled={!options.length || (!running && !node.prompt.trim() && !context.texts.length)}
          >
            {running ? <Square size={10} /> : <ArrowUp size={12} />}
          </button>
        </div>
      </div>
    </>
  );
}

export const ChatNodeView = memo(ChatNodeViewInner);

