// The world tick. One call = N game days. Usage (from adfontes/):
//   node engine/run.mjs testnet --days 2
// Each day: tick the contract, read the weather, then for every live clan: spawn its team if
// new, Patron picks a point, Scholars research (or the Broker buys from a clan that has it),
// the Smith makes kits, the Drafter drafts when the chain is deep enough, the Warden checks
// everything, gifts go on chain, upkeep is charged; then the day's root goes on chain.
import "./simclock.mjs"; // the fast-forward simulation's clock (does nothing unless ADF_NOW is set)
import { refill as refillPool, nationsLeft, SPONSOR } from "./sponsor.mjs";
import fs from "node:fs";
import { CFG, florinRates } from "./config.mjs";
import { connect, toNear, toFlorins } from "./chain.mjs";
import { clockAt, extendHours, seasonStartNear } from "./clock.mjs";
import { papersFor, openAlexCut, openAlexBudget } from "./papers.mjs";
import { scholarTurn, draftTurn, brokerPick, brokerMarket, sellerAsk, hearWhisper, accusedReply, meter, setSpentToday, spentToday, canSpend, onSpend } from "./llm.mjs";
import * as RV from "./reverence.mjs";
// Whispers to re-hear once (9 Nov, see the per-nation reverence step): nation id -> DAO proposal id.
const REHEAR_9NOV = { 2: 17, 3: 4, 6: 4 };
import { overpaid, floorReverence } from "./revfix.mjs";
import * as WR from "./war.mjs";
import { warCouncil } from "./llm.mjs";
import { newName } from "./names.mjs";
import * as W from "./world.mjs";
import { researchPrice, kitPrice } from "./prices.mjs";
import * as TK from "./tokens.mjs";
import * as MK from "./market.mjs";
import * as B from "./budget.mjs";
import * as CH from "./choices.mjs";
import * as AK from "./ask.mjs";
import * as BW from "./brokerword.mjs";
import * as SE from "./seats.mjs";
import { planGods } from "./aiact.mjs";
import * as FIRE from "./fire.mjs";
import { clampPrice } from "./prices.mjs";
const MARKET_ON = process.env.ADF_MARKET === "1"; // the Brokers' market days (settling sales and royalties always run)
import * as store from "./store.mjs";
import { renderFigure } from "./figures.mjs";

const net = process.argv[2] || "testnet";
if (net === "mainnet" && !process.argv.includes("--yes-mainnet")) throw new Error("mainnet needs --yes-mainnet");
const FL = florinRates(net); // florin amounts, scaled down on testnet
const days = process.argv.includes("--days") ? Number(process.argv[process.argv.indexOf("--days") + 1]) || 1 : 1; // (without --days it used to read NaN and run nothing)
// Instant turns (SPEC §12n): `--instant 6[,7] [--fresh]` gives those nations one turn NOW without
// moving the world's day: citizens if they have none, what their gods just did, one research turn
// (and, for a nation in its first minutes, its first draft and first report). Records go to
// s.pending, which become the first records of the next day (proven with its root) and which the
// site shows live. Started by engine/loop.mjs; a normal day runs exactly as before.
const INSTANT = process.argv.includes("--instant") ? process.argv[process.argv.indexOf("--instant") + 1].split(",").map(Number) : null;
// Nations whose instant turn an AI god's action triggered (12 Nov): it answers the action but doesn't research,
// or ~1,000 extra research calls a day would eat the citizens' Claude budget by midday.
const NO_RESEARCH = new Set(process.argv.includes("--no-research") ? process.argv[process.argv.indexOf("--no-research") + 1].split(",").map(Number) : []);
const FRESH = process.argv.includes("--fresh");
const chain = connect(net);
const s = await store.ensureWorld(net, chain.world); // a new world contract on testnet starts clean

