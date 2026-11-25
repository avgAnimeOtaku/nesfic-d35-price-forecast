// Builds out/farmer.html and out/proof-of-work.html from out/results.json. Run: node report.js
// Set TEAM_NAME to change the line under the title, e.g. TEAM_NAME="Team X, IIT Roorkee" node report.js
const fs = require('fs');
const path = require('path');
const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'results.json'), 'utf8'));
const TEAM = process.env.TEAM_NAME || 'Team from IIT Roorkee';

// Palette checked with the dataviz validator (light mode): fixed order, never cycled.
const C = { s1: '#257de0', s2: '#f47230', s3: '#00b894', s4: '#f2a600', band: '#cce3fd', text: '#191919', text2: '#666666', grid: '#e7e7e7' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rs = v => v == null ? '-' : 'Rs ' + Math.round(v).toLocaleString('en-IN');
const num = (v, d = 1) => v == null ? '-' : v.toFixed(d);
const date = s => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const t = s => +new Date(s + 'T00:00:00Z');

// ---------- chart helpers (inline SVG, static because the target is a printed PDF)
const W = 720, PAD = { l: 52, r: 96, t: 14, b: 30 };
const frame = (h, inner, label) => `<svg viewBox="0 0 ${W} ${h}" width="100%" role="img" aria-label="${esc(label)}" style="display:block">${inner}</svg>`;
const txt = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 11}" fill="${o.fill || C.text2}" text-anchor="${o.anchor || 'start'}"${o.bold ? ' font-weight="600"' : ''}>${esc(s)}</text>`;
const niceMax = v => { const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
function yAxis(h, max, ticks, fmt) {
  const y = v => PAD.t + (h - PAD.t - PAD.b) * (1 - v / max);
  const g = ticks.map(v => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>` + txt(PAD.l - 6, y(v) + 4, fmt(v), { anchor: 'end' })).join('');
  return { y, g };
}
const legend = items => `<div class="legend">${items.map(([c, l, kind]) => `<span><i style="background:${c};${kind === 'band' ? 'height:10px' : ''}"></i>${esc(l)}</span>`).join('')}</div>`;
// A line broken wherever more than `gap` ms separates two points, so missing weeks stay visible.
function linePath(pts, x, y, gap) {
  let d = '', prev = null;
  for (const [tx, v] of pts) { d += (prev == null || tx - prev > gap ? 'M' : 'L') + x(tx).toFixed(1) + ' ' + y(v).toFixed(1); prev = tx; }
  return d;
}
function yearTicks(t0, t1, x, h) {
  let out = '';
  const span = (t1 - t0) / (365.25 * 864e5), step = span > 12 ? 2 : 1;
  if (span < 2.5) { // a short span gets month labels instead of years
    const d0 = new Date(t0);
    for (let m = d0.getUTCMonth() + 1, yr = d0.getUTCFullYear(); Date.UTC(yr, m, 1) < t1; m += 2) { const tx = Date.UTC(yr, m, 1), d = new Date(tx); out += txt(x(tx), h - 10, MONTHS[d.getUTCMonth()] + " '" + String(d.getUTCFullYear()).slice(2), { anchor: 'middle' }); }
    return out;
  }
  for (let yr = new Date(t0).getUTCFullYear() + 1; Date.UTC(yr, 0, 1) < t1; yr += step) out += txt(x(Date.UTC(yr, 0, 1)), h - 10, yr, { anchor: 'middle' }) + `<line x1="${x(Date.UTC(yr, 0, 1))}" x2="${x(Date.UTC(yr, 0, 1))}" y1="${h - PAD.b}" y2="${h - PAD.b + 4}" stroke="${C.text2}"/>`;
  return out;
}

function coverageChart() {
  const h = 210, a = new Map(R.lead.weeksPerYear.map(d => [d.year, d.weeks])), b = new Map(R.ref.weeksPerYear.map(d => [d.year, d.weeks]));
  const years = []; for (let yr = Math.min(...a.keys(), ...b.keys()); yr <= Math.max(...a.keys(), ...b.keys()); yr++) years.push(yr);
  const { y, g } = yAxis(h, 53, [0, 13, 26, 39, 52], v => v);
  const slot = (W - PAD.l - PAD.r) / years.length, bw = Math.max(3, Math.min(11, slot / 2 - 2));
  const bar = (i, k, v, c) => v ? `<rect x="${(PAD.l + slot * i + slot / 2 + (k ? 1 : -bw - 1)).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw}" height="${(y(0) - y(v)).toFixed(1)}" rx="2" fill="${c}"/>` : '';
  const bars = years.map((yr, i) => bar(i, 0, a.get(yr), C.s1) + bar(i, 1, b.get(yr), C.s2) + (i % 2 === 0 || years.length < 14 ? txt(PAD.l + slot * i + slot / 2, h - 10, "'" + String(yr).slice(2), { anchor: 'middle' }) : '')).join('');
  return legend([[C.s1, R.lead.label], [C.s2, R.ref.label]]) + frame(h, g + bars + txt(W - PAD.r + 6, y(52) + 4, 'full year'), 'Weeks with at least one price report, per year');
}

function priceChart() {
  const h = 250, A = R.series.assam.map(([d, v]) => [t(d), v]), B = R.series.ref.map(([d, v]) => [t(d), v]);
  const t0 = Math.min(A[0][0], B[0][0]), t1 = Math.max(A.at(-1)[0], B.at(-1)[0]);
  const max = niceMax(Math.max(...A.map(p => p[1]), ...B.map(p => p[1])));
  const { y, g } = yAxis(h, max, [0, max / 4, max / 2, 3 * max / 4, max], v => v.toLocaleString('en-IN'));
  const x = tx => PAD.l + (W - PAD.l - PAD.r) * (tx - t0) / (t1 - t0);
  const line = (pts, c) => `<path d="${linePath(pts, x, y, 3 * 7 * 864e5)}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>`;
  const ya = y(A.at(-1)[1]), yb = y(B.at(-1)[1]), apart = Math.abs(ya - yb) < 12 ? (ya < yb ? -7 : 7) : 0; // keep the two end labels apart
  return legend([[C.s1, R.lead.label], [C.s2, R.ref.label]]) + frame(h, g + yearTicks(t0, t1, x, h) + line(B, C.s2) + line(A, C.s1)
    + txt(W - PAD.r + 6, ya + 4 + apart, 'Assam', { fill: C.text }) + txt(W - PAD.r + 6, yb + 4 - apart, 'Siliguri', { fill: C.text })
    + txt(PAD.l, 10, 'Rs per quintal'), 'Weekly potato price, Assam market against Siliguri');
}

function backtestChart() {
  const h = 250, P = R.testSeries.map(p => ({ ...p, tx: t(p.week) }));
  if (P.length < 2) return '<p class="note">Not enough test weeks to draw this chart.</p>';
  const t0 = P[0].tx, t1 = P.at(-1).tx, max = niceMax(Math.max(...P.map(p => Math.max(p.actual, p.hi))));
  const { y, g } = yAxis(h, max, [0, max / 4, max / 2, 3 * max / 4, max], v => v.toLocaleString('en-IN'));
  const x = tx => PAD.l + (W - PAD.l - PAD.r) * (tx - t0) / (t1 - t0);
  const gap = 3 * 7 * 864e5, segs = [];
  for (const p of P) { if (!segs.length || p.tx - segs.at(-1).at(-1).tx > gap) segs.push([]); segs.at(-1).push(p); }
  const band = segs.filter(s => s.length > 1).map(s => `<path d="M${s.map(p => x(p.tx).toFixed(1) + ' ' + y(p.hi).toFixed(1)).join('L')}L${[...s].reverse().map(p => x(p.tx).toFixed(1) + ' ' + y(p.lo).toFixed(1)).join('L')}Z" fill="${C.band}"/>`).join('');
  const line = (k, c, w) => `<path d="${linePath(P.map(p => [p.tx, p[k]]), x, y, gap)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"/>`;
  return legend([[C.text, 'Actual price'], [C.s1, 'Forecast made 4 weeks earlier'], [C.band, 'Range expected to hold 8 times in 10', 'band']])
    + frame(h, g + yearTicks(t0, t1, x, h) + band + line('model', C.s1, 2) + line('actual', C.text, 1.4) + txt(PAD.l, 10, 'Rs per quintal'), 'Forecast against actual price over the test period');
}

function errorChart() {
  const h = 200, hs = [1, 2, 4].filter(k => R.backtest[k].mape), keys = [['model', C.s1, 'Our model'], ['naive', C.s2, 'Last known price'], ['seasonal', C.s3, 'Same week last year'], ['refAdjusted', C.s4, 'Last price moved with Siliguri']];
  if (!hs.length) return '<p class="note">Not enough test weeks to report error rates.</p>';
  const max = niceMax(Math.max(...hs.flatMap(k => keys.map(([m]) => R.backtest[k].mape[m]))));
  const { y, g } = yAxis(h, max, [0, max / 2, max], v => v + '%');
  const slot = (W - PAD.l - PAD.r) / hs.length, bw = 26;
  const bars = hs.map((k, i) => keys.map(([m, c], j) => { const v = R.backtest[k].mape[m], bx = PAD.l + slot * i + slot / 2 - 2 * (bw + 2) + j * (bw + 2); return `<rect x="${bx}" y="${y(v).toFixed(1)}" width="${bw}" height="${(y(0) - y(v)).toFixed(1)}" rx="3" fill="${c}"/>` + txt(bx + bw / 2, y(v) - 4, num(v), { anchor: 'middle', fill: C.text, size: 10 }); }).join('')
    + txt(PAD.l + slot * i + slot / 2, h - 10, `${k} week${k > 1 ? 's' : ''} ahead`, { anchor: 'middle' })).join('');
  return legend(keys.map(([, c, l]) => [c, l])) + frame(h, g + bars, 'Average percentage error by method and horizon');
}

function calendarChart() {
  const h = 190, cal = R.calendar.assam.filter(m => m.index != null);
  if (cal.length < 12) return '<p class="note">Not enough complete years to draw a price calendar.</p>';
  const lo = Math.floor(Math.min(...cal.map(m => m.lo)) * 10) / 10, hi = Math.ceil(Math.max(...cal.map(m => m.hi)) * 10) / 10;
  const y = v => PAD.t + (h - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo)), slot = (W - PAD.l - PAD.r) / 12;
  let g = '';
  for (let v = lo; v <= hi + 1e-9; v += 0.1) g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}" stroke="${Math.abs(v - 1) < 1e-9 ? C.text2 : C.grid}"/>` + txt(PAD.l - 6, y(v) + 4, Math.round(v * 100) + '%', { anchor: 'end' });
  const marks = cal.map((m, i) => { const cx = PAD.l + slot * i + slot / 2; return `<line x1="${cx}" x2="${cx}" y1="${y(m.hi)}" y2="${y(m.lo)}" stroke="${C.s1}" stroke-width="2" stroke-linecap="round"/><circle cx="${cx}" cy="${y(m.index)}" r="5" fill="${C.s1}" stroke="#fff" stroke-width="2"/>` + txt(cx, h - 10, MONTHS[i], { anchor: 'middle' }); }).join('');
  return frame(h, g + marks + txt(W - PAD.r + 6, y(1) + 4, "year's typical price"), 'Typical price by calendar month, as a share of that year\'s median price');
}

