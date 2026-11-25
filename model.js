// Short-horizon price forecast for a sparse market (A), borrowing signal from a dense comparison market (R).
// A and R are Map<weekIndex, price>. Forecasts are for week t+h, made at the end of week t.
const { weekStart, median, WEEK } = require('./series');

const ln = Math.log;
const MAX_AGE = 4;   // a price older than this many weeks is not treated as "current"
const MIN_TEST = 30; // fewer test points than this and no error rate is reported
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const weekOfYear = w => { const d = weekStart(w); return Math.min(51, Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / WEEK)); };
const lastObs = (S, t, maxAge) => { for (let k = t; k >= t - maxAge; k--) if (S.has(k)) return k; return null; };
const maxKey = S => S.size ? Math.max(...S.keys()) : -Infinity;

// Solves (X'X + lambda I) b = X'y by Gaussian elimination.
function ridge(X, y, lambda) {
  const p = X[0].length, M = Array.from({ length: p }, () => Array(p + 1).fill(0));
  for (let r = 0; r < X.length; r++) for (let i = 0; i < p; i++) {
    M[i][p] += X[r][i] * y[r];
    for (let j = 0; j < p; j++) M[i][j] += X[r][i] * X[r][j];
  }
  for (let i = 0; i < p; i++) M[i][i] += lambda;
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[p] / row[i]);
}

const adviceFor = changePct => changePct >= 5 ? 'HOLD' : changePct <= -5 ? 'SELL' : 'NO CLEAR SIGNAL';

// Mean log deviation from the 53-week centred median, by week of year, using weeks before `upto` only.
function seasonIndex(S, upto) {
  const sum = Array(52).fill(0), n = Array(52).fill(0);
  for (const [w, p] of S) {
    if (w >= upto) continue;
    const near = [];
    for (let k = w - 26; k <= w + 26; k++) if (k < upto && S.has(k)) near.push(S.get(k));
    if (near.length < 20) continue;
    const i = weekOfYear(w); sum[i] += ln(p / median(near)); n[i]++;
  }
  return sum.map((s, i) => n[i] ? s / n[i] : 0);
}

// Features for origin week t and horizon h. Returns null when A has no price within MAX_AGE weeks.
function features(A, R, ctx, t, h) {
  const t0 = lastObs(A, t, MAX_AGE);
  if (t0 == null) return null;
  const a0 = ln(A.get(t0));
  const rAt = k => { const j = lastObs(R, k, 2); return j == null ? null : ln(R.get(j)); }; // R can skip a week too
  const rt = rAt(t), r0 = rAt(t0), r4 = rAt(t - 4), prev = lastObs(A, t0 - 1, 7);
  // A's usual gap to R is taken from its last 26 reports within two years, not from all history:
  // sparse markets change (new yard, new mix of varieties), and a gap learned years ago misleads.
  const gaps = [];
  for (let k = t0 - 1; k >= t0 - 104 && gaps.length < 26; k--) { if (!A.has(k)) continue; const rk = rAt(k); if (rk != null) gaps.push(ln(A.get(k)) - rk); }
  const usualGap = gaps.length >= 4 ? median(gaps) : null;
  return {
    t0, base: A.get(t0),
    x: [
      rt != null && r0 != null ? rt - r0 : 0,            // comparison-market move since A last reported
      r0 != null && usualGap != null ? a0 - r0 - usualGap : 0, // A's distance from its usual gap to R
      rt != null && r4 != null ? rt - r4 : 0,            // comparison-market momentum
      ctx.season[weekOfYear(t + h)] - ctx.season[weekOfYear(t0)], // expected seasonal move
      prev != null ? a0 - ln(A.get(prev)) : 0,            // A's own momentum
    ],
  };
}

// Fits one horizon on every origin whose target week falls before `upto`.
function fit(A, R, h, upto) {
  const dense = [...R.keys()].filter(w => w < upto).length >= 104;
  const ctx = { season: seasonIndex(dense ? R : A, upto) };
  const X = [], y = [];
  const first = Math.min(...A.keys());
  for (let t = first; t + h < upto; t++) {
    if (!A.has(t + h)) continue;
    const f = features(A, R, ctx, t, h);
    if (f) { X.push(f.x); y.push(ln(A.get(t + h)) - ln(f.base)); }
  }
  const p = 5, m = { ctx, n: X.length, ybar: 0, mu: Array(p).fill(0), sd: Array(p).fill(1), b: Array(p).fill(0), q10: 0, q90: 0 };
  if (X.length < 10) return m; // too little history: the model falls back to the last known price
  m.ybar = mean(y);
  for (let j = 0; j < p; j++) { const col = X.map(r => r[j]); m.mu[j] = mean(col); m.sd[j] = Math.sqrt(mean(col.map(v => (v - m.mu[j]) ** 2))) || 1; }
  const Z = X.map(r => r.map((v, j) => (v - m.mu[j]) / m.sd[j])), yc = y.map(v => v - m.ybar);
  // How strongly to shrink towards "no change" is chosen on the newest fifth of the training weeks,
  // which the fit below never sees. The test period is not touched.
  m.lambda = 10;
  const cut = Math.floor(X.length * 0.8);
  if (cut >= 40 && X.length - cut >= 10) {
    let best = Infinity;
    for (const lam of [1, 10, 100, 1000, 10000]) {
      const b = ridge(Z.slice(0, cut), yc.slice(0, cut), lam);
      const err = mean(Z.slice(cut).map((z, i) => Math.abs(yc[cut + i] - z.reduce((s, v, j) => s + b[j] * v, 0))));
      if (err < best) { best = err; m.lambda = lam; }
    }
  }
  m.b = ridge(Z, yc, m.lambda);
  // The range comes from the most recent errors, so it widens when the market turns more volatile.
  const resid = y.map((v, i) => v - predictLog(m, X[i])).slice(-150);
  m.q10 = quantile(resid, 0.1); m.q90 = quantile(resid, 0.9);
  return m;
}
const predictLog = (m, x) => m.ybar + x.reduce((s, v, j) => s + m.b[j] * (v - m.mu[j]) / m.sd[j], 0);

