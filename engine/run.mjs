// The world tick. One call = N game days. Usage (from adfontes/):
//   node engine/run.mjs testnet --days 2
// Each day: tick the contract, read the weather, then for every live clan: spawn its team if
// new, Patron picks a point, Scholars research (or the Broker buys from a clan that has it),
// the Smith makes kits, the Drafter drafts when the chain is deep enough, the Warden checks
// everything, gifts go on chain, upkeep is charged; then the day's root goes on chain.
import fs from "node:fs";
import { CFG } from "./config.mjs";
import { connect, toNear } from "./chain.mjs";
import { weather } from "./weather.mjs";
import { papersFor } from "./papers.mjs";
import { scholarTurn, draftTurn, meter } from "./llm.mjs";
import { newName } from "./names.mjs";
import * as W from "./world.mjs";
import * as store from "./store.mjs";
import { renderFigure } from "./figures.mjs";

const net = process.argv[2] || "testnet";
if (net === "mainnet" && !process.argv.includes("--yes-mainnet")) throw new Error("mainnet needs --yes-mainnet");
const days = Number(process.argv[process.argv.indexOf("--days") + 1] || 1);
const chain = connect(net);
const s = await store.loadState(net);
const chance = (p) => Math.random() < p;
const turns = (x) => Math.floor(x) + (chance(x - Math.floor(x)) ? 1 : 0); // 1.4 -> 1 or 2

