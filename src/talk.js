// The agents talk (his call 9 Nov): the real exchanges between the world's agents, played as a chat.
// War councils arguing, citizens answering their god, citizens reporting each other, Brokers haggling.
// Only words an agent wrote go in a bubble; what the rules did is a plain note. Every line came from a
// sealed turn, and its "check" button proves that exact record against NEAR from the browser.
import { api } from "./net.js";
import { verifyRecord } from "./proof.js";
import { tidy } from "./says.js";

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null)); return n; };
const fl = (x) => `${Math.round(x * 100) / 100} florins`;
// The engine stores reasons up to 200 characters; one cut off there ends in "…" rather than mid-word.
const said = (t) => { const x = String(t || "").trim(); return x.length >= 195 && !/[.!?"')]$/.test(x) ? `${x}…` : x; };


async function sealedDays(W) {
  const out = [];
  const ds = Array.from({ length: W.day }, (_, k) => k + 1);
  for (let k = 0; k < ds.length; k += 6) {
    const got = await Promise.all(ds.slice(k, k + 6).map((d) => api(`day?d=${d}`).then((x) => ({ d, x })).catch(() => null)));
    for (const g of got) if (g?.x?.root && g.x.records?.length) out.push(g);
  }
  // Each record keeps where it sits in its turn, so it can be proved.
  return out.flatMap(({ d, x }) => x.records.map((r, i) => ({ ...r, _d: d, _i: i })));
}

// A message: { who, side: "l" | "r", text, note, rec } (note-only messages have no who/text).
function threads(recs, name) {
  const N = (id) => name(id);
  const war = [], gods = [], reports = [], deals = [];

  // The war room.
  const warKinds = new Set(["war", "fortify", "council", "peace-offer", "peace", "fallen"]);
  const fighting = new Set(); // nations in a war at this point of the season
  for (const r of recs.filter((x) => warKinds.has(x.kind))) {
    if (r.kind === "war") { fighting.add(r.attacker); fighting.add(r.defender); }
    if (r.kind === "peace") { fighting.delete(r.a); fighting.delete(r.b); }
    if (r.kind === "fallen") { fighting.delete(r.clan); fighting.delete(r.by); }
    if (r.kind === "war") { war.push({ note: `Turn ${r._d}: ${N(r.attacker)} declares war on ${N(r.defender)}.` }); war.push({ who: `${N(r.attacker)}'s war council`, side: "l", text: r.reason, rec: r }); }
    else if (r.kind === "fortify") { war.push({ who: `${N(r.clan)}'s war council`, side: "r", text: r.reason, rec: r }); war.push({ note: `${N(r.clan)} spends ${fl(r.spent)} on walls.` }); }
    else if (r.kind === "council") {
      if (r.action !== "declare" && !fighting.has(r.clan)) continue; // a nation at peace choosing to stay so adds nothing here
      war.push({ who: `${N(r.clan)}'s war council`, side: r.action === "declare" ? "l" : "r", text: r.reason, rec: r });
      if (r.refused) war.push({ note: `The rules said no: ${r.refused}. One war at a time.` });
    }
    else if (r.kind === "peace-offer") { war.push({ who: `${N(r.clan)}'s war council`, side: "r", text: r.reason, rec: r }); war.push({ note: `${N(r.clan)} offers ${N(r.to)} peace.` }); }
    else if (r.kind === "peace") { war.push({ note: `Peace between ${N(r.a)} and ${N(r.b)} after ${r.rounds} rounds.` }); if (r.reason) war.push({ who: `${N(r.by)}'s war council`, side: "l", text: r.reason, rec: r }); }
    else if (r.kind === "fallen") war.push({ note: `${r.name} has fallen to ${r.byName}. ${r.byName} takes ${fl(r.loot)} and two of its people.`, rec: r });
  }
  const lastBattle = recs.filter((x) => x.kind === "battle").at(-1);
  if (lastBattle) {
    const s = Object.entries(lastBattle.sides).map(([id, x]) => `${N(id)} ${x.hp} point${x.hp === 1 ? "" : "s"} left`).join(", ");
    war.push({ note: `Round ${lastBattle.round}, turn ${lastBattle._d}: ${s}. A round every two hours, until an island falls or both sides agree to peace.`, rec: lastBattle });
  }

  // A god speaks, a citizen answers.
  for (const r of recs.filter((x) => x.kind === "heard")) {
    gods.push({ who: `A god of ${N(r.clan)}`, side: "r", text: r.text, god: true });
    gods.push({ who: `${r.citizen}, ${N(r.clan)}`, side: "l", text: r.says, rec: r });
    gods.push({ note: `Heard as ${r.verdict === "prophecy" ? "prophecy" : `${r.verdict} words`}: reverence ${r.delta > 0 ? "+" : ""}${r.delta}.` });
  }

  // Citizens report each other; their gods judge it, or nobody does.
  const settled = new Map(recs.filter((x) => x.kind === "report-settled").map((x) => [x.report, x]));
  for (const r of recs.filter((x) => x.kind === "report").slice(-6)) {
    // The claim is written "X says Y did Z"; the bubble is already X's, so it reads "Y did Z".
    const lead = `${r.accuser} says `, raw = String(r.claim || ""), claim = raw.startsWith(lead) ? raw.slice(lead.length) : raw;
    reports.push({ who: `${r.accuser}, ${N(r.clan)}`, side: "l", text: claim.charAt(0).toUpperCase() + claim.slice(1), rec: r });
    const s = settled.get(r.report);
    if (!s) reports.push({ note: `Still open. The gods have until turn ${r.lapses_day} to judge it.` });
    else reports.push({ note: `${s.outcome === "lapsed" ? "Nobody judged it in time, so it lapsed." : `The gods judged it: ${r.accused} was ${s.outcome}.`} The claim was ${s.truth ? "true" : "false"}.`, rec: s });
  }

  // Brokers haggle: the seller names a price and says why, the buyer says why it's worth it, or walks.
  const seenWalk = new Set(); // a walk-away is remembered a while, so the same one can be logged again
  const trades = recs.filter((x) => (x.kind === "trade" && x.sellerWhy) || (x.kind === "broker" && x.bought === false && /walked away/.test(x.why || "") && !seenWalk.has(x.why) && seenWalk.add(x.why))).slice(-6);
  for (const r of trades) {
    if (r.kind === "trade") {
      deals.push({ who: `${N(r.seller)}'s Broker`, side: "r", text: r.sellerWhy, rec: r });
      if (r.why) deals.push({ who: `${N(r.buyer)}'s Broker`, side: "l", text: r.why, rec: r });
      deals.push({ note: `${N(r.buyer)} buys "${r.point}" for ${fl(r.price)} (fair price ${fl(r.fair)}), signed from its Broker's own wallet.` });
    } else deals.push({ note: `${N(r.clan)}'s Broker ${r.why.replace(/^walked away: /, "walked away. ")}`, rec: r });
  }
  return [
    { id: "war", label: "The war room", intro: "War councils decide alone, once a day. The gods get no say.", msgs: war },
    { id: "gods", label: "A god and its citizens", intro: "A god whispers. A citizen says what they made of it, and reverence moves with it.", msgs: gods },
    { id: "reports", label: "Citizens on citizens", intro: "Citizens report each other to their gods. Some reports are true.", msgs: reports },
    { id: "deals", label: "Brokers haggling", intro: "Every trade is a sale on the marketplace. The seller names its price, the buyer can walk.", msgs: deals },
  ].filter((t) => t.msgs.length);
}

export async function startTalk(root, W) {
  // A nation that has ended is no longer in the world list: it reads as "another nation" (tidy below).
  const name = (id) => W.clans.find((c) => c.id === Number(id))?.name ?? "another nation";
  const recs = await sealedDays(W);
  const ts = threads(recs, name);
  if (!ts.length) { root.replaceChildren(el("p", { textContent: "Nothing said yet. Come back after the next turn." })); return; }
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tabs = el("div", { className: "talk-tabs", role: "tablist" });
  const chat = el("div", { className: "talk-chat", "aria-live": "polite" });
  const intro = el("p", { className: "talk-intro" });
  const ctrl = el("p", { className: "talk-ctrl" });
  root.replaceChildren(tabs, intro, chat, ctrl);
  let run = 0;

  const bubble = (m) => {
    if (!m.who) return el("div", { className: "talk-note" }, tidy(m.note), m.rec ? check(m.rec) : null);
    return el("div", { className: `talk-msg ${m.side}${m.god ? " god" : ""}` },
      el("b", { textContent: tidy(m.who).replace(/^the /, "The ") }),
      el("p", { textContent: said(m.text) }),
      el("small", {}, m.rec ? `turn ${m.rec._d}` : "", m.rec ? check(m.rec) : null));
  };
  const check = (rec) => {
    const b = el("button", { type: "button", className: "talk-check", textContent: "check on NEAR" });
    b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "checking…";
      try {
        const v = await verifyRecord(rec._d, rec._i);
        b.textContent = v.error ? v.error : v.ok ? `✓ matches NEAR, turn ${rec._d}` : "✗ doesn't match";
        b.title = v.ok ? `Your browser got ${v.mine}; NEAR holds ${v.onchain} (${v.steps} steps up the proof)` : "";
        b.classList.add(v.ok ? "yes" : "no");
      } catch { b.textContent = "NEAR didn't answer, try again"; b.disabled = false; }
    });
    return b;
  };

  async function play(t, all = false) {
    const me = ++run;
    [...tabs.children].forEach((x) => x.classList.toggle("on", x.dataset.id === t.id));
    intro.textContent = t.intro;
    chat.replaceChildren();
    const msgs = t.msgs;
    for (const m of msgs) {
      if (me !== run) return;
      if (!all && !still) {
        const typing = el("div", { className: `talk-typing ${m.side || "c"}` }, el("span"), el("span"), el("span"));
        chat.append(typing); chat.scrollTop = chat.scrollHeight;
        await new Promise((r) => setTimeout(r, Math.min(1800, 500 + (m.text || m.note || "").length * 9)));
        typing.remove();
        if (me !== run) return;
      }
      const b = bubble(m);
      chat.append(b); chat.scrollTop = chat.scrollHeight;
    }
  }
  for (const t of ts) tabs.append(el("button", { type: "button", className: "talk-tab", textContent: t.label, onclick: () => play(t) }, ));
  [...tabs.children].forEach((b, k) => (b.dataset.id = ts[k].id));
  ctrl.append(
    el("button", { type: "button", className: "viewbtn", textContent: "Play it again", onclick: () => play(ts.find((t) => tabs.querySelector(".on")?.dataset.id === t.id) || ts[0]) }),
    el("button", { type: "button", className: "viewbtn", textContent: "Show it all at once", onclick: () => play(ts.find((t) => tabs.querySelector(".on")?.dataset.id === t.id) || ts[0], true) }),
  );
  // Starts when it scrolls into view.
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); play(ts[0]); } }, { threshold: 0.25 });
  io.observe(root);
}