// ---------- shared pieces
const table = (head, rows, cls = '') => `<table class="${cls}"><thead><tr>${head.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const L = R.latest.h4.noRecentPrice ? null : R.latest;      // a forecast as of the newest data
const F = L || R.lastForecastable;                           // otherwise the most recent week a forecast was possible
const cover4 = R.backtest[4].coverage80Pct;
const adviceText = { HOLD: 'Hold or store if you can', SELL: 'Sell now', 'NO CLEAR SIGNAL': 'No clear signal' };
const adviceWhy = f => f.advice === 'HOLD' ? `The price is expected to rise about ${num(Math.abs(f.changePct), 0)}% in 4 weeks. Holding makes sense only if storage and spoilage cost you less than that.`
  : f.advice === 'SELL' ? `The price is expected to fall about ${num(Math.abs(f.changePct), 0)}% in 4 weeks.`
    : `The price is expected to change by only ${num(f.changePct, 1)}% in 4 weeks, which is too small to act on. Sell when it suits you.`;

function farmerCard() {
  if (!F) return '<div class="card"><b>No recent price.</b> No price has been reported for this market in the last 4 weeks, so no forecast is shown.</div>';
  const f = F.h4, stale = !L;
  return `<div class="card">
    <div class="card-top"><span>Potato &middot; Guwahati area (Kamrup), Assam</span><span>Week of ${date(f.madeInWeek)}</span></div>
    ${stale ? `<p class="warn">No price has been reported for this market since ${date(R.lead.lastWeek)}. Under the 4-week rule the live system shows "no recent price" today. The card below is the most recent week when a forecast could be made.</p>` : ''}
    <div class="card-grid">
      <div><small>Price now</small><b>${rs(f.lastKnownPrice)}</b><small>per quintal${f.lastKnownAgeWeeks ? `, reported ${f.lastKnownAgeWeeks} week${f.lastKnownAgeWeeks > 1 ? 's' : ''} ago` : ''}</small></div>
      <div><small>In 4 weeks (week of ${date(f.forWeek)})</small><b>${rs(f.forecast)}</b><small>likely between ${rs(f.low)} and ${rs(f.high)}</small></div>
      <div class="advice"><small>What to do</small><b>${adviceText[f.advice]}</b></div>
    </div>
    <p>${adviceWhy(f)}</p>
    <p class="note">How sure is this? In our test on past prices, the actual price fell inside the stated range ${cover4 == null ? 'in an untested share of' : num(cover4, 0) + '% of'} the time. This is advice, not a guarantee.</p>
  </div>`;
}
const sms = () => F ? `Potato, Guwahati: Rs ${Math.round(F.h4.lastKnownPrice)}/qtl now. In 4 weeks about Rs ${Math.round(F.h4.forecast)} (range ${Math.round(F.h4.low)}-${Math.round(F.h4.high)}). Advice: ${adviceText[F.h4.advice]}.` : 'Potato, Guwahati: no price reported in the last 4 weeks, so no forecast today.';

function calendarSummary() {
  const cal = R.calendar.assam.filter(m => m.index != null);
  if (cal.length < 12) return '';
  const top = [...cal].sort((a, b) => b.index - a.index).slice(0, 3), low = [...cal].sort((a, b) => a.index - b.index).slice(0, 3);
  return `<p>In a typical year, potato prices in this market are highest in <b>${top.map(m => MONTHS[m.month - 1]).join(', ')}</b> (about ${num(100 * (top[0].index - 1), 0)}% above the year's typical price at the peak) and lowest in <b>${low.map(m => MONTHS[m.month - 1]).join(', ')}</b> (about ${num(100 * (1 - low[0].index), 0)}% below). Based on ${cal[0].years} to ${Math.max(...cal.map(m => m.years))} years of data per month.</p>`;
}

