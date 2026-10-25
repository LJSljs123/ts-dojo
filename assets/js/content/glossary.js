/**
 * assets/js/content/glossary.js —— 新手术语表数据
 *
 * 定位：把平台题面、课程与方法库里反复出现的行话，用大白话各解释一遍。
 * 规则：
 *   - def 说人话：不预设读者学过统计；一个术语 1-3 句；
 *   - see 指向相关术语 id；links 指向平台内页面（course/method/problem 三选一，id 必须真实存在）；
 *   - 分类 cat 必须是 CATEGORIES 里的 id（content-v3 测试会校验）。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  var CATEGORIES = [
    { id: 'basics', name: '基础概念' },
    { id: 'math', name: '数学补给' },
    { id: 'data', name: '数据与形态' },
    { id: 'eval', name: '切分与评估' },
    { id: 'metrics', name: '误差指标' },
    { id: 'methods', name: '方法与模型' },
    { id: 'prob', name: '概率与区间' },
    { id: 'deep', name: '深度学习与基础模型' },
    { id: 'platform', name: '平台术语' }
  ];

  var glossary = [
    /* ---------- basics 基础概念 ---------- */
    {
      id: 'time-series',
      term: '时间序列',
      en: 'time series',
      cat: 'basics',
      def: '按时间先后顺序排列的一串数字，比如逐月的销量、逐小时的气温。预测就是猜这串数字的后续。',
      see: ['frequency', 'horizon'],
      links: { course: 'm1' }
    },
    {
      id: 'frequency',
      term: '频率',
      en: 'frequency',
      cat: 'basics',
      def: '数据多久记一个点：小时（H）、日（D）、周（W）、月（M）、年（Y）。频率决定了季节周期通常是多少（小时数据常是 24，月数据常是 12）。',
      see: ['seasonality'],
      links: { course: 'm1' }
    },
    {
      id: 'horizon',
      term: '预测步长',
      en: 'horizon',
      cat: 'basics',
      def: '要往未来猜几个点。horizon = 12 的月度数据就是预测未来一年。步长越长，不确定性越大。',
      see: ['holdout', 'recursive'],
      links: { problem: 'p7-direct-multistep' }
    },
    {
      id: 'univariate',
      term: '单变量 / 多变量',
      en: 'univariate / multivariate',
      cat: 'basics',
      def: '只预测一条序列叫单变量；同时看多条互相影响的序列（销量 + 价格 + 气温）叫多变量。本平台题目都是单变量。',
      see: ['covariate'],
      links: { method: 'itransformer' }
    },
    {
      id: 'covariate',
      term: '协变量（外生变量）',
      en: 'covariate',
      cat: 'basics',
      def: '帮助预测的额外信息，比如促销标记、节假日、天气。若未来的协变量未知（如天气），要小心它本身也需要预测。',
      see: ['univariate'],
      links: { method: 'tft' }
    },
    {
      id: 'trend',
      term: '趋势',
      en: 'trend',
      cat: 'basics',
      def: '序列的长期方向：往上走、往下走或基本持平。趋势可以线性也可以弯曲；预测时趋势外推过头就会爆炸。',
      see: ['seasonality', 'stationarity'],
      links: { problem: 'p5-holt' }
    },
    {
      id: 'seasonality',
      term: '季节性（固定周期）',
      en: 'seasonality',
      cat: 'basics',
      def: '周期长度已知且固定的重复模式：每到周末销量升、每到 12 月机票贵。「季节」不一定是季节，日数据的「季节」通常是 24。',
      see: ['frequency', 'cycle'],
      links: { problem: 'p3-seasonal-naive' }
    },
    {
      id: 'cycle',
      term: '周期（长度不固定）',
      en: 'cycle',
      cat: 'basics',
      def: '有起伏但间隔不固定的波动，比如经济周期、太阳黑子约 11 年但每轮长短不同。把它当成固定季节去建模会过度自信。',
      see: ['seasonality'],
      links: { problem: 'p11-ar-yw' }
    },
    {
      id: 'stationarity',
      term: '平稳性',
      en: 'stationarity',
      cat: 'basics',
      def: '均值、方差、自相关是否随时间稳定。很多经典方法（如 AR）要求序列近似平稳；差分、取对数是常用的「压平稳」手段。',
      see: ['differencing', 'variance-stabilize'],
      links: { method: 'arima' }
    },
    {
      id: 'differencing',
      term: '差分',
      en: 'differencing',
      cat: 'basics',
      def: '用「本点减上一点」的新序列代替原序列，一次差分能消掉线性趋势。ARIMA 里的 I 就是差分次数。',
      see: ['stationarity'],
      links: { method: 'arima' }
    },
    {
      id: 'variance-stabilize',
      term: '方差稳定变换',
      en: 'variance stabilizing transform',
      cat: 'basics',
      def: '波动幅度随水平放大的序列（越大越抖），常先取对数或开方，让方差接近稳定再建模。预测后要记得变换回去。',
      see: ['stationarity']
    },


    /* ---------- math 数学补给（零基础讲解线性代数与统计） ---------- */
    {
      id: 'vector',
      term: '向量',
      en: 'vector',
      cat: 'math',
      def: '一串按顺序排好的数，比如 [3, 1, 4]。时间序列本身就是向量；一条预测也是向量。可以整体加减、乘一个数（每个元素都乘）。',
      see: ['matrix'],
      links: { course: 'm4' }
    },
    {
      id: 'matrix',
      term: '矩阵',
      en: 'matrix',
      cat: 'math',
      def: '把好几个同样长度的向量按行摞起来的一张数表。第 13 题的设计矩阵每一行是一个时刻的 [1, t, cos, sin]，整张表就是矩阵。',
      see: ['vector', 'matrix-multiply'],
      links: { problem: 'p13-harmonic' }
    },
    {
      id: 'matrix-multiply',
      term: '矩阵乘法',
      en: 'matrix multiplication',
      cat: 'math',
      def: '「用一张表去变换另一张表」：结果第 i 行第 j 列 = 左边第 i 行与右边第 j 列对应相乘再相加。DLinear 的 Linear 层本质就是一次矩阵乘法（再加偏置）。',
      see: ['matrix', 'linear-regression'],
      links: { method: 'dlinear' }
    },
    {
      id: 'transpose',
      term: '转置',
      en: 'transpose',
      cat: 'math',
      def: '把矩阵沿对角线翻转：行变列、列变行，记作 Aᵀ。最小二乘的正规方程 AᵀAx = Aᵀy 里第一个符号就是它。',
      see: ['matrix', 'least-squares']
    },
    {
      id: 'linear-system',
      term: '线性方程组',
      en: 'linear system',
      cat: 'math',
      def: '若干个「未知数只带常数系数」的方程一起求解，如 2x + y = 5、x − y = 1。矩阵语言写作 Ax = b；高斯消元（消去法）是解它的标准算法。',
      see: ['matrix', 'least-squares'],
      links: { method: 'arima' }
    },
    {
      id: 'least-squares',
      term: '最小二乘法',
      en: 'least squares',
      cat: 'math',
      def: '让「预测值和真实值的差的平方加起来」最小的那条线/那组系数。不需要迭代，代入公式一步解出（正规方程）；平台第 7/13/15 题的核心数学都是它。',
      see: ['linear-regression', 'residual', 'transpose'],
      links: { problem: 'p13-harmonic' }
    },
    {
      id: 'linear-regression',
      term: '线性回归',
      en: 'linear regression',
      cat: 'math',
      def: '用一条直线 y = a + b·t 去贴一串点，a 是截距、b 是斜率（每期涨多少）。求解就用最小二乘；「linear_trend 基线」就是它。',
      see: ['least-squares', 'derivative'],
      links: { problem: 'p7-direct-multistep' }
    },
    {
      id: 'fourier',
      term: '傅里叶分解',
      en: 'Fourier decomposition',
      cat: 'math',
      def: '任何重复的波形都可以拆成若干个不同长短的「正弦 + 余弦」波之和。季节形状近似正弦时，拟合几个谐波就够（第 13 题）；FITS/DeepAR 的频域思想也源于此。',
      see: ['seasonality', 'spectral'],
      links: { method: 'spectral' }
    },
    {
      id: 'derivative',
      term: '斜率（导数直觉）',
      en: 'slope / derivative',
      cat: 'math',
      def: '「每走一步，值变化多少」。直线的斜率 = (终点 − 起点) ÷ 步数；漂移修正里的 drift、Holt 里的 trend 项，都是在对斜率做估计。',
      see: ['linear-regression', 'trend'],
      links: { problem: 'p1-naive' }
    },
    {
      id: 'weighted-average',
      term: '加权平均',
      en: 'weighted average',
      cat: 'math',
      def: '每个数乘自己的权重再加起来（权重和为 1）。指数平滑就是加权平均：新观测权重 α、旧状态权重 1−α，α 越大越「喜新厌旧」。',
      see: ['ses-alpha', 'mean-variance'],
      links: { problem: 'p4-ses' }
    },
    {
      id: 'mean-variance',
      term: '均值 / 方差 / 标准差',
      en: 'mean / variance / std',
      cat: 'math',
      def: '均值 = 所有数加起来除以个数（平均水平）；方差 = 每个数离均值的差的平方的平均（波动多大）；标准差 = 方差开根号，量纲回到原数据。RMSE 的量纲就来自同款开方。',
      see: ['mse', 'weighted-average']
    },
    {
      id: 'residual',
      term: '残差',
      en: 'residual',
      cat: 'math',
      def: '真实值减去预测值剩下的部分：模型还没解释掉的差异。好模型的残差应当像白噪声；实验室的「残差图/ACF 图」看的就是它。',
      see: ['least-squares', 'white-noise'],
      links: { course: 'm2' }
    },

    /* ---------- data 数据与形态 ---------- */
    {
      id: 'missing-value',
      term: '缺失值',
      en: 'missing value',
      cat: 'data',
      def: '某些时间点没有记录。填补时只能用「该点之前」的信息——用全序列均值填就是泄漏。',
      see: ['leakage'],
      links: { course: 'm1' }
    },
    {
      id: 'outlier',
      term: '异常点（离群值）',
      en: 'outlier',
      cat: 'data',
      def: '明显偏离周围水平的点：大促、故障、录入错误。它既能毁掉不稳健的模型，也可能是你最想预测对的那几天。',
      see: ['robust-stat'],
      links: { problem: 'p8-robust-shift' }
    },
    {
      id: 'structural-break',
      term: '结构突变（水平漂移）',
      en: 'structural break',
      cat: 'data',
      def: '序列在某个时刻整体抬升或下沉，比如涨价后销量平台期上移。检测到突变后应主要用最新一段建模。',
      see: ['changepoint'],
      links: { problem: 'p8-robust-shift' }
    },
    {
      id: 'changepoint',
      term: '变点检测',
      en: 'changepoint detection',
      cat: 'data',
      def: '自动找出「序列规律发生改变的时刻」的技术，PELT 是代表算法。找出变点就能分段建模，避免被旧规律污染。',
      see: ['structural-break'],
      links: { method: 'pelt' }
    },
    {
      id: 'heteroscedasticity',
      term: '异方差',
      en: 'heteroscedasticity',
      cat: 'data',
      def: '噪声幅度随时间变化（例如销量越大波动越大）。它不影响点预测，但会让固定宽度的预测区间失真。',
      see: ['variance-stabilize', 'prediction-interval']
    },
    {
      id: 'intermittent-demand',
      term: '间歇需求',
      en: 'intermittent demand',
      cat: 'data',
      def: '大部分时间是 0、偶尔来一单的需求（备件、慢销品）。普通平滑会被大量零拉平，需要 Croston/TSB 这类专门方法。',
      see: ['croston'],
      links: { problem: 'p12-croston' }
    },
    {
      id: 'noise',
      term: '噪声',
      en: 'noise',
      cat: 'data',
      def: '数据里不可预测的随机抖动。任何模型的误差下限就是噪声大小；在噪声里「找规律」就是过拟合。',
      see: ['overfitting', 'white-noise']
    },
    {
      id: 'calendar-effect',
      term: '日历效应',
      en: 'calendar effects',
      cat: 'data',
      def: '周末、月末、节假日、夏令时这类由日历决定的影响。做特征时要当心：未来的日历是已知的，这是最安全的协变量。',
      see: ['covariate'],
      links: { course: 'm3' }
    },

    /* ---------- eval 切分与评估 ---------- */
    {
      id: 'train-test',
      term: '训练集 / 测试集',
      en: 'train / test set',
      cat: 'eval',
      def: '训练集用来拟合模型，测试集用来考试。时序里二者必须按时间切开：测试集永远是训练集的「未来」。',
      see: ['holdout', 'leakage']
    },
    {
      id: 'holdout',
      term: '留出法',
      en: 'holdout',
      cat: 'eval',
      def: '把序列尾部一段留作测试、其余作训练，只考一次。简单快速，但单次切分有运气成分。',
      see: ['rolling-backtest'],
      links: { course: 'm1' }
    },
    {
      id: 'rolling-backtest',
      term: '滚动回测',
      en: 'rolling origin backtest',
      cat: 'eval',
      def: '把「考试起点」逐步后移，重复多次「训练→预测→打分」，再看平均分和最差窗口。它比单次留出更接近长期真实表现。',
      see: ['holdout', 'lookahead-bias'],
      links: { problem: 'p9-rolling-challenge' }
    },
    {
      id: 'leakage',
      term: '数据泄漏',
      en: 'data leakage',
      cat: 'eval',
      def: '未来信息偷偷混进了训练过程：比如先对全序列标准化再切分、用全序列均值填缺失。结果虚高，上线即翻车，是时序第一大坑。',
      see: ['lookahead-bias', 'holdout'],
      links: { course: 'm7' }
    },
    {
      id: 'lookahead-bias',
      term: '前视偏差',
      en: 'lookahead bias',
      cat: 'eval',
      def: '模型在 t 时刻「偷看」了 t 之后才知道的信息。本平台沙箱里 history 数组之后的内容不可见，就是从接口层面防前视。',
      see: ['leakage'],
      links: { method: 'backtest' }
    },
    {
      id: 'overfitting',
      term: '过拟合',
      en: 'overfitting',
      cat: 'eval',
      def: '模型把训练集里的噪声也当规律背了下来：训练误差很小、测试误差很大。参数越多、数据越少，越容易发生。',
      see: ['noise', 'regularization']
    },
    {
      id: 'regularization',
      term: '正则化',
      en: 'regularization',
      cat: 'eval',
      def: '给「学得太狠」加约束：惩罚过大的参数（岭回归/Lasso）或提前停止训练，换取更稳的测试表现。',
      see: ['overfitting'],
      links: { course: 'm3' }
    },
    {
      id: 'data-snooping',
      term: '数据窥探',
      en: 'data snooping',
      cat: 'eval',
      def: '反复用同一个测试集调参挑模型，测过的次数多了，测试集就变成了验证集，分数失去意义。最终结论要在没碰过的数据上确认。',
      see: ['leakage', 'baseline'],
      links: { course: 'm7' }
    },
    {
      id: 'baseline',
      term: '基线',
      en: 'baseline',
      cat: 'eval',
      def: '朴素法、季节朴素、历史均值这类零成本参照物。本平台的得分就是「你打败最优基线的程度」；打不过基线的模型没有价值。',
      see: ['naive-method', 'seasonal-naive-method'],
      links: { problem: 'p1-naive' }
    },

    /* ---------- metrics 误差指标 ---------- */
    {
      id: 'mse',
      term: 'MSE 均方误差',
      en: 'mean squared error',
      cat: 'metrics',
      def: '误差平方的平均。平方会放大大错误：差 10 记 100。对异常点敏感是特性也是风险。',
      see: ['rmse', 'mae']
    },
    {
      id: 'rmse',
      term: 'RMSE 均方根误差',
      en: 'root mean squared error',
      cat: 'metrics',
      def: 'MSE 开根号，量纲回到和数据一样（万元、度），更好解读。排序与 MSE 完全一致。',
      see: ['mse']
    },
    {
      id: 'mae',
      term: 'MAE 平均绝对误差',
      en: 'mean absolute error',
      cat: 'metrics',
      def: '误差绝对值的平均。不平方，所以单个大误差不会爆炸式主导总分，比 MSE 更「抗异常」。',
      see: ['mse', 'mape']
    },
    {
      id: 'mape',
      term: 'MAPE 百分比误差',
      en: 'mean absolute percentage error',
      cat: 'metrics',
      def: '误差除以真值再取绝对值平均，含义是「平均偏了百分之几」。真值接近 0 时会爆炸甚至无法定义。',
      see: ['smape', 'mase']
    },
    {
      id: 'smape',
      term: 'sMAPE 对称百分比误差',
      en: 'symmetric MAPE',
      cat: 'metrics',
      def: '把分母换成 |真值|+|预测| 的平均，缓解 MAPE 在小真值上的爆炸。M4 竞赛主指标之一。',
      see: ['mape', 'mase'],
      links: { method: 'm4' }
    },
    {
      id: 'mase',
      term: 'MASE 尺度无关误差',
      en: 'mean absolute scaled error',
      cat: 'metrics',
      def: '用「训练集上朴素法的 MAE」当分母，把误差归一成倍数：小于 1 就是打败了朴素法。可跨序列平均，适合汇总成绩。',
      see: ['baseline', 'mae'],
      links: { method: 'mase' }
    },
    {
      id: 'score-ratio',
      term: '比值评分（本平台）',
      en: 'ratio scoring',
      cat: 'metrics',
      def: '你的误差 ÷ 最优基线的误差。比值 ≤ 0.5 满分、= 阈值恰好过线、≥ 2 零分。打平基线只能拿 50 多分，逼你真的比基线强。',
      see: ['baseline'],
      links: { problem: 'p1-naive' }
    },

    /* ---------- methods 方法与模型 ---------- */
    {
      id: 'naive-method',
      term: '朴素法',
      en: 'naive method',
      cat: 'methods',
      def: '拿最后一个观测值当全部未来预测。看似最笨，却在随机游走型序列（价格、库存）上极难打败，是一切模型的第一道及格线。',
      see: ['baseline', 'seasonal-naive-method'],
      links: { problem: 'p1-naive' }
    },
    {
      id: 'seasonal-naive-method',
      term: '季节朴素法',
      en: 'seasonal naive',
      cat: 'methods',
      def: '预测「下个月」直接抄「这个月」、预测明天 8 点直接抄今天 8 点。在强季节序列上是个很难打败的零参数基线。',
      see: ['naive-method', 'seasonality'],
      links: { problem: 'p3-seasonal-naive' }
    },
    {
      id: 'exponential-smoothing',
      term: '指数平滑',
      en: 'exponential smoothing',
      cat: 'methods',
      def: '按指数衰减的权重做加权平均：越近的观测权重越大。一个参数 α 控制记忆长短：α 大记得近、α 小记得久。',
      see: ['ses-alpha', 'holt'],
      links: { problem: 'p4-ses' }
    },
    {
      id: 'ses-alpha',
      term: '平滑系数 α',
      en: 'smoothing parameter',
      cat: 'methods',
      def: '0 到 1 之间的「更新速度」。α=0.3 意味着新观测占 30%、旧状态占 70%。α 不是拍脑袋定的，要让拟合误差最小。',
      see: ['exponential-smoothing']
    },
    {
      id: 'holt',
      term: 'Holt 双参数平滑',
      en: 'Holt method',
      cat: 'methods',
      def: '在水平（现在多高）之外再平滑一条趋势（每期走多远），预测 = 水平 + 步数×趋势。趋势无限外推是它的经典翻车点。',
      see: ['exponential-smoothing', 'holt-winters'],
      links: { problem: 'p5-holt' }
    },
    {
      id: 'holt-winters',
      term: 'Holt-Winters 三参数平滑',
      en: 'Holt-Winters',
      cat: 'methods',
      def: '水平 + 趋势 + 季节三条方程一起平滑。加性适合振幅恒定、乘法适合振幅随水平变大，选错形态误差会系统性偏。',
      see: ['holt', 'seasonality'],
      links: { problem: 'p6-holt-winters' }
    },
    {
      id: 'ar-model',
      term: '自回归 AR(p)',
      en: 'autoregression',
      cat: 'methods',
      def: '用过去 p 个值线性解释现在：y_t = φ1·y_{t-1} + … + φp·y_{t-p} + 噪声。参数可由 Yule-Walker 方程一步解出，不用迭代。',
      see: ['acf', 'arima'],
      links: { problem: 'p11-ar-yw' }
    },
    {
      id: 'arima',
      term: 'ARIMA',
      en: 'ARIMA',
      cat: 'methods',
      def: '差分（I）+ 自回归（AR）+ 滑动平均（MA）的组合框架，Box-Jenkins 流程：看图定阶、估计参数、检查残差是否白噪声。',
      see: ['ar-model', 'differencing', 'white-noise'],
      links: { method: 'arima' }
    },
    {
      id: 'acf',
      term: '自相关 ACF / 偏自相关 PACF',
      en: 'autocorrelation / partial autocorrelation',
      cat: 'methods',
      def: 'ACF 量「隔 k 步的两个值有多相关」；PACF 把中间步的影响扣掉只看净相关。读图定阶口诀：PACF 截尾想 AR，ACF 截尾想 MA。',
      see: ['ar-model', 'white-noise'],
      links: { course: 'm2' }
    },
    {
      id: 'white-noise',
      term: '白噪声',
      en: 'white noise',
      cat: 'methods',
      def: '没有记忆的纯随机抖动：任何两个时刻都不相关。好模型的残差应当接近白噪声——规律都被提干净了。',
      see: ['acf', 'noise'],
      links: { course: 'm2' }
    },
    {
      id: 'theta-method',
      term: 'Theta 方法',
      en: 'Theta method',
      cat: 'methods',
      def: '把序列拆成「长期线性趋势线」与「短期波动线」两条 θ 线，各用最笨的方法预测后对半组合。曾在 M3 竞赛夺冠，是「简单组合打败复杂模型」的招牌案例。',
      see: ['combination'],
      links: { problem: 'p10-theta' }
    },
    {
      id: 'croston',
      term: 'Croston / TSB',
      en: 'Croston / TSB',
      cat: 'methods',
      def: '间歇需求专用：把「非零需求量」和「需求出现频率」分开各自平滑，预测 = 量×频率。TSB 直接平滑出现概率，需求消失时预测会自然衰减到 0。',
      see: ['intermittent-demand'],
      links: { problem: 'p12-croston' }
    },
    {
      id: 'spectral',
      term: '频域 / 周期图',
      en: 'frequency domain / periodogram',
      cat: 'methods',
      def: '把序列按频率展开看能量分布：哪个频率亮，说明序列里藏着哪个周期的波。周期不用事先知道，数据自己「说」出来。',
      see: ['seasonality'],
      links: { problem: 'p13-harmonic' }
    },
    {
      id: 'combination',
      term: '组合预测',
      en: 'forecast combination',
      cat: 'methods',
      def: '把多个模型的预测取平均或中位数。只要成员误差不完全同向，组合方差就更小——预测领域最稳的免费午餐。',
      see: ['theta-method'],
      links: { problem: 'p14-combination' }
    },
    {
      id: 'recursive',
      term: '递归 vs 直接多步',
      en: 'recursive vs direct',
      cat: 'methods',
      def: '递归：先预测一步，把预测当历史再预测下一步，误差逐步累积；直接：一步到位为每个未来位置建模型。长 horizon 通常直接更稳。',
      see: ['horizon'],
      links: { problem: 'p7-direct-multistep' }
    },
    {
      id: 'robust-stat',
      term: '稳健统计',
      en: 'robust statistics',
      cat: 'methods',
      def: '用中位数、截尾均值这类不被极端值带跑的估计量。异常点多或大促频繁的序列上，稳健估计常比均值靠谱。',
      see: ['outlier'],
      links: { problem: 'p8-robust-shift' }
    },
    {
      id: 'global-model',
      term: '局部模型 vs 全球模型',
      en: 'local vs global model',
      cat: 'methods',
      def: '局部：每条序列单独拟合；全球：成千上万条序列一起训练一套参数。序列多而短时全球模型能「借力」。',
      see: ['foundation-model'],
      links: { method: 'deepar' }
    },

    /* ---------- prob 概率与区间 ---------- */
    {
      id: 'quantile',
      term: '分位数',
      en: 'quantile',
      cat: 'prob',
      def: '把分布切开的点：0.9 分位数意味着 90% 的值落在它以下。中位数就是 0.5 分位数。',
      see: ['prediction-interval', 'pinball']
    },
    {
      id: 'prediction-interval',
      term: '预测区间',
      en: 'prediction interval',
      cat: 'prob',
      def: '给预测配一个「真值大概率落在这个范围」的上下界，如 80% 区间。区间不是模型附赠的装饰，宽度和覆盖率都要评估。',
      see: ['coverage', 'conformal'],
      links: { course: 'm5' }
    },
    {
      id: 'coverage',
      term: '覆盖率',
      en: 'coverage',
      cat: 'prob',
      def: '真值真的落在区间里的比例。标称 95% 的区间实测只有 80% 就是「过窄」；报覆盖率时必须同时报样本量。',
      see: ['prediction-interval', 'calibration']
    },
    {
      id: 'calibration',
      term: '校准',
      en: 'calibration',
      cat: 'prob',
      def: '让「说 90% 把握」的事情真的 90% 发生。概率预测的第一课：先看校准（准不准），再看锐度（区间窄不窄）。',
      see: ['coverage', 'crps']
    },
    {
      id: 'pinball',
      term: 'pinball 损失',
      en: 'pinball loss',
      cat: 'prob',
      def: '训练分位数用的不对称损失：对 τ=0.9 的上界，低估罚 0.9 倍、高估只罚 0.1 倍，模型自然学会把上界报高一点。',
      see: ['quantile'],
      links: { method: 'pinball' }
    },
    {
      id: 'crps',
      term: 'CRPS',
      en: 'continuous ranked probability score',
      cat: 'prob',
      def: '给「整个预测分布」打一个分：既奖励报得准，又奖励区间窄。点预测下退化为 MAE，是评概率预测的标准指标。',
      see: ['calibration', 'pinball'],
      links: { method: 'crps' }
    },
    {
      id: 'conformal',
      term: '一致性预测',
      en: 'conformal prediction',
      cat: 'prob',
      def: '不假设误差分布，用一份「校准集」上的残差分位数来定区间宽度，换取覆盖率保证。可以套在任何点预测模型外面。',
      see: ['prediction-interval', 'coverage'],
      links: { method: 'conformal' }
    },

    /* ---------- deep 深度学习与基础模型 ---------- */
    {
      id: 'patch',
      term: 'Patch（块）',
      en: 'patch',
      cat: 'deep',
      def: '把连续若干个点捆成一个 token 送入模型（如每 16 个点一块）。序列变短、注意力变便宜，是现代时序模型的通用手法。',
      see: ['channel-independent'],
      links: { method: 'patchtst' }
    },
    {
      id: 'channel-independent',
      term: '通道独立',
      en: 'channel independence',
      cat: 'deep',
      def: '多变量序列的每条通道单独过模型、互不交互。反直觉地常比交互建模更稳；变量间强相关时则吃亏。',
      see: ['patch'],
      links: { method: 'patchtst' }
    },
    {
      id: 'tokenize',
      term: '量化 token 化',
      en: 'quantization / tokenization',
      cat: 'deep',
      def: '把连续数值按词表离散化成「词」，让语言模型架构直接处理时序。词表粒度是精度与建模难度的折中。',
      see: ['foundation-model'],
      links: { method: 'chronos' }
    },
    {
      id: 'foundation-model',
      term: '时序基础模型',
      en: 'time series foundation model',
      cat: 'deep',
      def: '在海量序列上预训练的大模型，对新序列零样本/少样本即可预测（TimeGPT、Chronos、TimesFM、Moirai、Time-MoE、Sundial 等）。评估责任不因此免除。',
      see: ['zero-shot', 'global-model'],
      links: { course: 'm6' }
    },
    {
      id: 'zero-shot',
      term: '零样本 / 少样本',
      en: 'zero-shot / few-shot',
      cat: 'deep',
      def: '零样本：不给任何目标序列的训练数据直接预测；少样本：给少量目标数据在上下文里适配。是基础模型的核心卖点。',
      see: ['foundation-model'],
      links: { course: 'm6' }
    },
    {
      id: 'moe',
      term: '混合专家 MoE',
      en: 'mixture of experts',
      cat: 'deep',
      def: '把大模型拆成多个「专家」子网络，每个输入只激活其中几个。总参数可以非常大，单次计算量却很小。',
      see: ['foundation-model'],
      links: { method: 'time-moe' }
    },
    {
      id: 'linear-revival',
      term: '线性复兴',
      en: 'linear revival',
      cat: 'deep',
      def: '2023-2024 的实证风潮：DLinear、FITS、SparseTSF、CycleNet 用一层线性（配合显式周期/频域结构）追平甚至超过复杂 Transformer。',
      see: ['patch', 'foundation-model'],
      links: { method: 'cyclenet' }
    },

    /* ---------- platform 平台术语 ---------- */
    {
      id: 'run-vs-submit',
      term: '运行 vs 提交判题',
      en: 'run vs submit',
      cat: 'platform',
      def: '「运行」= 试跑一遍看分数，不记成绩，随便折腾；「提交判题」= 正式计分并写进进度。新手流程：先运行到满意，再提交。',
      see: ['verdict', 'pass-score'],
      links: { course: 'm0' }
    },
    {
      id: 'verdict',
      term: 'AC / WA / TLE / RE',
      en: 'verdicts',
      cat: 'platform',
      def: '判题结果四态：AC 通过、WA 答案错误（分数不够）、TLE 超时（单次 1500ms / 整题 8000ms）、RE 运行错误（语法错、返回值非法、碰了封禁 API）。',
      see: ['sandbox'],
      links: { problem: 'p1-naive' }
    },
    {
      id: 'pass-score',
      term: '通过线与题解解锁',
      en: 'pass score',
      cat: 'platform',
      def: '每个测试点得分 ≥ 60（通过线）判 AC；全部通过后参考题解才解锁。没通过时提示可以看，题解不行。',
      see: ['verdict', 'score-ratio']
    },
    {
      id: 'sandbox',
      term: '判题沙箱',
      en: 'sandbox',
      cat: 'platform',
      def: '你的代码跑在 Web Worker 里：网络、DOM、存储等 API 全部封禁，超时立即终止。它防误用，不是对抗恶意攻击的安全边界。',
      see: ['verdict']
    },
    {
      id: 'predict-api',
      term: 'predict 函数接口',
      en: 'predict API',
      cat: 'platform',
      def: '每道题只需实现 predict(history, horizon, ctx)：history 是历史数组（拿不到未来）、horizon 是步长、ctx 提供频率与周期。返回长度必须等于 horizon 且全为有限数。',
      see: ['horizon', 'verdict'],
      links: { problem: 'p1-naive' }
    }
  ];

  TSJ.glossary = glossary;
  TSJ.glossaryCategories = CATEGORIES;
})(typeof window !== 'undefined' ? window : this);
