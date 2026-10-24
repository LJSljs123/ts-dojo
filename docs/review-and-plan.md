# TSOJ 代码审查 + 升级方案 + 施工图

> 审查结论摘要
> 1. 发现 **2 个 P0**：判题竞态会把 A 题的结果画到 B 题并**解锁 B 题题解**（已在无头 Edge 实测复现）；Worker 沙箱可用 **3 行代码完整逃逸**（`delete g.importScripts` 后即可真实发网络请求）。
> 2. **6 个 P1**：375px 顶栏被裁 64px、题库表被裁 170px 且 `overflow:hidden` 无法滚动、滚动窗口被静默丢弃、降级路径死循环锁 UI、提交记录无快照/无逐测试点、`setBusy` 跨页作用。
> 3. 用户怀疑的「`computeRefScores` 同步跑 9 题」**不是缺陷**：已有缓存，实测全量 **4ms**。
> 4. 建议先修 P0（约 1 天），再拆 `app.js`，功能增强全部排在拆分之后，避免在 1480 行单体上返工。
> 5. 判题语义（指标/基线/评分/切分/9 题阈值）**一行都不要动**，这是 122 条用例的命根子。

---

## 一、真实缺陷清单（逐条可复现）

| # | 文件:行 | 触发条件 | 实际表现 | 期望表现 | 级别 |
|---|---|---|---|---|---|
| 1 | `app.js:938-954` + `app.js:1034-1038` + `app.js:560-594` | p1 点「提交判题」后 <300ms 内切到 p6 | 实测：p6 结果面板显示「**通过 AC · 73 分**」（p1 的成绩），`#btnSolution.disabled=false` → **未通过却解锁 p6 题解**，p1 的预测曲线画在 p6 图上，RE 行号标到 p6 编辑器 | 旧判题的 then 回调必须校验「会话 token + problemId」，不匹配则整段丢弃 | **P0** |
| 2 | `judge.js:595-612`（`__DENY` 用 `configurable:true`）+ `judge.js:642`（非严格 `new Function`） | 提交 `var g=new Function("return this")(); delete g.importScripts;` | 实测：`own-fetch=blocked` 但 `delete` 后 `typeof g.importScripts==="function"`、`Object.getPrototypeOf(g).fetch` 也是 function；真调用返回 `Failed to execute 'importScripts' on 'WorkerGlobalScope': ... failed to load` → **真逃逸，可发任意网络请求** | 网络类能力无论怎么取都不可用；至少在 CSP 层封死 `connect-src`/`script-src` 外链 | **P0** |
| 3 | `app.js:573`（route 重置 `running`）+ `app.js:928`（守卫） | 判题中切路由再判另一题 | 守卫失效 → 两个 Worker 并发；旧 Promise 的 `setBusy(false)` 提前解禁新页按钮，可重复提交 | 用 token 而非布尔量做互斥；旧会话不得触碰新页 DOM | P1 |
| 4 | `style.css:71-82` + `style.css:229-233` | 视口 375px | 实测：`.topbar` scrollWidth **439** / client 375，`#scoreChip` 右边缘 439 → 分数胶囊与导航末项被裁掉且不可滚动；`.ptable` scrollWidth **499** vs `.table-wrap` 329，`overflow-x:hidden` → **标签列、通过率列永久不可达** | 顶栏可折行/可横滑；表格容器 `overflow-x:auto` | P1 |
| 5 | `judge.js:304-314`（`if (trainEnd < 4) continue`） | `len < horizon + windows*originStep`（改题/加题即触发） | 实测：10 点 / horizon4 / windows5 / step4 → 只剩 **1** 个测试点且 `index=4`；题面仍写「4 个窗口」，UI 显示「测试点 1（origin #5）」 | 窗口不足时显式报错或回退并在 UI 提示，不静默缩水 | P1 |
| 6 | `judge.js:755-760` + `app.js:1065-1068` | 环境无 Worker（策略限制/旧内核） | 静默同线程执行，死循环锁死 UI；界面只提示「超时保护失效」仍允许提交（`adversarial.test.js:124` 已把「会挂死」固化为用例） | 降级时**禁止提交**（仅允许运行且二次确认），并在 UI 明示 | P1 |
| 7 | `app.js:1019-1027` | 任意提交后 | 实测 `tsoj:submissions[0]` 仅 7 个字段，无代码快照、无 `cases`；`judge.js:866-878` 的逐测试点数据落盘即丢 | 落盘 `id/code/cases`，列表可点开复盘 | P1 |
| 8 | `app.js:1009-1029` | 两个标签页各提交一次 | 整对象写回 → 后写者用陈旧内存覆盖前者记录；全仓 **0 处** `storage` 事件监听 | 写入前 merge，监听 `storage` 同步 | P2 |
| 9 | `app.js:113-119` | 配额超限/隐私模式 | `catch {}` 静默，界面无「保存失败」提示，用户以为已存 | 失败时提示 + 降级为内存态 | P2 |
| 10 | `app.js:1456-1465` | 点「开始做题」 | 实测 activeElement 从 `onbStart` → **BODY**（先 `display:none` 再 `focus()`）；无 ESC、无焦点陷阱、`#overlay` 无 `inert` | 关闭后焦点回 `#view`；ESC 关闭；焦点锁在弹层内 | P2 |
| 11 | `editor.js:167-170 / 173-184 / 194-202` | 粘贴 2000 行后按键 | 每次按键全量重建 `innerHTML`（≈512KB）+ 重建 2000 个行号 div + `markCurrentLine` 遍历 2000 节点；实测 `highlightCode` 单次 12–33ms（Node），浏览器叠加解析后 30–80ms | >500 行降级：只高亮可视区或关闭高亮 | P2 |
| 12 | `editor.js:120-121` vs `style.css:468,490` | 改字号（T10 要做） | `LINE_HEIGHT=20 / PAD_TOP=10` 与 CSS 双写，`markError` 滚动定位会错位 | 运行时读 `getComputedStyle` | P2 |
| 13 | `judge.js:200-210` | `history.length===1` 且用 `moving_average` | 实测 `moving_average([5],3,{season:1})` → `[NaN,NaN,NaN]`（`k=max(2,min(want,n))=2 > n`，取到 `history[-1]`）；当前 9 题未用该基线 → 死代码地雷 | `k=Math.max(1,...)` 或 `n<2` 时退化 naive | P2 |
| 14 | `app.js:515-526` | 有/无本地提交 | 同一「通过率」列：无提交时是题目 `passRate`（全站口径），有提交后变成「你的通过率」，无标注 | 拆成两列或加 tooltip 说明 | P2 |
| 15 | `tests/qa/helpers/cdp.js:40` + `browser.test.js:87` | 页面脚本未执行完即求值 | 我实测撞到 `TSJ.findProblem is not a function`；现在靠首个用例 `sleep(400)` 掩盖，新增脚本文件后必现 flake | `launch()` 内置 `waitReady()` 轮询 | P2 |

