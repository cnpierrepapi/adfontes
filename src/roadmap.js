// The roadmap (/roadmap, linked from the judge page only): public/roadmap.json, with a live check
// against NEAR or the site's API for every item that can be checked. Nothing here is hand-ticked
// when the chain can say it instead.
import { api } from "./net.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const RPC = { testnet: "https://near-testnet.drpc.org", mainnet: "https://rpc.mainnet.fastnear.com" };
const WORLD = { testnet: "w6.adf-pool1-hf0w8.testnet", mainnet: "world.adfontes.near" };
const N = (y) => Number(BigInt(y || 0) / 10n ** 18n) / 1e6;
const n2 = (x) => (Math.round(x * 100) / 100).toString();
async function view(net, method, args = {}, contract = WORLD[net]) {
  const r = await fetch(RPC[net], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) } }) }).then((x) => x.json());
  if (r.error || r.result?.error) throw new Error(JSON.stringify(r.error || r.result.error).slice(0, 120));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)));
}
const SEASON_END = Date.UTC(2026, 10, 30, 23, 0); // 30 Nov 23:00 UTC
const ok = (text) => ({ state: "ok", text }), wait = (text) => ({ state: "wait", text }), info = (text) => ({ state: "info", text });

let W = null;
const world = async () => (W ??= await api("world"));
// Each check returns { state: ok | wait | info, text }: what NEAR or the site says right now.
const CHECKS = {
  async world() { const c = await view("testnet", "get_config"); return ok(`${WORLD.testnet} answers: turn ${c.day}, ${c.season}.`); },
  async sealed() {
    const w = await world();
    for (let d = w.day; d >= w.day - 3; d--) {
      const day = await api(`day?d=${d}`);
      if (!day.root) continue;
      const onchain = await view("testnet", "get_root", { day: d });
      return onchain === day.root ? ok(`Turn ${d}: the fingerprint on NEAR matches its ${day.records.length} records.`) : info(`Turn ${d}: the fingerprints differ. Tell us.`);
    }
    return wait("No sealed turn in the last four.");
  },
  // Reads the keys themselves: each wallet must have exactly one, a function-call key for the world contract.
  async wallets() {
    const [b, p] = await Promise.all([view("testnet", "get_agent_wallet", { clan_id: 1, role: "Broker" }), view("testnet", "get_agent_wallet", { clan_id: 1, role: "Patron" })]);
    if (!b || !p) return wait("Not set up yet.");
    const keys = async (a) => (await fetch(RPC.testnet, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: a } }) }).then((x) => x.json())).result?.keys || [];
    const [kb, kp] = await Promise.all([keys(b), keys(p)]);
    const one = (k) => k.length === 1 && k[0].access_key.permission?.FunctionCall?.receiver_id === WORLD.testnet;
    return one(kb) && one(kp) ? ok(`Helios's Broker ${b} holds one key, which can only call ${kb[0].access_key.permission.FunctionCall.method_names.join(", ")}. Its Patron's can only call ${kp[0].access_key.permission.FunctionCall.method_names.join(", ")}.`) : info("Their keys aren't what we say. Tell us.");
  },
  async aliases() { const w = await world(), live = w.clans.filter((c) => c.alive), named = live.filter((c) => c.alias); return named.length === live.length ? ok(`All ${live.length} nations have one, like ${named[0]?.alias}.`) : wait(`${named.length} of ${live.length} nations so far.`); },
  async tokens() { const n = await view("testnet", "mt_count"); return ok(`${n} kinds of token on the world contract.`); },
  async market() { const [l, s] = await view("testnet", "market_count"); return ok(`${l} listing${l === "1" ? "" : "s"} and ${s} sale${s === "1" ? "" : "s"} so far, all on chain.`); },
  async royalties() { const m = await api("market"); return m.counts.royalty_payments ? ok(`${m.counts.royalty_payments} paid so far, ${n2(m.counts.royalties)} florins in all.`) : wait("None paid yet."); },
  async founding() { const [fund, min] = await view("testnet", "get_founding"); return N(fund) > 0 ? ok(`The fund holds ${n2(N(fund))} NEAR; founding a nation takes ${n2(N(min))} NEAR right now.`) : wait(`The fund is empty right now: a founder with their own wallet pays for the DAO (founding takes ${n2(N(min))} NEAR). The next player the pool sets up refills it.`); },
  async sandbox() { const s = await fetch("/sbx/info").then((x) => x.json()); return s.base_day ? ok(`A copy of live turn ${s.base_day} is ready; ${s.in_use} of ${s.max} sandboxes in use.`) : info("The sandbox hasn't copied the live world yet."); },
  async mainnetContract() {
    const has = await view("mainnet", "get_founding").then(() => true, () => false);
    return has ? ok(`${WORLD.mainnet} runs the current contract.`) : wait("No mainnet world right now. The first version was retired on 10 November, and its NEAR returned.");
  },
  async mainnetEngine() { const c = await api("clan?id=1&net=mainnet").catch(() => null); return c && !c.error && c.open !== false ? ok("Mainnet nations are taking turns.") : wait("No turns on mainnet yet."); },
  async intents() { return wait("Not done yet. The top-up card is built; the real swap hasn't been made."); },
  async refill() {
    const s = await api("sponsor");
    if (!s.next_refill_ms) return wait("Hasn't run yet.");
    const t = (ms) => new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return ok(`Last topped up ${t(s.next_refill_ms - 12 * 3600e3)}, next ${t(s.next_refill_ms)}. It can fund ${s.nations_left ?? "?"} more players.`);
  },
  async sponsor() { const s = await api("sponsor"); return s.available ? ok(`Each new player gets ${n2(s.per_nation)} test NEAR. The pool can fund ${s.nations_left} more right now.`) : wait("The pool is empty right now. It refills every 12 hours."); },
  async jackpot() {
    const t = await view("testnet", "get_totals");
    if (t.jackpot_paid) return ok(`Paid: ${n2(N(t.jackpot))} NEAR.`);
    const days = Math.max(0, Math.ceil((SEASON_END - Date.now()) / 86400e3));
    return wait(`${n2(N(t.jackpot))} NEAR in the jackpot. ${days} day${days === 1 ? "" : "s"} to go.`);
  },
};

