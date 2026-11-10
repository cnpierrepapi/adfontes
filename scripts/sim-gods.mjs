// Simulated gods for the fast-forward (his call 8 Nov). Sim only: they act on the stand-in chain
// file between engine turns, never on testnet or mainnet, and their blessings move stand-in money.
//
// Each god of each nation follows his rule, with the nation's standing (the reverence of the god it
// follows) as the gauge:
//   faithful (standing >= 30): visits every day.
//   away (drops under 30): stops coming. Tests whether a neglected nation holds up.
//   rescue (drops under 10): rushes back and keeps visiting until the nation is above 30 again,
//     then it's faithful. The 10-30 band stops gods flickering on and off at one line.
// Per god randomness: each has its own small offset on both lines (so in a two-god nation one can
// stay while the other drifts) and visits at its own random hour of each day.
//
// A visit does what a real god does through the site, in the same shape the engine reads:
//   - a whisper: a Sputnik proposal, already approved, in the nation's DAO (chain-sim serves it);
//   - a small blessing: the god's put_in grows, 86% backs florins, 14% to the jackpot (as the contract);
//   - rules the nation's pending gifts: rewards the ones the Warden passed (a "rule" proposal + status).
import fs from "node:fs";

// whisperCap (his call 10 Nov): each god whispers at most 5 times in the whole run. A whisper is heard by
// a model call, the run's biggest cost; after the fifth the god still visits, blesses and rules.
export const GODS = { faithfulAt: 30, rescueBelow: 10, jitter: 3, blessMin: 0.05, blessMax: 0.25, dayMs: 24 * 3600e3, whisperCap: Number(process.env.ADF_SIM_WHISPER_CAP ?? 5) };
const YOCTO = 10n ** 24n;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const WHISPERS = [
  "Go deeper on what you already know.", "Trade with your neighbours, not against them.",
  "Write the next patent carefully; no rushing.", "Look after each other tonight.",
  "Follow the strongest line of research.", "Check every citation twice.",
];

// What an attentive god says (9 Nov: whispers are now judged against the nation's situation, so a god
// who pays attention whispers about what's actually happening; a careless one says something generic).
function situational(S, C, c, rand) {
  const st = S.clans[c.id], name = (id) => C.clans.find((x) => x.id === id)?.name ?? `nation ${id}`;
  const war = Object.values(S.wars || {}).find((w) => w.status === "on" && (w.a === c.id || w.b === c.id));
  const lines = [];
  if (war) {
    const foe = war.a === c.id ? war.b : war.a, mine = Object.keys(st.owned || {}).length, theirs = Object.keys(S.clans[foe]?.owned || {}).length;
    lines.push(mine < theirs ? `${name(foe)} is stronger than us. Hold the walls and offer peace before the war burns everything we know.` : `Press ${name(foe)} while the war goes our way, but don't burn our florins doing it.`);
  }
  if (st.mood === "hungry") lines.push("I know you're hungry. Feed the scholars first and the rest will follow.");
  if ((st.tricksters || 0) > 0) lines.push("There's a Trickster among you. Check every citation twice.");
  const front = Object.keys(st.frontier || {});
  if (front.length && lines.length < 2) lines.push(`Study ${front[Math.floor(rand() * Math.min(5, front.length))]} next. It leads somewhere.`);
  return lines.slice(0, 2).join(" ") || WHISPERS[Math.floor(rand() * WHISPERS.length)];
}

// A seeded random (mulberry32) so a run can be redone.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
}

/** The mode a god moves to, given the nation's standing now (pure; tested). */
export function nextMode(mode, standing, off = 0) {
  const up = GODS.faithfulAt + off, low = GODS.rescueBelow + off;
  if (mode == null) return standing >= up ? "faithful" : standing < low ? "rescue" : "away";
  if (mode === "faithful") return standing < up ? (standing < low ? "rescue" : "away") : "faithful";
  if (mode === "away") return standing < low ? "rescue" : standing >= up ? "faithful" : "away";
  return standing >= up ? "faithful" : "rescue"; // rescue: keep coming until it's back above the line
}
export const visits = (mode) => mode === "faithful" || mode === "rescue";

