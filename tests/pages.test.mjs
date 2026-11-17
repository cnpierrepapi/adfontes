// readAll (src/server/pages.mjs): every page of a contract list, not just the first 500 (17 Nov).
import { readAll } from "../src/server/pages.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const list = (n) => Array.from({ length: n }, (_, id) => ({ id }));
const pager = (all) => { const calls = []; return { calls, page: async (from, limit) => { calls.push(from); return all.slice(from, from + limit); } }; };

{ const p = pager(list(675)); const got = await readAll(p.page); ok(got.length === 675 && got[674].id === 674, `675 listings read whole (${got.length}), the newest included`); ok(p.calls.join() === "0,500", `two pages asked for (${p.calls})`); }
{ const p = pager(list(1000)); const got = await readAll(p.page); ok(got.length === 1000 && p.calls.join() === "0,500,1000", "exactly 1000: a third, empty page ends it"); }
{ const p = pager(list(42)); ok((await readAll(p.page)).length === 42 && p.calls.length === 1, "under a page: one call"); }
{ const got = await readAll(async () => null); ok(got.length === 0, "a page that comes back empty-handed reads as nothing"); }
{ let n = 0; const got = await readAll(async () => { n++; return list(500); }, { maxPages: 3 }); ok(n === 3 && got.length === 1500, "a source that ignores from_index can't loop forever"); }

console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
