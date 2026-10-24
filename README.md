# 时序竞技场 TSOJ · 时间序列预测在线判题平台

一个**纯前端、零依赖、零构建**的时间序列预测在线判题学习平台（类洛谷）：看题 → 写代码 → 提交 → 判题给分 → 解锁题解。

- **无需安装任何东西**：双击 `index.html` 即可使用（`file://` 协议下完整可用）。
- **无外部依赖**：不引 CDN、不引外部字体、不引图片、不引 npm 包。图标是内联 SVG，字体是系统字体栈。
- **无构建步骤**：纯 HTML + CSS + 原生 JavaScript（ES2019），经典 `<script>` 顺序加载，全部挂在全局命名空间 `window.TSJ` 上。
- **隔离执行环境判题**：用户代码在 `Blob URL` 创建的 Web Worker 中执行，单次 1500ms / 整题 8000ms 超时保护，网络与 DOM 类 API 全部封禁；无 Worker 时**拒绝提交**而不是降级卡死页面。

---

## 一、如何运行

```
直接双击 ts-dojo/index.html
```

或用任意静态服务器（可选，非必需）：

```bash
python -m http.server 8080
# 然后访问 http://localhost:8080
```

浏览器要求：Chrome / Edge / Firefox / Safari 近三年版本（需要 `Proxy`、`Worker`、`canvas`、`localStorage`）。

首次进入会有一个简短引导，说明「写 `predict` 函数 → 提交 → 打败基线得分 → 解锁题解」。

---

## 二、目录结构

```
ts-dojo/
├── index.html                 # 页面骨架 + 顶部栏 + script 加载顺序
├── assets/
│   ├── css/
│   │   └── style.css          # 暗色主题（深色底 + 青绿强调色）
│   └── js/
│       ├── datasets.js        # 8 条合成数据集（固定种子确定性生成）
│       ├── problems.js        # 9 道题（题面 / 参考解 / 模板 / 评分参数）
│       ├── judge.js           # 判题引擎：指标 + 基线 + 评分 + Worker 沙箱
│       ├── editor.js          # 自研代码编辑器（高亮 / 行号 / 缩进 / 快捷键）
│       ├── chart.js           # Canvas 折线图（历史 / 测试区间 / 预测）
│       ├── app.js             # 应用外壳：路由 / 判题会话 / 提交记录·排行榜·学习路径 / init()
│       └── app/               # 应用层（经典 script，顺序 core → store → ui → views → app.js）
│           ├── core.js        #   STORE 键名、存储读写、字段归一化、esc/fmt/debounce
│           ├── store.js       #   state（含判题令牌）+ 派生量（总分 / 等级 / 每题统计 / 参考解分）
│           ├── ui.js          #   Markdown、结果面板、预测曲线、按钮态、分栏拖拽
│           └── views.js       #   题库页 / 题目页 / 题解 / 引导弹层
├── tests/
│   ├── qa/                    # node --test tests/qa/*.test.js（132 条）
│   ├── selftest.js            # 判题引擎自测（Node 直接运行，不参与页面加载）
│   ├── starter-check.js       # 9 题模板原样提交必须全 WA
│   └── storage-audit.js       # localStorage 输出安全静态审计
└── README.md
```

加载顺序（`index.html` 末尾，顺序不可调换）：

```
datasets.js → problems.js → judge.js → editor.js → chart.js → app.js
```

---

## 三、数据集：教学用合成序列

> **所有序列都是教学用合成数据，由固定种子的确定性伪随机数（mulberry32）在运行时生成，可复现。**
> 同一份代码在任何机器、任何时间、任何浏览器上生成的数字完全一致。