for (let n = 0; n < days; n++) {
  const day = s.day + 1;
  const w = weather(day);
  const rec = []; // the day's records -> Merkle root on chain
  const log = (r) => { rec.push({ day, ...r }); console.log(`  [${r.kind}]`, JSON.stringify(r).slice(0, 220)); };
  // Safe to re-run after a crash mid-day: only tick if the chain is behind.
  if ((await chain.config()).day < day) await chain.tick(day);
  console.log(`\nDAY ${day} | weather ${w.label} (NEAR ${w.price.toFixed(2)}, ${(w.change * 100).toFixed(1)}% wk of ${w.week}) pace x${w.pace.toFixed(2)} mistakes ${(w.mistake * 100).toFixed(0)}%`);
  log({ kind: "weather", week: w.week, price: w.price, change: w.change, pace: w.pace });

  const onchain = await chain.clans();
  const live = onchain.filter((c) => c.alive);
  const avgIn = live.reduce((a, c) => a + toNear(c.total_in), 0) / Math.max(1, live.length);

  // Dead clans: their mindmap becomes ruins, unowned.
  for (const c of onchain.filter((c) => !c.alive)) {
    const st = s.clans[c.id];
    if (st?.alive) {
      st.alive = false;
      for (const [k, v] of Object.entries(st.owned)) if (v.corpus) s.ruins[k] = { ...v, from: c.id };
      log({ kind: "ruins", clan: c.id, points: Object.keys(st.owned).length });
    }
  }

  for (const oc of live) {
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

      // Rich / neglected (SPEC §6) and Tricksters
      const putIn = toNear(oc.total_in);
      const rich = putIn > avgIn && live.length > 1;
      const neglected = putIn < avgIn / 4;
      const lazy = rich ? CFG.richLazy : neglected ? CFG.neglectSlow : 0;
      if (neglected && chance(CFG.neglectTrickster)) {
        const name = newName(new Set(Object.values(s.clans).flatMap((x) => Object.keys(x.skills))));
        await chain.spawn(oc.id, name, "Trickster");
        c.skills[name] = {};
        c.tricksters++;
        log({ kind: "trickster", clan: oc.id, name });
      }
      const effort = w.pace * (1 - lazy) * c.fortune;

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
      for (const sch of able("Scholar")) {
        const target = pickTarget(c);
        const skill = c.skills[sch.name]?.[target] || 0;
        for (let t = 0; t < turns(CFG.scholarTurnsPerDay * effort * (1 + skill)); t++) {
          const node = target && c.frontier[target] ? target : null;
          if (!node && c.owned[c.field].corpus) break;
          const topic = node || c.field;
          const parent = node ? c.frontier[node].parent : null;

          // Broker first: buy it from a clan that already has it (cheaper than research).
          // Anchor every search to the clan's field so the line of knowledge doesn't drift off it.
          const papers = await papersFor(topic === c.field ? topic : `${c.field} ${topic}`, 10);
          if (!papers.length) { delete c.frontier[topic]; break; }
          const corpus = await scholarTurn({ field: c.field, topic, parent, papers, temperament: c.mbti, whisper: oc.whisper });
          // A Trickster in the clan slips a made-up citation in.
          if (c.tricksters && chance(0.5)) corpus.findings[0]?.cites.push("W" + Math.floor(Math.random() * 1e10));
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
      if (able("Smith").length && chance(0.3 * effort)) {
        const id = `t${s.nextId++}`;
        s.tools[id] = { id, clan: oc.id, day, kind: "figure kit", field: c.field };
        log({ kind: "tool", clan: oc.id, tool: id });
      }

      // Drafter
      const depth = W.chainDepth(c);
      if (able("Drafter").length && depth >= CFG.draftMinDepth && day - c.lastDraftDay >= CFG.draftEveryDays && chance(Math.min(1, effort))) {
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
        const rushRate = (w.mistake + c.tricksters * CFG.tricksterMistake) * (c.hasKit ? 0.5 : 1);
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
      if (day - c.lastUpkeepDay >= CFG.upkeepEveryDays) {
        const n = agents.filter((a) => a.alive).length;
        const amount = +(CFG.upkeepPerAgent * n * (day - c.lastUpkeepDay)).toFixed(6);
        const r = await chain.upkeep(oc.id, amount);
        c.lastUpkeepDay = day;
        log({ kind: "upkeep", clan: oc.id, agents: n, amount, paid: toNear(r.value), tx: r.hash });
      }
    } catch (e) {
      log({ kind: "error", clan: oc.id, error: String(e.message || e).slice(0, 200) });
    }
  }

  // Gods' rulings -> fortune
  for (const [gid, g] of Object.entries(s.gifts)) {
    if (g.applied) continue;
    const st = await chain.gift(Number(gid));
    const c = s.clans[g.clan];
    if (!st || !c) continue;
    if (st.status === "Rewarded") c.fortune = Math.min(CFG.fortuneMax, c.fortune * CFG.fortuneReward);
    else if (st.status === "Punished") c.fortune *= CFG.fortunePunish;
    else if (Date.now() - g.at > 24 * 3600e3) c.fortune *= CFG.fortuneUnruled;
    else continue;
    g.applied = true;
    log({ kind: "ruling", gift: gid, clan: g.clan, status: st.status, fortune: +c.fortune.toFixed(3) });
  }

  // Fees, root, save
  if (day % CFG.sweepEveryDays === 0) {
    const r = await chain.sweep();
    log({ kind: "sweep", tx: r.hash });
  }
  const root = W.merkleRoot(rec);
  const rr = await chain.setRoot(day, root);
  await store.saveDay(net, day, rec, root, rr.hash);
  s.roots[day] = root;
  s.day = day;
  await store.saveState(net, s);
  console.log(`  root ${root.slice(0, 16)}... on chain (${rr.hash}) | LLM so far: ${meter.calls} calls, $${meter.usd.toFixed(4)}`);
}

const t = await chain.totals();
console.log(`\nworld: balance ${toNear(t.balance)} owes ${toNear(t.liabilities)} storage ${toNear(t.storage_locked)} burned ${toNear(t.burned)} fees pending ${toNear(t.fees_pending)} paid ${toNear(t.fees_paid)}`);
for (const c of await chain.clans()) {
  const st = s.clans[c.id];
  console.log(`clan ${c.id} ${c.name} (${st?.field}, ${st?.mbti}) play ${toNear(c.play)} reserve ${toNear(c.reserve)} | mindmap ${Object.keys(st?.owned || {}).length} points, depth ${st ? W.chainDepth(st) : 0}, frontier ${Object.keys(st?.frontier || {}).length} | clean gifts ${c.clean_gifts} | fortune ${st?.fortune.toFixed(2)}`);
}

function pickTarget(c) { return W.pickTarget(c); }
await store.close();
