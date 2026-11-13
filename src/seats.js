// The seats page (adfontes.fun/seats, PLAN_13NOV step 4): buy a god's seat in a nation or sell yours. Selling is a
// signed message (engine/seats.mjs acceptSeat); buying is a plain payment to the escrow, then the engine moves the
// seat or refunds within seconds. Signs with the same login as the world (src/live/wallet.js, same browser storage).
// Game copy stays web2 (12 Nov): grace, council, no wallet words.
import { api } from "./net.js";
import { createWallet } from "./live/wallet.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== false)); return n; };
const g = (x) => `${(Math.round(x * 1000) / 1000).toLocaleString("en")} grace`;
const Y = 10n ** 24n;
/** "2.5" -> yocto string (same rule as engine/seats.mjs yoctoOf). */
function yoctoOf(s) {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(String(s).trim());
  return m ? (BigInt(m[1]) * Y + BigInt((m[2] || "").padEnd(6, "0")) * (Y / 1_000_000n)).toString() : null;
}
const nearOf = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6;
const PENDING = "adf-seat-buy-pending";

const wallet = await createWallet("testnet");
let S = null, W = null, world = null, explorer = wallet.explorer;
const me = () => wallet.account();

function card(...kids) {
  const box = $("card");
  const close = () => { box.hidden = true; };
  box.replaceChildren(el("button", { type: "button", className: "x", textContent: "×", title: "Close", onclick: close }), ...kids);
  box.hidden = false;
  return { box, close };
}

async function sellSigned(action, clan, price) {
  const at = Date.now(), body = { world, action, clan: Number(clan), price: action === "sell" ? price : "0", at };
  const msg = `adfontes-seat:${JSON.stringify({ world: body.world, action: body.action, clan: body.clan, price: String(body.price), at: body.at })}`;
  const signed = await wallet.signChoice(msg);
  if (!signed) return { error: "It wasn't signed, so nothing changed." };
  return fetch("/api/seat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, ...signed }) }).then((r) => r.json()).catch(() => ({ error: "Couldn't reach the world. Try again." }));
}

async function postBuy(p) {
  const r = await fetch("/api/seat/buy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the world. Your payment is safe: this page tries again." }));
  if (r.ok || /already used|isn't a payment|went somewhere else|someone else|different amount|didn't go through/.test(r.error || "")) localStorage.removeItem(PENDING);
  return r;
}

