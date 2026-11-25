// Self-checks for series.js and model.js. Run: node test.js
const assert = require('assert');
const { parseRow, weekIndex, weekStart, weeklySeries } = require('./series');
const { ridge, adviceFor, backtest, forecastLatest, seasonCalendar } = require('./model');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name); };
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const W0 = weekIndex(day(2015, 1, 5));
const row = (w, price) => ({ date: weekStart(w), district: 'X', market: 'Y', price });

// ---- series.js
test('parseRow reads the older string format', () => {
  const r = parseRow({ Arrival_Date: '04/07/2009', Modal_Price: '1200', District: 'Barpeta', Market: 'Bohorihat' });
  assert.strictEqual(r.price, 1200);
  assert.strictEqual(r.date.getTime(), day(2009, 7, 4).getTime());
  assert.strictEqual(r.market, 'Bohorihat');
});
test('parseRow reads the newer numeric, lowercase format', () => {
  const r = parseRow({ arrival_date: '25/11/2026', modal_price: 1700, district: 'Darrang', market: 'Balugaon APMC' });
  assert.strictEqual(r.price, 1700);
  assert.strictEqual(r.date.getTime(), day(2026, 11, 25).getTime());
});
test('parseRow reads the mirror format with ISO dates', () => {
  const r = parseRow({ Arrival_Date: '2012-09-12', Modal_Price: 1150, District: 'Darjeeling', Market: 'Siliguri' });
  assert.strictEqual(r.price, 1150);
  assert.strictEqual(r.date.getTime(), day(2012, 9, 12).getTime());
});
test('parseRow rejects zero, text and missing dates', () => {
  assert.strictEqual(parseRow({ Arrival_Date: '04/07/2009', Modal_Price: '0' }), null);
  assert.strictEqual(parseRow({ Arrival_Date: '04/07/2009', Modal_Price: 'NR' }), null);
  assert.strictEqual(parseRow({ Modal_Price: '1200' }), null);
});
test('weekIndex groups Monday to Sunday', () => {
  assert.strictEqual(weekIndex(day(2026, 11, 23)), weekIndex(day(2026, 11, 29)));
  assert.strictEqual(weekIndex(day(2026, 11, 30)), weekIndex(day(2026, 11, 23)) + 1);
});
test('weeklySeries takes the median of a week', () => {
  const s = weeklySeries([row(W0, 1000), row(W0, 1200), row(W0, 1100)]);
  assert.strictEqual(s.get(W0), 1100);
});
test('weeklySeries drops a wrong-unit row', () => {
  const rows = [];
  for (let k = 0; k < 20; k++) rows.push(row(W0 + k, 2000 + k));
  rows.push(row(W0 + 10, 20)); // rupees per kg typed as per quintal
  const s = weeklySeries(rows);
  assert.strictEqual(s.get(W0 + 10), 2010);
  assert.strictEqual(s.dropped, 1);
});

// ---- model.js
// Synthetic markets: R is seasonal with deterministic noise; A follows R one week later at 1.2 times the price.
const synth = (weeks) => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const R = new Map(), A = new Map();
  for (let k = 0; k < weeks; k++) R.set(W0 + k, 1000 * (1 + 0.3 * Math.sin(2 * Math.PI * k / 52)) * (1 + 0.04 * (rnd() - 0.5)));
  for (let k = 1; k < weeks; k++) A.set(W0 + k, 1.2 * R.get(W0 + k - 1));
  return { A, R };
};

test('ridge recovers a straight line', () => {
  const X = [], y = [];
  for (let i = 0; i < 50; i++) { X.push([1, i / 10]); y.push(2 + 3 * i / 10); }
  const b = ridge(X, y, 1e-6);
  assert.ok(Math.abs(b[0] - 2) < 0.01 && Math.abs(b[1] - 3) < 0.01, String(b));
});
test('adviceFor uses 5 percent thresholds', () => {
  assert.strictEqual(adviceFor(5), 'HOLD');
  assert.strictEqual(adviceFor(-5), 'SELL');
  assert.strictEqual(adviceFor(4.9), 'NO CLEAR SIGNAL');
});
test('backtest: model beats the naive baseline when the comparison market leads', () => {
  const { A, R } = synth(300);
  const b = backtest(A, R, { horizons: [1, 2, 4], testWeeks: 156, refitEvery: 26 });
  assert.ok(b[1].n >= 150, 'n=' + b[1].n);
  assert.ok(b[1].mape.model < b[1].mape.naive, JSON.stringify(b[1].mape));
  assert.ok(b[1].coverage80 > 0.5 && b[1].coverage80 <= 1);
});
test('backtest: too few test weeks gives null metrics, with n reported', () => {
  const { A, R } = synth(80);
  const b = backtest(A, R, { horizons: [1], testWeeks: 21, refitEvery: 26 });
  assert.strictEqual(b[1].n, 20);
  assert.strictEqual(b[1].mape, null);
  assert.strictEqual(b[1].coverage80, null);
});
test('forecastLatest refuses a stale price and reports its age', () => {
  const { A, R } = synth(200);
  const last = W0 + 199;
  for (let k = 0; k < 3; k++) A.delete(last - k);
  const f = forecastLatest(A, R, 4);
  assert.strictEqual(f.ageWeeks, 3);
  assert.ok(f.point > 0 && f.lo <= f.point && f.point <= f.hi);
  assert.ok(['HOLD', 'SELL', 'NO CLEAR SIGNAL'].includes(f.advice));
  A.delete(last - 3); A.delete(last - 4);
  assert.deepStrictEqual(forecastLatest(A, R, 4), { noRecentPrice: true });
});
test('forecastLatest works with no comparison market', () => {
  const { A } = synth(200);
  const f = forecastLatest(A, new Map(), 2);
  assert.ok(f.point > 0 && f.ageWeeks === 0);
});
test('seasonCalendar returns 12 months around an index of 1', () => {
  const { R } = synth(300);
  const c = seasonCalendar(R);
  assert.strictEqual(c.length, 12);
  assert.ok(c.every(m => m.index > 0.5 && m.index < 1.5 && m.lo <= m.index && m.index <= m.hi));
  const mean = c.reduce((s, m) => s + m.index, 0) / 12;
  assert.ok(Math.abs(mean - 1) < 0.1, String(mean));
});

console.log(`\n${passed} checks passed`);
