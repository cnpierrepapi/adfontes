// AI gods at work (12 Nov). planGods(): at the end of a scheduled turn, one Claude call plans the next two hours
// for every AI god (engine/llm.mjs godsPlan, the gods' own pot), the plan is checked (aigods.validatePlan) and
// spread over the two hours (aigods.schedule) into the ai_actions queue. runDue(): the always-on loop sends
// whatever is due, as that god, with the god panel's own calls; the loop's watch then gives the nation its
// instant turn, so each action lands in the world within seconds, a minute or so apart.
import * as A from "./aigods.mjs";
import * as C from "../src/live/calls.js";
import * as store from "./store.mjs";
import { godsPlan, canSpend } from "./llm.mjs";
import { CFG } from "./config.mjs";
import { NAMES } from "./godnames.mjs";

export const ALLOWANCE = 2; // NEAR an AI god may bless with in a UTC day (testnet NEAR from the sponsor pool)
const TEMPERAMENTS = ["devout", "stern", "generous", "patient", "fiery", "playful", "watchful", "proud"];
export const temperamentOf = (name) => TEMPERAMENTS[[...String(name)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % TEMPERAMENTS.length];
const yocto = (near) => BigInt(Math.round(near * 1e6)) * 10n ** 18n;
const dayStart = (now) => Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());

/** Each AI god's situation, from the engine's state and the chain's nations. */
export async function situations({ net, s, onchain, now = Date.now() }) {
  const gods = await store.aiGods(net);
  const out = [];
  for (const g of gods) {
    const clans = onchain.filter((c) => c.alive && (c.gods || []).some((x) => x.account === g.account));
    if (!clans.length) continue;
    const today = await store.aiActionsSince(net, g.account, dayStart(now));
    const blessed = today.filter((x) => x.action.kind === "bless" && !/^error/.test(x.result || "")).reduce((a, x) => a + (x.action.near || 0), 0);
    const nations = clans.map((c) => {
      const st = s.clans[c.id] || {}, rv = s.rev?.[c.id] || {};
      const war = Object.values(s.wars || {}).find((w) => w.status === "on" && (w.a === c.id || w.b === c.id));
      return {
        id: c.id, name: c.name, standing: Math.round((rv.followed ? rv.gods?.[rv.followed]?.r : 0) || 0), myReverence: Math.round(rv.gods?.[g.account]?.r || 0),
        tricksters: st.tricksters || 0, mood: st.mood || "content", florins: Number(BigInt(c.florins || 0) / 10n ** 16n) / 1e6,
        war: war ? onchain.find((x) => x.id === (war.a === c.id ? war.b : war.a))?.name ?? null : null,
        openGifts: Object.values(s.gifts || {}).filter((x) => x.clan === c.id && !x.applied).length,
        // Hunger (run.mjs): fed = grace blessed in the last 24 h / its daily need; hungry under half.
        // What its scholars are working on: the words a whisper can name (the citizens' judge listens for them).
        looking: Object.keys(st.frontier || {}).slice(0, 3),
        need: +(st.need || 0).toFixed(3), fed24h: +((st.blessings || []).filter((b) => now - b.at < 86400e3).reduce((a, b) => a + b.near, 0)).toFixed(3),
      };
    });
    const reports = {}, gifts = {};
    for (const c of clans) {
      reports[c.id] = Object.values(s.reports || {}).filter((r) => r.clan === c.id && !r.settled).map((r) => ({ id: r.id, accused: r.accused, claim: r.claim }));
      gifts[c.id] = Object.entries(s.gifts || {}).filter(([, x]) => x.clan === c.id && !x.applied).map(([id, x]) => ({ id: Number(id), warden_passed: s.drafts?.[x.draft]?.passed ?? true }));
    }
    out.push({ god: g.account, name: g.name, temperament: g.temperament || temperamentOf(g.name), allowance: Math.max(0, ALLOWANCE - blessed), clans: clans.map((c) => c.id), nations, reports, gifts, aogToday: today.filter((x) => x.action.kind === "fire").length, whispersToday: today.filter((x) => x.action.kind === "whisper" && !/^error/.test(x.result || "")).length });
  }
  return out;
}

/** The chain is the record (12 Nov): a seat held by <a god's name>.<operator> is an AI god. Registers any not yet
 *  known and fixes its name; returns the new ones. (The takeover runs from this PC, which can't reach the database.) */
export async function discoverAiGods({ net, chain, store: st = store }) {
  const known = new Set((await st.aiGods(net)).map((g) => g.account));
  const byAccount = new Map(NAMES.map((n) => [A.accountFor(n, chain.operator), n]));
  const found = [];
  for (const c of (await chain.clans()).filter((x) => x.alive)) for (const g of c.gods || []) {
    const name = byAccount.get(g.account);
    if (!name) continue;
    await st.claimGodName(g.account, name); // always: the site may have named the account first
    if (known.has(g.account)) continue;
    known.add(g.account);
    await st.addAiGod(net, g.account, name, temperamentOf(name));
    found.push({ account: g.account, name });
  }
  return found;
}

