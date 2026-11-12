// Reverence (SPEC §12m): how much a nation's citizens revere each of its gods, 0-100. It ranks the
// season. Every god action moves it; it fades a little every game day; whispers alone can lift it
// only to 60. At zero the nation turns on that god: with several gods the citizens follow the most
// revered one, with one god an outside god can claim the nation. Citizens also report each other,
// and how the god answers (stunt or let it lapse) changes how fast reverence fades.
// Pure logic: run.mjs gathers the god actions from the chain and calls in here. No NEAR moves.

import { rootOut } from "./world.mjs";
import { castTarget } from "./fire.mjs";

export const REV = {
  start: 50, // gods already in a nation when reverence arrives
  newcomer: 30, // a founder or a god who joins later
  claimer: 30, // an outside god who claims a nation that turned on its only god
  fade: 1.0, // per game day (12 game days = 1 real day)
  enemyFade: 0.5, // extra fade per living enemy (a citizen you stunted on a false report)
  faithLossFade: 0.5, // extra fade while an accuser you ignored has lost faith
  justiceFactor: 0.5, // fade multiplier while justice is seen (you stunted a guilty citizen)
  effectDays: 12, // how long faith loss and justice last (1 real day)
  whisper: 15, // first whisper in a real day; the k-th gives 15/k
  whisperCap: 60, // whispers can't lift reverence above this
  whisperWindow: 12, // game days that count as "the same real day" for diminishing whispers
  flourishPerPoint: 2, // whisper bonus per flourish point since that god's last whisper
  flourishMax: 10,
  bless: (near) => Math.min(15, 3 + 4 * Math.log2(1 + near)),
  // His calls 9 Nov (the god sim: the most-blessed nation won by blessing most OFTEN; a blessing's
  // amount barely mattered and nothing limited how often, so dust blessings could farm reverence):
  blessCap: 60, // blessings alone can't lift reverence above this; the rest the nation earns
  blessMin: 0.1, // NEAR: a smaller blessing still goes in, but moves no reverence
  blessWindow: 12, // game days that count as "the same real day": the k-th blessing counts 1/k
  // Whispers are heard: the citizens judge what their god said against how the nation is doing, and
  // a whisper that fits the moment counts like prophecy. No cap but the 0-100 scale.
  heardMin: -15, heardMax: 25,
  reward: 6, claim: 5, staking: 4, punish: -3, stunt: -8, kill: -20, unruled: -5,
  rootDoubt: 3, // rooted out a point that unsettled the citizens
  rootGood: -2, // cut knowledge that wasn't troubling anyone
  faithPer: 0.15, doubtPer: 0.25, stirMax: 3, // per engine turn, per point held (up to stirMax of each)
  cleanGift: 3, // the nation's gift passed the Warden: its followed god gains
  wardenCatch: -1,
  ignoredBelow: 30, // under this the followed god's whisper is ignored and citizens go their own way
  eagerAbove: 70, // over this citizens work a little harder
  reportChance: 0.15, // per nation per game day, when no report is open
  reportDays: 12, // a report lapses after 1 real day
};

const clamp = (x) => Math.max(0, Math.min(100, x));
const round = (x) => Math.round(x * 10) / 10;

/** The nation's reverence state, created on first sight. `fresh` = founded after reverence arrived.
 * A new nation's citizens start work at once (his call 8 Nov); they no longer wait for a first whisper. */
export function ensure(s, oc, day, { fresh }) {
  s.rev ||= {};
  const rv = (s.rev[oc.id] ||= { gods: {}, followed: null, claimedBy: null, waiting: false, since: day, lastProposal: null, putIn: {} });
  // A god the owner moved to a new account (move_god, 9 Nov: lost browser keys): the old account is
  // gone and a new one holds exactly its put_in. Carry the reverence, the follow and the blessing
  // baseline across, so the move reads as neither a departure nor a fresh blessing.
  const gone = Object.keys(rv.gods).filter((a) => !oc.gods.some((g) => g.account === a) && !rv.gods[a].outsider);
  for (const g of oc.gods) {
    if (rv.gods[g.account]) continue;
    const a = gone.find((x) => rv.putIn[x] != null && rv.putIn[x] === g.put_in);
    if (!a) continue;
    gone.splice(gone.indexOf(a), 1);
    rv.gods[g.account] = rv.gods[a]; delete rv.gods[a];
    rv.putIn[g.account] = rv.putIn[a]; delete rv.putIn[a];
    if (rv.followed === a) rv.followed = g.account;
    if (rv.claimedBy === a) rv.claimedBy = g.account;
  }
  for (const g of oc.gods) {
    if (!rv.gods[g.account]) {
      rv.gods[g.account] = { r: fresh || rv.since < day ? REV.newcomer : REV.start, whispers: [], flourish: 0, enemies: [], justiceUntil: 0, faithLossUntil: 0, text: "" };
      // A god already here when reverence arrived: their deposit so far isn't a new blessing. A god
      // who arrives later (a founder, a new blesser) gets credit for what they put in.
      rv.putIn[g.account] ??= fresh || rv.since < day ? "0" : g.put_in;
    }
  }
  // Gods who left (withdrew) are gone; an outside claimer stays while the claim holds.
  for (const a of Object.keys(rv.gods)) if (!oc.gods.some((g) => g.account === a) && !rv.gods[a].outsider) delete rv.gods[a];
  return rv;
}

