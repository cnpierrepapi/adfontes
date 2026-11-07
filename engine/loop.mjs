// The live world loop (SPEC §12n, his call 7 Nov: no more cron). Always on. Every few seconds it
// looks at the chain and answers the gods at once:
// - a NEW NATION gets a fast start: its citizens straight away, then an instant turn every 20 s for
//   its first minutes (first research, first report, first draft), and a new world day ~3 min in;
// - a god's BLESSING (their deposit went up) or a DAO power that PASSED (whisper, smite, rule,
//   release staking) gets that nation an instant turn within seconds;
// - a world day still comes every 2 hours.
// The real work is engine/run.mjs (a day, or `--instant`), run one at a time so nothing clashes
// over the saved state. Usage: node engine/loop.mjs testnet [mainnet]
import { spawn } from "node:child_process";
import { connect } from "./chain.mjs";
import * as store from "./store.mjs";

const NETS = process.argv.slice(2).filter((a) => a === "testnet" || a === "mainnet");
if (!NETS.length) NETS.push("testnet");
const EVERY_MS = 5000;
const DAY_MS = 2 * 3600e3;
const FRESH = { forMs: 6 * 60e3, everyMs: 20e3, maxRuns: 10 }; // a new nation's first minutes
const DAY_AFTER_FOUNDING_MS = 3 * 60e3;
const MIN_DAY_GAP_MS = 10 * 60e3; // a burst of foundings shares one day

const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const worlds = {};
for (const net of NETS) {
  const s = await store.loadState(net);
  worlds[net] = {
    net, chain: connect(net),
    known: new Set(Object.keys(s.clans).map(Number)),
    putIn: new Map(), lastProp: new Map(), open: new Map(), // nation id -> ...
    fresh: new Map(), // nation id -> { since, runs, next }
    lastDay: s.lastRunAt || 0, dayDueAt: null,
    queue: new Map(), // nation id -> fresh?
    dayQueued: false,
  };
  say(`${net}: watching; ${worlds[net].known.size} nations known, last day ${s.lastRunAt ? new Date(s.lastRunAt).toISOString() : "never"}`);
}
await store.close();

// ---- one engine run at a time ----
let busy = false, child = null;
function run(net, args) {
  return new Promise((resolve) => {
    const full = ["engine/run.mjs", net, ...args, ...(net === "mainnet" ? ["--yes-mainnet"] : [])];
    say(`${net}: run ${args.join(" ")}`);
    child = spawn(process.execPath, full, { stdio: "inherit" });
    child.on("exit", (code) => { child = null; say(`${net}: run done (${code})`); resolve(code); });
  });
}
process.on("SIGTERM", () => { say("stopping"); if (child) child.kill("SIGTERM"); else process.exit(0); setTimeout(() => process.exit(0), 60e3); });

// ---- watching ----
async function look(W) {
  const now = Date.now();
  const clans = (await W.chain.clans()).filter((c) => c.alive);
  for (const c of clans) {
    // A nation the world hasn't seen: fast start, and a world day soon after.
    if (!W.known.has(c.id)) {
      W.known.add(c.id);
      W.fresh.set(c.id, { since: now, runs: 0, next: now });
      if (now - W.lastDay > MIN_DAY_GAP_MS) W.dayDueAt = Math.min(W.dayDueAt ?? Infinity, now + DAY_AFTER_FOUNDING_MS);
      say(`${W.net}: new nation ${c.id} ${c.name}`);
    }
    // A blessing: some god's deposit went up.
    const sig = c.gods.map((g) => `${g.account}:${g.put_in}`).join("|");
    if (W.putIn.has(c.id) && W.putIn.get(c.id) !== sig) W.queue.set(c.id, W.queue.get(c.id) || false);
    W.putIn.set(c.id, sig);
    // DAO powers: new proposals are watched until they pass (or fail).
    try {
      const last = await W.chain.dao(c.dao, "get_last_proposal_id");
      const was = W.lastProp.get(c.id);
      const open = W.open.get(c.id) || new Set();
      if (was != null) for (let id = was; id < last; id++) open.add(id);
      W.lastProp.set(c.id, last);
      for (const id of [...open]) {
        const p = await W.chain.dao(c.dao, "get_proposal", { id }).catch(() => null);
        if (!p || p.status === "InProgress") continue;
        open.delete(id);
        if (p.status === "Approved") W.queue.set(c.id, W.queue.get(c.id) || false);
      }
      W.open.set(c.id, open);
    } catch {}
  }
  // A new nation's first minutes: an instant turn every 20 s.
  for (const [id, f] of W.fresh) {
    if (now - f.since > FRESH.forMs || f.runs >= FRESH.maxRuns) { W.fresh.delete(id); continue; }
    if (now >= f.next) { W.queue.set(id, true); f.runs++; f.next = now + FRESH.everyMs; }
  }
  if (now - W.lastDay >= DAY_MS || (W.dayDueAt && now >= W.dayDueAt)) W.dayQueued = true;
}

async function work() {
  if (busy) return;
  busy = true;
  try {
    for (const W of Object.values(worlds)) {
      await look(W).catch((e) => say(`${W.net}: look failed: ${String(e.message || e).slice(0, 120)}`));
      if (W.dayQueued) {
        W.dayQueued = false; W.dayDueAt = null;
        await run(W.net, ["--force"]);
        W.lastDay = Date.now();
        W.queue.clear(); // the day gave everyone a turn
      } else if (W.queue.size) {
        const ids = [...W.queue.keys()], fresh = [...W.queue.values()].some(Boolean);
        W.queue.clear();
        await run(W.net, ["--instant", ids.join(","), ...(fresh ? ["--fresh"] : [])]);
      }
    }
  } finally { busy = false; }
}
setInterval(work, EVERY_MS);
work();
