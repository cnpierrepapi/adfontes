// Spike 5: does the world produce varied outcomes? A dice-rolling stand-in for the agents
// (no AI, $0) runs whole seasons many times and measures the spread.
// Mechanics under test: MBTI temperament genes, the knowledge tree, upkeep, god styles,
// the bull-run weather. Every number lives in CFG so it can be tuned and explained.
//
// usage: node spikes/05-sim.mjs [runs=1000] [variant=full|bare]
//   bare = no MBTI (all agents identical), no tree (any corpus is sellable), no upkeep.
import fs from "node:fs";

const RUNS = Number(process.argv[2] || 1000);
const VARIANT = process.argv[3] || "full";
const FULL = VARIANT === "full";

const CFG = {
  clans: 6,
  agentsPerClan: 7, // Patron, 2 Scholars, Smith, Drafter, Broker, Warden
  startTreasury: 10, // USDC per clan at genesis
  upkeep: FULL ? 0.05 : 0, // USDC per agent per day
  tiers: 5, // knowledge tree depth; a draft needs a tier >= 3 line
  draftTier: 3,
  mutate: 0.1, // chance each MBTI letter flips when an agent is born
  splitSize: 12, // a clan with this many agents and high fortune splits
  trickAfter: 5, // days without god attention before a Trickster appears
  reward: 3, punish: 2, // USDC a god adds per good gift / clan loses per bad one
  lazyFrom: 20, lazySpan: 50, // treasury where agents start waiting for orders, and how fast it bites
};

// Real weather: weekly BTC closes from Kraken, Oct 2023 onward; 1 world day = 1 week.
const ohlc = Object.values(JSON.parse(fs.readFileSync("spikes/out/btc-weekly-kraken.json", "utf8")).result)[0];
const closes = ohlc.map((r) => Number(r[4]));
const WEEKS = Math.min(110, closes.length - 1); // Oct 2023 to the Oct 2025 top
const weather = Array.from({ length: WEEKS }, (_, i) => closes[i + 1] / closes[i] - 1); // weekly change

let seed = 1;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];
const LETTERS = [["E", "I"], ["S", "N"], ["T", "F"], ["J", "P"]];
const randomType = () => LETTERS.map((p) => pick(p)).join("");
const inherit = (t) => (FULL ? [...t].map((c, i) => (rand() < CFG.mutate ? LETTERS[i].find((x) => x !== c) : c)).join("") : "ISTJ");
const GODS = ["absent", "balanced", "smothering", "harsh", "generous"];

function newClan(id, god, types) {
  return { id, god, alive: true, treasury: CFG.startTreasury, fortune: 1, idle: 0, tricksters: 0,
    agents: types.map((t) => ({ type: t })), tier: 0, owned: new Set([0]), drafts: 0, good: 0, splits: 0, born: 0 };
}