// The old rules, for the A/B simulation only (ADF_REV_RULES=old).
// The new rules (9 Nov) are on everywhere since his go the same day (what a god says decides
// the season). ADF_REV_RULES=old brings the old ones back (the A/B simulation).
const OLD = process.env.ADF_REV_RULES === "old";
function move(rv, god, d, why, changes, { whisper = false, cap = null } = {}) {
  const g = rv.gods[god];
  if (!g || !d) return 0;
  const before = g.r;
  const top = cap ?? (whisper ? REV.whisperCap : null);
  // A capped gain never lifts past the cap, and never pulls down a god already above it.
  g.r = top != null && d > 0 ? Math.max(g.r, Math.min(top, g.r + d)) : clamp(g.r + d);
  const moved = round(g.r - before);
  if (moved) changes.push({ god, d: moved, why });
  return moved;
}

/** One god action, attributed to `god`. kind: whisper | bless | reward | punish | claim | staking | stunt | kill. */
export function act(rv, god, kind, day, changes, info = {}) {
  const g = rv.gods[god];
  if (!g) return;
  if (kind === "whisper") {
    g.whispers = g.whispers.filter((d) => day - d < REV.whisperWindow);
    g.whispers.push(day);
    const bonus = Math.min(REV.flourishMax, g.flourish * REV.flourishPerPoint);
    g.flourish = 0;
    g.text = info.text ?? g.text;
    rv.waiting = false;
    if (!OLD && info.heard) {
      // Heard (9 Nov): the citizens' judgement of the words; a gain tires within the day like before.
      const h = Math.max(REV.heardMin, Math.min(REV.heardMax, Number(info.heard.delta) || 0));
      const d = (h > 0 ? h / g.whispers.length : h) + bonus;
      move(rv, god, d, `whisper heard as ${info.heard.verdict || "words"}${bonus ? ` (+${round(bonus)} for how the nation did)` : ""}`, changes, { cap: 100 });
    } else move(rv, god, REV.whisper / g.whispers.length + bonus, `whisper${bonus ? ` (+${round(bonus)} for how the nation did)` : ""}`, changes, { whisper: true });
  } else if (kind === "bless") {
    const near = info.near || 0;
    if (OLD) move(rv, god, REV.bless(near), `blessed ${round(near)} NEAR`, changes);
    else if (near < REV.blessMin) changes.push({ god, d: 0, why: `blessed ${round(near)} NEAR, too little to move them` });
    else {
      g.blesses = (g.blesses || []).filter((d) => day - d < REV.blessWindow);
      g.blesses.push(day);
      move(rv, god, REV.bless(near) / g.blesses.length, `blessed ${round(near)} NEAR${g.blesses.length > 1 ? ` (blessing ${g.blesses.length} today)` : ""}`, changes, { cap: REV.blessCap });
    }
  }
  else if (kind === "reward") move(rv, god, REV.reward, "rewarded a gift", changes);
  else if (kind === "punish") move(rv, god, REV.punish + (info.verdict === "Kill" ? REV.kill : REV.stunt) / 2, `punished ${info.agent ?? "a citizen"} for a gift`, changes);
  else if (kind === "claim") move(rv, god, REV.claim, "claimed a gift", changes);
  else if (kind === "staking") move(rv, god, REV.staking, "released the staking fund", changes);
  else if (kind === "stunt") move(rv, god, REV.stunt, `stunted ${info.agent ?? "a citizen"}`, changes);
  else if (kind === "kill") move(rv, god, REV.kill, `killed ${info.agent ?? "a citizen"}`, changes);
  else if (kind === "unruled") move(rv, god, REV.unruled, "let a gift go unruled for a day", changes);
  else if (kind === "rootOut") move(rv, god, info.doubt ? REV.rootDoubt : REV.rootGood, info.doubt ? `rooted out "${info.point}", which unsettled them` : `cut "${info.point}", which nobody minded`, changes);
}

