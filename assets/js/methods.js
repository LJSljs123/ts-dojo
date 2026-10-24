/**
 * methods.js —— 方法库（知识库）数据
 *
 * 定位：把「时间序列预测」这条线上真正有分量的方法，按来源分层整理成可检索的卡片。
 * 每张卡片都必须回答四个问题：谁提出的（出处）、核心思想是什么、什么时候该用、什么时候不该用。
 *
 * 分层（tier）：
 *   classic      经典统计 —— 教科书与 IJF/JASA/EJOR 一脉，判题平台里大多可直接实现
 *   competition  竞赛级方法 —— M3/M4/M5 的实证结论，往往比单个花哨模型更管用
 *   deep         顶会深度学习 —— ICLR/NeurIPS/AAAI/ICML 一脉，沙箱里跑不了，作为知识卡片
 *   eval         评估方法论 —— 怎么判断「真的更好」，这一层最容易被忽略、也最容易出错
 *
 * 字段约定：
 *   id        唯一标识（kebab-case）
 *   name      中文名
 *   title     论文英文标题（用于检索原文，不硬编码 URL —— 避免链接失效或写错）
 *   venue     发表处（会议/期刊简称 + 年份）
 *   year      年份（用于排序）
 *   authors   第一作者等（姓 + et al.）
 *   tier      见上
 *   tags      检索标签
 *   idea      核心思想（一到两句，讲清楚「凭什么有效」）
 *   formula   关键式子（纯文本，可为空）
 *   when      适用场景
 *   limit     局限 / 什么时候会翻车
 *   runnable  能否在平台沙箱（纯 JS、无训练库、单次调用）里实现
 *   practice  平台里对应的可练题目 id（没有则 null）
 *
 * 挂载点：window.TSJ.methods（数组），并提供 TSJ.methodsById(id)
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /** 分层定义（UI 按此顺序分组渲染）。 */
  var TIERS = [
    { id: 'classic', name: '经典统计', desc: '教科书与期刊一脉：结构简单、可解释、在小数据上极难被打败。' },
    { id: 'competition', name: '竞赛级方法', desc: 'M3/M4/M5 的实证结论：组合、聚合、对间歇需求的专门处理，往往比换模型更有效。' },
    { id: 'deep', name: '顶会深度学习', desc: 'ICLR/NeurIPS/AAAI/ICML 一脉。需要训练，平台沙箱跑不了，作为知识卡片与选型参考。' },
    { id: 'eval', name: '评估方法论', desc: '怎么证明「真的更好」——这一层最容易出错，也最容易让前三个层的努力白费。' }
  ];

  var methods = [
    /* ================= classic：经典统计 ================= */
    {
      id: 'naive',
      name: '朴素法 / 随机游走',
      title: 'Forecasting: principles and practice (Naive & Random Walk)',
      venue: '教科书基准（Hyndman & Athanasopoulos）',
      year: 2018,
      authors: 'Hyndman & Athanasopoulos',
      tier: 'classic',
      tags: ['基线', '随机游走', '必测'],
      idea: '把最后一个观测值原样重复 h 次。它等价于「随机游走」假设：最优预测就是当前水平。任何模型如果打不过朴素法，说明它没有捕捉到任何结构。',
      formula: 'y_hat(T+h) = y_T',
      when: '任何预测任务的第一个基线；价格、库存这类近似随机游走的序列上往往就是最优解。',
      limit: '完全忽略趋势与季节；有明显季节性的序列上会被季节朴素法碾压。',
      runnable: true,
      practice: 'p1-naive'
    },
    {
      id: 'seasonal-naive',
      name: '季节朴素法',
      title: 'Seasonal naive forecasting',
      venue: '教科书基准 / M 竞赛通用基线',
      year: 2018,
      authors: 'Hyndman & Athanasopoulos',
      tier: 'classic',
      tags: ['基线', '季节性', '必测'],
      idea: '直接复用上一个周期的同一相位：预测明年同月 = 今年同月。它是「季节结构」的最强零参数基线。',
      formula: 'y_hat(T+h) = y_(T+h-m)，m 为季节周期',
      when: '强季节、弱趋势的序列（月度、周度、日内）。',
      limit: '趋势会整体偏移；季节振幅变化时误差迅速放大。',
      runnable: true,
      practice: 'p3-seasonal-naive'
    },
    {
      id: 'ses',
      name: '简单指数平滑（SES）',
      title: 'Statistical forecasting for inventory control',
      venue: '经典专著（1959）',
      year: 1959,
      authors: 'Brown',
      tier: 'classic',
      tags: ['指数平滑', '水平', '无趋势'],
      idea: '用指数衰减权重把历史加权平均，近期权重大。一个参数 α 控制「记忆长度」：α 越大越相信最近。',
      formula: 'l_t = a*y_t + (1-a)*l_(t-1)',
      when: '无趋势无季节、但需要平滑噪声的序列。',
      limit: '有趋势时会系统性滞后（预测永远追不上）；α 靠拟合误差最小化来选，不能拍脑袋。',
      runnable: true,
      practice: 'p4-ses'
    },
    {
      id: 'holt',
      name: 'Holt 线性趋势',
      title: 'Forecasting seasonals and trends by exponentially weighted moving averages',
      venue: '经典论文（1957，后刊于 IJF 2004）',
      year: 1957,
      authors: 'Holt',
      tier: 'classic',
      tags: ['指数平滑', '趋势'],
      idea: '在 SES 上再加一条趋势方程：水平与趋势各自做指数平滑，预测 = 水平 + h×趋势。',
      formula: 'l_t = a*y_t + (1-a)*(l_(t-1)+b_(t-1)); b_t = b*(l_t-l_(t-1)) + (1-b)*b_(t-1)',
      when: '线性趋势、无季节。',
      limit: '趋势会无限外推（除非加阻尼 φ）；趋势突变时反应慢。',
      runnable: true,
      practice: 'p5-holt'
    },
    {
      id: 'holt-winters',
      name: 'Holt-Winters 三参数平滑',
      title: 'Forecasting sales by exponentially weighted moving averages',
      venue: 'Management Science（1960）',
      year: 1960,
      authors: 'Winters',
      tier: 'classic',
      tags: ['指数平滑', '趋势', '季节性', '三参数'],
      idea: '水平、趋势、季节三条方程同时平滑。加性形式适合振幅恒定，乘性形式适合振幅随水平放大。',
      formula: 'l_t = a*(y_t - s_(t-m)) + (1-a)*(l_(t-1)+b_(t-1))',
      when: '趋势 + 季节同时存在，是工业界最常用的单变量方法之一。',
      limit: '季节周期必须已知且稳定；参数初值敏感；多个季节周期（日+周）就力不从心。',
      runnable: true,
      practice: 'p6-holt-winters'
    },
    {
      id: 'theta',
      name: 'Theta 方法',
      title: 'The M3-Competition: results, conclusions and implications（Theta 方法源流）',
      venue: 'International Journal of Forecasting（2000）',
      year: 2000,
      authors: 'Assimakopoulos & Nikolopoulos',
      tier: 'classic',
      tags: ['M3 冠军', '去季节', '组合', '低成本高收益'],
      idea: '把去季节后的序列拆成两条「theta 线」：θ=0 是线性回归（抓长期趋势），θ=2 是 SES（抓短期水平），按 50:50 组合再加回季节。它用两个极简模型拼出了 M3 冠军。',
      formula: 'theta 线：Z(θ) = θ*y + (1-θ)*(A0 + B0*t)，θ=0 为回归线、θ=2 为 SES 线',
      when: '中等长度、有季节的月度/季度序列；想要「几乎零调参但很强」的基线。',
      limit: '本质是线性组合，无法表达非线性交互；对强趋势突变不敏感。',
      runnable: true,
      practice: 'p10-theta'
    },
    {
      id: 'arima',
      name: 'ARIMA / Box-Jenkins',
      title: 'Time Series Analysis: Forecasting and Control',
      venue: '经典专著（1970）',
      year: 1970,
      authors: 'Box & Jenkins',
      tier: 'classic',
      tags: ['自回归', '差分', 'Yule-Walker', '统计建模'],
      idea: '差分去掉趋势与季节，再用 AR(p) 与 MA(q) 刻画残差的自相关结构。AR 部分可由自协方差解 Yule-Walker 方程（Levinson-Durbin 递推），无需迭代优化。',
      formula: 'phi 满足 Toeplitz 方程：Γ_p φ = γ_p；预测 y_(t+1) = Σ φ_i * y_(t+1-i)',
      when: '平稳化后自相关显著、样本量中等（几百点）。',
      limit: '定阶（p,d,q）需要信息准则；非线性、强异方差序列表现差；MA 部分需要迭代估计。',
      runnable: true,
      practice: 'p11-ar-yw'
    },
    {
      id: 'ets',
      name: 'ETS 状态空间指数平滑',
      title: 'A state space framework for automatic forecasting using exponential smoothing methods',
      venue: 'International Journal of Forecasting（2002）',
      year: 2002,
      authors: 'Hyndman, Koehler, Snyder & Grose',
      tier: 'classic',
      tags: ['状态空间', '似然', '自动选型', '区间预测'],
      idea: '把 30 种指数平滑方法统一成状态空间模型，用似然而非启发式来估计参数，从而能给出预测区间、并用 AIC 自动选型。',
      formula: 'y_t = w\'x_(t-1) + ε_t；x_t = F x_(t-1) + g ε_t',
      when: '需要自动在「有无趋势/季节 × 加性/乘性/阻尼」之间选型时。',
      limit: '仍是线性状态空间；多季节、强非线性不适用。',
      runnable: true,
      practice: null
    },
    {
      id: 'croston',
      name: 'Croston 法与 SBA 修正',
      title: 'The accuracy of intermittent demand estimates',
      venue: 'International Journal of Forecasting（2005，SBA 修正）',
      year: 2005,
      authors: 'Syntetos & Boylan（原法 Croston 1972）',
      tier: 'classic',
      tags: ['间歇需求', '稀疏', '库存', '零膨胀'],
      idea: '间歇需求不能直接平滑原序列（会被大量零拉平）。Croston 把「需求间隔」和「非零需求量」分开各做一次指数平滑，预测 = 需求量 / 间隔。SBA 再乘一个偏差修正因子，修掉 Croston 已知的正偏。',
      formula: 'z = d/p（d 为平滑需求量，p 为平滑间隔）；SBA: z_sba = (1 - α/2) * z',
      when: '大量零值、需求偶发（备件、慢销品、B2B 订单）。',
      limit: '需求间隔与需求量强相关时会退化；TSB 更适合「会过时消失」的需求。',
      runnable: true,
      practice: 'p12-croston'
    },
    {
      id: 'tsb',
      name: 'TSB（Teunter-Syntetos-Babai）',
      title: 'Intermittent demand: Linking forecasting to inventory obsolescence',
      venue: 'European Journal of Operational Research（2011）',
      year: 2011,
      authors: 'Teunter, Syntetos & Babai',
      tier: 'classic',
      tags: ['间歇需求', '过时', '概率更新'],
      idea: '不建模「间隔」，而是直接平滑「发生概率」：每次观测（含零）都更新概率，需求量只在非零时更新。因此需求消失时预测会自然衰减到 0——这正是 Croston 的盲区。',
      formula: 'p_t = a*d_t + (1-a)*p_(t-1)（d_t∈{0,1}）；z = p_t * z_t',
      when: '需求可能彻底消失（产品退市、活动结束）的间歇序列。',
      limit: '需求稳定存在时不如 SBA；参数 α 对长尾零值很敏感。',
      runnable: true,
      practice: null
    },
    {
      id: 'pelt',
      name: 'PELT 变点检测',
      title: 'Optimal detection of changepoints with a linear computational cost',
      venue: 'Journal of the American Statistical Association（2012）',
      year: 2012,
      authors: 'Killick, Fearnhead & Eckley',
      tier: 'classic',
      tags: ['变点', '结构突变', '分段', '鲁棒'],
      idea: '在「分段常数 + 惩罚项」的目标下精确最小化，并用剪枝把复杂度降到线性。识别出水平漂移后只用最新一段建模，避免被历史污染。',
      formula: 'min Σ C(段) + β*k（k 为变点数，β 为惩罚）',
      when: '存在水平漂移、政策变化、故障切换的序列。',
      limit: '惩罚 β 决定灵敏度，需按噪声水平标定；只处理均值/方差变化，不处理趋势斜率突变。',
      runnable: true,
      practice: 'p8-robust-shift'
    },
    {
      id: 'spectral',
      name: '周期图与谐波回归',
      title: 'On the investigation of periodicity in time series（周期图传统）',
      venue: '经典谱分析（Schuster 1898 起）',
      year: 1898,
      authors: 'Schuster（传统）/ 现代频域方法',
      tier: 'classic',
      tags: ['频域', '周期识别', '傅里叶', '谐波回归'],
      idea: '用周期图找主导频率，再用「趋势 + 若干谐波」做最小二乘回归。周期不需要事先知道，可以从数据里估出来——这是所有频域深度模型（FEDformer、TimesNet）的思想源头。',
      formula: 'y_t ≈ a + b*t + Σ_k [c_k cos(2πk t/P) + d_k sin(2πk t/P)]',
      when: '周期未知或存在多个叠加周期；季节形态接近正弦。',
      limit: '周期非整数、振幅随时间变化时误差大；对尖峰型季节形态（如节假日）拟合差。',
      runnable: true,
      practice: 'p13-harmonic'
    },
    {
      id: 'mapa',
      name: '时间聚合（MAPA / 多层级）',
      title: 'Forecasting with temporal aggregation and multiple aggregation levels',
      venue: 'European Journal of Operational Research（2014）',
      year: 2014,
      authors: 'Kourentzes, Petropoulos & Trapero',
      tier: 'classic',
      tags: ['时间聚合', '多尺度', '降噪', 'M4 要素'],
      idea: '把同一序列聚合成多个时间尺度（月→季→年），各尺度分别预测，再拆回原尺度加权平均。聚合层降噪、看到长期结构；原始层保留细节。M4 冠军方案就用了这一招。',
      formula: 'y_hat = Σ_l w_l * disagg(forecast(agg_l(y)))',
      when: '噪声大、样本短、需要同时兼顾短期波动与长期走势。',
      limit: '聚合会损失相位信息；各层权重需要标定；强非线性时简单平均未必最优。',
      runnable: true,
      practice: null
    },

    /* ================= competition：竞赛级方法 ================= */
    {
      id: 'combination',
      name: '组合预测',
      title: 'The combination of forecasts',
      venue: 'Operational Research Quarterly（1969）/ 后续综述',
      year: 1969,
      authors: 'Bates & Granger',
      tier: 'competition',
      tags: ['组合', '稳健', 'M4 结论', '几乎免费'],
      idea: '多个模型的误差往往不完全相关，简单平均（或中位数）就能降低方差。这是预测领域最稳的一条经验规律：组合几乎从不比最好的单模型差太多，却极少灾难性翻车。',
      formula: 'y_hat = Σ w_i * y_hat_i；等权或逆误差加权',
      when: '手上有多个量级相当的候选模型时——几乎所有实际任务。',
      limit: '若某个成员明显更差，等权会被拖累；权重在短样本上估计不稳，中位数比加权平均更稳。',
      runnable: true,
      practice: 'p14-combination'
    },
    {
      id: 'm4',
      name: 'M4 竞赛结论',
      title: 'The M4 Competition: 100,000 time series and 61 forecasting methods',
      venue: 'International Journal of Forecasting（2020）',
      year: 2020,
      authors: 'Makridakis, Spiliotis & Assimakopoulos',
      tier: 'competition',
      tags: ['竞赛', '实证', '混合模型', '组合'],
      idea: '10 万条序列、61 种方法。结论很反直觉：纯 ML 方法整体输给统计方法；冠军是「统计 + ML 混合 + 多尺度聚合」。误差分布右偏严重，少数灾难性预测主导了总分。',
      formula: 'M4 主指标：sMAPE + MASE 的平均（OWA）',
      when: '选型时判断「该不该上深度学习」——先在 M4 类基准上比。',
      limit: 'M4 以月度/季度/年度为主，高频与多变量覆盖不足（由 M5 补）。',
      runnable: false,
      practice: null
    },
    {
      id: 'm5',
      name: 'M5 竞赛结论',
      title: 'The M5 competition: Background, organization, and implementation',
      venue: 'International Journal of Forecasting（2022）',
      year: 2022,
      authors: 'Makridakis, Spiliotis & Assimakopoulos',
      tier: 'competition',
      tags: ['竞赛', '间歇需求', '层级', '零售'],
      idea: '零售层级预测（商品-门店）。结论：间歇需求的专门处理、跨层级的调和（reconciliation）、以及「用简单模型 + 好特征」比堆复杂模型更有效。',
      formula: 'M5 指标：RMSSE + 分层加权',
      when: '多层级、稀疏、促销驱动的零售/供应链预测。',
      limit: '强依赖协变量（价格、促销、日历），纯单变量方法上限低。',
      runnable: false,
      practice: null
    },

    /* ================= deep：顶会深度学习 ================= */
    {
      id: 'nbeats',
      name: 'N-BEATS',
      title: 'N-BEATS: Neural basis expansion analysis for interpretable time series forecasting',
      venue: 'ICLR 2020',
      year: 2020,
      authors: 'Oreshkin, Carpov, Chapados & Bengio',
      tier: 'deep',
      tags: ['基展开', '残差堆叠', '可解释', '纯 MLP'],
      idea: '不用 RNN/Transformer，只用全连接堆叠：每个 block 输出「基函数系数」，一部分拟合回溯窗口、一部分外推未来，残差逐层传递。可解释版把基函数固定成趋势多项式与季节傅里叶。',
      formula: 'y_hat = Σ_k g_k(θ_k)，g_k 为可学习基展开',
      when: '单变量、中等长度、需要可解释分解时。',
      limit: '需逐序列或全局训练；多变量交互弱；对协变量支持差。',
      runnable: false,
      practice: null
    },
    {
      id: 'nhits',
      name: 'N-HiTS',
      title: 'N-HiTS: Neural Hierarchical Interpolation for Time Series Forecasting',
      venue: 'AAAI 2023',
      year: 2023,
      authors: 'Challu, Olivares, Oreshkin, Garza, Mergenthaler-Canseco & Dubrawski',
      tier: 'deep',
      tags: ['多速率采样', '层级插值', '长horizon', '低开销'],
      idea: '在 N-BEATS 上做两件事：多速率信号采样（不同 block 看不同时间分辨率，低频块管长期、高频块管细节）+ 层级插值（只在粗粒度输出再插值回细粒度），大幅降低长 horizon 的计算量。',
      formula: '每层以不同采样率 r_k 下采样输入，输出经插值还原到目标长度',
      when: '长 horizon、算力受限。',
      limit: '仍是单变量为主；超参（采样率组合）需要调。',
      runnable: false,
      practice: null
    },
    {
      id: 'dlinear',
      name: 'DLinear / NLinear',
      title: 'Are Transformers Effective for Time Series Forecasting?',
      venue: 'AAAI 2023',
      year: 2023,
      authors: 'Zeng, Chen, Zhang & Xu',
      tier: 'deep',
      tags: ['线性模型', '分解', '打脸 Transformer', '极简'],
      idea: '把序列分解成趋势（滑动平均）与季节（残差），两条分支各接一个单层线性映射直接输出 horizon 长度，然后相加。这个「一层线性」在多个基准上打败了 Informer/Autoformer 等 Transformer。核心论点：时序的「顺序」信息被自注意力打乱了，而线性层天然保序。',
      formula: 'y_hat = Linear(seasonal) + Linear(trend)，trend = MA(y)',
      when: '长期预测基准的必测对照；强趋势序列。',
      limit: '跨通道交互缺失（通道独立）；非线性季节形态表达力不足。',
      runnable: true,
      practice: 'p15-dlinear'
    },
    {
      id: 'patchtst',
      name: 'PatchTST',
      title: 'A Time Series is Worth 64 Words: Long-term Forecasting with Transformers',
      venue: 'ICLR 2023',
      year: 2023,
      authors: 'Nie, Nguyen, Sinthong & Kalagnanam',
      tier: 'deep',
      tags: ['Patch', '通道独立', '自监督', '长horizon'],
      idea: '把序列切成不重叠的 patch 当作 token（像 ViT 处理图像块），token 数从 L 降到 L/P，注意力复杂度大降；同时采用通道独立（每个变量单独建模）。这两点让 Transformer 在时序上真正 work。',
      formula: 'patch 数 N = floor((L-P)/S) + 1，注意力 O(N^2) 而非 O(L^2)',
      when: '长回溯窗口、长 horizon、多变量但通道间弱相关。',
      limit: '通道独立会丢掉变量间依赖（iTransformer 正是针对这点）；需要较多数据训练。',
      runnable: true,
      practice: null
    },
    {
      id: 'timesnet',
      name: 'TimesNet',
      title: 'TimesNet: Temporal 2D-Variation Modeling for General Time Series Analysis',
      venue: 'ICLR 2023',
      year: 2023,
      authors: 'Wu, Hu, Liu, Zhou, Wang & Long',
      tier: 'deep',
      tags: ['多周期', '1D→2D', '通用骨干', 'FFT'],
      idea: '用 FFT 找 top-k 周期，把一维序列按周期折叠成二维矩阵（行=周期内相位，列=周期序号），再用 2D 卷积同时捕捉「周期内」与「周期间」变化。一个骨干同时做预测、插补、分类、异常检测。',
      formula: '按周期 P 折叠：x_2D[i, j] = x[i*P + j]',
      when: '存在多个叠加周期（日/周/年）的通用时序任务。',
      limit: '周期估计错误时二维结构失真；计算量随 top-k 线性增长。',
      runnable: false,
      practice: null
    },
    {
      id: 'itransformer',
      name: 'iTransformer',
      title: 'iTransformer: Inverted Transformers Are Effective for Time Series Forecasting',
      venue: 'ICLR 2024',
      year: 2024,
      authors: 'Liu, Hu, Zhang, Wu, Wang, Ma & Long',
      tier: 'deep',
      tags: ['倒置注意力', '多变量', '通道相关'],
      idea: '把注意力「倒过来」：不再在时间维做注意力，而是把每个变量的整条序列 embed 成一个 token，在「变量维」做注意力。这样注意力天然建模变量间相关性，前馈网络负责每个变量的时序非线性。',
      formula: '输入转置后：token_i = Embed(x_(:,i))，注意力在变量维',
      when: '多变量、变量间存在实质相关（传感器网络、多品类销量）。',
      limit: '单变量任务上优势不明显；序列长度增加时 token 维度不增，长程细节可能被压缩。',
      runnable: false,
      practice: null
    },
    {
      id: 'tft',
      name: 'TFT（Temporal Fusion Transformer）',
      title: 'Temporal Fusion Transformers for interpretable multi-horizon time series forecasting',
      venue: 'International Journal of Forecasting（2021）',
      year: 2021,
      authors: 'Lim, Arık, Loeff & Pfister',
      tier: 'deep',
      tags: ['多horizon', '协变量', '可解释', '变量选择'],
      idea: '为「多步 + 多协变量 + 可解释」设计：变量选择网络给每个输入特征打分（可读性），静态协变量调制网络，LSTM 编码局部、注意力抓长程，分位数输出给概率预测。',
      formula: '分位数损失：Σ_q Σ_t max(q*(y-y_hat), (q-1)*(y-y_hat))',
      when: '有丰富协变量（促销、天气、日历）、需要概率预测与解释性的业务场景。',
      limit: '参数多、训练慢；协变量质量决定上限；单变量无协变量时不如简单方法。',
      runnable: false,
      practice: null
    },
    {
      id: 'deepar',
      name: 'DeepAR',
      title: 'DeepAR: Probabilistic forecasting with autoregressive recurrent networks',
      venue: 'International Journal of Forecasting（2020）',
      year: 2020,
      authors: 'Salinas, Flunkert, Gasthaus & Januschowski',
      tier: 'deep',
      tags: ['概率预测', '自回归', '全局模型', '负二项'],
      idea: '自回归 RNN + 似然输出：每步输出一个分布的参数（高斯/负二项），而不是点值。用大量相关序列联合训练一个全局模型，冷启动序列也能借力。',
      formula: 'p(y_t | h_t) 参数化（如负二项），训练最大化对数似然',
      when: '需要预测区间、序列数量多且同质（零售单品、服务器负载）。',
      limit: '自回归误差累积；对长 horizon 不稳；需大量序列。',
      runnable: false,
      practice: null
    },
    {
      id: 'informer',
      name: 'Informer',
      title: 'Informer: Beyond Efficient Transformer for Long Sequence Time-Series Forecasting',
      venue: 'AAAI 2021（最佳论文）',
      year: 2021,
      authors: 'Zhou, Zhang, Peng, Zhang, Li, Xiong & Zhang',
      tier: 'deep',
      tags: ['稀疏注意力', '长序列', '蒸馏', '里程碑'],
      idea: '针对长序列把注意力做到 O(L log L)：ProbSparse 只保留「查询分布偏离均匀」的少数 query；再用蒸馏把序列长度逐层减半。它是长时序 Transformer 的开端，也是后来被 DLinear 质疑的对象。',
      formula: 'ProbSparse 采样：只保留 top-u 个稀疏性最大的 query，u = c*log L',
      when: '超长序列（上千点）单次预测。',
      limit: '后续工作指出其基准设置存在问题（如输入长度不一致），DLinear 用一层线性即超越。',
      runnable: false,
      practice: null
    },

    /* ================= eval：评估方法论 ================= */
    {
      id: 'dm-test',
      name: 'Diebold-Mariano 检验',
      title: 'Comparing predictive accuracy',
      venue: 'Journal of Business & Economic Statistics（1995）',
      year: 1995,
      authors: 'Diebold & Mariano',
      tier: 'eval',
      tags: ['显著性', '模型比较', '必做'],
      idea: '「A 的误差比 B 小」不能只看均值，要看差值序列是否显著异于 0。对损失差 d_t 做 HAC（Newey-West）修正的 t 检验，处理误差自相关。',
      formula: 'DM = mean(d) / sqrt(2π*f_d(0)/T)，d_t = L(e_A) - L(e_B)',
      when: '任何「我的模型更好」的结论，都必须过这一关。',
      limit: '小样本下检验功效低；嵌套模型需用 Clark-West 修正。',
      runnable: false,
      practice: null
    },
    {
      id: 'mase',
      name: 'MASE 与尺度无关误差',
      title: 'Another look at measures of forecast accuracy',
      venue: 'International Journal of Forecasting（2006）',
      year: 2006,
      authors: 'Hyndman & Koehler',
      tier: 'eval',
      tags: ['指标', 'MASE', 'sMAPE 缺陷'],
      idea: 'MAPE 在接近 0 时爆炸、sMAPE 有上界不对称问题。MASE 用「训练集上朴素法的平均绝对误差」做分母，既尺度无关又可跨序列平均。',
      formula: 'MASE = MAE / (1/(T-1) * Σ|y_t - y_(t-1)|)',
      when: '跨序列汇总、含零值或量纲不同的场景。',
      limit: '分母为 0（常数序列）时失效；对间歇需求需换成 RMSSE。',
      runnable: false,
      practice: null
    },
    {
      id: 'backtest',
      name: '滚动回测与前视偏差',
      title: 'On the use of cross-validation for time series predictor evaluation',
      venue: 'Information Sciences（2012）/ 方法论共识',
      year: 2012,
      authors: 'Bergmeir & Benítez',
      tier: 'eval',
      tags: ['回测', '前视偏差', '数据泄漏', '必做'],
      idea: '时序不能随机 K 折——会用到未来信息。必须「按时间前进」：用 [0,t) 训练、预测 [t, t+h)，逐步前移。同时要保证标准化、季节估计、参数选择都只用训练段。',
      formula: 'rolling origin：origin 逐次 +step，窗口可固定（sliding）或扩张（expanding）',
      when: '任何时序模型的离线评估。',
      limit: '窗口长度与步长会显著影响结论；单次切分方差大，需多次重复取均值与区间。',
      runnable: true,
      practice: 'p7-direct-multistep'
    },
    {
      id: 'conformal',
      name: 'Conformal Prediction',
      title: 'Conformalized Quantile Regression',
      venue: 'NeurIPS 2019（原框架 Vovk 2005）',
      year: 2019,
      authors: 'Romano, Patterson & Candès',
      tier: 'eval',
      tags: ['区间预测', '分布无关', '覆盖率保证'],
      idea: '不假设误差分布，用留出集上的分位数残差来「校准」区间宽度，从而在有限样本下给出覆盖率保证。可以套在任何点预测模型外面。',
      formula: '区间 = y_hat ± q_(1-α)(|残差| 的分位数)',
      when: '需要可靠预测区间、又不想假设高斯误差。',
      limit: '依赖可交换性假设，分布漂移下覆盖率会失效；区间宽度随样本量收敛慢。',
      runnable: true,
      practice: null
    }
  ];

  /** 按 id 查方法。 */
  function methodsById(id) {
    for (var i = 0; i < methods.length; i++) {
      if (methods[i].id === id) return methods[i];
    }
    return null;
  }

  TSJ.methods = methods;
  TSJ.methodTiers = TIERS;
  TSJ.methodsById = methodsById;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = methods;
    module.exports.tiers = TIERS;
    module.exports.methodsById = methodsById;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
