// The world tick. One call = N game days. Usage (from adfontes/):
//   node engine/run.mjs testnet --days 2
// Each day: tick the contract, read the weather, then for every live clan: spawn its team if
// new, Patron picks a point, Scholars research (or the Broker buys from a clan that has it),
// the Smith makes kits, the Drafter drafts when the chain is deep enough, the Warden checks
// everything, gifts go on chain, upkeep is charged; then the day's root goes on chain.
import { refill as refillPool, nationsLeft, SPONSOR } from "./sponsor.mjs";
import fs from "node:fs";
import { CFG } from "./config.mjs";
import { connect, toNear } from "./chain.mjs";
import { clockAt, extendHours, seasonStartNear } from "./clock.mjs";
import { papersFor } from "./papers.mjs";
import { scholarTurn, draftTurn, meter, setSpentToday, spentToday, canSpend } from "./llm.mjs";
import * as RV from "./reverence.mjs";
import { newName } from "./names.mjs";
import * as W from "./world.mjs";
import * as store from "./store.mjs";
import { renderFigure } from "./figures.mjs";

const net = process.argv[2] || "testnet";
if (net === "mainnet" && !process.argv.includes("--yes-mainnet")) throw new Error("mainnet needs --yes-mainnet");
const days = process.argv.includes("--days") ? Number(process.argv[process.argv.indexOf("--days") + 1]) || 1 : 1; // (without --days it used to read NaN and run nothing)
// Instant turns (SPEC §12n): `--instant 6[,7] [--fresh]` gives those nations one turn NOW without
// moving the world's day: citizens if they have none, what their gods just did, one research turn
// (and, for a nation in its first minutes, its first draft and first report). Records go to
// s.pending, which become the first records of the next day (proven with its root) and which the
// site shows live. Started by engine/loop.mjs; a normal day runs exactly as before.
const INSTANT = process.argv.includes("--instant") ? process.argv[process.argv.indexOf("--instant") + 1].split(",").map(Number) : null;
const FRESH = process.argv.includes("--fresh");
const chain = connect(net);
const s = await store.loadState(net);

// Only the schedule moves the world (see CFG.minMinutesBetweenRuns). --force skips this check.
const sinceLast = (Date.now() - (s.lastRunAt || 0)) / 60000;
// A new nation brings a new day at once (his call 7 Nov): a nation on chain the world hasn't seen yet
// skips the wait.
const unseen = (await chain.clans()).some((c) => c.alive && !s.clans[c.id]);
if (!INSTANT && !process.argv.includes("--force") && !unseen && !s.inProgress && sinceLast < CFG.minMinutesBetweenRuns) {
  console.log(`last run ${sinceLast.toFixed(0)} min ago (under ${CFG.minMinutesBetweenRuns}): nothing to do, the schedule runs the next day`);
  await store.close();
  process.exit(0);
}
// Testnet sponsor pool (SPEC §12m C): every 12 hours, fill it from NEAR's testnet helper (10 new
// accounts of 10 testnet NEAR, each swept straight into the pool). A failed refill never stops a day.
if (!INSTANT && net === "testnet" && process.env.SPONSOR_ACCOUNT_ID && Date.now() - (s.sponsorRefillAt || 0) > SPONSOR.refillHours * 3600e3) {
  try {
    const r = await refillPool(process.env.SPONSOR_ACCOUNT_ID);
    // Refused (the helper's 12-hour limit)? Try again right when its limit resets.
    s.sponsorRefillAt = r.made === 0 && r.limitReset ? r.limitReset * 1000 - SPONSOR.refillHours * 3600e3 : Date.now();
    console.log(`  sponsor pool: +${r.made} helper accounts swept in; ${await nationsLeft(process.env.SPONSOR_ACCOUNT_ID)} new testnet nations can be sponsored`);
  } catch (e) { console.log("  sponsor pool refill failed:", String(e.message || e).slice(0, 160)); }
}
// Today's Claude spend so far (UTC day), carried between runs so the cap covers the whole day.
const today = new Date().toISOString().slice(0, 10);
if (s.spend?.date !== today) s.spend = { date: today, usd: 0 };
const spendBase = s.spend.usd;
setSpentToday(spendBase);
let capNoted = false;
const chance = (p) => Math.random() < p;
const turns = (x) => Math.floor(x) + (chance(x - Math.floor(x)) ? 1 : 0); // 1.4 -> 1 or 2