const CSS = `
.shot{display:block;width:100%;border:1px solid #cfcfcf;border-radius:6px}
.shots{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;break-inside:avoid}.shots figure{margin:6px 0}
table.long{break-inside:auto}table.long tr{break-inside:avoid}
*{box-sizing:border-box} body{font:13px/1.5 "Segoe UI",system-ui,Arial,sans-serif;color:${C.text};margin:0;background:#fff}
main{max-width:780px;margin:0 auto;padding:24px 16px} h1{font-size:24px;margin:0 0 4px} h2{font-size:17px;margin:26px 0 8px;padding-top:10px;border-top:2px solid ${C.text};break-after:avoid} h3{font-size:14px;margin:16px 0 6px;break-after:avoid}
p{margin:6px 0} .sub{color:${C.text2}} .note{color:${C.text2};font-size:12px} .warn{background:#fff6e0;border-left:3px solid ${C.s4};padding:6px 10px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12px;break-inside:avoid} th,td{border-bottom:1px solid ${C.grid};padding:4px 8px;text-align:left;vertical-align:top} th{color:${C.text2};font-weight:600}
td.n,th.n{text-align:right} figure{margin:10px 0;break-inside:avoid} figcaption{font-size:12px;color:${C.text2};margin-top:2px}
.legend{font-size:12px;color:${C.text};margin:4px 0}.legend span{margin-right:16px;white-space:nowrap}.legend i{display:inline-block;width:14px;height:4px;border-radius:2px;margin-right:5px;vertical-align:middle}
.card{border:1.5px solid ${C.text};border-radius:10px;padding:12px 14px;margin:10px 0;break-inside:avoid}.card-top{display:flex;justify-content:space-between;font-weight:600;margin-bottom:8px}
.card-grid{display:grid;grid-template-columns:1fr 1.3fr 1fr;gap:10px}.card-grid small{display:block;color:${C.text2};font-size:11px}.card-grid b{font-size:20px;display:block}.advice{background:#f1f6fd;border-radius:8px;padding:6px 8px}
.sms{font-family:Consolas,monospace;background:#f4f4f4;border-radius:8px;padding:8px 10px;margin:6px 0;break-inside:avoid}
.wire{display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:12px;break-inside:avoid}.wf{border:1.5px dashed ${C.text2};border-radius:10px;padding:8px;font-size:11px}.wf h4{margin:0 0 6px;font-size:12px}.wf .box{border:1px solid ${C.text2};border-radius:5px;padding:4px 6px;margin:4px 0}.wf .btn{background:${C.text};color:#fff;border-radius:5px;padding:4px 6px;margin:4px 0;text-align:center}.tag{display:inline-block;font-size:10px;border:1px solid ${C.text2};border-radius:9px;padding:0 6px;color:${C.text2}}
.flow{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;font-size:11px;break-inside:avoid}.flow div{border:1px solid ${C.text};border-radius:6px;padding:6px}.flow b{display:block;margin-bottom:3px}.flow .later{border-style:dashed;color:${C.text2}}
code{font-family:Consolas,monospace;font-size:12px;background:#f4f4f4;padding:1px 4px;border-radius:3px}
@page{size:A4;margin:14mm 12mm} @media print{main{padding:0;max-width:none}}`;

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;

