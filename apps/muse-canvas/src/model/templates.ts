import { uid } from '../lib/util';
import { createEdge, createNode, emptyDoc } from './factory';
import type { CanvasNode, Edge, ID, Project } from './types';
import { boundsOf, fitCamera } from './geometry';
import { renderDemoImage } from '../runtime/demoEngine';
import { addAsset } from '../store/assets';

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  tag: string;
  build: () => { nodes: CanvasNode[]; edges: Edge[] };
}

const link = (from: string, to: string) => createEdge(from, to);

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'storyboard',
    name: '分镜工作流',
    description: '提示词 → 分镜拆解 → 三个镜头并排生成，适合短片的视觉预演。',
    tag: '视频 / 分镜',
    build: () => {
      const scene = createNode('prompt', {
        x: 0,
        y: 0,
        w: 340,
        h: 250,
        title: '场景描述',
        text: '黄昏的旧车站，穿红色外套的女孩提着行李箱回头；暖色夕阳从侧面切进来，空气里有灰尘颗粒。',
      });
      const style = createNode('prompt', {
        x: 0,
        y: 290,
        w: 340,
        h: 170,
        title: '视觉风格',
        role: 'style',
        text: 'cinematic still, anamorphic lens, warm sunset backlight, 35mm film grain, muted color grade',
      });
      const chat = createNode('chat', {
        x: 420,
        y: 0,
        w: 420,
        h: 430,
        title: '分镜拆解',
        prompt: '把场景拆成三个连续镜头，分别给出景别、构图和一句话画面描述。',
        output: '',
      });
      const shots = [
        createNode('generate', {
          x: 900,
          y: 0,
          w: 380,
          h: 540,
          title: '镜头 1 · 全景',
          aspect: '16:9',
          count: 1,
          prompt: 'wide establishing shot, girl with red coat at the old station platform, dusk',
        }),
        createNode('generate', {
          x: 1320,
          y: 0,
          w: 380,
          h: 540,
          title: '镜头 2 · 中景',
          aspect: '16:9',
          count: 1,
          prompt: 'medium shot, girl turning back, suitcase in hand, warm rim light',
        }),
        createNode('generate', {
          x: 1740,
          y: 0,
          w: 380,
          h: 540,
          title: '镜头 3 · 特写',
          aspect: '16:9',
          count: 1,
          prompt: 'close-up, eyes catching the last light, dust particles in the air',
        }),
      ];
      return {
        nodes: [scene, style, chat, ...shots],
        edges: [
          link(scene.id, chat.id),
          link(scene.id, shots[0].id),
          link(scene.id, shots[1].id),
          link(scene.id, shots[2].id),
          link(style.id, shots[0].id),
          link(style.id, shots[1].id),
          link(style.id, shots[2].id),
          link(chat.id, shots[0].id),
          link(chat.id, shots[1].id),
          link(chat.id, shots[2].id),
        ],
      };
    },
  },
  {
    id: 'character',
    name: '角色设定',
    description: '一段角色描述配一张参考图，横向生成三视图与表情，保持设定统一。',
    tag: '角色 / 概念设计',
    build: () => {
      const character = createNode('prompt', {
        x: 0,
        y: 0,
        w: 340,
        h: 280,
        title: '角色设定',
        text: '来自亚热带港城的年轻信使，短发被海风吹乱，穿机能风防水夹克，肩上有旧皮革邮包，眼神警觉。',
      });
      const ref = createNode('prompt', {
        x: 0,
        y: 320,
        w: 340,
        h: 190,
        title: '风格与镜头',
        role: 'style',
        text: 'character sheet, three-quarter view, neutral studio light, clean grey background, concept art, high detail',
      });
      const sheet = createNode('generate', {
        x: 420,
        y: 0,
        w: 420,
        h: 620,
        title: '三视图',
        aspect: '3:4',
        count: 3,
        prompt: 'front view, side view, back view of the same character',
      });
      const portrait = createNode('generate', {
        x: 880,
        y: 0,
        w: 400,
        h: 560,
        title: '角色特写',
        aspect: '4:5',
        count: 2,
        prompt: 'close-up portrait, wind in hair, harbor lights bokeh',
      });
      return {
        nodes: [character, ref, sheet, portrait],
        edges: [
          link(character.id, sheet.id),
          link(ref.id, sheet.id),
          link(character.id, portrait.id),
          link(ref.id, portrait.id),
          link(sheet.id, portrait.id),
        ],
      };
    },
  },
  {
    id: 'product',
    name: '电商主图',
    description: '产品描述 + 材质风格 + 负面词，四宫格方形出图，可直接批量复现。',
    tag: '商业 / 电商',
    build: () => {
      const product = createNode('prompt', {
        x: 0,
        y: 0,
        w: 320,
        h: 220,
        title: '产品描述',
        text: '一支哑光黑色的香水瓶，磨砂玻璃，黄铜瓶盖，标签极简；放在湿润的黑色石材台面上。',
      });
      const style = createNode('prompt', {
        x: 0,
        y: 260,
        w: 320,
        h: 190,
        title: '风格',
        role: 'style',
        text: 'studio product photography, softbox lighting, reflective floor, luxury cosmetic campaign, 85mm macro',
      });
      const negative = createNode('prompt', {
        x: 0,
        y: 490,
        w: 320,
        h: 170,
        title: '负面提示词',
        role: 'negative',
        text: 'text, watermark, logo, clutter, distorted reflection, low quality',
      });
      const gen = createNode('generate', {
        x: 400,
        y: 0,
        w: 420,
        h: 600,
        title: '主图四宫格',
        aspect: '1:1',
        count: 4,
      });
      return {
        nodes: [product, style, negative, gen],
        edges: [link(product.id, gen.id), link(style.id, gen.id), link(negative.id, gen.id)],
      };
    },
  },
  {
    id: 'blank',
    name: '空白画布',
    description: '只放一张提示词节点，从零开始。',
    tag: '通用',
    build: () => {
      const prompt = createNode('prompt', { x: 0, y: 0, w: 340, h: 240, title: '提示词' });
      return { nodes: [prompt], edges: [] };
    },
  },
];