**否掉的怀疑**：`computeRefScores`（`app.js:1269-1284`）已有 `state.refScores` 缓存，实测 9 题参考解全量 **4ms**，不构成阻塞；`findProblem`（`problems.js:1319`）线性扫描 9 项，可忽略；`chart.js:257` 的 resize 监听是**全局唯一一个**，路由切换不会叠加。

---

## 二、升级方案（有边界）

| 项 | 级别 | 解决什么 | 怎么做 | 涉及文件 | 验收标准 |
|---|---|---|---|---|---|
| A1 判题会话隔离 | P0 | 缺陷 1/3 | `state.judgeToken++`；`runJudge` 闭包捕获 token；then/catch 首行 `if (token!==state.judgeToken \|\| state.activeProblem!==p) return;`；`persistResult` 内 `$('#btnSolution')` 改为 `$('#btnSolution', $('#view'))` 并校验 `problemId`；`route()` 不再重置 `running`，改为作废 token | `app.js` | 提交 p1 后立即切 p6：p6 空态、题解按钮仍 disabled、p1 进度正确 |
| A2 沙箱加固 | P0 | 缺陷 2/6 | ① `index.html` 加 CSP meta：`default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; worker-src blob:`（`connect-src 'none'` 在网络层封死，即使 JS 逃逸也发不出去）；② Worker 内 `__block` 改 `configurable:false` + `Object.freeze` 全局与原型链 + 遮蔽 `Function`/`eval`/`Function.prototype.constructor`；③ 降级时 `evaluate` 返回 `refused:true`，UI 禁用提交 | `judge.js`、`index.html`、`README.md` | 逃逸载荷 → RE「沙箱限制」；控制台出现 CSP 拦截、无真实请求；文档口径改为「隔离执行环境，非安全边界」 |
| A3 `app.js` 拆分 | P1 | 单体 1480 行 | 经典 script，顺序 `core → store → ui → views → app.js`，`app.js` 仍是最后一个且末尾 `init()`：`core.js`（STORE/readJSON/writeJSON/normalize/esc/fmt/debounce/md）、`store.js`（state + 派生 + 导入导出）、`ui.js`（renderResult/paintPrediction）、`views.js`（5 个 render）、`app.js`（route/runJudge/init） | 新增 4 文件 + `index.html` + `static.test.js` | 每文件 ≤350 行；无循环依赖；全量测试绿；file:// 无异常 |
| A4 进度导出/导入 + 清空 | P1 | 换路径/换机丢记录 | 导出 `{schema:1, app:'tsoj', exportedAt, data:{progress,drafts,submissions}, hash}`（FNV-1a 校验）；`Blob`+`a.download`；导入 `input[type=file]`+`FileReader`，校验 schema ≤ 当前、字段白名单、合并策略（best=max / attempts=sum / submissions 按 id 去重、at 倒序截 120）；清空只删 `tsoj:*` 前缀键 | `store.js`、`views.js`、`style.css` | 导出→清空→导入后状态逐字段一致；篡改 hash 被拒；旧 schema 不崩 |
| A5 提交详情 | P1 | 缺陷 7 | submissions 增 `id/code(≤20KB)/cases(5 字段)/degraded`；新路由 `#/submission/<id>`；列表行 `tabindex=0`+Enter | `store.js`、`views.js`、`app.js`、`style.css` | 点历史记录可看快照与逐测试点；刷新后仍在；不存在 id 有空态 |
| A6 窄屏适配 | P1 | 缺陷 4 | `.table-wrap{overflow-x:auto}`；断点 640：topbar 折两行、nav 横滑、`score-chip` 缩为 `Lv.3`、`.page{padding:20px 12px}`、`.pane-right{height:auto;min-height:60vh}`、toolbar 折行 | `style.css` | 375px 下 `scrollWidth===375`、chip 右边缘 ≤375、通过率列可横滑看到 |
| A7 图表交互 | P1 | 看不出偏在哪段 | `paint` 把 `xOf/yOf/n/testStart` 挂到 `canvas.__tsjGeom`；新增 `TSJ.attachChartHover(canvas)`：pointermove → 最近 index → 十字线 + tooltip（真值/预测/差值）+ 测试区间描边加重；`destroy` 时解绑 | `chart.js`、`ui.js`、`style.css` | hover 出 tooltip；移出隐藏；切路由后监听计数归零 |
| A8 题库搜索/标签/随机 | P2 | 9 题靠肉眼找 | `state.query/state.tag`；搜索匹配 id/title/tags；标签云由 problems 汇总去重；「随机一题」优先未通过集合 | `views.js`、`app.js`、`style.css` | 搜 "holt" → 1 行；标签「滚动回测」→ 1 行；默认态仍 9 行 |
| A9 编辑器增强 | P2 | 缺陷 11/12 | `LINE_HEIGHT` 改读 computed style；`--ed-font` 12/13/14 循环；括号匹配（光标处找未配对开括号 → 该 span 与行号加 `.ed-match`）；>800 行关实时高亮只留行号；Ctrl+S → `onSave` flush 草稿 + 轻提示 | `editor.js`、`style.css`、`app.js` | 字号切换后 `markError` 仍准；`{`/`}` 同亮；2000 行单键 <50ms；Ctrl+S 不弹浏览器保存框 |
| A10 可访问性 | P2 | 缺陷 10 | 弹层焦点陷阱 + ESC + 关闭后 focus `#view`；结果面板 `aria-live="polite"`；editor `aria-describedby` 指向错误行说明；路由切换后 `#view` `tabindex=-1` 并 focus | `app.js`、`views.js`、`index.html`、`style.css` | Tab 只在弹层循环；ESC 可关；activeElement 落在 `#view`；结果被播报 |
| A11 是否加题 | — | **不加** | 现有 9 题已覆盖 naive→MA→seasonal→SES→Holt→HW→direct→robust→rolling 完整梯度；加第 10 题会同时打破 `browser.test.js:72`（`.prow=9`）、`solutions.test.js:97`（9 题全 WA）与 `starter-check.js` 的口径，且必须重新标定 threshold。若要加，走独立里程碑（建议 `gmv` + 乘法季节，`season=7`，阈值实测标定） | — | 本次不含 |

