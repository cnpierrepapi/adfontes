// The judges' page: live numbers, a proof you check in your own browser, the last turn on chain.
import { api } from "./net.js";
import { says as saysWith, tipOf } from "./says.js";
import { sectionNav } from "./pagenav.js";
sectionNav();

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null)); return n; };
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const n = (x, d = 3) => (Math.round(x * 10 ** d) / 10 ** d).toString();

let W = null, sealed = null;
const clanName = (id) => W?.clans.find((c) => c.id === Number(id))?.name ?? `nation ${id}`;

// One read-only call to NEAR from your browser, no server in between.
async function viewOnNear(rpc, contract, method, args) {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) } }) }).then((x) => x.json());
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)));
}
const RPC = { testnet: "https://near-testnet.drpc.org", mainnet: "https://rpc.mainnet.fastnear.com" };

async function rootOnNear(rpc, world, day) {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: world, method_name: "get_root", args_base64: btoa(JSON.stringify({ day })) } }) }).then((x) => x.json());
  return JSON.parse(String.fromCharCode(...r.result.result));
}

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
  $("where").textContent = `${W.season} · ${W.net === "mainnet" ? "NEAR mainnet" : "NEAR testnet"} · turn ${W.day}`;
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
  $("accounts").replaceChildren(...live.map((x) => el("li", {}, el("b", { textContent: x.name }), " · ", x.alias ? link(x.alias) : "named account coming on its next turn", " → treasury ", link(x.dao))));
  // Research as NEP-245 tokens: what each nation's DAO holds, and a live check against NEAR.
  const pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  $("tokens").replaceChildren(...live.filter((x) => x.tokens).map((x) => el("li", {}, el("b", { textContent: x.name }), ` · ${pl(x.tokens.research, "research token")}, ${pl(x.tokens.patents, "patent")}, ${pl(x.tokens.kits, "kit")}`)));
  if (!live.some((x) => x.tokens?.sample)) $("tokens").replaceChildren(el("li", { textContent: "The first tokens are minted on the next turn." }));
  sealed = await lastSealed();
  const txs = (sealed?.records || []).filter((r) => r.tx).slice(-12).reverse();
  $("chain-intro").replaceChildren("The world contract is ", el("a", { href: `${W.explorer}/address/${W.world}`, target: "_blank", rel: "noopener", textContent: W.world }), sealed ? `. Below: transactions from turn ${sealed.day}, the last one sealed on NEAR.` : ". No turn is sealed yet.");
  $("txs").replaceChildren(...txs.map((r) => el("li", {}, el("span", { textContent: saysWith(r, clanName) }), ...(tipOf(r) ? [el("span", { className: "tip", textContent: tipOf(r) })] : []), " ", el("a", { className: "near", href: `${W.explorer}/txns/${r.tx}`, target: "_blank", rel: "noopener", textContent: "NEAR ↗", title: "Open this transaction on NEAR" }))));
  if (!txs.length) $("txs").append(el("li", { textContent: "No transactions in the last sealed turn yet." }));
}

$("check").addEventListener("click", async () => {
  const out = $("check-out");
  if (!sealed) return void (out.textContent = "No turn is sealed yet. Try again in a few minutes.");
  out.textContent = "Checking…";
  try {
    const i = Math.floor(Math.random() * sealed.records.length), d = sealed.day;
    const p = await api(`proof?d=${d}&i=${i}`);
    if (p.error) return void (out.textContent = "That record doesn't exist.");
    const leaf = p.scheme === "original text" ? await sha256(p.raw) : await sha256(canon(p.record));
    let h = leaf;
    for (const s of p.path) h = s.left ? await sha256(s.hash + h) : await sha256(h + s.hash);
    const onchain = await rootOnNear(p.rpc, p.world, d);
    const ok = h === onchain;
    out.replaceChildren(
      el("div", { className: `verdict ${ok ? "yes" : "no"}`, textContent: ok ? `Matches NEAR. Record ${i + 1} of turn ${d} is exactly what happened.` : "Doesn't match. That record isn't what was sealed." }),
      el("div", { textContent: `The record: ${saysWith(p.record, clanName)}` }),
      el("div", { textContent: `Your browser got: ${h}` }),
      el("div", {}, `NEAR holds:   ${onchain} (asked `, el("a", { href: `${p.explorer}/address/${p.world}`, target: "_blank", rel: "noopener", textContent: p.world }), " directly)"),
      el("div", { textContent: `${p.path.length} steps from the record up to the turn's fingerprint.` }),
    );
  } catch (e) { out.textContent = `The check couldn't finish (${String(e.message || e).slice(0, 80)}). Try again.`; }
});

load().catch(() => ($("where").textContent = "The world didn't answer. Try again in a minute."));

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