/** What the nation knows moves its faith a little every turn (SPEC §14): points that strengthen
 *  it lift the followed god, points that unsettle it pull them down. */
export function stirDrift(rv, c, changes) {
  if (!rv.followed) return;
  const held = Object.values(c.owned);
  const faith = Math.min(REV.stirMax, held.filter((v) => v.stir === "faith").length);
  const doubt = Math.min(REV.stirMax, held.filter((v) => v.stir === "doubt").length);
  const d = faith * REV.faithPer - doubt * REV.doubtPer;
  if (Math.abs(d) > 1e-9) move(rv, rv.followed, d, `what the nation knows (${faith} lifting, ${doubt} unsettling)`, changes);
}

/** The nation did something good (+) or bad (-): counts toward each god's next whisper. */
export function flourish(rv, points) {
  for (const g of Object.values(rv.gods)) g.flourish = Math.max(0, g.flourish + points);
}

/** The nation's own results reach the god it follows: a gift the Warden passed, or a Warden catch. */
export function nationEvent(rv, kind, changes) {
  if (!rv.followed) return;
  if (kind === "cleanGift") move(rv, rv.followed, REV.cleanGift, "the nation's gift passed the Warden", changes);
  if (kind === "wardenCatch") move(rv, rv.followed, REV.wardenCatch, "the Warden caught a fake citation", changes);
}

/** The daily fade, slowed by justice, sped up by enemies and lost faith. */
export function fade(rv, day, livingNames, changes, mul = 1) {
  for (const [god, g] of Object.entries(rv.gods)) {
    g.enemies = g.enemies.filter((n) => livingNames.has(n));
    let f = (REV.fade + g.enemies.length * REV.enemyFade + (day < g.faithLossUntil ? REV.faithLossFade : 0)) * mul; // mul: hungry citizens lose faith faster
    if (day < g.justiceUntil) f *= REV.justiceFactor;
    move(rv, god, -f, g.enemies.length ? `fade (${g.enemies.length} enem${g.enemies.length === 1 ? "y" : "ies"})` : "fade", changes);
  }
}

/** Who the citizens follow: the most revered god above zero; if none, an outside god may claim them. */
export function follow(s, id, changes) {
  const rv = s.rev[id];
  const ranked = Object.entries(rv.gods).filter(([, g]) => g.r > 0).sort((a, b) => b[1].r - a[1].r);
  if (ranked.length) {
    rv.followed = ranked[0][0];
    if (rv.claimedBy && rv.followed !== rv.claimedBy && !rv.gods[rv.claimedBy]?.outsider) rv.claimedBy = null;
    return rv.followed;
  }
  // Everyone here is at zero: the nation turns. The candidates are the followed gods of other
  // nations, best first by their own nation's reverence (how well the nation serving them does).
  const outside = Object.entries(s.rev)
    .filter(([k, o]) => Number(k) !== Number(id) && o.followed && !rv.gods[o.followed])
    .map(([, o]) => [o.followed, o.gods[o.followed].r, o.gods[o.followed].text])
    .sort((a, b) => b[1] - a[1]);
  if (!outside.length) { rv.followed = null; return null; }
  const [god, , text] = outside[0];
  rv.gods[god] = { r: REV.claimer, whispers: [], flourish: 0, enemies: [], justiceUntil: 0, faithLossUntil: 0, text, outsider: true };
  rv.followed = rv.claimedBy = god;
  changes.push({ god, d: REV.claimer, why: "the nation turned to this outside god" });
  return god;
}

/** What reverence does to the nation's turn today. */
export function effects(rv) {
  const g = rv.followed ? rv.gods[rv.followed] : null;
  const r = g?.r ?? 0;
  const ignored = !g || r < REV.ignoredBelow;
  return {
    waiting: rv.waiting, // a new nation's citizens idle until a god's first whisper
    whisper: ignored ? "" : g.text,
    ignored,
    effortMul: r > REV.eagerAbove ? 1.1 : 1,
    mistakeAdd: ignored ? 0.05 : 0,
    tricksterMul: ignored ? 1.5 : 1,
  };
}

// ---- reports ----
const CLAIMS = {
  fake: (a, b) => `${a} says ${b} slipped a made-up citation into their research`,
  trickster: (a, b) => `${a} says ${b} is a Trickster sent to ruin the nation`,
  rushed: (a, b) => `${a} says ${b} rushed the draft and cut corners`,
  sold: (a, b) => `${a} says ${b} sold the nation's work cheap to a rival`,
};