// Only the schedule moves the world (see CFG.minMinutesBetweenRuns). --force skips this check.
const sinceLast = (Date.now() - (s.lastRunAt || 0)) / 60000;
// A new nation brings a new day at once (his call 7 Nov): a nation on chain the world hasn't seen yet
// skips the wait.
const unseen = (await chain.clans()).some((c) => c.alive && !s.clans[c.id]);
if (!INSTANT && !process.argv.includes("--force") && !process.argv.includes("--plan-only") && !unseen && !s.inProgress && sinceLast < CFG.minMinutesBetweenRuns) {
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
// The cap counts every network and survives wipes: one ledger in Postgres (store.spendOn/addSpend).
// First run with the ledger: carry over what this world already spent today.
if ((await store.spendOn(today)) === 0 && s.spend.usd > 0) await store.addSpend(today, s.spend.usd);
// The AI gods' pot (12 Nov) has its own row in the same ledger: "<date>|gods".
const spendBase = await store.spendOn(today), godsBase = await store.spendOn(`${today}|gods`);
setSpentToday(spendBase, godsBase);
onSpend((usd, pot) => store.addSpend(pot === "gods" ? `${today}|gods` : today, usd));
// --plan-only (12 Nov): plan the AI gods' next two hours now and stop. Nothing else in the world moves and
// the state isn't saved (the loop asks for this when it finds new AI gods, rather than waiting for the turn).
const PLAN_ONLY = process.argv.includes("--plan-only");
if (PLAN_ONLY) {
  try { const p = await planGods({ net, s, onchain: await chain.clans(), chain }); console.log(`  AI gods: ${p.actions} actions planned for ${p.gods} gods${p.why ? ` (${p.why})` : ""}`); }
  catch (e) { console.log(`  AI gods: no plan: ${String(e.message || e).slice(0, 200)}`); }
  await store.close();
  process.exit(0);
}
let capNoted = false;
const chance = (p) => Math.random() < p;
// Agent wallets (8 Nov): the Broker's buys and the Patron's war chest and walls are signed by the
// agents' own NEAR accounts (engine/chain.mjs). If an agent call fails, the operator signs instead
// and the error is logged, so a turn never stalls on it. Upkeep, fines and plunder stay the
// operator's: those are the world's rules, not the agents' choices.
let logAgentError = () => {};
async function agentBuy(buyer, seller, florins, memo) {
  try { return await chain.agentBuy(buyer, seller, florins, memo); }
  catch (e) { logAgentError(buyer, `Broker wallet: ${String(e.message || e).slice(0, 140)}; the operator signed instead`); return chain.trade(buyer, seller, florins, memo); }
}
async function agentSpend(clanId, florins, memo) {
  try { return await chain.agentSpend(clanId, florins, memo); }
  catch (e) { logAgentError(clanId, `Patron wallet: ${String(e.message || e).slice(0, 140)}; the operator signed instead`); return chain.burn(clanId, florins, memo); }
}
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
  // Where this turn's own records start. On an instant turn rec is every record since the last full
  // day, so reverence must only score what THIS turn added (9 Nov: re-scanning the whole list paid
  // the same passed gift's +3 again on every instant turn).
  const turnStart = rec.length;
  if (!INSTANT && !resuming) { s.inProgress = { day, done: [] }; s.lastRunAt = Date.now(); }
  let seq = 0;
  logAgentError = (clan, error) => log({ kind: "error", clan, error });
  const log = (r) => { rec.push({ day, ...r, ...(INSTANT ? { live: `${Date.now().toString(36)}-${seq++}`, at: Date.now() } : {}) }); console.log(`  [${r.kind}]`, JSON.stringify(r).slice(0, 220)); };
  // One-time correction (his go 9 Nov): take back the reverence the instant-turn double count paid
  // (repeat gift bonuses, inflated whisper bonuses) and reset every god's unpaid bonus to what the
  // nation really did. Logged as a record, so it is sealed on NEAR with this turn.
  if (net === "testnet" && !process.env.ADF_SIM_CHAIN && !s.fixes?.revDouble9Nov && s.rev) {
    const all = [];
    for (let d = 1; d <= s.day; d++) all.push(...((await store.getDay(net, d))?.records || []));
    all.push(...(s.pending || []));
    const { over, flourish } = overpaid(all);
    for (const [cid, gods] of Object.entries(over)) {
      const rv = s.rev[cid];
      if (!rv) continue;
      const changes = [];
      for (const [god, d] of Object.entries(gods)) {
        const g = rv.gods[god];
        if (!g) continue;
        const before = g.r;
        g.r = Math.max(0, g.r - d);
        changes.push({ god, d: +(g.r - before).toFixed(2), why: "correction: reverence a counting bug paid twice (repeat gift bonuses, whisper bonus counted again)" });
      }
      if (changes.length) log({ kind: "correction", clan: Number(cid), changes, why: "Until 9 Nov an instant turn counted the whole day again, so a passed gift paid its +3 more than once. Taken back." });
    }
    for (const [cid, gods] of Object.entries(flourish)) for (const [god, v] of Object.entries(gods)) if (s.rev[cid]?.gods[god]) s.rev[cid].gods[god].flourish = v;
    s.fixes = { ...(s.fixes || {}), revDouble9Nov: Date.now() };
  }
  // One-time reverence floor (his call 12 Nov ~22:35 UTC, engine/revfix.mjs): every seated god under 35 rises to
  // 35-45; logged as a correction record, sealed with this turn.
  if (net === "testnet" && !process.env.ADF_SIM_CHAIN && !s.fixes?.revFloor12Nov && s.rev) {
    const raised = floorReverence(s, await chain.clans(), "floor-12nov");
    for (const [cid, changes] of Object.entries(raised)) log({ kind: "correction", clan: Number(cid), changes, why: "A one-time lift (12 Nov): every god with a seat starts from at least 35, so the nations can be won back." });
    s.fixes = { ...(s.fixes || {}), revFloor12Nov: Date.now() };
  }
  // Seat trading (PLAN_13NOV step 4, engine/seats.mjs): sales the loop settled are sealed here, before this turn
  // reads any reverence or decides which nations are AI-led. Everything goes with the seat: the buyer takes the seller's
  // reverence and, buying an AI god's seat (his ask 13 Nov), that god's name and its place in the season rankings.
  const seatsSealed = [];
  {
    const aiBefore = new Set((await store.aiGods(net).catch(() => [])).map((g) => g.account));
    for (const b of await store.seatBuysUnsealed(net).catch(() => [])) {
      const l = await store.seatGet(net, b.listing);
      const r = SE.recordOf(b, l);
      if (b.status === "filled" && l) {
        SE.carryReverence(s.rev?.[l.clan], l.seller, b.buyer);
        if (aiBefore.has(l.seller)) {
          const elsewhere = (await chain.clans()).filter((c) => c.id !== l.clan && (c.gods || []).some((g) => g.account === b.buyer)).length;
          const name = (await store.godNames([l.seller]).catch(() => ({})))[l.seller] ?? null;
          if (SE.takesName({ seller: l.seller, ai: aiBefore, seatsElsewhere: elsewhere })) { await store.moveGodName(l.seller, b.buyer); r.as = name; }
          await store.removeAiGod(net, l.seller);
          r.from_ai = name;
        }
      }
      log(r);
      seatsSealed.push(b.tx);
    }
  }
  // AI gods have full control of their nations (his call 13 Nov): no outside god stays in an AI-led nation, and
  // an AI-led nation never turns to one (RV.follow with AI_SET).
  const AI_SET = new Set((await store.aiGods(net).catch(() => [])).map((g) => g.account));
  // Signed choices for this turn (PLAN_13NOV step 0, engine/choices.mjs). Read by every run of the turn; sealed as
  // records once, by the scheduled run. Silence = today's behaviour.
  const CHOICES = await store.choicesFor(net, day).catch(() => []);
  if (!INSTANT) for (const ch of CHOICES) log(CH.recordOf(ch));
  const pitchPick = (id) => CHOICES.find((x) => x.clan === id && x.kind === "pitch")?.payload?.point ?? null;
  if (AI_SET.size) for (const [cid, gods] of Object.entries(RV.dropOutsiders(s, await chain.clans(), AI_SET))) log({ kind: "outsiders-gone", clan: Number(cid), gods, why: "its AI gods have full control: the outside gods let go" });
  const checkpoint = async () => { s.spend.usd = spendBase + meter.usd; if (!INSTANT) await store.saveDay(net, day, rec, null, null); await store.saveState(net, s); };
  // Cap reached: say so once a day; turns that need Claude are skipped, everything else goes on.
  // Patent royalties owed this turn: { [clan]: { florins, patents: [], n } }, paid in settleMarket.
  // Patent royalties, paid the moment a research buy lands in a patent's chain (his call 9 Nov: nothing
  // waits for the turn). One mint per holder; anything that fails is kept and paid at the turn's end.
  async function owe(list) {
    const by = {};
    for (const x of list) (by[x.clan] ||= []).push(x.draft);
    for (const [clan, patents] of Object.entries(by)) {
      const florins = +(FL.royalty * patents.length).toFixed(4), per = {};
      for (const p of patents) per[p] = +((per[p] || 0) + FL.royalty).toFixed(4);
      try {
        const m = await chain.mint(Number(clan), florins, `patent royalties: ${[...new Set(patents)].join(",")}`.slice(0, 200));
        log({ kind: "royalty", clan: Number(clan), florins, patents: [...new Set(patents)], per, sales: 1, tx: m?.hash ?? null });
      } catch (e) {
        const d = ((s.royaltyDue ||= {})[clan] ||= { florins: 0, patents: [], n: 0 });
        d.florins += florins; d.patents.push(...patents); d.n++;
        log({ kind: "error", clan: Number(clan), error: `royalty (paid at the turn's end instead): ${String(e.message || e).slice(0, 140)}` });
      }
    }
  }
  // The market's listings, read once a run (null: a world contract from before the market).
  let marketNow;
  const listingsNow = async () => (marketNow === undefined ? (marketNow = await chain.marketListings(0)) : marketNow);
  // Every sale so far (read once a turn, kept current as this turn buys): the contract refuses a copy
  // to a nation that bought it before, minted or not (turn 58, Striklar).
  let salesNow;
  const salesSoFar = async () => (salesNow === undefined ? (salesNow = (await chain.marketSales(0).catch(() => null)) || []) : salesNow);
  /** The one door for every market buy (12 Nov): a Broker never buys what its nation already has.
   *  Returns the buy, or null when it already has it (nothing sent, nothing paid). */
  async function buyChecked(buyer, listingId, why, token) {
    if (await MK.alreadyHas(chain, buyer, token, await salesSoFar())) return null;
    const r = await chain.marketBuy(buyer, listingId, why);
    salesNow.push({ buyer, token_id: token, listing: listingId });
    return r;
  }
  /** A sale, completed the moment it's made (his call 9 Nov: no waiting for the next turn): the
   *  buyer's copy of a research token or kit is minted straight to its Broker's wallet, and the sale
   *  is marked done so the turn's settling never applies it twice. applied: the caller already
   *  taught the buyer and paid the royalties. */
  /** A new token, minted the moment the thing it stands for exists (his call 9 Nov: research done =
   *  token on NEAR, not at the turn's end). Held by the nation's Broker. A mint that fails is left to
   *  the turn's token sync, which retries it. */
  async function mintNow(clan, token, title) {
    if (s.clans[clan]?.agentWallets !== 2) return;
    const key = `${clan}|${token}`;
    if ((s.mtDone ||= []).includes(key)) return;
    try {
      const m = await chain.mtMint([{ token_id: token, owner_id: chain.agentId(clan, "Broker"), amount: "1", title: String(title || token).slice(0, 120) }], `new ${token}`);
      s.mtDone.push(key);
      log({ kind: "tokens", minted: 1, research: +(token[0] === "r"), patents: +(token[0] === "p"), kits: +(token[0] === "k"), for: clan, title: String(title || token).slice(0, 120), tx: m.hash });
    } catch (e) { log({ kind: "error", clan, error: `token ${token} (the turn's sync retries it): ${String(e.message || e).slice(0, 140)}` }); }
  }
  async function settleSale(sale, { applied = false } = {}) {
    if ((s.salesDone ||= []).includes(sale.id)) return null;
    // A listing its god asked for sold above fair (PLAN_13NOV step 3): that god gains a little reverence.
    const gw = s.godListed?.[sale.listing];
    if (gw && Number(sale.seller) === gw.clan && gw.god) {
      const fair = MK.fairOf(s, sale.token_id, FL)?.price ?? gw.fair;
      if (BW.aboveFair(sale, fair)) {
        const ch = [];
        RV.brokerReward(s.rev?.[gw.clan], gw.god, day, ch);
        if (ch.length) log({ kind: "reverence-change", clan: gw.clan, listing: sale.listing, changes: ch });
      }
    }
    let res = { learned: null };
    if (!applied) {
      res = MK.applySale(s, sale);
      if (!res) return null;
      const f = MK.fairOf(s, sale.token_id, FL);
      log({ kind: "market-sale", buyer: sale.buyer, seller: sale.seller, token: sale.token_id, title: f?.title ?? sale.token_id, price: sale.price, fair: f?.price ?? null, why: sale.reason, listing: sale.listing, learned: res.learned ?? null });
      if (sale.token_id[0] === "r") await owe(MK.royaltiesFor(s, [s.corpora[sale.token_id.slice(2)]?.node], sale.buyer));
    }
    s.salesDone.push(sale.id);
    if (s.salesDone.length > 400) s.salesDone = s.salesDone.slice(-200);
    // Its copy, now (a patent already moved on the contract in the sale itself).
    if (sale.token_id[0] !== "p" && s.clans[sale.buyer]?.agentWallets) {
      const key = `${sale.buyer}|${sale.token_id}`;
      if (!(s.mtDone ||= []).includes(key)) {
        try {
          const title = MK.fairOf(s, sale.token_id, FL)?.title ?? sale.token_id;
          const m = await chain.mtMint([{ token_id: sale.token_id, owner_id: chain.agentId(sale.buyer, "Broker"), amount: "1", title: String(title).slice(0, 120) }], `sale ${sale.id}`);
          s.mtDone.push(key);
          log({ kind: "tokens", minted: 1, research: +(sale.token_id[0] === "r"), patents: 0, kits: +(sale.token_id[0] === "k"), for: sale.buyer, tx: m.hash });
        } catch (e) { log({ kind: "error", clan: sale.buyer, error: `copy mint (the turn's token sync retries): ${String(e.message || e).slice(0, 140)}` }); }
      }
    }
    return res;
  }
  // A trade between two nations, the way a market does it (his call 9 Nov): the seller's Broker names
  // its price (half to three times fair), the buyer's Broker takes it or walks away (more than WALK x
  // fair, or more than it can pay), and the deal goes through the market contract: the seller lists
  // (unless it's already on its shelf, where the listed price stands), the buyer buys, and a listing
  // made only for this deal comes down after. Returns { price, ask, buy, sale } or { walked, ask }, or
  // null when this world has no market (the caller pays the old way).
  const WALK = 2;
  async function marketDeal({ buyer, seller, token, fair, fairWhy, item, holders, wallet, buyerWhy }) {
    const all = await listingsNow();
    if (!all) return null; // no market on this world: the caller pays the old way
    // Every trade goes through the market (his call 9 Nov): a nation whose trader wallet isn't made yet
    // (its first turn) waits a turn rather than paying outside it.
    if (s.clans[buyer]?.agentWallets !== 2 || s.clans[seller]?.agentWallets !== 2) return { walked: true, quiet: true, ask: { price: fair } };
    let shelf = all.find((l) => l.open && l.seller === seller && l.token_id === token);
    // Walked away from this one already today: no new ask, no new line (a real buyer remembers).
    const wk = `${buyer}|${seller}|${token}`, prev = s.walked?.[wk];
    if (!shelf && prev && Date.now() - prev.at < CFG.draftEveryMs) return { walked: true, quiet: true, ask: { price: prev.price } };
    let ask;
    if (shelf) ask = { price: shelf.price, why: shelf.reason, listing: shelf.id, standing: true };
    else {
      let a;
      try { a = await sellerAsk({ field: s.clans[seller].field, temperament: s.clans[seller].mbti, florins: florinsOf(seller), item, buyer: nameOfClan(buyer), fair, fairWhy, holders }); }
      catch { a = { price: fair, why: "the fair price" }; }
      ask = { price: clampPrice(a.price, fair), why: String(a.why || "").slice(0, 200) };
    }
    if (ask.price > fair * WALK || ask.price >= wallet) {
      s.walked ||= {};
      for (const [k, v] of Object.entries(s.walked)) if (Date.now() - v.at >= CFG.draftEveryMs) delete s.walked[k];
      s.walked[wk] = { at: Date.now(), price: ask.price };
      return { walked: true, ask };
    }
    // The buyer already has this (holds it, or bought it before): no deal, nothing to list or pay.
    if (await MK.alreadyHas(chain, buyer, token, await salesSoFar())) return { walked: true, quiet: true, ask };
    let listTx = null;
    if (!shelf) {
      // Its own token, made now if it isn't on NEAR yet (research written earlier this same turn is
      // only minted at the turn's end; 9 Nov the contract refused a listing for that reason).
      const sellerW = chain.agentId(seller, "Broker"), have = await chain.mtBalances(sellerW, [token]);
      if (have && BigInt(have[0] || 0) === 0n) {
        const title = MK.fairOf(s, token, FL)?.title ?? token;
        const m = await chain.mtMint([{ token_id: token, owner_id: sellerW, amount: "1", title: String(title).slice(0, 120) }], `before sale to ${buyer}`);
        const key = `${seller}|${token}`;
        if (!(s.mtDone ||= []).includes(key)) s.mtDone.push(key);
        log({ kind: "tokens", minted: 1, research: +(token[0] === "r"), patents: 0, kits: +(token[0] === "k"), for: seller, tx: m.hash });
      }
      // A full shelf (10 open listings, the contract's limit): the seller's Broker takes down its oldest
      // listing to make room for this sale (10 Nov: 33 deals in the sim failed on a full shelf).
      const makeRoom = async () => {
        const open = all.filter((l) => l.open && l.seller === seller && l.token_id !== token).sort((x, y) => x.id - y.id);
        if (open.length < 10) return;
        const old = open[0], r = await chain.marketDelist(seller, old.id);
        old.open = false;
        log({ kind: "delisted", clan: seller, listing: old.id, token: old.token_id, title: MK.fairOf(s, old.token_id, FL)?.title ?? null, why: `made room for a sale to ${nameOfClan(buyer)}`, tx: r.hash, signer: r.signer });
      };
      await makeRoom();
      let L = null;
      try { L = await chain.marketList(seller, token, ask.price, ask.why); }
      catch (e) {
        // The turn's view was out of date after all: read the shelf from NEAR once and go again.
        if (!/already listed|at most 10 open listings/i.test(String(e.message || e))) throw e;
        const fresh = await chain.marketListings(0);
        if (!fresh) throw e;
        all.splice(0, all.length, ...fresh);
        shelf = all.find((l) => l.open && l.seller === seller && l.token_id === token);
        if (shelf) { ask.listing = shelf.id; ask.price = shelf.price; ask.why = shelf.reason; ask.standing = true; }
        else { await makeRoom(); L = await chain.marketList(seller, token, ask.price, ask.why); }
      }
      if (L) {
        ask.listing = L.value; listTx = L.hash;
        all.push({ id: L.value, seller, token_id: token, price: ask.price, kind: token[0] === "p" ? "sale" : "copy", open: true, reason: ask.why, sold: 0 });
      }
    }
    let b;
    try { b = await buyChecked(buyer, ask.listing, buyerWhy, token); if (!b) throw new Error("You already have that"); }
    catch (e) {
      // Bought it before (the contract remembers every buyer of a copy): skip quietly, and don't ask
      // again for a day.
      if (!/You already have that/i.test(String(e.message || e))) throw e;
      (s.walked ||= {})[wk] = { at: Date.now(), price: ask.price };
      if (listTx) { // listed just for this deal: take it back down
        try { await chain.marketDelist(seller, ask.listing); const x = all.find((y) => y.id === ask.listing); if (x) x.open = false; } catch {}
      }
      return { walked: true, quiet: true, ask };
    }
    const l = all.find((x) => x.id === ask.listing);
    if (l) { l.sold = (l.sold || 0) + 1; if (l.kind === "sale") l.open = false; }
    if (!shelf && token[0] !== "p") {
      try { await chain.marketDelist(seller, ask.listing); if (l) l.open = false; } catch { /* left on the shelf: another nation may buy it */ }
    }
    return { price: ask.price, ask, listTx, buy: b, sale: { id: b.value, listing: ask.listing, buyer, seller, token_id: token, price: ask.price, reason: buyerWhy } };
  }
  /** One nation's Broker on the market: list, take down, buy. Returns the florins it spent. */
  // must / askedBy: what a god asked the Broker to list, when it listened (PLAN_13NOV step 3, engine/brokerword.mjs).
  async function marketDay(oc, c, florins, must = [], askedBy = null) {
    const all = await listingsNow();
    if (!all) return 0;
    c.lastMarketAt = Date.now();
    const mine = all.filter((l) => l.open && l.seller === oc.id);
    const sell = MK.sellable(s, oc.id, FL).filter((x) => !mine.some((m) => m.token_id === x.token_id) && !must.some((y) => y.token_id === x.token_id));
    const offers = all.filter((l) => l.open && l.seller !== oc.id && s.clans[l.seller] && MK.useful(s, oc.id, l.token_id))
      .map((l) => { const f = MK.fairOf(s, l.token_id, FL); return f && { id: l.id, seller: l.seller, token_id: l.token_id, title: f.title, kind: f.kind, price: l.price, fair: f.price }; }).filter(Boolean)
      // The same walk-away as a direct deal (cold audit 11 Nov: a Broker bought at 2.2x fair here): an
      // offer over twice its fair price never reaches the Broker.
      .filter((o) => o.price <= o.fair * WALK);
    // Nothing it already has reaches the Broker (12 Nov): held now (one read for all offers) or bought before.
    if (offers.length) {
      const held = await chain.mtBalances(chain.agentId(oc.id, "Broker"), offers.map((o) => o.token_id)).catch(() => null);
      const sold = await salesSoFar();
      for (let i = offers.length - 1; i >= 0; i--) {
        const o = offers[i];
        if ((held && BigInt(held[i] || 0) > 0n) || (o.token_id[0] !== "p" && sold.some((x) => Number(x.buyer) === oc.id && x.token_id === o.token_id))) offers.splice(i, 1);
      }
    }
    if (!sell.length && !offers.length && !mine.length && !must.length) return 0;
    const m = await brokerMarket({ field: c.field, temperament: c.mbti, florins, sellable: sell, mine: mine.map((x) => ({ id: x.id, token_id: x.token_id, price: x.price })), offers, open: Object.keys(c.frontier), must });
    // The god's word first: each asked item is listed, at the Broker's price if it named one (clamped as always).
    for (const x of must) {
      if (mine.filter((y) => y.open !== false).length >= 10) { log({ kind: "broker-word", clan: oc.id, god: askedBy, token: x.token_id, title: x.title, full: true, why: "the shelf is full (10 listings)" }); break; }
      const L = (m.list || []).find((y) => y.token_id === x.token_id) || { price: x.price, why: "" };
      const price = clampPrice(L.price, x.price), why = `At its god's word. ${String(L.why || "").slice(0, 170)}`.trim();
      const r = await chain.marketList(oc.id, x.token_id, price, why);
      const row = { id: r.value, seller: oc.id, token_id: x.token_id, price, kind: x.token_id[0] === "p" ? "sale" : "copy", open: true, reason: why, sold: 0 };
      all.push(row); mine.push(row);
      (s.godListed ||= {})[r.value] = { god: askedBy, clan: oc.id, fair: +x.price.toFixed(4), day };
      log({ kind: "listed", clan: oc.id, listing: r.value, token: x.token_id, title: x.title, price, fair: +x.price.toFixed(4), priceWhy: x.why, why, asked_by: askedBy, tx: r.hash, signer: r.signer });
    }
    m.list = (m.list || []).filter((y) => !must.some((x) => x.token_id === y.token_id));
    let openN = mine.length;
    for (const id of (m.delist || []).slice(0, 10)) {
      const x = mine.find((y) => y.id === id);
      if (!x) continue;
      const r = await chain.marketDelist(oc.id, id);
      x.open = false; openN--;
      log({ kind: "delisted", clan: oc.id, listing: id, token: x.token_id, title: MK.fairOf(s, x.token_id, FL)?.title ?? null, tx: r.hash, signer: r.signer });
    }
    for (const L of (m.list || []).slice(0, 3)) {
      const x = sell.find((y) => y.token_id === L.token_id);
      if (!x || openN >= 10) continue;
      const price = clampPrice(L.price, x.price);
      const r = await chain.marketList(oc.id, x.token_id, price, L.why);
      openN++;
      // Keep this turn's view of the market true (10 Nov: a trade later in the same turn missed this
      // listing, so it listed the same thing twice or one past the 10-listing limit).
      all.push({ id: r.value, seller: oc.id, token_id: x.token_id, price, kind: x.token_id[0] === "p" ? "sale" : "copy", open: true, reason: String(L.why).slice(0, 200), sold: 0 });
      log({ kind: "listed", clan: oc.id, listing: r.value, token: x.token_id, title: x.title, price, fair: +x.price.toFixed(4), priceWhy: x.why, why: String(L.why).slice(0, 200), tx: r.hash, signer: r.signer });
    }
    const o = offers.find((y) => y.id === m.buy);
    if (!o || o.price >= florins) return 0;
    const r = await buyChecked(oc.id, o.id, m.buy_why, o.token_id);
    if (!r) return 0;
    const l = all.find((y) => y.id === o.id);
    if (l && l.kind === "sale") l.open = false; // a patent is gone for the next nation this run
    log({ kind: "market-buy", clan: oc.id, listing: o.id, seller: o.seller, token: o.token_id, title: o.title, price: o.price, fair: +o.fair.toFixed(4), why: String(m.buy_why).slice(0, 200), tx: r.hash, signer: r.signer });
    await settleSale({ id: r.value, listing: o.id, buyer: oc.id, seller: o.seller, token_id: o.token_id, price: o.price, reason: String(m.buy_why).slice(0, 200) });
    return o.price;
  }
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
  // For the market's words: a nation's name, its florins as the day began, a short number.
  const nameOfClan = (id) => onchain.find((x) => x.id === Number(id))?.name ?? `nation ${id}`;
  // Ring-fenced florins (9 Nov): NEAR the world granted a nation's gods (the founders' DAO costs given
  // back) sits in its treasury as florins, but it's the gods' money, not the nation's to spend.
  // Each turn: granted NEAR / today's florin value is kept out of what the nation spends, so the
  // economy plays as it did before the grants. A world without grants (or the sim) reserves nothing.
  const reserve = {};
  try {
    const fv = BigInt((await chain.totals()).florin_value || "0"); // yocto per florin
    if (fv > 0n && chain.stake) for (const x of onchain) for (const g of x.gods || []) {
      const st = await chain.stake(x.id, g.account).catch(() => null);
      if (st?.granted && BigInt(st.granted) > 0n) reserve[x.id] = (reserve[x.id] || 0) + Number((BigInt(st.granted) * 10n ** 6n) / fv) / 1e6;
    }
    // The site shows what each nation can spend (/api/world spendable): the granted NEAR, so the
    // page can convert it at the florin value of the moment.
    s.grantedNear = Object.fromEntries(Object.entries(reserve).map(([id, f]) => [id, +(f * Number(fv) / 1e24).toFixed(6)]));
  } catch { /* no reserve this turn: the nation can spend what it holds */ }
  const spendable = (id, units) => Math.max(0, toFlorins(units || "0") - (reserve[id] || 0));
  const florinsOf = (id) => spendable(id, onchain.find((x) => x.id === Number(id))?.florins);
  const n4 = (x) => (Math.round(x * 100) / 100).toString();
  const alive = onchain.filter((c) => c.alive);
  const live = INSTANT ? alive.filter((c) => INSTANT.includes(c.id)) : alive;
  // Fair share of the daily Claude cap: a nation at full pace costs about CFG.nationDayUsd a day.
  // With more nations than the cap feeds, every nation slows by the same factor (research turns
  // and draft spacing) instead of the first nations in the loop using the whole day's budget.
  const share = Math.min(1, CFG.citizensCapUsd / (Math.max(1, alive.length) * CFG.nationDayUsd));
  if (share < 1) console.log(`  ${alive.length} nations share the citizens' $${CFG.citizensCapUsd} a day: each runs at ${Math.round(share * 100)}% pace`);

  // Dead clans: their mindmap becomes ruins, unowned.
  for (const c of INSTANT ? [] : onchain.filter((c) => !c.alive)) {
    const st = s.clans[c.id];
    if (st?.alive) {
      st.alive = false;
      for (const [k, v] of Object.entries(st.owned)) if (v.corpus) s.ruins[k] = { ...v, from: c.id };
      log({ kind: "ruins", clan: c.id, points: Object.keys(st.owned).length });
    }
  }
  // A nation that ended (its last god claimed out, or it fell in a war) takes its goods off the
  // market (his call 10 Nov), so nobody buys from a nation that's gone. Its own Broker signs.
  if (!INSTANT && chain.marketListings) {
    const ended = new Set(onchain.filter((c) => !c.alive || s.clans[c.id]?.fallen).map((c) => c.id));
    if (ended.size) {
      const shelf = await chain.marketListings().catch(() => null);
      for (const l of (shelf || []).filter((x) => x.open && ended.has(x.seller))) {
        try {
          const r = await chain.marketDelist(l.seller, l.id);
          log({ kind: "delisted", clan: l.seller, listing: l.id, token: l.token_id, why: "its nation has ended", tx: r?.hash, signer: r?.signer });
        } catch (e) { console.log(`  couldn't take down listing ${l.id} of ended nation ${l.seller}: ${String(e.message || e).slice(0, 140)}`); }
      }
    }
  }

  // Fair share (12 Nov): the nations that waited longest for a Claude turn go first, so when the day's money
  // runs out mid-turn it's the recently served who wait. A nation that made a Claude call is stamped.
  let prevOc = null, prevCalls = meter.calls;
  const stamp = () => { if (prevOc != null && meter.calls > prevCalls && s.clans[prevOc]) s.clans[prevOc].lastThoughtAt = Date.now(); };
  for (const oc of B.fairOrder(live, s)) {
    stamp(); prevOc = oc.id; prevCalls = meter.calls;
    if (!INSTANT && s.inProgress.done.includes(oc.id)) continue;
    const isNew = !s.clans[oc.id];
    const c = s.clans[oc.id] || W.initClan(s, oc);
    // A fallen island (lost a war) takes no more turns: no work, no upkeep. Its gods can still claim.
    if (c.fallen) continue;
    // At war the citizens fight: no research, no Broker, no drafts (see engine/war.mjs).
    const atWar = !!WR.warOf(s, oc.id);
    // A nation state seen for the first time: the 3D world plays its founding.
    if (isNew) log({ kind: "founded", clan: oc.id, name: oc.name, field: c.field, gods: oc.gods.length });
    // Reverence lives outside the turn's try: if research or anything after it throws, the nation's
    // reverence still fades and its record is still written (9 Nov: OpenAlex 429s skipped both).
    let rv = null, revDone = false, agents = [];
    const revCh = [];
    try {
      // Team
      // Top the clan up to the full starting team (only on first sight; the dead stay dead).
      agents = await chain.agents(oc.id);
      if (!c.teamDone) {
        const taken = new Set(Object.values(s.clans).flatMap((x) => Object.keys(x.skills)));
        for (const a of agents) taken.add(a.name);
        const have = {};
        for (const a of agents) if (a.alive) have[a.role] = (have[a.role] || 0) + 1;
        const team = [];
        for (const role of CFG.team) {
          if (have[role] > 0) { have[role]--; continue; }
          const name = newName(taken);
          taken.add(name);
          team.push({ name, role });
          c.skills[name] = {};
        }
        // One transaction for the whole team where the chain can (10 Nov); one call each otherwise.
        if (team.length && chain.spawnMany) await chain.spawnMany(oc.id, team);
        else for (const t of team) await chain.spawn(oc.id, t.name, t.role);
        for (const a of agents) c.skills[a.name] ||= {};
        c.teamDone = true;
        agents = await chain.agents(oc.id);
        log({ kind: "team", clan: oc.id, agents: agents.map((a) => `${a.name} (${a.role})`) });
      }
      // Born (10 Nov): its reverence starts now and the founding, team and reverence go out at once, so
      // the page can raise the island with its people on it. Wallets and the named account follow.
      // (and the founder is the god it follows from the first moment, not from the end of the first turn)
      if (isNew) { RV.ensure(s, oc, day, { fresh: true }); RV.follow(s, oc.id, [], AI_SET); await checkpoint(); }
      const able = (role) => agents.filter((a) => a.role === role && a.alive && a.stunted_until <= day);
      // Their Broker and Patron get their own NEAR wallets on first sight (once per nation).
      // Version 2 (9 Nov): the Broker's market wallet, trader<id>; a nation set up before it gets one now.
      if (c.agentWallets !== 2) {
        try { const made = await chain.ensureAgents(oc.id); c.agentWallets = 2; if (made.length) log({ kind: "wallets", clan: oc.id, accounts: made }); }
        catch (e) { log({ kind: "error", clan: oc.id, error: `agent wallets: ${String(e.message || e).slice(0, 160)}` }); }
      }
      // Gas money (his rule 12 Nov): every turn, instant ones too, a Broker or Patron under 0.1 NEAR is
      // topped up to 0.2 before anything it signs (turn 58: Helios's Broker sat at 0.0303 and two sales failed).
      if (c.agentWallets === 2 && chain.ensureGas) {
        for (const role of ["Broker", "Patron"]) {
          try { const sent = await chain.ensureGas(oc.id, role); if (sent) log({ kind: "gas", clan: oc.id, role, near: sent }); }
          catch (e) { log({ kind: "error", clan: oc.id, error: `gas for the ${role}: ${String(e.message || e).slice(0, 120)}` }); }
        }
      }
      // Its named account (<name>.<world>, his call 9 Nov), once; then each scheduled turn anything
      // sent there goes on to the nation's DAO.
      if (!c.alias) {
        try { const a = await chain.ensureAlias(oc.id); if (a) { c.alias = a; log({ kind: "alias", clan: oc.id, account: a, dao: oc.dao }); } }
        catch (e) { log({ kind: "error", clan: oc.id, error: `named account: ${String(e.message || e).slice(0, 160)}` }); }
      } else if (!INSTANT) {
        try { const f = await chain.forwardAlias(c.alias); if (f) log({ kind: "forwarded", clan: oc.id, account: c.alias, dao: oc.dao, near: f.near, tx: f.hash }); }
        catch (e) { log({ kind: "error", clan: oc.id, error: `forward: ${String(e.message || e).slice(0, 160)}` }); }
      }
      // A new nation's founding, citizens, wallets and named account go out now (10 Nov: they used to wait
      // for the first research, ~1.5 min, so the island stood empty for two minutes after founding).
      if (isNew) await checkpoint();

      // Reverence (SPEC §12m): read what the gods did since last time, then let it shape today.
      // A reverence bug must never cost the nation its day: on any error it falls back to the old
      // rules (the on-chain whisper, no modifiers) and the error is logged.
      let eff = { waiting: false, whisper: oc.whisper, effortMul: 1, mistakeAdd: 0, tricksterMul: 1 };
      try {
        rv = RV.ensure(s, oc, day, { fresh: isNew });
        // The citizens hear a whisper against how their nation is doing right now (his call 9 Nov).
        const hear = async (text) => {
          const war = Object.values(s.wars || {}).find((x) => x.status === "on" && (x.a === oc.id || x.b === oc.id));
          const foe = war ? (war.a === oc.id ? war.b : war.a) : null;
          const pts = Object.keys(c.owned).length, foePts = foe ? Object.keys(s.clans[foe]?.owned || {}).length : 0;
          const recent = rec.filter((r) => r.clan === oc.id || r.buyer === oc.id || r.seller === oc.id).slice(-6).map((r) => `- ${r.kind}${r.point ? `: ${r.point}` : r.title ? `: ${String(r.title).slice(0, 60)}` : ""}`);
          const frontier = Object.keys(c.frontier).slice(0, 5);
          const living = agents.filter((a) => a.alive);
          const situation = [
            war ? `At war with ${nameOfClan(foe)}, round ${war.rounds || 0}: ${pts} points of knowledge left against their ${foePts}. ${war.offer ? `Peace is on offer from ${nameOfClan(war.offer.by)}.` : ""}` : "At peace.",
            `Mood: ${c.mood ?? "unknown"}. Florins to spend: ${Math.round(florinsOf(oc.id))}. Walls: ${Math.round(c.walls || 0)}.`,
            (c.tricksters || 0) ? `${c.tricksters} Trickster(s) have moved in and slip fakes into the research.` : "No Tricksters among them.",
            `Knows ${pts} points; the scholars are looking at: ${frontier.join(", ") || "nothing new"}.`,
            recent.length ? `Lately:\n${recent.join("\n")}` : "",
          ].filter(Boolean).join("\n");
          const keywords = [foe != null ? nameOfClan(foe) : null, war ? "war" : null, war ? "walls" : null, c.mood === "hungry" ? "hungry" : null, (c.tricksters || 0) ? "trickster" : null, ...frontier.slice(0, 3)];
          return hearWhisper({ name: oc.name, field: c.field, temperament: c.mbti, situation, keywords, citizens: living.map((a) => a.name), text });
        };
        // One-time (his go 9 Nov): the whispers that passed between ~18:10 and 18:30 UTC on 9 Nov were
        // never heard (the model's thinking used up the 250-token answer, so the old rule ran instead).
        // Take back what the old rule paid and let the citizens hear them now.
        const reId = REHEAR_9NOV[oc.id];
        if (reId != null && net === "testnet" && !process.env.ADF_SIM_CHAIN && !s.fixes?.reHear9Nov?.[oc.id]) {
          try {
            const p = (await chain.dao(oc.dao, "get_proposals", { from_index: reId, limit: 1 }))?.[0];
            const a = p?.kind?.FunctionCall?.actions?.[0];
            const args = a ? JSON.parse(Buffer.from(a.args, "base64").toString()) : {};
            const god = p?.proposer, g = rv.gods[god];
            if (p?.status === "Approved" && a?.method_name === "whisper" && g) {
              let old = null;
              for (let d = Math.max(1, day - 2); d <= day; d++) {
                const rs = d === day ? rec : (await store.getDay(net, d))?.records || [];
                for (const r of rs) if (r.kind === "reverence" && r.clan === oc.id) for (const ch of r.changes || []) if (ch.god === god && /^whisper( \(|$| heard as words)/.test(ch.why || "")) old = ch;
              }
              if (old) {
                const heard = await hear(String(args.text || ""));
                if (heard?.says) {
                  const bonus = Number(/\(\+([\d.]+) for how/.exec(old.why)?.[1] || 0);
                  const fix = [];
                  g.r = Math.max(0, g.r - old.d);
                  fix.push({ god, d: -old.d, why: "whisper taken back: it was scored by the old rule because the citizens' answer was cut off" });
                  g.whispers.pop();
                  g.flourish = bonus / RV.REV.flourishPerPoint;
                  RV.act(rv, god, "whisper", day, fix, { text: args.text, heard });
                  log({ kind: "correction", clan: oc.id, changes: fix, why: "A whisper on 9 Nov was scored by the old rule because the citizens' answer was cut off. They have heard it now." });
                  log({ kind: "heard", clan: oc.id, god, text: String(args.text || "").slice(0, 200), delta: Math.max(RV.REV.heardMin, Math.min(RV.REV.heardMax, Number(heard.delta) || 0)), verdict: heard.verdict ?? null, citizen: heard.citizen ?? null, says: String(heard.says).slice(0, 220) });
                }
              }
            }
          } catch (e) { console.log(`  re-hearing nation ${oc.id}'s whisper failed: ${String(e.message || e).slice(0, 160)}`); }
          s.fixes = { ...(s.fixes || {}), reHear9Nov: { ...(s.fixes?.reHear9Nov || {}), [oc.id]: Date.now() } };
        }
        const acts = await RV.godActions({ chain, s, oc, rv, day, changes: revCh, hear });
        for (const r of acts) log(r);
        if (acts.length) c.lastActAt = Date.now(); // a god acted: no Trickster for 24 hours
        // Ask the accused (PLAN_13NOV step 2, engine/ask.mjs): this turn's asks, then the accused answer (instant turns too).
        for (const r of AK.markAsked(s, CHOICES, oc.id, day)) log(r);
        for (const r of await AK.answerAsked(s, oc.id, agents, day, (x) => accusedReply({ ...x, nation: oc.name, temperament: c.mbti }))) log(r);
        RV.follow(s, oc.id, revCh, AI_SET);
        const fol = rv.followed && rv.gods[rv.followed];
        if (fol?.outsider) fol.text = Object.values(s.rev).find((o) => o !== rv && o.followed === rv.followed)?.gods[rv.followed]?.text ?? fol.text;
        eff = RV.effects(rv);
        if (eff.waiting) log({ kind: "waiting", clan: oc.id, note: "the citizens wait in the plaza for their god's first whisper" });
      } catch (e) { rv = null; log({ kind: "error", clan: oc.id, error: `reverence: ${String(e.message || e).slice(0, 180)}` }); }

      // Needs (SPEC §14): the NEAR the citizens want each real day, which keeps growing. Blessings
      // in the last real day against it: under half = hungry (-20% work, reverence fades faster),
      // over twice = sated (-40% work), otherwise content. The founding deposit isn't a blessing,
      // and a nation's first real day is always content. Need is per nation: gods share it.
      const now = Date.now();
      c.bornAt ||= now;
      c.lastActAt ||= now;
      const totalIn = toNear(oc.total_in);
      if (c.lastTotalIn == null) c.lastTotalIn = totalIn;
      if (totalIn > c.lastTotalIn + 1e-6) { (c.blessings ||= []).push({ at: now, near: +(totalIn - c.lastTotalIn).toFixed(6) }); c.lastActAt = now; }
      c.lastTotalIn = totalIn; // a claim lowers it
      c.blessings = (c.blessings || []).filter((b) => now - b.at < 86400e3);
      const ageDays = (now - c.bornAt) / 86400e3;
      const living = agents.filter((a) => a.alive && a.role !== "Trickster").length;
      const need = +(CFG.needs.base * living * CFG.needs.growth ** ageDays * CFG.needs.techStep ** (c.techs?.length || 0)).toFixed(4);
      const fed = c.blessings.reduce((a, b) => a + b.near, 0) / need;
      const mood = ageDays < 1 ? "content" : fed < CFG.needs.hungryBelow ? "hungry" : fed > CFG.needs.satedAbove * (W.hasTech(c, "bookkeeping") ? 1.5 : 1) ? "sated" : "content";
      if (!INSTANT && mood !== c.mood) log({ kind: "needs", clan: oc.id, mood, need, fed: +fed.toFixed(2), was: c.mood ?? null });
      c.mood = mood; c.need = need;
      const lazy = mood === "sated" ? CFG.richLazy : mood === "hungry" ? CFG.needs.hungrySlow : 0;
      // Tricksters come only to a nation whose gods have done nothing for 24 real hours.
      const silent = now - c.lastActAt > CFG.needs.silenceMs;
      // At most two living Tricksters per nation, the second a real day after the first.
      if (!INSTANT && silent && W.tricksterMayCome(c, agents, now) && chance(CFG.neglectTrickster * eff.tricksterMul)) {
        const name = newName(new Set(Object.values(s.clans).flatMap((x) => Object.keys(x.skills))));
        await chain.spawn(oc.id, name, "Trickster");
        c.skills[name] = {};
        c.tricksters++;
        c.lastTricksterAt = now;
        log({ kind: "trickster", clan: oc.id, name });
      }
      const effort = w.pace * (1 - lazy) * c.fortune * eff.effortMul;

      const before = new Set(Object.keys(c.owned));
      // Florins (SPEC §14): what the nation holds now (kept in step with today's trades), and what
      // it earns this turn (minted once at the end of the turn, to save gas).
      let wallet = spendable(oc.id, oc.florins); // less the gods' ring-fenced grant
      let earned = 0, earnedFor = [];

      // Broker: once a day, buy a corpus from another clan whose papers are tagged with one of
      // this clan's open points (OpenAlex keyword tags = the papers are really about it).
      if (!atWar && able("Broker").length && chance(Math.min(1, effort))) {
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
        // No exact match (the usual case across fields): once a real day, the Broker reads the
        // rivals' research and picks the one piece that truly helps an open question, or nothing.
        if (!deal && !INSTANT && Date.now() - (c.lastBrokerAskAt || 0) >= CFG.draftEveryMs && !capped("agent")) {
          const offers = [];
          for (const o of Object.values(s.clans)) {
            if (!o.alive || o.id === oc.id) continue;
            for (const [k, v] of Object.entries(o.owned)) {
              const sc = s.corpora[v.corpus];
              if (sc?.clean && sc.clan === o.id && !Object.values(c.owned).some((x) => x.corpus === sc.id)) offers.push({ id: sc.id, title: sc.title, about: k, seller: o.id, sc });
            }
          }
          const open = Object.entries(c.frontier).sort((a, b) => a[1].depth - b[1].depth).slice(0, 30).map(([p]) => p);
          if (offers.length && open.length) {
            c.lastBrokerAskAt = Date.now(); // only a real look at a real market uses up the day's ask
            const pickFrom = offers.slice(-25);
            try {
              const pick = await brokerPick({ field: c.field, open, offers: pickFrom.map(({ sc, ...o }) => o), temperament: c.mbti });
              const o = pick.buy && pickFrom.find((x) => x.id === pick.corpus);
              if (o && c.frontier[pick.point]) deal = { point: pick.point, seller: o.seller, sellerPoint: o.about, sc: o.sc, why: String(pick.why || "").slice(0, 200) };
              else log({ kind: "broker", clan: oc.id, bought: false, why: String(pick.why || "nothing on offer helps yet").slice(0, 200) });
            } catch (e) { log({ kind: "error", clan: oc.id, error: `broker: ${String(e.message || e).slice(0, 160)}` }); }
          }
        }
        if (deal) {
          const holders = Object.values(s.clans).filter((o) => Object.values(o.owned).some((v) => s.corpora[v.corpus]?.children.includes(deal.point))).length;
          const depth = c.frontier[deal.point].depth;
          // The price and its sum (engine/prices.mjs). Scarcity counts every nation alive, also on an
          // instant turn (which only runs one nation).
          const { price, why: priceWhy } = researchPrice({ base: FL.corpusBase, depth, nations: alive.length, holders, astrolabe: W.hasTech(c, "astrolabe") });
          // The merchant's reason: the Broker's own words when it chose, or the rule that made the match.
          deal.why ||= `it's the exact point our Scholars were stuck on ("${deal.point}")`;
          // Through the market (his call 9 Nov): the seller names its price, the buyer takes it or walks.
          let md = null;
          if (wallet > price * 0.5) {
            try { md = await marketDeal({ buyer: oc.id, seller: deal.seller, token: `r:${deal.sc.id}`, fair: price, fairWhy: priceWhy, item: `research on "${deal.sc.title || deal.sellerPoint}"`, holders, wallet, buyerWhy: deal.why }); }
            catch (e) { md = { failed: true }; log({ kind: "error", clan: oc.id, error: `market deal: ${String(e.message || e).slice(0, 160)}` }); }
          }
          if (md?.walked && !md.quiet) log({ kind: "broker", clan: oc.id, bought: false, wanted: deal.point, seller: deal.seller, price: md.ask.price, fair: price, why: md.ask.price >= wallet ? `couldn't afford the ${n4(md.ask.price)} florins ${nameOfClan(deal.seller)} asked` : `walked away: ${nameOfClan(deal.seller)} asked ${n4(md.ask.price)} florins, more than twice the fair ${n4(price)}` });
          else if (!md && wallet <= price) log({ kind: "broker", clan: oc.id, bought: false, wanted: deal.point, seller: deal.seller, price, why: `couldn't afford it: ${deal.why}` });
          const paid = md?.price ?? (md === null && wallet > price ? price : null);
          if (paid != null) {
            const r = md ? { hash: md.buy.hash, signer: md.buy.signer } : await agentBuy(oc.id, deal.seller, price, `corpus:${deal.sc.id}`);
            wallet -= paid;
            c.owned[deal.point] = { depth, parent: c.frontier[deal.point].parent, corpus: deal.sc.id, how: `bought from clan ${deal.seller}` };
            delete c.frontier[deal.point];
            W.grow(c, deal.point, deal.sc.children);
            log({ kind: "trade", buyer: oc.id, seller: deal.seller, point: deal.point, corpus: deal.sc.id, about: deal.sellerPoint, price: paid, fair: price, priceWhy, ...(md ? { listing: md.ask.listing, sale: md.sale.id, standing: !!md.ask.standing, sellerWhy: md.ask.why, listTx: md.listTx } : {}), tx: r.hash, signer: r.signer ?? "operator", why: deal.why });
            if (md) await settleSale(md.sale, { applied: true }); // its token copy, now
            await owe(MK.royaltiesFor(s, [deal.point, deal.sc.node], oc.id)); // patent royalties, now
            // The seller's Printing Press: copies are cheap, so each sale earns it a little more.
            if (W.hasTech(s.clans[deal.seller], "press")) {
              try { await chain.mint(deal.seller, FL.pressSale, `printing press: sale to ${oc.id}`); }
              catch (e) { log({ kind: "error", clan: deal.seller, error: `press mint: ${String(e.message || e).slice(0, 160)}` }); }
            }
          }
        }
      }

      // The Broker's market day (his calls 9 Nov: the marketplace is the agents' alone). Once a real
      // day it lists, takes down or buys, from its own trader wallet, in the nation's florins.
      // Off until the marketplace is proven on testnet (step 5.5): ADF_MARKET=1 turns it on.
      // Whispering to the Broker (PLAN_13NOV step 3, engine/brokerword.mjs): this turn's list request, heard once per
      // request; the Broker listens by the god's reverence (one roll per god, nation and turn). If it listens, the
      // market day runs now, instant turns too, with those items first.
      let must = [], askedBy = null;
      const listCh = CHOICES.find((x) => x.kind === "list" && Number(x.clan) === oc.id);
      if (listCh && MARKET_ON && able("Broker").length && c.agentWallets === 2) {
        const key = `${day}|${oc.id}|${listCh.account}|${JSON.stringify(listCh.payload?.tokens || [])}`;
        s.listDone ||= {};
        for (const k of Object.keys(s.listDone)) if (Number(k.split("|")[0]) < day - 24) delete s.listDone[k];
        if (!s.listDone[key]) {
          s.listDone[key] = true;
          const ear = BW.hears({ r: rv?.gods?.[listCh.account]?.r ?? 0, seed: BW.seedOf({ day, clan: oc.id, god: listCh.account, world: chain.world }) });
          if (ear.listens) { must = BW.mustList(listCh.payload.tokens, MK.sellable(s, oc.id, FL), ((await listingsNow()) || []).filter((l) => l.open && l.seller === oc.id)); askedBy = listCh.account; }
          log({ kind: "broker-word", clan: oc.id, god: listCh.account, tokens: listCh.payload.tokens, listens: ear.listens, ignored: ear.ignored, chance: ear.chance, roll: ear.roll, listing: must.map((x) => x.token_id) });
        }
      }
      if (MARKET_ON && able("Broker").length && c.agentWallets === 2 && !capped("agent") && (must.length || (!INSTANT && Date.now() - (c.lastMarketAt || 0) >= CFG.draftEveryMs))) {
        try { wallet -= await marketDay(oc, c, wallet, must, askedBy); }
        catch (e) { log({ kind: "error", clan: oc.id, error: `market: ${String(e.message || e).slice(0, 160)}` }); }
      }

      // Research: each able Scholar takes its turns on the Patron's chosen point.
      // An instant turn: one research turn by one Scholar (in turn), not the day's full share.
      const scholars = eff.waiting || atWar || (INSTANT && NO_RESEARCH.has(oc.id)) ? [] : able("Scholar");
      const instantScholar = INSTANT ? scholars[(c.instantTurns = (c.instantTurns || 0) + 1) % Math.max(1, scholars.length)] : null;
      for (const sch of scholars) {
        if (INSTANT && sch !== instantScholar) continue;
        const target = pickTarget(c, pitchPick(oc.id), `${day}|${oc.id}`); // the Scholars' pitch: the god's pick, else the dice (PLAN_13NOV step 1)
        const skill = c.skills[sch.name]?.[target] || 0;
        for (let t = 0; t < (INSTANT ? 1 : turns(CFG.scholarTurnsPerDay * share * effort * (1 + skill) * (w.phase === "night" && !W.hasTech(c, "spectacles") ? CFG.nightPace : 1))); t++) {
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
          log({ kind: "corpus", clan: oc.id, scholar: sch.name, point: topic, title: corpus.title, cites: check.cites, fake: check.fake.length, stir: corpus.stir ?? "calm", stir_why: corpus.stir_why || undefined, hash: W.sha256(JSON.stringify(s.corpora[id])) });
          if (check.clean) {
            const depth = node ? c.frontier[node].depth : 0;
            c.owned[topic] = { depth, parent, corpus: id, how: "researched", stir: corpus.stir ?? "calm", ...(corpus.stir_why ? { stir_why: corpus.stir_why } : {}) };
            delete c.frontier[topic];
            W.grow(c, topic, children);
            W.learn(c, sch.name, topic);
            earned += FL.corpus; earnedFor.push(id);
            await mintNow(oc.id, `r:${id}`, corpus.title); // the research is a token on NEAR now
          } else {
            // The fine comes out of the nation's own florins, never the gods' ring-fenced grant.
            const fine = Math.min(FL.fine, wallet);
            const r = fine > 0 ? await chain.burn(oc.id, fine, `fake citation in ${id}`) : { value: "0", hash: null };
            wallet = Math.max(0, wallet - FL.fine);
            log({ kind: "warden", clan: oc.id, catch: id, fake: check.fake, fine: toFlorins(r.value), tx: r.hash });
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
        await mintNow(oc.id, `k:${id}`, `Figure kit from ${nameOfClan(oc.id)}`);
      }

      // Drafter
      const depth = W.chainDepth(c);
      // A new nation's first draft comes as soon as its line is deep enough (its first gift to rule on).
      const draftDue = INSTANT ? FRESH && !c.firstDraftDone : Date.now() - (c.lastDraftAt || 0) >= CFG.draftEveryMs / share && chance(Math.min(1, effort));
      if (!eff.waiting && !atWar && able("Drafter").length && depth >= CFG.draftMinDepth && draftDue && !capped("draft")) {
        c.firstDraftDone = true;
        if (!c.hasKit) {
          const kit = Object.values(s.tools).find((t) => t.clan !== oc.id && s.clans[t.clan]?.alive);
          const { price: kp, why: priceWhy } = kitPrice({ base: FL.kit });
          const kitWhy = "our Drafter wants figures before the next patent draft: a kit halves its mistakes";
          let md = null;
          if (kit && wallet > kp * 0.5) {
            try { md = await marketDeal({ buyer: oc.id, seller: kit.clan, token: `k:${kit.id}`, fair: kp, fairWhy: priceWhy, item: `a figure kit from ${nameOfClan(kit.clan)}`, holders: null, wallet, buyerWhy: kitWhy }); }
            catch (e) { md = { failed: true }; log({ kind: "error", clan: oc.id, error: `market deal (kit): ${String(e.message || e).slice(0, 160)}` }); }
          }
          if (md?.walked && !md.quiet) log({ kind: "broker", clan: oc.id, bought: false, wanted: "a figure kit", seller: kit.clan, price: md.ask.price, fair: kp, why: `walked away: ${nameOfClan(kit.clan)} asked ${n4(md.ask.price)} florins for its kit` });
          const kpaid = md?.price ?? (kit && md === null && wallet > kp ? kp : null);
          if (kit && kpaid != null) {
            const r = md ? { hash: md.buy.hash, signer: md.buy.signer } : await agentBuy(oc.id, kit.clan, kp, `tool:${kit.id}`);
            wallet -= kpaid;
            c.hasKit = true;
            (c.kits ||= []).push(kit.id); // its copy of the kit token (engine/tokens.mjs)
            log({ kind: "trade", buyer: oc.id, seller: kit.clan, tool: kit.id, price: kpaid, fair: kp, priceWhy, ...(md ? { listing: md.ask.listing, sale: md.sale.id, sellerWhy: md.ask.why, listTx: md.listTx } : {}), tx: r.hash, signer: r.signer ?? "operator", why: kitWhy });
            if (md) await settleSale(md.sale, { applied: true });
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
        const r = await chain.giftDraft(oc.id, hash, check.passed);
        s.gifts[r.value] = { clan: oc.id, draft: id, day, at: Date.now(), applied: false };
        c.lastDraftDay = day;
        c.lastDraftAt = Date.now();
        // A passed draft earns florins (gods no longer claim drafts): 60% to this nation, 40% to
        // the other living nations whose research is in its chain, by how much of it.
        const shares = {};
        if (check.passed) {
          c.passedDrafts = (c.passedDrafts || 0) + 1;
          const by = {};
          for (const k of nodes) { const a = s.corpora[c.owned[k].corpus]?.clan; if (a != null && a !== oc.id && s.clans[a]?.alive) by[a] = (by[a] || 0) + 1; }
          const n = Object.values(by).reduce((x, y) => x + y, 0);
          const own = n ? FL.draft * FL.draftOwn : FL.draft;
          earned += own; earnedFor.push(id); shares[oc.id] = own;
          for (const [o, k] of Object.entries(by)) {
            const fl = +((FL.draft - own) * (k / n)).toFixed(4);
            try { await chain.mint(Number(o), fl, `their research in draft ${id}`); shares[o] = fl; }
            catch (e) { log({ kind: "error", clan: Number(o), error: `mint share: ${String(e.message || e).slice(0, 160)}` }); }
          }
        }
        log({ kind: "gift", clan: oc.id, draft: id, title: draft.title, passed: check.passed, problems: check.problems, florins: shares, gift: r.value, tx: r.hash });
        if (check.passed) await mintNow(oc.id, `p:${id}`, draft.title); // a passed draft is a patent token now
      }

      // Techs (SPEC §14): any the nation is ready for unlock now, each with a florin bonus.
      for (const t of W.TECHS) {
        if (W.hasTech(c, t.id) || !t.ready(c)) continue;
        if (!W.techAllowed(c, Date.now())) break; // one a real day, none on day one
        c.lastTechAt = Date.now();
        (c.techs ||= []).push(t.id);
        earned += FL.tech; earnedFor.push(t.id);
        log({ kind: "tech", clan: oc.id, tech: t.id, name: t.name, does: t.does, florins: FL.tech });
      }
      // The turn's earnings, minted at once (the record says what for).
      if (earned > 0) {
        try {
          const r = await chain.mint(oc.id, earned, `work on day ${day}: ${earnedFor.join(",")}`.slice(0, 190));
          wallet += earned;
          log({ kind: "mint", clan: oc.id, florins: earned, for: earnedFor, tx: r?.hash });
        } catch (e) { log({ kind: "error", clan: oc.id, error: `mint: ${String(e.message || e).slice(0, 180)}` }); }
      }
      // Upkeep in batches: florins burned per citizen per real day, for the real hours since the last.
      c.lastUpkeepAt ||= Date.now(); // upkeep counts from first sight
      const upkeepHours = (Date.now() - c.lastUpkeepAt) / 3600e3;
      if (!INSTANT && upkeepHours >= CFG.upkeepEveryHours) {
        const n = agents.filter((a) => a.alive).length;
        // Out of the nation's own florins only (the gods' ring-fenced grant stays whole): a nation that
        // can't pay feeds its citizens what it has.
        const amount = Math.min(wallet, +((FL.upkeep / 24) * n * upkeepHours * (W.hasTech(c, "clock") ? 0.7 : 1)).toFixed(4));
        const r = amount > 0 ? await chain.burn(oc.id, amount, `upkeep for ${n} citizens`) : { value: "0", hash: null };
        wallet = Math.max(0, wallet - amount);
        c.lastUpkeepDay = day;
        c.lastUpkeepAt = Date.now();
        log({ kind: "upkeep", clan: oc.id, agents: n, florins: amount, paid: toFlorins(r.value), tx: r.hash });
      }
      // Reverence at the end of the turn: how the nation did, the fade, reports, who they follow.
      if (rv) try {
      const mine = rec.slice(turnStart).filter((r) => r.clan === oc.id || r.buyer === oc.id);
      const cleanCorpora = mine.filter((r) => r.kind === "corpus" && !r.fake).length;
      const gifts = mine.filter((r) => r.kind === "gift");
      const catches = mine.filter((r) => r.kind === "warden").length;
      RV.flourish(rv, cleanCorpora + gifts.filter((g) => g.passed).length * 3 - catches);
      for (const g of gifts) if (g.passed) RV.nationEvent(rv, "cleanGift", revCh);
      for (let k = 0; k < catches; k++) RV.nationEvent(rv, "wardenCatch", revCh);
      const nowAgents = await chain.agents(oc.id);
      const living = nowAgents.filter((a) => a.alive);
      if (!INSTANT) RV.fade(rv, day, new Set(living.map((a) => a.name)), revCh, c.mood === "hungry" ? CFG.needs.hungryFade : 1); // the fade is per day
      if (!INSTANT) RV.stirDrift(rv, c, revCh); // faith and doubt in what the nation knows
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
      RV.follow(s, oc.id, revCh, AI_SET);
      log(RV.record(rv, oc.id, revCh));
      revDone = true;
      } catch (e) { revDone = true; log({ kind: "error", clan: oc.id, error: `reverence: ${String(e.message || e).slice(0, 180)}` }); }
    } catch (e) {
      log({ kind: "error", clan: oc.id, error: String(e.message || e).slice(0, 200) });
      // The turn broke before its reverence step: still fade, drift, lapse reports and write the record.
      if (rv && !revDone) {
        try {
          const living = (await chain.agents(oc.id)).filter((a) => a.alive);
          if (!INSTANT) RV.fade(rv, day, new Set(living.map((a) => a.name)), revCh, c.mood === "hungry" ? CFG.needs.hungryFade : 1);
          if (!INSTANT) RV.stirDrift(rv, c, revCh);
          if (!INSTANT) for (const r of RV.lapseReports(s, rv, oc.id, day, revCh)) log(r);
          RV.follow(s, oc.id, revCh, AI_SET);
          log(RV.record(rv, oc.id, revCh));
        } catch (e2) { log({ kind: "error", clan: oc.id, error: `reverence: ${String(e2.message || e2).slice(0, 180)}` }); }
      }
    }
    stamp(); prevOc = null; // stamped before the checkpoint saves it
    if (!INSTANT) s.inProgress.done.push(oc.id);
    await checkpoint();
    if (stopRequested) { console.log("  checkpointed; exiting so the next run resumes this day"); await store.close(); process.exit(0); }
  }
  stamp(); // a last nation that left the loop early
  // The OpenAlex line (75% of today's credits) crossed: one record a UTC day, so it shows in the world.
  if (openAlexCut() && s.openAlexCutOn !== today) {
    s.openAlexCutOn = today;
    const b = openAlexBudget();
    log({ kind: "budget", source: "openalex", remaining: b?.remaining ?? null, limit: b?.limit ?? null, note: "75% of today's OpenAlex searches used: research reads the paper cache until midnight UTC" });
  }

  // An instant turn ends here: no rulings sweep, fees, root or new day (the next day does those).
  if (INSTANT) {
    s.spend.usd = spendBase + meter.usd;
    await store.saveState(net, s);
    await store.seatBuysSealed(seatsSealed).catch((e) => console.log(`  seats: not marked sealed: ${e.message}`));
    console.log(`  instant turn for ${INSTANT.join(",")} done: ${rec.length} pending records | LLM this run: ${meter.calls} calls, $${meter.usd.toFixed(4)}`);
    break;
  }

  // War (the finale, his call 8 Nov): councils, then one round of every war. Scheduled turns only.
  if (!INSTANT) {
    try { await warPhase(); } catch (e) { log({ kind: "error", error: `war: ${String(e.message || e).slice(0, 200)}` }); }
  }
  async function warPhase() {
    s.wars ||= {}; s.peace ||= {};
    const now = Date.now();
    const chainNow = await chain.clans();
    const fl = Object.fromEntries(chainNow.map((x) => [x.id, spendable(x.id, x.florins)])); // war spends only what's the nation's
    const nameOf = (id) => chainNow.find((x) => x.id === id)?.name ?? `nation ${id}`;
    const standing = chainNow.filter((x) => x.alive && s.clans[x.id] && !s.clans[x.id].fallen);
    const seed = s.roots[day - 1] ?? s.roots[Math.max(0, ...Object.keys(s.roots).map(Number))] ?? "genesis";
    const bought = (buyer, seller) => Object.values(s.clans[buyer]?.owned || {}).filter((v) => v.how === `bought from clan ${seller}`).length;
    const view = (x) => ({ id: x.id, name: x.name, field: s.clans[x.id].field, hp: WR.hp(s.clans[x.id]), techs: s.clans[x.id].techs?.length || 0, florins: +(fl[x.id] || 0).toFixed(1), walls: +(s.clans[x.id].walls || 0).toFixed(1) });

    // 1. War councils: once a real day for every nation that's fair game.
    for (const x of standing) {
      const c = s.clans[x.id];
      if (!WR.eligible(s, x.id) || now - (c.lastCouncilAt || 0) < WR.WAR.councilEveryMs || capped("council")) continue;
      c.lastCouncilAt = now;
      const w = WR.warOf(s, x.id), enemy = w ? (w.a === x.id ? w.b : w.a) : null;
      const rivals = standing.filter((y) => y.id !== x.id).map((y) => ({ ...view(y), atWar: !!WR.warOf(s, y.id), fairGame: WR.eligible(s, y.id), weBought: bought(x.id, y.id), theyBought: bought(y.id, x.id) }));
      let move;
      try {
        move = await warCouncil({ me: view(x), rivals, temperament: c.mbti, war: w && { enemy, rounds: w.rounds || 0, enemyHp: WR.hp(s.clans[enemy]), offerFromThem: w.offer && w.offer.by !== x.id, offerFromUs: w.offer?.by === x.id } });
      } catch (e) { log({ kind: "error", clan: x.id, error: `war council: ${String(e.message || e).slice(0, 160)}` }); continue; }
      const reason = String(move.reason || "").slice(0, 200);
      const rule = WR.allowed(s, x.id, move, fl, now);
      if (!rule.ok) { log({ kind: "council", clan: x.id, action: move.action, target: move.target || null, reason, refused: rule.why }); continue; }
      if (move.action === "declare") {
        const id = `w${s.nextId++}`, t = Number(move.target);
        s.wars[id] = { id, a: x.id, b: t, status: "on", startedDay: day, startedAt: now, rounds: 0, reason };
        log({ kind: "war", war: id, attacker: x.id, defender: t, reason });
        // Act of God on a bully (engine/fire.mjs): picking on a nation with a third of its florins or
        // less brings fire down on the attacker as it declares, before its first attack.
        if (FIRE.isBully(fl[x.id] || 0, fl[t] || 0)) {
          try {
            const dmg = FIRE.damage(fl, x.id, c.walls || 0);
            if (dmg.florins > 0) {
              const r = await chain.burn(x.id, dmg.florins, `act of god: bully, war on ${nameOf(t)}`.slice(0, 200));
              const burned = r?.value != null ? toFlorins(r.value) : dmg.florins;
              fl[x.id] = Math.max(0, (fl[x.id] || 0) - burned);
              log({ kind: "fire", clan: x.id, cause: "bully", why: `${nameOf(x.id)} declared war on ${nameOf(t)}, a nation with a third of its florins or less`, against: t, ...dmg, florins: +burned.toFixed(4), tx: r?.hash ?? null, signer: "operator" });
            }
          } catch (e) { log({ kind: "error", clan: x.id, error: `act of god (bully): ${String(e.message || e).slice(0, 160)}` }); }
        }
      } else if (move.action === "fortify") {
        const amt = +((fl[x.id] || 0) * WR.WAR.fortifyFrac).toFixed(4);
        if (amt > 0.01) {
          const r = await agentSpend(x.id, amt, "walls");
          const spent = toFlorins(r.value);
          fl[x.id] -= spent; c.walls = (c.walls || 0) + spent;
          log({ kind: "fortify", clan: x.id, spent, walls: +c.walls.toFixed(2), reason, tx: r.hash, signer: r.signer ?? "operator" });
        }
      } else if (move.action === "offer_peace") {
        w.offer = { by: x.id, day, reason };
        log({ kind: "peace-offer", war: w.id, clan: x.id, to: enemy, reason });
      } else if (move.action === "accept_peace") {
        w.status = "peace"; w.endedDay = day; s.peace[WR.pairKey(w.a, w.b)] = now;
        log({ kind: "peace", war: w.id, a: w.a, b: w.b, by: x.id, rounds: w.rounds || 0, reason });
      } else log({ kind: "council", clan: x.id, action: "hold", reason });
    }

    // 2. One round of every war on.
    for (const w of Object.values(s.wars).filter((v) => v.status === "on")) {
      const o = WR.round(s, w, seed, fl);
      for (const id of [w.a, w.b]) {
        const sp = o.sides[id].spend;
        if (sp > 0.0001) { try { const r = await agentSpend(id, sp, `war chest ${w.id}`); fl[id] -= toFlorins(r.value); } catch (e) { log({ kind: "error", clan: id, error: `war chest: ${String(e.message || e).slice(0, 120)}` }); } }
      }
      log({ kind: "battle", ...o });
      const downA = WR.hp(s.clans[w.a]) <= 0, downB = WR.hp(s.clans[w.b]) <= 0;
      // Broke too long: it surrenders and falls like a beaten nation.
      const gaveUp = !downA && !downB ? WR.surrenders(w) : null;
      if (gaveUp != null) { await fall(w, gaveUp === w.a ? w.b : w.a, gaveUp, true); continue; }
      if (!downA && !downB) continue;
      // Both down in the same round: the one with more money left holds on.
      const loser = downA && downB ? (fl[w.a] < fl[w.b] ? w.a : w.b) : downA ? w.a : w.b, winner = loser === w.a ? w.b : w.a;
      await fall(w, winner, loser);
    }

    async function fall(w, winner, loser, surrendered = false) {
      const L = s.clans[loser], Wc = s.clans[winner];
      w.status = "won"; w.winner = winner; w.endedDay = day;
      L.fallen = { day, by: winner, war: w.id };
      // Half its florins go to the winner; the other half stays, claimable by its gods (his pick b).
      const loot = +((fl[loser] || 0) * WR.WAR.plunder).toFixed(4);
      let tx = null;
      if (loot > 0.0001) { try { tx = (await chain.trade(loser, winner, loot, `plunder: ${w.id}`)).hash; } catch (e) { log({ kind: "error", clan: winner, error: `plunder: ${String(e.message || e).slice(0, 120)}` }); } }
      const taken = WR.takeKnowledge(Wc, L, loser);
      const names = new Set(Object.values(s.clans).flatMap((x) => Object.keys(x.skills || {})));
      const refugees = [];
      for (let i = 0; i < WR.WAR.refugees; i++) {
        const name = newName(names); names.add(name);
        const role = i === 0 ? "Scholar" : "Smith";
        try { await chain.spawn(winner, name, role); Wc.skills[name] = {}; refugees.push(`${name} (${role})`); } catch (e) { log({ kind: "error", clan: winner, error: `refugee: ${String(e.message || e).slice(0, 120)}` }); }
      }
      log({ kind: "fallen", war: w.id, clan: loser, name: nameOf(loser), by: winner, byName: nameOf(winner), rounds: w.rounds, ...(surrendered ? { surrendered: true } : {}), loot, knowledge: taken.length, refugees, tx });
    }
  }

  // The market's sales since last time teach their buyers; then patent royalties are paid (before
  // the token sync, so a bought copy is minted this same turn).
  if (!INSTANT) {
    try { await settleMarket(); } catch (e) { log({ kind: "error", error: `market settle: ${String(e.message || e).slice(0, 200)}` }); }
  }
  async function settleMarket() {
    const sales = await chain.marketSales(s.marketSeen || 0);
    // Sales made this turn were completed on the spot (settleSale); this picks up anything else.
    for (const sale of sales || []) {
      s.marketSeen = sale.id + 1;
      await settleSale(sale);
    }
    for (const [clan, due] of Object.entries(s.royaltyDue || {})) {
      try {
        const r = await chain.mint(Number(clan), due.florins, `patent royalties: ${[...new Set(due.patents)].join(",")}`.slice(0, 200));
        // per: what each patent earned in this payment (the marketplace page sums these from the records).
        const per = {};
        for (const p of due.patents) per[p] = +((per[p] || 0) + FL.royalty).toFixed(4);
        log({ kind: "royalty", clan: Number(clan), florins: +due.florins.toFixed(4), patents: [...new Set(due.patents)], per, sales: due.n, tx: r?.hash ?? null });
      } catch (e) { log({ kind: "error", clan: Number(clan), error: `royalty: ${String(e.message || e).slice(0, 160)}` }); }
    }
    s.royaltyDue = {};
  }

  // Research, patents and kits as NEP-245 tokens held by each nation's DAO (engine/tokens.mjs):
  // mint whatever the records say a nation holds and the chain doesn't have yet. Every turn, the
  // instant ones too (his call 9 Nov: research becomes a token in the same turn it's written; it used
  // to wait for the next scheduled turn). At most 150 a turn.
  try { await mtSync(); } catch (e) { log({ kind: "error", error: `tokens: ${String(e.message || e).slice(0, 200)}` }); }
  async function mtSync() {
    const chainNow = await chain.clans();
    // Held by each nation's Broker, in its own wallet (his call 9 Nov), once the wallet exists.
    const holderOf = (id) => (s.clans[id]?.agentWallets ? chain.agentId(id, "Broker") : null);
    // Anything still in a nation's DAO (the first mints of 9 Nov) or its retired Broker wallet moves
    // to its current Broker first. Checked until a nation's move comes back empty, then never again.
    for (const x of chainNow) {
      const c = s.clans[x.id];
      if (!holderOf(x.id) || c.tokensSettled === 2) continue;
      let moved = 0, r;
      do { r = await chain.mtMoveToBroker(x.id); moved += r.moved; } while (r.moved > 0);
      c.tokensSettled = 2;
      if (moved) log({ kind: "tokens-moved", clan: x.id, to: holderOf(x.id), kinds: moved, tx: r.hash });
    }
    const list = TK.toMint(s, holderOf).slice(0, 150);
    if (!list.length) return;
    s.mtDone ||= [];
    // Anything already on NEAR (a record lost on our side) is marked done, never minted twice.
    const fresh = [];
    const byOwner = {};
    for (const m of list) (byOwner[m.owner_id] ||= []).push(m);
    for (const [owner, items] of Object.entries(byOwner)) {
      const have = await chain.mtBalances(owner, items.map((m) => m.token_id));
      if (have == null) return; // the world contract has no tokens yet
      items.forEach((m, i) => (BigInt(have[i] || 0) > 0n ? s.mtDone.push(m.key) : fresh.push(m)));
    }
    for (let i = 0; i < fresh.length; i += 50) {
      const part = fresh.slice(i, i + 50);
      const r = await chain.mtMint(part.map((m) => ({ token_id: m.token_id, owner_id: m.owner_id, amount: "1", title: m.title })), `turn ${day}`);
      s.mtDone.push(...part.map((m) => m.key));
      const n = (p) => part.filter((m) => m.token_id.startsWith(p)).length;
      log({ kind: "tokens", minted: part.length, research: n("r:"), patents: n("p:"), kits: n("k:"), tx: r.hash });
    }
  }

  // Act of God (engine/fire.mjs): fire the gods called this turn, then (scheduled turns only) the
  // heavens' own. Any failure is logged and skipped; it never stops the turn.
  try { await firePhase(); } catch (e) { log({ kind: "error", error: `act of god: ${String(e.message || e).slice(0, 200)}` }); }
  async function firePhase() {
    const queue = (s.fire ||= {}).queue || [];
    s.fire.queue = [];
    if (!queue.length && (INSTANT || !FIRE.AOG.on)) return;
    const chainNow = await chain.clans();
    const standing = chainNow.filter((x) => x.alive && s.clans[x.id] && !s.clans[x.id].fallen);
    const fl = Object.fromEntries(standing.map((x) => [x.id, spendable(x.id, x.florins)]));
    const nameOf = (id) => chainNow.find((x) => x.id === id)?.name ?? `nation ${id}`;
    const atWar = standing.map((x) => x.id).filter((id) => WR.warOf(s, id));
    const hit = new Set(rec.filter((r) => r.kind === "fire").map((r) => r.clan)); // one fire per nation per turn (a bully may already burn)
    const burnFire = async (target, memo) => {
      const dmg = FIRE.damage(fl, target, s.clans[target]?.walls || 0);
      if (dmg.florins <= 0) return null;
      const r = await chain.burn(target, dmg.florins, memo.slice(0, 200));
      const burned = r?.value != null ? toFlorins(r.value) : dmg.florins;
      fl[target] = Math.max(0, (fl[target] || 0) - burned);
      hit.add(target);
      return { ...dmg, florins: +burned.toFixed(4), tx: r?.hash ?? null };
    };
    for (const q of queue) {
      const last = (s.fire.last ||= {})[q.god] || 0;
      const ok = FIRE.mayCast({ last, caster: q.caster, target: q.target, standing: standing.map((x) => x.id), atWar });
      if (!ok.ok || hit.has(q.target)) { log({ kind: "fire-refused", clan: q.caster, by: q.god, target: q.target, why: ok.ok ? "that nation is already burning this turn" : ok.why }); continue; }
      const f = await burnFire(q.target, `act of god: fire called by the gods of ${nameOf(q.caster)}`);
      if (!f) { log({ kind: "fire-refused", clan: q.caster, by: q.god, target: q.target, why: "that nation has nothing left to burn" }); continue; }
      s.fire.last[q.god] = Date.now();
      // The caster's nation pays a tenth of the damage it did.
      let cost = null;
      try { const c = await chain.burn(q.caster, +(f.florins * FIRE.AOG.casterCost).toFixed(4), `act of god: the price of calling fire on ${nameOf(q.target)}`); cost = { florins: c?.value != null ? +toFlorins(c.value).toFixed(4) : null, tx: c?.hash ?? null }; } catch {}
      log({ kind: "fire", clan: q.target, cause: "god", from: q.caster, by: q.god, proposal: q.proposal, ...f, cost, signer: "operator" });
    }
    if (INSTANT || !FIRE.AOG.on || hit.size) return;
    // The heavens' own fire: at most one a turn, and none if anything burned this turn already.
    const strike = FIRE.worldFire(standing.map((x) => ({ id: x.id, name: x.name, florins: fl[x.id] || 0, mood: s.clans[x.id].mood, atWar: atWar.includes(x.id) })));
    if (!strike) return;
    const f = await burnFire(strike.target, `act of god: ${strike.cause}`);
    if (f) log({ kind: "fire", clan: strike.target, cause: strike.cause, why: strike.why, ...f, signer: "operator" });
  }

  // Gods' rulings -> fortune
  for (const [gid, g] of Object.entries(s.gifts)) {
    if (g.applied) continue;
    const st = await chain.gift(Number(gid));
    const c = s.clans[g.clan];
    if (!st || !c) continue;
    if (st.status === "Rewarded") c.fortune = Math.min(CFG.fortuneMax, c.fortune * CFG.fortuneReward);
    else if (st.status === "Punished") c.fortune *= CFG.fortunePunish;
    else if (Date.now() - g.at > 24 * 3600e3) {
      c.fortune *= CFG.fortuneUnruled;
      // Reverence: the draft's own gods let it go unruled (drafts are no longer claimable).
      try {
        const ch = [], rvg = s.rev?.[g.clan];
        if (rvg) for (const god of Object.keys(rvg.gods)) if (!rvg.gods[god].outsider) RV.act(rvg, god, "unruled", day, ch);
        if (ch.length) log({ kind: "reverence-change", clan: g.clan, gift: gid, changes: ch });
      } catch (e) { log({ kind: "error", clan: g.clan, error: `reverence: ${String(e.message || e).slice(0, 180)}` }); }
    } else continue;
    g.applied = true;
    log({ kind: "ruling", gift: gid, clan: g.clan, status: st.status === "Pending" ? "Unruled" : st.status, fortune: +c.fortune.toFixed(3) });
  }

  // The world's spare NEAR (13 Nov, engine/reserve.mjs): scheduled turns only, before the root so the record is sealed.
  if (!INSTANT && chain.keepReserve) {
    try { const r = await chain.keepReserve(); if (r) log({ kind: "reserve", near: r.near, spare: r.spare, tx: r.hash, why: "the operator topped up the world's spare grace (it pays for whispers, gifts and roots)" }); }
    catch (e) { log({ kind: "error", error: `reserve: ${String(e.message || e).slice(0, 180)}` }); }
  }
  // Root, save (no fee sweep in v2: the 14% sits in the contract as the jackpot)
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
  await store.seatBuysSealed(seatsSealed).catch((e) => console.log(`  seats: not marked sealed: ${e.message}`));
  console.log(`  root ${root.slice(0, 16)}... on chain (${rr.hash}) | LLM this run: ${meter.calls} calls, $${meter.usd.toFixed(4)} | today (UTC): $${spentToday().toFixed(4)} of $${CFG.dailyCapUsd}`);
}

// AI gods (12 Nov, engine/aiact.mjs): after a scheduled turn is sealed, plan their next two hours. A failed
// plan is logged and the gods sit quiet until the next turn; it never touches the sealed turn.
if (!INSTANT) {
  try { const p = await planGods({ net, s, onchain: await chain.clans(), chain }); console.log(`  AI gods: ${p.actions} actions planned for ${p.gods} gods${p.why ? ` (${p.why})` : ""}`); }
  catch (e) { console.log(`  AI gods: no plan this turn: ${String(e.message || e).slice(0, 200)}`); }
}

// AI gods sell their seats too (his ask 13 Nov, engine/seats.mjs aiListings): each scheduled turn a nation led by one
// AI god lists that seat at its claim value plus a quarter. Human gods list theirs on the seats page.
if (!INSTANT && net === "testnet" && chain.stake) {
  try {
    const ai = new Set((await store.aiGods(net)).map((g) => g.account)), onchain = await chain.clans(), claim = {};
    for (const c of onchain) if (c.alive && c.gods?.length === 1 && ai.has(c.gods[0].account)) { const st = await chain.stake(c.id, c.gods[0].account).catch(() => null); claim[c.id] = st?.near != null ? toNear(st.near) : null; }
    const L = SE.aiListings({ clans: onchain, ai, open: await store.seatsOpen(net), stakeOf: (id) => claim[id] ?? null });
    for (const x of L) await store.seatList(net, { ...x, at: Date.now() });
    if (L.length) console.log(`  seats: ${L.length} AI seat(s) listed or re-priced`);
  } catch (e) { console.log(`  seats: AI listings skipped: ${String(e.message || e).slice(0, 160)}`); }
}

const t = await chain.totals();
console.log(`\nworld: balance ${toNear(t.balance)} owes ${toNear(t.liabilities)} storage ${toNear(t.storage_locked)} | backing ${toNear(t.backing)} jackpot ${toNear(t.jackpot)} | florins ${toFlorins(t.florins)} worth ${toNear(t.florin_value)} NEAR each, minted ${toFlorins(t.minted)} burned ${toFlorins(t.burned)}`);
for (const c of await chain.clans()) {
  const st = s.clans[c.id];
  console.log(`clan ${c.id} ${c.name} (${st?.field}, ${st?.mbti}) florins ${toFlorins(c.florins)} in ${toNear(c.total_in)} NEAR | ${st?.mood ?? "?"} | mindmap ${Object.keys(st?.owned || {}).length} points, depth ${st ? W.chainDepth(st) : 0}, frontier ${Object.keys(st?.frontier || {}).length} | clean gifts ${c.clean_gifts} | fortune ${st?.fortune.toFixed(2)}`);
}

function pickTarget(c, pick = null, seed = null) { return W.pickTarget(c, pick, seed); }
await store.close();
