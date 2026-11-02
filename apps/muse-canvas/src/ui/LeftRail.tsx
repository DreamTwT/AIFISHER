import { useRef } from 'react';
import {
  FolderKanban,
  Frame,
  Hand,
  HelpCircle,
  ImagePlus,
  Images,
  MessagesSquare,
  MousePointer2,
  Settings,
  Sparkles,
  Type,
} from 'lucide-react';
import { addAsset } from '../store/assets';
import { getEditor } from '../store/editor';
import { getSettings } from '../store/settings';
import { setUI, toast } from '../store/ui';
import { insertNodeAtViewportCenter } from '../lib/insert';
import { emit } from './bus';
import { useSettings } from './hooks';

interface LeftRailProps {
  tool: 'select' | 'hand';
  setTool: (tool: 'select' | 'hand') => void;
}

export function LeftRail({ tool, setTool }: LeftRailProps) {
  useSettings();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="rail" onPointerDown={(event) => event.stopPropagation()}>
      <button
        className={`rail-btn${tool === 'select' ? ' on' : ''}`}
        data-tip="选择工具 (V)"
        onClick={() => setTool('select')}
      >
        <MousePointer2 size={17} />
      </button>
      <button
        className={`rail-btn${tool === 'hand' ? ' on' : ''}`}
        data-tip="抓手 / 平移 (H)"
        onClick={() => setTool('hand')}
      >
        <Hand size={17} />
      </button>

      <div className="rail-sep" />

      <button
        className="rail-btn"
        data-tip="添加提示词 (T)"
        onClick={() => insertNodeAtViewportCenter('prompt')}
      >
        <Type size={17} />
      </button>
      <button
        className="rail-btn"
        data-tip="添加图像生成 (G)"
        onClick={() => insertNodeAtViewportCenter('generate')}
      >
        <Sparkles size={17} />
      </button>
      <button
        className="rail-btn"
        data-tip="添加对话模型 (C)"
        onClick={() => insertNodeAtViewportCenter('chat')}
      >
        <MessagesSquare size={17} />
      </button>
      <button className="rail-btn" data-tip="上传图片" onClick={() => fileRef.current?.click()}>
        <ImagePlus size={17} />
      </button>
      <button
        className="rail-btn"
        data-tip="添加分组 (⌘G)"
        onClick={() => {
          if (getEditor().getSnapshot().selection.length < 1) {
            toast('先选择要分组的节点', 'info');
            return;
          }
          getEditor().groupSelection();
        }}
      >
        <Frame size={17} />
      </button>

      <div className="rail-sep" />

      <button
        className="rail-btn"
        data-tip="素材库"
        onClick={() => setUI((prev) => ({ ...prev, assetsOpen: !prev.assetsOpen }))}
      >
        <Images size={17} />
      </button>
      <button
        className="rail-btn"
        data-tip="画布库 / 模板"
        onClick={() => emit('project:open-dashboard', {})}
      >
        <FolderKanban size={17} />
      </button>

      <div className="rail-bottom">
        <button
          className="rail-btn"
          data-tip="设置"
          onClick={() => emit('settings:open', {})}
        >
          <Settings size={17} />
        </button>
        <button
          className="rail-btn"
          data-tip="快捷键与帮助"
          onClick={() => setUI({ helpOpen: true })}
        >
          <HelpCircle size={17} />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        style={{ display: 'none' }}
        onChange={async (event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          for (const file of files) {
            try {
              const meta = await addAsset(file, {
                name: file.name.replace(/\.[^.]+$/, ''),
                source: 'upload',
                keepOriginal: getSettings().keepOriginal,
              });
              const kind = meta.mime.startsWith('video/')
                ? 'video'
                : meta.mime.startsWith('audio/')
                  ? 'audio'
                  : 'image';
              const w = 360;
              const h =
                kind === 'image' && meta.width && meta.height
                  ? Math.round(36 + Math.min(560, Math.max(160, (w * meta.height) / meta.width)))
                  : kind === 'video'
                    ? 300
                    : 190;
              const base = insertNodeAtViewportCenter(kind, { w, h });
              getEditor().patchNode(base.id, { assetId: meta.id, source: 'upload' }, { label: '插入素材' });
            } catch (error) {
              toast(error instanceof Error ? error.message : '素材导入失败', 'error');
            }
          }
        }}
      />
    </aside>
  );
}
