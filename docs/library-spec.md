# TSOJ v2.2 施工图：方法库（知识库）+ 6 道高阶新题

> 本文件是给工程师的施工图。内容层（`assets/js/methods.js`，29 条方法卡片）**已由主理人写好并校验**，工程师只负责代码实现，**不得修改其中任何一条的文案、出处、年份**。

## 0. 目标

把「题库」从一个 9 题的练习册，扩成一个**带方法论文献脉络的训练场**：

1. 新增 `#/methods` 方法库页面 —— 29 个方法按 4 层（经典统计 / 竞赛级 / 顶会深度学习 / 评估方法论）可检索、可展开、可跳转到对应题目。
2. 新增 6 道高阶题（p10–p15），每道题对应方法库里的一条真实方法，且**必须在纯 JS 沙箱里可解**。
3. 新增 1 个间歇需求数据集（`intermittent`），因为 Croston/TSB 这条线在现有 8 个数据集上无法成立。

## 1. 铁律（违反即返工）

- **不许碰** `judge.js` 的 `metrics` / `baselines` / `scoreForRatio` / `buildTestPoints` / `scoreCase` / `buildReport`。
- **不许碰** `assets/js/methods.js` 的任何内容（文案与出处已核对）。
- **不许改** 现有 9 题（p1–p9）的 `threshold` / `passScore` / `starter` / `solution` / `hints`。
- **不许改** 现有 8 个数据集的种子与生成逻辑（只能在 `datasets.js` **追加** `intermittent`）。
- **不许引入** npm 依赖、CDN、ESM、构建工具。零依赖零构建、经典 script、`file://` 双击可用。
- 每个新增 CSS class 必须在 `style.css` 有定义。
- 不要执行任何 git 命令（统一由主理人提交）。

## 2. 方法库页面

### 2.1 加载与路由

- `index.html`：在 `problems.js` 之后插入
  `<script src="assets/js/methods.js?v=2.2.0"></script>`
- 同时把现有全部 `?v=2.1.0` 改成 `?v=2.2.0`（`static.test.js` 会剥掉 query 再比对，安全）。
- 导航新增一项，位置在「题库」之后：
  `<a href="#/methods" data-nav="methods">方法库</a>`
- 新增视图模块 `assets/js/app/library.js`（≤260 行），加载顺序放在 `pages.js` 之后、`boards.js` 之前。
- `app.js` 的 `route()` 增加分支：
  ```js
  } else if (view === 'methods') {
    store.setActiveNav('methods');
    library.renderMethods();
    a11y.setTitle('方法库');
  }
  ```
  注意 `store.setActiveNav` 必须能接受 `'methods'`（检查其内部是否有白名单）。
- `static.test.js` 的脚本顺序断言要加入 `assets/js/methods.js` 与 `assets/js/app/library.js`。

### 2.2 页面结构

```
[标题] 方法库
[副标题] 29 个方法 · 4 个层次 · 13 个可练   ← 数字从 TSJ.methods 现算，不要写死
[搜索框] 搜索方法名 / 论文标题 / 标签 / 出处
[层筛选 chips] 全部(29) 经典统计(13) 竞赛级(3) 顶会深度学习(9) 评估方法论(4)
[开关] 只看能练的
[卡片列表]
```

卡片（默认收起）：

- 收起态一行：`名称` + 出处徽标（`venue`）+ 层级小标 + 标签（最多 3 个，超出显示 +N）
- 展开态：
  - **核心思想**（`idea`）
  - **关键式子**（`formula`，等宽字体块；`formula` 为空则不渲染这一块）
  - **适用**（`when`）/ **局限**（`limit`）
  - 底部按钮：
    - 有 `practice` → 「去练这道题」跳 `#/problem/<practice>`
    - 无 `practice` 且 `runnable` → 灰字「暂无对应题目」
    - `runnable === false` → 灰字「沙箱跑不了，仅供选型参考」
  - 「检索原文」→ `https://www.bing.com/search?q=` + `encodeURIComponent(title)`，`target="_blank" rel="noopener noreferrer"`

交互要求：

- 搜索匹配 `name` / `title` / `venue` / `tags` / `idea`，大小写不敏感。
- 层筛选与搜索、开关**取交集**。
- 无结果 → 空态 + 「清除筛选」。
- 展开/收起用 `aria-expanded`；卡片标题可 `tabindex="0"` + Enter 切换。
- 全部文案转义（走 `esc()`）。`formula` 里的 `*` `+` 等按纯文本渲染，不要当 Markdown。
- 默认态：无搜索词、层=全部、开关=关（**必须有 29 张卡片**，否则测试挂）。

### 2.3 样式

- 桌面：卡片单列，最大宽度与题库页一致；展开区两栏（左「核心思想+式子」，右「适用+局限」），≤640px 堆叠。
- 出处徽标用现有色板，不要引入新色。
- 顶会深度学习层的卡片，标题旁加一个 `DL` 小标；评估方法论加 `EVAL`。

