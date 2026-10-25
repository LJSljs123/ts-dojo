/**
 * assets/js/lab/config.js —— 实验室配置 schema 与白名单
 *
 * 原则：用户不能提交代码或表达式；只能改白名单方法、有限参数、切分与指标。
 * 任何越界值都不会被“猜着修正”，要么给出明确错误，要么回退默认并提示。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  var METHODS = {
    naive: { label: '朴素法', params: {}, minHistory: 2 },
    'seasonal-naive': { label: '季节朴素', params: {}, minHistory: 3 },
    mean: { label: '历史均值', params: {}, minHistory: 1 },
    'moving-average': { label: '移动平均', params: {}, minHistory: 2 },
    ses: { label: '简单指数平滑', params: { alpha: { min: 0.02, max: 0.6, step: 0.01, def: 0.28 } }, minHistory: 2 },
    holt: {
      label: 'Holt 线性趋势',
      params: {
        alpha: { min: 0.02, max: 0.8, step: 0.01, def: 0.42 },
        beta: { min: 0.01, max: 0.5, step: 0.01, def: 0.1 }
      },
      minHistory: 3
    },
    'holt-winters': {
      label: 'Holt-Winters',
      params: {
        alpha: { min: 0.02, max: 0.8, step: 0.01, def: 0.32 },
        beta: { min: 0.01, max: 0.5, step: 0.01, def: 0.06 },
        gamma: { min: 0.02, max: 0.6, step: 0.01, def: 0.28 }
      },
      minHistory: 8
    },
    ar: { label: 'AR(p) Yule-Walker', params: { order: { min: 1, max: 10, step: 1, def: 4 } }, minHistory: 8 },
    theta: { label: 'Theta 方法', params: { alpha: { min: 0.05, max: 0.5, step: 0.01, def: 0.2 } }, minHistory: 6 },
    dlinear: { label: 'DLinear', params: {}, minHistory: 8 },
    tsb: {
      label: 'TSB 间歇需求',
      params: {
        alpha: { min: 0.02, max: 0.4, step: 0.01, def: 0.05 },
        beta: { min: 0.02, max: 0.4, step: 0.01, def: 0.1 }
      },
      minHistory: 6
    },
    combination: { label: '组合预测（中位数）', params: {}, minHistory: 8 }
  };

  var METRICS = {
    mse: { label: 'MSE', better: 'lower' },
    mae: { label: 'MAE', better: 'lower' },
    smape: { label: 'sMAPE', better: 'lower' }
  };

  var BASELINES = ['naive', 'seasonal_naive', 'mean', 'moving_average', 'linear_trend'];

  function defaults() {
    return {
      schema: 1,
      datasetId: 'airline',
      method: 'holt-winters',
      params: { alpha: 0.32, beta: 0.06, gamma: 0.28 },
      split: { mode: 'holdout', horizon: 12, windows: 1, originStep: 12 },
      metrics: ['mse', 'mae', 'smape'],
      baseline: 'seasonal_naive',
      interval: { enabled: true, levels: [80, 95] }
    };
  }

  function datasetIds() {
    return (TSJ.datasets || []).map(function (d) { return d.id; });
  }

  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

  function normalize(raw) {
    var errors = [];
    var base = defaults();
    var cfg = {
      schema: 1,
      datasetId: typeof raw.datasetId === 'string' ? raw.datasetId : base.datasetId,
      method: typeof raw.method === 'string' ? raw.method : base.method,
      params: {},
      split: {
        mode: raw.split && raw.split.mode === 'rolling' ? 'rolling' : 'holdout',
        horizon: raw.split && isFiniteNumber(raw.split.horizon) ? Math.floor(raw.split.horizon) : base.split.horizon,
        windows: raw.split && isFiniteNumber(raw.split.windows) ? Math.floor(raw.split.windows) : base.split.windows,
        originStep: raw.split && isFiniteNumber(raw.split.originStep) ? Math.floor(raw.split.originStep) : base.split.originStep
      },
      metrics: Array.isArray(raw.metrics) ? raw.metrics.slice() : base.metrics.slice(),
      baseline: typeof raw.baseline === 'string' ? raw.baseline : base.baseline,
      interval: {
        enabled: !!(raw.interval && raw.interval.enabled),
        levels: Array.isArray(raw.interval && raw.interval.levels) && raw.interval.levels.length
          ? raw.interval.levels.slice() : base.interval.levels.slice()
      }
    };

    if (!METHODS[cfg.method]) {
      errors.push('方法不在白名单：' + cfg.method);
      cfg.method = base.method;
    }
    if (datasetIds().indexOf(cfg.datasetId) < 0) {
      errors.push('数据集不存在：' + cfg.datasetId);
      cfg.datasetId = base.datasetId;
    }

    var meta = METHODS[cfg.method] || METHODS[base.method];
    // 关键：默认参数必须跟随目标方法，而不是永远取 base.method（否则会把
    // Holt-Winters 的 beta/gamma 泄漏进 SES/AR 等方法的配置里）
    Object.keys(meta.params).forEach(function (k) { cfg.params[k] = meta.params[k].def; });
    if (raw.params && typeof raw.params === 'object') {
      Object.keys(meta.params).forEach(function (key) {
        var rule = meta.params[key];
        var v = raw.params[key];
        if (v == null) return;
        if (!isFiniteNumber(v)) { errors.push('参数 ' + key + ' 必须是数字'); return; }
        if (v < rule.min || v > rule.max) {
          errors.push('参数 ' + key + ' 超出范围 [' + rule.min + ', ' + rule.max + ']');
          return;
        }
        cfg.params[key] = rule.step >= 1 ? Math.round(v) : Math.round(v * 100) / 100;
      });
    }

    if (cfg.split.horizon < 1 || cfg.split.horizon > 48) {
      errors.push('horizon 必须在 1–48 之间');
      cfg.split.horizon = base.split.horizon;
    }
    if (cfg.split.mode === 'rolling') {
      if (cfg.split.windows < 1 || cfg.split.windows > 12) {
        errors.push('rolling 窗口数必须在 1–12 之间');
        cfg.split.windows = base.split.windows;
      }
      if (cfg.split.originStep < 1 || cfg.split.originStep > 48) {
        errors.push('originStep 必须在 1–48 之间');
        cfg.split.originStep = base.split.originStep;
      }
    } else {
      cfg.split.windows = 1;
      cfg.split.originStep = cfg.split.horizon;
    }

    cfg.metrics = cfg.metrics.filter(function (m) { return METRICS[m]; });
    if (!cfg.metrics.length) {
      errors.push('至少选择一个指标');
      cfg.metrics = base.metrics.slice();
    }
    if (BASELINES.indexOf(cfg.baseline) < 0) {
      errors.push('基线不在白名单：' + cfg.baseline);
      cfg.baseline = base.baseline;
    }
    cfg.interval.levels = cfg.interval.levels.filter(function (l) { return l === 80 || l === 95; });
    if (!cfg.interval.levels.length) cfg.interval.levels = [80, 95];

    // 数据集长度校验：horizon/rolling 窗口/方法最小历史都必须同时装得下
    var ds = null;
    for (var i = 0; i < (TSJ.datasets || []).length; i++) {
      if (TSJ.datasets[i].id === cfg.datasetId) ds = TSJ.datasets[i];
    }
    if (ds) {
      var need = cfg.split.horizon +
        (cfg.split.mode === 'rolling' ? (cfg.split.windows - 1) * cfg.split.originStep : 0) +
        Math.max(4, meta.minHistory || 4);
      if (ds.values.length < need) {
        errors.push('数据集太短：' + ds.id + ' 只有 ' + ds.values.length +
          ' 点，当前配置至少需要 ' + need + ' 点');
        cfg.split.horizon = Math.max(1, Math.min(cfg.split.horizon, Math.max(1, ds.values.length - 8)));
        cfg.split.windows = 1;
        cfg.split.originStep = cfg.split.horizon;
      }
    }

    return { ok: errors.length === 0, errors: errors, config: cfg };
  }

  function stableStringify(obj) {
    return JSON.stringify(obj, function (key, value) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value).sort().reduce(function (acc, k) {
          acc[k] = value[k];
          return acc;
        }, {});
      }
      return value;
    });
  }

  TSJ.labConfig = {
    METHODS: METHODS,
    METRICS: METRICS,
    BASELINES: BASELINES,
    defaults: defaults,
    normalize: normalize,
    stableStringify: stableStringify
  };
})(typeof window !== 'undefined' ? window : this);
