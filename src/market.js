// The marketplace page (adfontes.fun/marketplace): view only. Listings and sales come from the world
// contract through /api/market; names from /api/world. Refreshes every 30 seconds.
import { api } from "./net.js";
import { sectionNav } from "./pagenav.js";
sectionNav();

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null)); return n; };
const n2 = (x) => (Math.round(x * 100) / 100).toString();
const fl = (x) => `${n2(x)} florin${Math.abs(x - 1) < 1e-9 ? "" : "s"}`;
const KIND = { research: "Research", patent: "Patent", kit: "Figure kit" };

let names = {}, explorer = "https://testnet.nearblocks.io";
// Ended nations are taken off the market by the API (10 Nov), so every id here is a nation in play.
const who = (id) => names[id] ?? `nation ${id}`;
const txLink = (tx, text = "NEAR ↗") => (tx ? el("a", { className: "near", href: `${explorer}/txns/${tx}`, target: "_blank", rel: "noopener", textContent: text, title: "Open this transaction on NEAR" }) : null);
// Price against fair: "12 florins (1.5x fair)".
const vsFair = (price, fair) => (fair ? ` (${n2(price / fair)}x the fair price today)` : "");

async function load() {
  const [M, W] = await Promise.all([api("market"), api("world")]);
  if (M.error) throw new Error(M.error);
  names = Object.fromEntries(W.clans.map((c) => [c.id, c.name]));
  explorer = M.explorer;
  $("where").textContent = `the marketplace · ${M.net === "mainnet" ? "NEAR mainnet" : "NEAR testnet"} · turn ${M.day} · updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  const note = $("note");
  note.hidden = M.counts.listings > 0;
  note.textContent = "Nothing has been listed yet. The Brokers' market days haven't started on this world. The patents below already earn royalties from the ordinary trades, though.";

  const stat = (v, l) => el("div", {}, el("b", { textContent: v }), el("small", { textContent: l }));
  $("stats").replaceChildren(
    stat(String(M.counts.open), M.counts.open === 1 ? "thing on sale" : "things on sale"),
    stat(String(M.counts.sales), M.counts.sales === 1 ? "sale so far" : "sales so far"),
    stat(String(M.patents.length), M.patents.length === 1 ? "patent" : "patents"),
    stat(n2(M.counts.royalties), "florins paid in royalties"),
  );
  $("bounds").textContent = `A Broker can ask anywhere from ${M.bounds.min === 0.5 ? "half" : `${M.bounds.min}x`} to ${M.bounds.max === 3 ? "three times" : `${M.bounds.max}x`} the fair price when it lists. Fair prices move as knowledge spreads, so an older listing can drift outside that. Hover a listing to see the sum. The royalty is ${fl(M.royalty)} a buy here.`;

  // On sale now: a card each, newest first.
  const cards = M.open.slice().sort((a, b) => b.id - a.id).map((l) => el("article", { className: `mcard ${l.kind}`, title: l.fair_why ? `Fair price: ${l.fair_why}` : "" },
    el("span", { className: "mkind", textContent: `${KIND[l.kind] ?? l.kind}${l.copy ? " · copies" : " · one of a kind"}` }),
    el("h3", { textContent: l.title }),
    el("p", { className: "mprice" }, el("b", { textContent: fl(l.price) }), vsFair(l.price, l.fair)),
    el("p", { className: "mseller", textContent: `Sold by ${who(l.seller)}'s Broker since turn ${l.day}${l.copy && l.sold ? `, ${l.sold} sold` : ""}` }),
    l.reason ? el("blockquote", { textContent: l.reason }) : null,
    txLink(l.tx, "Listing on NEAR ↗"),
  ));
  $("open").replaceChildren(...(cards.length ? cards : [el("p", { className: "mempty", textContent: "Nothing on sale right now." })]));

  // Sold lately.
  const sold = M.sales.map((x) => el("li", {},
    el("span", { textContent: `Turn ${x.day}: ${who(x.buyer)} bought ${x.kind === "patent" ? "the patent" : x.kind === "kit" ? "a figure kit," : "research on"} "${x.title}" from ${who(x.seller)} for ${fl(x.price)}.` }),
    x.reason ? el("span", { className: "tip", textContent: `The Broker's reason: ${x.reason}` }) : null, " ", txLink(x.tx)));
  $("sales").replaceChildren(...(sold.length ? sold : [el("li", { textContent: "No sales yet." })]));

  // Royalties paid: from the sealed records, newest first.
  const titleOf = (id) => M.patents.find((p) => p.id === id)?.title ?? id;
  const paid = (M.royalties || []).map((r) => el("li", {},
    el("span", { textContent: `Turn ${r.day}: ${who(r.clan)} earned ${fl(r.florins)} from ${r.patents.length === 1 ? "its patent" : "its patents"} ${r.patents.map((p) => `"${titleOf(p)}"`).join(", ")}. ${r.sales === 1 ? "One research buy" : `${r.sales} research buys`} landed in ${r.patents.length === 1 ? "its" : "their"} chain.` }), " ", txLink(r.tx)));
  $("royalties").replaceChildren(...(paid.length ? paid : [el("li", { textContent: "No royalties paid yet." })]));

  // Patents: who drafted it, who holds it, what it stands on, what it's earned.
  const head = el("tr", {}, ...["Patent", "Drafted by", "Held by", "Stands on", "Fair price", "Royalties"].map((h) => el("th", { textContent: h })));
  const rows = M.patents.map((p) => el("tr", {},
    el("td", {}, el("b", { textContent: p.title }), p.listed ? el("span", { className: "mtag", textContent: "on sale" }) : null),
    el("td", { textContent: who(p.drafter) }),
    el("td", { textContent: p.holder === p.drafter ? "the same" : who(p.holder) }),
    el("td", { className: "mchain", textContent: p.chain.length ? p.chain.join(" → ") : "–" }),
    el("td", { textContent: p.fair != null ? fl(p.fair) : "–", title: p.fair_why ?? "" }),
    el("td", { textContent: p.royalties ? fl(p.royalties) : "none yet" }),
  ));
  $("patents").replaceChildren(el("thead", {}, head), el("tbody", {}, ...(rows.length ? rows : [el("tr", {}, el("td", { colSpan: 6, textContent: "No patent has passed yet." }))])));
}

const go = () => load().catch(() => ($("where").textContent = "The market didn't answer. Trying again in a moment."));
go();
setInterval(go, 30_000);
