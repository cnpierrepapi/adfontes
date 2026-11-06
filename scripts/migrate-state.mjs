// One-off: copy a network's local engine state into Railway Postgres.
// Run: railway run --service Postgres node scripts/migrate-state.mjs testnet
import fs from "node:fs";

const net = process.argv[2] || "testnet";
process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL; // reach Railway's DB from this PC
const store = await import("../engine/store.mjs");
const W = await import("../engine/world.mjs");

const s = JSON.parse(fs.readFileSync(`engine/state/${net}.json`, "utf8"));
await store.saveState(net, s);

let days = 0, drafts = 0;
for (const f of fs.readdirSync(`engine/state/${net}`)) {
  const m = f.match(/^day-(\d+)\.json$/);
  if (m) {
    const rec = JSON.parse(fs.readFileSync(`engine/state/${net}/${f}`, "utf8"));
    const day = Number(m[1]);
    await store.saveDay(net, day, rec, s.roots[day] ?? W.merkleRoot(rec), null);
    days++;
  } else if (/^d\d+\.json$/.test(f)) {
    await store.saveDraft(net, JSON.parse(fs.readFileSync(`engine/state/${net}/${f}`, "utf8")));
    drafts++;
  }
}
const cache = fs.existsSync("engine/state/papers-cache.json") ? JSON.parse(fs.readFileSync("engine/state/papers-cache.json", "utf8")) : {};
for (const [k, v] of Object.entries(cache)) await store.putPapers(k, v);

const back = await store.loadState(net);
console.log(`state day ${back.day} (local ${s.day}), clans ${Object.keys(back.clans).length}, corpora ${Object.keys(back.corpora).length}; days ${days}, drafts ${drafts}, paper searches ${Object.keys(cache).length}`);
await store.close();
