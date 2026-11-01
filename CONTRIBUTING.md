# 贡献指南

感谢关注时序竞技场 TSOJ。这份指南讲清楚三件事：**项目铁律**、**开发循环**、**最常见的两类贡献（改代码 / 加题目）**。

## 项目铁律（不可协商）

1. **零依赖、零构建**：不引 npm 包、不引 CDN、不引外部字体图片；经典 `<script>` 顺序加载，全站挂 `window.TSJ` 命名空间。
2. **file:// 双击可用**：任何改动都要保证单文件版（`ts-dojo-standalone.html`）与模块化版在 file:// 下完整可用。
3. **判题语义锁死**：`judge.js` 的 `metrics` / `baselines` / `scoreForRatio` / `buildTestPoints` 一行不改——60+ 条用例与全部题目锚点钉在上面。新能力走**纯增量**（新指标 / 新字段 / 新函数，参考 P16 加 pinball、P17 加 ctxExtra 的先例）。
4. **app 层文件 ≤350 行**：超了就拆模块（`storage-extras.js` / `lab-live.js` 都是这么拆出来的）。

## 开发循环

```bash
# 改源码后依次执行（顺序固定）：
node tools/build-standalone.js    # 重建单文件版（产物过期会被 standalone-check 抓住）
node tools/stamp-assets.js        # 重算 index.html 的 ?v= 内容哈希
node tools/numbers.js             # README 数量口径核对（报告行号，照改即可）
node --test tests/qa/*.test.js    # 全量 QA（当前 265 条，0 skip 是常态）
node tests/selftest.js            # 判题引擎自测（18 题参考解全 AC + 模板全 WA）
node tests/starter-check.js       # 模板有效性（每题 starter 必须 WA 而非 RE/TLE）
node tests/storage-audit.js       # localStorage 输出安全审计
node tests/standalone-check.js    # 单文件版一致性
```

四件套（selftest / starter-check / storage-audit / standalone-check）必须全部 IS_PASS: YES。

## 加一道题（最常见贡献）

完整标定流程（README 第十节有字段说明，这里是操作顺序）：

1. **选题与数据**：优先复用 10 套现有数据集；确需新数据集，写在 `assets/js/datasets.js`（固定种子、确定性、只用传入的 rng）。
2. **写参考解**：`assets/js/problems.js` 里以真实函数书写（`toPredictSource()` 转字符串），跑 `judge.evaluateSync` 标定分数——**参考解必须通过（AC）且分数有教学余量**。
3. **写 starter（有洞的骨架）**：语法正确、能跑完、**必须 WA**（`starter-check.js` 会锁死）；洞要对应本题的教学点。
4. **验证三基线不通过**：题目配置的每一条基线单独提交都不得 AC。
5. **配置题目对象**：id / index / threshold / passScore / statement / hints / guide（可选，零基础带做）。
6. **同步口径**：`tools/numbers.js` 会报告 README 需要更新的行号；目录树注释同步。
7. **补测试**：`solutions.test.js`（参考解 AC + 朴素解 WA + 可复现）、`metrics.test.js`（若新增指标，手算期望值）。
8. **方法卡联动**：若方法库有对应卡，更新其 `practice` 字段（`library.test.js` 校验引用真实存在）。

**先例参考**：P16（pinball 分位数备货）的完整过程留在 CHANGELOG——包括为什么用 electricity 数据集、τ 如何标定、阈值为什么定 0.9。加题前读一遍可以少走弯路。

## 改代码

- 经典 script、IIFE、`var` 为主（与现库一致）；所有进 `innerHTML` 的动态文本一律过 `esc()`。
- 事件 / 定时器 / 图表监听登记到路由 Scope（`lifecycle.js`），路由切换统一销毁。
- 存储一律走 `core.STORE` 常量 + `readJSON/writeJSON`（file:// 下 localStorage 视为不可信输入）。
- 新用户数据键必须进 `storage.js` 的 `EXTRAS`（全量备份范围）并补往返测试（`backup.test.js`）。
- 新增 class 必须在样式表有定义（`static.test.js` 的 CSS 覆盖率会抓）。
- 不引入 ESM、不引入打包器、不加外部请求（CSP `connect-src 'none'` 是产品承诺）。

## 提交

- 一个主题一个 commit，标题格式：`feat(scope): ...` / `fix(scope): ...` / `test: ...` / `docs: ...`。
- 提交前跑完上面开发循环的全部命令；测试不绿不提交。
