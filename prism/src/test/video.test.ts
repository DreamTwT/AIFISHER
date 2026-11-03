import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/assets', () => ({
  addAsset: vi.fn(async () => ({ id: 'a-video', kind: 'video', name: '图生视频 · 4s' })),
  getAssetBlob: vi.fn(() => new Blob(['reference'], { type: 'image/png' })),
  assetToImage: vi.fn(async () => undefined),
}));

vi.mock('../runtime/demo', () => ({
  renderSample: vi.fn(async () => new Blob(['image'], { type: 'image/png' })),
  renderSampleVideo: vi.fn(async () => new Blob(['video'], { type: 'video/webm' })),
}));

import { Editor } from '../core/editor';
import { starterProject } from '../core/factory';
import { DEFAULT_MOTION_PROMPT } from '../core/modes';
import { runVideo } from '../runtime/runner';
import { renderSampleVideo } from '../runtime/demo';

function editorWithVideo(): { editor: Editor; videoId: string } {
  const editor = new Editor(starterProject());
  const video = editor.addNode('video', 700, 80, {}, false);
  return { editor, videoId: video.id };
}

describe('video modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs i2v without a prompt and sends the default motion prompt', async () => {
    const { editor, videoId } = editorWithVideo();
    const image = editor.addNode('image', 200, 80, { assetId: 'a-image' }, false);
    editor.connect(image.id, videoId, false);

    await runVideo(editor, videoId);

    expect(renderSampleVideo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderSampleVideo).mock.calls[0][0]).toBe(DEFAULT_MOTION_PROMPT);
    expect(editor.node(videoId)?.status).toBe('done');
    expect(editor.node(videoId)?.assetIds).toEqual(['a-video']);
  });

  it('reports an error when there is neither text nor a reference', async () => {
    const { editor, videoId } = editorWithVideo();
    const notify = vi.fn();

    await runVideo(editor, videoId, { notify });

    expect(renderSampleVideo).not.toHaveBeenCalled();
    expect(editor.node(videoId)?.status).toBe('error');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('写一句提示词'), 'error');
  });
});