## 3. 6 道新题（p10–p15）

### 3.0 共同要求

- `difficulty`：`进阶` 或 `挑战`（现有是 `入门`/`中等` 之类，先看现有取值，保持一致）。
- 每题 `statement` 必须包含：**问题背景 → 方法来自哪篇工作（venue + 年份）→ 要你实现什么 → 判分口径**。
- `hints` 2–4 条，最后一条给关键提示但**不给完整代码**。
- `starter` 必须能跑通（不 RE/TLE），但**结果必须不通过**（WA）。
- `solution` 必须 AC 且 `score ≥ 80`（留余量，别卡在 60 分线上）。
- 所有数值必须有限；`predict` 返回长度严格等于 `horizon`。
- 不许用 `Math.random()`（判题要求可复现）。

### 3.1 p10-theta：Theta 方法（IJF 2000，M3 冠军）

- `dataset: 'retail'`，`mode: 'holdout'`，`horizon: 12`，`metric: 'mse'`
- `baselines: ['naive','seasonal_naive','mean','linear_trend']`
- 参考解要点：先做**加性去季节**（用各月平均比值或居中移动平均），在去季节序列上取 θ=0（对时间做最小二乘直线）与 θ=2（SES，α≈0.2，取末端水平），按 0.5/0.5 组合，再加回季节。
- 教学点：两个极简模型拼起来就能打赢单一基线。

### 3.2 p11-ar-yw：AR(p) 与 Yule-Walker（Box-Jenkins 传统）

- `dataset: 'sunspot'`，`season: 1`，`mode: 'holdout'`，`horizon: 8`，`metric: 'mse'`
- `baselines: ['naive','mean','linear_trend']`（无季节，不要放 seasonal_naive）
- 参考解要点：去均值 → 估自协方差 γ(0..p) → Levinson-Durbin 递推解 Yule-Walker（p 取 8~12）→ 多步递推（用已预测值回填）。
- 必须处理：`γ(0)` 为 0（常数序列）时直接返回均值，不得除零。
- 教学点：闭式解 + 递推，不训练也能拿到自回归结构。

### 3.3 p12-croston：Croston 与 SBA（IJF 2005）

- **新增数据集** `intermittent`：月度、约 60% 为零、非零需求 20–180、带轻微上升趋势、偶发大单（3–5 倍）。用现有 `mulberry32` 与固定种子生成，追加到 `datasets.js` 末尾，**不动其他 8 条**。
- `mode: 'holdout'`，`horizon: 12`，`metric: 'mae'`（间歇需求用 MAE 更合理，不要用 mse）
- `baselines: ['naive','mean','moving_average']`
- 参考解要点：分别对「非零需求量」与「需求间隔」做 α=0.1 的指数平滑，`z = d/p`，再乘 SBA 修正 `(1 - α/2)`，输出为常数序列。
- 必须处理：全程零需求时返回全 0；间隔首次出现时给合理初值。
- 教学点：间歇需求不能直接平滑原序列。

### 3.4 p13-harmonic：周期图 + 谐波回归（频域）

- `dataset: 'temperature'`，`mode: 'holdout'`，`horizon: 24`，`metric: 'mse'`
- `baselines: ['seasonal_naive','naive','mean','linear_trend']`
- 参考解要点：对去趋势序列做离散傅里叶变换求功率谱 → 取 top-3 频率 → 用「截距 + 线性趋势 + 3 组 sin/cos」构造设计矩阵 → 最小二乘（正规方程 + 高斯消元）→ 外推。
- 必须处理：频率接近 0 时跳过（那是趋势项）；正规方程奇异时加极小 ridge（1e-8）。
- 教学点：周期不必事先知道，可以从数据里估；这是频域深度模型的思想源头。

### 3.5 p14-combination：组合预测（Bates-Granger 1969）

- `dataset: 'traffic'`，`mode: 'rolling'`（`windows: 4`，`originStep: horizon`），`horizon: 12`，`metric: 'mse'`
- `baselines: ['naive','seasonal_naive','mean','linear_trend']`
- 参考解要点：在内部实现 4 个候选（带漂移的朴素 / 季节朴素 / Holt / SES），用**最近 12 个点的滚动误差**算逆误差权重（或直接取中位数），组合输出。
- 教学点：组合几乎不会灾难性翻车；中位数比加权平均更稳。

### 3.6 p15-dlinear：DLinear 分解线性（AAAI 2023）

- `dataset: 'electricity'`，`mode: 'holdout'`，`horizon: 24`，`metric: 'mse'`
- `baselines: ['naive','seasonal_naive','mean','linear_trend','moving_average']`
- 参考解要点：`trend = 居中移动平均(窗口 2*season+1)`，`seasonal = y - trend`；取最后 `L = 2*season` 个点，两条分支各做「从 L 维到 horizon 维」的最小二乘线性映射（加 1e-6 ridge），预测相加。
- 必须处理：历史长度 < L 时降级为 `seasonal_naive` 而非报错；窗口边界用可用点求均值。
- 教学点：一层线性 + 分解，就能打赢一堆 Transformer。

