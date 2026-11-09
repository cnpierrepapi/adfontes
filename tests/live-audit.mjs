// Live audit: everything the README claims, checked against the running site AND the chain itself.
// Usage: node tests/live-audit.mjs [base url, default https://adfontes.fun]
import crypto from "node:crypto";
import { NETWORKS } from "../engine/config.mjs";
import { CLOCK, nearTimeAt, phases } from "../engine/clock.mjs";

const BASE = process.argv[2] || "https://adfontes.fun", NET = "testnet";
const RPC = NETWORKS[NET].rpc;
let pass = 0, fail = 0;
const ok = (cond, what, extra = "") => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"} ${what}${extra ? `  (${extra})` : ""}`); };
const get = (p, opt) => fetch(BASE + p, { redirect: "manual", ...opt });
const api = (p) => get(`/api/${p}${p.includes("?") ? "&" : "?"}net=${NET}`).then((r) => r.json());
const view = async (account, method, args = {}) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) }).then((x) => x.json());
  return JSON.parse(Buffer.from(r.result.result).toString());
};
const Y = 10n ** 24n, near = (y) => Number(BigInt(y) * 1000000n / Y) / 1e6;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const merkle = (leaves) => { let l = leaves.slice(); if (!l.length) return sha("empty"); while (l.length > 1) { const n = []; for (let i = 0; i < l.length; i += 2) n.push(sha(l[i] + (l[i + 1] ?? l[i]))); l = n; } return l[0]; };

// ---------- A. pages ----------
console.log("\n# Pages");
const title = async (p) => { const r = await get(p); const t = await r.text(); return [r.status, (t.match(/<title>([^<]*)<\/title>/) || [])[1] || ""]; };
for (const [p, want] of [["/", "the live world"], ["/live/", "the live world"], ["/judge/", "for judges"], ["/world/", "the world right now"], ["/marketplace/", "the marketplace"], ["/roadmap/", ""], ["/timelapse/", "fast-forwarded"]]) {
  const [s, t] = await title(p);
  ok(s === 200 && t.toLowerCase().includes(want), `${p} loads${want ? ` (title has "${want}")` : ""}`, `${s} "${t}"`);
}
// The old landing page and recorded demo were retired (9 Nov): both send you to the judge page.
for (const p of ["/about", "/demo"]) { const r = await get(p); ok(r.status === 302 && r.headers.get("location") === "/judge/", `${p} sends you to /judge/`, `${r.status} ${r.headers.get("location")}`); }
ok((await get("/no-such-page")).status === 404, "an unknown page is a 404");

// ---------- B. security ----------
console.log("\n# Security");
for (const p of ["/../server.mjs", "/%2e%2e/server.mjs", "/..%2fserver.mjs", "/assets/..%2f..%2fserver.mjs", "/%2e%2e%2f%2e%2e%2f.keys", "/.env.local", "/.keys/", "/engine/state/testnet.json", "/server.mjs", "/package.json", "/.git/config"]) {
  const r = await get(p), t = await r.text();
  ok(!(r.status === 200 && /createServer|private_key|DATABASE_URL|ANTHROPIC|\[core\]|"dependencies"/.test(t)), `no server files or secrets at ${p}`, String(r.status));
}
const bad = await get("/%E0%A4%A");
// Railway's edge rejects some malformed addresses before they reach the app (502, no request id);
// anything that does reach the app must get a clean 400.
const edge = bad.status === 502 && !bad.headers.get("x-railway-request-id");
ok(bad.status === 400 || edge, "a malformed address is refused (400 from the app, or stopped at Railway's edge)", `${bad.status}${edge ? " at the edge" : ""}`);
ok((await get("/")).status === 200, "the site is still up after the malformed address");
const unk = await get("/api/nope?net=testnet");
ok(unk.status === 404 || unk.status === 400, "an unknown API is refused", String(unk.status));
for (const q of ["clan?id=abc", "clan?id=-1", "clan?id=1;drop%20table%20records", "day?d=-5", "day?d=999999999", "proof?d=1&i=999999", "draft?id=../../etc/passwd"]) {
  const r = await get(`/api/${q}&net=testnet`);
  ok(r.status < 500, `junk input gets a clean answer, not a 500: ${q}`, String(r.status));
}
const long = await get(`/api/world?net=testnet&x=${"a".repeat(20000)}`);
ok(long.status < 500, "a 20 kB query string doesn't break it", String(long.status));
for (const body of ["{}", "not json", JSON.stringify({ account: "../../etc" }), JSON.stringify({ account: "a".repeat(5000) }), JSON.stringify({ account: "world.adfontes.near" })]) {
  const r = await get("/api/sponsor?net=testnet", { method: "POST", headers: { "content-type": "application/json" }, body });
  const t = await r.text();
  ok(r.status < 500 && !/stack|at .*\.mjs/.test(t), `the sponsor endpoint refuses junk safely: ${body.slice(0, 30)}`, `${r.status} ${t.slice(0, 60)}`);
}
ok((await get("/api/world?net=mainnet")).status === 200, "the mainnet API still answers");

