# TSOJ 接手审查报告

**日期**：2026-10-26
**范围**：`D:\deliverables` 全工作区（`ts-dojo` 为主，`gstack` 为次）
**结论**：`ts-dojo` 可以接手。代码结构、测试护栏、产品约束都成立；接手时存在 **1 个发布级缺陷**（单文件版过期）、**3 个真实功能缺陷**（成就事件未接线、CSV 列序误判、季节估计半周期打平）与**一批文档口径漂移**，已在本轮全部修复。`gstack` 不是可接手项目，是历史文档堆放地。

---

## 一、结论卡片

| 项目 | 状态 |
|---|---|
| 项目性质 | 纯前端、零依赖、零构建的时间序列判题学习平台（类洛谷） |
| 代码规模 | 47 个脚本（含 30 个 app 层模块）+ 4 个样式表，无打包器、无 ESM、无外部资源 |
| 内容规模 | 16 题 / 9 套合成数据 / 46 个方法（5 层）/ 9 门课程 / 83 条术语 / 12 个实验室白名单方法 |
| 测试基线 | **217 条 QA 用例**（198 原有 + 10 CSV 解析 + 8 成就判定 + 1 分享卡），另有 selftest / starter-check / storage-audit / standalone-check 四件套 |
| 判题语义 | 指标 / 基线 / 评分 / 切分 16 题锚点全部稳定，selftest 参考解 16/16 passed |
| 产品约束 | file:// 双击可用、单文件版可嵌 iframe/srcdoc、无网络请求（CSP `connect-src 'none'`） |
| 接手风险 | 低。剩余风险集中在「浏览器用例并发 flake」与「新功能行为测试缺口」，不影响正确性 |

---

## 二、工作区全景

### 2.1 `ts-dojo/`（活跃项目，git 仓库）

- 分支干净度：接手时 **15 个已修改文件 + 2 个未追踪文件**，全部属于未提交的 v3.7 工作。
- 未提交内容：P16 分位数备货题、成就系统、工坊 CSV 上传、分享卡导出。
- 完成度：功能闭环基本完整（参考解 100 分、模板 55 分 WA、方法卡接入、UI 接线、静态测试注册），但**文档、产物、测试覆盖没跟上**。

### 2.2 `gstack/`（历史归档，非 git）

