/**
 * assets/js/content/method-details.js —— 方法详情扩展层
 *
 * 只放“比方法卡更深”的字段：直觉、假设、复杂度、局限、数值小例、反例、运行级别、引用。
 * 方法卡里的 idea/formula/when/limit/venue 仍由 methods.js 单一来源提供，这里不复制。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  var details = {
    naive: {
      runLevel: 'sandbox',
      intuition: '把最后一个观测原样平推；等价于假设“下一刻和现在一样”。',
      assumptions: ['序列接近随机游走', '无显著趋势/季节', '误差近似零均值'],
      complexity: 'O(1) 参数、O(H) 预测',
      limitations: ['结构性趋势/季节下偏差大', '对异常值极敏感', '不能给出可靠区间'],
      workedExample: '历史末尾 100 → 未来 3 步全为 100。',
      counterexample: '航空客运量有 12 月季节，naive 会在旺季系统性偏低。',
      referenceIds: ['fpp3']
    },
    'seasonal-naive': {
      runLevel: 'sandbox',
      intuition: '用上一个同季节的值作为预测，显式利用固定周期。',
      assumptions: ['季节周期稳定且已知', '同相位水平变化缓慢'],
      complexity: 'O(1) 参数',
      limitations: ['趋势项会漏掉', '偶发大单被重复搬运', '周期估计错误时崩坏'],
      workedExample: '月度数据 m=12，预测明年 1 月用去年 1 月。',
      counterexample: '强趋势序列需要 naive + drift，而非纯季节朴素。',
      referenceIds: ['fpp3']
    },
    ses: {
      runLevel: 'sandbox',
      intuition: '只维护一个水平，用 α 平衡新观测与旧状态。',
      assumptions: ['无趋势无季节', '噪声近似独立'],
      complexity: 'O(n) 拟合',
      limitations: ['无法跟随趋势/季节', 'α 敏感', '区间需另建'],
      workedExample: 'α=0.3，y=10，旧水平 8 → 新水平 8.6。',
      counterexample: 'Holt-Winters 可建模的强季节数据上，SES 会长期偏离。',
      referenceIds: ['fpp3']
    },
    holt: {
      runLevel: 'sandbox',
      intuition: '在水平之外维护一个趋势项，预测沿趋势外推。',
      assumptions: ['趋势近似线性', '噪声独立'],
      complexity: 'O(n) 拟合',
      limitations: ['长 horizon 趋势外推可能爆炸', '季节需另加', '对突变反应慢'],
      workedExample: '水平 8.6、趋势 0.2 → h=2 预测 9.0。',
      counterexample: '周期波动强的序列会把季节误当趋势。',
      referenceIds: ['fpp3']
    },
    'holt-winters': {
      runLevel: 'sandbox',
      intuition: '水平 + 趋势 + 季节三件套，加性或乘法季节。',
      assumptions: ['季节周期固定', '趋势与季节可分离'],
      complexity: 'O(n) 拟合，3 个平滑参数',
      limitations: ['参数过多需正则/约束', '结构突变后恢复慢', '乘法季节需正数据'],
      workedExample: 'm=12，先初始化 12 个季节项，再逐期更新水平/趋势/季节。',
      counterexample: '季节幅度随水平增长时应优先乘法而非加性。',
      referenceIds: ['fpp3']
    },
    theta: {
      runLevel: 'sandbox',
      intuition: '把序列分解为多条 θ 线，常用 θ=0 线性趋势与 θ=2 短期曲线组合。',
      assumptions: ['趋势可用线性近似', '与 SES 组合稳定'],
      complexity: '低，接近统计基线',
      limitations: ['复杂季节需先去季节', '无原生概率输出', '超长 horizon 仍可能欠拟合'],
      workedExample: '对去季节序列拟合直线，再与 SES 末端水平加权合并。',
      counterexample: '强多周期序列可能不如显式分解 + 线性映射。',
      referenceIds: ['m4-2018']
    },
    arima: {
      runLevel: 'sandbox',
      intuition: '用差分处理非平稳，用 AR/MA 描述依赖；Yule-Walker 可闭式解 AR 参数。',
      assumptions: ['差分后近似平稳', '残差接近白噪声'],
      complexity: 'O(n p) 量级，矩阵求解随阶数增长',
      limitations: ['长序列阶数选择难', '季节需 SARIMA', '区间假设正态残差'],
      workedExample: '一阶差分后估计 AR(2)，再积分回原尺度预测。',
      counterexample: '方差随时间增长时未变换直接 ARIMA 会失真。',
      referenceIds: ['fpp3']
    },
    ets: {
      runLevel: 'sandbox',
      intuition: '指数平滑的状态空间统一视角，可用似然与信息准则自动选型。',
      assumptions: ['误差分布可选', '状态转移稳定'],
      complexity: '中，需优化似然',
      limitations: ['自动选型仍可能过拟合', '实现比 SES 复杂', '强季节需乘法项'],
      workedExample: '对同一序列比较 (A,A,A) 与 (A,N,N)，按 AIC 选型。',
      counterexample: '短序列上信息准则不稳定，需交叉验证。',
      referenceIds: ['fpp3']
    },
    croston: {
      runLevel: 'sandbox',
      intuition: '把非零需求量与需求间隔分开平滑，预测需求率 z/p。',
      assumptions: ['需求发生与需求量可分离', '间隔分布稳定'],
      complexity: 'O(n)',
      limitations: ['对需求率系统性偏高', '需求变密后优势缩小', '稀疏窗口噪声大'],
      workedExample: '需求 [50,70]，间隔 [2,3]，α=0.1 → rate≈25。',
      counterexample: '连续非零序列退化为普通平滑。',
      referenceIds: ['croston-1972', 'sba-2005']
    },
    tsb: {
      runLevel: 'sandbox',
      intuition: '直接平滑“有需求概率”和“非零需求量”，预测概率×需求量。',
      assumptions: ['需求概率可平滑', '需求量条件分布稳定'],
      complexity: 'O(n)',
      limitations: ['过时/淘汰品概率估计难', '仍无原生区间', '稀疏时方差大'],
      workedExample: '概率 0.4、平均需求 80 → 预测 32。',
      counterexample: '需求频率快速变化时需更短记忆或在线更新。',
      referenceIds: ['tsb-2011']
    },
    pelt: {
      runLevel: 'sandbox',
      intuition: '用惩罚似然检测变点，把序列分成结构稳定的段。',
      assumptions: ['段内分布稳定', '惩罚项与噪声匹配'],
      complexity: '近似 O(n)，依赖实现',
      limitations: ['惩罚参数敏感', '变点过多会过拟合', '不等于因果突变'],
      workedExample: '对水平漂移序列检测出漂移点并分段估计水平。',
      counterexample: '纯噪声序列也会检出“显著”变点，需结合业务验证。',
      referenceIds: ['fpp3']
    },
    spectral: {
      runLevel: 'sandbox',
      intuition: '用周期图/FFT 找主导频率，再拟合谐波回归。',
      assumptions: ['周期在频域有峰值', '谐波可加'],
      complexity: 'O(n log n)',
      limitations: ['非平稳序列频谱糊', '谐波数量需控制', '峰值≠业务因果'],
      workedExample: '年周期在 365 天附近出现峰值，取前 k 个谐波外推。',
      counterexample: '趋势未去时低频能量掩盖真实周期。',
      referenceIds: ['fpp3']
    },
    mapa: {
      runLevel: 'sandbox',
      intuition: '在多个时间聚合尺度上分别预测再组合，降低单尺度噪声。',
      assumptions: ['聚合后结构更稳定', '聚合关系可逆/可回分配'],
      complexity: '中，多尺度计算',
      limitations: ['回分配引入误差', '聚合粒度选择敏感', '可能模糊短期模式'],
      workedExample: '日→周聚合预测后再回分配到日。',
      counterexample: '强日内周期序列直接按小时建模可能更稳。',
      referenceIds: ['m4-2018']
    },
    combination: {
      runLevel: 'sandbox',
      intuition: '把多个候选预测平均/加权，降低单模型方差。',
      assumptions: ['候选误差不完全相关', '权重稳定'],
      complexity: '低',
      limitations: ['候选都错时组合放大风险', '权重估计需防泄漏', '中位数稳健但可能过平滑'],
      workedExample: '候选 [10, 12, 30]，中位数 12 比均值 17.3 更抗离群。',
      counterexample: '候选模型高度相关时组合收益有限。',
      referenceIds: ['m4-2018']
    },
    m4: {
      runLevel: 'concept',
      intuition: 'M4 是大规模预测竞赛，核心经验是统计/组合方法常与复杂方法竞争。',
      assumptions: ['基准分布与业务不同'],
      complexity: '不适用',
      limitations: ['不能直接外推到业务', '部分结论依赖指标选择'],
      workedExample: '比较 M4 上统计组合与深度模型，注意 horizon 与频率分层。',
      counterexample: '把 M4 排名当普适规律。',
      referenceIds: ['m4-2018']
    },
    m5: {
      runLevel: 'concept',
      intuition: 'M5 强调分层销售、间歇需求与层级一致性。',
      assumptions: ['层级结构已知', '基预测可靠'],
      complexity: '不适用',
      limitations: ['需要协调算法', '真实业务约束更多'],
      workedExample: '门店→州→总销售额需满足加和一致性。',
      counterexample: '只报总层级 WRMSS 而忽略底层可解释性。',
      referenceIds: ['m5-2020']
    },
    nbeats: {
      runLevel: 'concept',
      intuition: '纯 MLP 残差堆叠做基展开，可解释趋势/季节分支。',
      assumptions: ['足够数据', '基函数可覆盖目标结构'],
      complexity: '高，需训练',
      limitations: ['浏览器不训练', '对多变量/协变量支持有限', '调参敏感'],
      workedExample: '每层输出趋势基与季节基的系数，逐层逼近残差。',
      counterexample: '小数据上可能不如经典基线。',
      referenceIds: ['nbeats-2020']
    },
    nhits: {
      runLevel: 'concept',
      intuition: '多尺度采样 + 分层插值，降低长 horizon 计算量。',
      assumptions: ['多尺度结构存在', '插值核合理'],
      complexity: '高，需训练',
      limitations: ['概念级', '实现复杂', '小数据收益有限'],
      workedExample: '在不同 pool 尺寸上预测再插值到目标 horizon。',
      counterexample: '短 horizon 上复杂度不划算。',
      referenceIds: ['nhits-2023']
    },
    dlinear: {
      runLevel: 'sandbox',
      intuition: '趋势/季节分解 + 一层线性映射，结构简单但强。',
      assumptions: ['序列可分解为趋势+季节+残差', '线性映射足够'],
      complexity: '低，可闭式或轻量训练',
      limitations: ['复杂多变量相关可能不足', '分解核需选择', '无原生区间'],
      workedExample: '移动平均提趋势，残差为季节，再线性映射到 horizon。',
      counterexample: '强非线性交互需更 expressive 模型或特征。',
      referenceIds: ['dlinear-2023']
    },
    patchtst: {
      runLevel: 'sandbox',
      intuition: '分 patch 降低序列长度，通道独立减少变量干扰。',
      assumptions: ['patch 内局部模式稳定', '通道相对独立'],
      complexity: '中高，需训练',
      limitations: ['强通道相关时需调整', 'patch 长度敏感'],
      workedExample: '长度 512 分成长度 16 的 32 个 patch。',
      counterexample: '多变量强相关场景通道独立可能丢信息。',
      referenceIds: ['patchtst-2023']
    },
    timesnet: {
      runLevel: 'concept',
      intuition: '按主导周期把一维序列折叠成二维，用二维卷积/注意力建模。',
      assumptions: ['存在稳定主导周期'],
      complexity: '高，需训练',
      limitations: ['概念级', '周期估计影响大'],
      workedExample: '日序列按 24 折叠成 (天, 小时) 二维张量。',
      counterexample: '无固定周期序列折叠无意义。',
      referenceIds: ['timesnet-2023']
    },
    itransformer: {
      runLevel: 'concept',
      intuition: '把变量维当 token、时间维当通道，用注意力建模变量相关。',
      assumptions: ['变量间相关重要', '序列长度适中'],
      complexity: '高，需训练',
      limitations: ['概念级', '变量多时 token 数增长', '实现细节敏感'],
      workedExample: 'N 个变量生成 N 个 token，注意力在变量间计算。',
      counterexample: '变量近似独立时收益有限。',
      referenceIds: ['itransformer-2024']
    },
    tft: {
      runLevel: 'concept',
      intuition: '静态/已知未来/观测特征分开编码，多 horizon 输出与可解释门控。',
      assumptions: ['协变量可靠', '多 horizon 需联合建模'],
      complexity: '高，需训练',
      limitations: ['概念级', '特征工程重', '推理成本高'],
      workedExample: '节假日作为已知未来输入，天气作为观测输入。',
      counterexample: '协变量泄漏或延迟会导致离线好线上差。',
      referenceIds: ['tft-2021']
    },
    deepar: {
      runLevel: 'concept',
      intuition: '全球概率模型，递归采样输出预测分布。',
      assumptions: ['跨序列共享参数', '似然形式匹配数据'],
      complexity: '高，需训练',
      limitations: ['概念级', '负二项/高斯假设可能不符', '不确定性校准需验证'],
      workedExample: '对多条相似序列训练一个 RNN，输出未来分布参数。',
      counterexample: '序列结构差异大时全球模型偏差明显。',
      referenceIds: ['deepar-2020']
    },
    informer: {
      runLevel: 'concept',
      intuition: '稀疏注意力与蒸馏处理长序列，降低计算量。',
      assumptions: ['长序列稀疏注意力足够', '蒸馏不丢关键信息'],
      complexity: '高，需训练',
      limitations: ['概念级', '实现复杂', '基准结论需复现'],
      workedExample: '对超长用电序列用 ProbSparse 注意力。',
      counterexample: '短序列上复杂度不必要。',
      referenceIds: ['timesnet-2023']
    },
    'dm-test': {
      runLevel: 'concept',
      intuition: '比较两个模型的预测损失差异是否统计显著。',
      assumptions: ['损失序列可比', '差分平稳'],
      complexity: '低',
      limitations: ['不告诉你哪个业务更好', '多重比较需校正', '对异常敏感'],
      workedExample: '两模型逐点损失差做 t 检验，报告 DM 统计量与 p 值。',
      counterexample: '只报 p 不报效应量与业务成本。',
      referenceIds: ['dm-1995']
    },
    mase: {
      runLevel: 'concept',
      intuition: '用训练段 naive 误差缩放模型误差，便于跨序列比较。',
      assumptions: ['naive 基线有意义', '训练段长度足够'],
      complexity: '低',
      limitations: ['零/常数序列分母问题', '季节 m 选择影响大'],
      workedExample: '模型 MAE=3.2，训练段季节 naive MAE=4.0 → MASE=0.8。',
      counterexample: '间歇需求上用普通 naive 可能放大分母波动。',
      referenceIds: ['fpp3-tscv', 'm4-2018']
    },
    backtest: {
      runLevel: 'sandbox',
      intuition: '按时间顺序反复“训练→预测→评估”，防止前视偏差。',
      assumptions: ['训练只用 origin 前数据', 'horizon 固定'],
      complexity: 'O(windows * fit)',
      limitations: ['计算成本随窗口增长', '窗口选择影响结论'],
      workedExample: '4 个 origin、horizon=12，逐窗口比较模型与基线。',
      counterexample: '随机 K 折把未来信息泄漏进训练。',
      referenceIds: ['fpp3-tscv']
    },
    conformal: {
      runLevel: 'sandbox',
      intuition: '用校准集残差分位数给点预测包上分布-free 区间。',
      assumptions: ['校准与测试近似交换', '点预测固定'],
      complexity: '低',
      limitations: ['条件覆盖不保证', '漂移需 ACI 等在线更新', '样本少时分位数不稳'],
      workedExample: '校准残差 90% 分位为 3.2，则区间为 ŷ ± 3.2。',
      counterexample: '把测试真值用于选分位数。',
      referenceIds: ['aci-2021']
    }
  };

  TSJ.methodDetails = details;
})(typeof window !== 'undefined' ? window : this);