// ---------- farmer page
fs.writeFileSync(path.join(__dirname, 'out', 'farmer.html'), page('Potato price advice', `
<h1>Potato price advice</h1><p class="sub">Prototype output. Built from public Agmarknet prices up to ${date(R.ref.lastWeek)}.</p>
${farmerCard()}
<h3>The same advice as a text message</h3><div class="sms">${esc(sms())}</div>
<h3>When are prices usually high and low?</h3>${calendarSummary()}<figure>${calendarChart()}</figure>`));

// ---------- proof of work
const b = R.backtest, d = R.data;
const btRows = [1, 2, 4].map(h => b[h].mape
  ? [`${h} week${h > 1 ? 's' : ''}`, b[h].n, num(b[h].mape.naive) + '%', num(b[h].mape.seasonal) + '%', num(b[h].mape.refAdjusted) + '%', `<b>${num(b[h].mape.model)}%</b>`, (b[h].improvementOverNaivePct > 0 ? '' : '') + num(b[h].improvementOverNaivePct) + '%', rs(b[h].mae.model), b[h].direction ? `${num(b[h].direction.modelPct, 0)}% of ${b[h].direction.n}` : '-', num(b[h].coverage80Pct, 0) + '%']
  : [`${h} week${h > 1 ? 's' : ''}`, b[h].n, ...Array(8).fill('too few test weeks')]);
const distRows = R.districts.map(x => [esc(x.district), x.rows.toLocaleString('en-IN'), x.weeksWithData, num(x.coveragePct, 0) + '%', ...[1, 4].flatMap(h => x['h' + h] ? [x['h' + h].n, num(x['h' + h].naive) + '%', num(x['h' + h].model) + '%', num(x['h' + h].gainPct) + '%'] : ['-', '-', '-', 'too few'])]);
const cov = [1, 2, 4].map(h => b[h].coverage80Pct).filter(v => v != null);
const rangeText = !cov.length ? '' : Math.min(...cov) >= 75 ? `The stated range held ${num(Math.min(...cov), 0)}% to ${num(Math.max(...cov), 0)}% of the time, close to the 80% intended.` : `The stated range held ${num(Math.min(...cov), 0)}% to ${num(Math.max(...cov), 0)}% of the time, below the 80% intended, so it is too narrow and needs recalibrating.`;
const verdict = h => !b[h].mape ? 'could not be measured' : b[h].improvementOverNaivePct > 0 ? `was ${num(b[h].improvementOverNaivePct)}% lower than the last-known-price baseline` : `was ${num(-b[h].improvementOverNaivePct)}% higher than the last-known-price baseline, so the model did not beat it`;

