// Florin economy simulation (SPEC §14). `node scripts/sim-florin.mjs [runs]`
// 21 real days, five kinds of nation, event rates measured from the testnet world (4-7 Nov:
// an active nation made 12-16 clean corpora/real day, bought 7-9, tried ~1.3 drafts, ~half passed),
// with v2 rules on top: night halves research (about half the time is night), 1 draft a real day,
// needs (hungry -20% work, sated -40%). Money: 86% of every NEAR put in backs florins
// (100 florins per backing NEAR), 14% to the jackpot. A god's stake = florins x (backing / florins).

const RUNS = Number(process.argv[2]) || 400;
const DAYS = 21, CITIZENS = 7;
export const RATES = {
  corpus: 8, // florins minted per clean corpus
  draft: 40, // per passed draft, split across the nations whose corpora are in its chain
  tech: 40, // per tech unlocked
  pressSale: 1, // Printing Press: extra minted per corpus another nation buys from you
  salePrice: 4, // florins a corpus costs a buyer (old formula 0.01 NEAR x (1+depth) x scarcity, avg)
  upkeep: 6, // florins burned per citizen per real day (Mechanical Clock: -30%)
  fine: 5, // florins burned per fake the Warden catches
};
const KINDS = {
  // putIn: NEAR in; corpora/buys per real day before modifiers; draftTry: share of days a draft is tried; pass rate
  strong: { putIn: 6.5, corpora: 14, buys: 8, draftTry: 0.9, pass: 0.7, needs: "content", fakes: 0 },
  average: { putIn: 6.5, corpora: 8, buys: 5, draftTry: 0.6, pass: 0.55, needs: "content", fakes: 0.1 },
  rich: { putIn: 20, corpora: 14, buys: 8, draftTry: 0.9, pass: 0.7, needs: "sated", fakes: 0 },
  shared: { putIn: 9, corpora: 11, buys: 6, draftTry: 0.8, pass: 0.65, needs: "content", fakes: 0 }, // 3 gods x 3 NEAR
  neglected: { putIn: 6.5, corpora: 1.5, buys: 0.5, draftTry: 0, pass: 0, needs: "hungry", fakes: 0.9 },
};
const NEED = { content: 1, hungry: 0.8, sated: 0.6 };
const pick = (xs) => { let t = xs.reduce((a, o) => a + o.points, 0) * Math.random(); for (const o of xs) if ((t -= o.points) <= 0) return o; return xs.at(-1); };
const poisson = (l) => { let k = 0, p = Math.exp(-l), s = p, u = Math.random(); while (u > s) { k++; p *= l / k; s += p; } return k; };

function season(R, putScale = 1) {
  const N = Object.entries(KINDS).map(([kind, k0]) => {
    const k = { ...k0, putIn: k0.putIn * putScale }; // testnet: smaller starts
    const back = k.putIn * 0.86;
    return { kind, ...k, back, fl: back * 100, points: 1, techs: new Set(), drafts: 0 };
  });
  let backing = N.reduce((a, n) => a + n.back, 0);
  const jackpot = N.reduce((a, n) => a + n.putIn * 0.14, 0);
  for (let d = 0; d < DAYS; d++) {
    for (const n of N) {
      const work = NEED[n.needs] * 0.75; // night: half pace for half the time
      const spectacles = n.techs.has("spectacles") ? 1 / 0.75 : 1;
      const made = poisson(n.corpora * work * spectacles);
      n.points += made;
      n.fl += made * R.corpus;
      // Buys: pay the seller (a random other living nation that has research)
      for (let b = poisson(n.buys * work); b > 0; b--) {
        const sellers = N.filter((o) => o !== n && o.points > 3);
        if (!sellers.length || n.fl < R.salePrice) break;
        const s = pick(sellers); // the Broker buys from whoever holds the point: more research, more sales
        n.fl -= R.salePrice; s.fl += R.salePrice + (s.techs.has("press") ? R.pressSale : 0);
        n.points++;
      }
      // One draft a real day at most; a passed one mints, split (60% to this nation, 40% to sellers)
      if (Math.random() < n.draftTry * NEED[n.needs] && n.points >= 8 && Math.random() < n.pass) {
        n.drafts++;
        n.fl += R.draft * 0.6;
        const others = N.filter((o) => o !== n && o.points > 3);
        const tot = others.reduce((a, o) => a + o.points, 0);
        for (const o of others) o.fl += (R.draft * 0.4 * o.points) / tot; // by their research in the chain
      }
      // Fakes caught by the Warden
      for (let f = poisson(n.fakes); f > 0; f--) n.fl = Math.max(0, n.fl - R.fine);
      // Techs
      const unlock = (t, ok) => { if (ok && !n.techs.has(t)) { n.techs.add(t); n.fl += R.tech; } };
      unlock("press", n.points >= 6); unlock("spectacles", n.points >= 10); unlock("clock", n.points >= 12);
      unlock("bookkeeping", n.drafts >= 1); unlock("astrolabe", n.points >= 40);
      // Upkeep burns (raises every other florin's value)
      n.fl = Math.max(0, n.fl - CITIZENS * R.upkeep * (n.techs.has("clock") ? 0.7 : 1));
    }
  }
  const F = N.reduce((a, n) => a + n.fl, 0);
  return N.map((n) => ({ kind: n.kind, putIn: n.putIn, stake: (n.fl / F) * backing, techs: n.techs.size, drafts: n.drafts, jackpot }));
}

export function run(R = RATES, runs = RUNS, putScale = 1) {
  const acc = {};
  for (let i = 0; i < runs; i++) for (const r of season(R, putScale)) {
    const a = (acc[r.kind] ||= { putIn: r.putIn, stake: [], techs: 0, drafts: 0 });
    a.stake.push(r.stake); a.techs += r.techs / runs; a.drafts += r.drafts / runs;
  }
  return Object.entries(acc).map(([kind, a]) => {
    a.stake.sort((x, y) => x - y);
    const med = a.stake[Math.floor(a.stake.length / 2)];
    return { kind, putIn: a.putIn, stakeMedian: +med.toFixed(2), vsPutIn: +(med / a.putIn).toFixed(2), p10: +a.stake[Math.floor(runs * 0.1)].toFixed(2), p90: +a.stake[Math.floor(runs * 0.9)].toFixed(2), techs: +a.techs.toFixed(1), drafts: +a.drafts.toFixed(1) };
  });
}

if (process.argv[1].endsWith("sim-florin.mjs")) {
  console.log("rates", JSON.stringify(RATES));
  console.table(run());
}