---

## 三、任务分解（12 个，按依赖排序）

| ID | 标题 | 依赖 | 涉及文件 | 改动要点 | 验收 |
|---|---|---|---|---|---|
| **T01** | 测试护栏 + 入口清单 | — | 新增 `tests/qa/regressions.test.js`；`tests/qa/helpers/cdp.js`；`tests/qa/static.test.js` | 把缺陷 1/2/4/5 固化成**先红后绿**的用例；`cdp.launch()` 内置 `waitReady()` 轮询 `TSJ.findProblem`；static 增加「脚本清单一致性」辅助函数 | 4 条新用例修复前红、修复后绿；其余 122 条全绿 0 skip |
| **T02** | 判题会话隔离（P0） | T01 | `app.js:560-594, 927-968, 1009-1039` | A1：token + problemId 双校验；`setBusy` 仅 token 有效时执行；题解按钮查询限定 `#view` 内 | 复现脚本：提交 p1 立刻切 p6 → p6 空态、按钮 disabled、p1 进度正确 |
| **T03** | 沙箱加固（P0） | T01 | `judge.js:568-671, 749-771`；`index.html`；`README.md` | A2：CSP + `configurable:false` + freeze + 遮蔽 `Function/eval`；降级拒绝提交 | 逃逸载荷 RE「沙箱限制」；CSP 拦截日志；`adversarial.test.js:236` 期望值同步改 |
| **T04** | `app.js` 拆分为 5 文件 | T02 | `app.js` → `app/core.js`、`app/store.js`、`app/ui.js`、`app/views.js` + 保留 `app.js`；`index.html`；`static.test.js` | A3：顺序 core→store→ui→views→app.js；`app.js` 末尾仍 `init()` | 每文件 ≤350 行；全量测试绿；file:// 无异常 |
| **T05** | 存储层升级（导出/导入/清空/详情字段） | T04 | `app/store.js`、`app/views.js`、`style.css` | A4 + A5 的数据部分：`tsoj:schema`、`submissions` 扩字段、导入合并、`tsoj:*` 清理 | 导出→清空→导入逐字段一致；hash 篡改被拒；旧 schema 不崩 |
| **T06** | 提交详情视图 | T05 | `app/views.js`、`app.js`、`style.css` | A5 的 UI 部分：`#/submission/<id>` 路由、只读 `highlightCode`、`cases` 表 | 点历史记录看快照；刷新仍在；不存在 id 有空态 |
| **T07** | 窄屏适配 | T04 | `style.css:71-82, 229-233, 878-889` | A6 | 375px `scrollWidth===375`；chip 不越界；通过率列可横滑 |
| **T08** | 图表交互 | T04 | `chart.js`、`app/ui.js`、`style.css` | A7 | tooltip 正常；切路由后监听归零 |
| **T09** | 题库搜索/标签/随机 | T04 | `app/views.js`、`app.js`、`style.css` | A8 | 搜索/标签/随机生效；默认态仍 9 行 |
| **T10** | 编辑器增强 | T04 | `editor.js`、`style.css`、`app.js` | A9（含缺陷 12 的常量改造） | 字号切换后 `markError` 仍准；2000 行单键 <50ms |
| **T11** | 可访问性 | T04 | `app.js`、`app/views.js`、`index.html`、`style.css` | A10 | ESC/焦点陷阱/焦点恢复/aria-live 全部可验 |
| **T12** | 全量回归 + 文档 | T01-T11 | `README.md`、`tests/**`、`docs/**` | 跑 `node --test tests/qa`、`tests/selftest.js`、`starter-check.js`、`storage-audit.js`；375/768/1280 三档手测；file:// 与 http 双场景 | 全绿 0 skip；无 console 异常 |