// ---------- C. API money numbers ----------
console.log("\n# The API");
const W = await api("world");
ok(W.world === NETWORKS[NET].world, `the site is on the v2 world ${W.world}`);
ok(W.clock && ["day", "night"].includes(W.clock.phase), "the world clock is served", W.clock?.phase);
const fv = W.totals.backing / W.totals.florins;
ok(Math.abs(fv - W.totals.florin_value) < 1e-4, "florin price = backing ÷ florins", `${fv.toFixed(6)} vs ${W.totals.florin_value}`);
ok(Math.abs(W.clans.reduce((a, c) => a + c.florins, 0) - W.totals.florins) < 0.01, "the nations' florins add up to all florins");
ok(W.clans.every((c) => Math.abs(c.worth - c.florins * W.totals.florin_value) < 0.002), "each nation's worth = its florins x florin price");
ok(W.clans.every((c) => Array.isArray(c.techs) && ["hungry", "content", "sated", null].includes(c.mood ?? null)), "nations report techs and a needs mood");
const C1 = await api(`clan?id=${W.clans[0].id}`);
ok(Array.isArray(C1.points) && C1.points.every((p) => ["calm", "faith", "doubt"].includes(p.stir)), "every point of knowledge has a mood (calm, faith or doubt)");

// ---------- D. the chain's money rules ----------
console.log("\n# On chain (read from NEAR directly)");
const T = await view(W.world, "get_totals"), clans = await view(W.world, "list_clans", { limit: 100 });
const staking = clans.reduce((a, c) => a + BigInt(c.staking_fund), 0n);
ok(BigInt(T.balance) >= BigInt(T.liabilities) + BigInt(T.storage_locked), "the world can pay everything it owes (balance ≥ liabilities + storage)", `${near(T.balance)} ≥ ${near(T.liabilities)} + ${near(T.storage_locked)}`);
ok(BigInt(T.liabilities) >= BigInt(T.backing) + BigInt(T.jackpot) + staking, "liabilities cover backing + jackpot + staking funds");
// A turn can land between reading the totals and the stakes, so read both again until they come
// from the same moment (9 Nov: one turn mid-read showed 0.0003 NEAR too much).
let stakes = 0n, T2 = T;
for (let tries = 0; tries < 3; tries++) {
  T2 = await view(W.world, "get_totals"); stakes = 0n;
  const cl = await view(W.world, "list_clans", { limit: 100 });
  for (const c of cl) for (const g of c.gods) stakes += BigInt((await view(W.world, "get_stake", { clan_id: c.id, account: g.account })).near);
  if ((await view(W.world, "get_totals")).backing === T2.backing) break;
}
ok(BigInt(T2.backing) - stakes >= 0n && BigInt(T2.backing) - stakes < 10n ** 21n, "every god's stake adds up to the backing (to 0.001 NEAR)", `${near(stakes)} of ${near(T2.backing)}`);
ok(clans.reduce((a, c) => a + BigInt(c.florins), 0n) === BigInt(T.florins), "florins held by nations = florins in existence, exactly");
ok(BigInt(T.florin_value) === (BigInt(T.florins) ? (10n ** 22n * BigInt(T.backing)) / BigInt(T.florins) : 10n ** 22n), "florin value on chain = backing ÷ florins");
const putIn = clans.reduce((a, c) => a + BigInt(c.total_in), 0n);
ok(BigInt(T.jackpot) * 10000n >= putIn * 1399n, "the jackpot holds 14% of everything put in", `${near(T.jackpot)} vs 14% of ${near(putIn)}`);
const cfg = await view(W.world, "get_config");
ok(BigInt(cfg.season_end_ns) / 1000000n === BigInt(CLOCK.seasonEnd), "the contract's season end = the clock's season end (30 Nov, midnight Malta)");
ok(cfg.operator === "adfontes-mw1fjpfx.testnet" && cfg.owner === W.world, "operator and owner are what we say");