/** Plan the next span for every AI god and queue it. Quiet (no plan, no error) when the gods' pot is spent. */
export async function planGods({ net, s, onchain, chain = null, start = Date.now(), span = 2 * 3600e3, seed = String(start) }) {
  if (chain) await discoverAiGods({ net, chain });
  const sits = await situations({ net, s, onchain, now: start });
  if (!sits.length) return { gods: 0, actions: 0, why: "no AI gods" };
  if (!canSpend("god")) return { gods: sits.length, actions: 0, why: `the AI gods' $${CFG.godsCapUsd} for today is spent` };
  const plans = await godsPlan(sits, A.fakePlan);
  const all = [];
  for (const sit of sits) for (const a of A.withPassedGifts(A.validatePlan(plans[sit.god] || [], sit), sit)) all.push({ ...a, god: sit.god });
  const timed = A.schedule(all, start, span, seed);
  await store.queueAiActions(net, timed);
  return { gods: sits.length, actions: timed.length };
}

/** The calls one action sends (exactly the god panel's, src/live/calls.js). */
export async function callsFor(chain, a, clan) {
  const world = chain.world;
  if (a.kind === "bless") return [C.bless(world, a.clan, yocto(a.near))];
  const policy = await chain.dao(clan.dao, "get_policy");
  const bond = BigInt(policy.proposal_bond);
  const say = { whisper: `AD FONTES: whisper to ${clan.name}: "${a.text}"`, smite: `AD FONTES: ${a.verdict === "Kill" ? "kill" : "stunt"} ${a.agent} of ${clan.name}`, rule: `AD FONTES: reward gift #${a.gift}`, fire: `AD FONTES: an Act of God. ${clan.name}'s gods rain fire on nation ${a.target}` }[a.kind];
  const [method, args] = {
    whisper: ["whisper", { clan_id: a.clan, text: a.text }],
    smite: ["smite", { clan_id: a.clan, agent: a.agent, verdict: a.verdict }],
    rule: ["rule", { gift_id: a.gift, reward: true, verdict: null, agent: null }],
    fire: ["root_out", { clan_id: a.clan, point: `act of god: ${a.target}` }],
  }[a.kind];
  return C.daoPower(world, clan.dao, bond, method, args, say);
}

/** Send what's due (a few per call). A motion in a DAO with more gods gets the fellow AI gods' yes votes. */
export async function runDue({ net, chain, now = Date.now(), limit = 2, log = () => {} }) {
  const due = await store.dueAiActions(net, now, limit);
  if (!due.length) return [];
  const touched = [];
  const onchain = await chain.clans();
  const ai = new Set((await store.aiGods(net)).map((g) => g.account));
  for (const row of due) {
    // Claimed first: if the engine restarts mid-send, the action is never sent a second time.
    if (!(await store.claimAiAction(row.id))) continue;
    const a = { ...row.action, god: row.god };
    let result;
    try {
      const clan = onchain.find((c) => c.id === a.clan && c.alive);
      if (!clan || !(clan.gods || []).some((g) => g.account === row.god)) throw new Error("no longer its god");
      if (a.kind === "bless") await chain.aiTopUp(row.god, a.near + 0.15, ALLOWANCE + 0.5);
      else await chain.aiTopUp(row.god, 0.2, 0.6);
      const calls = await callsFor(chain, a, clan);
      const r = await chain.aiSend(row.god, calls);
      // Fellow AI gods vote the motion through (a council needs a majority).
      if (a.kind !== "bless" && r.proposal != null) {
        const proposal = await chain.dao(clan.dao, "get_proposal", { id: Number(r.proposal) }).catch(() => null);
        if (proposal?.status === "InProgress") {
          for (const g of clan.gods) {
            if (g.account === row.god || !ai.has(g.account)) continue;
            await chain.aiSend(g.account, [C.vote(clan.dao, proposal, "VoteApprove")]).catch((e) => log(`  vote by ${g.account}: ${String(e.message || e).slice(0, 100)}`));
          }
        }
      }
      result = `ok ${r.hash}`;
    } catch (e) { result = `error: ${String(e.message || e).slice(0, 200)}`; }
    await store.finishAiAction(row.id, result);
    if (/^ok/.test(result)) touched.push(a.kind === "fire" ? a.target : a.clan);
    log(`  AI god ${row.god.split(".")[0]} ${a.kind} on ${a.clan}: ${result}`);
  }
  return touched; // the nations it acted on (their instant turn skips research: loop.mjs)
}