/** One step between engine turns. dir = the sim folder; now = the sim clock (ms). Returns what the gods did. */
export function godsTurn(dir, now, rand) {
  const C = JSON.parse(fs.readFileSync(`${dir}/chain.json`, "utf8"));
  const S = JSON.parse(fs.readFileSync(`${dir}/state/testnet.json`, "utf8"));
  C.simGods ||= {}; C.daos ||= {};
  const out = [];
  for (const c of C.clans) {
    const st = S.clans[c.id], rv = S.rev?.[c.id];
    if (!c.alive || !st || st.fallen || !rv) continue;
    const standing = rv.followed ? rv.gods[rv.followed]?.r ?? 0 : 0;
    for (const g of c.gods) {
      const key = `${c.id}:${g.account}`;
      const me = (C.simGods[key] ||= { off: Math.round((rand() * 2 - 1) * GODS.jitter * 10) / 10, mode: null, nextAt: now + rand() * GODS.dayMs });
      me.att ??= Math.round((0.2 + rand() * 0.7) * 100) / 100; // how closely this god watches its nation
      const was = me.mode;
      me.mode = nextMode(me.mode, standing, me.off);
      if (was && was !== me.mode) out.push({ clan: c.id, god: g.account.slice(0, 8), change: `${was} -> ${me.mode}`, standing: +standing.toFixed(1) });
      if (now < me.nextAt) continue;
      // The next visit: some random hour of the following day.
      me.nextAt = Math.floor(now / GODS.dayMs) * GODS.dayMs + GODS.dayMs + rand() * GODS.dayMs;
      if (!visits(me.mode)) continue;
      const dao = (C.daos[c.dao] ||= []);
      const propose = (method, args) => dao.push({ id: dao.length, proposer: g.account, status: "Approved", description: `${method} (simulated god)`,
        kind: { FunctionCall: { receiver_id: "sim.local", actions: [{ method_name: method, args: b64(args), deposit: "0", gas: "30000000000000" }] } } });
      // 1. Whisper, while this god has whispers left (GODS.whisperCap for the whole run).
      let whispered = false;
      if ((me.whispers ?? 0) < GODS.whisperCap) {
        const text = rand() < me.att ? situational(S, C, c, rand) : WHISPERS[Math.floor(rand() * WHISPERS.length)];
        propose("whisper", { clan_id: c.id, text });
        c.whisper = text;
        me.whispers = (me.whispers ?? 0) + 1;
        whispered = true;
      }
      // 2. Bless a little: put_in up; 86% backs new florins at today's value (the god's shares), 14% jackpot.
      const near = GODS.blessMin + rand() * (GODS.blessMax - GODS.blessMin);
      const y = BigInt(Math.round(near * 1e6)) * (YOCTO / 1_000_000n);
      const back = (y * 86n) / 100n, jack = y - back;
      const fl = BigInt(C.totals.florins), backing = BigInt(C.totals.backing);
      const newFl = backing > 0n ? (back * fl) / backing : 0n;
      g.put_in = (BigInt(g.put_in) + y).toString();
      g.shares = (BigInt(g.shares || 0) + newFl).toString();
      c.total_in = (BigInt(c.total_in) + y).toString();
      c.shares = (BigInt(c.shares || 0) + newFl).toString();
      C.totals.backing = (backing + back).toString();
      C.totals.jackpot = (BigInt(C.totals.jackpot) + jack).toString();
      C.totals.florins = (fl + newFl).toString();
      C.totals.balance = (BigInt(C.totals.balance) + y).toString();
      C.totals.liabilities = (BigInt(C.totals.liabilities) + y).toString();
      // 3. Rule the nation's pending gifts: reward what the Warden passed (one god rules each).
      const ruled = [];
      for (const gift of Object.values(C.gifts)) {
        if (gift.clan !== c.id || gift.status !== "Pending" || !gift.warden_passed) continue;
        gift.status = "Rewarded";
        propose("rule", { gift_id: gift.id, reward: true });
        ruled.push(gift.id);
      }
      out.push({ clan: c.id, god: g.account.slice(0, 8), mode: me.mode, standing: +standing.toFixed(1), whispered, whispers: me.whispers ?? 0, blessed: +near.toFixed(3), ruled: ruled.length });
    }
  }
  fs.writeFileSync(`${dir}/chain.json`, JSON.stringify(C));
  return out;
}