| id | 名称 | 单位 | 频率 | 长度 | 周期 | 形态设计 |
|---|---|---|---|---|---|---|
| `airline` | 航空客运量 | 千人 | M | 144 | 12 | 线性趋势 + 12 月乘法季节（振幅随水平增长）+ 渐强噪声 + 3 个异常月 |
| `electricity` | 用电负荷 | MW | H | 720 | 24 | 24 小时强周期（早晚双峰）+ 周末下降 13% + 缓慢上漂（30 天 +30%）+ 随机尖峰 |
| `temperature` | 日均气温 | ℃ | D | 730 | 365 | 365 天年周期 + 白噪声（σ≈2.4）+ 一次热浪 + 一次寒潮 |
| `traffic` | 道路车流量 | 辆/时 | H | 336 | 24 | 双周期（24 与 168）+ 周末低谷 26% + 偶发拥堵尖峰 |
| `retail` | 零售额 | 万元 | W | 156 | 52 | 线性趋势（每周 +2.6）+ 52 周季节 + 固定节奏促销 + 随机促销尖峰 |
| `sunspot` | 太阳黑子相对数 | 个 | Y | 300 | 11 | 约 11 年准周期（周期本身缓慢变化）+ 振幅调制 + 非对称波形 |
| `demand_shift` | 日需求 | 件 | D | 200 | 7 | 第 110 点附近水平漂移 +24%，之后缓慢增长；弱周周期 + 2% 异常尖峰 |
| `gmv` | 成交额 GMV | 万元 | D | 160 | 7 | 加速增长（含二次项）+ 弱周周期 + 随水平放大的噪声 + 大促尖峰 |

设计原则：**不要纯正弦**。每条序列都带噪声、异方差、偶发异常点或结构突变，尽量贴近真实业务数据的"脏"。

每条数据集结构：

```js
{ id, name, unit, freq, season, desc, values: number[] }
```

---

## 四、题目设计

学习路径（由易到难，知识点逐层叠加）：

| # | 标题 | 难度 | 知识点 | 数据集 | 模式 | 步长 | 指标 | 阈值 | 通过线 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 朴素预测 + 漂移：打平基线不算赢 | 入门 | 基线 / 漂移修正 / 留出评估 | airline | holdout | 12 | MSE | 0.95 | 60 |
| 2 | 移动平均：窗口必须与周期对齐 | 入门 | 平滑 / 相位对齐 | electricity | holdout | 24 | MSE | 0.90 | 60 |
| 3 | 季节朴素：让周期替你说话 | 普及 | 周期性 / 双周期 | traffic | holdout | 24 | MSE | 0.95 | 60 |
| 4 | 简单指数平滑 SES：只维护一个水平 | 普及 | 指数平滑 / α | temperature | holdout | 20 | MSE | 0.90 | 60 |
| 5 | Holt 线性趋势：让预测跟着趋势走 | 普及 | 趋势 / 双参数 | gmv | holdout | 14 | MSE | 0.95 | 60 |
| 6 | Holt-Winters 加性：趋势 + 季节三件套 | 提高 | 趋势 + 季节 | airline | holdout | 12 | MSE | 0.90 | 60 |
| 7 | 直接多步预测：拒绝误差累积 | 提高 | 多步策略 / 分解 | retail | holdout | 12 | MSE | 0.90 | 60 |
| 8 | 突变与异常：鲁棒的水平与相位估计 | 提高 | 鲁棒统计 / 水平漂移 | demand_shift | holdout | 20 | MAE | 0.90 | 60 |
| 9 | 滚动回测：在 4 个时间起点上都要赢 | 挑战 | 滚动回测 / 初始化技巧 | airline | rolling×4 | 12 | MSE | 0.88 | 60 |

题目对象字段（`assets/js/problems.js`）：

```js
{
  id, index, title, difficulty,        // 入门 / 普及 / 提高 / 挑战
  tags: [...], points, passScore,      // 满分、通过线
  dataset, mode,                       // 'holdout' | 'rolling'
  horizon,                             // 预测步长
  originStep, windows,                 // 仅 rolling 模式使用
  metric,                              // mse / rmse / mae / mape / smape
  baselines: [...],                    // 参与对比的统计基线
  threshold,                           // 必须打败最优基线的倍数
  statement, inputSpec, outputSpec,    // 题面（简易 markdown）
  hints: [...],                        // 折叠显示的提示
  solution,                            // 参考实现代码字符串（通过后可见）
  starter,                             // 预填到编辑器的模板
  passRate                             // 无本地记录时展示的通过率
}
```

