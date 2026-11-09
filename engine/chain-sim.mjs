// A stand-in chain for the fast-forward simulation (his call 8 Nov: run a week of the world
// locally, never on the live testnet world). It answers the same calls as engine/chain.mjs from a
// JSON file seeded with a copy of the live world's on-chain state, and follows the contract's money
// rules: mint adds florins (the backing doesn't grow), burn removes them, trade moves them.
// Each engine turn is its own process, so every change is written straight back to the file.
import fs from "node:fs";

const MINT_MAX = 100;
const UNIT = 10n ** 16n; // engine/chain.mjs toUnits: florins x 1e6 x 1e16
const units = (fl) => BigInt(Math.round(fl * 1e6)) * UNIT;

export function connectSim(file) {
  const load = () => JSON.parse(fs.readFileSync(file, "utf8"));
  let S = load();
  const save = () => fs.writeFileSync(file, JSON.stringify(S));
  let n = 0;
  const tx = (value = null) => ({ hash: `sim-${S.config.day}-${++n}-${Date.now().toString(36)}`, value });
  const clan = (id) => { const c = S.clans.find((x) => x.id === Number(id)); if (!c || !c.alive) throw new Error(`No live clan ${id}`); return c; };
  const add = (c, u) => { c.florins = (BigInt(c.florins) + u).toString(); };
  return {
    world: "sim.local",
    operator: "sim-operator",
    sim: true,
    config: async () => S.config,
    totals: async () => {
      const fl = BigInt(S.totals.florins), backing = BigInt(S.totals.backing);
      return { ...S.totals, florin_value: fl > 0n ? ((backing * 10n ** 22n) / fl).toString() : "0" }; // same as the contract
    },
    clans: async () => S.clans,
    agents: async (id) => S.agents[id] || [],
    gift: async (id) => S.gifts[id] ?? null,
    // The DAOs: quiet unless scripts/sim-gods.mjs wrote simulated gods' proposals between turns
    // (S.daos[dao] = proposals in Sputnik's shape, already voted through).
    dao: async (dao, method, args = {}) => {
      const list = S.daos?.[dao] || [];
      if (method === "get_last_proposal_id") return list.length;
      if (method === "get_proposals") return list.slice(args.from_index, args.from_index + args.limit);
      if (method === "get_proposal") return list[args.id] ?? null;
      return [];
    },
    tick: async (day) => { S.config.day = day; save(); return tx(); },
    spawn: async (id, name, role) => { (S.agents[id] ||= []).push({ name, role, clan_id: Number(id), alive: true, stunted_until: 0, born_day: S.config.day }); save(); return tx(); },
    stake: async () => ({ florins: "0", near: "0", put_in: "0" }),
    trade: async (buyer, seller, florins) => {
      const b = clan(buyer), s = clan(seller), u = units(florins);
      if (BigInt(b.florins) < u) throw new Error("Buyer can't afford it");
      add(b, -u); add(s, u); save(); return tx();
    },
    mint: async (id, florins) => {
      let last = null;
      for (let left = florins; left > 1e-6; left -= MINT_MAX) {
        const u = units(Math.min(MINT_MAX, left));
        add(clan(id), u); S.totals.florins = (BigInt(S.totals.florins) + u).toString(); S.totals.minted = (BigInt(S.totals.minted || 0) + u).toString();
        last = tx();
      }
      save(); return last;
    },
    burn: async (id, florins) => {
      const c = clan(id), want = units(florins), have = BigInt(c.florins), u = want < have ? want : have;
      add(c, -u); S.totals.florins = (BigInt(S.totals.florins) - u).toString(); S.totals.burned = (BigInt(S.totals.burned || 0) + u).toString();
      save(); return tx(u.toString());
    },
    giftDraft: async (id, hash, passed) => { const gid = S.nextGift++; S.gifts[gid] = { id: gid, clan: Number(id), draft_hash: hash, warden_passed: passed, status: "Pending", day: S.config.day }; if (passed) clan(id).clean_gifts = (clan(id).clean_gifts || 0) + 1; save(); return tx(gid); },
    // Agent wallets, as on the real chain: the Broker buys and the Patron spends, each "signing" as itself.
    agentId: (id, role) => `${role === "Broker" ? "trader" : "patron"}${id}.sim-operator`,
    ensureAgents: async (id) => { S.wallets ||= {}; const made = []; for (const role of ["Broker", "Patron"]) { const k = `${id}:${role}`; if (!S.wallets[k]) { S.wallets[k] = `${role === "Broker" ? "trader" : "patron"}${id}.sim-operator`; made.push(S.wallets[k]); } } save(); return made; },
    ensureAlias: async (id) => { S.aliases ||= {}; S.aliases[id] ||= `${clan(id).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "nation"}.sim.local`; save(); return S.aliases[id]; },
    forwardAlias: async () => null, // nothing is ever sent to a stand-in account
    mtMint: async (mints) => { S.mt ||= {}; for (const m of mints) { const k = `${m.owner_id}|${m.token_id}`; S.mt[k] = String(BigInt(S.mt[k] || 0) + BigInt(m.amount)); } save(); return tx(); },
    mtMoveToBroker: async () => ({ moved: 0, hash: null }),
    mtHoldsAny: async () => false,
    mtBalances: async (owner, ids) => ids.map((t) => (S.mt || {})[`${owner}|${t}`] || "0"),
    agentBuy: async function (buyer, seller, florins, memo) { const r = await this.trade(buyer, seller, florins, memo); return { ...r, signer: `trader${buyer}.sim-operator` }; },
    agentSpend: async function (id, florins, memo) { const r = await this.burn(id, florins, memo); return { ...r, signer: `patron${id}.sim-operator` }; },
    setRoot: async (day, root) => { S.roots[day] = root; save(); return tx(); },
    getRoot: async (day) => S.roots[day] ?? null,
  };
}
