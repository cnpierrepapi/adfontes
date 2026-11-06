// One-off: fill records.raw (exact original text) for days migrated before the column existed.
// Touches ONLY records.raw, in ONE statement (row-by-row over the public proxy was ~35s a row).
// Args: proxyHost proxyPort net
import fs from "node:fs";
import pg from "pg";
const [host, port, net = "testnet"] = process.argv.slice(2);
const u = new URL(process.env.DATABASE_URL); u.hostname = host; u.port = port;
const c = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 15000 });
await c.connect();
const days = [], idxs = [], raws = [];
for (const f of fs.readdirSync(`engine/state/${net}`)) {
  const m = f.match(/^day-(\d+)\.json$/);
  if (!m) continue;
  for (const [i, r] of JSON.parse(fs.readFileSync(`engine/state/${net}/${f}`, "utf8")).entries()) { days.push(Number(m[1])); idxs.push(i); raws.push(JSON.stringify(r)); }
}
const t0 = Date.now();
const res = await c.query(
  `update records r set raw = v.raw
     from unnest($2::int[], $3::int[], $4::text[]) as v(day, idx, raw)
    where r.net = $1 and r.day = v.day and r.idx = v.idx and r.raw is null`,
  [net, days, idxs, raws],
);
const left = await c.query("select day from records where net = $1 and raw is null group by day order by day", [net]);
console.log(`filled ${res.rowCount} of ${raws.length} local records in ${Date.now() - t0} ms; days still without raw: ${left.rows.map((r) => r.day).join(",") || "none"}`);
await c.end();