// ---------- added sections: the whole-record replay, more crops, and the live web app
const RP = R.replay, wks = h => `${h} week${h > 1 ? 's' : ''}`;
const share = (a, n) => n ? Math.round(100 * a / n) + '%' : '-';
const list = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a.join('');
const replayRows = [['lead', 'Kamrup'], ['all', `All ${RP.Potato.districts} districts`]].flatMap(([k, label]) => [1, 2, 4].map(h => {
  const x = RP.Potato[k]['h' + h];
  return [label, wks(h), x.n.toLocaleString('en-IN'), num(x.naive) + '%', `<b>${num(x.model)}%</b>`, `${x.calls.toLocaleString('en-IN')} (${share(x.calls, x.n)})`, share(x.callsRight, x.calls), share(x.moved, x.n)];
}));
const behindAt = k => [1, 2, 4].filter(h => RP.Potato[k]['h' + h].model > RP.Potato[k]['h' + h].naive).map(wks);
const replaySection = `
<h3>The same model over the whole price record</h3>
<p>The test above covers the last ${R.backtestSetup.testWeeks} weeks. As a second and harder check, the model was replayed over every week of each district's record, each time seeing only earlier weeks. The first weeks of a record are left out, because the model needs some history before it can be fitted. A "call" is a forecast move of 5% or more, which is when the model says hold or sell.</p>
${table(['Potato', 'Looking ahead', 'Forecasts', 'Last known price', 'Our model', 'Hold or sell calls', 'Direction right in those calls', 'Weeks the price really moved 5% or more'], replayRows)}
<p><b>Plain reading:</b> across all ${RP.Potato.districts} districts the model's miss is larger than the last known price at ${list(behindAt('all')) || 'no look-ahead'}. In Kamrup alone it is larger at ${list(behindAt('lead')) || 'no look-ahead'}${behindAt('lead').length < 3 ? ', and smaller at the rest' : ''}. So the wider test does not change the verdict: the prototype does not beat the simplest method. It also shows the model is not silent. At 4 weeks it makes a hold or sell call in ${share(RP.Potato.all.h4.calls, RP.Potato.all.h4.n)} of weeks and has the direction right in ${share(RP.Potato.all.h4.callsRight, RP.Potato.all.h4.calls)} of those calls.</p>`;

const cropNames = Object.keys(RP), extraCrops = cropNames.filter(c => c !== 'Potato');
const rel = (c, h) => RP[c].all['h' + h].model / RP[c].all['h' + h].naive - 1; // how far the model's miss is above (+) or below (-) the last known price
const cropRows = cropNames.map(c => { const x = RP[c], one = x.all.h1, four = x.all.h4; return [
  esc(c) + (x.comparisonMarket ? ' *' : ''), (x.records ?? R.data.assamRowsAll).toLocaleString('en-IN'), x.districts, x.leadWeeks ?? R.lead.weeksWithData,
  one.n.toLocaleString('en-IN'), num(one.naive) + '%', `<b>${num(one.model)}%</b>`, four.n.toLocaleString('en-IN'), num(four.naive) + '%', `<b>${num(four.model)}%</b>`, share(four.callsRight, four.calls)]; });
const ahead4 = cropNames.filter(c => rel(c, 4) <= -0.05), level4 = cropNames.filter(c => Math.abs(rel(c, 4)) < 0.02), behind1 = cropNames.filter(c => rel(c, 1) > 0);
const st = R.survey.staples;
const cropsSection = `
<h3>The same method on ${extraCrops.length} more crops</h3>
<p>To see whether the method carries beyond potato, the same code was run on ${list(extraCrops.map(c => c.toLowerCase()))}. Each uses its district's own price history and the season, with no comparison market. The figures are from the whole-record replay, over every district with 60 or more weeks of prices.</p>
${table(['Crop', 'Records', 'Districts', 'Kamrup weeks with a price', '1 wk: forecasts', 'Last known', 'Model', '4 wk: forecasts', 'Last known', 'Model', 'Direction right in 4 wk calls'], cropRows)}
<p class="note">* Potato is the only crop with a comparison market (Siliguri). Records are for all of Assam.</p>
<p><b>Plain reading:</b> at 1 week the model's miss is larger than the last known price for ${behind1.length} of the ${cropNames.length} crops. At 4 weeks it is clearly smaller for ${list(ahead4.map(c => c.toLowerCase())) || 'none'}${level4.length ? `, about level for ${list(level4.map(c => c.toLowerCase()))}` : ''}, and larger for the rest. The crops where it helps are the most seasonal ones. Vegetable prices move far more than potato prices, so every method misses by more.</p>
<p><b>What public data could not support.</b> For all of Assam, the newest public records (from late 2025) hold ${st.Paddy} price reports for paddy, ${st.Jute} for jute and ${st.Arecanut} for arecanut, as counted by the data.gov.in service on 25 Nov 2026. That is too few for a weekly price, so the State's staple and cash crops cannot be forecast from public data today. Mustard has ${st.Mustard} and was not attempted. Rice was left out: early in 2026 its reported Kamrup price roughly doubles within two weeks and then stays there, which reads as a change in what is being reported and not a market move.</p>
<p class="note">These ${extraCrops.length} crops were run through the same code and the same checks, but were not studied in the depth potato was. Their newest records were downloaded for Kamrup only.</p>`;

const shot = (file, alt, caption) => { const f = path.join(__dirname, 'out', file); return fs.existsSync(f) ? `<figure><img class="shot" alt="${esc(alt)}" src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><figcaption>${caption}</figcaption></figure>` : ''; };
const link = u => `<a href="${u}">${u.replace('https://', '')}</a>`;
const webappSection = `
<h3>The working web app</h3>
<p>The prototype is live at ${link(R.links.demo)}. A visitor picks a crop, a district and a look-ahead of 1, 2 or 4 weeks. The forecast is worked out in the visitor's browser by the same code that produced this document, and the build fails if the two disagree. Every past week can be replayed to see what the model said then and what the price did next. Code and data: ${link(R.links.code)}.</p>
<div class="shots">${shot('webapp-latest.png', 'The web app showing the latest potato forecast for Kamrup', 'Screenshot A. The live web app: the latest potato forecast for Kamrup, with the price now, the forecast, its range and the reading.')}
${shot('webapp-past.png', 'The web app showing a past week for another crop with what happened next', 'Screenshot B. A past week replayed for another crop: what the model said, and what the price then did.')}</div>`;

