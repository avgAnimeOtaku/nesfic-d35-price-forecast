// Turns raw Agmarknet rows into a weekly price series (rupees per quintal).
const fs = require('fs');

const WEEK = 7 * 864e5;
const EPOCH_MONDAY = Date.UTC(1970, 0, 5);

const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const get = (rec, key) => { for (const k in rec) if (k.toLowerCase() === key) return rec[k]; };

function loadJsonl(paths) {
  const seen = new Set(), out = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line || seen.has(line)) continue; // overlapping downloads repeat rows
      seen.add(line);
      try { out.push(JSON.parse(line)); } catch { /* half-written last line of a file still downloading */ }
    }
  }
  return out;
}

function parseRow(rec) {
  const s = String(get(rec, 'arrival_date') || '');
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s), ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); // data.gov.in uses DD/MM/YYYY, the mirror YYYY-MM-DD
  const time = dmy ? Date.UTC(+dmy[3], dmy[2] - 1, +dmy[1]) : ymd ? Date.UTC(+ymd[1], ymd[2] - 1, +ymd[3]) : null;
  const price = Number(get(rec, 'modal_price'));
  if (time == null || !(price > 0)) return null;
  return { date: new Date(time), district: get(rec, 'district'), market: get(rec, 'market'), variety: get(rec, 'variety'), price };
}

const weekIndex = date => Math.floor((date - EPOCH_MONDAY) / WEEK);
const weekStart = i => new Date(EPOCH_MONDAY + i * WEEK);

function weeklySeries(rows) {
  const group = rs => {
    const g = new Map();
    for (const r of rs) { const w = weekIndex(r.date); if (!g.has(w)) g.set(w, []); g.get(w).push(r.price); }
    return new Map([...g].sort((a, b) => a[0] - b[0]).map(([w, prices]) => [w, median(prices)]));
  };
  const raw = group(rows);
  // Wrong-unit and typo rows: drop a daily price that is more than 4 times away from the local price level.
  const keep = rows.filter(r => {
    const w = weekIndex(r.date), near = [];
    for (let k = w - 8; k <= w + 8; k++) if (raw.has(k)) near.push(raw.get(k));
    const level = median(near);
    return r.price >= level / 4 && r.price <= level * 4;
  });
  const series = group(keep);
  series.dropped = rows.length - keep.length;
  return series;
}

module.exports = { loadJsonl, parseRow, weekIndex, weekStart, weeklySeries, median, WEEK };