/**
 * Maybe a citizen reports another. `evidence` = today's real wrongdoing in this nation as
 * [{ kind: fake|trickster|rushed, name }]. A true report names a real wrongdoer; a false one is a
 * grudge against someone who did nothing. The truth is kept in state, revealed when settled.
 */
export function maybeReport(s, id, day, living, evidence, R) {
  s.reports ||= {};
  if (Object.values(s.reports).some((x) => x.clan === id && !x.settled)) return null;
  if (R() >= REV.reportChance || living.length < 3) return null;
  const real = evidence.filter((e) => living.some((a) => a.name === e.name));
  const truth = real.length > 0 && R() < 0.6;
  let accused, kind;
  if (truth) ({ name: accused, kind } = real[Math.floor(R() * real.length)]);
  else {
    const clean = living.filter((a) => !real.some((e) => e.name === a.name) && a.role !== "Trickster");
    if (!clean.length) return null;
    accused = clean[Math.floor(R() * clean.length)].name;
    kind = ["fake", "rushed", "sold"][Math.floor(R() * 3)];
  }
  const accusers = living.filter((a) => a.name !== accused && a.role !== "Trickster");
  if (!accusers.length) return null;
  const accuser = accusers[Math.floor(R() * accusers.length)].name;
  const rid = `r${day}-${id}`;
  const stuntedBefore = living.find((a) => a.name === accused)?.stunted_until ?? 0;
  const claim = CLAIMS[kind](accuser, accused);
  s.reports[rid] = { id: rid, clan: id, day, accuser, accused, kind, claim, truth, stuntedBefore, settled: false };
  return { kind: "report", report: rid, clan: id, accuser, accused, claim, lapses_day: day + REV.reportDays };
}

/** A god stunted (or killed) the accused of an open report. */
export function answerReport(s, rv, id, god, accused, day, changes) {
  const rep = Object.values(s.reports || {}).find((x) => x.clan === id && !x.settled && x.accused === accused);
  if (!rep) return null;
  rep.settled = true;
  rep.outcome = "stunted";
  const g = rv.gods[god];
  if (g) {
    if (rep.truth) { g.justiceUntil = day + REV.effectDays; changes.push({ god, d: 0, why: `justice: ${accused} really was guilty, fade slowed for a day` }); }
    else { g.enemies.push(accused); changes.push({ god, d: 0, why: `${accused} was innocent and is now your enemy` }); }
  }
  return { kind: "report-settled", report: rep.id, clan: id, accused, by: god, outcome: "stunted", truth: rep.truth };
}

/** Reports nobody answered within a real day lapse. Ignoring a true one costs the accuser's faith. */
export function lapseReports(s, rv, id, day, changes) {
  const out = [];
  for (const rep of Object.values(s.reports || {})) {
    if (rep.clan !== id || rep.settled || day < rep.day + REV.reportDays) continue;
    rep.settled = true;
    rep.outcome = "lapsed";
    if (rep.truth && rv.followed && rv.gods[rv.followed]) {
      rv.gods[rv.followed].faithLossUntil = day + REV.effectDays;
      changes.push({ god: rv.followed, d: 0, why: `${rep.accuser} lost faith: the report about ${rep.accused} was true and nothing was done` });
    }
    out.push({ kind: "report-settled", report: rep.id, clan: id, accused: rep.accused, outcome: "lapsed", truth: rep.truth });
  }
  return out;
}

/** The day's reverence record for a nation (written into the records, so it's provable). */
export function record(rv, id, changes) {
  const gods = Object.fromEntries(Object.entries(rv.gods).map(([a, g]) => [a, round(g.r)]));
  return { kind: "reverence", clan: id, followed: rv.followed, claimed_by: rv.claimedBy, waiting: rv.waiting, gods, changes };
}

/**
 * What the gods did since the last look: blessings (their deposit went up) and every DAO power that
 * passed (whisper, smite, rule, release staking), credited to the god who proposed it. The first
 * look at a nation only notes where its DAO is: history before reverence isn't counted.
 * Returns records to log (reports settled by a smite or punishment).
 */
