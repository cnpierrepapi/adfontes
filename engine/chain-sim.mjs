// A stand-in chain for the fast-forward simulation (his call 8 Nov: run a week of the world
// locally, never on the live testnet world). It answers the same calls as engine/chain.mjs from a
// JSON file seeded with a copy of the live world's on-chain state, and follows the contract's money
// rules: mint adds florins (the backing doesn't grow), burn removes them, trade moves them.
// Each engine turn is its own process, so every change is written straight back to the file.
import fs from "node:fs";
import { gasTopUp } from "./market.mjs";
import { guard as aiGuard } from "./aigods.mjs";

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
  // Gas, as on NEAR (12 Nov): an agent wallet signs only with ~0.031 NEAR spare (the transaction's
  // worst-case prepaid gas) and each signed call burns ~0.001. A wallet with no recorded balance (copies
  // seeded before 12 Nov) counts as 0.2. S.gas: { [account]: NEAR }.
  const GAS_NEED = 0.031, GAS_USED = 0.001;
  const sign = (account) => {
    S.gas ||= {};
    const have = S.gas[account] ?? 0.2;
    if (have < GAS_NEED) throw new Error(`Not enough balance for ${account} (balance: ${BigInt(Math.round(have * 1e6)) * 10n ** 18n}, cost: ${BigInt(Math.round(GAS_NEED * 1e6)) * 10n ** 18n})`);
    S.gas[account] = +(have - GAS_USED).toFixed(6);
  };
  const traderOf = (id) => `trader${id}.sim-operator`;
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
      // A council's policy, as Sputnik answers it: gods vote in their own role; a motion bond of 0.01 NEAR.
      if (method === "get_policy") { const c = S.clans.find((x) => x.dao === dao); return { proposal_bond: "10000000000000000000000", roles: [{ name: "gods", kind: { Group: (c?.gods || []).map((g) => g.account) } }], default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] } }; }
      return [];
    },
    // AI gods (12 Nov), as on the real chain: every call passes the same guard; a blessing raises the god's
    // put_in (the engine reads that as a blessing); a motion lands in the nation's DAO already voted through
    // (its fellow AI gods vote yes), the way scripts/sim-gods.mjs writes them.
    aiEnsure: async () => false,
    aiBalance: async (account) => (S.aiBal ||= {})[account] ?? 1,
    aiTopUp: async (account, min, to) => { S.aiBal ||= {}; const have = S.aiBal[account] ?? 1; if (have >= min) return 0; S.aiBal[account] = to; save(); return +(to - have).toFixed(4); },
    aiSend: async (account, calls) => {
      let last = null;
      for (const c0 of calls) {
        const c = c0.bind ? c0.bind(last) : c0;
        aiGuard(c, "sim.local");
        if (c.method === "bless") {
          const cl = clan(c.args.clan_id), g = cl.gods.find((x) => x.account === account);
          if (!g) throw new Error("Not a god of that nation");
          const y = BigInt(c.deposit);
          g.put_in = (BigInt(g.put_in) + y).toString(); cl.total_in = (BigInt(cl.total_in || 0) + y).toString();
          S.aiBal ||= {}; S.aiBal[account] = +((S.aiBal[account] ?? 1) - Number(y / 10n ** 18n) / 1e6).toFixed(6);
        } else if (c.method === "add_proposal") {
          const list = ((S.daos ||= {})[c.receiver] ||= []);
          last = list.length;
          list.push({ id: last, proposer: account, status: "Approved", description: c.args.proposal.description, kind: c.args.proposal.kind });
        }
      }
      save();
      return { ...tx(last), proposal: last, signer: account };
    },
    tick: async (day) => { S.config.day = day; save(); return tx(); },
    spawn: async (id, name, role) => { (S.agents[id] ||= []).push({ name, role, clan_id: Number(id), alive: true, stunted_until: 0, born_day: S.config.day }); save(); return tx(); },
    // A god's stake as the copy was taken (scripts/sim-seed.mjs): its granted NEAR keeps the ring-fence.
    stake: async (id, account) => S.stakes?.[`${id}|${account}`] ?? { florins: "0", near: "0", put_in: "0" },
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
    // The marketplace, as the contract does it (contracts/world/src/market.rs), in the sim's file.
    marketList: async (id, tokenId, florins, reason) => {
      sign(traderOf(id));
      S.market ||= { listings: [], sales: [] };
      const open = S.market.listings.filter((l) => l.seller === id && l.open);
      if (open.length >= 10) throw new Error("A nation can have at most 10 open listings");
      if (open.some((l) => l.token_id === tokenId)) throw new Error("That's already listed");
      const l = { id: S.market.listings.length, seller: id, token_id: tokenId, price: florins, kind: tokenId.startsWith("p:") ? "sale" : "copy", open: true, day: S.config.day, reason, sold: 0 };
      S.market.listings.push(l); save(); return { ...tx(l.id), signer: `trader${id}.sim-operator` };
    },
    marketDelist: async (id, listingId) => { sign(traderOf(id)); const l = S.market?.listings[listingId]; if (!l || l.seller !== id || !l.open) throw new Error("Not your open listing"); l.open = false; save(); return tx(); },
    marketBuy: async (id, listingId, reason) => {
      const l = S.market?.listings[listingId];
      if (!l || !l.open) throw new Error("That listing is closed");
      if (l.seller === id) throw new Error("That's your own listing");
      sign(traderOf(id));
      // As market.rs: a copy is refused if the buyer's Broker holds it or its nation bought it before.
      if (l.kind === "copy" && (BigInt((S.mt || {})[`${traderOf(id)}|${l.token_id}`] || 0) > 0n || (S.market.sales || []).some((x) => x.buyer === id && x.token_id === l.token_id))) throw new Error("Smart contract panicked: You already have that");
      const b = clan(id), sl = clan(l.seller), u = units(l.price);
      if (BigInt(b.florins) < u) throw new Error("Buyer can't afford it");
      add(b, -u); add(sl, u);
      if (l.kind === "sale") l.open = false; else l.sold++;
      const sale = { id: S.market.sales.length, listing: l.id, buyer: id, seller: l.seller, token_id: l.token_id, price: l.price, day: S.config.day, reason };
      S.market.sales.push(sale); save(); return { ...tx(sale.id), signer: `trader${id}.sim-operator` };
    },
    ensureGas: async (id, role) => {
      const account = `${role === "Broker" ? "trader" : "patron"}${id}.sim-operator`;
      S.gas ||= {};
      const send = gasTopUp(S.gas[account] ?? 0.2);
      if (send) { S.gas[account] = +((S.gas[account] ?? 0) + send).toFixed(6); save(); }
      return send;
    },
    marketListings: async (from = 0) => (S.market?.listings || []).slice(from),
    marketSales: async (from = 0) => (S.market?.sales || []).slice(from),
    agentBuy: async function (buyer, seller, florins, memo) { sign(traderOf(buyer)); save(); const r = await this.trade(buyer, seller, florins, memo); return { ...r, signer: `trader${buyer}.sim-operator` }; },
    agentSpend: async function (id, florins, memo) { sign(`patron${id}.sim-operator`); save(); const r = await this.burn(id, florins, memo); return { ...r, signer: `patron${id}.sim-operator` }; },
    setRoot: async (day, root) => { S.roots[day] = root; save(); return tx(); },
    getRoot: async (day) => S.roots[day] ?? null,
  };
}
