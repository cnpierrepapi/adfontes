// The personal feed (his call 11 Nov): it replaces the event list. Two parts.
// "Next turn": what's already decided or known before the turn runs (/api/next: fires queued by a
// vote, war rounds, the hoarding line, famine, reports and drafts waiting on you), with a countdown
// and a button to answer it while you wait. Yours first; a visitor with no nation sees the world's.
// "Just now": one short line per thing that happened to your nations (to the world, for a visitor).
// Citizens who speak to you (a whisper heard, a report, a Patron's reason for war) appear in a
// dialogue box (src/live/dialogue.js), never as text here.
import { api } from "../net.js";
import { godName } from "../says.js";
import { createDialogue } from "./dialogue.js";
import { createChatter } from "./chatter.js";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
const r0 = (x) => Math.round(x).toLocaleString("en");
const pct = (x) => `${Math.round(x * 100)}%`;

export function createFeed({ box, W, flyTo, sandbox = false }) {
  const head = el("button", { type: "button", className: "head feed-head" });
  const ignored = new Set(); // reports ignored from here (his call 13 Nov): off the list at once
  const soon = el("ul", { className: "feed-soon" });
  const justHead = el("p", { className: "feed-sub", textContent: "Just now" });
  const just = el("ul", { className: "feed-just" });
  justHead.hidden = true; // until something happens
  const body = el("div", { className: "feed" }, soon, justHead, just);
  box.append(head, body);
  let open = innerWidth > 700, nextAt = null, skew = 0, last = null;
  head.addEventListener("click", () => { open = !open; draw(); });

  let gods = null, mine = new Set(), focus = null;
  // The sandbox has no dialogue boxes (his call 11 Nov): its lab says what happened.
  const dialogue = sandbox ? { say() {}, busy: () => false } : createDialogue();
  const name = (id) => W.clans?.find((c) => c.id === Number(id))?.name ?? `nation ${id}`;
  const isMine = (id) => id != null && mine.has(Number(id));
  // A citizen says something every 15 s (PLAN_13NOV §6), from the records this feed hears.
  const chatter = sandbox ? null : createChatter({
    say: (d) => dialogue.say(d), busy: () => dialogue.busy(), mine: () => mine, name,
    // A line about one of your nations asks something of you: a button that does it.
    actionsFor: (l) => (l.ask && l.clan != null && isMine(l.clan) ? [[l.ask.label, () => act({ kind: l.ask.act, clan: l.clan, text: l.ask.text || "" })]] : []),
  });
  const me = () => (gods?.account?.() ?? null);
  const act = (spec) => (gods ? gods.act(spec) : flyTo(spec.clan));

  function countdown() {
    if (sandbox || !nextAt) return "";
    const ms = nextAt - (Date.now() + skew);
    if (ms <= 0) return " · running now";
    const m = Math.round(ms / 60e3);
    return ` · in ${m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`}`;
  }
  function item(icon, text, buttons = [], mineToo = false, clan = null) {
    const li = el("li", { className: mineToo ? "mine" : "" }, el("span", { className: "ic", textContent: icon }), el("span", { className: "tx", textContent: text }));
    if (buttons.length) li.append(el("span", { className: "acts" }, ...buttons.map(([label, fn]) => el("button", { type: "button", textContent: label, onclick: (e) => { e.stopPropagation(); fn(); } }))));
    if (clan != null) { li.classList.add("go"); li.addEventListener("click", () => flyTo(clan)); }
    return li;
  }
  function draw() {
    head.textContent = `${open ? "▾" : "▸"} Next turn${countdown()}`;
    body.hidden = !open;
    if (!last) return;
    const N = last, mineList = [], world = [];
    const god = !!me();
    const firstMine = [...mine][0];
    for (const f of N.fires || []) {
      if (f.held && !isMine(f.caster)) continue; // its god isn't Ascendant: it won't land, so nobody else hears of it
      if (isMine(f.target)) mineList.push(item("🔥", `${f.caster_name}'s gods called fire on ${f.target_name}. It lands next turn.`, [["Strike back", () => act({ kind: "fire", clan: f.target, target: f.caster })], ["Warn them", () => act({ kind: "whisper", clan: f.target, text: `Fire is coming from ${f.caster_name}. Guard what matters most.` })]], true, f.target));
      else if (isMine(f.caster)) mineList.push(item("🔥", f.held ? `Your call for fire on ${f.target_name} won't be answered: Act of God opens at Ascendant.` : `Your fire lands on ${f.target_name} next turn.`, [], true, f.target));
      else world.push(item("🔥", `Fire lands on ${f.target_name} next turn, called by ${f.caster_name}.`, [], false, f.target));
    }
    for (const w of N.wars || []) {
      const ours = isMine(w.a) ? w.a : isMine(w.b) ? w.b : null;
      const them = ours === w.a ? w.b_name : w.a_name, ptsUs = ours === w.a ? w.a_points : w.b_points, ptsThem = ours === w.a ? w.b_points : w.a_points;
      if (ours != null) mineList.push(item("⚔", `Round ${w.round} against ${them} next turn: ${ptsUs} points to ${ptsThem}.`, [["Whisper", () => act({ kind: "whisper", clan: ours, text: "" })]], true, ours));
      else world.push(item("⚔", `${w.a_name} and ${w.b_name} fight round ${w.round} next turn: ${w.a_points} points to ${w.b_points}.`, [], false, w.a));
    }
    const h = N.hoard;
    if (h && h.share >= h.line - 0.04) {
      if (isMine(h.clan)) mineList.push(item("☄", `You hold ${pct(h.share)} of the florins. At ${pct(h.line)} the heavens strike you.`, [["Bless a rival", () => act({ kind: "bless", clan: [...W.clans].filter((c) => !isMine(c.id) && c.alive !== false).sort((a, b) => (a.florins || 0) - (b.florins || 0))[0]?.id })]], true, h.clan));
      else world.push(item("☄", `${h.name} holds ${pct(h.share)} of the florins. At ${pct(h.line)} the heavens strike it.`, god && firstMine != null ? [["Call fire on it", () => act({ kind: "fire", clan: firstMine, target: h.clan })]] : [], false, h.clan));
    }
    const fm = N.famine;
    if (fm && fm.hungry >= fm.needs - 1) world.push(item("🌾", `${fm.hungry} of ${fm.of} nations are hungry.${fm.hungry >= fm.needs && fm.richest_name ? (fm.richest_hungry ? " The richest is hungry too, so no fire yet." : ` ${fm.richest_name} burns next turn if it stays fed.`) : ` At ${fm.needs}, the richest fed nation burns.`}`, [], false, fm.richest));
    for (const c of W.clans || []) if (isMine(c.id) && c.mood === "hungry") mineList.push(item("🍞", `${c.name}'s citizens are hungry. They slow down until fed.`, [["Bless", () => act({ kind: "bless", clan: c.id })]], true, c.id));
    // Ask the accused first (PLAN_13NOV step 2): Ask -> their answer -> Stunt or let it lapse.
    // Ignore (his call 13 Nov): settles it now, as a lapse would, and it leaves this list at once.
    const ignore = (r) => ["Ignore", () => gods?.choose("dismiss", r.clan, { report: r.id }, N.choice_day).then((done) => { if (done) { ignored.add(r.id); refresh(); } })];
    for (const r of N.reports || []) if (isMine(r.clan) && !ignored.has(r.id)) {
      if (r.answer) mineList.push(item("👁", r.answer.silent ? `${r.accused} can't answer the report (stunted or gone). Stunt, or ignore it.` : `${r.accused} answered the report: "${r.answer.says}" Stunt, or ignore it?`, [["Stunt", () => act({ kind: "smite", clan: r.clan, agent: r.accused })], ignore(r)], true, r.clan));
      else if (r.asked) mineList.push(item("👁", `You asked ${r.accused} to answer ${r.accuser}'s report. Their answer is on its way.`, [ignore(r)], true, r.clan));
      else mineList.push(item("👁", `${r.accuser} accuses ${r.accused}. Hear them out first.`, [[`Ask ${r.accused}`, () => gods?.choose("ask", r.clan, { report: r.id }, N.choice_day).then((done) => done && refresh())], ignore(r)], true, r.clan));
    }
    for (const g of N.rulings || []) if (isMine(g.clan)) mineList.push(item("📜", `A draft from ${name(g.clan)} waits for your ruling.`, [["Open", () => flyTo(g.clan)]], true, g.clan));
    // The Scholars' pitch (PLAN_13NOV step 1): three directions for next turn; your pick replaces the dice.
    for (const p of N.pitches || []) if (isMine(p.clan)) {
      const tip = (x) => `${x.point}${x.known_by ? ` (${x.known_by} other nation${x.known_by === 1 ? " knows" : "s know"} it)` : ""}`;
      mineList.push(item("🔭", p.picked ? `${p.name}'s Scholars will work on ${p.picked} next turn. Change it?` : `${p.name}'s Scholars want a direction for next turn.`, p.points.map((x) => [tip(x), () => gods?.choose("pitch", p.clan, { point: x.point }, N.choice_day).then((done) => done && refresh())]), true, p.clan));
    }
    soon.replaceChildren(...mineList, ...world.slice(0, mineList.length ? 4 : 6));
    if (!soon.children.length) soon.append(item("☾", "Quiet. Nothing is set for next turn yet."));
  }

  async function refresh() {
    try {
      const N = await api("next");
      if (N && !N.error) { last = N; nextAt = N.next_at; if (N.now_ms) skew = N.now_ms - Date.now(); }
      if (gods && me()) mine = new Set(await gods.myNations());
      draw();
    } catch { /* keep the last one */ }
  }
  refresh();
  setInterval(refresh, 20_000);
  setInterval(() => (head.textContent = `${open ? "▾" : "▸"} Next turn${countdown()}`), 15_000);

  // ---- just now: one short line each ----
  const BIG = new Set(["fire", "war", "peace", "fallen", "founded"]);
  function line(r) {
    switch (r.kind) {
      case "fire": return ["🔥", `Fire burned ${r0(r.florins)} florins in ${name(r.clan)}.`, r.clan];
      case "war": return ["⚔", `${name(r.attacker)} declared war on ${name(r.defender)}.`, r.attacker];
      case "battle": { const ids = Object.keys(r.sides || {}).map(Number); return ["⚔", `${name(ids[0])} and ${name(ids[1])} fought round ${r.round}.`, ids[0]]; }
      case "peace": return ["🕊", `${name(r.a)} and ${name(r.b)} made peace.`, r.a];
      case "fallen": return ["💀", `${name(r.clan)} fell to ${name(r.by)}.`, r.clan];
      case "founded": return ["🏝", `${r.name ?? name(r.clan)} was founded.`, r.clan];
      case "trade": case "market-sale": return ["⇄", `${name(r.buyer)} bought ${r.point ? `"${r.point}"` : "research"} from ${name(r.seller)}.`, r.buyer];
      case "warden": return ["⚖", `The Warden fined ${name(r.clan)} ${r0(r.fine || 0)} florins.`, r.clan];
      case "mint": return ["✦", `${name(r.clan)} earned ${(+r.florins).toFixed(1)} florins.`, r.clan];
      case "heard": return ["✉", `${r.citizen ?? "A citizen"} heard a whisper: reverence ${r.delta >= 0 ? "+" : ""}${r.delta}.`, r.clan];
      case "gift": return ["📜", `${name(r.clan)} drafted an invention.`, r.clan];
      // What the gods do, AI gods included (13 Nov: none of it showed for nations you aren't a god of).
      case "bless": return ["✦", `${r.god ? godName(r.god) : "A god"} blessed ${name(r.clan)} with ${(+r.near).toFixed(2)} grace.`, r.clan];
      case "ruling": return ["📜", `${name(r.clan)}'s gods ${r.status === "Rewarded" ? "rewarded" : r.status === "Punished" ? "punished" : "ignored"} a draft.`, r.clan];
      case "correction": return /lift/i.test(r.why || "") ? ["☀", `${name(r.clan)} turns back to its gods: a fresh start.`, r.clan] : null;
      case "outsiders-gone": return ["🏛", `${name(r.clan)} belongs to its own gods again.`, r.clan];
      case "asked": return ["👁", `${r.god ? godName(r.god) : "A god"} asked ${r.accused} in ${name(r.clan)} to answer a report.`, r.clan];
      case "answer": return ["👁", r.silent ? `${r.accused} in ${name(r.clan)} couldn't answer the report.` : `${r.accused} in ${name(r.clan)} answered the report.`, r.clan];
      // Whispering to the Broker (PLAN_13NOV step 3).
      case "broker-word": return r.full ? null : r.listens ? ["⇄", `${name(r.clan)}'s Broker heeded ${r.god ? godName(r.god) : "its god"}${r.listing?.length ? ` and puts ${r.listing.length} thing${r.listing.length === 1 ? "" : "s"} up for sale` : ", but had nothing new to list"}.`, r.clan] : ["⇄", `${name(r.clan)}'s Broker ${r.ignored ? "ignored" : "didn't heed"} ${r.god ? godName(r.god) : "its god"} this time.`, r.clan];
      case "reverence-change": return r.listing != null ? ["✦", `${name(r.clan)}'s Broker sold what its god asked, above what it's worth. Its god gains a little reverence.`, r.clan] : null;
      // PLAN_13NOV §6: a god reached a milestone and a power opened.
      case "milestone": return r.milestone === "arrive" ? null : ["★", `${godName(r.god)} became ${r.name}${r.milestone === "ascendant" ? " and can call down an Act of God" : ""}.`, null];
      // Phase E: a new AI god arrived and founded a nation or joined one.
      case "arrival": return ["✧", r.kind === "found" || r.nation ? `A new god, ${r.name}, arrived and founded ${r.nation}.` : `A new god, ${r.name}, arrived and blessed ${name(r.clan)}.`, r.clan ?? null];
      // Seat trading (PLAN_13NOV step 4): a seat changed hands. Buying an AI god's seat, the buyer plays as that god.
      case "seat-sold": return ["⚑", r.as ? `A new god bought ${r.as}'s seat in ${name(r.clan)} for ${r.price} grace and now plays as ${r.as}.` : `${godName(r.seller)} sold their seat in ${name(r.clan)} to ${godName(r.buyer)} for ${r.price} grace.`, r.clan];
      case "report-settled": return ["⚖", `${r.accused} in ${name(r.clan)}: the report ${r.outcome === "stunted" ? "ended in a stunt" : "lapsed"}. It was ${r.truth ? "true" : "a grudge"}.`, r.clan];
      default: return null;
    }
  }
  const involves = (r) => [r.clan, r.buyer, r.seller, r.attacker, r.defender, r.a, r.b, r.from, ...Object.keys(r.sides || {})].some(isMine);
  function heard(r) {
    const l = line(r);
    if (!l) return;
    // The whole world's events (13 Nov: when you're a god, only your own nations' showed, so everything the AI
    // gods did vanished). Yours stay highlighted.
    const ours = true;
    if (!ours) return;
    just.prepend(item(l[0], l[1], [], mine.size > 0 && involves(r), l[2]));
    while (just.children.length > 8) just.lastChild.remove();
    justHead.hidden = false;
  }

  // ---- citizens who speak to you: dialogue boxes, their real words ----
  const roles = new Map(); // clan id -> Map(name -> role)
  async function roleOf(clan, who) {
    if (!roles.has(clan)) roles.set(clan, api(`clan?id=${clan}`).then((c) => new Map((c.agents || []).map((a) => [a.name, a.role]))).catch(() => new Map()));
    return (await roles.get(clan)).get(who) ?? null;
  }
  async function patronOf(clan) {
    if (!roles.has(clan)) await roleOf(clan, "");
    for (const [n, r] of await roles.get(clan)) if (r === "Patron") return n;
    return null;
  }
  const forMe = (clan, god = null) => (god && me() ? god === me() : mine.size ? isMine(clan) : focus === Number(clan));
  async function speak(r) {
    if (r.kind === "heard" && r.says && forMe(r.clan, r.god)) {
      const who = r.citizen || "A citizen";
      dialogue.say({ key: `h${r.day}:${r.i ?? r.at}:${who}`, name: who, role: await roleOf(r.clan, who), nation: name(r.clan), badge: `reverence ${r.delta >= 0 ? "+" : ""}${r.delta}`, text: r.says });
    } else if (r.kind === "report" && r.claim && forMe(r.clan)) {
      dialogue.say({ key: `r${r.report}`, name: r.accuser, role: await roleOf(r.clan, r.accuser), nation: name(r.clan), text: r.claim });
    } else if (r.kind === "answer" && r.says && forMe(r.clan)) {
      // Ask the accused (PLAN_13NOV step 2): the accused speaks for themselves.
      dialogue.say({ key: `a${r.report}`, name: r.accused, role: r.role ?? (await roleOf(r.clan, r.accused)), nation: name(r.clan), badge: "answers the report", text: r.says });
    } else if (r.kind === "war" && r.reason && forMe(r.attacker)) {
      const p = await patronOf(r.attacker);
      dialogue.say({ key: `w${r.war}`, name: p ?? "The Patron", role: "Patron", nation: name(r.attacker), badge: `war on ${name(r.defender)}`, text: r.reason });
    } else if (r.kind === "council" && r.reason && !r.refused && r.action !== "hold" && forMe(r.clan)) {
      const p = await patronOf(r.clan);
      dialogue.say({ key: `c${r.day}:${r.clan}:${r.action}`, name: p ?? "The Patron", role: "Patron", nation: name(r.clan), badge: r.action.replace("_", " "), text: r.reason });
    }
  }

  // Something of yours just happened (13 Nov): look at "Next turn" again soon, so an answered item goes away.
  let soonAgain = null;
  const refreshSoon = () => { clearTimeout(soonAgain); soonAgain = setTimeout(refresh, 3000); };
  return {
    record(r) { heard(r); chatter?.add(r); speak(r).catch(() => {}); if (mine.size && involves(r)) refreshSoon(); },
    mine: (r) => mine.size > 0 && involves(r),
    setGods(g) { gods = g; refresh(); },
    setFocus(id) { focus = id == null ? null : Number(id); },
    refresh,
  };
}
