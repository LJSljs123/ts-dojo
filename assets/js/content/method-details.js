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
    fits: {
      runLevel: 'sandbox',
      intuition: '时域卷积等价于频域乘法：与其学复杂时域映射，不如在频域对低频段做一次线性插值。',
      assumptions: ['信号能量集中在低频', '未来频谱可由历史频谱线性外推'],
      complexity: 'O(L log L)（FFT 主导），参数量约 1 万',
      limitations: ['低通截断丢高频突变', '截止频率需按数据调', '非线性趋势表达弱'],
      workedExample: '对 512 点历史做 RFFT，保留前 1/4 低频，线性映射到未来 96 个频点，逆变换得 96 步预测。',
      counterexample: '尖峰/节假日型突变集中在高频，FITS 会系统性抹平它们。',
      referenceIds: ['fits-2024']
    },
    sparsetsf: {
      runLevel: 'sandbox',
      intuition: '同相位的历史点构成一条慢变子序列；按周期分组后每组只需一个共享线性映射，参数自然省下来。',
      assumptions: ['季节周期 w 已知且稳定', '同相位子序列近似线性'],
      complexity: '极低（<1k 参数），最小二乘可解',
      limitations: ['周期估计错误则分组失效', '无趋势项会长程漂移', '多周期需扩展'],
      workedExample: 'w=12 时把月度序列拆成 12 条子序列，每条用同一组权重线性外推一步，再按相位拼回。',
      counterexample: '周期随时间漂移（如闰年、浮动节假日）时同相位假设失效。',
      referenceIds: ['sparsetsf-2024']
    },
    cyclenet: {
      runLevel: 'sandbox',
      intuition: '先把「每相位平均长什么样」学成一张循环表 Q，剩下的残差几乎是线性关系，一个线性层就够。',
      assumptions: ['周期为已知整数', '残差与周期成分可加分离'],
      complexity: '极低（一张周期表 + 一个线性层）',
      limitations: ['整数周期假设', '多周期需堆叠多套 Q', '周期漂移退化'],
      workedExample: '周周期 w=7：7 个可学习周期参数，预测第 t+h 步先查 Q[(t+h) mod 7] 再加线性残差。',
      counterexample: '周期非整数（如年周期 365.25 天）时相位错位，Q 表对不齐。',
      referenceIds: ['cyclenet-2024']
    },
    timemixer: {
      runLevel: 'concept',
      intuition: '不同下采样尺度暴露不同结构：粗尺度看趋势、细尺度看季节；分层混合比单尺度建模更省。',
      assumptions: ['多尺度结构存在', '季节/趋势可分解'],
      complexity: '中，纯 MLP 较轻',
      limitations: ['尺度与采样率是超参', '通道独立为主', '概念级'],
      workedExample: '日数据下采样 1×/4×/16× 三层，趋势自顶层向下、季节自底层向上混合。',
      counterexample: '无明确多尺度结构的短序列上，混合层只是徒增参数。',
      referenceIds: ['timemixer-2024']
    },
    moderntcn: {
      runLevel: 'concept',
      intuition: '卷积天然保序且并行高效；用 CV 的大核与倒瓶颈设计补上感受野与容量，注意力并非必需。',
      assumptions: ['长程依赖可由堆叠感受野覆盖', '局部模式为主'],
      complexity: '推理快、FLOPs 效率高',
      limitations: ['感受野靠深度累积', '点式卷积容量有限', '概念级'],
      workedExample: '大核 DWConv（如 k=31）逐层下采样，金字塔顶部感受野覆盖整段历史。',
      counterexample: '变量间强交互的全局依赖场景，纯卷积可能不如变量维注意力。',
      referenceIds: ['moderntcn-2024']
    },
    timegpt: {
      runLevel: 'concept',
      intuition: '把 NLP 的「预训练一次、处处零样本调用」搬进预测：API 接收历史序列，直接返回预测与区间。',
      assumptions: ['训练语料覆盖目标域', '序列统计特性可迁移'],
      complexity: '推理即 API 调用',
      limitations: ['闭源不可审计', '数据外流合规风险', '域外结构未知'],
      workedExample: '上传 36 个月销量，API 返回未来 12 个月的预测中位数与 80% 区间。',
      counterexample: '数据敏感不能外发、或序列结构高度领域特异（如设备振动频谱）时不适用。',
      referenceIds: ['timegpt-2023']
    },
    chronos: {
      runLevel: 'concept',
      intuition: '数值量化成 token 后，时序预测在形式上就是语言建模——现成 T5 架构与训练技巧全部复用。',
      assumptions: ['量化粒度足够细', '下一 token 建模能承载时序依赖'],
      complexity: '训练与推理成本同量级 LLM',
      limitations: ['量化误差与词表截断', '自回归采样长程漂移', '闭源生态为主'],
      workedExample: '序列缩放后量化到 4096 个 token，采样 20 条未来路径取分位数即得区间。',
      counterexample: '极端值超出量化范围（词表外）时预测被硬截断。',
      referenceIds: ['chronos-2024']
    },
    timesfm: {
      runLevel: 'concept',
      intuition: '「输入多 patch、只预测最后一个 patch」让训练形态与「长历史预测任意 horizon」的推理形态天然对齐。',
      assumptions: ['patch 内结构可迁移', '合成+真实混合语料覆盖面广'],
      complexity: '约 200M 参数，自回归拼接到目标步长',
      limitations: ['单变量为主', '协变量有限', '域差距大时不及本地训练'],
      workedExample: '给 512 点历史，模型逐 patch 生成直至补满 128 步 horizon。',
      counterexample: '强协变量驱动（价格促销）的零售序列上，纯历史输入吃亏。',
      referenceIds: ['timesfm-2024']
    },
    moirai: {
      runLevel: 'concept',
      intuition: '训练时随机「抽变量子集 + 掩码区间」，一个模型学会把任意形状的序列集合补全，推理时天然支持任意变量数与频率。',
      assumptions: ['变量子集间结构可共享', '多频率 patch 能对齐'],
      complexity: '统一训练，推理按变量数扩展',
      limitations: ['变量多时注意力开销大', '协变量质量影响大', '概念级'],
      workedExample: '把销量、价格、温度三条序列整体喂入，掩码未来段让模型补全。',
      counterexample: '变量间几乎独立且各自结构迥异时，统一建模反而互相干扰。',
      referenceIds: ['moirai-2024']
    },
    'lag-llama': {
      runLevel: 'concept',
      intuition: '不追求规模，把「正确的输入特征」（本序列滞后 + 日历滞后）喂给一个学生级 decoder，就能得到可用的概率预测。',
      assumptions: ['滞后特征覆盖主要依赖', 'Student-t 分布足够刻画噪声'],
      complexity: '约 2M 参数，可单卡部署',
      limitations: ['零样本上限有限', '滞后特征需按频率设计', '长 horizon 采样不稳'],
      workedExample: '输入含 y_{t-1}…y_{t-96} 与星期几 one-hot，输出下个月的分布参数。',
      counterexample: '长内存依赖（超长周期）超出滞后窗口时无法捕捉。',
      referenceIds: ['lagllama-2024']
    },
    timer: {
      runLevel: 'concept',
      intuition: '时序的「GPT 时刻」：patch 当词元、下一 patch 当目标，海量异构序列上预训练，下游各任务只需轻量微调。',
      assumptions: ['patch 词元化保留足够信息', '下游与预训练分布相近'],
      complexity: '预训练昂贵，微调轻量',
      limitations: ['微调仍需数据与算力', '时序缩放律不如 NLP 稳固', '概念级'],
      workedExample: '预训练后在某工厂传感器序列上微调 5% 参数，预测/插补双任务共用骨干。',
      counterexample: '只有单条短序列、无法微调时，优势无从发挥。',
      referenceIds: ['timer-2024']
    },
    moment: {
      runLevel: 'concept',
      intuition: '掩码重建让模型学到通用表示；一份权重接不同任务头即可服务预测、分类、异常检测与插补。',
      assumptions: ['公开语料表示可迁移', '多任务共享底层表示有益'],
      complexity: '小中型 Transformer，开源可复现',
      limitations: ['规模低于商用模型', '零样本预测非最强项', '概念级'],
      workedExample: '同一 MOMENT 权重：接线性头做分类，接生成头做预测，接重构误差做异常打分。',
      counterexample: '追求零样本预测极致精度时，专门的预测基础模型更强。',
      referenceIds: ['moment-2024']
    },
    'time-moe': {
      runLevel: 'concept',
      intuition: '稀疏 MoE 把「总容量」与「单 token 计算量」解耦：参数可以堆到十亿级，每个 token 仍只走少数专家。',
      assumptions: ['token 级路由有效', '专家间分工可学'],
      complexity: '总参数 2.4B，单 token 稀疏激活',
      limitations: ['显存需求大', '负载不均降低效率', '小数据业务未必需要'],
      workedExample: '每 token 由门控选出 top-k 专家 FFN，其余专家跳过计算。',
      counterexample: '边缘设备或成本敏感场景，十亿级模型的部署成本难以接受。',
      referenceIds: ['timemoe-2025']
    },
    sundial: {
      runLevel: 'concept',
      intuition: '生成式骨干同时产出点预测与概率预测：多路并行采样取期望即点值、取分位即区间，无需两套模型。',
      assumptions: ['生成分布校准', '采样路数足够覆盖尾部'],
      complexity: '推理吞吐高（约 35× 于 Chronos）',
      limitations: ['采样随机性需控种子', '极端异常敏感', '域外长周期需验证'],
      workedExample: '并行采样 32 条未来路径：均值作点预测，2.5%/97.5% 分位作 95% 区间。',
      counterexample: '需要逐点可解释或严格确定性的场景，采样式输出不合适。',
      referenceIds: ['sundial-2025']
    },
    timellm: {
      runLevel: 'concept',
      intuition: '语言模型的世界知识或许能帮助理解时序上下文——重编程层把时序 patch「翻译」成 LLM 听得懂的词元，再附上统计前缀提示。',
      assumptions: ['LLM 表示对时序有迁移价值', '适配层足以对齐两种模态'],
      complexity: '推理需承载整个 LLM',
      limitations: ['消融研究质疑 LLM 贡献', '开销大', '复现依赖特定 LLM'],
      workedExample: '把 336 点历史重编程为 48 个伪词元，前缀注入「月度、有趋势、冬季高峰」描述后让 LLM 输出。',
      counterexample: 'NeurIPS 2024 系统消融：把 LLM 换成一层注意力，多数基准不降反升。',
      referenceIds: ['timellm-2024', 'llm4ts-critique-2024']
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
    },
    crps: {
      runLevel: 'concept',
      intuition: '把「整个预测分布」与单个观测的差距积分成一个数：既惩罚报错位置，也惩罚区间过宽。',
      assumptions: ['模型输出可用分布或分位数近似', '跨序列比较前已归一化'],
      complexity: '分位数近似下 O(K·H)，K 为分位数个数',
      limitations: ['精确积分不可行，靠近似', '跨量纲序列需归一化', '对极端观测敏感'],
      workedExample: '两条 90% 区间都盖住真值，但 A 更窄 → A 的 CRPS 更低，A 更优。',
      counterexample: '只报区间覆盖率不看宽度：把区间无限拉宽也能「100% 覆盖」。',
      referenceIds: ['crps-2007']
    },
    pinball: {
      runLevel: 'sandbox',
      intuition: '对 τ=0.9 的上界预测，低估罚 0.9 倍、高估只罚 0.1 倍——模型自然学会把上界报高一点。',
      assumptions: ['目标分位数条件可估', '样本量足以支撑各分位'],
      complexity: '低（与 MAE 同阶）',
      limitations: ['多分位需多头', '分位交叉需后处理', '零值密集时分位塌缩'],
      workedExample: 'τ=0.9，y=10，ŷ=8 → 损失 0.9×2=1.8；ŷ=12 → 损失 0.1×2=0.2。',
      counterexample: '间歇需求序列 95% 的真值为 0，τ=0.7 分位的最优解就是恒 0，区间失去意义。',
      referenceIds: ['koenker-1978']
    },
    'promo-covariate': {
      runLevel: 'sandbox',
      intuition: '促销日不是「季节变了」，是「同一天多卖了 60%」。把促销日历当协变量，就得分两件事做：先把历史里的促销尖峰除回去，别让它污染季节基线；再把未来的促销倍数乘上来。',
      assumptions: ['促销日历可得，且未来促销日已知', '促销提升近似乘性（相对倍数在各次促销间稳定）', '非促销日的季节结构在窗口内不变'],
      complexity: '低（两遍扫描 + 取中位数，O(n)）',
      limitations: ['深度折扣、堆头、竞品促销会让倍数漂移', '多种促销类型需分别估倍数，样本很快不够', '连续促销日彼此污染，倍数会被低估'],
      workedExample: '历史促销日中位数是非促销日的 1.6 倍 → 先把历史促销日销量除以 1.6 还原基线，跑季节朴素得到未来基线，再把未来促销日乘回 1.6。',
      counterexample: '只清洗历史不乘回未来 → 未来促销日全低估；只乘未来不清洗 → 基线被促销尖峰抬高，所有非促销日一起高估。两件事缺一件都过不了线。',
      referenceIds: ['ali-2009']
    },
    'bottom-up': {
      runLevel: 'sandbox',
      intuition: '总量不是「一个更大的序列」，而是两个不同节律的叠加。门店按周走，企业按月走，加起来之后总量上同时存在 7 天和 30 天两个周期——而任何一个季节模型只能选一个周期。拆回渠道，每个渠道都退回「单周期 + 噪声」，季节朴素就够了。',
      assumptions: ['各分量的历史与总量同坐标系、可逐点相加', '分量各自的周期在预测窗口内稳定', '分量之间没有强相关（否则求和会放大共同误差）'],
      complexity: '低（各分量各扫一遍，O(n)）',
      limitations: ['分量噪声大时，求和会把各自的误差累加', '要求分量历史齐全；缺一路就只能退回聚合层建模', '自底向上不保证是方差最优，更一般的做法是最优调和（MinT）'],
      workedExample: '总量 1900 件：门店 1250（周末 1.6 倍、周期 7）+ 企业 650（月末 3 天冲量、周期 30）。门店取上周同日、企业取上月同日，逐点相加 → 预测误差从 135755 降到 8895（MSE）。',
      counterexample: '在总量上把周期从 7 换成 30：55 分，和模板打平——这次丢的是门店的周节律。把 Holt-Winters 搬到总量上：41 分，比模板还低。拆开了但把企业渠道当常数水平：23 分，窗口里那 3 天冲量全漏。三种做法都说明：换周期、换模型都不解决粒度问题。',
      referenceIds: ['hyndman-2011-hier']
    }
  };

  TSJ.methodDetails = details;
})(typeof window !== 'undefined' ? window : this);