- 内容：EdgeDreamer（Neurocomputing 投稿）的文献综述、方法/实验设计审查、风险验证报告；另有 EasyEDA 电源分配原理图的脚本与 `.epro` 工程文件。
- 最后活动：2026-07-20，此后无变更。
- 关键事实：报告引用的真实代码在 **`D:\咱们这个核心实验\prototypes\r1..r4\`**，不在本工作区。`gstack` 只是报告与临时脚本的堆放地，22MB 中大部分是 `node_modules`。
- 处置建议：**不要在此目录继续开发**。若要继续论文，把 `D:\咱们这个核心实验\` 纳入 git；`gstack` 只保留最终报告，脚本与 `node_modules` 归档或移出。

---

## 三、接手时发现的问题

### 3.1 已修复（本轮）

| # | 级别 | 位置 | 问题 | 修复 |
|---|---|---|---|---|
| 1 | **P0 发布** | `ts-dojo-standalone.html` | 产物 22:01 生成，源码改到 22:56。双击单文件版看不到 P16 / 成就 / CSV / 分享卡——**用户实际打开的是旧版** | 重建（795.2KB / 47 脚本），`standalone-check` 全绿 |
| 2 | **P1 测试** | `tests/qa/metrics.test.js:148` | pinball 混合手算写成 `(0.95+0.05)/4 = 0.25`，4 个点应为 `(0.95+0.05)×2/4 = 0.5`。实现正确，测试算错 | 期望值改 0.5，注释写明两点低估 + 两点高估 |
| 3 | **P1 功能** | `assets/js/app/glossary.js` | `onGlossaryLook` 只在 `achievements.js` 定义，**全仓无人调用** → 「词典编纂者」成就永远解锁不了 | `renderGlossary()` 入口接线，每次进入 +1 |
| 4 | **P2 语义** | `assets/js/app/achievements.js` | 「半分神话」按**单个测试点**满分判定。P9 滚动回测窗口 1 得 100、整题 79 分，会被误解锁 | 改为 `result.score === 100`（整题满分），与文案一致 |
| 5 | **P2 语义** | 同上 | 「三连胜」文案写「不换题连续通过」，实现只能看「已通过集合里存在连续题号」，无法追踪做题顺序 | 文案改为「按题号连续通过 3 道题」 |
| 6 | **P1 功能** | `assets/js/app/studio-csv.js` | 文档称支持「数值,时间」两列，实现只要首列不单调就取最后一列 → **取到时间列**，导入的数据是时间戳 | 重写列序嗅探：分别判断两列单调性，单调的那列当时间索引丢弃 |
| 7 | **P1 功能** | 同上 `sniffSep` | 按「出现次数最多」选分隔符。`1,5;2,5` 里逗号与分号各出现 2 次，先遍历逗号 → 小数被拆成两列 | 分号 / 制表符优先（不可能是小数分隔符），都没有才用逗号 |
| 8 | **P1 功能** | 同上 `guessSeason` | 自相关取**绝对值**再取最大：24 小时正弦在 lag=12 反相相关也是 1，先到者胜 → 24 被估成 12 | 一阶差分去趋势 + 只在 7/12/24/52/365 里取**正**相关最高者，阈值 0.25 |
| 9 | **P2 安全** | 同上 `rebuildOptions` | 数据集名（来自文件名）未 `esc()` 就拼 `innerHTML`，与全站「可见文案一律转义」的约定不一致 | 改用 `core.esc(d.name)` |
| 10 | **P3 清理** | `studio.js` / `studio-csv.js` | 死变量 `csvInput`；死函数 `valuesOf` / `looksSequential` 与无效分支 | 删除 |
| 11 | **P2 文档** | `README.md` | 数量口径全面过时：15 题 / 38 脚本 / 588KB / 193 条 / 8 课程 / 70 术语 / 9 题自测表；目录树缺 12 个模块；加载顺序缺 lab-live、studio 系、achievements、cmdk | 全部按实际值校正（16 题 / 47 脚本 / 795KB / 208 条 / 9 课程 / 83 术语 / 16 行自测表） |
| 12 | **P2 文档** | `docs/v3.2-changelog.md` | v3.7 的工作没有任何记录 | 追加「十、v3.7」段（P16 / 成就 / CSV / 分享卡 / 测试契约 / 修复 / 验证） |
| 13 | **P2 测试** | `tests/qa/studio-csv.test.js` | CSV 解析零覆盖（新功能里最容易出错的一块） | 新增 10 条纯函数用例：单列 / 时间+数值 / 数值+时间 / 分号+逗号小数 / 点数下限 / 截断 / 脏行 / 季节估计 ×2 / 空文件 |
| 14 | **P2 测试** | `tests/qa/achievements.test.js` | 8 个成就的判定零覆盖，且「半分神话」的语义刚改过 | 新增 8 条纯逻辑用例：首 AC / 整题满分 / 单窗口满分不算 / 三连胜 ×2 / 入门毕业 / 词典编纂者 / 幂等 |
| 15 | **P1 稳定性** | `tests/qa/helpers/cdp.js` | 8 个测试文件并发各 spawn 一个 Chromium，把 `Runtime.evaluate` 拖过 20s → 成片「CDP 请求超时」，且一条失败污染页面状态后级联出 3–6 条假失败 | `launch()` 内置全局文件锁（PID + 10 分钟陈旧检测），浏览器测试串行化：排队而不是 skip；`close()` 释放 |
| 16 | P2 测试 | `tests/qa/v3-browser.test.js` | 分享卡 `buildShareCard` 零覆盖 | 新增 1 条浏览器用例：完整 HTML / 字段齐全 / 数据集名转义（`<img onerror>` 载荷） |
| 17 | P2 文档 | `docs/v3-architecture.md` | 仍是 v3.0，缺 v3.7 三个新模块 | 追加第 12 节：模块依赖 / 新增存储键 / pinball 边界 / 分享卡安全 / 浏览器测试并发契约 |
| 18 | P3 内容 | `assets/js/problems.js` | P16 题面写「约 50 分」，模板实测 55 分 | 改为「55 分，通过线 60」（提示与 guide 两处） |
| 19 | **P2 视觉** | `assets/css/style.css`、`assets/js/app/studio.js` | 工坊编辑器工具栏在约 500px 的左栏里放不下：`tb-hint` 不换行也不截断，文字直接压到「载入示例模型」按钮上（截图确认） | `.editor-toolbar` 允许换行；`.tb-left` 可收缩；`.tb-hint` 省略号截断；工坊 hint 缩为「Ctrl/⌘+Enter 运行」 |

### 3.2 未修复（已确认，建议排期）

| # | 级别 | 问题 | 建议 |
|---|---|---|---|
| 1 | P3 内容 | P16 的 `passRate: 18` 无实测依据 | 与其他题同口径，属既有约定；若要严谨，用全站通过率回填 |
| 2 | P3 权衡 | 浏览器锁会让「并发跑全量」的总时长接近串行（浏览器部分排队） | 这是用时间换确定性，可接受；若要提速，应按文件分组共享一个浏览器实例，而不是去掉锁 |

> 本轮已无未决的 P0 / P1 项。判题语义、产品约束、既有 16 题锚点均未改动。

---

## 四、接手基线（可复现）

```bash
cd D:\deliverables\ts-dojo

