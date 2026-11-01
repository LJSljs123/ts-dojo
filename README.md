# 时序竞技场 TSOJ · 时间序列预测在线判题平台

[![Deploy to GitHub Pages](https://github.com/LJSljs123/ts-dojo/actions/workflows/deploy.yml/badge.svg)](https://github.com/LJSljs123/ts-dojo/actions/workflows/deploy.yml)

**TSOJ · Time-Series Arena** — an online judge for time-series forecasting, fully client-side:
zero dependencies, zero build steps, works offline from a single HTML file.
Write a `predict(history, horizon, ctx)` function, submit, and beat statistical baselines
to score points and unlock editorial solutions.

Includes **18 judged problems**, **47 annotated methods** (classic statistics through
2024-2026 foundation models), **9 courses**, a visual experiment lab with live parameter
sliders, and a model studio with a strict train/val/test experiment protocol.

> **Online**: <https://ljsljs123.github.io/ts-dojo/> (auto-deploys on push to main)

一个**纯前端、零依赖、零构建**的时间序列预测在线判题学习平台（类洛谷）：看题 → 写代码 → 提交 → 判题给分 → 解锁题解。

- **无需安装任何东西**：双击 `index.html` 即可使用（`file://` 协议下完整可用）。
- **无外部依赖**：不引 CDN、不引外部字体、不引图片、不引 npm 包。图标是内联 SVG，字体是系统字体栈。
- **无构建步骤**：纯 HTML + CSS + 原生 JavaScript（ES2019），经典 `<script>` 顺序加载，全部挂在全局命名空间 `window.TSJ` 上。
- **方法库：48 个方法 / 5 个层次**（含 2024-2026 顶会顶刊新知识：FITS / SparseTSF / CycleNet / TimeMixer / ModernTCN / TimeGPT / Chronos / TimesFM / Moirai / Lag-Llama / Timer / MOMENT / Time-MoE / Sundial / Time-LLM），可检索、可展开、可跳题 —— 把「题库」从 18 道练习扩成一条有文献脉络的训练场。
- **v3.2 研究工作台**：`#/` 工作台、9 模块课程（m4/m6 已扩至 2024-2026 前沿）、48 个方法详情页、**可视化实验室**（12 个白名单方法 + 受控回测 + 诊断图）、**`#/glossary` 新手术语表**（83 条行话大白话速查 + 站内跳转）、深浅主题与三档响应式；所有实验固定数据版本、切分协议与指标，测试真值不参与校准。
- **隔离执行环境判题**：用户代码在 `Blob URL` 创建的 Web Worker 中执行，单次 1500ms / 整题 8000ms 超时保护，网络与 DOM 类 API 全部封禁；无 Worker 时**拒绝提交**而不是降级卡死页面。

---

## 一、如何运行

**方式 A0（最省事）：在线版**——<https://ljsljs123.github.io/ts-dojo/>（推送 main 自动部署，GitHub Pages + Actions，见 `.github/workflows/deploy.yml`）。

**方式 A（推荐，最不容易出问题）：单文件版**

```
双击 ts-dojo-standalone.html
```

它把 CSS 与 53 个脚本全部内联成一个约 885KB 的 HTML，**不依赖任何相对路径**。
所以无论是双击打开、丢进 http 服务器、还是被塞进 iframe / `srcdoc` / 预览面板里，都能正常渲染。

**方式 B：模块化版**

```
直接双击 index.html
```

或用任意静态服务器（可选，非必需）：

```bash
python -m http.server 8080
# 然后访问 http://localhost:8080
```

模块化版有 53 个 `<script src>` + 4 个样式表，**必须保证 assets 目录随行**。
如果它白屏，页面会自己显示「启动失败」面板并给出原因（脚本被拦截 / 资源 404 / 旧缓存），不会再无声无息。

浏览器要求：Chrome / Edge / Firefox / Safari 近三年版本（需要 `Worker`、`canvas`、`localStorage`、`Proxy`）。

首次进入会有一个简短引导，说明「写 `predict` 函数 → 提交 → 打败基线得分 → 解锁题解」，并附「零基础第一课」（`#/learn/m0`，25 分钟）入口；第 1 题题面下方默认展开「手把手带做」四步面板。

### 改了源码后如何更新单文件版

```bash
node tools/stamp-assets.js          # 重新给 index.html 的 52 处 ?v= 打内容哈希
node tools/build-standalone.js      # 重新生成 ts-dojo-standalone.html
node tests/standalone-check.js      # 校验产物与源码一致、无外部引用、脚本未截断
```

`tests/standalone-check.js` 会在产物过期时直接报「内容不一致」，避免发布一个旧版本。

**为什么 `?v=` 是内容哈希而不是版本号**：这 52 处引用一度全都停在 `?v=3.5.0`，而项目已经走到 v3.10。老访客的浏览器会命中旧缓存——拿到没有 `drawParts` 的 `chart.js`，P18 的分量预览就静默消失，而单文件版查不出来（它是内联的）。手写版本号忘改一次就复发；内容哈希由文件本身算出来，忘不掉。`tests/qa/assets-version.test.js` 把「token 必须等于内容哈希」变成断言，所以改完任何 `assets/` 下的文件都要重跑一次打标工具。

---

## 二、功能一览

| 模块 | 能力 |
|---|---|
| 工作台 | `#/` 汇总本机学习进度（**进度环 + 分难度通过条**）、最近提交、最近实验与继续学习入口；快捷入口含模型工坊；**Ctrl/Cmd+K 全局命令面板**可直达任意题目/方法/课程/术语与快捷动作 |
| 题库 | 18 道题（入门→挑战）、难度筛选、**标签筛选**、**搜索**（题号/标题/标签）、**随机一题**（优先未通过）、三条件取交集；窄屏标签云默认折叠 |
| 方法库 | **48 个方法卡片 · 5 个层次**（经典统计 15 / 竞赛级方法 3 / 顶会深度学习 14 / 时序基础模型 10 / 评估方法论 6）；搜索覆盖 name / title / venue / tags / idea，与层筛选、「只看能练的」取交集；**方法详情页**含直觉 / 公式 / 假设 / 复杂度 / 局限 / 反例 / 数值小例 / 运行级别 / 一手来源 |
| 课程 | **9 个模块（含零基础第一课 m0）**：零基础第一课（奶茶店例子 + predict 逐行 + 报错翻译 + JS 十行速成）→ 数据基础 → 经典统计 → 特征与 ML → 深度学习 → 概率预测 → 基础模型 → 评测与泄漏 → 业务与结构化预测；m4 已扩至 2024「线性复兴」、m6 已扩至 2023-2026 基础模型全景；先修关系、正文、公式小例、演示出口、练习产出、参考来源与完成度 |
| 实验室 | `#/lab` 受控回测：11 条数据、12 个白名单方法、有限参数、holdout/rolling、MSE/MAE/sMAPE；**实时调节滑杆——拖动参数即重算图表与指标（同步配置面板、不写记录），点「运行实验」按当前滑杆值正式保存**；结果区图表前置 + 分段控件 + 指标表「优/劣」标记；最近 20 组本地记录、导出/导入、确定性复现；切走路由即取消在途实验 |
| 判题 | 留出 / 滚动回测；与 4 条统计基线比误差；逐测试点 verdict + 指标对比；判题会话隔离（切题不会串成绩） |
| 学习 | 题面含数学公式与数据说明、折叠提示（**P5-P15 带数学补给提示**，线性代数概念可点直达术语表）、**P1「手把手带做」四步面板**、**参考解逐行语法+算法双注**（P4/P5/P6/P11）、通过后解锁参考题解、学习路径时间线、课程地图 |
| 术语表 | `#/glossary` 83 个术语大白话速查（**9 个分类，含「数学补给」**：向量/矩阵/线性方程组/最小二乘/傅里叶等；搜索与分类取交集、相关术语互跳、课程/方法/题目直达） |
| 进度 | 每题最高分 / 通过状态 / 草稿自动保存；**进度导出为 JSON、导入合并、一键清空**（换机器不丢记录） |
| 复盘 | **提交详情页**：当时提交的代码快照（语法高亮）+ 逐测试点结果，刷新后仍可访问 |
| 图表 | 数据预览（历史 / 测试区间 / 你的预测三色）；**hover 十字线 + tooltip**（高亮点带描边环）；**色板走 CSS 变量、深浅主题实时适配**（切主题即重绘）；**整洁刻度**网格、历史线渐变面积、预测线空心端点；v3 统一图表内核支持预测对比、区间扇形、残差、ACF/PACF、季节分解、指标对比 |
| 编辑器 | 语法高亮、行号、Tab 缩进、括号自动配对、**括号匹配高亮**、**字号 12/13/14**、`Ctrl/Cmd+S` 存草稿、`Ctrl/Cmd+Enter` 运行；**>800 行自动降级**关闭实时高亮保证输入流畅 |
| 主题 | system / light / dark，写入 `tsoj:theme`，跨刷新保留；**切换主题时全部画布即时重绘换色**（MutationObserver 联动 v1/v3 两套图表内核）；语义色不只靠颜色区分 |
| 快捷键 | **Ctrl/Cmd + K** 全局命令面板（搜索/跳转/动作，↑↓ 选择 ↵ 跳转）；编辑器内 Ctrl/Cmd+Enter 运行、Ctrl/Cmd+S 存草稿、**Esc 退出编辑器**（Tab 被缩进占用，没有 Esc 就是键盘陷阱） |
| 模型工坊 | `#/studio` **自己搓一个模型跑完整实验流程**：写带训练逻辑的 predict → ① 验证集评估（train 拟合 / val 打分，可反复迭代）→ ② 最终评测（train+val 拟合 / test 打分，同代码评测次数如实记录防窥探）→ 报告（MSE vs 最优基线 + 预测对比图带 train/val/test 分界线）→ 实验记录留档/载入/导出；**支持上传自己的 CSV**（单列数值或「时间,数值」两列，逗号/分号/制表符自动嗅探，≥72 点，季节周期自动估 + 本地恢复）；**一键导出分享卡**（自包含 HTML，含预测对比图与实验参数）；沙箱与判题完全同源 |
| 成就 | 8 个成就徽章（首 AC / 三连胜 / 入门毕业 / 工坊开张 / 诚实研究者 / 词典编纂者 / 方法旅行家 / 半分神话），全部由真实事件推导，解锁即 toast 并落盘；工作台徽章墙可见已解锁/未解锁与条件 |
| 窄屏 | ≤640px 自动切换**卡片式列表**（标题正常换行，不再挤成一字一行）、题目页上下堆叠、触控目标 ≥40px、筛选默认折叠 |
| 可访问性 | 弹层焦点陷阱 + ESC 关闭 + 焦点恢复、结果面板 `aria-live`、编辑器错误 `aria-describedby`、路由切换更新标题并聚焦主区、跳转到主内容链接 |
| 存储 | 跨标签页 `storage` 事件同步（后写不再覆盖先写）、配额超限提示并降级为内存态、脏数据静默归一化 |
| 分发 | **单文件版**（由 tools/build-standalone.js 生成，零外部引用，可嵌 iframe/srcdoc）；模块化版带**启动自检**，白屏会显示具体原因 |

---

## 三、目录结构

```
ts-dojo/
├── index.html                 # 模块化入口（含 CSP + 启动自检 + script 加载顺序）
├── ts-dojo-standalone.html    # 单文件版（由 tools/build-standalone.js 生成，勿手改）
├── tools/
│   ├── build-standalone.js    # 把 CSS / 53 个 js 内联成单文件
│   ├── stamp-assets.js        # 给 index.html 的 ?v= 打内容哈希（防旧缓存）
│   └── numbers.js             # 口径计算：题数 / 方法数 / 脚本数 / 用例数（README 数字的唯一来源）
├── assets/
│   ├── css/
│   │   └── style.css          # 暗色主题（深色底 + 青绿强调色）
│   └── js/
│       ├── datasets.js        # 11 条合成数据集（固定种子确定性生成）
│       ├── problems.js        # 18 道题（题面 / 参考解 / 模板 / 评分参数）
│       ├── methods.js         # 48 条方法卡片（内容层，只读：文案 / 出处 / 年份已核对）
│       ├── judge.js           # 判题引擎：指标 + 基线 + 评分 + Worker 沙箱
│       ├── editor.js          # 自研代码编辑器（高亮 / 行号 / 缩进 / 括号匹配 / 字号）
│       ├── chart.js           # Canvas 折线图（历史 / 测试区间 / 预测 / hover tooltip）
│       ├── app.js             # 应用外壳：路由 / 判题会话 / 落盘 / init()
│       └── app/               # 应用层（经典 script，顺序见下）
│           ├── util.js        #   $/$$、debounce、truncate 等无状态工具
│           ├── core.js        #   STORE 键名、存储读写、字段归一化、esc/fmt
│           ├── schema.js      #   localStorage 数据的归一化与类型守卫
│           ├── store.js       #   state（含判题令牌）+ 派生量 + 合并写盘策略
│           ├── storage.js     #   进度导出 / 导入 / 清空、跨标签页 storage 同步
│           ├── lifecycle.js   #   路由生命周期与在途任务清理
│           ├── ui.js          #   Markdown、结果面板、按钮态、分栏拖拽
│           ├── a11y.js        #   焦点陷阱、ESC 关闭、aria-live、焦点恢复
│           ├── theme.js       #   system/light/dark 主题与画布重绘联动
│           ├── views.js       #   题库页（搜索 / 标签 / 难度 / 随机一题 / 卡片列表）+ 预览图装配
│           ├── problem-extras.js  # 题目页辅助区块：分量预览图 + 相关方法/课程链接（不参与判题）
│           ├── problem.js     #   题目页、编辑器装配、题解弹层、引导弹层
│           ├── pages.js       #   提交记录、提交详情、排行榜、学习路径
│           ├── lab-storage.js #   实验室最近 20 组记录、导入导出
│           ├── lab-panels.js  #   实验室配置/指标/历史面板片段
│           ├── lab-live.js    #   实验室实时滑杆（拖动重算、不写记录）
│           ├── studio-storage.js # 模型工坊实验记录（30 条 / 导入导出）
│           ├── studio-report.js  # 工坊报告与分享卡渲染
│           ├── studio-csv.js     # 工坊 CSV 上传（嗅探 / 校验 / 季节估计）
│           ├── studio.js      #   #/studio 两阶段实验流程
│           ├── achievements.js #  成就定义 / 解锁 / 落盘
│           ├── dashboard.js   #   #/ 工作台（进度环 / 成就墙 / 最近活动）
│           ├── learn.js       #   #/learn 课程地图与模块页
│           ├── method-detail.js # #/methods/:id 方法详情
│           ├── lab.js         #   #/lab 实验室运行 / 诊断 / 记录
│           ├── library.js     #   方法库页（层筛选 / 搜索 / 只看能练的 / 卡片展开）
│           ├── glossary.js    #   #/glossary 术语表
│           ├── boards.js      #   排行榜与学习路径的共享渲染片段
│           └── cmdk.js        #   Ctrl/Cmd+K 全局命令面板
│   ├── content/               # v3 内容层：references / courses / method-details / content / glossary（术语表）
│   ├── charts/                # v3 图表内核：core / series / diagnostics
│   └── lab/                   # v3 实验室引擎：config / adapters / stats / runner
├── tests/
│   ├── qa/                    # node --test tests/qa/*.test.js（266 条）
│   ├── selftest.js            # 判题引擎自测（Node 直接运行，不参与页面加载）
│   ├── starter-check.js       # 18 题模板原样提交必须全 WA
│   ├── storage-audit.js       # localStorage 输出安全静态审计
│   └── standalone-check.js    # 单文件产物校验（是否过期 / 有无外部引用 / 是否被截断）
├── CHANGELOG.md               # v3.2 → v3.9 逐版变更记录
├── ROADMAP.md                 # 三阶段升级路线（触达/能力闭环/机会型）+ 不做清单
├── CONTRIBUTING.md            # 贡献指南（铁律 / 开发循环 / 加题标定流程）
├── 404.html                   # Pages 未知路径兜底（回首页，hash 路由说明）
├── .github/workflows/         # Pages 自动部署（push main → Actions 发布）
├── .github/ISSUE_TEMPLATE/    # bug / 新题提案 / 功能建议表单
├── docs/archive/              # 历史设计文档（v1 审查 / v2.2 施工图 / v3 PRD 与架构 / 接手审计）
└── README.md
```

加载顺序（`index.html` 末尾，顺序不可调换）：

```
datasets → problems → methods
  → content/references → content/courses → content/method-details → content/content → content/glossary
  → judge → editor → chart
  → charts/core → charts/series → charts/diagnostics
  → lab/config → lab/adapters → lab/stats → lab/runner
  → app/util → app/core → app/schema → app/store → app/storage → app/lifecycle
  → app/ui → app/a11y → app/theme → app/views → app/problem → app/pages
  → app/lab-storage → app/lab-panels → app/lab-live
  → app/studio-storage → app/studio-report → app/studio-csv → app/studio → app/achievements
  → app/dashboard → app/learn → app/method-detail → app/lab → app/library → app/glossary
  → app/boards → app/cmdk → app.js
```

依赖方向严格单向（`tests/qa/static.test.js` 会检查）：任何模块都不得引用排在它**后面**的命名空间。

---

## 四、数据集：教学用合成序列

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
| `intermittent` | 备件需求 | 件 | M | 120 | 12 | 约半数月份为零（间歇需求），有需求的月份 20–180 件；随服役期推进需求频率由约 18% 升至约 85%、单次量级放大约 1.2 倍，偶发 3–5 倍大单 |
| `retail_daily` | 日销量（含促销日历） | 件 | D | 730 | 7 | 缓慢增长 + 周季节（周末高）+ 不定期促销尖峰（间隔 9–13 天，+55%~65%）+ 2.5% 噪声；促销日以 `promoDays` 明确给出 |
| `channels_daily` | 渠道日销量 | 件 | D | 730 | 7 | 门店（周周期、周末约工作日 1.6 倍、缓慢增长 + 3% 噪声）与企业（30 天结算周期、月末 3 天冲量约 2.2 倍、增长更快 + 4% 噪声）**逐日相加**；两路以 `parts` 分别给出 |

设计原则：**不要纯正弦**。每条序列都带噪声、异方差、偶发异常点或结构突变，尽量贴近真实业务数据的"脏"。

每条数据集结构：

```js
{ id, name, unit, freq, season, desc, values: number[] }
// 可选（由 build() 的返回对象带上）：
//   promoDays: number[]                        外生事件日历（绝对下标），P17 用
//   parts: Array<{name, period, values}>       分量序列，与 values 等长且逐点相加等于 values，P18 用
```

---

## 五、题目设计

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
| 10 | Theta 方法：两个笨模型拼赢一个聪明模型 | 提高 | Theta / M3 冠军 / 组合 / 去季节 | retail | holdout | 12 | MSE | 0.70 | 60 |
| 11 | AR(p) 与 Yule-Walker：不训练的闭式自回归 | 挑战 | 自回归 / Box-Jenkins / Levinson-Durbin / 闭式解 | sunspot | holdout | 8 | MSE | 0.75 | 60 |
| 12 | 间歇需求：把需求量与需求频率分开估计 | 提高 | 间歇需求 / 零膨胀 / 库存 / Croston / TSB | intermittent | holdout | 12 | MAE | 0.85 | 60 |
| 13 | 周期图 + 谐波回归：让数据自己说出周期 | 提高 | 频域 / 周期图 / 谐波回归 / 最小二乘 | temperature | holdout | 24 | MSE | 0.75 | 60 |
| 14 | 组合预测：别把赌注押在一个模型上 | 提高 | 组合 / 中位数 / 稳健 / Bates-Granger | gmv | holdout | 12 | MSE | 0.80 | 60 |
| 15 | DLinear：一层线性打败一堆 Transformer | 挑战 | 分解 / 线性模型 / AAAI 2023 / 最小二乘 | electricity | holdout | 24 | MSE | 0.70 | 60 |
| 16 | 分位数备货：点冠军不是分位数冠军 | 挑战 | 分位数 / 区间预测 / 容量规划 / pinball / 电力负荷 | electricity | holdout | 24 | pinball | 0.90 | 60 |
| 17 | 促销日历：外生事件怎么进模型 | 提高 | 协变量 / 促销 / 事件效应 / 外生变量 / 零售 | retail_daily | holdout | 14 | MSE | 0.90 | 60 |
| 18 | 渠道拆分：一个总量，两个周期 | 提高 | 聚合 / 分解 / 多周期 / 层级预测 / 自底向上 | channels_daily | holdout | 14 | MSE | 0.90 | 60 |

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
  passRate,                            // 无本地记录时展示的通过率
  ctxExtra(point, dataset) -> {...},   // 可选：题目专属上下文（如 P17 的 promoDays）
  markerField, markerLabel             // 可选：把数据集字段画成预览图上的事件标记
}
```

### 评估模式

- **holdout（留出法）**：训练集 = 序列前 `len - horizon` 点，测试集 = 最后 `horizon` 点，只有 1 个测试点。
- **rolling（滚动回测）**：从 `len - horizon - (windows-1)*originStep` 开始，滑动 `windows` 个 origin；每个 origin 只用该点之前的数据训练，预测之后 `horizon` 步，**逐窗口算指标再取平均**，防止"单窗口运气"。

---

## 六、方法库

`#/methods` 把「时间序列预测」这条线上真正有分量的方法整理成可检索的卡片。数据在 `assets/js/methods.js`
（**内容层，只读**：文案、出处、年份已逐条核对，页面只负责筛选与渲染）。

v3.0 起每张卡片可进入 `#/methods/:id` **方法详情页**：卡片字段仍由 `methods.js` 单一来源提供，
详情层（直觉 / 假设 / 复杂度 / 局限 / 反例 / 数值小例 / 运行级别）在 `assets/js/content/method-details.js`，
一手来源在 `assets/js/content/references.js`。基础模型与真实深度训练一律标「概念级不可沙箱运行」。

### 五层划分（`tier`）

| tier | 名称 | 数量 | 含义 |
|---|---|---|---|
| `classic` | 经典统计 | 13 | 教科书与 IJF/JASA/EJOR 一脉：结构简单、可解释，在小数据上极难被打败（朴素法 / 季节朴素 / SES / Holt / Holt-Winters / Theta / ARIMA / ETS / Croston / TSB / PELT / 周期图 / MAPA） |
| `competition` | 竞赛级方法 | 3 | M3/M4/M5 的实证结论：组合、多尺度聚合、间歇需求的专门处理，往往比换模型更有效 |
| `deep` | 顶会深度学习 | 14 | ICLR/NeurIPS/AAAI/ICML 一脉（N-BEATS / N-HiTS / DLinear / PatchTST / TimesNet / iTransformer / TFT / DeepAR / Informer + 2024 线性复兴：FITS / SparseTSF / CycleNet 与 TimeMixer / ModernTCN），需要训练；卡片标题旁标 `DL` |
| `foundation` | 时序基础模型 | 10 | 2023-2026 的新范式：在海量序列上预训练或复用 LLM，零样本/少样本预测（TimeGPT / Chronos / TimesFM / Moirai / Lag-Llama / Timer / MOMENT / Time-MoE / Sundial / Time-LLM），全部概念级 |
| `eval` | 评估方法论 | 6 | 怎么证明「真的更好」（DM 检验 / MASE / 滚动回测 / Conformal / CRPS / pinball 分位数回归），标 `EVAL` —— 这层最容易出错，也最容易让前面几层的努力白费 |

> v3.2 内容扩充的文献口径：新增方法卡的会议 / 年份 / 标题均逐条核对过一手来源
> （FITS=ICLR 2024、SparseTSF=ICML 2024、CycleNet=NeurIPS 2024 Spotlight、TimeMixer / ModernTCN=ICLR 2024、
> Time-LLM=ICLR 2024、Time-MoE=ICLR 2025、Sundial=ICML 2025、Chronos=TMLR 2025、Timer / MOMENT / TimesFM / Moirai=ICML 2024），
> 并收录了对 LLM 路线的系统质疑（Tan et al., NeurIPS 2024 Spotlight）—— 方法卡与其「反例」对照阅读。

### 新手术语表（`#/glossary`）

面向初学者的行话速查：约 70 个术语（基础概念 / 数据形态 / 切分评估 / 误差指标 / 方法模型 / 概率区间 /
深度学习与基础模型 / 平台术语），每个术语 1-3 句大白话 + 相关术语跳转 + 课程 / 方法卡 / 题目直达链接。
数据在 `assets/js/content/glossary.js`（内容层，只读），页面在 `assets/js/app/glossary.js`，
搜索与分类取交集，链接目标由 `tests/qa/content-v3.test.js` 校验必须真实存在。

### `runnable` 与 `practice` 的含义

- `runnable: true` —— 能在本平台的纯 JS 沙箱里实现（无训练库、单次调用、1500ms 内跑完）。
- `runnable: false` —— 需要训练 / 大量协变量 / 多变量输入，只作知识卡片与选型参考，卡片上灰字标注
  「沙箱跑不了，仅供选型参考」。
- `practice` —— 指向题库里的对应题目 id（如 `p1-naive`）。有值时展开区出现「去练这道题」，跳到
  `#/problem/<id>`；为空但 `runnable` 时灰字「暂无对应题目」。**新增题目后必须让 `practice` 指向真实存在的 id**，
  `tests/qa/library.test.js` 会把这条约束固化成用例。

### 交互

- 搜索匹配 `name` / `title` / `venue` / `tags` / `idea`（大小写不敏感），与层筛选、「只看能练的」**取交集**。
- 层 chips 上的数量、副标题里的「48 个方法 · 5 个层次 · 16 个可练」都从 `TSJ.methods` **现算**，不写死数字。
- 卡片默认收起（`aria-expanded="false"`），标题可 Tab 聚焦 + Enter/Space 展开；展开内容按需生成。
- 「关键式子」按**纯文本**渲染（内含 `*` `+` `Σ`，不走 Markdown），等宽字体 + 保留换行。
- 「检索原文」不硬编码论文 URL（会失效），统一用 Bing 搜标题，`target="_blank" rel="noopener noreferrer"`。
- 375px 下整页 `scrollWidth === 375`，展开区两栏改堆叠。

---

## 七、用户代码接口

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

## 八、判题与评分

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
时 `ratio = threshold` 落在 ④ 区间 → 0 分）。现有 18 道题的 threshold 都在 0.88~0.95。

### 判定规则

- 单测试点：`score >= passScore` 判 `AC`，否则 `WA`；超时 `TLE`；抛异常 / 返回值非法 `RE`。
- 整题：`score` = 各测试点分数均值（四舍五入）。**全部测试点 AC 且总分 ≥ passScore** 才算 `passed = true`。
- 任一测试点 `TLE` → 整题 `TLE`，总分记 0。

---

## 九、沙箱与安全

用户代码在 **Blob URL 创建的 Web Worker** 中执行（`file://` 下无法加载独立 worker 文件，因此必须用 Blob）：

```js
var url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }));
var worker = new Worker(url);
```

### 8.1 口径：这是「隔离执行环境」，**不是**安全边界

本项目的目标是**防止误用**（用户自己写出死循环、误用 `fetch`、误改全局），不是对抗刻意构造的攻击者。
同机同浏览器里能跑任意页面脚本的攻击者，仍然可以通过侧信道等方式推断信息 —— 不要把它当成安全沙箱。

### 8.2 三层防护（缺一不可）

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

### 8.3 无 Worker 时：拒绝提交，而不是降级

若环境禁止创建 Worker（隐私设置 / 旧内核 / 策略限制），`judge.evaluate()` 返回 `{ refused: true, reason }`，
**不会**降级到主线程执行 —— 降级意味着 `while(true){}` 直接锁死页面且没有任何超时保护。
此时题目页的「运行 / 提交判题」按钮直接置灰，结果面板给出明确提示。

`judge.evaluateSync()`（同线程）只用于**可信代码**：参考解评分与排行榜虚拟选手，永不用于用户提交。

### 8.4 数据不足时：显式报错，不静默缩水

滚动回测题需要 `len >= horizon + windows × originStep` 个数据点。不满足时 `judge.evaluate()` 返回
`{ dataError: true, message }`，UI 在结果面板显示提示且**不显示任何分数** ——
不会把「装不下的窗口」静默丢弃后当成正常成绩（回归用例：`regressions.test.js` 的 ④）。

---

## 十、如何扩展

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

新题还必须同时满足三条硬门槛（`tests/selftest.js` 与 `tests/starter-check.js` 会各自检查一半）：

1. 参考解 `passed === true` 且分数落在 78~96；
2. 模板原样提交必须 `WA`（不能 `RE` / `TLE`，更不能通过）；
3. 题目配置的每一条基线单独作为提交都不能通过。

另外：加题后跑一次 `node --test tests/qa/library.test.js` —— 它会校验方法库里每条方法的
`practice` 引用都指向真实存在的题目（内容层先行、题目后补的过渡期除外，见该文件的白名单注释）。

**还要同步 README 的数字**：`node tools/numbers.js` 会打印当前口径并列出 README 里对不上的行号；
`tests/qa/docs-numbers.test.js` 把这件事变成断言，忘了改就会红。

**最后重新打标**：`node tools/stamp-assets.js`。改了任何 `assets/` 下的文件都要跑一次，
否则 `tests/qa/assets-version.test.js` 会红——它挡的是「新代码配旧缓存」这种只在老访客机器上出现的故障。

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

### 新增一条方法（方法库）

往 `assets/js/methods.js` 的 `methods` 数组追加一条即可（页面自动多一张卡片，chips 上的数量、副标题的数字都会跟着变）：

```js
{
  id: 'kebab-case-id',
  name: '中文名',
  title: '论文英文标题',        // 用于「检索原文」，不存 URL（避免失效）
  venue: '会议/期刊（年份）',
  year: 2024,
  authors: '第一作者 et al.',
  tier: 'classic',              // classic / competition / deep / eval
  tags: ['标签'],
  idea: '凭什么有效',
  formula: '关键式子（纯文本，可为空）',
  when: '什么时候该用',
  limit: '什么时候会翻车',
  runnable: true,               // 能否在纯 JS 沙箱里实现
  practice: 'p10-xxx'           // 对应题目 id；没有就 null
}
```

**加完方法（或加了新题）必须跑 `node --test tests/qa/library.test.js`**：
它校验 `tier` 合法性、必填字段、层数量，以及每个 `practice` 是否指向**真实存在**的题目 ——
防止方法库把一个用户点进去就 404 的链接放到卡片上。

---

## 十一、自测

```bash
node tests/selftest.js        # 判题引擎自测（数据 / 参考解 / 指标 / 评分 / 沙箱 / 切分）
node tests/starter-check.js   # 模板有效性自证（18 题模板原样提交必须全部不通过）
node tests/storage-audit.js   # localStorage 输出安全静态审计（esc() 覆盖率 / 类型守卫）
node tests/standalone-check.js  # 单文件版是否与源码同步、是否残留外部引用
node --test tests/qa/*.test.js  # QA 用例（Node 22 不支持目录参数，必须用 glob）
```

**测试规模：266 条用例，0 skip**（其中约 80 条用本机 Edge/Chrome 无头 + CDP 在 `file://` 下真实执行；
找不到浏览器时自动 skip，并在输出里注明「未验证」，不假装通过）。
浏览器用例自带**全局文件锁**：多个测试文件并发时只会排队、不会同时 spawn 多个 Chromium，
因此 `node --test tests/qa/*.test.js` 直接并发跑也是稳的。

| 测试文件 | 关注点 |
|---|---|
| `metrics` / `baselines` / `split` / `scoring` | 指标数学、基线逐值手算、留出与滚动切分、评分单调性与边界 |
| `adversarial` | 非法返回值、死循环、沙箱封禁、跨测试点污染 |
| `solutions` | 18 题参考解通过、朴素解不可过、可复现性 |
| `static` | 语法、无 ESM、无外链、脚本顺序与依赖方向、CSS 覆盖率、存储键前缀 |
| `browser` | 真实浏览器：路由渲染、Worker 判题、XSS 注入、脏数据 |
| `regressions` | 判题竞态（切题串成绩）、沙箱逃逸、375px 溢出、rolling 窗口不足 |
| `features` | 导出/导入/清空、提交详情、窄屏卡片、图表 tooltip、搜索筛选、字号与括号、焦点陷阱 |
| `library` | 方法库：48 条数据完整性、`practice` 引用校验、默认 48 张卡片、搜索/层筛选/只看能练的取交集、跳题、375px 不溢出 |
| `content-v3` | 9 课程 / 48 方法详情 / 术语表完整性（字段 / 分类 / see / 站内链接）、引用与运行级别、Markdown 转义、公式字段 |
| `charts-v3` | ACF/PACF、加性分解、经验分位等图表统计算法 |
| `lab-v3` | 实验室白名单、确定性、候选与基线同源、区间只来自训练残差；连字符基线方法可跑、fail-closed、校准携带真实 season、参数默认值跟随目标方法 |
| `v3-browser` | 新路由、课程/方法详情渲染、实验室端到端、主题持久化、375px 不溢出、20 次路由切换无残留 |
| `studio-csv` | 工坊 CSV 解析：单列 / 时间+数值 / 数值+时间 / 分号+逗号小数 / 点数下限 / 截断 / 脏行 / 季节估计 |
| `achievements` | 成就判定：首 AC / 整题满分（单窗口满分不算）/ 三连胜 / 入门毕业 / 词典编纂者 / 幂等 |
| `docs-numbers` | README 数字与源码一致：题数 / 方法数 / 分层 / 可练 / 数据集 / 课程 / 术语 / 脚本 / 用例数 / 单文件体积 |
| `assets-version` | 发布级：`index.html` 每处 `?v=` 都等于资源内容哈希（防旧缓存）、引用不 404、`assets/` 下无孤儿文件 |
| `contrast` | 主题对比度：深色 / 浅色下逐路由审计可见文字，对比度 < 3:1 即失败（挡「深色粉彩色被搬到浅底上」这类回归） |
| `a11y` | 键盘可达性：跳转链接是第一个可聚焦元素、编辑器 Tab 缩进但 Esc 能退出（键盘陷阱）、弹层焦点陷阱 + Esc + 焦点归还触发按钮、焦点环 ≥2px、可聚焦元素都有可读名字 |
| `clickthrough` | 前端功能点击走查：13 路由冒烟 + 约 90 个控件（主题/抽屉/命令面板、题库筛选、编辑器与判题、方法库/课程/术语表、实验室/工坊、提交记录）逐一点击，验「有反应、不报错、不残留占位符」 |
| `srcdoc` | srcdoc 宿主（预览面板 / 文档阅读器）：现场构建单文件版塞进 `<iframe srcdoc>`，断言点站内链接后应用仍在（`href="#/x"` 在 srcdoc 里会被解析成父页面 URL 而卸载应用）、`#view` 跳转链接只移焦点不改路由 |
| `host-sandbox` | 非文件宿主的另三种形态：`sandbox="allow-scripts"` 里点导航必须真的换页（跨源只能 postMessage 桥）、脚本被拦时 `<noscript>` 兜底卡片必须落在首屏内（原来被 `min-height:100vh` 顶到屏幕外，等于有兜底看不见）、运行期错误不许升级成全屏遮罩（遮罩会吞掉所有点击） |

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
#10 p10-theta           提高  100  true   0
#11 p11-ar-yw           挑战  100  true   0
#12 p12-croston         提高   81  true   36
#13 p13-harmonic        提高   93  true   18
#14 p14-combination     提高   80  true   50
#15 p15-dlinear         挑战  100  true   0
#16 p16-quantile-band   挑战  100  true   0
#17 p17-promo-covariate  提高  100  true   13
#18 p18-channel-mix     提高  100  true   0

IS_PASS: YES
```

> 注：**18 道题全部把 `naive` 放进对照组**，因此「打平基线」只能拿 57 分（`threshold` 通常 0.9~0.95），
> 纯朴素解在 18 道题上全部不通过。P1 的题目因此设计为「朴素法 + 漂移修正」：
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
| 10 | Theta：季节项未归一化（相位均值不为 0，整体水平被顶高） | 57 | WA |
| 11 | AR-Yule-Walker：把自相关系数 ρ(k) 直接当 AR 系数 φ | 0 | WA |
| 12 | Croston：重复最近一次非零需求，未分离需求量与需求频率 | 36 | WA |
| 13 | 谐波回归：周期硬编码 12、只用一组谐波 | 0 | WA |
| 14 | 组合：只组合两个水平/季节成员，缺趋势型候选 | 5 | WA |
| 15 | DLinear：趋势/季节两条分支只做平移复制，没有线性映射 | 57 | WA |
| 16 | 分位数备货：把点预测冠军（季节朴素）当 95 分位水平 | 55 | WA |
| 17 | 促销协变量：只跑季节朴素，促销日历拿到了却没用 | 55 | WA |
| 18 | 渠道拆分：只跑总量上的季节朴素，两个渠道的历史拿到了却没用 | 55 | WA |

模板一律**语法正确、能跑完**（给 WA 而不是 RE），这样学习者拿到的是一张可比较的分数表。
P9 是唯一的例外形态：平均分 79 高于通过线，但窗口 1 只有 44 分 —— 这正好是滚动回测要教的东西。

---

## 十二、localStorage 键名

| 键 | 内容 |
|---|---|
| `tsoj:progress` | `{ [problemId]: { best, passed, attempts, lastVerdict, lastAt } }` |
| `tsoj:drafts` | `{ [problemId]: code }` 代码草稿（输入 400ms 防抖保存） |
| `tsoj:submissions` | `[{ id, at, problemId, title, score, verdict, passed, metric, code, cases, degraded }]`（最多 120 条，`code` 截断 20KB） |
| `tsoj:onboarded` | 是否已看过引导 |
| `tsoj:filter` | 题库页难度筛选 |
| `tsoj:schema` | 存储格式版本（当前 `1`，用于导入时拒绝过新文件） |
| `tsoj:edFont` | 编辑器字号（12 / 13 / 14） |

### 进度导出 / 导入

- 导出文件结构（v3.9 起为**全量备份**）：`{ schema:2, app:'tsoj', exportedAt, data:{ progress, drafts, submissions, extras }, hash }`，
  `hash` 是 `data` 的 FNV-1a 校验，用于识别「手改过的文件」。
- 导入校验顺序：JSON 合法 → `app === 'tsoj'` → `schema <= 当前` → `hash` 匹配 → 字段白名单归一化。
  任一失败都给出具体原因，且**不动现有数据**。
- 合并策略：`best = max`、`attempts` 相加、`passed` 取或、提交记录按 `id` 去重后按时间倒序截 120 条。
- **v3.9 全量备份**：`extras` 键额外携带课程进度 / 成就 / 实验室记录 / 工坊实验与草稿 / 上传 CSV
  （合并策略：成就取最早解锁、achMeta 取大、数组按 id/configHash 去重取新、草稿与 CSV 导入值优先）；
  v1 旧备份文件（仅三键）仍可导入。

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

清空方式：提交记录页顶部「清空进度」按钮（二次确认，只删 `tsoj:*` 前缀键），
或浏览器 DevTools → Application → Local Storage → 删除 `tsoj:*`。

---

## 十三、已知限制

1. **沙箱不是安全边界**。它是"防误用"级别的隔离执行环境（能力遮蔽 + CSP + 超时终止），目标是拦住误用与常见逃逸（`delete` 封禁、原型链取回、`eval` / `Function` 构造器），但**不对抗**刻意构造的侧信道攻击。请不要把不可信代码当成真正的安全威胁模型来跑。
2. **Worker 不可用时禁止提交**（不再降级到主线程）：`evaluate` 返回 `refused: true`，UI 置灰按钮并提示原因。
3. **滚动回测的逐点判定较严**：任一窗口 `score < passScore` 就判 `WA`，即使平均分很高。这是有意为之（"长期可复现的能力"），但也意味着 P9 的容错空间最小。
4. **判题在主线程做结构化克隆**：每个测试点都会把训练窗口（最多 ~700 个数字）传给 Worker，数据量很小，不影响性能。
5. **图表为手绘 Canvas**：折线 + 网格 + 测试区间高亮带 + hover 十字线与 tooltip；**没有缩放/平移**，也没有图例交互（切换某条线显隐）。
6. **编辑器为自研轻量实现**：语法高亮是单遍正则扫描，覆盖 JS 常用词法（注释 / 字符串 / 数字 / 关键字 / 内置名），不做 AST 级分析；支持括号匹配高亮、字号切换、`Ctrl+S` 存草稿；**超过 800 行自动关闭实时高亮**（只留行号与纯文本）以保证输入流畅。`Ctrl+Z` 依赖浏览器对 `setRangeText` 的原生撤销栈，个别浏览器上连续 Tab 缩进的撤销粒度可能较粗。
7. **窄屏只做「可用」不做「精致」**：≤640px 切卡片式列表与上下堆叠，触控目标 ≥40px，但没有针对手机的专门交互（如滑动手势、底部工具栏）。
8. **无后端**：排行榜与通过率都是本地统计 —— 排行榜里的"参考解法"是本地虚拟选手（分数由参考实现实时计算），"通过率"在无本地提交时显示题目自带的静态值；跨设备只能靠导出/导入 JSON 手动同步。