### 评估模式

- **holdout（留出法）**：训练集 = 序列前 `len - horizon` 点，测试集 = 最后 `horizon` 点，只有 1 个测试点。
- **rolling（滚动回测）**：从 `len - horizon - (windows-1)*originStep` 开始，滑动 `windows` 个 origin；每个 origin 只用该点之前的数据训练，预测之后 `horizon` 步，**逐窗口算指标再取平均**，防止"单窗口运气"。

---

## 五、用户代码接口

每道题只需要实现一个函数：

```js
function predict(history, horizon, ctx) {
  // history : number[]  历史观测（长度 = 训练窗口长度，至少 2 个季节周期）
  // horizon : number    需要预测的未来步数
  // ctx     : { freq:'M'|'D'|'H'|'W'|'Y', season:number, datasetId, index }
  // 返回    : number[]  长度必须 === horizon，不能含 NaN / Infinity
  return new Array(horizon).fill(history[history.length - 1]);
}
```

判题时会被包装成：

```js
new Function('history', 'horizon', 'ctx', code + '\n;return predict(history, horizon, ctx);')
```

因此 `code` 里必须有 `predict` 的函数声明（或赋值）。返回值会被严格校验：**长度必须等于 horizon，每个元素必须是有限数值**。

---

## 六、判题与评分

### 指标（`judge.metrics`）

`mse` / `rmse` / `mae` / `mape` / `smape`，签名统一为 `fn(actual, predicted) => number`。
`mape` 对 `|actual| < 1e-9` 的样本跳过；`smape` 分母加 EPS 防 0 除；全 0 序列返回 0。

### 基线（`judge.baselines`）

`naive`（重复最后值）、`seasonal_naive`（重复上一季）、`mean`（历史均值）、`linear_trend`（全局最小二乘直线外推）、`moving_average`（窗口 = 季节长度的均值）。

每个测试点会算出所有基线的指标，**取其中最小的作为该测试点的「最优基线」**。

### 评分公式（`judge.scoreForRatio`）

```
ratio = 你的指标 / 最优基线指标            （越小越好）

        ⎧ 100                                    ratio ≤ 0.50
score = ⎨ 100 − (ratio−0.50)/(thr−0.50) × (100−pass)   0.50 < ratio ≤ thr
        ⎩ pass × (2.00−ratio)/(2.00−thr)        thr < ratio < 2.00
          0                                      ratio ≥ 2.00
```

关键实现：

```js
function scoreForRatio(ratio, threshold, passScore) {
  if (!isFinite(ratio)) return 0;
  var r = ratio < 0 ? 0 : ratio;
  var pass = clamp(Number(passScore) || 60, 1, 100);
  var FULL = 0.5, ZERO = 2.0;
  var thr = clamp(Number(threshold) || 1, 0.51, ZERO);  // 区间非退化 + 与 ④ 自洽
  if (r <= FULL) return 100;                          // 比基线好一倍 → 满分
  if (r >= ZERO) return 0;                            // ④ 必须先判（thr > 2 时才不会被 ② 抢先）
  if (r <= thr) {                                     // 线性降到通过线
    var t1 = (r - FULL) / (thr - FULL);
    return clamp(Math.round(100 - t1 * (100 - pass)), pass, 100);
  }
  var t2 = (r - thr) / (ZERO - thr);                  // 线性降到 0
  return clamp(Math.round(pass * (1 - t2)), 0, pass);
}
```