**并行建议**：`T02 ∥ T03 ∥ T08`（文件互不相交，可并行）；`T07 → T09 → T10 → T11` 都改 `style.css`，**必须串行或分批合并**，否则冲突；`T05 → T06` 强串行。

### 会触碰现有 122 条用例期望值的改动（工程师必须同步改测试）

| 改动 | 失效用例 | 必须做的事 |
|---|---|---|
| T03 封 `eval` | `adversarial.test.js:236`「eval 不能绕过超时」期望 `TLE` | 期望值改为 `RE` + `/沙箱限制/`；另加真浏览器逃逸回归（`fakeworker` 的 canary 是普通属性，删掉即无痕，**无法**在 Node 里复现原型链逃逸） |
| T04 拆文件 | `static.test.js:62`（脚本顺序硬编码 6 项）、`:78`（`!/TSJ\.app|TSJ\.renderProblem/`）、`:83`（`app.js` 末尾 `init();`） | 更新顺序数组为 10 项、改写反向依赖正则、保留 `app.js` 末尾 `init()` |
| 任何新增 class（T06-T11） | `static.test.js:89` CSS 覆盖率（缺失即 fail） | 每个新 class 必须在 `style.css` 有定义 |
| T05 新增存储键 | `static.test.js:122`（`tsoj:` 前缀 + 禁止硬编码键）、`:130` | 新键进 `STORE` 常量，禁止 `localStorage.setItem('...')` 字面量 |
| T05 改归一化 | `browser.test.js:198-246`（`stored.drafts==='{}'`、`best` 必须为 number）、`:277-310`（`stored.length===1`） | 保持 `tsoj:submissions` 仍是数组、字段名不变 |
| T02/T06 改结果面板 | `browser.test.js:139-161`（`.err-box`、`#resultPanel img`） | 保留 `.verdict`/`.err-box`/`.vm-*` 类名 |
| T09 搜索/筛选 | `browser.test.js:72`（`.prow` 必须 9） | 默认态不得预置搜索词/标签 |
| 任何 `judge.js` 的指标/基线/评分/切分改动 | `metrics/baselines/scoring/split/solutions` 5 个文件全挂 | **禁止**，见第四节 |
| 加第 10 题 | `browser.test.js:72`、`solutions.test.js:97`、`starter-check.js` | 本次不做 |