function backtest(A, R, { horizons = [1, 2, 4], testWeeks = 156, refitEvery = 26 } = {}) {
  const last = maxKey(A), testStart = last - testWeeks + 1, out = {};
  for (const h of horizons) {
    const pts = [];
    let m = null, fittedAt = -Infinity;
    for (let t = testStart; t + h <= last; t++) {
      if (t - fittedAt >= refitEvery) { m = fit(A, R, h, t); fittedAt = t; }
      if (!A.has(t + h)) continue;
      const f = features(A, R, m.ctx, t, h);
      if (!f) continue;
      const pl = predictLog(m, f.x), seasonal = A.get(t + h - 52);
      pts.push({
        week: t + h, actual: A.get(t + h), base: f.base,
        naive: f.base, seasonal: seasonal ?? f.base, refAdjusted: f.base * Math.exp(f.x[0]),
        model: f.base * Math.exp(pl), lo: f.base * Math.exp(pl + m.q10), hi: f.base * Math.exp(pl + m.q90),
      });
    }
    const n = pts.length, ok = n >= MIN_TEST, keys = ['naive', 'seasonal', 'refAdjusted', 'model'];
    const score = fn => ok ? Object.fromEntries(keys.map(k => [k, mean(pts.map(p => fn(p[k], p.actual)))])) : null;
    const moved = pts.filter(p => Math.abs(p.actual / p.base - 1) >= 0.05);
    out[h] = {
      n,
      mape: score((pred, act) => 100 * Math.abs(pred - act) / act),
      mae: score((pred, act) => Math.abs(pred - act)),
      direction: ok && moved.length ? { n: moved.length, model: mean(moved.map(p => +(Math.sign(p.model - p.base) === Math.sign(p.actual - p.base)))) } : null,
      coverage80: ok ? mean(pts.map(p => +(p.actual >= p.lo && p.actual <= p.hi))) : null,
      points: pts,
    };
  }
  return out;
}

function forecastLatest(A, R, h) {
  const t = Math.max(maxKey(A), maxKey(R));
  const m = fit(A, R, h, t + 1);
  const f = features(A, R, m.ctx, t, h);
  if (!f) return { noRecentPrice: true };
  const pl = predictLog(m, f.x), point = f.base * Math.exp(pl), changePct = 100 * (point / f.base - 1);
  return { week: t + h, originWeek: t, base: f.base, ageWeeks: t - f.t0, point, lo: f.base * Math.exp(pl + m.q10), hi: f.base * Math.exp(pl + m.q90), changePct, advice: adviceFor(changePct), trainedOn: m.n };
}

// For each calendar month: the month's median price as a share of that year's median, summarised across years.
function seasonCalendar(S) {
  const byYear = new Map();
  for (const [w, p] of S) {
    const d = new Date(+weekStart(w) + 3 * 864e5); // the week's Thursday decides its month
    const y = d.getUTCFullYear();
    if (!byYear.has(y)) byYear.set(y, Array.from({ length: 12 }, () => []));
    byYear.get(y)[d.getUTCMonth()].push(p);
  }
  const ratios = Array.from({ length: 12 }, () => []);
  for (const months of byYear.values()) {
    const all = months.flat();
    if (all.length < 26) continue; // a year with under half its weeks reported would skew the picture
    const yearMedian = median(all);
    months.forEach((ps, i) => { if (ps.length) ratios[i].push(median(ps) / yearMedian); });
  }
  return ratios.map((r, i) => r.length
    ? { month: i + 1, index: median(r), lo: quantile(r, 0.25), hi: quantile(r, 0.75), years: r.length }
    : { month: i + 1, index: null, lo: null, hi: null, years: 0 });
}

module.exports = { ridge, adviceFor, backtest, forecastLatest, seasonCalendar, weekOfYear };
