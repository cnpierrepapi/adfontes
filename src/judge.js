// The judges' page: live numbers, a proof you check in your own browser, the last turn on chain.
import { api } from "./net.js";
import { says as saysWith, tipOf } from "./says.js";
import { sectionNav } from "./pagenav.js";
import { verifyRecord } from "./proof.js";
import { startTalk } from "./talk.js";
sectionNav();

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null)); return n; };
const n = (x, d = 3) => (Math.round(x * 10 ** d) / 10 ** d).toString();

let W = null, sealed = null;
const clanName = (id) => W?.clans.find((c) => c.id === Number(id))?.name ?? `nation ${id}`;

// One read-only call to NEAR from your browser, no server in between.
async function viewOnNear(rpc, contract, method, args) {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) } }) }).then((x) => x.json());
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)));
}
const RPC = { testnet: "https://near-testnet.drpc.org", mainnet: "https://rpc.mainnet.fastnear.com" };

// The newest turn whose fingerprint is already on NEAR.
async function lastSealed() {
  for (let d = W.day; d >= Math.max(1, W.day - 3); d--) {
    const day = await api(`day?d=${d}`);
    if (day.root && day.records?.length) return day;
  }
  return null;
}

async function load() {
  W = await api("world");
  const c = W.clock, live = W.clans.filter((x) => x.alive);
  $("where").textContent = `${W.season} · ${W.net === "mainnet" ? "NEAR mainnet" : "NEAR testnet"} · turn ${W.day} · updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  const stat = (v, l) => el("div", {}, el("b", { textContent: v }), el("small", { textContent: l }));
  $("stats").replaceChildren(
    stat(c ? `Turn ${W.day}, ${c.phase === "day" ? "day" : "night"}` : `Turn ${W.day}`, c ? `NEAR $${c.price.toFixed(2)}, ${c.change > 0 ? "+" : ""}${(c.change * 100).toFixed(1)}% since ${c.phase === "day" ? "dawn" : "dusk"}` : "the world clock"),
    stat(String(live.length), live.length === 1 ? "nation" : "nations"),
    stat(String(live.reduce((a, x) => a + (x.points || 0), 0)), "points of knowledge, all nations"),
    stat(n(W.totals?.florins ?? 0, 1), `florins, ${n(W.totals?.florin_value ?? 0, 4)} NEAR each`),
    stat(`${n(W.totals?.backing ?? 0)} NEAR`, "behind the florins"),
    stat(`${n(W.jackpot?.near ?? 0)} NEAR`, "in the season jackpot"),
  );
  // Every nation's accounts: its named account (forwards to the DAO) and the DAO itself.
  const link = (a) => el("a", { href: `${W.explorer}/address/${a}`, target: "_blank", rel: "noopener", textContent: a });
  $("accounts").replaceChildren(...live.map((x) => el("li", {},
    el("div", {}, el("b", { textContent: x.name }), " · ", x.alias ? link(x.alias) : "named account coming on its next turn", " → treasury ", link(x.dao)),
    x.wallets?.broker || x.wallets?.patron ? el("div", { className: "jsub" }, "Broker ", x.wallets.broker ? link(x.wallets.broker) : "–", " · Patron ", x.wallets.patron ? link(x.wallets.patron) : "–") : null)));
  showStakes().catch(() => ($("stakes-table").replaceChildren(el("tr", {}, el("td", { textContent: "The stakes didn't load. Try again in a minute." })))));
  // Research as NEP-245 tokens: what each nation's DAO holds, and a live check against NEAR.
  const pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  $("tokens").replaceChildren(...live.filter((x) => x.tokens).map((x) => el("li", {}, el("b", { textContent: x.name }), ` · ${pl(x.tokens.research, "research token")}, ${pl(x.tokens.patents, "patent")}, ${pl(x.tokens.kits, "kit")}`)));
  if (!live.some((x) => x.tokens?.sample)) $("tokens").replaceChildren(el("li", { textContent: "The first tokens are minted on the next turn." }));
  sealed = await lastSealed();
  const txs = (sealed?.records || []).filter((r) => r.tx).slice(-12).reverse();
  $("chain-intro").replaceChildren("The world contract is ", el("a", { href: `${W.explorer}/address/${W.world}`, target: "_blank", rel: "noopener", textContent: W.world }), sealed ? `. Below: transactions from turn ${sealed.day}, the last one sealed on NEAR.` : ". No turn is sealed yet.");
  $("txs").replaceChildren(...txs.map((r) => el("li", {}, el("span", { textContent: saysWith(r, clanName) }), el("span", { className: "signer", textContent: `Signed by ${signerOf(r)}` }), ...(tipOf(r) ? [el("span", { className: "tip", textContent: tipOf(r) })] : []), " ", el("a", { className: "near", href: `${W.explorer}/txns/${r.tx}`, target: "_blank", rel: "noopener", textContent: "NEAR ↗", title: "Open this transaction on NEAR" }))));
  if (!txs.length) $("txs").append(el("li", { textContent: "No transactions in the last sealed turn yet." }));
}

// Who signed a transaction: a nation's own agent (from its wallet) or the world's operator.
function signerOf(r) {
  const s = r.signer;
  if (s && s !== "operator") {
    for (const c of W.clans) {
      if (c.wallets?.broker === s) return `${c.name}'s Broker, from its own wallet`;
      if (c.wallets?.patron === s) return `${c.name}'s Patron, from its own wallet`;
    }
    return s;
  }
  return "the world's operator (the rules, not an agent)";
}

