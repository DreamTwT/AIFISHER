import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../ui/App';
import { getEditor } from '../store/editor';
import { getUI } from '../store/ui';
import '../styles/base.css';
import '../styles/canvas.css';
import '../styles/nodes.css';
import '../styles/panels.css';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('App 启动与基础交互', () => {
  it('首次打开创建示例画布并渲染节点', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('MUSE')).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText(/起源 · 港口旅人/)).toBeTruthy();
    expect(document.querySelectorAll('[data-node-id]').length).toBeGreaterThan(3);
  }, 15000);

  it('可以添加节点、撤销、打开命令面板', async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector('.topbar')).toBeTruthy(), { timeout: 8000 });
    const before = getEditor().getSnapshot().project.doc.nodes.length;

    const addBtn = document.querySelector<HTMLButtonElement>('[data-tip="添加提示词 (T)"]');
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn!);
    await waitFor(() => {
      expect(getEditor().getSnapshot().project.doc.nodes.length).toBe(before + 1);
    });

    const undoBtn = document.querySelector<HTMLButtonElement>('button[title="撤销 ⌘Z"]');
    fireEvent.click(undoBtn!);
    await waitFor(() => {
      expect(getEditor().getSnapshot().project.doc.nodes.length).toBe(before);
    });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await waitFor(() => expect(getUI().paletteOpen).toBe(true));
    expect(screen.getByPlaceholderText('搜索命令、节点或动作…')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(getUI().paletteOpen).toBe(false));
  }, 15000);
});
