/**
 * assets/js/content/courses.js —— v3 课程内容层（8 个模块）
 *
 * 规则：
 *   - body 只允许受控 Markdown：标题、段落、列表、引用、行内/块代码、粗斜体。
 *   - [[formula:id]] / [[ref:id]] 由 content.js 渲染，不在正文写裸 URL。
 *   - demo 指向已注册的演示，不是任意代码；exercise 指向真实题目。
 *   - 合成数据结论不外推为普遍优胜；所有核心事实就近引用。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  var courses = [
    {
      id: 'm1',
      index: 1,
      title: '数据、目标与统计基础',
      prereq: [],
      level: 'L1',
      minutes: 90,
      summary: '先弄清预测目标、数据频率、趋势/季节/周期、训练验证测试边界，再谈模型。',
      topics: ['频率与时间戳', '趋势/季节/周期', '平稳性直觉', '切分与泄漏', '误差与偏差方差'],
      body: [
        '## 为什么先看数据',
        '',
        '预测任务的第一步不是选模型，而是把问题写清楚：预测谁、预测多远、用什么频率、',
        '误差多大算可接受、错了会有什么业务后果。同一个序列，目标不同，最优方法可能完全不同。',
        '',
        '**频率与时间戳**：日、周、月、小时的数据要区别对待。日历效应（周末、月末、节假日）、',
        '夏令时、缺失与重复时间戳，都会在切分和特征工程里造成泄漏。',
        '',
        '**趋势、季节、周期**：趋势是长期方向；季节是固定已知周期的重复（周、年）；',
        '周期长度不固定（如经济周期）。把不固定的周期当固定季节，会得到过度自信的季节项。',
        '',
        '**平稳性直觉**：均值、方差、自相关是否随时间稳定。平稳性不是“能建模”的前提，',
        '但很多经典方法假设它；差分、对数变换、去趋势都是常见处理。变换会改变误差含义，',
        '必须在同一尺度上比较。',
        '',
        '## 切分是预测的生命线',
        '',
        '时间序列的验证必须保持时间顺序。训练段只能用预测起点之前的数据；验证/测试段必须',
        '严格位于其后。随机打乱、先全局标准化再切分、用未来统计量填补缺失，都是常见泄漏。',
        '详见 [[ref:fpp3-tscv]]。',
        '',
        '## 误差：先定义损失，再看分数',
        '',
        'MAE 对异常值稳健，RMSE 放大大误差，MAPE 在真值接近 0 时会爆炸。间歇需求、零膨胀、',
        '比率型目标要另选指标。比较模型前先固定指标、horizon、切分协议和数据版本。',
        '',
        '> 编辑建议：本项目合成序列用于教学直觉，不要把某道题的分数差直接当成业务结论。'
      ].join('\n'),
      formulas: [
        {
          id: 'm1-mae',
          text: 'MAE = (1 / H) * Σ_{h=1..H} | y_{t+h} - ŷ_{t+h|t} |',
          variables: 'y 为真值，ŷ 为预测，H 为预测步长，t 为预测起点。',
          example: 'H=3，真值 [10, 12, 14]，预测 [11, 11, 15] → MAE = (1+1+1)/3 = 1。'
        },
        {
          id: 'm1-smape',
          text: 'sMAPE = (100 / H) * Σ (2|y-ŷ| / (|y|+|ŷ|))',
          variables: '分母做了平滑，真值与预测同时为 0 时需单独定义。',
          example: '真值 10、预测 12 → 该项 = 2*2/22 ≈ 0.1818，乘以 100/H。'
        }
      ],
      demo: { kind: 'sandbox', id: 'decomposition', label: '打开季节分解演示' },
      exercise: {
        problemIds: ['p1-naive'],
        output: '写一张“预测目标与切分卡”：目标、频率、horizon、损失、训练/测试边界、泄漏检查。'
      },
      counterexamples: ['把全年数据先做标准化再切分；用未来均值填补缺失；按索引随机划分训练测试。'],
      referenceIds: ['fpp3', 'fpp3-tscv']
    },
    {
      id: 'm2',
      index: 2,
      title: '经典统计与诊断',
      prereq: ['m1'],
      level: 'L2',
      minutes: 150,
      summary: 'SES/Holt/ETS、AR/MA/ARIMA 直觉、Theta、ACF/PACF、季节分解与残差白噪声检验。',
      topics: ['指数平滑家族', 'AR/MA/ARIMA', 'Theta', 'ACF/PACF', '残差诊断'],
      body: [
        '## 指数平滑：一个状态方程',
        '',
        '简单指数平滑（SES）只维护一个水平 `l_t`；Holt 加趋势；Holt-Winters 再加季节。',
        'ETS 是它们的状态空间统一视角。参数平滑的是“新信息 vs 历史状态”的权重，',
        '不是魔法：α 越大越贴近最近观测，也越容易被噪声带走。',
        '',
        '## ARIMA：用差分与滞后结构描述依赖',
        '',
        'AR 用过去值解释现在，MA 用过去误差解释现在，I 是差分。Box-Jenkins 流程强调',
        '识别→估计→诊断。实务中先看 ACF/PACF，再检查残差是否接近白噪声；不要只看拟合优度。',
        '',
        '**ACF/PACF 的读法**：ACF 缓慢衰减常提示非平稳；PACF 截断而 ACF 拖尾可考虑 AR；',
        'ACF 截断而 PACF 拖尾可考虑 MA。这些是启发式，不是定理，必须结合残差与业务结构。',
        '',
        '## Theta 方法',
        '',
        'Theta 把序列拆成若干条“θ 线”，常用 θ=0 的长期线性趋势与 θ=2 的短期曲线组合，',
        '再与 SES 结合。它在 M3/M4 上是强基线，说明“简单组合”经常打败复杂模型，详见 [[ref:m4-2018]]。',
        '',
        '## 残差诊断',
        '',
        '残差应近似零均值、无显著自相关、方差相对稳定、无结构性异常聚集。若残差还有季节或',
        '自相关，说明模型漏掉了结构；若残差异方差明显，区间宽度不能只用常数标准差。'
      ].join('\n'),
      formulas: [
        {
          id: 'm2-ses',
          text: 'l_t = α y_t + (1-α) l_{t-1}',
          variables: 'α∈(0,1] 是平滑系数；l_t 是 t 时刻水平。',
          example: 'α=0.3，y_t=10，l_{t-1}=8 → l_t = 0.3*10 + 0.7*8 = 8.6。'
        },
        {
          id: 'm2-holt',
          text: 'l_t = α y_t + (1-α)(l_{t-1}+b_{t-1});  b_t = β(l_t-l_{t-1}) + (1-β)b_{t-1}',
          variables: 'b_t 是趋势项；预测 ŷ_{t+h|t} = l_t + h b_t。',
          example: 'α=0.3, β=0.1；若 l_t=8.6, b_t=0.2，则 h=2 预测 9.0。'
        }
      ],
      demo: { kind: 'sandbox', id: 'acf-pacf', label: '打开 ACF/PACF 演示' },
      exercise: {
        problemIds: ['p4-ses', 'p5-holt', 'p6-holt-winters', 'p10-theta', 'p11-ar-yw'],
        output: '残差诊断单：残差均值、ACF 前 10 阶、是否白噪声、季节项是否残留。'
      },
      counterexamples: ['只看训练误差下降；残差仍强自相关却宣称模型最优；用同一测试集反复调参。'],
      referenceIds: ['fpp3', 'm4-2018']
    },
    {
      id: 'm3',
      index: 3,
      title: '特征工程与机器学习',
      prereq: ['m1', 'm2'],
      level: 'L2',
      minutes: 130,
      summary: '滞后/滚动/日历特征、递归/直接/MIMO、局部与全球模型、正则化与泄漏防控。',
      topics: ['滞后与滚动特征', '日历与外生变量', '递归/直接/MIMO', '局部 vs 全球模型', '正则化'],
      body: [
        '## 特征是“把历史压缩成表”',
        '',
        '树模型/线性模型通常需要显式特征：滞后值、滚动均值/标准差、同比/环比、日历字段、',
        '促销与天气等外生变量。特征一旦引入未来信息（如全局均值、未来事件），就是泄漏。',
        '',
        '## 多步预测的三种策略',
        '',
        '- **递归（recursive）**：先预测一步，再把预测当历史预测下一步；实现简单但误差会累积。',
        '- **直接（direct）**：每个 horizon 单独训练一个模型；避免累积，但模型数量增加。',
        '- **MIMO**：一个模型同时输出多步；训练目标更直接，但可能牺牲单步精度。',
        '',
        '选择没有普遍最优：短 horizon、强自相关序列常用递归；长 horizon 或强季节序列常用直接/MIMO。',
        '',
        '## 局部模型 vs 全球模型',
        '',
        '局部模型为每条序列单独拟合，适合序列长且结构差异大；全球模型跨序列共享参数，',
        '适合短序列众多、结构相似。全球不等于复杂深度模型，见 [[ref:global-models-2021]]。',
        '',
        '## 正则化与验证',
        '',
        '特征多、序列少时，正则化与交叉验证同样重要。时序交叉验证必须按时间展开；',
        '验证集只能用于选模型和阈值，不能反复回到测试集。'
      ].join('\n'),
      formulas: [
        {
          id: 'm3-lag',
          text: 'x_{t,h} = [ y_{t-1}, y_{t-2}, ..., rolling_mean(y, k)_t, calendar_t ]',
          variables: '所有特征在 t 时刻必须只依赖 ≤t 的信息。',
          example: '预测 y_{t+1} 时，rolling_mean 的窗口结束点必须是 t，不能包含 t+1。'
        }
      ],
      demo: { kind: 'sandbox', id: 'feature-window', label: '打开窗口构造演示' },
      exercise: {
        problemIds: ['p7-direct-multistep'],
        output: '给定小表构造无泄漏特征表，并标注每个特征可用时间。'
      },
      counterexamples: ['先用全序列分位数裁剪异常再切分；把测试段统计量用于训练标准化；滚动窗口右对齐。'],
      referenceIds: ['global-models-2021', 'fpp3-tscv']
    },
    {
      id: 'm4',
      index: 4,
      title: '深度学习架构与归纳偏置',
      prereq: ['m2', 'm3'],
      level: 'L1',
      minutes: 140,
      summary: 'DeepAR/TFT、N-BEATS/N-HiTS、DLinear、PatchTST/TimesNet/iTransformer 的结构、成本与失效场景。',
      topics: ['概率深度模型', '纯 MLP 分解', '线性基线', 'Patch/倒换注意力', '计算成本'],
      body: [
        '## 深度模型的三种常见目标',
        '',
        '点预测、分位数/区间预测、概率分布预测。DeepAR 输出分布参数，TFT 支持静态/已知未来/',
        '观测三类输入并给出可解释门控，见 [[ref:deepar-2020]] 与 [[ref:tft-2021]]。',
        '',
        '## 纯 MLP 与线性模型为什么强',
        '',
        'N-BEATS/N-HiTS 用残差堆叠做基展开，DLinear 用趋势/季节分解加一层线性映射，',
        '在多个长序列基准上超过复杂 Transformer，见 [[ref:dlinear-2023]]。',
        '这提醒我们：序列的周期结构显式建模，往往比堆注意力更有效。',
        '',
        '## Patch 与倒换注意力',
        '',
        'PatchTST 把序列分 patch 并做通道独立，见 [[ref:patchtst-2023]]；TimesNet 通过周期折叠',
        '把一维问题转成二维变化建模，见 [[ref:timesnet-2023]]；iTransformer 把变量维当 token，',
        '适合强多变量相关，见 [[ref:itransformer-2024]]。',
        '',
        '## 归纳偏置与成本',
        '',
        '架构选择本质是选择先验：线性适合趋势+季节；CNN 适合局部模式；RNN 适合顺序依赖但难并行；',
        'Transformer 适合长依赖但需要更多数据与算力。评估时必须同时看精度、训练/推理成本、',
        '数据量需求与失效模式。本项目只对 DLinear 等少数方法提供可运行演示，深度训练属概念级。'
      ].join('\n'),
      formulas: [
        {
          id: 'm4-dlinear',
          text: 'ŷ = W_trend * TrendDecomp(y) + W_seas * SeasDecomp(y)',
          variables: '分解可用移动平均；W 为线性层，按 horizon 共享或分别学习。',
          example: '趋势用长度 L 的移动平均得到，季节为残差；再分别线性映射到 horizon。'
        }
      ],
      demo: { kind: 'sandbox', id: 'dlinear', label: '运行 DLinear 演示' },
      exercise: {
        problemIds: ['p15-dlinear'],
        output: '架构选型与失败假设对照表：数据规模、序列长度、多变量强度、算力预算、期望失效模式。'
      },
      counterexamples: ['把论文基准分数直接搬到业务数据；只看参数量不看推理延迟；忽视通道独立与归一化差异。'],
      referenceIds: ['dlinear-2023', 'patchtst-2023', 'timesnet-2023', 'itransformer-2024', 'nbeats-2020', 'nhits-2023', 'deepar-2020', 'tft-2021']
    },
    {
      id: 'm5',
      index: 5,
      title: '概率预测与不确定性',
      prereq: ['m1', 'm2'],
      level: 'L2',
      minutes: 120,
      summary: '分位数/区间、校准与覆盖率、pinball/CRPS、残差 bootstrap、split conformal 与漂移下的限制。',
      topics: ['点预测不够', '分位数与区间', '校准与覆盖', '经验区间构造', '一致性预测'],
      body: [
        '## 为什么需要区间',
        '',
        '业务决策通常关心风险：库存该备多少、预算该留多少余量。一个点预测无法回答“最坏情况”。',
        '概率预测给分布或区间，让我们把误差转化为决策成本。',
        '',
        '## 分位数损失与区间',
        '',
        '分位数回归用 pinball loss 直接优化分位数；80%/95% 区间通常取 10%/90% 与 2.5%/97.5% 分位。',
        '区间宽度与覆盖率是一对矛盾：区间越宽覆盖率越高，但业务可用性下降。',
        '',
        '## 校准：报出经验覆盖率',
        '',
        '标称 95% 区间不等于实际覆盖 95%。应在验证/测试段统计经验覆盖率，并明确样本量。',
        '边际覆盖不等于条件覆盖：某些时段（促销、节假日）可能系统性偏窄。',
        '',
        '## 残差经验区间（本项目教学演示）',
        '',
        '一种简单做法：在训练段内部用滚动原点计算残差分位数，再按 horizon 汇总成区间。',
        '**测试真值绝不参与校准**，否则覆盖率会被高估。本项目实验室的区间明确标注为',
        '“残差经验区间 / 教学演示，非模型原生概率输出”。',
        '',
        '## 一致性预测与漂移',
        '',
        'Split conformal 用校准集给任意点预测包上分布-free 区间；ACI 在分布漂移下在线更新，',
        '见 [[ref:aci-2021]]。要讲清假设：交换性/漂移模型、长期覆盖与条件覆盖的差别。'
      ].join('\n'),
      formulas: [
        {
          id: 'm5-pinball',
          text: 'L_τ(y, ŷ) = (y-ŷ) * (τ - 1{y<ŷ})',
          variables: 'τ 为目标分位；τ=0.5 时退化为 MAE 的一半尺度。',
          example: 'τ=0.9，y=10，ŷ=8 → 损失 = 2*(0.9-0)=1.8；若 ŷ=12 → 损失 = -2*(0.9-1)=0.2。'
        },
        {
          id: 'm5-coverage',
          text: 'Coverage = (1/N) * Σ 1{ lower ≤ y ≤ upper }',
          variables: 'N 为测试样本数；样本少时覆盖率波动大，应同时报 N。',
          example: 'N=20，16 个真值落在区间内 → 经验覆盖 80%。'
        }
      ],
      demo: { kind: 'sandbox', id: 'intervals', label: '打开区间与覆盖演示' },
      exercise: {
        problemIds: [],
        output: '区间诊断报告：标称水平、经验覆盖、平均宽度、最窄/最宽时段、失效假设。'
      },
      counterexamples: ['用测试真值调参区间宽度；把边际覆盖说成任何时段都覆盖；样本 N 很小仍下强结论。'],
      referenceIds: ['aci-2021']
    },
    {
      id: 'm6',
      index: 6,
      title: '时序基础模型',
      prereq: ['m3', 'm4', 'm5'],
      level: 'L1',
      minutes: 100,
      summary: '预训练/零样本、tokenization/patching、多频率多变量、代表工作与适用边界。',
      topics: ['什么是基础模型', 'Token / Patch', '多频率多变量', '代表工作', '数据重叠与泄漏'],
      body: [
        '## 基础模型改变了什么',
        '',
        '传统流程是“每条序列单独建模”；基础模型在海量序列上预训练，再对新序列零样本或少样本推理。',
        '它简化了 pipeline，但不消除评估责任：训练语料是否包含你的测试序列？分布差异多大？',
        '',
        '## 两类主流做法',
        '',
        '- **语言模型式**：把数值缩放量化成 token，用 Transformer 训练，如 Chronos，见 [[ref:chronos-2024]]。',
        '- **Decoder-only / patch 式**：TimesFM 用 patched decoder，见 [[ref:timesfm-2024]]。',
        '- **统一多频率多变量**：Moirai/LOTSA 处理任意变量数与频率，见 [[ref:moirai-2024]]。',
        '',
        '## 适用边界',
        '',
        '基础模型在跨域零样本上可能接近专门训练的模型，但不保证在你的业务数据上最优。',
        '短序列、强周期、层级一致性、非负约束、特殊日历效应，往往仍需要领域特征或后处理。',
        '',
        '## 数据重叠与泄漏',
        '',
        '公开基准可能进入训练语料；用同一基准评估“零样本”时要谨慎。Monash 等档案可用于',
        '理解公开数据范围，见 [[ref:monash]]。本项目不下载权重、不训练基础模型，相关页面仅概念级。'
      ].join('\n'),
      formulas: [
        {
          id: 'm6-token',
          text: 'tokenize(y) = quantize(scale(y), vocabulary)',
          variables: 'scale 常用均值中心化 + 分位数缩放；quantize 把连续值映射到有限词表。',
          example: '序列 [98, 102, 105] 均值缩放后再量化，可得到离散 token 序列用于语言模型。'
        }
      ],
      demo: { kind: 'concept', id: 'foundation-flow', label: '查看推理流程图（概念级）' },
      exercise: {
        problemIds: [],
        output: '基础模型选型备忘录：数据域、频率、是否含测试数据重叠、成本、泄漏检查、回退基线。'
      },
      counterexamples: ['把零样本结果直接当业务 SOTA；忽视训练语料重叠；不比较简单基线与成本。'],
      referenceIds: ['chronos-2024', 'timesfm-2024', 'moirai-2024', 'monash']
    },
    {
      id: 'm7',
      index: 7,
      title: '评测、比较与泄漏防控',
      prereq: ['m1', 'm2', 'm3'],
      level: 'L3',
      minutes: 120,
      summary: 'rolling-origin、多 horizon、指标边界、DM 检验、重复实验与数据窥探。',
      topics: ['时间顺序验证', '指标适用边界', '基线必须公平', '统计比较', '多重比较'],
      body: [
        '## 时间顺序验证',
        '',
        '滚动起点回测（rolling-origin）在多个 origin 上重复“训练→预测 horizon→评估”，',
        '训练永远只用 origin 之前的数据，见 [[ref:fpp3-tscv]]。随机 K 折在时序上通常无效。',
        '',
        '## 指标要看结构',
        '',
        'MAE/RMSE 对异常值敏感不同；MAPE/sMAPE 在零值附近会爆炸；MASE 用 naive 季节性误差缩放，',
        '便于跨序列比较。间歇需求、比率目标、层级目标要分别选指标。',
        '',
        '## 基线与公平比较',
        '',
        '任何新方法都必须和 naive、seasonal naive、mean、moving average、linear trend 等基线',
        '在**相同切分、相同 horizon、相同指标**下比较。只报平均提升不报最差窗口，容易误导。',
        '',
        '## 统计比较与多重比较',
        '',
        'Diebold-Mariano 检验比较两个模型的预测损失差异，见 [[ref:dm-1995]]。多模型、多序列、',
        '多 horizon 时要考虑多重比较；一个窗口的领先不构成结论。',
        '',
        '> 防数据窥探：同一测试集反复调参会把测试集变成验证集。最终结论应在未动过的测试段上确认。'
      ].join('\n'),
      formulas: [
        {
          id: 'm7-mase',
          text: 'MASE = MAE_model / MAE_naive_on_training',
          variables: '季节性 naive 常用 season=m；分母在训练段计算。',
          example: '模型 MAE=3.2，训练段季节 naive MAE=4.0 → MASE=0.8，表示优于该基线。'
        }
      ],
      demo: { kind: 'sandbox', id: 'rolling', label: '打开滚动回测演示' },
      exercise: {
        problemIds: ['p9-rolling-challenge', 'p14-combination'],
        output: '固定协议比较至少两个基线，报告逐窗口指标与最差窗口，不做单窗口结论。'
      },
      counterexamples: ['随机打乱切分；只报平均不报最差；把测试集当验证集反复调参；忽视指标零值问题。'],
      referenceIds: ['fpp3-tscv', 'dm-1995', 'm4-2018']
    },
    {
      id: 'm8',
      index: 8,
      title: '业务与结构化预测',
      prereq: ['m1', 'm2', 'm3', 'm5', 'm7'],
      level: 'L2',
      minutes: 120,
      summary: '层级/分组协调、间歇需求、异常与漂移、库存/促销决策、非负一致性、监控与回退。',
      topics: ['层级与分组', '间歇需求', '异常与漂移', '业务约束', '监控与回退'],
      body: [
        '## 层级与分组预测',
        '',
        '零售、能源、制造常见“总-分”结构：全国→大区→门店，或品类→SKU。各层分别预测常常不一致，',
        '需要预测协调（forecast reconciliation）。MinT 最小化协调后预测误差的方差和，见 [[ref:mint-2019]]；',
        'M5 的难点之一就是层级一致性，见 [[ref:m5-2020]]。',
        '',
        '## 间歇需求',
        '',
        '备件、慢销品大量月份为零。Croston 把需求量与需求间隔分开平滑，见 [[ref:croston-1972]]；',
        'SBA 修正 Croston 的偏高，见 [[ref:sba-2005]]；TSB 直接平滑需求概率，见 [[ref:tsb-2011]]。',
        '需求变密后，简单平滑也可能追上，因此必须用具体数据比较。',
        '',
        '## 异常、漂移与业务约束',
        '',
        '促销、节假日、设备故障、政策变化都会造成结构性变化。监控预测误差、覆盖率、输入分布；',
        '触发阈值后回退到稳健基线或人工复核。非负、整数、容量、预算等约束要在后处理中显式满足。',
        '',
        '## 上线评估与回退',
        '',
        '一页上线方案至少包含：目标、基线、指标、回测协议、监控看板、回退条件、责任人与复盘时间。'
      ].join('\n'),
      formulas: [
        {
          id: 'm8-croston',
          text: 'z_t = α d_t + (1-α) z_{t-1};  p_t = β q_t + (1-β) p_{t-1};  rate = z_t / p_t',
          variables: 'd_t 为非零需求量，q_t 为距上次需求的间隔；SBA 常用 rate *= (1-α/2)。',
          example: '非零需求 [50, 70]，间隔 [2, 3]，α=β=0.1 → 平滑后需求量约 52，间隔约 2.1，rate≈24.8。'
        }
      ],
      demo: { kind: 'sandbox', id: 'croston', label: '运行间歇需求演示' },
      exercise: {
        problemIds: ['p8-robust-shift', 'p12-croston', 'p13-harmonic'],
        output: '一页上线评估与回退方案：指标、监控、阈值、回退基线、复盘节奏。'
      },
      counterexamples: ['只优化总层级不顾门店；负预测直接截断却不记录；促销期用普通基线评估；无回退方案上线。'],
      referenceIds: ['mint-2019', 'm5-2020', 'croston-1972', 'sba-2005', 'tsb-2011']
    }
  ];

  TSJ.courses = courses;
})(typeof window !== 'undefined' ? window : this);