function buyCard(l) {
  const pay = el("button", { type: "button", className: "viewbtn gold", textContent: `Pay ${g(l.price)}` });
  const err = el("p", { className: "fine err" });
  const { box, close } = card(
    el("h3", { textContent: `A seat in ${l.nation}` }),
    el("p", { textContent: `You pay ${g(l.price)}. You get ${l.ai ? `${l.seller_name ?? "this god"}'s` : "this"} seat: its florins (worth about ${l.claim != null ? g(l.claim) : "?"} if claimed today), its vote in the council and its believers' reverence.${l.ai ? ` You take the name ${l.seller_name ?? "of this god"} and its place in the season rankings.` : ""}` }),
    el("p", { className: "fine", textContent: "If the seller leaves first, or someone else buys it first, your grace comes back." }),
    err, el("div", { className: "row" }, pay, el("button", { type: "button", className: "viewbtn", textContent: "Cancel", onclick: () => close() })));
  pay.addEventListener("click", async () => {
    pay.disabled = true; err.textContent = "";
    pay.textContent = wallet.isLocal?.() ? "Paying…" : "Approve it in Meteor…";
    try {
      const outs = await wallet.send([{ transfer: true, receiver: S.escrow, deposit: l.price_yocto }]);
      const hash = outs.map((o) => o?.transaction?.hash).find(Boolean);
      if (!hash) throw new Error("The payment didn't come back. Look in Your buys in a minute.");
      const p = { listing: l.id, buyer: me(), tx: hash };
      localStorage.setItem(PENDING, JSON.stringify(p));
      const r = await postBuy(p);
      box.replaceChildren(el("h3", { textContent: `A seat in ${l.nation}` }),
        el("p", { textContent: r.ok ? "Paid. The seat moves to you in a few seconds. Watch Your buys below." : r.error }),
        el("p", { className: "fine" }, el("a", { href: `${explorer}/txns/${hash}`, target: "_blank", rel: "noopener", textContent: "Public record ↗" })),
        el("div", { className: "row" }, el("button", { type: "button", className: "viewbtn", textContent: "Close", onclick: () => { close(); } })));
      load();
    } catch (e) { err.textContent = e.message || String(e); pay.disabled = false; pay.textContent = `Pay ${g(l.price)}`; }
  });
}

async function drawMine() {
  const a = me();
  $("mine-s").hidden = !a;
  if (!a) return;
  const clans = await wallet.view(world, "list_clans", { limit: 100 }).catch(() => []);
  const mine = clans.filter((c) => c.alive && (c.gods || []).some((x) => x.account === a));
  if (!mine.length) { $("mine").replaceChildren(el("p", { className: "fine", textContent: "You don't hold a seat yet. Buy one below, or found a nation on the world." })); return; }
  const cards = [];
  for (const c of mine) {
    const st = await wallet.view(world, "get_stake", { clan_id: c.id, account: a }).catch(() => null);
    const claim = st ? nearOf(st.near) : null, listed = S.open.find((l) => l.clan === c.id && l.seller === a);
    const err = el("p", { className: "fine err" });
    const kids = [el("h3", { textContent: c.name }), el("p", { className: "fine", textContent: `Worth about ${claim != null ? g(claim) : "?"} if you claimed today.` })];
    if (listed) {
      const off = el("button", { type: "button", className: "viewbtn", textContent: "Take it off sale" });
      off.addEventListener("click", async () => { off.disabled = true; const r = await sellSigned("unlist", c.id); if (r.ok) load(); else { err.textContent = r.error; off.disabled = false; } });
      kids.push(el("p", {}, "For sale at ", el("b", { textContent: g(listed.price) }), "."), off);
    } else {
      const inp = el("input", { type: "text", inputMode: "decimal", placeholder: claim ? (Math.ceil(claim * 12.5) / 10).toFixed(1) : "1.0", size: 8, ariaLabel: "Price in grace" });
      const go = el("button", { type: "button", className: "viewbtn gold", textContent: "Put it up for sale" });
      go.addEventListener("click", async () => {
        const y = yoctoOf(inp.value || inp.placeholder);
        if (!y) { err.textContent = "Name a price in grace, like 2.5."; return; }
        go.disabled = true; err.textContent = "";
        const r = await sellSigned("sell", c.id, y);
        if (r.ok) load(); else { err.textContent = r.error; go.disabled = false; }
      });
      kids.push(el("div", { className: "row" }, inp, el("span", { className: "fine", textContent: " grace " }), go));
    }
    kids.push(err);
    cards.push(el("article", { className: "mcard seat" }, ...kids));
  }
  $("mine").replaceChildren(...cards);
}

const WORDS = { waiting: "Paid. The seat is on its way.", working: "Moving the seat…", filled: "Yours. The seat is in your name now.", "pay-due": "Yours. The seller's payment is still going through.", refunded: "Your grace came back", "refund-due": "Your grace is on its way back", rejected: "That payment didn't count" };
let polling = null;
async function load() {
  W ||= await api("world");
  world = W.world; explorer = W.explorer || explorer;
  S = await api(`seats${me() ? `?account=${encodeURIComponent(me())}` : ""}`);
  $("where").textContent = `seats · turn ${W.day ?? ""} · updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  $("who").innerHTML = "";
  $("who").append(me() ? `You're ${wallet.label?.() ?? me()}.` : el("span", {}, "To buy or sell, ", el("a", { href: "/", textContent: "log in on the world" }), " first. Then come back here."));
  // On sale.
  const cards = S.open.map((l) => {
    const own = l.seller === me();
    const b = !own && me() ? el("button", { type: "button", className: "viewbtn gold", textContent: "Buy this seat", onclick: () => buyCard(l) }) : null;
    return el("article", { className: `mcard seat${l.ai ? " ai" : ""}` },
      el("h3", { textContent: l.nation }),
      el("p", { className: "fine", textContent: `${l.seller_name ?? "A god"}${l.ai ? " (AI)" : ""} sells${l.gods > 1 ? `, one of ${l.gods} gods there` : ""}.` }),
      el("p", {}, el("b", { textContent: g(l.price) }), l.claim != null ? ` · worth ${g(l.claim)} if claimed today` : ""),
      l.premium != null ? el("p", { className: "fine", textContent: l.premium >= 0 ? `${l.premium}% over what it pays out today` : `${-l.premium}% under what it pays out today` }) : null,
      own ? el("p", { className: "fine", textContent: "Your seat." }) : b);
  });
  $("open").replaceChildren(...(cards.length ? cards : [el("p", { textContent: "No seats for sale right now." })]));
  // Your buys.
  $("buys-s").hidden = !S.mine?.length;
  $("buys").replaceChildren(...(S.mine || []).map((b) => el("li", {}, `${g(b.price)}: ${WORDS[b.status] ?? b.status}${b.why ? ` (${b.why})` : ""}. `, el("a", { className: "near", href: `${explorer}/txns/${b.tx}`, target: "_blank", rel: "noopener", textContent: "Public record ↗" }))));
  // Sold lately.
  $("sales").replaceChildren(...(S.sold.length ? S.sold.map((x) => el("li", { textContent: `${x.seller_name ?? "A god"}'s seat in ${x.nation} went to ${x.buyer_name ?? "a new god"} for ${g(x.price)}.` })) : [el("li", { textContent: "Nothing sold yet." })]));
  await drawMine().catch(() => {});
  // Still settling: look again in a few seconds.
  const busy = (S.mine || []).some((b) => ["waiting", "working", "pay-due", "refund-due"].includes(b.status));
  clearTimeout(polling);
  polling = setTimeout(load, busy ? 4000 : 30000);
}

wallet.onAccount(() => load());
// A payment this browser made but couldn't hand over (closed tab, network): hand it over now.
try { const p = JSON.parse(localStorage.getItem(PENDING) || "null"); if (p && p.buyer === me()) await postBuy(p); } catch {}
load().catch((e) => { $("open").replaceChildren(el("p", { textContent: `Couldn't read the seats just now (${e.message}). Reload in a minute.` })); });
