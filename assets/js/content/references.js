/**
 * assets/js/content/references.js —— 一手来源登记表
 *
 * 规则：
 *   - 只收论文原文 / 官方会议页 / 官方文档 / 教材官方站；博客只作补充且不放进核心事实。
 *   - status 用 preprint / conference / journal / book / archive / competition。
 *   - checkedAt 是人工核查日期；不推断“最新版本”或“SOTA”。
 *   - arXiv 与正式发表分开标注，不把 arXiv 年份说成正式发表年份。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  var references = [
    {
      id: 'fpp3',
      title: 'Forecasting: Principles and Practice, 3rd edition',
      authors: 'Rob J. Hyndman, George Athanasopoulos',
      year: 2021,
      venue: 'OTexts',
      status: 'book',
      url: 'https://otexts.com/fpp3/',
      checkedAt: '2026-10-24',
      note: '时序预测教材：ETS、ARIMA、预测评估与滚动起点验证的权威入口。'
    },
    {
      id: 'fpp3-tscv',
      title: 'Forecasting: Principles and Practice, 3rd edition — Time series cross-validation',
      authors: 'Rob J. Hyndman, George Athanasopoulos',
      year: 2021,
      venue: 'OTexts',
      status: 'book',
      url: 'https://otexts.com/fpp3/tscv.html',
      checkedAt: '2026-10-24',
      note: 'rolling-origin 评估：训练只用预测起点之前的数据。'
    },
    {
      id: 'monash',
      title: 'Monash Time Series Forecasting Archive',
      authors: 'Rakshitha Godahewa et al.',
      year: 2021,
      venue: 'arXiv:2105.06643',
      status: 'archive',
      url: 'https://arxiv.org/abs/2105.06643',
      checkedAt: '2026-10-24',
      note: '公开时序基准档案；用于理解全球模型与训练语料重叠风险。'
    },
    {
      id: 'chronos-2024',
      title: 'Chronos: Learning the Language of Time Series',
      authors: 'Abdul Fatir Ansari, Lorenzo Stella, Caner Turkmen, et al.',
      year: 2024,
      venue: 'TMLR / arXiv:2403.07815（2025 正式发表）',
      status: 'journal',
      url: 'https://arxiv.org/abs/2403.07815',
      checkedAt: '2026-10-25',
      note: '把时序值缩放量化成 token，用 T5 语言模型做概率预测；Bolt 版改 encoder 直出约快 250 倍，Chronos-2 支持协变量。概念级，不在浏览器推理。'
    },
    {
      id: 'aci-2021',
      title: 'Adaptive Conformal Inference Under Distribution Shift',
      authors: 'Isaac Gibbs, Emmanuel J. Candès',
      year: 2021,
      venue: 'NeurIPS 34 / arXiv:2106.00170',
      status: 'conference',
      url: 'https://arxiv.org/abs/2106.00170',
      checkedAt: '2026-10-24',
      note: '分布漂移下的在线一致性预测；须区分长期覆盖与条件覆盖。'
    },
    {
      id: 'timesfm-2024',
      title: 'A decoder-only foundation model for time-series forecasting',
      authors: 'Abhimanyu Das, Weihao Kong, Rajat Sen, Yichen Zhou',
      year: 2024,
      venue: 'ICML / arXiv:2310.10688',
      status: 'conference',
      url: 'https://arxiv.org/abs/2310.10688',
      checkedAt: '2026-10-24',
      note: 'TimesFM：patched decoder-only 基础模型；概念级。'
    },
    {
      id: 'moirai-2024',
      title: 'Unified Training of Universal Time Series Forecasting Transformers',
      authors: 'Gerald Woo, Chenghao Liu, Akshat Kumar, Caiming Xiong, Silvio Savarese, Doyen Sahoo',
      year: 2024,
      venue: 'ICML / arXiv:2402.02592',
      status: 'conference',
      url: 'https://arxiv.org/abs/2402.02592',
      checkedAt: '2026-10-24',
      note: 'Moirai / LOTSA：跨频率、任意变量数的统一训练；概念级。'
    },
    {
      id: 'global-models-2021',
      title: 'Principles and algorithms for forecasting groups of time series: Locality and globality',
      authors: 'Pablo Montero-Manso, Rob J. Hyndman',
      year: 2021,
      venue: 'International Journal of Forecasting 37(4)',
      status: 'journal',
      url: 'https://doi.org/10.1016/j.ijforecast.2021.03.004',
      checkedAt: '2026-10-24',
      note: '全球模型与局部模型的适用边界；全球不等于复杂深度模型。'
    },
    {
      id: 'mint-2019',
      title: 'Optimal forecast reconciliation for hierarchical and grouped time series through trace minimization',
      authors: 'Shanika L. Wickramasuriya, George Athanasopoulos, Rob J. Hyndman',
      year: 2019,
      venue: 'Journal of the American Statistical Association 114(526)',
      status: 'journal',
      url: 'https://doi.org/10.1080/01621459.2018.1448825',
      checkedAt: '2026-10-24',
      note: 'MinT：层级/分组预测协调；P0 只做小型一致性演示。'
    },
    {
      id: 'croston-1972',
      title: 'Forecasting and Stock Control for Intermittent Demands',
      authors: 'J. D. Croston',
      year: 1972,
      venue: 'Operational Research Quarterly 23(3)',
      status: 'journal',
      url: 'https://doi.org/10.1057/jors.1972.50',
      checkedAt: '2026-10-24',
      note: '间歇需求：分开平滑需求量与需求间隔的起点。'
    },
    {
      id: 'tsb-2011',
      title: 'An inventory system for intermittent demand with advance demand information',
      authors: 'R. H. Teunter, A. A. Syntetos, M. Z. Babai',
      year: 2011,
      venue: 'International Journal of Production Economics',
      status: 'journal',
      url: 'https://doi.org/10.1016/j.ijpe.2010.11.007',
      checkedAt: '2026-10-24',
      note: 'TSB：直接平滑“有需求概率”和“非零需求量”。'
    },
    {
      id: 'sba-2005',
      title: 'On the categorization of demand patterns',
      authors: 'A. A. Syntetos, J. E. Boylan',
      year: 2005,
      venue: 'Journal of the Operational Research Society 56',
      status: 'journal',
      url: 'https://doi.org/10.1057/palgrave.jors.2602841',
      checkedAt: '2026-10-24',
      note: '需求形态分类与 Croston/SBA 的偏差修正背景。'
    },
    {
      id: 'dm-1995',
      title: 'Comparing Predictive Accuracy',
      authors: 'Francis X. Diebold, Roberto S. Mariano',
      year: 1995,
      venue: 'Journal of Business & Economic Statistics 13(3)',
      status: 'journal',
      url: 'https://doi.org/10.1080/07350015.1995.10524599',
      checkedAt: '2026-10-24',
      note: '预测准确性比较检验；比较前先说明损失、horizon 与多重比较。'
    },
    {
      id: 'm4-2018',
      title: 'The M4 Competition: 100,000 time series and 61 forecasting methods',
      authors: 'Spyros Makridakis, Evangelos Spiliotis, Vassilios Assimakopoulos',
      year: 2018,
      venue: 'International Journal of Forecasting 36(1)',
      status: 'journal',
      url: 'https://doi.org/10.1016/j.ijforecast.2018.06.001',
      checkedAt: '2026-10-24',
      note: 'M4：统计与机器学习方法的大规模比较；结论不可直接外推到业务数据。'
    },
    {
      id: 'm5-2020',
      title: 'M5 Accuracy competition',
      authors: 'Spyros Makridakis, Evangelos Spiliotis, Vassilios Assimakopoulos',
      year: 2020,
      venue: 'International Journal of Forecasting',
      status: 'competition',
      url: 'https://doi.org/10.1016/j.ijforecast.2019.08.007',
      checkedAt: '2026-10-24',
      note: 'M5：沃尔玛分层销售数据；层级一致性是核心难点之一。'
    },
    {
      id: 'dlinear-2023',
      title: 'Are Transformers Effective for Time Series Forecasting?',
      authors: 'Ailing Zeng, Muxi Chen, Lei Zhang, Qiang Xu',
      year: 2023,
      venue: 'AAAI / arXiv:2205.13504',
      status: 'conference',
      url: 'https://arxiv.org/abs/2205.13504',
      checkedAt: '2026-10-24',
      note: 'DLinear：一层线性分解在多个长序列基准上强于复杂 Transformer。'
    },
    {
      id: 'patchtst-2023',
      title: 'A Time Series is Worth 64 Words: Long-term Forecasting with Transformers',
      authors: 'Yuqi Nie, Nam H. Nguyen, Sinan Wang, et al.',
      year: 2023,
      venue: 'ICLR / arXiv:2211.14730',
      status: 'conference',
      url: 'https://arxiv.org/abs/2211.14730',
      checkedAt: '2026-10-24',
      note: 'PatchTST：分 patch + 通道独立；概念级。'
    },
    {
      id: 'timesnet-2023',
      title: 'TimesNet: Temporal 2D-Variation Modeling for General Time Series Analysis',
      authors: 'Haixu Wu, Tengge Hu, Yong Liu, Hang Zhou, Jianmin Wang, Mingsheng Long',
      year: 2023,
      venue: 'ICLR / arXiv:2210.02186',
      status: 'conference',
      url: 'https://arxiv.org/abs/2210.02186',
      checkedAt: '2026-10-24',
      note: 'TimesNet：把一维序列按周期折叠成二维变化；概念级。'
    },
    {
      id: 'itransformer-2024',
      title: 'iTransformer: Inverted Transformers Are Effective for Time Series Forecasting',
      authors: 'Yong Liu, Tengge Hu, Haixu Wu, et al.',
      year: 2024,
      venue: 'ICLR / arXiv:2310.06625',
      status: 'conference',
      url: 'https://arxiv.org/abs/2310.06625',
      checkedAt: '2026-10-24',
      note: 'iTransformer：把变量维当 token，序列维当通道；概念级。'
    },
    {
      id: 'nbeats-2020',
      title: 'N-BEATS: Neural Basis Expansion Analysis for Interpretable Time Series Forecasting',
      authors: 'Boris N. Oreshkin, Dmitri Carpov, Nicolas Chapados, Yoshua Bengio',
      year: 2020,
      venue: 'ICLR / arXiv:1905.10437',
      status: 'conference',
      url: 'https://arxiv.org/abs/1905.10437',
      checkedAt: '2026-10-24',
      note: 'N-BEATS：纯 MLP 的双残差堆叠，趋势/季节可解释分支；概念级。'
    },
    {
      id: 'nhits-2023',
      title: 'N-HiTS: Neural Hierarchical Interpolation for Time Series Forecasting',
      authors: 'Cristian Challu, Kin G. Olivares, Boris N. Oreshkin, et al.',
      year: 2023,
      venue: 'AAAI / arXiv:2201.12886',
      status: 'conference',
      url: 'https://arxiv.org/abs/2201.12886',
      checkedAt: '2026-10-24',
      note: 'N-HiTS：多尺度采样 + 分层插值；概念级。'
    },
    {
      id: 'tft-2021',
      title: 'Temporal Fusion Transformers for Interpretable Multi-horizon Time Series Forecasting',
      authors: 'Bryan Lim, Sercan Ö. Arık, Nicolas Loeff, Tomas Pfister',
      year: 2021,
      venue: 'International Journal of Forecasting 37(4) / arXiv:1912.09363',
      status: 'journal',
      url: 'https://arxiv.org/abs/1912.09363',
      checkedAt: '2026-10-24',
      note: 'TFT：多 horizon + 静态/未来/观测特征的门控解释；概念级。'
    },
    {
      id: 'deepar-2020',
      title: 'DeepAR: Probabilistic forecasting with autoregressive recurrent networks',
      authors: 'David Salinas, Valentin Flunkert, Jan Gasthaus, Tim Januschowski',
      year: 2020,
      venue: 'International Journal of Forecasting 36(3) / arXiv:1704.04110',
      status: 'journal',
      url: 'https://arxiv.org/abs/1704.04110',
      checkedAt: '2026-10-24',
      note: 'DeepAR：全球概率模型；输出分位数/区间；概念级。'
    },

    /* ============ 2024-2026 顶会顶刊新增（v3.2 内容扩充） ============ */
    {
      id: 'fits-2024',
      title: 'FITS: Modeling Time Series with 10k parameters',
      authors: 'Zhijian Xu, Ailing Zeng, Qiang Xu',
      year: 2024,
      venue: 'ICLR / arXiv:2307.03756',
      status: 'conference',
      url: 'https://arxiv.org/abs/2307.03756',
      checkedAt: '2026-10-25',
      note: '频域低通 + 复数线性插值，约 1 万参数比肩 Transformer。'
    },
    {
      id: 'sparsetsf-2024',
      title: 'SparseTSF: Modeling Long-term Time Series Forecasting with 1k Parameters',
      authors: 'Shengsheng Lin, Weiwei Lin, Wentai Wu, et al.',
      year: 2024,
      venue: 'ICML / arXiv:2405.00946',
      status: 'conference',
      url: 'https://arxiv.org/abs/2405.00946',
      checkedAt: '2026-10-25',
      note: '按季节周期下采样成同相位子序列（LPT），跨参数共享一个线性映射。'
    },
    {
      id: 'cyclenet-2024',
      title: 'CycleNet: Enhancing Time Series Prediction through Modeling Periodic Patterns',
      authors: 'Shengsheng Lin, Weiwei Lin, Wentai Wu, et al.',
      year: 2024,
      venue: 'NeurIPS（Spotlight）/ arXiv:2409.18479',
      status: 'conference',
      url: 'https://arxiv.org/abs/2409.18479',
      checkedAt: '2026-10-25',
      note: '可学习的循环周期参数 Q：先减周期、对残差做线性、再加回周期。'
    },
    {
      id: 'timemixer-2024',
      title: 'TimeMixer: Decomposable Multiscale Mixing for Time Series Forecasting',
      authors: 'Shiyu Wang, Xiaoming Shi, Jianqi Yin, et al.',
      year: 2024,
      venue: 'ICLR / arXiv:2405.14616',
      status: 'conference',
      url: 'https://arxiv.org/abs/2405.14616',
      checkedAt: '2026-10-25',
      note: '纯 MLP 多尺度混合：季节自底向上、趋势自顶向下的可分解混合。'
    },
    {
      id: 'moderntcn-2024',
      title: 'ModernTCN: A Modern Pure Convolution Structure for General Time Series Analysis',
      authors: 'Donghao Luo, Xin Wang',
      year: 2024,
      venue: 'ICLR / arXiv:2310.06625',
      status: 'conference',
      url: 'https://arxiv.org/abs/2310.06625',
      checkedAt: '2026-10-25',
      note: '大卷积核 + 现代化设计（倒瓶颈、深度可分离）的纯卷积通用骨干。'
    },
    {
      id: 'timellm-2024',
      title: 'Time-LLM: Time Series Forecasting by Reprogramming Large Language Models',
      authors: 'Ming Jin, Shiyu Wang, Lintao Ma, et al.',
      year: 2024,
      venue: 'ICLR / arXiv:2310.01728',
      status: 'conference',
      url: 'https://arxiv.org/abs/2310.01728',
      checkedAt: '2026-10-25',
      note: '冻结 LLM，只训练输入重编程与提示前缀；LLM 做时序预测的代表作。'
    },
    {
      id: 'llm4ts-critique-2024',
      title: 'Are Language Models Actually Useful for Time Series Forecasting?',
      authors: 'Mingtian Tan, Yiqun Chen, Ziwei Liu, et al.',
      year: 2024,
      venue: 'NeurIPS（Spotlight）/ arXiv:2406.16964',
      status: 'conference',
      url: 'https://arxiv.org/abs/2406.16964',
      checkedAt: '2026-10-25',
      note: '系统消融：去掉 LLM 或换成简单注意力层，时序预测性能不降反升——对 LLM 路线的重要质疑。'
    },
    {
      id: 'timegpt-2023',
      title: 'TimeGPT-1: The First Foundation Model for Time Series Forecasting',
      authors: 'Azul Garza, Max Mergenthaler',
      year: 2023,
      venue: 'arXiv:2310.03589（Nixtla）',
      status: 'preprint',
      url: 'https://arxiv.org/abs/2310.03589',
      checkedAt: '2026-10-25',
      note: '首个商用时序基础模型 API：预训练 + 零样本预测范式进入时序领域。'
    },
    {
      id: 'lagllama-2024',
      title: 'Lag-Llama: Towards Foundation Models for Probabilistic Time Series Forecasting',
      authors: 'Kashif Rasul, Younes Belkada, Florian Bieder, et al.',
      year: 2024,
      venue: 'arXiv:2310.08278',
      status: 'preprint',
      url: 'https://arxiv.org/abs/2310.08278',
      checkedAt: '2026-10-25',
      note: '约 2M 参数的 decoder-only 概率基础模型，滞后特征 + Student-t 输出，开源。'
    },
    {
      id: 'timer-2024',
      title: 'Timer: Generative Pre-trained Transformers Are Large Time Series Models',
      authors: 'Yong Liu, Haoran Zhang, Chenyu Li, et al.',
      year: 2024,
      venue: 'ICML / arXiv:2402.02368',
      status: 'conference',
      url: 'https://arxiv.org/abs/2402.02368',
      checkedAt: '2026-10-25',
      note: '时序 GPT 路线：patch 词元化 + 生成式预训练 + 下游微调，附缩放律证据。'
    },
    {
      id: 'moment-2024',
      title: 'MOMENT: A Family of Open Time-series Foundation Models',
      authors: 'Mononito Goswami, Arthur Guibadj, MouFi Oussama, et al.',
      year: 2024,
      venue: 'ICML / arXiv:2402.03885',
      status: 'conference',
      url: 'https://arxiv.org/abs/2402.03885',
      checkedAt: '2026-10-25',
      note: '开源基础模型家族：掩码重建预训练，一份权重服务预测/分类/异常/插补。'
    },
    {
      id: 'timemoe-2025',
      title: 'Time-MoE: Billion-Scale Time Series Foundation Models with Mixture of Experts',
      authors: 'Xiaofang Wang, Yuxuan Wang, Dong Zhou, et al.',
      year: 2025,
      venue: 'ICLR / arXiv:2409.16040',
      status: 'conference',
      url: 'https://arxiv.org/abs/2409.16040',
      checkedAt: '2026-10-25',
      note: '首个十亿级开源时序基础模型：稀疏 MoE，配套 Time-300B 预训练语料。'
    },
    {
      id: 'sundial-2025',
      title: 'Sundial: A Family of Highly Capable Time Series Foundation Models',
      authors: 'Yong Liu, Helong Hu, Xiangfei Qiu, et al.',
      year: 2025,
      venue: 'ICML / arXiv:2502.00816',
      status: 'conference',
      url: 'https://arxiv.org/abs/2502.00816',
      checkedAt: '2026-10-25',
      note: '生成式 decoder-only 家族：点与概率预测同权重，吞吐约 35 倍于 Chronos。'
    },
    {
      id: 'gift-eval-2024',
      title: 'GIFT-Eval: A Benchmark For General Time Series Forecasting Model Evaluation',
      authors: 'Aksu Dognan, Yifu Cai, Kan Wang, et al.',
      year: 2024,
      venue: 'arXiv:2410.10393（Salesforce）',
      status: 'preprint',
      url: 'https://arxiv.org/abs/2410.10393',
      checkedAt: '2026-10-25',
      note: '覆盖 23 个数据集、约 2800 万观测的零样本评测基准；基础模型时代的横向标尺。'
    },
    {
      id: 'crps-2007',
      title: 'Strictly Proper Scoring Rules, Prediction, and Estimation',
      authors: 'Tilmann Gneiting, Adrian E. Raftery',
      year: 2007,
      venue: 'Journal of the American Statistical Association 101(476)',
      status: 'journal',
      url: 'https://doi.org/10.1198/016214506000001437',
      checkedAt: '2026-10-25',
      note: '严格正常评分规则与 CRPS：概率预测评估的理论基础。'
    },
    {
      id: 'koenker-1978',
      title: 'Regression Quantiles',
      authors: 'Roger Koenker, Gilbert Bassett',
      year: 1978,
      venue: 'Econometrica 46(1)',
      status: 'journal',
      url: 'https://doi.org/10.2307/1913643',
      checkedAt: '2026-10-25',
      note: '分位数回归与 pinball 损失的原始出处。'
    },
    {
      id: 'ali-2009',
      title: 'SKU demand forecasting in the presence of promotions',
      authors: 'Özden Gür Ali, Serpil Sayın, Tom van Woensel, Jan Fransoo',
      year: 2009,
      venue: 'Expert Systems with Applications 36(10)',
      status: 'journal',
      url: 'https://doi.org/10.1016/j.eswa.2009.04.052',
      checkedAt: '2026-10-26',
      note: '促销协变量与促销期预测的系统比较：无促销期简单时序难被击败，有促销期显式促销特征提升最大。'
    },
    {
      id: 'hyndman-2011-hier',
      title: 'Optimal combination forecasts for hierarchical time series',
      authors: 'Rob J. Hyndman, Roman A. Ahmed, George Athanasopoulos, Han Lin Shang',
      year: 2011,
      venue: 'Computational Statistics & Data Analysis 55(9)',
      status: 'journal',
      url: 'https://doi.org/10.1016/j.csda.2011.03.006',
      checkedAt: '2026-10-26',
      note: '层级预测的系统框架：把自底向上 / 自顶向下与最优调和（MinT）放在同一个回归视角下比较，并给出各自成立的条件。'
    }
  ];

  TSJ.references = references;

  TSJ.referenceIndex = (function () {
    var byId = {};
    for (var i = 0; i < references.length; i++) byId[references[i].id] = references[i];
    return byId;
  })();
})(typeof window !== 'undefined' ? window : this);
