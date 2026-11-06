// One-off: fill records.raw (exact original text) for days migrated before the column existed.
// Touches ONLY records.raw; never the live world state. Args: proxyHost proxyPort net
import fs from "node:fs";
import pg from "pg";
const [host, port, net = "testnet"] = process.argv.slice(2);
const u = new URL(process.env.DATABASE_URL); u.hostname = host; u.port = port;
const c = new pg.Client({ connectionString: u.toString() });
await c.connect();
await c.query("alter table records add column if not exists raw text");
let n = 0, days = 0;
for (const f of fs.readdirSync(`engine/state/${net}`)) {
  const m = f.match(/^day-(\d+)\.json$/);
  if (!m) continue;
  const recs = JSON.parse(fs.readFileSync(`engine/state/${net}/${f}`, "utf8"));
  for (const [i, r] of recs.entries()) {
    const res = await c.query("update records set raw = $1 where net = $2 and day = $3 and idx = $4 and raw is null", [JSON.stringify(r), net, Number(m[1]), i]);
    n += res.rowCount;
  }
  days++;
}
const left = await c.query("select day, count(*) from records where net = $1 and raw is null group by day order by day", [net]);
console.log(`filled ${n} records across ${days} days; days still without raw: ${left.rows.map((r) => r.day).join(",") || "none"}`);
await c.end();