// ---------- E. proofs ----------
console.log("\n# Proofs");
let sealed = null;
for (let d = W.day; d >= Math.max(1, W.day - 4) && !sealed; d--) { const day = await api(`day?d=${d}`); if (day.root && day.records.length) sealed = day; }
ok(!!sealed, "there's a sealed turn to check", sealed ? `turn ${sealed.day}, ${sealed.records.length} records` : "");
if (sealed) {
  const recs = sealed.records.map(({ i, ...r }) => r);
  const mine = merkle(recs.map((r) => sha(canon(r))));
  const onchain = await view(W.world, "get_root", { day: sealed.day });
  ok(mine === onchain, `I rebuilt turn ${sealed.day}'s fingerprint from its records and NEAR holds the same`, `${mine.slice(0, 12)}…`);
  const i = Math.floor(Math.random() * recs.length), P = await api(`proof?d=${sealed.day}&i=${i}`);
  let h = sha(canon(P.record));
  for (const s of P.path) h = s.left ? sha(s.hash + h) : sha(h + s.hash);
  ok(h === onchain, `a random record's proof path (record ${i + 1}) climbs to NEAR's fingerprint`);
  const tampered = { ...recs[i], kind: recs[i].kind + "x" };
  let ht = sha(canon(tampered)); for (const s of P.path) ht = s.left ? sha(s.hash + ht) : sha(ht + s.hash);
  ok(ht !== onchain, "a tampered record fails the same proof");
  ok(!sealed.records.some((r) => r.kind === "error"), "no errors in the last sealed turn", `${sealed.records.filter((r) => r.kind === "error").length} errors`);
}

// ---------- F. the clock ----------
console.log("\n# The clock");
const now = Date.now(), c = W.clock;
ok(Math.abs(c.nearTime - nearTimeAt(now)) < 10 * 60e3, "the world's NEAR time = the 5x replay that meets live NEAR on 30 Nov", `${new Date(c.nearTime).toISOString().slice(0, 16)}`);
const hrs = [];
for (let t = c.phaseStartedNear; t < c.nearTime; t += 300 * 3600e3) {
  const r = await fetch(`https://api.exchange.coinbase.com/products/NEAR-USD/candles?granularity=3600&start=${new Date(t).toISOString()}&end=${new Date(Math.min(c.nearTime, t + 299 * 3600e3)).toISOString()}`, { headers: { "user-agent": "adfontes-audit" } }).then((x) => x.json());
  hrs.push(...r.map((k) => [k[0], k[4]]));
}
hrs.sort((a, b) => a[0] - b[0]);
const done = hrs.filter((h) => h[0] * 1000 + 3600e3 <= c.nearTime);
// Start from the phase the world is in (a slide during a night is more night, not a reversal).
const ph = phases(done.length ? done : [[c.phaseStartedNear / 1000, c.startPrice]], undefined, c.phase === "day");
ok(ph.length === 1, `since the phase began, NEAR hasn't reversed 3% (so it's still ${c.phase})`, `${done.length} hours checked, start $${c.startPrice}`);

// ---------- G. the engine is alive ----------
console.log("\n# The engine");
const lastTurn = await api(`day?d=${W.day}`);
const clockRec = lastTurn.records.find((r) => r.kind === "clock");
ok(!!clockRec, `the latest turn (${W.day}) ran on the v2 clock`);
const errs = [];
for (let d = Math.max(1, W.day - 3); d <= W.day; d++) errs.push(...(await api(`day?d=${d}`)).records.filter((r) => r.kind === "error"));
ok(errs.length === 0, "no engine errors in the last 4 turns", errs.map((e) => e.error).join(" | ").slice(0, 200));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
