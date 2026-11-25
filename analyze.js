// Runs the whole analysis on the downloaded rows and writes out/results.json.
// Every number in the Proof of Work PDF and the proposal text comes from that file. Run: node analyze.js
const fs = require('fs');
const path = require('path');
const { loadJsonl, parseRow, weekStart, weeklySeries } = require('./series');
const { backtest, forecastLatest, seasonCalendar } = require('./model');

const LEAD = 'Kamrup';
const V1 = require('path').join(__dirname, 'out', 'results-v1.json'); // results of the first model version, kept on record
const SETUP = { horizons: [1, 2, 4], testWeeks: 156, refitEvery: 26 };
const D = f => path.join(__dirname, 'data', f);
const load = files => loadJsonl(files.map(D)).map(parseRow).filter(Boolean);
const iso = w => weekStart(w).toISOString().slice(0, 10);
const day = d => d.toISOString().slice(0, 10);
const round = (v, d = 1) => v == null ? null : +v.toFixed(d);
// The same record carries slightly different market names in the two sources ("Siliguri" and "Siliguri APMC").
const key = r => [day(r.date), String(r.market).replace(/\s*APMC$/i, '').trim().toLowerCase(), String(r.variety).trim().toLowerCase(), r.price].join('|');
const uniq = rows => [...new Map(rows.map(r => [key(r), r])).values()];

// History from the public bulk copy, the newest months straight from data.gov.in.
const mirror = { assam: load(['hf-assam-potato.jsonl']), ref: load(['hf-wb-siliguri-potato.jsonl']) };
const recent = { assam: load(['assam-potato-2026.jsonl', 'assam-kamrup-potato-2026.jsonl']), ref: load(['wb-siliguri-potato-2026.jsonl']) };
// Older rows fetched directly from data.gov.in for the same markets, kept only to check the bulk copy against.
const official = load(['assam-kamrup-potato.jsonl', 'assam-kamrup-potato-p2.jsonl', 'wb-siliguri-potato.jsonl', 'wb-siliguri-potato-p2.jsonl']);
const assamRows = uniq([...mirror.assam, ...recent.assam]), refRows = uniq([...mirror.ref, ...recent.ref]);

const mirrorLast = new Date(Math.max(...[...mirror.assam, ...mirror.ref].map(r => +r.date)));
const mirrorKeys = new Set([...mirror.assam, ...mirror.ref].map(key));
const comparable = uniq(official).filter(r => r.date <= mirrorLast);
const matched = comparable.filter(r => mirrorKeys.has(key(r))).length;
// How much of the newest official data was downloaded (the public key is rate-limited).
const totals = JSON.parse(fs.readFileSync(D('official-totals.json'), 'utf8'));
const lineCount = f => fs.existsSync(D(f)) ? fs.readFileSync(D(f), 'utf8').split('\n').filter(Boolean).length : 0;
const completeness = Object.fromEntries(['kamrup', 'siliguri', 'assamAll'].map(k => [k, { got: Math.min(lineCount(totals[k].file), totals[k].total), total: totals[k].total }]));

function describe(label, rows) {
  const series = weeklySeries(rows), byMarket = new Map(), perYear = new Map();
  for (const r of rows) {
    const m = byMarket.get(r.market) || { market: r.market, rows: 0, first: r.date, last: r.date };
    m.rows++; if (r.date < m.first) m.first = r.date; if (r.date > m.last) m.last = r.date;
    byMarket.set(r.market, m);
  }
  const weeks = [...series.keys()], first = Math.min(...weeks), last = Math.max(...weeks);
  for (const w of weeks) { const y = +iso(w).slice(0, 4); perYear.set(y, (perYear.get(y) || 0) + 1); }
  return {
    series,
    info: {
      label, usableRows: rows.length, droppedAsOutliers: series.dropped, firstWeek: iso(first), lastWeek: iso(last),
      weeksWithData: weeks.length, weeksInSpan: last - first + 1, coveragePct: round(100 * weeks.length / (last - first + 1)),
      markets: [...byMarket.values()].sort((a, b) => b.rows - a.rows).map(m => ({ market: m.market, rows: m.rows, first: day(m.first), last: day(m.last) })),
      weeksPerYear: [...perYear].sort((a, b) => a[0] - b[0]).map(([year, weeks]) => ({ year, weeks })),
    },
  };
}

