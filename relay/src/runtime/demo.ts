import { aspectSize, type Aspect } from '../core/types';
import { canvasBlob, hashString, mulberry32 } from '../core/util';

interface Palette {
  keys: string[];
  deep: string;
  mid: string;
  light: string;
  ink: string;
  a: string;
  b: string;
}

const PALETTES: Palette[] = [
  {
    keys: ['海', '潮', 'sea', 'ocean', 'tide', 'teal', '蓝', '水'],
    deep: '#0a2426',
    mid: '#17514b',
    light: '#45917e',
    ink: '#e9e0c9',
    a: '#d18a5f',
    b: '#9fd8c6',
  },
  {
    keys: ['林', '苔', 'forest', 'moss', 'green', 'leaf', '绿'],
    deep: '#0e2416',
    mid: '#285134',
    light: '#5f8f58',
    ink: '#eee5cc',
    a: '#d3b06a',
    b: '#a8c78a',
  },
  {
    keys: ['黄昏', 'rust', 'warm', '橙', 'sun', 'dusk', '铁', '锈'],
    deep: '#26130d',
    mid: '#642d1b',
    light: '#a95f3d',
    ink: '#f1e5cf',
    a: '#e7a05f',
    b: '#c96b52',
  },
  {
    keys: ['夜', 'night', 'violet', '紫', 'ink', '墨', 'shadow'],
    deep: '#101326',
    mid: '#303963',
    light: '#66719f',
    ink: '#ece4d2',
    a: '#d6f26b',
    b: '#8e9bd9',
  },
];

const FALLBACK: Palette = {
  keys: [],
  deep: '#0f211b',
  mid: '#2a4d40',
  light: '#5b8570',
  ink: '#eee5d0',
  a: '#d6f26b',
  b: '#d18a5f',
};

function pickPalette(prompt: string): Palette {
  const lower = prompt.toLowerCase();
  let best = { score: 0, palette: FALLBACK };
  for (const palette of PALETTES) {
    const score = palette.keys.reduce((sum, key) => (lower.includes(key.toLowerCase()) ? sum + 1 : sum), 0);
    if (score > best.score) best = { score, palette };
  }
  return best.palette;
}

/**
 * 离线示例：确定性的程序化图像，不是模型。
 * 用文本/生成的叠色与纸浆颗粒模拟一张“示例样”，
 * 让没有 API Key 时也能完整验证节点链路。
 */