// A redeploy or restart sends SIGTERM: finish the nation in hand, checkpoint, exit. The next run
// resumes the same day (s.inProgress) instead of redoing nations that already had their turn.
let stopRequested = false;
process.on("SIGTERM", () => { stopRequested = true; console.log("  stop requested: will checkpoint after this nation"); });

for (let n = 0; n < days; n++) {
  const day = s.day + 1;
  // The world clock (SPEC §14): NEAR's hourly prices replayed 5x; a rise is day, a fall is night.
  s.clock ||= { startNear: seasonStartNear(), rows: [] };
  try { await extendHours(s.clock, s.clock.startNear); } catch (e) { console.log("  price feed:", String(e.message || e).slice(0, 120)); }
  const k = clockAt(s.clock.rows, Date.now()) || { phase: "day", price: null, unit: 1, days: 1, nights: 0, cycle: 1, change: 0, nearTime: s.clock.startNear };
  const w = { phase: k.phase, price: k.price, pace: 1, mistake: CFG.baseMistake };
  // Resuming a day that was cut short? Keep its records so far and skip nations already done.
  const resuming = !INSTANT && s.inProgress?.day === day;
  // A new day starts with the instant turns' records since the last day (they belong to it).
  const rec = INSTANT ? (s.pending ||= []) : resuming ? (await store.getDay(net, day)).records : (s.pending || []); // the day's records -> Merkle root on chain
  if (!INSTANT) s.pending = [];
  if (!INSTANT && !resuming) { s.inProgress = { day, done: [] }; s.lastRunAt = Date.now(); }
  let seq = 0;
  const log = (r) => { rec.push({ day, ...r, ...(INSTANT ? { live: `${Date.now().toString(36)}-${seq++}`, at: Date.now() } : {}) }); console.log(`  [${r.kind}]`, JSON.stringify(r).slice(0, 220)); };
  const checkpoint = async () => { s.spend.usd = spendBase + meter.usd; if (!INSTANT) await store.saveDay(net, day, rec, null, null); await store.saveState(net, s); };
  // Cap reached: say so once a day; turns that need Claude are skipped, everything else goes on.
  const capped = (kind) => {
    if (canSpend(kind)) return false;
    if (!capNoted) { capNoted = true; log({ kind: "budget", cap: CFG.dailyCapUsd, spent: +spentToday().toFixed(4), note: "daily Claude cap reached: research and drafts wait for tomorrow (UTC)" }); }
    return true;
  };
  if (resuming) console.log(`  resuming day ${day}: ${rec.length} records kept, nations done: ${s.inProgress.done.join(",") || "none"}`);
  // Safe to re-run after a crash mid-day: only tick if the chain is behind.
  if (!INSTANT && (await chain.config()).day < day) await chain.tick(day);
  console.log(`\nDAY ${day} | ${k.phase} ${k.unit} (cycle ${k.cycle}; NEAR $${k.price ?? "?"} at ${new Date(k.nearTime).toISOString().slice(0, 13)}h)`);
  if (!resuming && !INSTANT) {
    // Days and nights that began since the last turn (a short one can begin and end in between).
    const begun = k.days + k.nights - (s.clock.lastCount ?? k.days + k.nights);
    if (begun > 0) log({ kind: k.phase === "day" ? "dawn" : "dusk", days: k.days, nights: k.nights, cycle: k.cycle, price: k.price, begun });
    s.clock.lastCount = k.days + k.nights;
    log({ kind: "clock", phase: k.phase, unit: k.unit, days: k.days, nights: k.nights, cycle: k.cycle, price: k.price, change: k.change, near: new Date(k.nearTime).toISOString() });
  }

  const onchain = await chain.clans();
  const alive = onchain.filter((c) => c.alive);
  const live = INSTANT ? alive.filter((c) => INSTANT.includes(c.id)) : alive;
  const avgIn = alive.reduce((a, c) => a + toNear(c.total_in), 0) / Math.max(1, alive.length);

  // Dead clans: their mindmap becomes ruins, unowned.
  for (const c of INSTANT ? [] : onchain.filter((c) => !c.alive)) {
    const st = s.clans[c.id];
    if (st?.alive) {
      st.alive = false;
      for (const [k, v] of Object.entries(st.owned)) if (v.corpus) s.ruins[k] = { ...v, from: c.id };
      log({ kind: "ruins", clan: c.id, points: Object.keys(st.owned).length });
    }
  }

  for (const oc of live) {
    if (!INSTANT && s.inProgress.done.includes(oc.id)) continue;
    const isNew = !s.clans[oc.id];
    const c = s.clans[oc.id] || W.initClan(s, oc);
    // A nation state seen for the first time: the 3D world plays its founding.
    if (isNew) log({ kind: "founded", clan: oc.id, name: oc.name, field: c.field, gods: oc.gods.length });
    try {
      // Team
      // Top the clan up to the full starting team (only on first sight; the dead stay dead).
      let agents = await chain.agents(oc.id);
      if (!c.teamDone) {
        const taken = new Set(Object.values(s.clans).flatMap((x) => Object.keys(x.skills)));
        for (const a of agents) taken.add(a.name);
        const have = {};
        for (const a of agents) if (a.alive) have[a.role] = (have[a.role] || 0) + 1;
        for (const role of CFG.team) {
          if (have[role] > 0) { have[role]--; continue; }
          const name = newName(taken);
          taken.add(name);
          await chain.spawn(oc.id, name, role);
          c.skills[name] = {};
        }
        for (const a of agents) c.skills[a.name] ||= {};
        c.teamDone = true;
        agents = await chain.agents(oc.id);
        log({ kind: "team", clan: oc.id, agents: agents.map((a) => `${a.name} (${a.role})`) });
      }
      const able = (role) => agents.filter((a) => a.role === role && a.alive && a.stunted_until <= day);

      // Reverence (SPEC §12m): read what the gods did since last time, then let it shape today.
      // A reverence bug must never cost the nation its day: on any error it falls back to the old
      // rules (the on-chain whisper, no modifiers) and the error is logged.
      let rv = null, eff = { waiting: false, whisper: oc.whisper, effortMul: 1, mistakeAdd: 0, tricksterMul: 1 };
      const revCh = [];
      try {
        rv = RV.ensure(s, oc, day, { fresh: isNew });
        for (const r of await RV.godActions({ chain, s, oc, rv, day, changes: revCh })) log(r);
        RV.follow(s, oc.id, revCh);
        const fol = rv.followed && rv.gods[rv.followed];
        if (fol?.outsider) fol.text = Object.values(s.rev).find((o) => o !== rv && o.followed === rv.followed)?.gods[rv.followed]?.text ?? fol.text;
        eff = RV.effects(rv);
        if (eff.waiting) log({ kind: "waiting", clan: oc.id, note: "the citizens wait in the plaza for their god's first whisper" });
      } catch (e) { rv = null; log({ kind: "error", clan: oc.id, error: `reverence: ${String(e.message || e).slice(0, 180)}` }); }

      // Rich / neglected (SPEC §6) and Tricksters
      const putIn = toNear(oc.total_in);
      const rich = putIn > avgIn && alive.length > 1;
      const neglected = putIn < avgIn / 4;
      const lazy = rich ? CFG.richLazy : neglected ? CFG.neglectSlow : 0;
      // No Trickster in a nation's first real day: a new god's first research mustn't be sabotaged.
      const settled = day - (c.bornDay ?? -99) >= 12;
      if (!INSTANT && settled && neglected && chance(CFG.neglectTrickster * eff.tricksterMul)) {
        const name = newName(new Set(Object.values(s.clans).flatMap((x) => Object.keys(x.skills))));
        await chain.spawn(oc.id, name, "Trickster");
        c.skills[name] = {};
        c.tricksters++;
        log({ kind: "trickster", clan: oc.id, name });
      }
      const effort = w.pace * (1 - lazy) * c.fortune * eff.effortMul;

      const before = new Set(Object.keys(c.owned));

      // Broker: once a day, buy a corpus from another clan whose papers are tagged with one of
      // this clan's open points (OpenAlex keyword tags = the papers are really about it).
      if (able("Broker").length && chance(Math.min(1, effort))) {
        let deal = null;
        for (const point of Object.keys(c.frontier)) {
          for (const o of Object.values(s.clans)) {
            if (!o.alive || o.id === oc.id) continue;
            for (const [k, v] of Object.entries(o.owned)) {
              const sc = s.corpora[v.corpus];
              // Never sell a clan its own work, or a corpus it already holds.
              const mine = sc && (sc.clan === oc.id || Object.values(c.owned).some((x) => x.corpus === sc.id));
              if (sc?.clean && !mine && (k === point || sc.children.includes(point))) { deal = { point, seller: o.id, sellerPoint: k, sc }; break; }
            }
            if (deal) break;
          }
          if (deal) break;
        }
        if (deal) {
          const holders = Object.values(s.clans).filter((o) => Object.values(o.owned).some((v) => s.corpora[v.corpus]?.children.includes(deal.point))).length;
          const depth = c.frontier[deal.point].depth;
          const price = +(CFG.corpusBasePrice * (1 + depth) * (live.length / (1 + holders))).toFixed(4);
          if (toNear(oc.play) > price) {
            const r = await chain.trade(oc.id, deal.seller, price, `corpus:${deal.sc.id}`);
            c.owned[deal.point] = { depth, parent: c.frontier[deal.point].parent, corpus: deal.sc.id, how: `bought from clan ${deal.seller}` };
            delete c.frontier[deal.point];
            W.grow(c, deal.point, deal.sc.children);
            log({ kind: "trade", buyer: oc.id, seller: deal.seller, point: deal.point, corpus: deal.sc.id, about: deal.sellerPoint, price, tx: r.hash });
          }
        }
      }

      // Research: each able Scholar takes its turns on the Patron's chosen point.
      // An instant turn: one research turn by one Scholar (in turn), not the day's full share.
      const scholars = eff.waiting ? [] : able("Scholar");
      const instantScholar = INSTANT ? scholars[(c.instantTurns = (c.instantTurns || 0) + 1) % Math.max(1, scholars.length)] : null;
      for (const sch of scholars) {
        if (INSTANT && sch !== instantScholar) continue;
        const target = pickTarget(c);
        const skill = c.skills[sch.name]?.[target] || 0;
        for (let t = 0; t < (INSTANT ? 1 : turns(CFG.scholarTurnsPerDay * effort * (1 + skill) * (w.phase === "night" ? CFG.nightPace : 1))); t++) {
          if (capped("agent")) break;
          const node = target && c.frontier[target] ? target : null;
          if (!node && c.owned[c.field].corpus) break;
          const topic = node || c.field;
          const parent = node ? c.frontier[node].parent : null;

          // Broker first: buy it from a clan that already has it (cheaper than research).
          // Anchor every search to the clan's field so the line of knowledge doesn't drift off it.
          const papers = await papersFor(topic === c.field ? topic : `${c.field} ${topic}`, 10);
          if (!papers.length) { delete c.frontier[topic]; break; }
          const corpus = await scholarTurn({ field: c.field, topic, parent, papers, temperament: c.mbti, whisper: eff.whisper });
          // A Trickster in the clan slips a made-up citation in.
          // Only a living, unstunted Trickster does it: stunting or killing it stops the fakes.
          const tricksters = agents.filter((a) => a.role === "Trickster" && a.alive && a.stunted_until <= day).length;
          if (tricksters && chance(0.5)) corpus.findings[0]?.cites.push("W" + Math.floor(Math.random() * 1e10));
          const check = W.wardenCorpus(corpus, papers.map((p) => p.id));
          const id = `c${s.nextId++}`;
          const children = [...new Set(papers.flatMap((p) => p.keywords))].slice(0, 12);
          s.corpora[id] = { id, clan: oc.id, scholar: sch.name, node: topic, day, title: corpus.title, findings: corpus.findings, gaps: corpus.open_gaps, papers: papers.map((p) => p.id), children, ...check };
          log({ kind: "corpus", clan: oc.id, scholar: sch.name, point: topic, title: corpus.title, cites: check.cites, fake: check.fake.length, hash: W.sha256(JSON.stringify(s.corpora[id])) });
          if (check.clean) {
            const depth = node ? c.frontier[node].depth : 0;
            c.owned[topic] = { depth, parent, corpus: id, how: "researched" };
            delete c.frontier[topic];
            W.grow(c, topic, children);
            W.learn(c, sch.name, topic);
          } else {
            const r = await chain.bounty(oc.id, CFG.wardenBounty, `fake citation in ${id}`);
            log({ kind: "warden", clan: oc.id, catch: id, fake: check.fake, bounty: CFG.wardenBounty, tx: r.hash });
          }
        }
      }

      // Ruins: points gained today may unlock a dead clan's knowledge (and what grew from it).
      const gained = Object.keys(c.owned).filter((k) => !before.has(k));
      const taken = W.absorbRuins(s, c, gained);
      if (taken.length) log({ kind: "absorb", clan: oc.id, via: gained, points: taken });

      // Smith: a figure kit now and then; clans about to draft buy one from another clan.
      if (!INSTANT && able("Smith").length && chance(0.3 * effort)) {
        const id = `t${s.nextId++}`;
        s.tools[id] = { id, clan: oc.id, day, kind: "figure kit", field: c.field };
        log({ kind: "tool", clan: oc.id, tool: id });
      }

      // Drafter
      const depth = W.chainDepth(c);
      // A new nation's first draft comes as soon as its line is deep enough (its first gift to rule on).
      const draftDue = INSTANT ? FRESH && !c.firstDraftDone : day - c.lastDraftDay >= CFG.draftEveryDays && chance(Math.min(1, effort));
      if (!eff.waiting && able("Drafter").length && depth >= CFG.draftMinDepth && draftDue && !capped("draft")) {
        c.firstDraftDone = true;
        if (!c.hasKit) {
          const kit = Object.values(s.tools).find((t) => t.clan !== oc.id && s.clans[t.clan]?.alive);
          if (kit && toNear(oc.play) > CFG.toolPrice) {
            const r = await chain.trade(oc.id, kit.clan, CFG.toolPrice, `tool:${kit.id}`);
            c.hasKit = true;
            log({ kind: "trade", buyer: oc.id, seller: kit.clan, tool: kit.id, price: CFG.toolPrice, tx: r.hash });
          }
        }
        const nodes = W.deepestChain(c).filter((k) => c.owned[k].corpus);
        const chainC = nodes.map((k) => ({ ...s.corpora[c.owned[k].corpus], node: k }) /* the clan's own point name wins (bought corpora carry the seller's) */);
        const draft = await draftTurn({ field: c.field, chain: chainC, gaps: chainC.at(-1).gaps.slice(0, 4) });
        // The figure kit draws each described figure in patent style.
        for (const f of draft.figures) f.svg = renderFigure(f);
        // Rushing in hot weather (halved with a figure kit): one claim leans on something outside the chain.
        const activeTricksters = agents.filter((a) => a.role === "Trickster" && a.alive && a.stunted_until <= day).length;
        const rushRate = (w.mistake + eff.mistakeAdd + activeTricksters * CFG.tricksterMistake) * (c.hasKit ? 0.5 : 1);
        const rushed = chance(rushRate);
        if (rushed && draft.claims[0]) draft.claims[0].supported_by.push("an unrelated preprint");
        const check = W.wardenDraft(draft, nodes);
        const id = `d${s.nextId++}`;
        const hash = W.sha256(JSON.stringify(draft));
        s.drafts[id] = { id, clan: oc.id, day, hash, draft, chain: nodes, rushed, ...check };
        await store.saveDraft(net, s.drafts[id]);
        // Top contributor = the clan whose corpora make up most of the chain.
        const by = {};
        for (const k of nodes) { const a = s.corpora[c.owned[k].corpus]?.clan; if (a) by[a] = (by[a] || 0) + 1; }
        const top = Number(Object.entries(by).sort((a, b) => b[1] - a[1])[0]?.[0] || oc.id);
        const r = await chain.giftDraft(oc.id, hash, check.passed, top);
        s.gifts[r.value] = { clan: oc.id, draft: id, day, at: Date.now(), applied: false };
        c.lastDraftDay = day;
        log({ kind: "gift", clan: oc.id, draft: id, title: draft.title, passed: check.passed, problems: check.problems, top_contributor: top, gift: r.value, tx: r.hash });
      }

      // Upkeep in batches
      if (!INSTANT && day - c.lastUpkeepDay >= CFG.upkeepEveryDays) {
        const n = agents.filter((a) => a.alive).length;
        const amount = +(CFG.upkeepPerAgent * n * (day - c.lastUpkeepDay)).toFixed(6);
        const r = await chain.upkeep(oc.id, amount);
        c.lastUpkeepDay = day;
        log({ kind: "upkeep", clan: oc.id, agents: n, amount, paid: toNear(r.value), tx: r.hash });
      }
      // Reverence at the end of the turn: how the nation did, the fade, reports, who they follow.
      if (rv) try {
      const mine = rec.filter((r) => r.clan === oc.id || r.buyer === oc.id);
      const cleanCorpora = mine.filter((r) => r.kind === "corpus" && !r.fake).length;
      const gifts = mine.filter((r) => r.kind === "gift");
      const catches = mine.filter((r) => r.kind === "warden").length;
      RV.flourish(rv, cleanCorpora + gifts.filter((g) => g.passed).length * 3 - catches);
      for (const g of gifts) if (g.passed) RV.nationEvent(rv, "cleanGift", revCh);
      for (let k = 0; k < catches; k++) RV.nationEvent(rv, "wardenCatch", revCh);
      const nowAgents = await chain.agents(oc.id);
      const living = nowAgents.filter((a) => a.alive);
      if (!INSTANT) RV.fade(rv, day, new Set(living.map((a) => a.name)), revCh); // the fade is per day
      if (!INSTANT) for (const r of RV.lapseReports(s, rv, oc.id, day, revCh)) log(r);
      const evidence = [
        ...mine.filter((r) => r.kind === "corpus" && r.fake).map((r) => ({ kind: "fake", name: r.scholar })),
        ...living.filter((a) => a.role === "Trickster").map((a) => ({ kind: "trickster", name: a.name })),
        ...(gifts.some((g) => !g.passed) ? able("Drafter").slice(0, 1).map((a) => ({ kind: "rushed", name: a.name })) : []),
      ];
      // A new nation gets its first report as soon as it has research to argue about.
      const firstReport = INSTANT && FRESH && !Object.values(s.reports || {}).some((x) => x.clan === oc.id) && Object.values(s.corpora).some((x) => x.clan === oc.id);
      const rep = RV.maybeReport(s, oc.id, day, living, evidence, firstReport ? () => 0 : Math.random);
      if (rep) log(rep);
      RV.follow(s, oc.id, revCh);
      log(RV.record(rv, oc.id, revCh));
      } catch (e) { log({ kind: "error", clan: oc.id, error: `reverence: ${String(e.message || e).slice(0, 180)}` }); }
    } catch (e) {
      log({ kind: "error", clan: oc.id, error: String(e.message || e).slice(0, 200) });
    }
    if (!INSTANT) s.inProgress.done.push(oc.id);
    await checkpoint();
    if (stopRequested) { console.log("  checkpointed; exiting so the next run resumes this day"); await store.close(); process.exit(0); }
  }

  // An instant turn ends here: no rulings sweep, fees, root or new day (the next day does those).
  if (INSTANT) {
    s.spend.usd = spendBase + meter.usd;
    await store.saveState(net, s);
    console.log(`  instant turn for ${INSTANT.join(",")} done: ${rec.length} pending records | LLM this run: ${meter.calls} calls, $${meter.usd.toFixed(4)}`);
    break;
  }

  // Gods' rulings -> fortune
  for (const [gid, g] of Object.entries(s.gifts)) {
    if (g.applied) continue;
    const st = await chain.gift(Number(gid));
    const c = s.clans[g.clan];
    if (!st || !c) continue;
    if (st.status === "Rewarded") c.fortune = Math.min(CFG.fortuneMax, c.fortune * CFG.fortuneReward);
    else if (st.status === "Punished") c.fortune *= CFG.fortunePunish;
    else if (st.status === "Claimed" || Date.now() - g.at > 24 * 3600e3) {
      c.fortune *= CFG.fortuneUnruled;
      // Reverence: the gift's own gods let it go unruled; a claimer from the top contributor gains.
      try {
        const ch = [], rvg = s.rev?.[g.clan];
        if (rvg) for (const god of Object.keys(rvg.gods)) if (!rvg.gods[god].outsider) RV.act(rvg, god, "unruled", day, ch);
        const rvc = st.status === "Claimed" && s.rev?.[st.top_contributor];
        if (rvc && rvc.gods[st.ruled_by]) RV.act(rvc, st.ruled_by, "claim", day, ch);
        if (ch.length) log({ kind: "reverence-change", clan: g.clan, gift: gid, changes: ch });
      } catch (e) { log({ kind: "error", clan: g.clan, error: `reverence: ${String(e.message || e).slice(0, 180)}` }); }
    } else continue;
    g.applied = true;
    log({ kind: "ruling", gift: gid, clan: g.clan, status: st.status, fortune: +c.fortune.toFixed(3) });
  }

  // Fees, root, save
  if (day % CFG.sweepEveryDays === 0) {
    const r = await chain.sweep();
    log({ kind: "sweep", tx: r.hash });
  }
  await checkpoint();
  const root = W.merkleRoot(rec);
  let rr;
  try {
    rr = await chain.setRoot(day, root);
  } catch (e) {
    // A run cut off right after set_root: the chain already holds this day's root.
    if (!String(e.message).includes("already has a root")) throw e;
    const onChain = await chain.getRoot(day);
    console.log(`  root for day ${day} was already on chain (${onChain === root ? "same" : "DIFFERENT: records changed after it was set"})`);
    rr = { hash: null };
  }
  await store.saveDay(net, day, rec, root, rr.hash);
  s.roots[day] = root;
  s.day = day;
  delete s.inProgress;
  await store.saveState(net, s);
  console.log(`  root ${root.slice(0, 16)}... on chain (${rr.hash}) | LLM this run: ${meter.calls} calls, $${meter.usd.toFixed(4)} | today (UTC): $${spentToday().toFixed(4)} of $${CFG.dailyCapUsd}`);
}

const t = await chain.totals();
console.log(`\nworld: balance ${toNear(t.balance)} owes ${toNear(t.liabilities)} storage ${toNear(t.storage_locked)} burned ${toNear(t.burned)} fees pending ${toNear(t.fees_pending)} paid ${toNear(t.fees_paid)}`);
for (const c of await chain.clans()) {
  const st = s.clans[c.id];
  console.log(`clan ${c.id} ${c.name} (${st?.field}, ${st?.mbti}) play ${toNear(c.play)} reserve ${toNear(c.reserve)} | mindmap ${Object.keys(st?.owned || {}).length} points, depth ${st ? W.chainDepth(st) : 0}, frontier ${Object.keys(st?.frontier || {}).length} | clean gifts ${c.clean_gifts} | fortune ${st?.fortune.toFixed(2)}`);
}

function pickTarget(c) { return W.pickTarget(c); }
await store.close();
