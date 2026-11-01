# -*- coding: utf-8 -*-
"""studio.js v3.11 补丁：协变量支持 + 对比视图 + 模板外移。"""
import io

# ============ 1) index.html：studio-templates 接线（studio-csv 之后） ============
p = 'index.html'
lines = io.open(p, encoding='utf-8').read().split('\n')
has_tpl = any('studio-templates' in ln for ln in lines)
if not has_tpl:
    for i, ln in enumerate(lines):
        if 'assets/js/app/studio-csv.js?' in ln:
            m = None
            import re
            mm = re.search(r'\?v=([a-f0-9]+)', ln)
            tag = '<script src="assets/js/app/studio-templates.js?v=%s"></script>' % (mm.group(1) if mm else '3.5.0')
            lines.insert(i + 1, tag)
            break
    io.open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('index ok')

# ============ 2) static.test 注册 ============
p = 'tests/qa/static.test.js'
s = io.open(p, encoding='utf-8').read()
if "'studio-csv', 'studio'," in s:
    s = s.replace("'studio-csv', 'studio',", "'studio-csv', 'studio-templates', 'studio',")
if "'assets/js/app/studio-csv.js',\n    'assets/js/app/studio.js'," in s:
    s = s.replace("'assets/js/app/studio-csv.js',\n    'assets/js/app/studio.js',",
                  "'assets/js/app/studio-csv.js',\n    'assets/js/app/studio-templates.js',\n    'assets/js/app/studio.js',")
if "'TSJ.appStudioCsv', 'TSJ.appStudio'," in s:
    s = s.replace("'TSJ.appStudioCsv', 'TSJ.appStudio',", "'TSJ.appStudioCsv', 'TSJ.appStudioTemplates', 'TSJ.appStudio',")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('static registered')

# ============ 3) studio.js：STARTER 外移 + 协变量 + 对比视图 ============
p = 'assets/js/app/studio.js'
s = io.open(p, encoding='utf-8').read()

# 3a) 删除本地 STARTER（整块），引用 templates 模块
start = s.index('  var STARTER = [')
end = s.index("'].join('\\n');", start) + len("'].join('\\n');")
s = s[:start] + '  var TPL = TSJ.appStudioTemplates;' + s[end:]

# 3b) render 里 ctx 增加协变量状态
old = """      token: 0,
      busy: false,
      activeSession: null
    };"""
new = """      token: 0,
      busy: false,
      activeSession: null,
      cov: { promo: false, parts: false }
    };"""
assert s.count(old) == 1, 'ctx cov'
s = s.replace(old, new, 1)

# 3c) 工具栏：一个模板按钮变两个（基础 / 协变量，后者按数据集能力启停）
old = """'    <div class="tb-right"><button type="button" class="btn btn-ghost" id="studioTemplate">载入示例模型</button>' +"""
new = """'    <div class="tb-right"><button type="button" class="btn btn-ghost" id="studioTemplate">载入基础示例</button>' +
'    <button type="button" class="btn btn-ghost" id="studioTemplateCov" title="用 ctx.promoDays 做促销感知预测">载入协变量示例</button>' +"""
assert s.count(old) == 1, 'toolbar buttons'
s = s.replace(old, new, 1)

# 3d) 配置卡：协变量开关区（数据集下拉之后）
old = """      '    <div class="studio-csv-row">',"""
new = """      '    <div class="studio-cov" id="studioCov"></div>',
      '    <div class="studio-csv-row">',"""
assert s.count(old) == 1, 'cov box'
s = s.replace(old, new, 1)

# 3e) 绑定：cov 渲染 + 两个模板按钮 + checkbox
old = """    $('studioDataset').addEventListener('change', paintSplits);
    $('studioTemplate').addEventListener('click', function () {
      store.state.editor.setValue(STARTER);
      ctx.code = STARTER;
      core.writeJSON(core.STORE.studioDraft, STARTER);
      TSJ.appA11y.toast('已载入示例模型（SES + 网格搜索 α）', 'ok');
    });"""