性质：**单调不增、分段线性、`ratio = threshold` 时恰好等于 passScore、`ratio ≤ 0.5` 满分、`ratio ≥ 2` 零分**。
例如 `threshold = 0.95, passScore = 60` 时：`ratio=0.5 → 100`，`0.95 → 60`，`1.0 → 57`，`2.0 → 0`。

分支顺序是契约的一部分：**① → ④ → ② → ③**。若把 ②（`r <= thr`）放在 ④ 之前，
`threshold > 2` 时 `ratio = 2` 会命中 ② 拿到 70 分，直接违反「ratio ≥ 2 → 0 分」。
因此 `threshold` 被夹在 `[0.51, 2]`：下界保证 ② 区间非退化，上界保证 ④ 优先（`threshold ≥ 2`
时 `ratio = threshold` 落在 ④ 区间 → 0 分）。现有 9 道题的 threshold 都在 0.88~0.95。

### 判定规则

- 单测试点：`score >= passScore` 判 `AC`，否则 `WA`；超时 `TLE`；抛异常 / 返回值非法 `RE`。
- 整题：`score` = 各测试点分数均值（四舍五入）。**全部测试点 AC 且总分 ≥ passScore** 才算 `passed = true`。
- 任一测试点 `TLE` → 整题 `TLE`，总分记 0。

---

## 七、沙箱与安全

用户代码在 **Blob URL 创建的 Web Worker** 中执行（`file://` 下无法加载独立 worker 文件，因此必须用 Blob）：

```js
var url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }));
var worker = new Worker(url);
```

### 7.1 口径：这是「隔离执行环境」，**不是**安全边界

本项目的目标是**防止误用**（用户自己写出死循环、误用 `fetch`、误改全局），不是对抗刻意构造的攻击者。
同机同浏览器里能跑任意页面脚本的攻击者，仍然可以通过侧信道等方式推断信息 —— 不要把它当成安全沙箱。

### 7.2 三层防护（缺一不可）

**第 1 层：Worker 内的能力遮蔽（judge.js 的 `WORKER_SOURCE`）**

1. **先缓存**内部要用的 `postMessage` / `Function` / `Error` / `isFinite` / `Date.now`，避免被自己封掉；
2. `fetch`、`XMLHttpRequest`、`importScripts`、`WebSocket`、`EventSource`、`Worker`、`SharedWorker`、`postMessage`、`close`、`self`、`globalThis`、`window`、`document`、`localStorage`、`sessionStorage`、`indexedDB`、`navigator`、`location`、`history`、`alert`、`open`、`parent`、`top`、`frames`、`caches`、`BroadcastChannel`、`WebTransport`、`RTCPeerConnection` 全部改成**「读取即抛错」的访问器**，访问即报 `沙箱限制：禁止访问 xxx`；
   - 定义在 **globalThis 与整条原型链**上，且 `configurable: false` / `writable: false` —— `delete` 和重新赋值都恢复不了；
   - 因此 `var g = new Function("return this")(); delete g.importScripts;` 这类 3 行逃逸载荷不再有效（回归用例：`tests/qa/regressions.test.js` 的 ②）；
3. **代码执行面收窄**：全局 `Function` / `eval` 换成抛错桩，`Function.prototype.constructor` 同样封死（否则 `(function(){}).constructor` 就能拿回真正的 `Function`）；`setTimeout` / `setInterval` 只接受函数参数，字符串形式（`setTimeout("code")`）直接拒绝；
4. **冻结**：`Object.freeze(globalThis)` 及整条原型链（含 `Object.prototype`），事后无法再往原型上挂钩子；
5. 用户代码通过 `new Function` 执行，函数体首行 = 用户代码第 1 行；
6. **行号映射**：不同引擎对 `new Function` 的包裹方式不同（V8 头部 3 行、SpiderMonkey 1 行），因此启动时用一段"已知在第 1 行抛错"的探针实测偏移量，再换算成用户行号；
7. 超时：单次执行 **1500ms**、整题 **8000ms**，超时 `worker.terminate()` 并判 `TLE`；
8. 返回值在 worker 内校验（长度 / 有限性），错误信息与行号回传主线程；
9. **测试点之间互不影响**：每个测试点投递的是 `history.slice()` 独立副本，用户代码就地改数组也污染不到下一个窗口。

