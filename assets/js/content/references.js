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
      venue: 'arXiv:2403.07815',
      status: 'preprint',
      url: 'https://arxiv.org/abs/2403.07815',
      checkedAt: '2026-10-24',
      note: '把时序值缩放量化成 token，用语言模型做概率预测；概念级，不在浏览器推理。'
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
    }
  ];

  TSJ.references = references;

  TSJ.referenceIndex = (function () {
    var byId = {};
    for (var i = 0; i < references.length; i++) byId[references[i].id] = references[i];
    return byId;
  })();
})(typeof window !== 'undefined' ? window : this);