node tests/selftest.js              # 16 题参考解全 passed；打印每题参考解/朴素解分数
node tests/starter-check.js         # 16 题模板原样提交全 WA（55/57/58/42/29/0/0/0/79/57/0/36/0/5/57/55）
node tests/storage-audit.js         # localStorage 输出安全审计
node tests/standalone-check.js      # 单文件版与源码一致 / 无外部引用 / 未截断
node --test tests/qa/*.test.js   # 217 条，0 skip（并发跑也安全：浏览器锁会把实例串行化）
```

**注意**：`node --test tests/qa`（目录参数）在 Node 22 下会报 `MODULE_NOT_FOUND`，必须用 glob；并发跑浏览器用例有 flake 风险，建议 `--test-concurrency=1`。

### 关键锚点（改动判题语义会全部漂移）

| 题 | 参考解 | 模板 | 通过线 |
|---|---|---|---|
| p1 naive | 73 | 57 | 60 |
| p8 robust-shift | 70 | 0 | 60 |
| p9 rolling | 100（窗口 44/100/89/82） | 79 | 60 |
| p16 quantile-band | 100 | 55 | 60 |

`judge.js` 的 `metrics` / `baselines` / `scoreForRatio` / `buildTestPoints` / `scoreCase` / `buildReport`、9 套数据集的 seed、16 题的 threshold 组合，**不要动**。

### 视觉验收

`node tools/visual-tour.js <输出目录>` 覆盖 13 条路由（深色）+ 实验室 / 题目 / 工坊运行态 + 浅色代表页 + 375 窄屏 5 页。本轮逐张检查，发现并修复 1 处工具栏重叠（#19）；成就墙、CSV 上传行、分享卡按钮在深色 / 浅色 / 窄屏下均正常，无横向溢出。

---

## 五、代码质量评估

**做得好的地方**

1. **判题语义与内容层彻底分离**：`judge.js` 只做指标/基线/评分/沙箱；题面、课程、方法卡是纯数据。改内容不会碰判题。
2. **沙箱是三层防护而不是一句口号**：CSP `connect-src 'none'` + Worker 能力遮蔽/原型链冻结 + 1500ms/8000ms 超时；无 Worker 时**拒绝提交**而不是降级卡死。
3. **测试护栏有牙齿**：`static.test.js` 检查脚本顺序、依赖方向、CSS 覆盖率、存储键前缀；`solutions.test.js` 断言「模板必须 WA 且语法合法」；`adversarial.test.js` 固化竞态与逃逸。
4. **产品约束被当契约**：零依赖、file:// 可用、单文件可嵌 iframe；`standalone-check.js` 防「发布旧产物」。
5. **失败可见**：启动自检面板、存储配额提示、判题会话 token 隔离。

**需要盯的地方**

1. **模块数已到 47**，经典 script 顺序加载的认知负担接近上限；再加 3–5 个模块前，建议先做一次「app 层目录分组 + 加载清单生成」（不要引入打包器，保持零构建）。
2. **浏览器用例与 Node 用例混在一个 `--test` 里**：已用文件锁消除并发假失败（217 条默认并发全绿），但两者仍共享一条命令；若要更快的反馈循环，建议拆 `tests/qa/node/` 与 `tests/qa/browser/` 两套命令。
3. **文档是手写数字**，每次加题/加模块都会漂移（本次就是）。建议把「16 题 / 47 脚本 / 208 条」做成 `docs/numbers.json` 或由测试生成，README 引用占位符。

---

## 六、下一步建议（按价值排序）

1. **观察两轮并发全量**：锁的逻辑已用「默认并发」实测（217 条），但冷启动/低配机器上的表现仍值得再看一轮；如果稳定，`--test-concurrency=1` 就可以从推荐命令里去掉。
2. **提交本轮修复**：浏览器锁、分享卡用例、架构文档、P16 文案与第一轮修复分开提交，保持可回滚。
3. **P17 方向**：现有 16 题已覆盖 naive → 平滑 → 季节 → 回归 → 深度学习 → 基础模型 → 分位数。下一个空白是**层级/聚合一致性**（bottom-up vs top-down）或**协变量/促销**；两者都能复用现有判题引擎，不需要改语义。
4. **发布**：单文件版已同步，可直接静态托管；若要分享，用 `ts-dojo-standalone.html` 单文件即可，不需要服务器。
5. **长期**：把「16 题 / 47 脚本 / 217 条」这类数字做成由测试生成的文件，README 引用占位符——本次文档漂移的根因是手写数字。

---

## 七、本轮改动清单

```
修改：
  assets/js/app/glossary.js        # 接线 onGlossaryLook
  assets/js/app/achievements.js    # 半分神话判定 + 三连胜文案
  assets/js/app.js                 # 成就调用加空值保护
  assets/js/app/studio-csv.js      # 列序嗅探 / 分隔符 / 季节估计 / esc / 死代码
  assets/js/app/studio.js          # 删死变量 + 工坊 hint 文案
  assets/css/style.css             # 工具栏允许换行 / hint 省略号截断
  tools/visual-tour.js             # 巡检补 studio 路由与窄屏 studio
  assets/js/problems.js            # P16 题面 50 → 55 分
  tests/qa/metrics.test.js         # pinball 期望值 0.25 → 0.5
  tests/qa/helpers/cdp.js          # 浏览器测试全局文件锁
  tests/qa/v3-browser.test.js      # 分享卡用例（含转义）
  README.md                        # 数量口径 / 目录树 / 加载顺序 / 自测表
  docs/v3.2-changelog.md           # 追加 v3.7
  docs/v3-architecture.md          # 追加第 12 节 v3.7 增量
  ts-dojo-standalone.html          # 重建（795KB）
新增：
  tests/qa/studio-csv.test.js      # 10 条 CSV 解析用例
  tests/qa/achievements.test.js    # 8 条成就判定用例
  docs/handover-audit-2026-10-26.md # 本报告
```

> 本报告基于 2026-10-26 的实际运行结果，不是对代码的静态猜测。所有「已修复」项都有对应的测试或校验命令可复现。
