# 精品游戏视觉提示词手册

> 本手册的目标不是让画面「更花」，而是让画面「更贵」。
> 贵，不来自更多特效和更高饱和度，而来自四件事：
> **克制**（有限色板、有限光源、有限元素）、**层次**（前中后景、粗糙度变化、信息层级）、
> **材质物理**（微表面结构、菲涅尔反射、次表面散射、真实磨损）、
> **叙事痕迹**（谁用过它、它经历过什么、它为什么在这里）。
> 廉价感的本质是「一切都是新的、均匀的、居中的、发光的」；
> 精品感的本质是「一切都有来历、有重量、有取舍」。
> 本文所有提示词均可直接复制使用，并附带对应的负面词与使用说明。

---

## 目录

1. [文档用途与使用方式](#1-文档用途与使用方式)
2. [廉价感诊断：游戏为什么看起来「便宜」](#2-廉价感诊断游戏为什么看起来便宜)
3. [万能品质底座（Master Quality Block）](#3-万能品质底座master-quality-block)
4. [材质与质感提示词库](#4-材质与质感提示词库)
5. [光照与色彩提示词库](#5-光照与色彩提示词库)
6. [镜头、构图与场面调度](#6-镜头构图与场面调度)
7. [角色精品化提示词](#7-角色精品化提示词)
8. [场景与关卡氛围提示词](#8-场景与关卡氛围提示词)
9. [UI / HUD / 图标精品化](#9-ui--hud--图标精品化)
10. [特效 / VFX 精品化](#10-特效--vfx-精品化)
11. [动画与动态质感](#11-动画与动态质感给分镜动态预览用)
12. [负面提示词总表](#12-负面提示词总表)
13. [完整拼装示例](#13-完整拼装示例)
14. [使用检查清单](#14-使用检查清单)

---

## 1. 文档用途与使用方式

### 1.1 适用场景

| 场景 | 用法 | 重点章节 |
|---|---|---|
| 概念图（Concept Art） | 直接生成 / 给外包的美术指导语言 | §3、§5、§6、§8 |
| 角色设计 | 立绘、三视图、角色海报 | §4、§7 |
| 场景与关卡 | 氛围图、关卡 Blockout 的目标图 | §5、§6、§8 |
| UI / HUD / 图标 | 界面风格探索、图标批量生成 | §9 |
| VFX 参考 | 技能、爆炸、环境特效的静帧参考 | §10 |
| 过场 / 分镜 | Storyboard、动态预览（Previz）描述 | §6、§11 |
| 营销图 / KV | 商店页、宣传海报 | §3、§6、§13 |

本手册同时服务两类读者：
- **用 AI 生图的人**：直接复制提示词块，按 1.2 的顺序拼接。
- **做美术评审 / 写外包需求的人**：把提示词当作「视觉规范语言」使用，§2 的诊断表可直接用于反馈意见。

### 1.2 提示词拼接顺序（推荐骨架）

一条高质量提示词按以下顺序拼接，**从「是什么」到「怎么拍」再到「什么品质」**：

```text
[主体与叙事] → [风格基调/底座] → [材质细节] → [光照方案] → [色彩管理] → [镜头与构图] → [后期与画质约束] → [负面提示词]
```

示例骨架（英文为主，生图更稳）：

```text
(subject with story), (art direction base from §3),
(material callouts from §4), (lighting scheme from §5),
(color discipline from §5.11), (camera & composition from §6),
(post-processing & fidelity), --no / Negative: (block from §12)
```

拼接原则：

- **主体永远在最前**。模型对开头 20~30 个词的权重最高，不要把 "cinematic lighting" 放在主体前面。
- **一条提示词只解决一张图**。不要在同一条里同时要求「角色特写」和「广阔场景」。
- **材质词跟着主体走**。写 "brushed steel pauldron with edge wear"（肩甲）比孤立地写 "metal texture" 有效得多。
- **负面词永远不省略**。§12 的总表是本手册的地基，任何输出都应挂上。

### 1.3 权重写法

不同工具的权重语法不同，按需替换：

| 工具 | 语法 | 示例 |
|---|---|---|
| Stable Diffusion / ComfyUI | `(词:权重)` | `(subsurface scattering:1.3)` |
| Midjourney | `词::权重` 与 `--no` | `worn leather::1.5 --no plastic` |
| DALL·E / 通用对话式模型 | 自然语言强调 | `emphasize the worn leather, absolutely no plastic sheen` |
| NovelAI | `{词}` 加权 / `[词]` 降权 | `{{rim light}}` |

权重使用纪律：

- 单个词权重不超过 **1.4**（SD 语法），否则会破坏构图。
- 每条提示词加权的词**不超过 3 个**，把权重留给「最容易被模型忽略的物理细节」（如 subsurface scattering、roughness variation），而不是留给 "masterpiece" 这类空词。
- 负面词一般不需要加权，靠数量与准确性生效。

---

## 2. 廉价感诊断：游戏为什么看起来「便宜」

评审图像或搭建提示词前，先过一遍这张表。左列是廉价信号（也是你要写进负面词的东西），右列是精品替代（写进正面词）。

| # | 廉价信号 | 为什么显得便宜 | 精品替代 | 对应正面提示词片段 |
|---|---|---|---|---|
| 1 | 塑料高光（所有材质一个反光度） | 现实中每种材质的粗糙度都不同；统一高光=没做材质分离 | 按材质区分粗糙度，金属/皮革/布料各有反射行为 | `distinct roughness per material, no uniform specular` |
| 2 | 纯色平面（大面积无变化的填充色） | 现实表面永远有微小的颜色与明度波动 | 加入色相微偏移、脏迹、渐变 | `subtle albedo variation, hand-painted color noise` |
| 3 | 全图过饱和 | 高饱和是廉价手游吸引眼球的惯用手段，观众已形成条件反射 | 限制色板，饱和度只留给视觉焦点 | `restrained color palette, saturation reserved for focal point` |
| 4 | 廉价发光描边（角色/物品一圈纯色 glow） | 描边发光是最低成本的「突出主体」手段 | 用边缘光（rim light）和明度对比区分主体 | `rim lighting separation instead of glowing outline` |
| 5 | 居中摆拍、正面对称 | 像证件照和素材库贴图，没有叙事 | 三分法、视线引导、动势线 | `off-center composition, rule of thirds, dynamic posing` |
| 6 | UI 使用默认系统字体 | 立刻暴露「没有请 UI 设计师」 | 定制或授权字体，字重与字距有设计 | `custom typography, deliberate kerning and weight hierarchy` |
| 7 | 均匀平光（无方向、无阴影层次） | 光没有来源=场景没有真实感 | 明确主光源方向，有阴影形状设计 | `single motivated key light, designed shadow shapes` |
| 8 | 低多边形硬边 + 塑料着色 | 面数低不是问题，低面数配廉价 shader 才是 | 风格化也要有法线细节与边缘倒角 | `beveled edges, normal map detail even on stylized assets` |
| 9 | 贴图明显重复（tiling 肉眼可见） | 重复图案暴露资产复用 | 破除重复：贴花、污渍层、植被遮挡 | `broken-up tiling with decals, grime layers, overgrowth` |
| 10 | 角色皮肤蜡感 / 硅胶感 | 缺少次表面散射与皮肤微结构 | SSS、毛孔、微绒毛、血色分区 | `subsurface scattering, visible pores, peach fuzz, natural skin redness zones` |
| 11 | 特效是纯色光球 / 加法混合糊一片 | 纯 additive 粒子没有体积和物理依据 | 粒子有形状、衰减、烟尘残留、热扭曲 | `volumetric particles with decay, smoke residue, heat distortion` |
| 12 | 背景空无一物或随机摆放道具 | 空间没有被「使用过」，没有生活痕迹 | 环境叙事：磨损、堆放逻辑、人的痕迹 | `environmental storytelling, wear and tear, signs of habitation` |
| 13 | 万物崭新，零磨损 | 新出厂的世界=没有历史的世界 | 边缘磨损、包浆、修补痕迹 | `edge wear, patina, visible repairs and mends` |
| 14 | 光效滥用 Bloom，全屏泛光 | Bloom 盖住细节，是遮丑手段 | Bloom 只出现在真正的高亮度光源上 | `restrained bloom only on emissive sources` |
| 15 | 比例失真的「大头娃娃感」配饰 | 配饰没有重量与佩戴逻辑 | 配饰有悬挂点、受重力下垂、压出褶皱 | `accessories with believable weight, straps deforming fabric` |
| 16 | 色板互相打架（每个元素都想抢眼） | 没有视觉层级=观众不知道看哪 | 70/25/5 色彩配比，一处高光焦点 | `70-25-5 color ratio, single point of highest contrast` |

**使用方法**：评审时逐条打勾。命中 3 条以上，优先修光照与材质（第 1、7、10 条），这三条对「廉价感」的贡献最大。

---

## 3. 万能品质底座（Master Quality Block）

底座是拼在主体描述之后的「品质合同」。以下三套按项目风格选一套，**不要混用**。

### 3.1 底座 A：写实 / 次世代（Realistic / Next-Gen）

中文说明：面向 PBR 写实管线的项目（3A 向、写实射击、生存类）。核心是物理正确的材质分离、有依据的光照、克制的后期。刻意避免 "8k masterpiece" 式空词，改用可验证的物理描述。

```text
physically based rendering look, accurate material separation with distinct
roughness and metalness per surface, micro-surface imperfections (fingerprints,
dust film, micro-scratches), grounded contact shadows,
single motivated key light with soft fill and subtle rim, global illumination
bounce coloring the shadows, volumetric atmosphere at low density,
shot on a full-frame camera, 35mm lens, f/2.8, shallow but readable depth of field,
filmic tone mapping with soft highlight rolloff, ACES-like color response,
restrained palette with desaturated midtones, film grain at low opacity,
chromatic aberration only at extreme frame edges
```

配套负面词：

```text
plastic shader, uniform specular, waxy skin, oversaturated, HDR overcooked,
video game screenshot artifacts, flat ambient lighting, glowing outline,
cheap mobile game, low-poly plastic, stock asset look, sticker, clipart
```

### 3.2 底座 B：风格化精品（Stylized Premium）

中文说明：面向风格化项目（如《双影奇境》《哈迪斯》《原神》以上美术规格的手绘/半厚涂方向）。风格化 ≠ 儿童向廉价卡通，关键在于：形状设计有大中小节奏、笔触有方向性、色彩有限制、材质依然遵守光的物理。

```text
premium stylized art direction, confident shape language with clear
big-medium-small rhythm, hand-painted texture feel with directional
brushwork following form, simplified but physically grounded lighting
(clear key direction, bounced color in shadow), painterly edge control
(hard edges at focal point, soft edges elsewhere),
limited palette of 4-6 hues with controlled saturation peaks,
sculpted values readable in grayscale, subtle texture noise instead of
flat fills, cel-shading only with designed shadow shapes,
inspired by high-end animation film production quality
```

配套负面词：

```text
children's flash game, clipart, sticker art, thick black outline everywhere,
default cel-shade gradient, rainbow palette, oversaturated candy colors,
toy-like plastic, low-effort chibi, asset-store cartoon pack look
```

### 3.3 底座 C：东方美学 / 电影感（Eastern Aesthetic / Cinematic）

中文说明：面向武侠、仙侠、和风、水墨方向的项目。核心是「留白与呼吸感」：负空间参与构图，色彩接近矿物颜料（石青、赭石、朱砂），光是柔的、有雾气介质的，镜头语言借鉴华语电影摄影（低反差、长焦压缩、剪影）。

```text
cinematic eastern aesthetic, ink-wash influenced composition with generous
negative space, atmospheric depth through layered mist and haze,
mineral pigment palette (azurite blue, ochre, cinnabar red accents, ivory paper tones),
soft diffused light filtered through fog or paper screens,
long-lens compression flattening mountain layers, silhouette-driven staging,
low-contrast filmic grade with lifted blacks, muted saturation with a single
crimson or gold accent, texture of aged silk and rice paper in the rendering,
inspired by wuxia cinema cinematography
```

配套负面词：

```text
oversaturated fantasy MMO look, glowing neon aura, busy composition with no
negative space, plastic ancient costume, shiny synthetic silk, generic asian
fantasy clipart, sticker, cheap mobile game
```

---

## 4. 材质与质感提示词库

使用方法：材质词**必须绑定到具体物体**上（例如 "worn leather **jerkin**" 而非孤立的 "leather texture"）。每类给出正面词、避免词、一句使用说明。

### 4.1 金属（Metal）

```text
brushed metal with anisotropic highlights, edge wear revealing brighter bare
metal on corners and contact points, subtle oxidation in crevices,
fingerprint smudges on polished areas, distinct metalness response
```

避免词：`chrome-like uniform mirror, plastic-metal, glowing metal`
说明：金属的可信度来自「边缘亮、凹处脏」——磨损出现在被摸和被磕的位置，而不是随机分布。

### 4.2 皮革（Leather）

```text
full-grain leather with visible pore structure, creases at flex points,
darkened patina from handling, matte body with subtle sheen on worn ridges,
stitching pulling the surface into gentle puckers
```

避免词：`vinyl shine, rubber-like, smooth plastic leather`
说明：皮革=「哑光底 + 折痕处微亮 + 缝线牵拉变形」，缝线不牵动表面就是假皮。

### 4.3 织物（Fabric / Cloth）

```text
woven fabric with visible thread direction, soft fuzz on silhouette edges
(fabric fresnel), wrinkles gathering at seams and joints, slight color
variation between warp and weft, weight-appropriate draping
```

避免词：`flat painted cloth, shiny fabric, stiff cardboard folds`
说明：布料轮廓边缘要有绒毛感的亮边（织物菲涅尔），褶皱聚集在关节与缝合处。

### 4.4 皮肤（Skin）

```text
subsurface scattering with red translucency at ears, nostrils and fingertips,
visible pore texture varying by facial zone, peach fuzz catching rim light,
natural color zoning (forehead yellowish, cheeks reddish, jaw cooler),
subtle oiliness on T-zone only
```

避免词：`waxy skin, porcelain doll skin, uniform smooth skin, plastic sheen`
说明：皮肤的贵在于「分区」——颜色分区、油光分区、毛孔密度分区；全脸均匀=硅胶。

### 4.5 木头（Wood）

```text
wood grain following the cut direction, worn smooth and darkened where hands
touch, dry raised grain on weathered faces, chips and dents on edges,
old varnish partially rubbed off in traffic areas
```

避免词：`repeating wood texture, plastic laminate look, orange-brown flat wood`
说明：木纹要顺着切割方向，被摸的地方发亮变深，风吹日晒的面发灰起毛。

### 4.6 石材（Stone）

```text
stone with layered sediment strata or granite speckle, moss and water
staining following gravity, chipped edges revealing lighter fresh stone,
tool marks from carving, dirt accumulation in recessed carvings
```

避免词：`smooth grey blob, tiling stone texture, concrete-like flatness`
说明：石头的历史写在「重力方向的水渍」与「凹槽里的积灰」上。

### 4.7 玻璃（Glass）

```text
glass with accurate refraction and double-surface reflections, dust film and
smudges reducing clarity, slight green tint at thick edges, environment
visible through with distortion
```

避免词：`fully transparent invisible glass, uniform blue tint, glowing glass`
说明：完全干净透明的玻璃在画面里等于不存在；灰尘膜与边缘绿色是玻璃的「存在证明」。

### 4.8 陶瓷（Ceramic）

```text
glazed ceramic with soft broad highlights, crazing (fine crackle) in the
glaze, unglazed foot ring showing raw clay, tiny glaze pooling in recesses
```

避免词：`plastic white pot, perfect smooth ceramic, toy porcelain`
说明：釉面开片（crazing）与露胎的圈足是陶瓷区别于塑料的两个信号。

### 4.9 湿润表面（Wet Surfaces）

```text
wet surface with darkened albedo, mirror-like puddle reflections breaking on
surface bumps, water beading on waxed areas, drip trails following gravity,
higher contrast between wet and dry patches
```

避免词：`uniform gloss everywhere, blue-tinted wetness, plastic rain coat look`
说明：湿=「颜色变深 + 反射变锐」，且干湿边界要清晰，全场景均匀打湿即是廉价。

### 4.10 旧损 / 使用痕迹（Wear and Tear）

```text
believable wear pattern: edge wear on corners, polish on grip areas,
scratches aligned with usage direction, repairs with mismatched materials,
labels half peeled, story told through damage
```

避免词：`random scratches everywhere, uniform dirt overlay, grunge filter`
说明：磨损必须回答「谁、怎么用的」。随机划痕滤镜=grunge 贴图糊脸，是另一种廉价。

### 4.11 尘土与氧化（Dust & Oxidation）

```text
dust settling on upward-facing surfaces only, rim of dust around recently
moved objects, copper verdigris in drip patterns, rust blooming from seams
and bolts then streaking downward
```

避免词：`overall brown tint, dirt sprayed uniformly, texture overlay look`
说明：灰尘只落在朝上的面；锈从缝隙和螺栓「长」出来并向下流。方向性是关键。

### 4.12 丝绸（Silk）

```text
silk with sharp anisotropic sheen shifting across folds, high-frequency
narrow highlights, fluid draping with fine cascading wrinkles,
slight color shift between highlight and body (shot silk effect)
```

避免词：`shiny plastic satin, stiff silk, glowing fabric`
说明：真丝的高光是「窄而流动」的，随褶皱方向变化；宽而糊的高光是化纤感。

### 4.13 毛发（Hair / Fur）

```text
hair rendered in clumps with flyaway strands breaking the silhouette,
anisotropic highlight band following strand direction, root-to-tip color
gradation, individual strands catching rim light, natural volume at roots
```

避免词：`helmet hair, solid hair blob, plastic shine band, spaghetti strands`
说明：头发的贵在「碎发」——轮廓上必须有几根不听话的发丝，全部服帖=头盔。

### 4.14 珠宝（Jewelry / Gems）

```text
gemstone with internal refraction and fire, small facets each catching
distinct reflections, tiny inclusions proving natural origin, metal setting
with prong details and micro-scratches from wear
```

避免词：`glowing gem, flat colored glass, oversized cartoon jewel`
说明：宝石不发光，宝石「折射」。内部火彩与细小包裹体比体积更能表达贵重。

### 4.15 机甲涂层（Mech Coating）

```text
multi-layer mech paint: base primer visible through chipped topcoat,
panel lines with grime accumulation, decals and stencil markings partially
worn, heat discoloration near vents and thrusters, anti-scratch matte
sections vs glossy armor plates
```

避免词：`clean toy robot, single-color plastic armor, showroom finish`
说明：机甲的可信度=「分层涂装 + 剥落露底漆 + 排热口烧灼变色」，出厂新机是模型玩具。

---

## 5. 光照与色彩提示词库

光照是廉价与精品的第一分水岭。规则只有一条：**光要有来源、有方向、有目的（motivated lighting）**。

### 5.1 电影三点光（Three-Point Lighting）

```text
classic three-point lighting: warm key light from upper left at 45 degrees,
soft cool fill at quarter intensity, crisp rim light separating subject from
background, shadow side retaining visible detail
```

说明：适合角色立绘与海报。填充光强度压到主光的 1/4 左右，保留阴影层次。

### 5.2 体积光（Volumetric Light）

```text
volumetric light shafts through dust-laden air, god rays with visible decay
over distance, light scattering density suggesting air quality,
beams broken by window frames or foliage
```

说明：体积光必须「有介质理由」（灰尘、雾、水汽），无介质的光柱是特效贴片。

### 5.3 全局光照 / 反弹光（Global Illumination）

```text
global illumination bounce: warm sunlight bouncing off terracotta floor
tinting the shadow side, color bleeding from nearby surfaces,
no pure black shadows, ambient occlusion only in contact crevices
```

说明：阴影不是黑色，而是「被反弹光染色的暗部」。写明反弹面的颜色，模型会照做。

### 5.4 边缘光（Rim Light）

```text
narrow rim light tracing the silhouette from behind, intensity varying with
surface angle, catching hair strands and fabric fuzz, motivated by a visible
or implied backlight source
```

说明：边缘光是替代「廉价发光描边」的正确手段——它有方向、有强弱变化、有光源依据。

### 5.5 黄金时段（Golden Hour）

```text
golden hour sunlight at low angle, long soft-edged shadows, warm key against
cool blue sky fill, atmospheric haze increasing with distance,
sun kissing only the top edges of forms
```

说明：黄金时段的核心是「暖主光 + 冷天空补光」的互补对，以及被拉长的影子。

### 5.6 月光（Moonlight）

```text
moonlight scene: single cool desaturated key from above, deep but readable
shadows, warm practical lights (windows, lanterns) as accents,
blue-grey palette with preserved skin tones, stars visible in clean air
```

说明：夜景不是「白天调蓝」。月光下保留可读性，用暖色人造光源做对比锚点。

### 5.7 霓虹湿街（Neon Wet Street）

```text
rain-slicked street reflecting neon signage as stretched vertical smears,
practical neon as the only light sources, cyan-magenta split lighting on
subject, wet asphalt darkened with sharp mirror puddles,
steam rising from grates catching the glow
```

说明：霓虹场景的克制点：光源必须全部来自画内招牌，不加无来源的环境泛光。

### 5.8 室内窗光（Interior Window Light）

```text
soft north-window daylight raking across the room, sharp window-shaped light
patch on floor, deep falloff into interior shadow, dust motes in the beam,
occluded ambient in corners
```

说明：窗光的形状（投在地板上的亮块）本身就是构图元素，写明它落在哪里。

### 5.9 烛光（Candlelight）

```text
candlelight with steep quadratic falloff, warm orange core to deep brown
shadow within one meter, flickering suggested by uneven illumination,
faces lit from below or beside at intimate distance, wax glow through
translucent candle body
```

说明：烛光一米内就该暗下去。全屋亮堂的「烛光」是最常见的穿帮。

### 5.10 阴天漫射（Overcast Diffuse）

```text
overcast sky as a giant softbox, shadowless diffuse light, form defined by
occlusion and value shifts instead of cast shadows, muted saturated colors
reading clearly, distant fog merging ground and sky
```

说明：阴天光最考验材质——没有高光帮忙时，粗糙度差异必须靠固有色与环境遮蔽表达。

### 5.11 色彩管理纪律（拼接到任何一条光照之后）

中文说明：这一块是「色彩合同」，用自然语言向模型描述 ACES/filmic 的观感：高光缓慢滚降不死白、暗部有色彩不死黑、中间调略降饱和、全图只允许一个饱和度峰值。

```text
disciplined color management: limited palette of 3-5 hues, filmic highlight
rolloff (no clipped whites), lifted shadows retaining hue, desaturated
midtones with one deliberate saturation peak at the focal point,
complementary accents used sparingly, no rainbow spill, consistent white
balance across light sources unless narratively motivated
```

避免词：`oversaturated, vibrance boosted, HDR look, instagram filter, rainbow lighting`

---

## 6. 镜头、构图与场面调度

镜头语言是「摆拍感」与「电影感」的分界。以下片段可单独拼入任何提示词。

### 6.1 焦段（Focal Length）

| 焦段 | 用途 | 提示词 |
|---|---|---|
| 24mm 广角 | 场景纵深、压迫感、夸张前景 | `24mm wide-angle, exaggerated foreground scale, deep perspective` |
| 35mm | 叙事标准镜头、环境+人 | `35mm lens, natural perspective, subject in environment` |
| 85mm | 角色特写、背景压缩虚化 | `85mm portrait lens, compressed background, creamy bokeh` |
| 135mm+ 长焦 | 山水层叠、剪影、压缩空间 | `135mm telephoto compression stacking mountain layers` |

### 6.2 景深（Depth of Field）

```text
shallow depth of field at f/2, focus plane on the eyes, background dissolving
into readable bokeh shapes, foreground element blurred as framing device
```

说明：景深要「有焦点意图」。全图清晰像扫描件，全糊像手机人像模式翻车。

### 6.3 镜头高度（Camera Height）

```text
low-angle hero shot from waist height, subject gaining monumentality
```

```text
high-angle overlooking shot, subject diminished, environment dominating
```

说明：默认平视=监控摄像头。高度是叙事决定：仰拍给力量，俯拍给脆弱。

### 6.4 引导线与负空间（Leading Lines & Negative Space)

```text
composition with leading lines (road, railing, light shaft) converging toward
the subject, generous negative space giving the frame room to breathe,
horizon placed off-center
```

说明：负空间不是「没画完」，而是给视线留的呼吸区，东方美学项目（§3.3）尤其依赖它。

### 6.5 前景遮挡（Foreground Occlusion）

```text
out-of-focus foreground occlusion (branches, doorframe, shoulder) framing the
subject, creating voyeuristic depth, three distinct depth layers
```

说明：一层虚化前景立刻建立「前中后」三层空间，是成本最低的去廉价手段之一。

### 6.6 微对比与焦点控制（Micro-contrast & Focal Control）

```text
highest value contrast, sharpest edge and saturation peak all coinciding at
the single focal point, contrast tapering off toward frame edges
```

说明：明度对比、边缘锐度、饱和峰值三者必须汇聚在同一个焦点，否则观众视线涣散。

### 6.7 反摆拍纪律（写进负面词或指导语）

```text
Negative: centered symmetrical mugshot pose, subject floating on plain
background, sticker-like placement, all elements evenly spaced, catalog shot,
character staring blankly at camera
```

说明：「贴纸式摆放」= 元素之间没有遮挡、没有透视关系、间距均匀。让元素互相遮挡、
让角色与环境发生接触（手扶、倚靠、踩踏），摆拍感立刻消失。

---

## 7. 角色精品化提示词

角色贵不贵，看八件事：**面部微细节、皮肤 SSS、服装层叠与缝线、配饰重量感、发型结构、眼神高光、姿态自然、剪影清晰**。以下先给通用模块，再给四套完整示例。

### 7.1 通用角色品质模块（拼在角色描述后）

```text
face with zone-varied pore detail and subsurface scattering, natural
asymmetry, single catchlight in each eye placed consistently with key light,
layered costume with visible construction (seams, stitching, lining edges),
accessories hanging with believable weight and deforming the fabric beneath,
hair in structured clumps with flyaway strands, relaxed asymmetric pose with
weight on one leg, silhouette readable as a solid black shape
```

### 7.2 完整示例一：写实战士（Realistic Warrior）

中文说明：解决的廉价问题——盔甲塑料感、皮肤蜡感、装备无重量。用底座 A。

```text
A veteran mercenary in her forties, scarred cheek and wind-burned skin with
visible pores and subsurface scattering at ears and nose, tired but alert
eyes with a single sharp catchlight. Battle-worn plate armor: brushed steel
with edge wear on pauldron rims, straps pulling leather padding into creases,
dents hammered roughly back into shape, dried mud in the greaves' recesses.
A heavy wool cloak with frayed hem, weight visible in its drape.
Overcast diffuse light with a weak cool rim from behind, muted earth palette
with one deep red sash as the saturation peak. 85mm lens, f/2.8, focus on the
eyes, low-angle from chest height, off-center composition.
physically based material separation, filmic highlight rolloff.
Negative: waxy skin, plastic armor, glowing outline, oversaturated,
centered mugshot pose, clean showroom equipment, cheap mobile game
```

### 7.3 完整示例二：风格化法师（Stylized Mage）

中文说明：解决的廉价问题——儿童卡通感、彩虹配色、贴纸构图。用底座 B。

```text
An elderly stylized mage with confident shape language: tall triangular
silhouette, oversized hood casting a designed shadow shape over deep-set
painted eyes with warm catchlights. Hand-painted robe in three layered
fabrics: heavy felted wool outer, worn linen inner, a silk stole with narrow
anisotropic sheen; visible stitching and patched elbows. Wooden staff with
grain following its curve, grip area polished dark by decades of use, one
small ember-lit crystal (refracting, not glowing). Limited palette: deep
teal, ochre, ivory, with a single cinnabar accent at the crystal.
Painterly key light from the crystal below-left, bounced warm fill,
grayscale-readable values. 35mm lens, figure off-center against generous
negative space, no outline. Premium stylized rendering, directional
brushwork following form.
Negative: children's flash game, rainbow palette, thick black outline,
sticker art, glowing aura, toy-like plastic, chibi proportions
```

### 7.4 完整示例三：科幻机甲驾驶员（Sci-fi Mech Pilot）

中文说明：解决的廉价问题——出厂新机感、均匀高光、无使用痕迹。用底座 A + §4.15。

```text
A mech pilot climbing out of an open cockpit, pressure suit with layered
construction: matte anti-scratch fabric panels, glossy polymer joints with
micro-scratches, cable bundles with believable sag and weight. Helmet under
one arm, hair compressed with sweat, skin flushed with subsurface warmth from
exertion, tired eyes with cockpit-HUD-colored catchlight. The mech behind:
multi-layer paint with chipped topcoat revealing grey primer, stencil
markings half worn, heat discoloration streaking from vents, grime settled
along panel lines, hydraulic fluid weeping at one seam. Hangar lighting:
cold overhead floods as key, warm sodium work lamps as accents, volumetric
haze from coolant vapor. 35mm lens from low angle, pilot small against the
machine for scale, foreground crew silhouette as occlusion layer.
Filmic rolloff, desaturated industrial palette with one warning-orange peak.
Negative: clean toy robot, showroom finish, plastic suit, uniform specular,
glowing outline, oversaturated, centered composition, stock asset look
```

### 7.5 完整示例四：东方侠客（Wuxia Swordsman）

中文说明：解决的廉价问题——化纤古装、MMO 光污染、构图拥挤。用底座 C。

```text
A lone swordsman standing at the edge of a mist-filled bamboo grove, seen
from behind at three-quarter angle, silhouette clean against layered fog.
Robe of coarse hand-woven ramie over a raw silk under-layer with narrow
flowing highlights, wind pressing the fabric against his back and revealing
body structure, frayed cuffs and a mended tear at the shoulder. A plain
sword scabbard of lacquered wood, lacquer worn matte at the carry point.
Hair tied with a simple cord, loose strands lifted by wind catching a pale
rim light. Ink-wash composition: figure occupying the lower third, generous
negative space above, bamboo layers dissolving into mist by distance.
Mineral palette of ivory, faded indigo and grey-green with a single cinnabar
tassel accent. Soft overcast key filtered through fog, 135mm telephoto
compression, low-contrast filmic grade with lifted blacks.
Negative: oversaturated fantasy MMO, glowing aura, shiny synthetic silk,
busy composition, plastic costume, neon rim light, cheap mobile game
```

---

## 8. 场景与关卡氛围提示词

场景的贵，一半在「空间层次」（前中后景、尺度参照物、大气透视），一半在「环境讲故事」（谁住过、发生过什么）。

### 8.1 通用场景品质模块

```text
three distinct depth layers with atmospheric perspective, human-scale
reference object grounding the scale, environmental storytelling through
wear patterns and inhabitant traces, weather and time of day committed and
consistent, broken-up texture tiling with decals and organic overgrowth
```

### 8.2 完整示例一：废墟都市（Ruined City）

中文说明：解决的廉价问题——废墟=随机碎石堆、无生活痕迹、灰蒙蒙一片没有焦点。

```text
A collapsed elevated highway curving through an overgrown ruined city,
nature reclaiming in believable stages: moss on north faces, birch saplings
in drift-soil pockets, vines following water drainage paths. Human traces
telling a story: a barricade of furniture at one doorway, faded evacuation
signage, a rain-bleached child's bicycle. Three depth layers: rusted car
foreground (occlusion, out of focus), the highway arc midground with a tiny
scavenger figure for scale, tower skeletons dissolving into haze behind.
Golden hour side light raking across broken concrete revealing surface
detail, long shadows, warm key against cool open-shade fill. Desaturated
concrete palette, saturation reserved for the scavenger's red pack (focal
peak). 24mm wide-angle, low camera height in the weeds.
Negative: uniform grey rubble, random debris scatter, flat ambient light,
tiling texture repetition, oversaturated post-apocalypse orange-teal,
empty lifeless background, stock asset look
```

### 8.3 完整示例二：山林神庙（Mountain Forest Temple)

中文说明：解决的廉价问题——「亚洲风贴图包」感、崭新庙宇、无信仰痕迹。

```text
A weathered stone temple half-swallowed by ancient forest, morning after
rain. Stone steps bowed and polished in the center by centuries of bare
feet, moss thick on the untrodden edges. Signs of living faith: fresh
incense smoke ribboning in a volumetric light shaft, small fruit offerings,
a monk's broom leaning mid-task, prayer cloth faded in bands by sun.
Wet stone darkened with sharp puddle reflections, dry patches under the
eaves showing the contrast. Canopy-filtered god rays with drifting spore
dust as the medium. Depth: dripping foreground leaves out of focus, temple
midground, mountain ridges layered into mist. Mineral palette of grey-green,
ochre and ivory, single vermilion door as saturation peak. 35mm lens at
pilgrim's eye height on the steps.
Negative: brand-new temple, asian fantasy clipart, oversaturated foliage,
uniform stone texture, empty sterile courtyard, glowing magic particles,
theme-park look
```

### 8.4 完整示例三：豪华室内（Luxury Interior）

中文说明：解决的廉价问题——「土豪金」滥用、材质全反光、样板间无人味。

```text
A private library-lounge in an old-money estate, wealth expressed through
material truth not gold: book spines with cracked lettering, full-grain
leather chesterfield with sitting creases and darkened armrest patina,
walnut paneling with wax sheen only where hands touch, a silk rug worn
threadbare in the walking path. Lived-in evidence: reading glasses on an
open book, whisky glass with a fingerprint, ash in the fireplace.
North-window daylight as soft key casting a window-shaped patch on the rug,
warm fire glow as counter-accent, dust motes in the beam. Deep filmic
shadows with lifted detail, palette of oxblood, walnut brown, brass and
ivory, restrained saturation. 35mm lens at seated eye level, foreground
armchair edge as occlusion framing.
Negative: gold-everything nouveau riche, uniform glossy surfaces, showroom
staging, flat interior lighting, oversaturated warm filter, catalog
furniture arrangement, sterile untouched room
```

### 8.5 完整示例四：雨夜港湾（Rainy Night Harbor）

中文说明：解决的廉价问题——夜景一片蓝、无来源光、湿表面全场均匀反光。

```text
A working fishing harbor at night in steady rain, every light source
practical and motivated: sodium dock lamps in warm pools with steep falloff,
a cold blue-white trawler work light, neon noodle-bar sign reflecting as
stretched smears on wet planking. Wet-dry contrast: soaked boards darkened
with mirror puddles, sheltered patches under awnings staying matte.
Story in the details: coiled ropes swollen with water, fish crates stacked
with use-logic, gutting knife left mid-work, gulls sheltering under a hull.
Rain visible only where it crosses light beams, drips tracing gravity off
rigging. A single figure in oilskins as scale and focal point, backlit rim
from the trawler light. Deep blue-black palette, warmth reserved for the
lamp pools, neon red as the one saturation peak. 50mm lens, low angle
across the puddled boards using reflections as leading lines.
Negative: uniform blue night filter, sourceless ambient glow, evenly wet
gloss everywhere, empty staged dock, oversaturated neon everywhere,
plastic rain, cheap mobile game night scene
```

---

## 9. UI / HUD / 图标精品化

UI 是玩家看到时间最长的美术资产，也是廉价感最先暴露的地方。三条铁律：
**不用默认系统字体；不用纯白描边和廉价渐变（双色线性渐变+高光斜杠）；控件必须材质化**（UI 元素也回答「我是什么材质做的」——磨砂玻璃、拉丝金属、羊皮纸、漆面）。
另外两条纪律：**间距节奏**（统一的 4/8px 网格，留白本身是设计）与**信息层级**（一屏只有一个主操作，字重/明度/尺寸三者共同表达层级）。

### 9.1 主菜单（Main Menu）

```text
premium game main menu screen, custom display typeface with deliberate
kerning, strict spacing rhythm on an 8px grid, clear hierarchy: one primary
action visually dominant, secondary options recessed in value.
Materialized panels: frosted dark glass with subtle inner shadow and 1px
edge highlight, background artwork dimmed and blurred behind the UI layer,
restrained two-hue palette matching the game's grade, micro-interactions
implied by a softly lit focused state. No decorative clutter.
Negative: default system font, pure white outlines, cheap two-color
gradient buttons, drop shadows at 90 degrees, clipart icons, oversaturated
buttons, mobile-game coin and gem badges
```

### 9.2 战斗 HUD（Combat HUD）

```text
minimal diegetic-leaning combat HUD, health and resource bars with
materialized frames (brushed gunmetal with worn edges), inner bar fill with
subtle texture and end-cap glow only at the leading edge, damage feedback
via brief desaturation not red vignette spam, typography: compact custom
numerals with tabular spacing, all elements anchored to a consistent margin
grid, 70% of screen untouched by UI.
Negative: default font numbers, thick white outlined icons, full-screen red
flash, oversized minimap frame, gradient-heavy skill buttons, cluttered
corners, free-to-play mobile HUD look
```

### 9.3 道具图标（Item Icons）

```text
game item icon set, each item rendered as a physical object with consistent
key light from upper left, per-material response (leather matte, metal
anisotropic, glass refractive), slight 3/4 top-down angle, silhouette
readable at 64px, background a quiet material plate (dark slate) not a
radial gradient burst, rarity expressed via frame material (iron, silver,
gold-inlaid) not via glowing outline color.
Negative: glowing outline, radial gradient background, sticker style, flat
clipart, oversaturated rarity glow, inconsistent lighting between icons,
stock icon pack look
```

### 9.4 弹窗 / 对话框（Modal Dialog)

```text
game modal dialog, materialized panel (aged parchment / frosted glass /
lacquered wood — match game setting), 1px crafted border instead of thick
outline, title in display face, body in a readable text face with 1.5 line
height, buttons with distinct primary-secondary weight, backdrop dimmed
40% with slight blur, entry implied by soft settle not bounce.
Negative: default font, pure white border, cheap gradient header bar,
red X button from OS, exclamation clipart, drop-shadow halo
```

---

## 10. 特效 / VFX 精品化

VFX 廉价三件套：**纯色光球、加法混合糊屏、无残留瞬时消失**。精品替代的原则：
粒子有**体积与衰减**（近实远虚、生命周期内变色变形）、有**物理依据**（热上升、烟滞留、碎屑抛物线）、有**事后痕迹**（残影、热扭曲、烧灼贴花、余烬）。

### 10.1 技能释放（Skill Cast）

```text
spell cast VFX concept: energy gathering as visible flow lines converging to
the hand, particles with individual shape and lifetime (spark motes cooling
from white to ember red), volumetric core with soft occlusion by the
fingers, heat distortion rippling above, faint smoke residue drifting after
release, ground dust kicked outward by the pressure wave, light from the
spell actually illuminating the caster's face and sleeve
Negative: flat glowing ball, pure additive blob, single-color energy,
outline glow, particles ignoring gravity and wind, no environmental
light response
```

### 10.2 爆炸（Explosion）

```text
explosion VFX concept in phases: initial white-hot flash one frame,
fireball with internal volumetric rolling (dark smoke folding into orange
core), debris and sparks on ballistic arcs with motion blur, pressure ring
disturbing dust on the ground plane, aftermath lingering: black smoke
column, drifting embers, scorch decal, small secondary fires
Negative: flat orange sphere, cartoon star burst, smokeless explosion,
instant disappearance, uniform yellow glow, sticker explosion
```

### 10.3 治愈（Healing）

```text
healing VFX concept: soft volumetric motes rising with believable buoyancy,
each mote a tiny refractive bead not a glow dot, gentle green-gold light
actually casting onto the character's upturned face and shoulders,
particles fading by shrinking and desaturating not popping, faint warm
afterglow lingering on the skin, restrained particle count — quality over
quantity
Negative: green plus-sign icons, swirling neon spiral, oversaturated lime
glow, particle spam, flat sprite circles, mobile-game sparkle burst
```

### 10.4 传送（Teleport）

```text
teleport VFX concept: body dissolving edge-first into fine particulate
following the silhouette, brief afterimage retaining the pose (motion
history), space distortion lensing the background at the departure point,
displaced air pulling dust inward then settling, arrival preceded by a
faint light cue then the reverse assembly, residual shimmer and heat-haze
lingering three seconds at both points
Negative: instant blink with no trace, blue cylinder beam, flat flash
frame, glowing outline dissolve, sticker lightning bolts
```

---

## 11. 动画与动态质感（给分镜/动态预览用）

以下描述用于分镜、动态预览（Previz）、给动画师/外包的指导语言，也可拼入视频生成模型的提示词。

### 11.1 重量（Weight）

```text
weight conveyed through anticipation and follow-through: heavy sword needs
wind-up, drags the shoulders, sinks on impact; footsteps compress and push
off, body mass shifting ahead of the step
```

说明：重量不是慢，而是「预备—发力—跟随」的时间分配。轻飘=没有预备动作。

### 11.2 惯性（Inertia）

```text
inertia in every start and stop: nothing reaches full speed instantly,
overshoot and settle at the end of fast moves, loose parts (hair, straps,
cloth) lagging one to three frames behind the body
```

### 11.3 接触反馈（Contact Feedback）

```text
contact moments sell the hit: one-frame impact deformation, camera shake
scaled to mass, hit-stop of two to four frames on heavy blows, dust or
fabric ripple radiating from the contact point
```

### 11.4 布料二次运动（Cloth Secondary Motion）

```text
cloth secondary motion: cape and sleeves driven by body motion with delay
and damping, settling in diminishing waves, wind adding low-frequency
drift, fabric weight consistent with its material (silk floats, wool swings)
```

### 11.5 镜头呼吸（Camera Breathing）

```text
handheld-style camera breathing: subtle drift and micro-corrections even in
"static" shots, slight lag when tracking fast subjects then catch-up,
lens-appropriate shake (long lens amplifies), never perfectly locked-off
unless narratively deliberate
```

说明：完全静止的机位=引擎默认摄像机。极轻微的漂移与追焦滞后立刻产生「有人在拍」的电影感。

---

## 12. 负面提示词总表

可直接整段复制。按模块分组，生图时可全量挂载，也可按资产类型裁剪。

```text
cheap mobile game, free-to-play asset flip, stock asset look, asset store
pack, clipart, sticker, toy-like, low-effort,
plastic shader, uniform specular, waxy skin, porcelain doll skin, vinyl
shine, plastic armor, plastic silk, rubber cloth, low-poly plastic,
oversaturated, vibrance boosted, rainbow palette, candy colors, neon spam,
HDR overcooked, instagram filter, clipped highlights, pure black shadows,
flat ambient lighting, sourceless glow, uniform lighting, no shadows,
glowing outline, thick black outline everywhere, glowing aura, lens flare
spam, full-screen bloom, red damage vignette spam,
centered symmetrical mugshot pose, subject floating on plain background,
catalog shot, evenly spaced elements, sticker-like placement, empty
lifeless background,
visible texture tiling, repeating patterns, grunge overlay filter, random
scratches everywhere, uniform dirt,
brand-new showroom equipment, untouched sterile environment, factory-fresh
everything,
default system font, pure white outlines, cheap two-color gradient, radial
gradient burst background, OS-style buttons,
flat glowing ball VFX, pure additive blob, single-color energy, particle
spam, smokeless explosion,
helmet hair, solid hair blob, spaghetti strands,
watermark, signature, text artifacts, jpeg artifacts, lowres, blurry,
bad anatomy, extra fingers, deformed hands
```

---

## 13. 完整拼装示例

每个示例 = 主体 + 底座 + 材质 + 光照 + 镜头 + 负面词的完整拼装，并注明它针对性解决的廉价问题。中文说明 + 英文提示词。

### 13.1 营销 KV：双人对峙（解决：居中摆拍 + 光污染）

中文意图：主宣传图，两名角色雨中对峙。用不对称构图与单一饱和峰值取代「双人居中站桩+全屏特效」。

```text
Key art: two rivals facing off on a rain-slicked rooftop at night, staged
asymmetrically — swordsman low in the left third, gunner elevated on an AC
unit right of center, sightline tension crossing the frame. Practical neon
from below as split key (cyan left, magenta right), rain visible only
through light beams, wet concrete with sharp broken reflections. Costume
material truth: soaked wool coat darkened and heavy, oiled leather holster
matte with worn sheen. Single saturation peak on the red blade tassel.
135mm telephoto compression, foreground railing occlusion out of focus,
filmic rolloff with lifted blacks.
Negative: centered symmetrical poses, glowing outlines, full-screen bloom,
oversaturated, plastic costumes, sourceless ambient glow, sticker
placement, cheap mobile game
```

### 13.2 角色立绘：商店页主角（解决：皮肤蜡感 + 服装无结构）

中文意图：写实主角半身像，商店页用。重点买「皮肤分区 + 服装缝制逻辑」。

```text
Store-page portrait of the protagonist, waist-up, 85mm lens at f/2.8, focus
on the eyes with a single key-consistent catchlight. Skin with zone-varied
pores, subsurface red at ears and nostrils, T-zone oil only, faint scar
tissue with different specular response. Costume built in believable
layers: linen shirt, waxed canvas jacket with visible seam allowances and
strained stitching at the shoulder, brass buttons with fingerprint patina.
Three-point lighting: warm key upper left, cool quarter fill, narrow rim
catching flyaway hairs. Desaturated palette, one teal accent scarf.
Off-center against a quiet textured backdrop, shoulder-line diagonal.
Negative: waxy skin, uniform smooth skin, flat painted cloth, plastic
buttons, centered mugshot, glowing outline, oversaturated, stock portrait
```

### 13.3 场景氛围图：地下集市（解决：背景空洞 + 均匀光照）

中文意图：给关卡组的目标氛围图。重点买「多光源分区 + 生活痕迹密度」。

```text
Underground black-market bazaar carved into old subway tunnels, every light
practical: strings of mismatched bulbs, a butcher's cold fluorescent, brazier
fires, each pooling with steep falloff and leaving honest darkness between
stalls. Lived-in density with placement logic: goods stacked by weight,
tarps patched with different materials, cables taped along walls following
real paths, condensation streaks on tile following gravity. Crowd as depth
layers — foreground shoulder occlusion, midground vendor haggling (focal
point, highest contrast), background silhouettes in steam. Palette of
sodium amber and cold teal, saturation reserved for the focal stall's
spice display. 35mm lens at eye height in the crowd.
Negative: uniform ambient light, empty staged corridor, random prop
scatter, texture tiling, oversaturated, flat grey walls, stock dungeon look
```

### 13.4 道具图标批次：武器套（解决：贴纸图标 + 发光描边稀有度）

中文意图：一批武器图标的统一规范。重点买「一致光照 + 材质化稀有度」。

```text
Weapon icon set, nine icons, consistent upper-left key light and 3/4
top-down angle across the set, each weapon a physical object: nicked blade
edges catching light, wrapped leather grips with wear at thumb position,
wood grain along hafts. Silhouettes readable at 64px. Background: uniform
dark slate material plate. Rarity via craftsmanship — common: plain iron
fittings; rare: silver inlay; legendary: gold filigree and aged gem — never
via outline glow.
Negative: glowing outline, radial gradient background, sticker style,
inconsistent lighting, oversaturated rarity colors, clipart, flat vector
look
```

### 13.5 技能特效参考：寒冰爆发（解决：纯色光球 + 无环境响应）

中文意图：给 VFX 组的静帧参考。重点买「冰的材质真实 + 光对环境的影响」。

```text
Ice burst skill VFX reference frame: jagged ice crystals erupting in a
radial arc, each shard with real refraction, internal fractures and frost
gradient from clear tip to opaque base, freezing mist rolling low and
hugging the ground, breath-like vapor wisps, frost decals crawling across
the floor with dendrite patterns, cold blue light from the ice genuinely
illuminating the caster's underside and nearby surfaces, fine snow
particulate settling afterward.
Negative: flat blue glowing ball, additive blob, single-color energy,
outline glow, no ground interaction, particle spam, sticker snowflakes
```

### 13.6 过场分镜帧：王座对话（解决：平光正反打 + 无镜头语言）

中文意图：过场分镜的关键帧。重点买「窗光叙事 + 前景遮挡 + 权力构图」。

```text
Cutscene storyboard frame: a petitioner kneeling before an aged regent, shot
from behind the petitioner's shoulder (foreground occlusion, out of focus),
low angle up toward the throne. Single north-window shaft as key, raking
across the regent's face and leaving the hall in readable gloom, dust motes
in the beam, gold throne detail catching only edge highlights. The regent's
velvet robe with crushed-pile sheen direction, ring-worn fingers on the
armrest patina. Composition: regent at upper-right power position, heavy
negative space of dark hall on the left, leading line of the carpet.
50mm lens, filmic low-contrast grade, palette of umber, oxblood and dust-gold.
Negative: flat evenly lit hall, centered symmetrical staging, shot-reverse
mugshots, oversaturated gold, plastic velvet, sourceless glow, videogame
cutscene stiffness
```

---

## 14. 使用检查清单

出图后 / 提交评审前，逐条自检。任何一条不过，回到对应章节修提示词。

1. **遮挡测试**：把图转成灰度，主体剪影是否依然清晰可读？（§7）
2. **光源指认**：画面里每一处亮部，你能指出它的光源吗？指不出的就是廉价光。（§5）
3. **材质三问**：随机指三个表面，它们的粗糙度是否明显不同？（§4）
4. **饱和峰值**：全图是否只有一个饱和度/对比度峰值，且落在焦点上？（§5.11、§6.6）
5. **崭新检查**：画面里有几件「刚出厂」的东西？超过一件就要补磨损与使用痕迹。（§4.10）
6. **重复检查**：放大看地面与墙面，肉眼能否发现贴图重复？（§2 第 9 条）
7. **描边检查**：主体的突出是靠边缘光与明度对比，还是靠发光描边？（§5.4）
8. **摆拍检查**：元素之间有没有遮挡与透视关系？有没有「贴纸式等距摆放」？（§6.7）
9. **阴影颜色**：暗部是死黑，还是被反弹光染色的暗？（§5.3）
10. **字体检查**（UI）：是否使用了默认系统字体或纯白描边？（§9）
11. **层次计数**：画面是否有可辨认的前、中、后三层？（§6.5、§8.1）
12. **叙事一问**：这个场景/道具/服装，能否回答「谁用过它」？（§8）
13. **VFX 残留**：特效结束后有没有留下烟、灼痕、余烬等痕迹？（§10）
14. **负面词挂载**：本次生成是否挂载了 §12 总表（或其裁剪版）？
15. **横向一致性**：与同项目已定稿资产并排摆放，光照方向、色板、磨损程度是否一致？

---

*本手册为工作室内部规范文档，随项目美术基准迭代更新。提示词以英文为主以保证生图稳定性；向外包与人类美术传达时，请配合各节的中文说明使用。*