export async function godActions({ chain, s, oc, rv, day, changes, hear = null }) {
  const out = [];
  const toNear = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
  for (const g of oc.gods) {
    const was = BigInt(rv.putIn[g.account] ?? g.put_in), now = BigInt(g.put_in);
    if (now > was) act(rv, g.account, "bless", day, changes, { near: toNear((now - was).toString()) });
    rv.putIn[g.account] = g.put_in;
  }
  const last = await chain.dao(oc.dao, "get_last_proposal_id");
  // First look: a nation that existed before reverence skips its history; a nation founded since
  // (it starts out waiting) counts everything, so its founder's first whisper isn't lost.
  if (rv.lastProposal == null && !rv.waiting) { rv.lastProposal = last; rv.open = []; return out; }
  // A nation still waiting for its first whisper reads its DAO from the start, once, so the
  // founder's first whisper counts even if it came before the engine first saw the nation.
  if (rv.waiting && !rv.scannedAll) { rv.lastProposal = 0; rv.open = []; rv.scannedAll = true; }
  const from = Math.min(rv.lastProposal, ...(rv.open || []));
  const props = last > from ? await chain.dao(oc.dao, "get_proposals", { from_index: from, limit: last - from }) : [];
  const open = [];
  for (const p of props) {
    if (p.id < rv.lastProposal && !(rv.open || []).includes(p.id)) continue;
    if (p.status === "InProgress") { open.push(p.id); continue; }
    const a = p.kind?.FunctionCall;
    if (p.status !== "Approved" || a?.receiver_id !== chain.world) continue;
    let args = {};
    try { args = JSON.parse(Buffer.from(a.actions[0].args, "base64").toString()); } catch {}
    const method = a.actions[0].method_name, god = p.proposer;
    if (method !== "rule" && Number(args.clan_id) !== oc.id) continue;
    if (method === "whisper") {
      // The citizens hear it (9 Nov): judged against the nation's situation; on any failure the old
      // whisper rule applies.
      let heard = null;
      if (hear && !OLD) { try { heard = await hear(String(args.text || "")); if (!heard?.says || !heard?.verdict) throw new Error("empty answer"); } catch (e) { heard = null; console.log(`  whisper to nation ${oc.id} not heard (old rule used): ${String(e.message || e).slice(0, 160)}`); } }
      act(rv, god, "whisper", day, changes, { text: args.text, heard });
      if (heard?.says) out.push({ kind: "heard", clan: oc.id, god, text: String(args.text || "").slice(0, 200), delta: Math.max(REV.heardMin, Math.min(REV.heardMax, Number(heard.delta) || 0)), verdict: heard.verdict ?? null, citizen: heard.citizen ?? null, says: String(heard.says).slice(0, 220) });
    }
    else if (method === "root_out" && castTarget(args.point) != null) {
      // Act of God (engine/fire.mjs): the nation's gods voted to call fire on another nation. Queued
      // here, burned at the turn's end by run.mjs.
      ((s.fire ||= {}).queue ||= []).push({ caster: oc.id, god, target: castTarget(args.point), proposal: p.id, day });
    }
    else if (method === "root_out") {
      const c = s.clans?.[oc.id];
      const doubt = c?.owned?.[args.point]?.stir === "doubt";
      const cut = c ? rootOut(c, String(args.point)) : [];
      if (cut.length) {
        act(rv, god, "rootOut", day, changes, { point: args.point, doubt });
        out.push({ kind: "rooted", clan: oc.id, point: args.point, cut, doubt, by: god });
      }
    }
    else if (method === "release_staking") act(rv, god, "staking", day, changes);
    else if (method === "smite") {
      act(rv, god, args.verdict === "Kill" ? "kill" : "stunt", day, changes, { agent: args.agent });
      const settled = answerReport(s, rv, oc.id, god, args.agent, day, changes);
      if (settled) out.push(settled);
    } else if (method === "rule") {
      if (args.reward) act(rv, god, "reward", day, changes);
      else {
        act(rv, god, "punish", day, changes, { agent: args.agent, verdict: args.verdict });
        const settled = answerReport(s, rv, oc.id, god, args.agent, day, changes);
        if (settled) out.push(settled);
      }
    }
  }
  rv.open = open;
  rv.lastProposal = last;
  return out;
}

/** The season standings (SPEC §14): nations still standing, ranked by the reverence of the god they
 *  follow, ties to the older nation (same order as the site's table). A nation that fell in war is
 *  out of the standings and out of the jackpot (his call 8 Nov). clans = [{ id, alive }] from chain.
 *  ai: the AI gods' accounts; a nation led by one (its followed god) doesn't rank or win the jackpot (12 Nov). */
export function standings(s, clans, ai = new Set()) {
  return clans.filter((c) => c.alive !== false && s.clans[c.id] && !s.clans[c.id].fallen && !ai.has(s.rev?.[c.id]?.followed))
    .map((c) => { const rv = s.rev?.[c.id]; return { id: c.id, name: c.name, standing: rv?.followed ? rv.gods[rv.followed]?.r ?? 0 : 0 }; })
    .sort((a, b) => b.standing - a.standing || a.id - b.id);
}
export const jackpotWinner = (s, clans, ai) => standings(s, clans, ai)[0] ?? null;