new = """    function paintCov() {
      var d = findDataset($('studioDataset').value) || {};
      var box = $('studioCov');
      if (!box) return;
      var checks = [];
      if (d.promoDays) checks.push('<label class="ds-badge"><input type="checkbox" id="studioCovPromo"' +
        (ctx.cov.promo ? ' checked' : '') + '> 注入促销日历（ctx.promoDays，' + d.promoDays.length + ' 天）</label>');
      if (d.parts) checks.push('<label class="ds-badge"><input type="checkbox" id="studioCovParts"' +
        (ctx.cov.parts ? ' checked' : '') + '> 注入渠道历史（ctx.parts）</label>');
      box.innerHTML = checks.length
        ? '<span class="ds-card-sub">协变量（只读注入，测试段同样可得）：</span>' + checks.join(' ')
        : '<span class="ds-card-sub">该数据集无协变量注入。</span>';
      var a = $('studioCovPromo'), b = $('studioCovParts'), tplCov = $('studioTemplateCov');
      if (a) a.addEventListener('change', function () { ctx.cov.promo = this.checked; });
      if (b) b.addEventListener('change', function () { ctx.cov.parts = this.checked; });
      if (tplCov) tplCov.disabled = !d.promoDays;
    }
    function paintSplitsAndCov() { paintSplits(); paintCov(); }

    $('studioDataset').addEventListener('change', paintSplitsAndCov);
    paintSplitsAndCov();
    $('studioTemplate').addEventListener('click', function () {
      store.state.editor.setValue(TPL.STARTER);
      ctx.code = TPL.STARTER;
      core.writeJSON(core.STORE.studioDraft, TPL.STARTER);
      TSJ.appA11y.toast('已载入基础示例（SES + 网格搜索 α）', 'ok');
    });
    $('studioTemplateCov').addEventListener('click', function () {
      store.state.editor.setValue(TPL.COV);
      ctx.code = TPL.COV;
      core.writeJSON(core.STORE.studioDraft, TPL.COV);
      TSJ.appA11y.toast('已载入协变量示例（促销提升系数 × 季节朴素）', 'ok');
    });"""
assert s.count(old) == 1, 'bind cov'
s = s.replace(old, new, 1)

# 3f) runPhase：把 ctxExtra 注入合成 problem
old = """      synthAndRun(values, horizon, code, session).then(function (res) {"""
new = """      var covExtra = null;
      if (ctx.cov.promo && d.promoDays) {
        covExtra = function (point, dataset) { return { promoDays: dataset.promoDays || [] }; };
      } else if (ctx.cov.parts && d.parts) {
        covExtra = function (point, dataset) {
          var end = point.history.length;
          return { parts: (dataset.parts || []).map(function (p) {
            return { name: p.name, period: p.period, values: p.values.slice(0, end) };
          }) };
        };
      }
      synthAndRun(values, horizon, code, session, covExtra).then(function (res) {"""
assert s.count(old) == 1, 'runPhase cov'
s = s.replace(old, new, 1)

# 3g) synthAndRun 接收并挂 ctxExtra
old = """  /** 用合成 problem/dataset 走 judge.evaluate：沙箱、超时、基线全家桶免费获得。 */
  function synthAndRun(values, horizon, code, session) {"""
new = """  /** 用合成 problem/dataset 走 judge.evaluate：沙箱、超时、基线全家桶免费获得。
   *  covExtra：可选的 ctxExtra 函数（协变量注入，与 P17/P18 同一 judge 机制）。 */
  function synthAndRun(values, horizon, code, session, covExtra) {"""
assert s.count(old) == 1, 'synth sig'
s = s.replace(old, new, 1)

old = """      points: 100, passScore: 60, dataset: 'studio', mode: 'holdout',
      horizon: horizon, metric: METRIC, baselines: BASELINES, threshold: 0.95
    };"""
new = """      points: 100, passScore: 60, dataset: 'studio', mode: 'holdout',
      horizon: horizon, metric: METRIC, baselines: BASELINES, threshold: 0.95
    };
    if (covExtra) problem.ctxExtra = covExtra;"""
assert s.count(old) == 1, 'synth ctxExtra'
s = s.replace(old, new, 1)

# 3h) 记录里带 cov 标记（复现语境）
old = """          datasetId: d.id, season: d.season, split: [sp.trainLen, sp.valLen, sp.testLen],"""
new = """          datasetId: d.id, season: d.season, split: [sp.trainLen, sp.valLen, sp.testLen],
          covariates: (ctx.cov.promo && d.promoDays ? 'promo' : '') + (ctx.cov.parts && d.parts ? 'parts' : '') || null,"""
assert s.count(old) == 1, 'record cov'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('studio.js cov done')
