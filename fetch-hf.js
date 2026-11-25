// Bulk download from a public Hugging Face copy of the same data.gov.in Agmarknet resource
// (compiled by Manas Khandelwal, DOI 10.34740/kaggle/dsv/15888319; Government Open Data License - India).
// It returns 100 rows per call, against 10 for the public data.gov.in sample key.
// Usage: node fetch-hf.js <out.jsonl> "<where clause>"
//   e.g. node fetch-hf.js data/hf-assam-potato.jsonl "\"State\"='Assam' AND \"Commodity\"='Potato'"
const fs = require('fs');
const [out, where] = process.argv.slice(2);
const DS = 'DHIVAKARNAIDUSUNKARI/mandi-india-daily-prices-2001-2026';
const PAGE = 100, WORKERS = 3;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(offset) {
  const url = `https://datasets-server.huggingface.co/filter?dataset=${encodeURIComponent(DS)}&config=default&split=train&where=${encodeURIComponent(where)}&offset=${offset}&length=${PAGE}`;
  for (let fails = 0; ;) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (++fails > 15) throw e; await sleep(2000 * fails); }
  }
}

(async () => {
  const first = await page(0), total = first.num_rows_total;
  const rows = first.rows.map(r => r.row), offsets = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
  let done = 1;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (offsets.length) {
      const j = await page(offsets.shift());
      rows.push(...j.rows.map(r => r.row));
      if (++done % 25 === 0) console.log(`${rows.length}/${total}`);
    }
  }));
  if (rows.length !== total) throw new Error(`got ${rows.length} rows, expected ${total}`); // never save a partial slice as if complete
  fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log('done', rows.length);
})();