function summarise(bt) {
  const out = {};
  for (const h of SETUP.horizons) {
    const b = bt[h], r2 = o => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v, 2)]));
    out[h] = {
      n: b.n, mape: r2(b.mape), mae: r2(b.mae),
      improvementOverNaivePct: b.mape ? round(100 * (1 - b.mape.model / b.mape.naive)) : null,
      direction: b.direction && { n: b.direction.n, modelPct: round(100 * b.direction.model) },
      coverage80Pct: b.coverage80 == null ? null : round(100 * b.coverage80),
    };
  }
  return out;
}

// Correlation of week-on-week log changes, with the comparison market shifted by `lag` weeks (positive = it moves first).
function lagCorrelation(A, R, lag) {
  const xs = [], ys = [];
  for (const [w, a] of A) {
    if (!A.has(w - 1) || !R.has(w - lag) || !R.has(w - lag - 1)) continue;
    xs.push(Math.log(a / A.get(w - 1))); ys.push(Math.log(R.get(w - lag) / R.get(w - lag - 1)));
  }
  const n = xs.length; if (n < 30) return { lag, n, r: null };
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return { lag, n, r: round(sxy / Math.sqrt(sxx * syy), 3) };
}

const fmtForecast = f => f.noRecentPrice ? f : {
  forWeek: iso(f.week), madeInWeek: iso(f.originWeek), lastKnownPrice: round(f.base, 0), lastKnownAgeWeeks: f.ageWeeks,
  forecast: round(f.point, 0), low: round(f.lo, 0), high: round(f.hi, 0), changePct: round(f.changePct), advice: f.advice, trainedOn: f.trainedOn,
};
const forecasts = (A, R) => Object.fromEntries(SETUP.horizons.map(h => ['h' + h, fmtForecast(forecastLatest(A, R, h))]));

// ---- comparison market and every Assam district
const ref = describe('Siliguri market, West Bengal', refRows), R = ref.series;
// The two sources spell districts in different cases (BONGAIGAON, Bongaigaon), so names are normalised before grouping.
const titleCase = s => String(s).trim().toLowerCase().split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const groupByDistrict = rows => { const m = new Map(); for (const r of rows) { const d = titleCase(r.district); if (!m.has(d)) m.set(d, []); m.get(d).push(r); } return m; };
const byDistrict = groupByDistrict(assamRows);

let lead = null, leadBt = null;
const districts = [], pooledSum = {};
const weekly = {}; // weekly price series per district, written to out/weekly.json for the web app
for (const [district, rows] of [...byDistrict].sort((a, b) => b[1].length - a[1].length)) {
  const d = describe(`${district} district, Assam`, rows);
  if (d.series.size < 60) { districts.push({ district, rows: rows.length, weeksWithData: d.info.weeksWithData, coveragePct: d.info.coveragePct, h1: null, h4: null }); continue; }
  weekly[district] = [...d.series];
  const bt = backtest(d.series, R, SETUP), s = summarise(bt);
  const cell = h => s[h].mape ? { n: s[h].n, naive: s[h].mape.naive, model: s[h].mape.model, gainPct: s[h].improvementOverNaivePct } : null;
  districts.push({ district, rows: rows.length, weeksWithData: d.info.weeksWithData, coveragePct: d.info.coveragePct, lastWeek: d.info.lastWeek, h1: cell(1), h2: cell(2), h4: cell(4) });
  for (const h of SETUP.horizons) if (s[h].mape) { const p = pooledSum[h] || (pooledSum[h] = { n: 0, naive: 0, model: 0, districts: 0 }); p.n += s[h].n; p.naive += s[h].n * s[h].mape.naive; p.model += s[h].n * s[h].mape.model; p.districts++; }
  if (district === LEAD) { lead = d; leadBt = bt; }
}
if (!lead) throw new Error(`no usable data for the lead district ${LEAD}`);
lead.info.label = 'Kamrup district, Assam (Guwahati area)';
const A = lead.series;