fs.writeFileSync(path.join(__dirname, 'out', 'proof-of-work.html'), page('NESFIC-D-35 Proof of Work', `
<h1>Proof of Work: price forecasting for Assam farmers</h1>
<p class="sub">NESFIC 2026 &middot; Challenge NESFIC-D-35, Agricultural Commodity Price Intelligence and Forecasting for Farmer Decisions &middot; ${esc(TEAM)} &middot; Generated ${date(R.generatedAt.slice(0, 10))}</p>

<h2>1. What this document shows</h2>
<p>A working prototype that forecasts wholesale potato prices in Assam 1, 2 and 4 weeks ahead from real public market data, tested against what actually happened, and turned into a plain hold-or-sell message for a farmer. Potato was chosen because it can be stored, so the hold-or-sell decision is real.</p>
<p><b>What is real:</b> every number, table and chart in sections 2 to 6 was produced by the code listed in section 9 from public Agmarknet price records. No figure was typed in by hand. <b>What is not real yet:</b> the three screens in section 7 are design mock-ups, and nothing here uses data from the Department, the AMIU of Assam Agricultural University or any farmer. Limits are listed in section 8.</p>
<p><b>Headline result, stated plainly:</b> ${R.pooled.h1 ? `across ${R.pooled.h1.districts} Assam districts and ${R.pooled.h1.n} test forecasts, the prototype's 1-week error is ${num(R.pooled.h1.model)}% against ${num(R.pooled.h1.naive)}% for simply repeating the last known price. It ties that baseline; it does not yet beat it.` : 'too few test weeks to score.'} The more useful findings are how incomplete the price record is (Figure 1), how weakly the Assam market tracks its nearest large market week to week (section 3), and a price calendar built on ${Math.max(...R.calendar.assam.map(m => m.years))} years of data (section 6).</p>
<p><b>Live demo and code:</b> the prototype runs as a web app at ${link(R.links.demo)}, and the code and data are at ${link(R.links.code)}. Section 5 also reports the model replayed over the whole price record, and the same method on ${extraCrops.length} more crops. Section 6 shows the web app.</p>

<h2>2. The data, and its gaps</h2>
${table(['', 'Assam market', 'Comparison market'], [
  ['Market', esc(R.lead.label), esc(R.ref.label)],
  ['Daily price records used', R.lead.usableRows.toLocaleString('en-IN'), R.ref.usableRows.toLocaleString('en-IN')],
  ['Records dropped as unit or typing errors', R.lead.droppedAsOutliers, R.ref.droppedAsOutliers],
  ['Period', `${date(R.lead.firstWeek)} to ${date(R.lead.lastWeek)}`, `${date(R.ref.firstWeek)} to ${date(R.ref.lastWeek)}`],
  ['Weeks with at least one price', `${R.lead.weeksWithData} of ${R.lead.weeksInSpan} (${num(R.lead.coveragePct, 0)}%)`, `${R.ref.weeksWithData} of ${R.ref.weeksInSpan} (${num(R.ref.coveragePct, 0)}%)`],
])}
<p>Source: ${esc(R.source.name)}, published under the ${esc(R.source.licence)}. History to ${date(d.mirrorLastDate)} was taken from a public bulk copy of that resource (${esc(d.mirrorName)}); records after that came straight from the data.gov.in service. All potato records for Assam were used: ${d.assamRowsAll.toLocaleString('en-IN')} records across ${d.assamDistricts} districts.</p>
<p><b>How complete the newest records are:</b> the public data.gov.in key is rate-limited, so for the months after the bulk copy ends we obtained ${d.recentCompleteness.kamrup.got} of ${d.recentCompleteness.kamrup.total} records for Kamrup, ${d.recentCompleteness.siliguri.got} of ${d.recentCompleteness.siliguri.total} for Siliguri, and ${d.recentCompleteness.assamAll.got} of ${d.recentCompleteness.assamAll.total} for Assam as a whole. Where a slice is incomplete, a week's price is the median of the records we have for it.</p>
<p><b>Check of the bulk copy against the official service:</b> ${d.mirrorCheck.compared ? `we downloaded ${d.mirrorCheck.compared.toLocaleString('en-IN')} records for the same markets directly from data.gov.in and looked for each one in the bulk copy by date, market, variety and price. ${d.mirrorCheck.matched.toLocaleString('en-IN')} matched (${num(d.mirrorCheck.pct)}%).` : 'not run.'}</p>
<figure>${coverageChart()}<figcaption>Figure 1. Weeks in each year with at least one reported price. A full year is 52. The Assam market reports far less regularly, which is the incomplete-history problem the Department describes.</figcaption></figure>

<h2>3. Why a comparison market helps</h2>
<p>Siliguri, in north Bengal, is a large wholesale market on the road and rail corridor into the North East. Its recent price history is denser than that of the Assam market, so we tested whether it can carry information for the weeks when Assam reports nothing.</p>
<figure>${priceChart()}<figcaption>Figure 2. Weekly median wholesale potato price. Breaks in a line are weeks with no report.</figcaption></figure>
<p>Week-on-week price changes in the two markets have a correlation of <b>${R.correlation.best ? R.correlation.best.r : 'not measurable'}</b>${R.correlation.best ? ` (${R.correlation.best.n} weeks where both reported; strongest when Siliguri is shifted by ${R.correlation.best.lag} week${Math.abs(R.correlation.best.lag) === 1 ? '' : 's'}, where a positive shift means Siliguri moves first)` : ''}. ${R.correlation.best && R.correlation.best.r < 0.4 ? 'That is a weak link. Week to week, the Assam price moves largely on its own, which is one reason the borrowed signal adds little in section 5. Testing other source markets (for example Kolkata, Burdwan and Agra) and adding arrival quantities is the first job of the funded work.' : ''}</p>
${table(['Siliguri shifted by (weeks)', ...R.correlation.byLag.map(l => l.lag)], [['Correlation', ...R.correlation.byLag.map(l => l.r ?? '-')]])}

<h2>4. Method</h2>
<p>Daily records are grouped into a weekly median price per market. A record is dropped when it is more than 4 times above or below the local price level, which catches prices typed per kilogram. For a forecast made at the end of week <i>t</i> for week <i>t + h</i>:</p>
<ul>
<li>The starting point is the last Assam price, if it is at most ${R.backtestSetup.maxPriceAgeWeeks} weeks old. If it is older, the system says "no recent price" and gives no forecast.</li>
<li>Five signals adjust it: how far Siliguri has moved since Assam last reported; how far the Assam price sits from its usual gap to Siliguri, where "usual" means its last 26 reports within two years; Siliguri's 4-week trend; the usual seasonal move between the two dates; and the Assam market's own recent trend.</li>
<li>A ridge regression, one per horizon, learns the weights from past weeks only. How strongly it is pulled towards "no change" is chosen on the newest fifth of those past weeks. The range comes from the 10th and 90th percentile of its 150 most recent errors.</li>
</ul>
<p>Three simple methods are run alongside as yardsticks: the last known price; the price in the same week last year; and the last known price moved by Siliguri's change since then.</p>

<h2>5. Test against what actually happened</h2>
<p>The model was tested on the last ${R.backtestSetup.testWeeks} weeks of the Assam market's data. For each week it saw only earlier data, and was refitted every ${R.backtestSetup.refitEveryWeeks} weeks. Error is the average gap between forecast and actual price, as a percentage of the actual price. Lower is better.</p>
${table(['Horizon', 'Test weeks', 'Last known price', 'Same week last year', 'Moved with Siliguri', 'Our model', 'Model better by (negative = worse)', 'Our average miss', 'Direction right*', 'Inside range**'], btRows)}
<p class="note">* Among test weeks where the price actually moved 5% or more, the share where the model called the direction correctly. ** Share of test weeks where the actual price fell inside the model's stated range; the target is 80%. "Same week last year" and "Moved with Siliguri" equal "Last known price" where this market had no report a year earlier and no reporting gap at forecast time, so those methods fell back to the last known price.</p>
<figure>${errorChart()}<figcaption>Figure 3. Average percentage error by method. Lower is better.</figcaption></figure>
<p><b>Plain reading:</b> at 1 week ahead the model's error ${verdict(1)}. At 2 weeks it ${verdict(2)}. At 4 weeks it ${verdict(4)}. ${[1, 2, 4].every(h => b[h].mape && b[h].improvementOverNaivePct < 1) ? '<b>In this market the prototype ties or trails the simplest possible method at every horizon.</b> We report that as it is. It sets the measured starting line that the funded work has to beat.' : ''} ${rangeText}</p>
${R.firstVersion ? `<p><b>One revision was made, and both results are shown.</b> The first version measured the Assam price against its all-time average gap to Siliguri and used a fixed regression strength. Measured on the records downloaded at that point, its error against the last known price changed by ${[1, 2, 4].map(h => num(R.firstVersion.backtest[h].improvementOverNaivePct) + '% at ' + h + ' week' + (h > 1 ? 's' : '')).join(', ')} (negative means worse). The cause was visible in Figure 1: this market barely reported between 2020 and 2025, so the all-time gap was years out of date. The revision described in section 4 was made once, for that stated reason, and the table above is its result. No further tuning was done against the test weeks.</p>` : ''}
<figure>${backtestChart()}<figcaption>Figure 4. Each forecast was made 4 weeks before the date it is plotted on.</figcaption></figure>
<h3>The same test in other Assam districts</h3>
<p>To check that the result is not special to one market, the identical procedure was run on every Assam district with potato prices, each against Siliguri. Districts with fewer than ${R.backtestSetup.minTestPoints} usable test weeks are listed but not scored.</p>
${table(['District', 'Records', 'Weeks with data', 'Coverage', '1 wk: tests', 'Last known', 'Model', 'Better by', '4 wk: tests', 'Last known', 'Model', 'Better by'], distRows, 'long')}
${R.districts.some(x => x.h1 && x.h1.naive < 2) ? `<p class="note">${R.districts.filter(x => x.h1 && x.h1.naive < 2).map(x => x.district).join(', ')}: the reported price there barely changes from week to week (the last known price is off by under 2%), so no method can improve on repeating it. The figures are kept in the table and in the totals below.</p>` : ''}
${R.pooled.h1 ? `<p><b>All scored districts together:</b> ${[1, 2, 4].filter(h => R.pooled['h' + h]).map(h => `at ${h} week${h > 1 ? 's' : ''}, ${R.pooled['h' + h].n.toLocaleString('en-IN')} forecasts, error ${num(R.pooled['h' + h].model)}% for the model against ${num(R.pooled['h' + h].naive)}% for the last known price`).join('; ')}.</p>` : ''}
${replaySection}
${cropsSection}

<h2>6. What the farmer sees</h2>
<p class="warn">This card shows the output format on real data. Because the model has not yet beaten the simple baseline (section 5), it is not yet advice a farmer should act on.</p>
${farmerCard()}
<p>The same advice as a text message (${sms().length} characters):</p><div class="sms">${esc(sms())}</div>
<h3>Long-term view: a price calendar for sowing decisions</h3>
${calendarSummary()}
<figure>${calendarChart()}<figcaption>Figure 5. Each dot is the typical price in that month as a share of the year's typical price. The bar spans the middle half of the years observed.</figcaption></figure>
${table(['', ...MONTHS], [['Assam market', ...R.calendar.assam.map(m => m.index == null ? '-' : Math.round(m.index * 100) + '%')], ['Siliguri', ...R.calendar.ref.map(m => m.index == null ? '-' : Math.round(m.index * 100) + '%')]])}
${webappSection}

<h2>7. Planned screens <span class="tag">design mock-ups, not built</span></h2>
<div class="wire">
  <div class="wf"><h4>Farmer: text message or voice call</h4><div class="box">Missed call or SMS "ALU" to a short number</div><div class="box">Reply in Assamese, Bengali, Bodo or Hindi: price now, price in 4 weeks, advice</div><div class="box">Voice version for farmers who do not read</div></div>
  <div class="wf"><h4>Extension worker: phone app</h4><div class="box">Market &#9662; &nbsp; Crop &#9662;</div><div class="box">Forecast card, as in section 6</div><div class="box">Price calendar for crop planning</div><div class="btn">Report today's price</div><div class="box">Works offline, sends when in range</div></div>
  <div class="wf"><h4>Department and AMIU: dashboard</h4><div class="box">Markets by days since last report (gap watch)</div><div class="box">Forecast against actual, by crop and market</div><div class="box">Markets where the model is not yet reliable</div><div class="box">Download of forecasts and advisories</div></div>
</div>
<p class="note">"Report today's price" matters most: each report from an Agriculture Extension Assistant closes a gap, and the model retrains on it.</p>

<h3>System outline</h3>
<div class="flow">
  <div><b>1. Sources</b>AMIU daily spot prices and arrivals; Agmarknet; comparable markets in other states</div>
  <div><b>2. Cleaning</b>Unit and typing checks; weekly series; every gap flagged, never silently filled</div>
  <div><b>3. Models</b>Short-term forecast with borrowed signal; price calendar; accuracy tracker</div>
  <div><b>4. Advice</b>Hold, sell or no clear signal, with a range and a plain reason</div>
  <div><b>5. Channels</b>SMS and voice; extension app; dashboard; data feed for other systems</div>
</div>
<div class="flow" style="margin-top:6px"><div class="later" style="grid-column:1/3"><b>Later phases</b>Arrival quantities, futures prices, weather and cold-storage stocks as extra signals</div><div class="later" style="grid-column:3/6"><b>Feedback loop</b>Prices reported from the field and forecast-against-actual results flow back into steps 2 and 3</div></div>

<h2>8. Limits of this prototype</h2>
<ul>
<li>Accuracy: over the last ${R.backtestSetup.testWeeks} weeks the model roughly ties the last-known-price method, and over the whole record it does not beat it. It is a measured baseline, not a finished forecaster.</li>
<li>Depth. Only potato has a comparison market and a full analysis. The ${extraCrops.length} other crops were run through the same code and checked less closely.</li>
<li>Public Agmarknet prices only. AMIU's own daily prices and arrival quantities, which the Department names, were not available to us.</li>
<li>The price is a weekly median across the markets of a district, so it hides differences between varieties and between markets.</li>
<li>The 5% hold-or-sell threshold is a placeholder. The real figure depends on storage cost and spoilage, which must come from the Department and farmers.</li>
<li>The price calendar describes past seasons. It is not a forecast of next year's prices.</li>
<li>No farmer or extension worker has used any of this yet.</li>
</ul>

<h2>9. How to reproduce every number</h2>
<p>Requirements: Node.js 20 or later. No other software or packages.</p>
${table(['Step', 'Command', 'What it does'], [
  ['1', '<code>node fetch-hf.js</code> and <code>node fetch.js</code>', 'Download the price records (commands for each file are in the file headers)'],
  ['2', '<code>node test.js</code>', `Runs ${R.checks || 14} self-checks on the cleaning and forecasting code`],
  ['3', '<code>node analyze.js</code>', 'Builds the weekly series, runs the tests against history, writes <code>out/results.json</code>'],
  ['4', '<code>node report.js</code>', 'Builds this document and the farmer page from <code>out/results.json</code>'],
  ['5', '<code>node build-web.js</code>', 'Builds the web app from the same code and checks every crop, district and look-ahead'],
])}
<p class="note">Code files: fetch.js, fetch-hf.js, series.js, model.js, test.js, analyze.js, report.js, build-web.js. Data attribution: AGMARKNET, Ministry of Agriculture and Farmers Welfare, Government of India, via data.gov.in; bulk copy compiled by Manas Khandelwal (DOI 10.34740/kaggle/dsv/15888319), hosted on Hugging Face.</p>`));
console.log('wrote out/farmer.html and out/proof-of-work.html');