async function load() {
  const R = await fetch("/roadmap.json", { cache: "no-cache" }).then((x) => x.json());
  $("updated").textContent = `Plan last edited ${R.updated}. Checks run when you load this page.`;
  const sections = R.groups.map((g) => {
    const list = el("ul", { className: "rm-list" });
    for (const it of R.items.filter((x) => x.group === g.id)) {
      const status = el("p", { className: "rm-status", textContent: it.check ? "Checking…" : g.id === "not" ? "Dropped." : g.id === "done" ? "Done." : "Planned." });
      const li = el("li", { className: `rm-item ${g.id}` }, el("span", { className: `rm-dot ${g.id}` }), el("div", {}, el("b", { textContent: it.title }), el("p", { textContent: it.text }), status));
      list.append(li);
      if (it.check && CHECKS[it.check]) CHECKS[it.check]().then((r) => { status.textContent = r.text; status.className = `rm-status ${r.state}`; }).catch((e) => { status.textContent = `Couldn't check just now (${String(e.message || e).slice(0, 60)}).`; status.className = "rm-status info"; });
    }
    const intro = el("p", { textContent: g.intro });
    if (g.link) intro.append(" ", el("a", { href: g.link.href, textContent: g.link.text }), ".");
    return el("section", { id: g.id }, el("h2", { textContent: g.title }), intro, list);
  });
  $("groups").replaceChildren(...sections);
}
load().catch(() => ($("updated").textContent = "The roadmap didn't load. Try again in a minute."));