## 4. 阈值标定（本题的核心工序，必须实测）

对**每道新题**按下面流程标定，不许拍脑袋填 `threshold`：

1. 先写 `solution`，用 `judge.evaluateSync({ problem, dataset, code })` 跑，打印**每个测试点**的 `yourMetric / bestBaseline` 与 `ratio`。
2. `threshold = round(参考解最差 ratio + 0.08, 2)`，并夹在 `[0.55, 0.95]` 内。
3. 三条硬校验，缺一不可：
   - 参考解 `score ∈ [78, 96]`（太高说明题太松，太低说明参考解不够强）；
   - 把 `naive` / `seasonal_naive` / `mean` / `linear_trend` **各自作为提交**跑一遍，全部 `passed === false`；
   - `starter` 提交 `passed === false` 且 `verdict === 'WA'`（不能是 RE）。
4. 把每道题的实测表（ratio / threshold / 参考解 score / 各基线 score）写进回报。

`passScore` 统一 60（与现有题一致），`passRate` 按难度给 20–45 的整数（表示"静态通过率"展示值）。

## 5. 测试更新

### 5.1 把写死的 9 改成动态

以下断言现在写死 `9`，加题后必挂。**改成从 `TSJ.problems.length` 取**，不要改成 15（否则下次加题又挂）：

- `tests/qa/browser.test.js:72`、`:263`
- `tests/qa/features.test.js:456`、`:457`、`:515`、`:631`、`:664`

### 5.2 新增 `tests/qa/library.test.js`

至少覆盖：

1. `TSJ.methods.length === 29`，`tier` 只允许四个合法值，每条必有 `id/name/venue/year/idea/when/limit/runnable`；
2. 所有 `practice` 非空的条目，其题目 id **必须存在于** `TSJ.problems`（防止方法库指向不存在的题）；
3. 所有 `runnable === true` 的方法，其 `practice` 题目必须存在（否则用户点进去没题）；
4. 无头浏览器：`#/methods` 默认 29 张卡片；搜 `patch` 命中 1–2 张；层筛选「顶会深度学习」= 9 张；「只看能练的」= 13 张；清空后回 29 张；
5. 点「去练这道题」→ hash 变成对应 `#/problem/...`；
6. 375px 下 `scrollWidth === 375`，卡片不溢出。

### 5.3 自测脚本

`selftest.js` 与 `starter-check.js` 已遍历 `TSJ.problems`，加题后自动覆盖 —— 但要确认它们对**新题的 metric/baselines** 没有硬编码假设，跑一遍确认 15 题全过。

## 6. 文档

`README.md` 更新：

- 顶部简介加一句「方法库：29 个方法 / 4 个层次，可检索、可跳题」
- 目录结构加 `methods.js` 与 `app/library.js`
- 脚本加载顺序图更新
- 新增一节「方法库」，说明四层划分与 `runnable` 的含义
- 题目表从 9 行扩到 15 行
- 测试计数更新
- 「如何扩展」一节补一句：加方法只需往 `methods.js` 追加一条，加题后跑 `library.test.js` 校验 `practice` 引用

## 7. 交付自证（必须贴实际输出）

1. `node --check` 全部 js 通过。
2. `node --test tests/qa/*.test.js` → 全绿、**0 skip**（贴总数）。
3. `node tests/selftest.js`（15 题参考解全 AC）、`node tests/starter-check.js`（15 题模板全 WA）、`node tests/storage-audit.js`。
4. 第 4 节的**阈值标定实测表**（6 道题，逐题逐基线）。
5. 方法库页面截图：1440px 与 375px 各一张（无头 Edge，`file://`），贴出 375px 的 `scrollWidth`。
6. `node tools/build-standalone.js` + `node tests/standalone-check.js`（单文件版要包含新模块）。
7. 每个文件行数表（新增/修改的文件都要列）。
8. `IS_PASS: YES/NO`。

## 8. 风险提示

- **p12 的新数据集是最大风险**：间歇需求若生成得不够稀疏，Croston 与 mean 的差距会消失，题目就不成立。生成后先打印「零值占比 / 非零均值 / 最大间隔」三个数字确认。
- **p11 的 sunspot 是年度数据**：`season` 必须为 1，否则 `seasonal_naive` 会乱来。
- **p15 的 DLinear 需要解线性方程组**：写一个稳健的高斯消元（列主元 + 1e-8 ridge），别用迭代法。
- **不要把 6 道题都设成"必须打赢所有基线"**：p14 组合题的意图是"组合优于单一模型"，参考解打赢最优基线即可，不要压到 ratio < 0.5（那样只能靠过拟合特定测试点）。
