import { useSyncExternalStore } from 'react';
import type { AssetMeta, ID, NodeKind, Settings, TaskInfo } from '../model/types';
import { assetsVersion, getAssetMeta, getAssetUrl, subscribeAssets } from '../store/assets';
import type { EditorState } from '../store/editor';
import { getEditor } from '../store/editor';
import { getSettings, subscribeSettings } from '../store/settings';
import { getTasks, getUI, subscribeTasks, subscribeUI, type UIState } from '../store/ui';

export function useEditorState(): EditorState {
  const editor = getEditor();
  return useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

export function useUIState(): UIState {
  return useSyncExternalStore(subscribeUI, getUI, getUI);
}

export function useTasks(): Record<ID, TaskInfo> {
  return useSyncExternalStore(subscribeTasks, getTasks, getTasks);
}

export function useAssetVersion(): number {
  return useSyncExternalStore(subscribeAssets, assetsVersion, assetsVersion);
}

export function useAsset(assetId: ID | undefined): {
  meta?: AssetMeta;
  url?: string;
} {
  useAssetVersion();
  return { meta: getAssetMeta(assetId), url: getAssetUrl(assetId) };
}

export const kindLabel: Record<NodeKind, string> = {
  prompt: '提示词',
  image: '图像',
  video: '视频',
  audio: '音频',
  generate: '图像生成',
  chat: '对话',
  group: '分组',
};

export const kindAccent: Record<NodeKind, string> = {
  prompt: '#e8c98a',
  image: '#7fc7ff',
  video: '#c3a1ff',
  audio: '#74d6c8',
  generate: '#f0a868',
  chat: '#8fe0b4',
  group: '#e8c98a',
};
