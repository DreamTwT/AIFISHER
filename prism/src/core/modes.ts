/**
 * 生成模式只看两件事：有没有提示词、有没有参考素材。
 * T2I 由生成节点承担；视频节点在 T2V / I2V / IT2V 之间自动切换。
 */
export type VideoMode = 't2v' | 'i2v' | 'it2v';

export const VIDEO_MODE_LABEL: Record<VideoMode, string> = {
  t2v: '文生视频',
  i2v: '图生视频',
  it2v: '图文生视频',
};

export const VIDEO_MODE_CODE: Record<VideoMode, string> = {
  t2v: 'T2V',
  i2v: 'I2V',
  it2v: 'IT2V',
};

export function videoMode(prompt: string, referenceCount: number): VideoMode {
  if (referenceCount > 0) return prompt.trim() ? 'it2v' : 'i2v';
  return 't2v';
}

/** 图生视频可以不写提示词；真正发送时补一句明确的默认运镜，避免依赖网关的隐式默认。 */
export const DEFAULT_MOTION_PROMPT = '保持主体、构图与光线一致，镜头自然运动';

export function videoPrompt(prompt: string, referenceCount: number): string {
  const trimmed = prompt.trim();
  if (trimmed) return trimmed;
  return referenceCount > 0 ? DEFAULT_MOTION_PROMPT : '';
}
