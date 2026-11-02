import { aspectValue, hashString, mulberry32 } from '../lib/util';
import type { AspectRatio } from '../model/types';

/**
 * 内置离线样例引擎
 *
 * 不是模型，而是一个确定性的程序化图像生成器：把提示词里的色彩与题材线索
 * 映射成海报化的构图。它的作用是在没有 API Key / 离线环境下，
 * 让整条画布链路（提示词 → 参考图 → 生成 → 下游节点）仍然可被验证与演示。
 */

interface Palette {
  name: string;
  bg: [string, string, string];
  accents: string[];
  ink: string;
}

const PALETTES: { keys: string[]; palette: Palette }[] = [
  {
    keys: ['海', '浪', 'ocean', 'sea', 'water', 'blue', '蓝', '湖', '雨'],
    palette: {
      name: '潮汐蓝',
      bg: ['#06121f', '#0b2f43', '#0a4f5c'],
      accents: ['#7fe3ff', '#2f9bd6', '#d6fbff'],
      ink: '#eafcff',
    },
  },
  {
    keys: ['日落', '黄昏', 'sunset', 'dusk', '橙', '火', 'warm', '沙漠', 'gold', '金'],
    palette: {
      name: '余烬金',
      bg: ['#1a0c08', '#48180f', '#9a3c12'],
      accents: ['#ffb86b', '#ff6b3d', '#ffe7c2'],
      ink: '#fff4e6',
    },
  },
  {
    keys: ['森林', '绿', 'forest', 'jungle', 'plant', '自然', '苔'],
    palette: {
      name: '苔原绿',
      bg: ['#07130c', '#123322', '#1d4a2d'],
      accents: ['#9be29b', '#4c9f70', '#e4ffd9'],
      ink: '#f0fff0',
    },
  },
  {
    keys: ['赛博', 'cyber', '霓虹', 'neon', '未来', 'futur', '紫色', 'purple', '科技'],
    palette: {
      name: '霓虹紫',
      bg: ['#0a0616', '#241046', '#3c0f5c'],
      accents: ['#b388ff', '#ff4fd8', '#5af0ff'],
      ink: '#f7edff',
    },
  },
  {
    keys: ['雪', '冰', 'snow', 'ice', 'white', '白', '雾', 'mist'],
    palette: {
      name: '冰川白',
      bg: ['#0b1116', '#243240', '#51677a'],
      accents: ['#dff3ff', '#9fc4dd', '#ffffff'],
      ink: '#f7fdff',
    },
  },
  {
    keys: ['粉', 'pink', '花', 'flower', '樱', '少女', '甜'],
    palette: {
      name: '晨雾粉',
      bg: ['#1a0c14', '#40203a', '#7a3b58'],
      accents: ['#ffb7d5', '#ff7aa8', '#ffe9f1'],
      ink: '#fff1f7',
    },
  },
  {
    keys: ['黑', '暗', 'noir', 'dark', 'shadow', '墨'],
    palette: {
      name: '墨夜黑',
      bg: ['#050505', '#151515', '#2b2b2b'],
      accents: ['#c9a227', '#8a8a8a', '#f2f2f2'],
      ink: '#f5f5f5',
    },
  },
];

const DEFAULT_PALETTE: Palette = {
  name: '印坊灰',
  bg: ['#0c0c0f', '#1c1c22', '#34343c'],
  accents: ['#ff5a3c', '#3d6bff', '#f4efe4'],
  ink: '#f7f2e8',
};

type Composition = 'portrait' | 'landscape' | 'harbor' | 'architecture' | 'product' | 'abstract';

function pickPalette(prompt: string): Palette {
  const p = prompt.toLowerCase();
  let best: { score: number; palette: Palette } = { score: 0, palette: DEFAULT_PALETTE };
  for (const entry of PALETTES) {
    const score = entry.keys.reduce((sum, key) => (p.includes(key.toLowerCase()) ? sum + 1 : sum), 0);
    if (score > best.score) best = { score, palette: entry.palette };
  }
  return best.palette;
}