const pooled = {};
for (const h of SETUP.horizons) { const p = pooledSum[h]; pooled['h' + h] = p ? { districts: p.districts, n: p.n, naive: round(p.naive / p.n, 2), model: round(p.model / p.n, 2), gainPct: round(100 * (1 - p.model / p.naive)) } : null; }

const latest = forecasts(A, R);
// If the lead market has gone quiet, also show the newest week in which a forecast was still possible.
const lastA = Math.max(...A.keys());
const lastForecastable = latest.h4.noRecentPrice ? forecasts(A, new Map([...R].filter(([w]) => w <= lastA))) : null;

const lags = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(l => lagCorrelation(A, R, l));
const cal = S => seasonCalendar(S).map(m => ({ ...m, index: round(m.index, 3), lo: round(m.lo, 3), hi: round(m.hi, 3) }));

const results = {
  generatedAt: new Date().toISOString(),
  checks: (fs.readFileSync(path.join(__dirname, 'test.js'), 'utf8').match(/^test\(/gm) || []).length,
  source: {
    name: 'Variety-wise Daily Market Prices Data of Commodity (Agmarknet), data.gov.in',
    resource: 'https://www.data.gov.in/resource/variety-wise-daily-market-prices-data-commodity',
    licence: 'Government Open Data License - India', commodity: 'Potato', priceUnit: 'rupees per quintal (modal price)',
  },
  data: {
    mirrorName: 'India Mandi Daily Commodity Prices 2001-2026, on Hugging Face', mirrorLastDate: day(mirrorLast),
    mirrorRows: { assam: mirror.assam.length, ref: mirror.ref.length }, officialRecentRows: { assam: recent.assam.length, ref: recent.ref.length },
    assamRowsAll: assamRows.length, assamDistricts: byDistrict.size, recentCompleteness: completeness,
    mirrorCheck: { compared: comparable.length, matched, pct: comparable.length ? round(100 * matched / comparable.length) : null },
  },
  lead: lead.info, ref: ref.info,
  correlation: { byLag: lags, best: lags.filter(l => l.r != null).sort((a, b) => b.r - a.r)[0] || null },
  backtestSetup: { testWeeks: SETUP.testWeeks, refitEveryWeeks: SETUP.refitEvery, horizonsWeeks: SETUP.horizons, minTestPoints: 30, maxPriceAgeWeeks: 4 },
  backtest: summarise(leadBt), districts, pooled, latest, lastForecastable,
  firstVersion: fs.existsSync(V1) ? (v => ({ backtest: v.backtest, pooled: v.pooled }))(JSON.parse(fs.readFileSync(V1, 'utf8'))) : null,
  calendar: { assam: cal(A), ref: cal(R) },
  series: { assam: [...A].map(([w, p]) => [iso(w), round(p, 0)]), ref: [...R].map(([w, p]) => [iso(w), round(p, 0)]) },
  testSeries: leadBt[4].points.map(p => ({ week: iso(p.week), actual: round(p.actual, 0), model: round(p.model, 0), naive: round(p.naive, 0), lo: round(p.lo, 0), hi: round(p.hi, 0) })),
};
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'results.json'), JSON.stringify(results, null, 1));
// ---- more crops for the web app: the same cleaning and weekly prices, with no comparison market.
// They are not part of results.json, so the Proof of Work and the proposal text stay about potato.
// Rice is left out on purpose: its reported Kamrup price jumps from about Rs 3,300 to Rs 7,500 within two weeks in February 2026
// and stays there, which reads as a change in what is being reported and not a market move.
const EXTRA = ['Tomato', 'Cabbage', 'Cauliflower', 'Pumpkin', 'Brinjal', 'Onion', 'Green Chilli'];
const crops = { Potato: { lead: LEAD, ref: { label: ref.info.label, series: [...R] }, districts: weekly } };
for (const crop of EXTRA) {
  const slug = crop.toLowerCase().split(' ').join('-'), got = lineCount(`assam-kamrup-${slug}-2026.jsonl`), want = (totals.crops || {})[crop];
  // The newest records arrive in no date order, so a part-finished download would leave false gaps. Such a crop is left out.
  if (!want || got < want) { console.log(`extra crop ${crop}: newest records not fully downloaded (${got} of ${want}), left out`); continue; }
  const rows = uniq(load([`hf-assam-${slug}.jsonl`, `assam-kamrup-${slug}-2026.jsonl`]));
  const cropDistricts = {};
  let dropped = 0;
  for (const [district, rs] of groupByDistrict(rows)) { const s = weeklySeries(rs); dropped += s.dropped; if (s.size >= 60) cropDistricts[district] = [...s]; }
  if (!cropDistricts[LEAD]) { console.log(`extra crop ${crop}: no usable ${LEAD} series, left out`); continue; }
  crops[crop] = { lead: LEAD, ref: null, districts: cropDistricts };
  const lastLead = cropDistricts[LEAD].reduce((m, e) => Math.max(m, e[0]), 0);
  console.log(`extra crop ${crop}: ${rows.length} records (${dropped} dropped as outliers), ${Object.keys(cropDistricts).length} districts with 60 or more weeks, ${LEAD} ${cropDistricts[LEAD].length} weeks to ${iso(lastLead)}`);
}
fs.writeFileSync(path.join(__dirname, 'out', 'weekly.json'), JSON.stringify({ generatedAt: results.generatedAt, crops }));

