// 17 Nov: the market passed 500 listings (675) and 500 sales (543). The contract hands back at most 500 a call, and the
// engine only ever read from 0, so it couldn't see 67 open listings: Brokers listed onto full shelves and listed things
// already up, and the contract refused ('at most 10 open listings', 'already listed'; 46 errors sealed on turn 112).
// chain.marketListings / marketSales now read every page from `from` on (src/server/pages.mjs readAll).
import fs from "node:fs";
import { readAll } from "../src/server/pages.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const chain = fs.readFileSync(new URL("./chain.mjs", import.meta.url), "utf8");
ok(/import \{ readAll \} from "\.\.\/src\/server\/pages\.mjs"/.test(chain), "chain.mjs uses the shared pager");
ok(/marketListings: \(from = 0\) => readAll\(\(f, limit\) => view\("market_listings", \{ from_index: from \+ f, limit \}\)\)/.test(chain), "marketListings reads every page from `from`");
ok(/marketSales: \(from = 0\) => readAll\(\(f, limit\) => view\("market_sales", \{ from_index: from \+ f, limit \}\)\)/.test(chain), "marketSales reads every page from `from`");
ok(!/view\("market_(listings|sales)", \{ from_index: from, limit: 500 \}\)/.test(chain), "no one-page read left");

// The same wrapper the chain uses, against a contract that caps a call at 500, like ours.
const listings = Array.from({ length: 675 }, (_, id) => ({ id, open: id >= 533 }));
const view = async (_m, { from_index, limit }) => listings.slice(from_index, from_index + Math.min(limit, 500));
const read = (from = 0) => readAll((f, limit) => view("market_listings", { from_index: from + f, limit }));
const all = await read(0);
ok(all.length === 675 && all.filter((l) => l.open).length === 142, `all 675 listings and all 142 open ones (${all.length}, ${all.filter((l) => l.open).length})`);
const since = await read(520);
ok(since.length === 155 && since[0].id === 520, `from 520 on: 155, starting at 520 (${since.length}, ${since[0]?.id})`);

console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