**第 2 层：CSP（index.html 的 meta）**

```
default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:;
style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none';
worker-src blob:; font-src 'self'
```

| 指令 | 作用 |
|---|---|
| `default-src 'none'` | 默认全部禁止（白名单制） |
| `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:` | 本地脚本 + 内联脚本 + 判题必需的 `new Function` + Blob Worker；**不含 http(s)**，外链脚本一律加载不了 |
| `style-src 'self' 'unsafe-inline'` | 样式表 + 内联 style（结果条/进度条宽度是内联的） |
| `img-src 'self' data:` | 图标 / 内联图 |
| `connect-src 'none'` | `fetch` / XHR / WebSocket / `sendBeacon` 全部禁止 —— **即使 JS 层出现未知逃逸，请求也发不出去** |
| `worker-src blob:` | 判题 Worker 由 Blob URL 创建 |
| `font-src 'self'` | 只用系统字体，无远程字体 |

实测（无头 Edge / `file://` 双击）：上面的指令**不需要**额外补 `file:` —— 本地脚本、内联 style、Blob Worker、`new Function`、canvas 全部正常，5 个路由无 console 异常。

**第 3 层：会话与超时**

- 判题在 Worker 里顺序执行，超时立刻 `terminate()`；
- 路由切换时作废会话令牌并 `abort()` 旧 Worker，**不留后台计算**；
- 旧会话的回调首行校验「令牌 + 题目 id」，不匹配就整段丢弃（不碰 DOM、不写存储）。

### 7.3 无 Worker 时：拒绝提交，而不是降级

若环境禁止创建 Worker（隐私设置 / 旧内核 / 策略限制），`judge.evaluate()` 返回 `{ refused: true, reason }`，
**不会**降级到主线程执行 —— 降级意味着 `while(true){}` 直接锁死页面且没有任何超时保护。
此时题目页的「运行 / 提交判题」按钮直接置灰，结果面板给出明确提示。

`judge.evaluateSync()`（同线程）只用于**可信代码**：参考解评分与排行榜虚拟选手，永不用于用户提交。

### 7.4 数据不足时：显式报错，不静默缩水

滚动回测题需要 `len >= horizon + windows × originStep` 个数据点。不满足时 `judge.evaluate()` 返回
`{ dataError: true, message }`，UI 在结果面板显示提示且**不显示任何分数** ——
不会把「装不下的窗口」静默丢弃后当成正常成绩（回归用例：`regressions.test.js` 的 ④）。

---

## 八、如何扩展

### 新增一道题

在 `assets/js/problems.js` 的 `problems` 数组里追加一个对象即可（无需改动其它文件）：

```js
{
  id: 'p10-my-problem',
  index: 10,
  title: '我的新题目',
  difficulty: '提高',              // 入门 / 普及 / 提高 / 挑战
  tags: ['关键词'],
  points: 100,
  passScore: 60,
  dataset: 'airline',              // 必须存在于 datasets.js
  mode: 'holdout',                 // 或 'rolling'（需 originStep / windows）
  horizon: 12,
  metric: 'mse',
  baselines: ['naive', 'seasonal_naive', 'mean'],
  threshold: 0.9,
  passRate: 30,
  statement: ['### 背景', '', '……'].join('\n'),
  inputSpec: '`history: number[]` —— ……',
  outputSpec: '`number[]` —— 长度必须为 12。',
  hints: ['提示 1', '提示 2'],
  solution: 'function predict(history, horizon, ctx) { /* 参考实现 */ }',
  starter: 'function predict(history, horizon, ctx) { /* 模板 */ }'
}
```