function runSeason() {
  const clans = Array.from({ length: CFG.clans }, (_, i) =>
    newClan(i, GODS[i % GODS.length], Array.from({ length: CFG.agentsPerClan }, () => (FULL ? randomType() : "ISTJ"))),
  );
  const holders = Array(CFG.tiers).fill(0); // how many clans own each tier (scarcity -> price)

  for (let d = 0; d < WEEKS; d++) {
    const w = weather[d];
    const hot = Math.max(-0.5, Math.min(1, w * 5)); // -0.5 cold .. +1 very hot
    const pace = 1 + hot * 0.6; // hot = more work done
    const sloppy = 0.08 + Math.max(0, hot) * 0.15; // hot = more mistakes

    for (const c of clans.filter((x) => x.alive)) {
      const n = c.agents.length;
      const share = (L) => c.agents.filter((a) => a.type.includes(L)).length / n;
      const I = FULL ? share("I") : 0.5, N = FULL ? share("N") : 0.5, J = FULL ? share("J") : 0.5, E = 1 - I;

      // God behaviour this day.
      const attend = { absent: 0.1, balanced: 0.6, smothering: 1, harsh: 0.6, generous: 0.8 }[c.god];
      if (rand() < attend) {
        c.idle = 0;
        if (c.god === "smothering") { c.treasury += 2; c.fortune *= 0.995; } // over-funding makes agents wait for orders
        if (c.god === "generous") c.treasury += 0.5;
      } else c.idle++;
      if (c.idle >= CFG.trickAfter && rand() < 0.3) c.tricksters++;

      // Too much money: agents wait for orders instead of working (0 at 20 USDC, up to 60% at 50+).
      const lazy = FULL ? Math.max(0, Math.min(0.6, (c.treasury - CFG.lazyFrom) / CFG.lazySpan)) : 0;

      // Research: climb the knowledge tree.
      const next = c.tier + 1;
      if (next < CFG.tiers) {
        const canClimb = !FULL || c.owned.has(c.tier);
        const effort = (1 - lazy) * pace * c.fortune * (0.15 + 0.25 * I + 0.1 * N) * (c.treasury > 0 ? 1 : 0.2);
        if (canClimb && rand() < effort * (0.5 + 0.5 * J)) {
          c.tier = next; c.owned.add(next); holders[next]++;
        }
      }

      // Arena: E-heavy clans sell corpora to clans that lack them; price rises with scarcity.
      for (const other of clans) {
        if (other === c || !other.alive) continue;
        if (rand() < 0.1 * E * pace) {
          const t = Math.max(...[...c.owned].filter((x) => !other.owned.has(x)), -1);
          if (t > 0 && other.treasury > 1) {
            const price = 0.4 * (1 + t) * (FULL ? CFG.clans / (1 + holders[t]) : 1);
            other.treasury -= price; c.treasury += price;
            other.owned.add(t); holders[t]++;
            if (FULL) other.tier = Math.max(other.tier, Math.min(t, other.tier + 1)); else other.tier = Math.max(other.tier, t);
          }
        }
      }

      // Drafting + the Warden + the god's ruling.
      if (c.tier >= CFG.draftTier && rand() < (1 - lazy) * 0.2 * pace * (0.5 + J)) {
        c.drafts++;
        const err = sloppy * (1 + (N - 0.5)) + c.tricksters * 0.05;
        const pass = rand() > err;
        const judgeFair = c.god !== "absent";
        if (pass) { c.good++; if (judgeFair) { c.treasury += CFG.reward * (c.god === "generous" ? 1.5 : 1); c.fortune = Math.min(2, c.fortune * 1.08); } }
        else if (c.god === "harsh" || c.god === "balanced") { c.treasury -= CFG.punish; c.fortune *= 0.9; c.tricksters = Math.max(0, c.tricksters - 1); }
        else c.fortune *= 0.97;
      }

      // Upkeep, tricksters stealing, growth, splits, death.
      c.treasury -= CFG.upkeep * n + c.tricksters * 0.05;
      if (c.treasury > 15 && rand() < 0.05 && n < 16) { c.agents.push({ type: inherit(pick(c.agents).type) }); c.born++; }
      if (FULL && n >= CFG.splitSize && c.fortune > 1.2 && rand() < 0.1) {
        const sorted = [...c.agents].sort((a, b) => (a.type < b.type ? -1 : 1));
        const half = sorted.splice(0, Math.floor(n / 2));
        c.agents = sorted; c.treasury /= 2; c.splits++;
        const child = newClan(clans.length, c.god, half.map((a) => a.type));
        child.treasury = c.treasury; child.tier = c.tier; child.owned = new Set(c.owned);
        clans.push(child);
      }
      if (c.treasury <= -2) c.alive = false;
    }
  }
  return clans;
}

// Run many seasons and measure.
const winsByGod = Object.fromEntries(GODS.map((g) => [g, 0]));
const winsBySlot = {};
const winnerTypes = {};
const spreads = [], deaths = [], splits = [], goods = [];
const endings = new Set();
for (let r = 0; r < RUNS; r++) {
  seed = r * 7919 + 13;
  const clans = runSeason();
  const score = (c) => c.good * 2 + c.tier; // the race is knowledge delivered, not money held
  const ranked = [...clans].sort((a, b) => score(b) - score(a));
  const win = ranked[0];
  winsByGod[win.god]++;
  winsBySlot[win.id] = (winsBySlot[win.id] || 0) + 1;
  const dom = (L) => (win.agents.filter((a) => a.type.includes(L[0])).length >= win.agents.length / 2 ? L[0] : L[1]);
  const wt = LETTERS.map(dom).join("");
  winnerTypes[wt] = (winnerTypes[wt] || 0) + 1;
  spreads.push(score(ranked[0]) - score(ranked[ranked.length - 1]));
  deaths.push(clans.filter((c) => !c.alive).length);
  splits.push(clans.length - CFG.clans);
  goods.push(clans.reduce((a, c) => a + c.good, 0));
  endings.add(`${win.god}|${wt}|${clans.length}|${clans.filter((c) => !c.alive).length}`);
}

const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length).toFixed(2); };
const topShare = (o) => (Math.max(...Object.values(o)) / RUNS * 100).toFixed(1) + "%";
console.log(`variant=${VARIANT} runs=${RUNS} weeks=${WEEKS} (BTC ${closes[0]} -> ${closes[WEEKS]})`);
console.log("wins by god style:", JSON.stringify(winsByGod));
console.log("most frequent winning clan slot:", topShare(winsBySlot), "| distinct winning slots:", Object.keys(winsBySlot).length);
console.log("distinct dominant MBTI types among winners:", Object.keys(winnerTypes).length, "| top type share:", topShare(winnerTypes));
console.log("distinct endings (god|type|clan count|deaths):", endings.size, "of", RUNS);
console.log(`score gap first-last: avg ${avg(spreads)} sd ${sd(spreads)} | deaths avg ${avg(deaths)} | splits avg ${avg(splits)} | clean drafts avg ${avg(goods)} sd ${sd(goods)}`);
