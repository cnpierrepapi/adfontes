// Load test: swarm the site with simultaneous visitors and see if it holds.
// Usage: node tests/load.mjs [base url] [waves e.g. 25,100,300] [seconds per wave]
// Our own site only. The API caches its chain reads, so this tests our server, not NEAR's RPC.
const BASE = process.argv[2] || "https://adfontes.fun";
const WAVES = (process.argv[3] || "25,100,300").split(",").map(Number);
const SECS = Number(process.argv[4]) || 20;

const home = await fetch(BASE + "/").then((r) => r.text());
const js = (home.match(/src="(\/assets\/[^"]+\.js)"/) || [])[1];
const W = await fetch(`${BASE}/api/world?net=testnet`).then((r) => r.json());
const MIX = [ // what a crowd of visitors asks for, weighted
  ["/", 20], [js, 15], ["/api/world?net=testnet", 30], [`/api/clan?id=${W.clans[0]?.id ?? 1}&net=testnet`, 15],
  [`/api/day?d=${Math.max(1, W.day - 1)}&net=testnet`, 10], ["/judge/", 5], ["/api/trades?days=20&net=testnet", 5],
].filter(([p]) => p);
const total = MIX.reduce((a, [, w]) => a + w, 0);
const pick = () => { let r = Math.random() * total; for (const [p, w] of MIX) if ((r -= w) <= 0) return p; return MIX[0][0]; };
const pct = (xs, q) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * q))] : NaN;

async function wave(n) {
  const lat = [], codes = {}, errs = {};
  let done = 0;
  const end = Date.now() + SECS * 1000;
  await Promise.all([...Array(n)].map(async () => {
    while (Date.now() < end) {
      const p = pick(), t0 = performance.now();
      try {
        const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) });
        await r.arrayBuffer();
        codes[r.status] = (codes[r.status] || 0) + 1;
      } catch (e) { const k = e.name === "TimeoutError" ? "timeout >15s" : String(e.cause?.code || e.message).slice(0, 40); errs[k] = (errs[k] || 0) + 1; }
      lat.push(performance.now() - t0); done++;
    }
  }));
  lat.sort((a, b) => a - b);
  const bad = Object.entries(codes).filter(([c]) => Number(c) >= 500).reduce((a, [, v]) => a + v, 0) + Object.values(errs).reduce((a, b) => a + b, 0);
  console.log(`${String(n).padStart(4)} visitors x ${SECS}s: ${done} requests, ${(done / SECS).toFixed(0)}/s | p50 ${pct(lat, 0.5).toFixed(0)} ms, p95 ${pct(lat, 0.95).toFixed(0)} ms, p99 ${pct(lat, 0.99).toFixed(0)} ms | statuses ${JSON.stringify(codes)}${Object.keys(errs).length ? ` | failures ${JSON.stringify(errs)}` : ""} | failed ${(100 * bad / Math.max(1, done)).toFixed(2)}%`);
  return bad / Math.max(1, done);
}

console.log(`Swarming ${BASE} (mix: ${MIX.map(([p, w]) => `${p.split("?")[0]} ${w}%`).join(", ")})`);
const fails = [];
for (const n of WAVES) fails.push(await wave(n));
// Still standing?
const after = await Promise.all(["/", "/api/world?net=testnet", "/judge/"].map((p) => fetch(BASE + p).then((r) => r.status).catch(() => "down")));
console.log(`after the swarm: / ${after[0]}, /api/world ${after[1]}, /judge/ ${after[2]}`);
process.exit(after.every((s) => s === 200) ? 0 : 1);