// ---- console summary
const dd = results.data;
console.log(`rows: Assam ${dd.assamRowsAll} in ${dd.assamDistricts} districts (mirror ${dd.mirrorRows.assam}, recent ${dd.officialRecentRows.assam}); Siliguri ${refRows.length} (mirror ${dd.mirrorRows.ref}, recent ${dd.officialRecentRows.ref}); mirror ends ${dd.mirrorLastDate}`);
console.log(`mirror check: ${matched}/${comparable.length} official rows found in the mirror (${dd.mirrorCheck.pct}%)`);
for (const i of [results.lead, results.ref]) {
  console.log(`${i.label}: ${i.usableRows} rows (${i.droppedAsOutliers} dropped), ${i.firstWeek} to ${i.lastWeek}, ${i.weeksWithData}/${i.weeksInSpan} weeks (${i.coveragePct}%)`);
  console.log('  markets: ' + i.markets.slice(0, 6).map(m => `${m.market} ${m.rows} [${m.first}..${m.last}]`).join('; '));
  console.log('  weeks per year: ' + i.weeksPerYear.map(y => `${y.year}:${y.weeks}`).join(' '));
}
console.log('lag correlation: ' + lags.map(l => `${l.lag}:${l.r}(${l.n})`).join(' '));
console.log('\nLEAD  h  n    naive  seasonal  refAdj  model  gain  direction  cover80');
for (const h of SETUP.horizons) { const b = results.backtest[h]; console.log(b.mape ? `      ${h}  ${b.n}  ${b.mape.naive}  ${b.mape.seasonal}  ${b.mape.refAdjusted}  ${b.mape.model}  ${b.improvementOverNaivePct}%  ${b.direction ? b.direction.modelPct + '% of ' + b.direction.n : '-'}  ${b.coverage80Pct}%` : `      ${h}  ${b.n}  (too few test points)`); }
console.log('\ndistrict               rows   weeks  cov%   h1 n/naive/model/gain        h4 n/naive/model/gain');
const c = x => x ? `${x.n}/${x.naive}/${x.model}/${x.gainPct}%` : '-';
for (const x of districts) console.log(`${x.district.padEnd(22)} ${String(x.rows).padEnd(6)} ${String(x.weeksWithData).padEnd(6)} ${String(x.coveragePct).padEnd(6)} ${c(x.h1).padEnd(28)} ${c(x.h4)}`);
console.log('pooled: ' + JSON.stringify(pooled));
console.log('latest: ' + JSON.stringify(latest));
if (lastForecastable) console.log('last forecastable: ' + JSON.stringify(lastForecastable));