function pickComposition(prompt: string): Composition {
  const p = prompt.toLowerCase();
  const rules: { keys: string[]; kind: Composition }[] = [
    { keys: ['港口', '码头', 'harbor', 'dock', '旅人', '雾港', '轮船', '货船'], kind: 'harbor' },
    { keys: ['人像', 'portrait', 'girl', 'boy', '人物', '角色', '少女', '男', '女'], kind: 'portrait' },
    { keys: ['建筑', 'architecture', 'city', '城市', '楼', '空间', '室内'], kind: 'architecture' },
    { keys: ['产品', 'product', '香水', '瓶', '包装', '电商'], kind: 'product' },
    { keys: ['风景', 'landscape', '山', 'mountain', '海', 'sunset', '日落', 'forest'], kind: 'landscape' },
  ];
  for (const rule of rules) {
    if (rule.keys.some((k) => p.includes(k.toLowerCase()))) return rule.kind;
  }
  return 'abstract';
}

const PALETTE_LATIN: Record<string, string> = {
  潮汐蓝: 'TIDAL BLUE',
  余烬金: 'EMBER GOLD',
  苔原绿: 'TUNDRA GREEN',
  霓虹紫: 'NEON VIOLET',
  冰川白: 'GLACIER WHITE',
  晨雾粉: 'MORNING PINK',
  墨夜黑: 'INK NOIR',
  印坊灰: 'PRESS GREY',
};

const compositionLabel: Record<Composition, string> = {
  portrait: '人像构图',
  landscape: '风景构图',
  harbor: '港口叙事',
  architecture: '建筑构图',
  product: '产品构图',
  abstract: '抽象构成',
};

// 画在图片上的说明用英文，避免无中文字体的环境出现方块
const compositionEn: Record<Composition, string> = {
  portrait: 'PORTRAIT STUDY',
  landscape: 'LANDSCAPE',
  harbor: 'HARBOR STORY',
  architecture: 'ARCHITECTURE',
  product: 'PRODUCT',
  abstract: 'ABSTRACT',
};

function sizeFor(aspect: AspectRatio): { width: number; height: number } {
  const { w, h } = aspectValue(aspect);
  const long = 1280;
  if (w >= h) return { width: long, height: Math.round((long * h) / w) };
  return { width: Math.round((long * w) / h), height: long };
}

function softCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPortrait(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  palette: Palette,
  rnd: () => number,
) {
  const cx = W * (0.45 + rnd() * 0.1);
  const headR = Math.min(W, H) * (0.14 + rnd() * 0.03);
  const headY = H * (0.36 + rnd() * 0.05);

  // 轮廓光
  softCircle(ctx, cx, headY, headR * 3.4, palette.accents[0], 0.5);

  // 肩部
  const shoulder = ctx.createLinearGradient(cx, headY + headR, cx, H);
  shoulder.addColorStop(0, 'rgba(8,8,10,0.86)');
  shoulder.addColorStop(1, 'rgba(8,8,10,0.98)');
  ctx.fillStyle = shoulder;
  ctx.beginPath();
  ctx.moveTo(cx - headR * 3.4, H);
  ctx.bezierCurveTo(
    cx - headR * 3.1,
    headY + headR * 2.4,
    cx - headR * 1.5,
    headY + headR * 1.5,
    cx - headR * 0.8,
    headY + headR * 1.1,
  );
  ctx.lineTo(cx + headR * 0.8, headY + headR * 1.1);
  ctx.bezierCurveTo(
    cx + headR * 1.5,
    headY + headR * 1.5,
    cx + headR * 3.1,
    headY + headR * 2.4,
    cx + headR * 3.4,
    H,
  );
  ctx.closePath();
  ctx.fill();

  // 头部
  ctx.fillStyle = 'rgba(10,10,12,0.94)';
  ctx.beginPath();
  ctx.ellipse(cx, headY, headR * 0.92, headR, 0, 0, Math.PI * 2);
  ctx.fill();

  // 边缘光弧
  ctx.save();
  ctx.strokeStyle = palette.accents[0];
  ctx.lineWidth = Math.max(3, W * 0.004);
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(cx, headY, headR * 1.04, Math.PI * 0.72, Math.PI * 1.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, headY + headR * 1.25, headR * 2.4, Math.PI * 1.06, Math.PI * 1.5);
  ctx.globalAlpha = 0.4;
  ctx.stroke();
  ctx.restore();
}