export async function renderSample(
  prompt: string,
  aspect: Aspect,
  seed: number,
  index: number,
): Promise<Blob> {
  const size = aspectSize(aspect, 1100);
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D');

  const palette = pickPalette(prompt);
  const random = mulberry32((seed + index * 7919) >>> 0);
  const w = canvas.width;
  const h = canvas.height;

  const angle = 0.3 + random() * 0.9;
  const bg = ctx.createLinearGradient(0, 0, w * angle, h);
  bg.addColorStop(0, palette.deep);
  bg.addColorStop(0.55, palette.mid);
  bg.addColorStop(1, palette.light);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 文本
  const warpStep = Math.max(12, Math.round(w / 46));
  for (let x = -warpStep; x < w + warpStep; x += warpStep) {
    const alpha = 0.035 + random() * 0.09;
    ctx.strokeStyle = `rgba(240, 234, 212, ${alpha})`;
    ctx.lineWidth = 1 + random() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x + (random() - 0.5) * 10, 0);
    ctx.lineTo(x + (random() - 0.5) * 18, h);
    ctx.stroke();
  }

  // 生成：弧形的纹理
  const rows = 42;
  for (let row = 0; row < rows; row += 1) {
    const y = (row / rows) * h;
    const amp = 5 + random() * 22;
    const color = row % 7 === 0 ? palette.a : palette.ink;
    ctx.strokeStyle = row % 7 === 0 ? `${color}66` : `rgba(238, 229, 208, ${0.04 + random() * 0.1})`;
    ctx.lineWidth = row % 7 === 0 ? 2.4 : 1;
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 12) {
      const wave = Math.sin(x / (70 + row * 3) + row * 0.7) * amp;
      if (x < 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }

  // 母题：四种纹理，按示例序号轮换
  const variant = index % 4;
  if (variant === 0) {
    // 门洞 / 窗
    const motifW = w * (0.3 + random() * 0.16);
    const motifH = h * (0.36 + random() * 0.18);
    const mx = w * (0.3 + random() * 0.4) - motifW / 2;
    const my = h * (0.28 + random() * 0.28) - motifH / 2;
    ctx.fillStyle = 'rgba(5, 12, 11, 0.5)';
    ctx.fillRect(mx, my, motifW, motifH);
    ctx.strokeStyle = palette.ink;
    ctx.globalAlpha = 0.62;
    ctx.lineWidth = 2;
    ctx.strokeRect(mx + 8, my + 8, motifW - 16, motifH - 16);
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 8;
    ctx.strokeRect(mx + 2, my + 2, motifW - 4, motifH - 4);
    ctx.globalAlpha = 1;
  } else if (variant === 1) {
    // 圆盘 / 潮汐
    const cx = w * (0.35 + random() * 0.3);
    const cy = h * (0.34 + random() * 0.18);
    const radius = Math.min(w, h) * (0.22 + random() * 0.1);
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.5);
    glow.addColorStop(0, `${palette.a}55`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(6, 14, 12, 0.5)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.b;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.34;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i += 1) {
      const hy = cy + radius + 18 + i * 24;
      ctx.beginPath();
      ctx.moveTo(w * 0.08, hy);
      ctx.lineTo(w * 0.92, hy + (random() - 0.5) * 8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.a;
    ctx.fillRect(w * 0.08, cy + radius * 0.1, w * 0.16, 5);
  } else if (variant === 2) {
    // 垂条
    const bars = 4 + Math.floor(random() * 2);
    for (let i = 0; i < bars; i += 1) {
      const bw = w * (0.055 + random() * 0.11);
      const x = w * 0.12 + i * ((w * 0.76) / bars) + (random() - 0.5) * 12;
      const top = h * (0.12 + random() * 0.18);
      const bottom = h * (0.68 + random() * 0.2);
      ctx.fillStyle = i % 3 === 0 ? `${palette.a}44` : i % 3 === 1 ? `${palette.b}33` : 'rgba(8, 16, 13, 0.5)';
      ctx.fillRect(x, top, bw, bottom - top);
      ctx.strokeStyle = palette.ink;
      ctx.globalAlpha = 0.28;
      ctx.strokeRect(x + 0.5, top + 0.5, bw - 1, bottom - top);
      ctx.globalAlpha = 1;
    }
  } else {
    // 折面 / 潮线
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w * 0.05, h * 0.68);
    ctx.lineTo(w * 0.52, h * 0.2);
    ctx.lineTo(w * 0.95, h * 0.38);
    ctx.lineTo(w * 0.86, h * 0.82);
    ctx.lineTo(w * 0.3, h * 0.9);
    ctx.closePath();
    ctx.fillStyle = 'rgba(7, 15, 13, 0.52)';
    ctx.fill();
    ctx.strokeStyle = palette.a;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.clip();
    ctx.strokeStyle = `${palette.b}55`;
    for (let x = 0; x < w; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, h * 0.1);
      ctx.lineTo(x + w * 0.2, h * 0.95);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 叠色色块
  const blocks = 3 + Math.floor(random() * 3);
  for (let i = 0; i < blocks; i += 1) {
    const bw = w * (0.08 + random() * 0.2);
    const bh = h * (0.03 + random() * 0.08);
    const x = random() * (w - bw);
    const y = random() * (h - bh);
    ctx.fillStyle = i % 2 ? `${palette.a}aa` : `${palette.b}99`;
    ctx.globalAlpha = 0.35 + random() * 0.4;
    ctx.fillRect(x, y, bw, bh);
  }
  ctx.globalAlpha = 1;

  // 生成标记
  ctx.strokeStyle = palette.a;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(w * 0.16, h * 0.18, Math.min(w, h) * 0.045, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w * 0.16 - w * 0.06, h * 0.18);
  ctx.lineTo(w * 0.16 + w * 0.06, h * 0.18);
  ctx.stroke();

  // 颗粒
  const grains = Math.floor((w * h) / 9000);
  for (let i = 0; i < grains; i += 1) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(random() * w, random() * h, 1.2, 1.2);
  }

  // 色洗
  const wash = ctx.createLinearGradient(0, 0, w, h * 1.2);
  wash.addColorStop(0, `${palette.a}18`);
  wash.addColorStop(0.55, 'rgba(0,0,0,0)');
  wash.addColorStop(1, `${palette.b}12`);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  // 暗角
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.26)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // 结果标记
  const margin = Math.round(w * 0.045);
  ctx.fillStyle = palette.ink;
  ctx.globalAlpha = 0.74;
  ctx.font = `${Math.max(11, Math.round(w * 0.014))}px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace`;
  ctx.fillText(`RELAY / TRIAL ${String(index + 1).padStart(2, '0')}`, margin, h - margin);
  ctx.globalAlpha = 0.5;
  ctx.font = `${Math.max(9, Math.round(w * 0.0105))}px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace`;
  ctx.fillText(`SEED ${seed} / ${hashString(prompt).toString(16).slice(0, 8).toUpperCase()}`, margin, h - margin + 18);
  ctx.globalAlpha = 1;

  return canvasBlob(canvas, 'image/jpeg');
}