建议：**先用参考解跑一遍 `judge.evaluateSync`，确认 `passed === true` 且分数有合理余量（70~100）**，再发布题目。
`problems.js` 里现有题目就是这么标定的（参考解以真实函数书写，再用 `toString()` 转成字符串，从而被 `node --check` 与自测脚本覆盖）。

### 新增一条数据集

在 `assets/js/datasets.js` 里写一个 `buildXxx(rng)` 生成函数，然后在 `DEFINITIONS` 里登记：

```js
{
  id: 'sensor', name: '传感器读数', unit: 'mV', freq: 'H',
  season: 24, seed: 123456, build: buildSensor,
  desc: '……'
}
```

要求：**只用传入的 `rng`（不要用 `Math.random`）**，这样序列才是确定性的、可复现的。

---

## 九、自测

```bash
node tests/selftest.js        # 判题引擎自测（数据 / 参考解 / 指标 / 评分 / 沙箱 / 切分）
node tests/starter-check.js   # 模板有效性自证（9 题模板原样提交必须全部不通过）
node tests/storage-audit.js   # localStorage 输出安全静态审计（esc() 覆盖率 / 类型守卫）
node --test tests/qa/*.test.js  # QA 用例（Node 22 不支持目录参数，必须用 glob）
```

`selftest.js` 覆盖内容：

1. 每个数据集的长度 / 周期 / 数值合法性；
2. 每道题的参考解能算出分数且 `passed === true`；
3. 每道题提交「朴素法」的得分（验证基线不是随便就能过）；
4. 指标与评分公式的边界行为（含单调性检查）；
5. 沙箱错误路径：语法错误 / 返回值长度错误 / 含 NaN / 抛异常 / 没有 predict / 行号映射；
6. 测试点构造（rolling 的 origin 数量与训练集长度）。

预期输出（末尾）：

```
题目 | 难度 | 参考解分数 | passed | 朴素解分数
#1 p1-naive             入门   73  true   57
#2 p2-moving-average    入门  100  true   55
#3 p3-seasonal-naive    普及  100  true   57
#4 p4-ses               普及   87  true   55
#5 p5-holt              普及  100  true   6
#6 p6-holt-winters      提高   82  true   0
#7 p7-direct-multistep  提高   74  true   0
#8 p8-robust-shift      提高   70  true   55
#9 p9-rolling-challenge 挑战  100  true   0

IS_PASS: YES
```

> 注：**9 道题全部把 `naive` 放进对照组**，因此「打平基线」只能拿 57 分（`threshold` 通常 0.9~0.95），
> 纯朴素解在 9 道题上全部不通过。P1 的题目因此设计为「朴素法 + 漂移修正」：
> 先写朴素法（对照组，57 分），再补一个每步漂移才能过线。

### 模板（`starter`）设计约定

每道题的模板都是**「有洞的骨架」**：保留函数签名、参数说明与结构性注释，
但核心逻辑是明显缺失的占位，原样提交**必然不通过**（`node tests/starter-check.js` 会把这条约定固化成用例）：

| # | 模板的洞 | 模板得分 | 预期 verdict |
|---|---|---|---|
| 1 | `drift = 0`（纯朴素法，打平基线） | 57 | WA |
| 2 | 未对齐的朴素滑动窗口（k=7 与周期 24 不整除，压成一个常数） | 42 | WA |
| 3 | 参考周期退到「两个周期前」 | 58 | WA |
| 4 | 水平项没有平滑（等价朴素法） | 55 | WA |
| 5 | 水平项没有平滑 → 趋势项被噪声带偏 | 29 | WA |
| 6 | 季节项从不递推更新 | 0 | WA |
| 7 | 相位残差剖面没有累加 | 0 | WA |
| 8 | 全历史均值（不鲁棒、不跟手） | 0 | WA |
| 9 | 直接照抄 P6 的两段均值差初始化 + P6 参数 | 79（窗口 44/100/89/82） | WA |