---

## 四、风险与回滚

**风险排序**
1. **最高：`judge.js` 的评分语义**（`metrics` 的 mape/smape 口径、`baselines` 公式、`scoreForRatio` 分段与 `[0.51,2]` 夹取、`buildTestPoints` 切分）。T03 只允许改 `WORKER_SOURCE` 与 `runSandbox` 的降级分支，**不得触碰** `scoreCase/buildReport/buildJobs`。一旦改了，`metrics/baselines/scoring/split/solutions` 5 个文件 60+ 用例全红，且 p1=57、p8=55 这类「教学锚点」会漂移。
2. **次高：`app.js` 拆分**。`static.test.js` 有三条结构性断言（脚本顺序、反向依赖、`init()` 位置），且拆分后加载顺序错了就是**白屏**（无模块系统、无报错兜底）。
3. **再次：DOM 结构**。`browser.test.js` 依赖 `.prow/.verdict/.err-box/.meta-row/.ed-input/#btnSubmit`，改类名即断。
4. **低但阴：`style.css` 并发编辑**。T07-T11 五个人同时改一个 889 行文件必然冲突，必须串行。

**实施顺序与每步验证**
`T01`（护栏先绿）→ `T02 ∥ T03`（P0 止血，跑 `node --test tests/qa` + 手动复现脚本）→ `T04`（拆分，跑全量 + file:// 双击 5 路由）→ `T05→T06`（存储/详情，跑 `storage-audit.js` + 导出导入往返）→ `T07→T09→T10→T11`（逐个改 CSS，每步 375/768/1280 三档截图）→ `T08`（独立，随时可插）→ `T12`（全量 + 手测）。每步都跑四条命令：`node --test tests/qa`、`node tests/selftest.js`、`node tests/starter-check.js`、`node tests/storage-audit.js`。

**回滚**：每个任务一个 commit，T04 拆分单独一个 commit（可整体 revert 回单体）；`tsoj:schema` 只在 T05 引入，导入失败一律「不动现有数据」，绝不做破坏性迁移。

**明确不要动**
- `judge.js` 的 `metrics` / `baselines` / `scoreForRatio` / `buildTestPoints` / `scoreCase` / `buildReport` 任何一行。
- 9 题的 `threshold` / `passScore` / `passRate` / `baseline` 组合；**尤其 p8**（`mae` + `threshold:0.90` + `passScore:60`，naive 恰好 55 分是设计出来的教学锚点）。
- `datasets.js` 的 8 个 seed 与生成器（改了全部得分重标）。
- 每题 `starter`（`solutions.test.js:97` 断言 9 题 starter 原样提交必须全 WA 且语法合法）。
- 「ratio≤0.5→100、=阈值→passScore、≥2→0」这条评分叙事，以及所有题面里写死的实测分数（p9 的 `44/100/89/82`）。
- 单文件零依赖零构建、经典 script 加载、file:// 双击可用这三条产品约束（不要引入打包器/ESM/远程字体）。