export function templateById(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

const STARTER_PROMPT =
  '一位穿米色风衣的旅人站在雨后的港口，远处是雾中的货轮与起重机；冷蓝与暖金对撞，电影感逆光，35mm 颗粒，克制而孤独的氛围。';

const STARTER_STYLE =
  'cinematic still, anamorphic lens, soft rim light, muted teal-and-gold palette, 35mm film grain, shallow depth of field, high detail';

const STARTER_OUTPUT = `## 三个分镜
1. **全景** — 雨后的港口，旅人背对镜头站在栈桥尽头，雾中的货轮只剩轮廓。
2. **中景** — 侧逆光切过风衣领口，旅人抬手压住被风吹起的帽檐，暖金光落在尘雾里。
3. **特写** — 潮湿的码头地面映出远处的灯，行李箱轮子碾过水洼，画面安静下来。

> 这三行可以直接作为三个图像生成节点的提示词；也可以把满意的一张接回生成节点，做同角色的连续镜头。

**下一步**：选中「主视觉」节点，点击右下角「运行」；或在「设置 → 模型服务」接入自己的 OpenAI 兼容服务。`;

/** 首次打开时的示例工程，附带三张离线引擎渲染的示例图 */
export async function buildStarterProject(): Promise<Project> {
  const now = Date.now();
  const promptNode = createNode('prompt', {
    x: 100,
    y: 150,
    w: 340,
    h: 260,
    title: '画面提示词',
    text: STARTER_PROMPT,
  });
  promptNode.z = 3;
  const styleNode = createNode('prompt', {
    x: 100,
    y: 450,
    w: 340,
    h: 190,
    title: '风格与质感',
    role: 'style',
    text: STARTER_STYLE,
  });
  styleNode.z = 3;
  const genNode = createNode('generate', {
    x: 500,
    y: 150,
    w: 400,
    h: 600,
    title: '主视觉 · 港口旅人',
    aspect: '3:4',
    count: 2,
    seed: 8128,
  });
  genNode.z = 3;
  const chatNode = createNode('chat', {
    x: 950,
    y: 150,
    w: 430,
    h: 430,
    title: '创意总监',
    prompt: '把上面的画面延展成三个分镜，保持同一角色与色调。',
    output: STARTER_OUTPUT,
  });
  chatNode.z = 3;
  const noteNode = createNode('prompt', {
    x: 950,
    y: 620,
    w: 430,
    h: 200,
    title: '怎么用',
    role: 'note',
    text: '· 拖动画布空白处平移，滚轮缩放，⌘/Ctrl + 滚轮以光标为中心缩放\n· 从节点右侧圆点拖到另一个节点，建立输入关系\n· 选中节点后按 R 运行，⌘/Ctrl + K 打开命令面板\n· 所有内容自动保存在本机浏览器，可随时导出工程',
  });
  noteNode.z = 3;
  const groupNode = createNode('group', {
    x: 52,
    y: 86,
    w: 1420,
    h: 760,
    title: '欢迎 · 从一段提示词开始',
  });
  groupNode.z = 1;
  if (groupNode.kind === 'group') {
    groupNode.memberIds = [promptNode.id, styleNode.id, genNode.id, chatNode.id, noteNode.id];
  }

  const nodes: CanvasNode[] = [groupNode, promptNode, styleNode, genNode, chatNode, noteNode];
  const edges: Edge[] = [
    createEdge(promptNode.id, genNode.id),
    createEdge(styleNode.id, genNode.id),
    createEdge(promptNode.id, chatNode.id),
  ];

  // 首次启动时同步渲染示例图；离线可用，不依赖任何 API Key
  try {
    const outputs: ID[] = [];
    for (let i = 0; i < 2; i++) {
      const seed = 8128 + i * 137;
      const image = await renderDemoImage({
        prompt: `${STARTER_PROMPT} ${STARTER_STYLE}`,
        aspect: '3:4',
        seed,
      });
      const asset = await addAsset(image.blob, {
        name: `港口旅人 · 示例 ${i + 1}`,
        source: 'generation',
        prompt: STARTER_PROMPT,
        model: 'demo/muse-1',
        seed,
        width: image.width,
        height: image.height,
      });
      outputs.push(asset.id);
    }
    if (genNode.kind === 'generate') genNode.outputs = outputs;
  } catch (error) {
    console.warn('[muse] 示例图生成失败', error);
  }

  const doc = { ...emptyDoc(), nodes, edges };
  const bounds = boundsOf(nodes.filter((n) => n.kind !== 'group'));
  const camera = bounds
    ? { ...fitCamera(bounds, { w: 1440, h: 900 }, 100, 0.75), auto: true }
    : { x: 0, y: 0, zoom: 0.8, auto: true };

  return {
    id: uid('p'),
    name: '起源 · 港口旅人',
    createdAt: now,
    updatedAt: now,
    nodeCount: nodes.length,
    doc,
    camera,
  };
}