// Every god's stake now (/api/stakes reads get_stake on the contract).
async function showStakes() {
  const S = await api("stakes");
  const short = (a) => (a.length > 24 ? `${a.slice(0, 8)}…` : a);
  const pct = (p) => (p == null ? "–" : `${p > 0 ? "+" : ""}${p}%`);
  const head = el("tr", {}, ...["Nation", "God", "Put in", "Florins", "Claim now", "Result"].map((h) => el("th", { textContent: h })));
  const rows = S.stakes.map((x) => el("tr", { className: x.pct > 0 ? "up" : x.pct > -14 ? "even" : "" },
    el("td", {}, el("b", { textContent: x.nation }), x.alive ? null : el("span", { className: "mtag", textContent: "fallen" }), x.granted ? el("span", { className: "mtag", title: `${n(x.granted)} NEAR of founding costs credited back by the world (9 Nov)`, textContent: "founder" }) : null),
    el("td", {}, el("a", { href: `${S.explorer}/address/${x.god}`, target: "_blank", rel: "noopener", textContent: short(x.god) })),
    el("td", { textContent: `${n(x.put_in)} NEAR` }),
    el("td", { textContent: n(x.florins, 1) }),
    el("td", { textContent: `${n(x.claim_now)} NEAR` }),
    el("td", { className: "res", textContent: pct(x.pct) }),
  ));
  $("stakes-table").replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows));
  const ahead = S.stakes.filter((x) => x.pct > 0).length;
  $("jackpot-line").textContent = `${ahead ? `${ahead} god${ahead === 1 ? " is" : "s are"} in profit right now.` : "No god is in profit right now."} The jackpot holds ${n(S.jackpot)} NEAR${S.leader ? `. If the season ended today it would go to the gods of ${S.leader.name}, top of the standings at ${S.leader.standing} reverence` : ""}. It pays out after 30 November.`;
}

$("check").addEventListener("click", async () => {
  const out = $("check-out");
  if (!sealed) return void (out.textContent = "No turn is sealed yet. Try again in a few minutes.");
  out.textContent = "Checking…";
  try {
    const i = Math.floor(Math.random() * sealed.records.length), d = sealed.day;
    const v = await verifyRecord(d, i);
    if (v.error) return void (out.textContent = v.error);
    out.replaceChildren(
      el("div", { className: `verdict ${v.ok ? "yes" : "no"}`, textContent: v.ok ? `Matches NEAR. Record ${i + 1} of turn ${d} is exactly what happened.` : "Doesn't match. That record isn't what was sealed." }),
      el("div", { textContent: `The record: ${saysWith(v.record, clanName)}` }),
      el("div", { textContent: `Your browser got: ${v.mine}` }),
      el("div", {}, `NEAR holds:   ${v.onchain} (asked `, el("a", { href: `${v.explorer}/address/${v.world}`, target: "_blank", rel: "noopener", textContent: v.world }), " directly)"),
      el("div", { textContent: `${v.steps} steps from the record up to the turn's fingerprint.` }),
    );
  } catch (e) { out.textContent = `The check couldn't finish (${String(e.message || e).slice(0, 80)}). Try again.`; }
});

load().then(() => startTalk($("talk-box"), W)).catch(() => ($("where").textContent = "The world didn't answer. Try again in a minute."));
// Live (his call 9 Nov: the page follows the world turn by turn): everything reloads every 30 seconds.
// A failed refresh keeps what's on screen.
setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 30_000);

// Pick a nation and one of its tokens, then ask NEAR directly what it is and who holds it.
$("tokcheck")?.addEventListener("click", async () => {
  const out = $("tokcheck-out");
  const pool = (W?.clans || []).filter((x) => x.alive && x.tokens?.sample);
  if (!pool.length) { out.replaceChildren(el("div", { textContent: "No tokens yet. They're minted on the next turn." })); return; }
  const x = pool[Math.floor(Math.random() * pool.length)], t = x.tokens.sample, rpc = RPC[W.net] || RPC.testnet;
  out.replaceChildren(el("div", { textContent: `Asking NEAR about ${t}…` }));
  try {
    const [info, bal] = await Promise.all([viewOnNear(rpc, W.world, "mt_token_info", { token_id: t }), viewOnNear(rpc, W.world, "mt_balance_of", { account_id: x.tokens.holder || x.dao, token_id: t })]);
    out.replaceChildren(
      el("div", { textContent: `mt_token_info("${t}") → ${info.kind}: "${info.title}", supply ${info.supply}${info.owner_id ? `, owned by ${info.owner_id}` : ""}` }),
      el("div", { textContent: `mt_balance_of(${x.tokens.holder || x.dao}, "${t}") → ${bal}` }),
      el("div", { className: "verdict", textContent: `${x.name}'s Broker holds ${bal} of it in its own wallet, straight from NEAR.` }),
    );
  } catch (e) { out.replaceChildren(el("div", { textContent: `NEAR didn't answer: ${String(e.message || e).slice(0, 120)}` })); }
});
