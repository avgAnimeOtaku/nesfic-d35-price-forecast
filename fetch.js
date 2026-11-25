// Downloads Agmarknet "Variety-wise Daily Market Prices" rows from data.gov.in into a JSONL file.
// Usage:  node fetch.js <out.jsonl | --count> Field=Value [Field=Value ...]
//   e.g.  node fetch.js data/assam-potato.jsonl State=Assam Commodity=Potato
// Env:    DATA_GOV_KEY  your own data.gov.in key (default: the public sample key, 10 rows per call and rate-limited)
//         PAGE          rows per call (default 10; raise it with your own key)
//         START, END    row offsets, to split one slice across several parallel runs (use multiples of PAGE)
// Re-running resumes from the rows already saved.
const fs = require('fs');
const [out, ...kv] = process.argv.slice(2);
const KEY = process.env.DATA_GOV_KEY || '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b';
const PAGE = +(process.env.PAGE || 10);
const RESOURCE = '35985678-0d79-46b4-9ed6-6f13308a1d24';
const filters = kv.map(s => { const i = s.indexOf('='); return `filters%5B${s.slice(0, i)}%5D=${encodeURIComponent(s.slice(i + 1))}`; }).join('&');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const counting = out === '--count';
  const START = +(process.env.START || 0), END = +(process.env.END || Infinity);
  const saved = !counting && fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).length : 0;
  // DESC_FROM=<offset of the last page> walks backwards, so the newest rows (stored last) arrive first.
  const DESC = process.env.DESC_FROM != null ? +process.env.DESC_FROM : null;
  let offset = DESC != null ? DESC - PAGE * Math.ceil(saved / PAGE) : START + saved;
  for (let fails = 0; ;) {
    const url = `https://api.data.gov.in/resource/${RESOURCE}?api-key=${KEY}&format=json&limit=${PAGE}&offset=${offset}&${filters}`;
    let j;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      j = await r.json();
    } catch (e) { // the shared sample key returns 429 under load, so back off and retry
      if (++fails > 40) throw e;
      await sleep(Math.min(1500 * fails, 15000));
      continue;
    }
    fails = 0;
    if (counting) { console.log(j.total); return; }
    const recs = j.records || [];
    if (!recs.length) break;
    fs.appendFileSync(out, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
    if (DESC != null) { offset -= PAGE; if (offset < START) break; continue; }
    offset += recs.length;
    if (offset % 500 < recs.length) console.log(`${offset}/${j.total}`);
    if (offset >= Math.min(j.total, END)) break;
  }
  console.log('done', offset);
})();