模板一律**语法正确、能跑完**（给 WA 而不是 RE），这样学习者拿到的是一张可比较的分数表。
P9 是唯一的例外形态：平均分 79 高于通过线，但窗口 1 只有 44 分 —— 这正好是滚动回测要教的东西。

---

## 十、localStorage 键名

| 键 | 内容 |
|---|---|
| `tsoj:progress` | `{ [problemId]: { best, passed, attempts, lastVerdict, lastAt } }` |
| `tsoj:drafts` | `{ [problemId]: code }` 代码草稿（输入 400ms 防抖保存） |
| `tsoj:submissions` | `[{ at, problemId, title, score, verdict, passed, metric }]`（最多 120 条） |
| `tsoj:onboarded` | 是否已看过引导 |
| `tsoj:filter` | 题库页难度筛选 |

### 读取约定（把 storage 当不可信输入）

`file://` 下的 localStorage 属于**共享的不透明源**：同目录任意本地页面都能往同一个 origin 写数据，
因此读出来的内容必须当作不可信输入处理：

1. **类型守卫**：`readJSON(key, fallback, guard)` 先校验顶层类型 ——
   `progress` / `drafts` 必须是纯对象（非数组、非 `null`、非字符串），`submissions` 必须是数组，
   `filter` 必须是字符串；不合法则**丢弃并静默重写**为默认值。
2. **字段归一化**：`normalizeProgress` / `normalizeDrafts` / `normalizeSubmissions` 逐字段强转
   （`toScore` → `0..100` 整数、`toCount`、`toTime`、`toText`），非字符串 / 非数值一律丢弃；
   归一化结果与原始值不同时**静默回写**（`readNormalized`），避免同一份脏数据每次启动都要重新处理。
   `passed` 还会与最高分做一致性校验（`best >= passScore`），伪造的 `passed: true` 不会解锁题解。
3. **输出转义**：所有来自 storage 的字段在拼进 `innerHTML` 前一律过 `esc()`（`best` / `score` /
   `title` / `problemId` / `metric` / `at` …），数字字段先做 `Number()` 归一。
   这样即使 storage 里被塞入 `<img src=x onerror=...>`，也只会以文本形式显示。

清空方式：浏览器 DevTools → Application → Local Storage → 删除 `tsoj:*`。

---

## 十一、已知限制

1. **沙箱不是安全边界**。它是"防误用"级别的隔离执行环境（能力遮蔽 + CSP + 超时终止），目标是拦住误用与常见逃逸（`delete` 封禁、原型链取回、`eval` / `Function` 构造器），但**不对抗**刻意构造的侧信道攻击。请不要把不可信代码当成真正的安全威胁模型来跑。
2. **Worker 不可用时禁止提交**（不再降级到主线程）：`evaluate` 返回 `refused: true`，UI 置灰按钮并提示原因。
3. **滚动回测的逐点判定较严**：任一窗口 `score < passScore` 就判 `WA`，即使平均分很高。这是有意为之（"长期可复现的能力"），但也意味着 P9 的容错空间最小。
4. **判题在主线程做结构化克隆**：每个测试点都会把训练窗口（最多 ~700 个数字）传给 Worker，数据量很小，不影响性能。
5. **图表为手绘 Canvas**：只画折线 + 网格 + 测试区间高亮带，没有缩放 / 悬浮提示等交互。
6. **编辑器为自研轻量实现**：语法高亮是单遍正则扫描，覆盖 JS 常用词法（注释 / 字符串 / 数字 / 关键字 / 内置名），不做 AST 级分析；`Ctrl+Z` 依赖浏览器对 `setRangeText` 的原生撤销栈，个别浏览器上连续 Tab 缩进的撤销粒度可能较粗。
7. **难度 / 通过率是本地统计**：没有后端，排行榜里的"参考解法"是本地虚拟选手（分数由参考实现实时计算），"通过率"在无本地提交时显示题目自带的静态值。