function drawLandscape(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  palette: Palette,
  rnd: () => number,
) {
  const horizon = H * (0.52 + rnd() * 0.12);
  const sunX = W * (0.3 + rnd() * 0.4);
  const sunY = horizon - H * (0.1 + rnd() * 0.08);
  softCircle(ctx, sunX, sunY, Math.min(W, H) * 0.3, palette.accents[1], 0.9);
  softCircle(ctx, sunX, sunY, Math.min(W, H) * 0.12, palette.ink, 0.85);

  for (let layer = 0; layer < 4; layer++) {
    const yBase = horizon + layer * H * 0.09;
    const alpha = 0.2 + layer * 0.18;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, yBase);
    const steps = 7;
    for (let i = 1; i <= steps; i++) {
      const x = (W / steps) * i;
      const y = yBase + Math.sin(i * 1.3 + layer * 2 + rnd() * 0.6) * H * 0.045;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = layer % 2 ? 'rgba(5,6,8,0.82)' : `rgba(5,6,8,${alpha})`;
    ctx.fill();
  }

  // 天际线
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = palette.accents[2];
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(W, horizon);
  ctx.stroke();
  ctx.restore();
}

function drawHarbor(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  palette: Palette,
  rnd: () => number,
) {
  const horizon = H * (0.54 + rnd() * 0.08);
  const lightX = W * (0.24 + rnd() * 0.5);

  // 天空：上方深，靠近海面泛出天光
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, palette.bg[0]);
  sky.addColorStop(0.7, palette.bg[1]);
  sky.addColorStop(1, palette.bg[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);
  softCircle(ctx, lightX, horizon - H * 0.02, W * 0.62, palette.accents[1], 0.42);
  softCircle(ctx, lightX, horizon - H * 0.02, W * 0.16, palette.ink, 0.35);

  // 低空雾带
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const y = horizon - H * (0.02 + rnd() * 0.16);
    const band = ctx.createLinearGradient(0, y, W, y);
    band.addColorStop(0, 'rgba(255,255,255,0)');
    band.addColorStop(0.45 + rnd() * 0.1, palette.ink);
    band.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.035 + rnd() * 0.05;
    ctx.fillStyle = band;
    ctx.fillRect(0, y, W, H * (0.006 + rnd() * 0.014));
  }
  ctx.restore();

  // 码头岸线：让吊机与集装箱有落脚点
  const quayY = horizon - H * 0.028;
  ctx.save();
  const quay = ctx.createLinearGradient(0, quayY, 0, horizon + H * 0.02);
  quay.addColorStop(0, 'rgba(10,13,17,0.96)');
  quay.addColorStop(1, 'rgba(5,7,10,0.98)');
  ctx.fillStyle = quay;
  ctx.fillRect(0, quayY, W, H * 0.048);
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = palette.accents[0];
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, quayY);
  ctx.lineTo(W, quayY);
  ctx.stroke();
  // 岸线灯
  for (let i = 0; i < 14; i++) {
    const lx = W * (0.04 + i * 0.07 + rnd() * 0.02);
    ctx.globalAlpha = 0.4 + rnd() * 0.5;
    ctx.fillStyle = i % 3 === 0 ? palette.accents[1] : palette.accents[2];
    ctx.fillRect(lx, quayY + H * 0.008, Math.max(1.5, W * 0.0018), Math.max(1.5, H * 0.002));
  }
  ctx.restore();

  // 远处的吊机与集装箱堆场
  const cranes = 2 + Math.floor(rnd() * 3);
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = Math.max(1.4, W * 0.0016);
  for (let i = 0; i < cranes; i++) {
    const cx = W * (0.5 + i * 0.16 + rnd() * 0.05);
    const mast = H * (0.14 + rnd() * 0.14);
    const jib = W * (0.14 + rnd() * 0.1);
    ctx.beginPath();
    ctx.moveTo(cx, quayY);
    ctx.lineTo(cx, quayY - mast);
    ctx.lineTo(cx - jib, quayY - mast);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, quayY - mast);
    ctx.lineTo(cx + jib * 0.42, quayY - mast + mast * 0.35);
    ctx.stroke();
    // 垂下的钢索
    ctx.globalAlpha = 0.28;
    for (let k = 0; k < 3; k++) {
      const hx = cx - jib * (0.3 + k * 0.26);
      const drop = mast * (0.3 + rnd() * 0.5);
      ctx.beginPath();
      ctx.moveTo(hx, quayY - mast);
      ctx.lineTo(hx, quayY - mast + drop);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.6;
  }
  ctx.restore();

  ctx.save();
  for (let i = 0; i < 9; i++) {
    const bw = W * (0.035 + rnd() * 0.05);
    const bh = H * (0.015 + rnd() * 0.035);
    const x = W * rnd();
    ctx.globalAlpha = 0.5 + rnd() * 0.35;
    ctx.fillStyle = i % 3 === 0 ? palette.accents[1] : 'rgba(6,8,11,0.9)';
    ctx.fillRect(x, quayY - bh, bw, bh);
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = palette.accents[0];
    ctx.lineWidth = 1;
    ctx.strokeRect(x, quayY - bh, bw, bh);
  }
  ctx.restore();

  // 海面
  const sea = ctx.createLinearGradient(0, horizon, 0, H);
  sea.addColorStop(0, palette.bg[2]);
  sea.addColorStop(0.45, palette.bg[1]);
  sea.addColorStop(1, 'rgba(3,5,8,0.98)');
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizon, W, H - horizon);

  // 波光：沿光带左右碎开
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 62; i++) {
    const t = rnd();
    const y = horizon + t * t * (H - horizon) * 0.8;
    const spread = W * (0.03 + t * 0.22);
    const x = lightX + (rnd() - 0.5) * spread * 2;
    const len = W * (0.008 + rnd() * 0.05) * (0.4 + t);
    ctx.globalAlpha = (0.05 + rnd() * 0.22) * (1 - t * 0.5);
    ctx.fillStyle = i % 4 === 0 ? palette.ink : palette.accents[0];
    ctx.fillRect(x, y, len, Math.max(1, H * 0.0016));
  }
  ctx.restore();

  // 潮湿的码头地面
  const dockY = H * (0.76 + rnd() * 0.05);
  const dock = ctx.createLinearGradient(0, dockY, 0, H);
  dock.addColorStop(0, 'rgba(8,10,13,0.82)');
  dock.addColorStop(1, 'rgba(3,4,6,1)');
  ctx.fillStyle = dock;
  ctx.beginPath();
  ctx.moveTo(0, dockY + H * 0.02);
  ctx.lineTo(W, dockY - H * 0.015);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = palette.accents[0];
  ctx.lineWidth = Math.max(1, W * 0.0012);
  ctx.beginPath();
  ctx.moveTo(0, dockY + H * 0.02);
  ctx.lineTo(W, dockY - H * 0.015);
  ctx.stroke();
  // 地面积水的反光
  softCircle(ctx, lightX, H * 0.9, W * 0.28, palette.accents[1], 0.16);
  ctx.restore();

  // 系缆桩
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,7,0.95)';
  for (let i = 0; i < 2; i++) {
    const bx = W * (0.08 + i * 0.8 + rnd() * 0.04);
    const by = dockY + H * (0.06 + rnd() * 0.04);
    const bw = W * 0.022;
    const bh = H * 0.06;
    ctx.beginPath();
    ctx.ellipse(bx, by - bh, bw * 0.62, bw * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(bx - bw / 2, by - bh, bw, bh);
    ctx.strokeStyle = palette.accents[0];
    ctx.globalAlpha = 0.42;
    ctx.strokeRect(bx - bw / 2, by - bh, bw, bh);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // 旅人：风衣 + 围巾的剪影，边缘被港口灯火勾亮
  const fx = W * (0.3 + rnd() * 0.16);
  const fy = dockY + H * (0.07 + rnd() * 0.04);
  const fh = H * (0.2 + rnd() * 0.035);
  const fw = fh * 0.3;
  ctx.save();
  ctx.translate(fx, fy);
  softCircle(ctx, 0, -fh * 0.45, fh * 0.9, palette.accents[1], 0.18);
  // 腿
  ctx.fillStyle = 'rgba(3,4,6,0.98)';
  ctx.fillRect(-fw * 0.42, -fh * 0.34, fw * 0.3, fh * 0.34);
  ctx.fillRect(fw * 0.12, -fh * 0.34, fw * 0.3, fh * 0.34);
  // 风衣
  ctx.beginPath();
  ctx.moveTo(-fw * 0.46, -fh * 0.72);
  ctx.lineTo(fw * 0.46, -fh * 0.72);
  ctx.lineTo(fw * 0.66, -fh * 0.3);
  ctx.lineTo(fw * 0.2, -fh * 0.22);
  ctx.lineTo(-fw * 0.2, -fh * 0.22);
  ctx.lineTo(-fw * 0.66, -fh * 0.3);
  ctx.closePath();
  ctx.fill();
  // 围巾与肩线
  ctx.fillStyle = 'rgba(5,6,8,1)';
  ctx.beginPath();
  ctx.ellipse(0, -fh * 0.74, fw * 0.44, fh * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-fw * 0.16, -fh * 0.72, fw * 0.18, fh * 0.2);
  // 头部
  ctx.beginPath();
  ctx.ellipse(0, -fh * 0.85, fw * 0.24, fh * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  // 边缘光
  ctx.strokeStyle = palette.accents[0];
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(2, W * 0.0022);
  ctx.beginPath();
  ctx.moveTo(fw * 0.4, -fh * 0.94);
  ctx.quadraticCurveTo(fw * 0.62, -fh * 0.62, fw * 0.58, -fh * 0.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -fh * 0.85, fw * 0.24, Math.PI * 1.62, Math.PI * 0.42);
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.restore();

  // 细雨
  ctx.save();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = Math.max(1, W * 0.001);
  for (let i = 0; i < 46; i++) {
    const x = W * rnd();
    const y = H * rnd();
    const len = H * (0.012 + rnd() * 0.03);
    ctx.globalAlpha = 0.03 + rnd() * 0.12;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * 0.28, y + len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawArchitecture(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  palette: Palette,
  rnd: () => number,
) {
  ctx.save();
  ctx.translate(W * 0.5, H * 0.52);
  const count = 9 + Math.floor(rnd() * 6);
  for (let i = 0; i < count; i++) {
    const w = W * (0.06 + rnd() * 0.16);
    const h = H * (0.18 + rnd() * 0.6);
    const x = -W * 0.44 + (i / count) * W * 0.88 + (rnd() - 0.5) * 20;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(9,10,14,0.78)' : 'rgba(14,16,22,0.55)';
    ctx.strokeStyle = palette.accents[i % palette.accents.length];
    ctx.globalAlpha = 0.28 + rnd() * 0.4;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.rect(x, -h * rnd(), w, h);
    ctx.fill();
    ctx.stroke();
    // 窗格
    ctx.globalAlpha = 0.5;
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const ly = -h * rnd() + (r / rows) * h;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.12, ly);
      ctx.lineTo(x + w * 0.88, ly);
      ctx.stroke();
    }
  }
  ctx.restore();
  softCircle(ctx, W * 0.25, H * 0.28, W * 0.4, palette.accents[0], 0.35);
}

function drawProduct(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  palette: Palette,
  rnd: () => number,
) {
  const cx = W / 2;
  const cy = H * 0.55;
  softCircle(ctx, cx, cy - H * 0.08, Math.min(W, H) * 0.42, palette.accents[0], 0.7);

  // 台面
  const floor = ctx.createLinearGradient(0, H * 0.68, 0, H);
  floor.addColorStop(0, 'rgba(0,0,0,0.1)');
  floor.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = floor;
  ctx.fillRect(0, H * 0.68, W, H * 0.32);

  const bw = W * (0.16 + rnd() * 0.06);
  const bh = H * (0.32 + rnd() * 0.1);
  const x = cx - bw / 2;
  const y = cy - bh * 0.55;
  const body = ctx.createLinearGradient(x, y, x + bw, y + bh);
  body.addColorStop(0, palette.accents[2]);
  body.addColorStop(0.45, palette.accents[0]);
  body.addColorStop(1, palette.accents[1]);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 30;
  ctx.fillStyle = body;
  roundRect(ctx, x, y, bw, bh, bw * 0.18);
  ctx.fill();
  ctx.restore();

  // 倒影
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.scale(1, -0.55);
  ctx.translate(0, -(H * 0.95));
  ctx.fillStyle = palette.accents[0];
  roundRect(ctx, x, y, bw, bh, bw * 0.18);
  ctx.fill();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawAbstract(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  palette: Palette,
  rnd: () => number,
) {
  const rings = 4 + Math.floor(rnd() * 4);
  ctx.save();
  ctx.translate(W * (0.3 + rnd() * 0.4), H * (0.35 + rnd() * 0.3));
  for (let i = 0; i < rings; i++) {
    const r = Math.min(W, H) * (0.08 + i * 0.055);
    ctx.beginPath();
    ctx.arc(0, 0, r, rnd() * Math.PI, Math.PI * (1 + rnd()));
    ctx.strokeStyle = palette.accents[i % palette.accents.length];
    ctx.globalAlpha = 0.55 - i * 0.06;
    ctx.lineWidth = Math.max(2, W * 0.004);
    ctx.stroke();
  }
  ctx.restore();

  // 漂浮的色块
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.translate(W * rnd(), H * rnd());
    ctx.rotate(rnd() * Math.PI);
    ctx.globalAlpha = 0.14 + rnd() * 0.25;
    ctx.fillStyle = palette.accents[i % palette.accents.length];
    roundRect(ctx, -W * 0.1, -H * 0.02, W * (0.12 + rnd() * 0.2), H * (0.02 + rnd() * 0.03), 8);
    ctx.fill();
    ctx.restore();
  }

  // 细网格
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1;
  const step = Math.max(48, Math.min(W, H) / 12);
  for (let x = step; x < W; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = step; y < H; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();
}

let grainCanvas: HTMLCanvasElement | null = null;
function grainOverlay(W: number, H: number, strength = 0.05): HTMLCanvasElement {
  if (grainCanvas && grainCanvas.width === W && grainCanvas.height === H) return grainCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(W, H);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() * 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = Math.random() * 255 * strength;
  }
  ctx.putImageData(image, 0, 0);
  grainCanvas = canvas;
  return canvas;
}

export interface DemoRenderOptions {
  prompt: string;
  aspect: AspectRatio;
  seed: number;
  variant?: number;
  negative?: string;
}

export async function renderDemoImage(options: DemoRenderOptions): Promise<{ blob: Blob; width: number; height: number; style: string }> {
  const { width: W, height: H } = sizeFor(options.aspect);
  const seed = options.seed >>> 0;
  const palette = pickPalette(options.prompt);
  const composition = pickComposition(options.prompt);
  const rnd = mulberry32(seed);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D');

  // 背景
  const angle = rnd() * Math.PI * 2;
  const bg = ctx.createLinearGradient(
    W / 2 - Math.cos(angle) * W,
    H / 2 - Math.sin(angle) * H,
    W / 2 + Math.cos(angle) * W,
    H / 2 + Math.sin(angle) * H,
  );
  bg.addColorStop(0, palette.bg[0]);
  bg.addColorStop(0.55, palette.bg[1]);
  bg.addColorStop(1, palette.bg[2]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 光斑
  softCircle(ctx, W * (0.15 + rnd() * 0.7), H * (0.1 + rnd() * 0.5), Math.min(W, H) * 0.55, palette.accents[0], 0.28);
  softCircle(ctx, W * rnd(), H * rnd(), Math.min(W, H) * 0.4, palette.accents[1], 0.22);

  switch (composition) {
    case 'portrait':
      drawPortrait(ctx, W, H, palette, rnd);
      break;
    case 'landscape':
      drawLandscape(ctx, W, H, palette, rnd);
      break;
    case 'harbor':
      drawHarbor(ctx, W, H, palette, rnd);
      break;
    case 'architecture':
      drawArchitecture(ctx, W, H, palette, rnd);
      break;
    case 'product':
      drawProduct(ctx, W, H, palette, rnd);
      break;
    default:
      drawAbstract(ctx, W, H, palette, rnd);
  }

  // 颗粒 + 暗角
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.drawImage(grainOverlay(W, H), 0, 0);
  ctx.restore();
  const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  // 边线与署名
  const margin = Math.round(Math.min(W, H) * 0.045);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1;
  ctx.strokeRect(margin, margin, W - margin * 2, H - margin * 2);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = palette.ink;
  ctx.font = `500 ${Math.round(Math.min(W, H) * 0.022)}px "SF Mono", "JetBrains Mono", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", monospace`;
  ctx.fillText(`MIMEO · PROOF`, margin, H - margin * 1.9);
  ctx.globalAlpha = 0.55;
  ctx.fillText(
    `${PALETTE_LATIN[palette.name] ?? 'MIMEO PALETTE'} / ${compositionEn[composition]} / #${String(seed).padStart(6, '0').slice(-6)}`,
    margin,
    H - margin * 1.1,
  );
  ctx.restore();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/webp', 0.93),
  );
  if (!blob) throw new Error('图像编码失败');
  return { blob, width: W, height: H, style: palette.name };
}

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('已取消', 'AbortError'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('已取消', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export interface DemoChatInput {
  prompt: string;
  contextText: string;
  onDelta: (chunk: string) => void;
  signal: AbortSignal;
}

/** 离线模式下用结构化的创意模板回应，真正可用于推敲提示词 */
export function buildDemoChatText(input: DemoChatInput): string {
  const source = [input.contextText, input.prompt].filter(Boolean).join('\n').trim();
  const firstLine = source.split('\n')[0]?.slice(0, 60) || '一个尚未命名的画面';
  const palette = pickPalette(source);
  const composition = pickComposition(source);
  const subject = firstLine.replace(/^[#\s-]+/, '') || '主体';
  return [
    `## 创意方向`,
    `围绕「${subject}」建立一个${composition === 'abstract' ? '抽象而克制' : '有明确视觉重心'}的画面，主色落在${palette.name}。`,
    ``,
    `### 可用提示词`,
    `\`\`\`text`,
    `${subject}, ${composition === 'portrait' ? 'half-body portrait, rim light, shallow depth of field' : composition === 'harbor' ? 'lone traveler on a rain-soaked harbor dock, gantry cranes, volumetric fog, rim light' : composition === 'landscape' ? 'wide establishing shot, layered atmosphere, volumetric light' : composition === 'architecture' ? 'geometric architecture, strong perspective, dusk haze' : composition === 'product' ? 'studio product photography, softbox, reflective floor' : 'editorial abstract composition, flowing gradients, film grain'}, ${palette.name.toLowerCase()} palette, cinematic lighting, 35mm film grain, high detail`,
    `\`\`\``,
    ``,
    `### 镜头与光线`,
    `- 焦段：${composition === 'portrait' ? '85mm，压缩背景' : composition === 'architecture' ? '24mm，低机位仰拍' : composition === 'harbor' ? '40mm，低照度环境人像' : '35mm，环境叙事'}`,
    `- 光比：${palette.name.includes('霓虹') ? '硬光 + 彩色环境光' : '柔和侧逆光，保留暗部层次'}`,
    `- 构图：${compositionLabel[composition]}，主体偏移至三分线，留出呼吸空间`,
    ``,
    `### 建议迭代`,
    `1. 先用当前提示词生成 4 张确定方向；`,
    `2. 把满意的一张接到图像节点，再连入生成节点做图生图微调；`,
    `3. 用「+ 提示词」节点拆分主体、风格、光线，方便单独替换。`,
    ``,
    `> 当前为内置离线样例回复。在「设置 → 模型服务」填入任意 OpenAI 兼容服务的 Key 后，会切换到真实对话模型。`,
  ].join('\n');
}

export async function streamDemoChat(input: DemoChatInput): Promise<string> {
  const text = buildDemoChatText(input);
  const chunks = text.match(/[\s\S]{1,8}/g) ?? [text];
  let out = '';
  let pending = '';
  // 每 ~24 字提交一次，既保留打字感，又避免逐字触发整棵节点树重渲染
  for (const chunk of chunks) {
    await delay(12, input.signal);
    out += chunk;
    pending += chunk;
    if (pending.length >= 24) {
      input.onDelta(pending);
      pending = '';
    }
  }
  if (pending) input.onDelta(pending);
  return out;
}

export function demoSeed(prompt: string, index: number): number {
  return (hashString(prompt) + index * 7919) >>> 0;
}
