// Every transaction the god panel can send, built in one place. The panel shows these on the
// confirm card and hands them to the wallet; scripts/testnet-gods.mjs signs the very same objects
// with the testnet god keys to prove each one on chain. No DOM, no wallet: plain data.
// A call = { receiver, method, args, deposit (yocto bigint), gas (bigint), show?, note? }.
export const TGAS = 10n ** 12n;
const near = (y) => { const v = BigInt(y), w = v / 10n ** 24n, f = ((v % 10n ** 24n) * 10000n) / 10n ** 24n; return f ? `${w}.${String(f).padStart(4, "0").replace(/0+$/, "")}` : String(w); };
// Gas per call (Tgas). Generous on purpose: unused gas is refunded.
export const GAS = { found: 300, bless: 200, join: 150, withdraw: 200, claimGift: 30, claimOwed: 60, propose: 50, vote: 150, inner: { release_staking: 60, rule: 30, whisper: 30, smite: 30 } };
const T = (n) => BigInt(n) * TGAS;
const b64 = (obj) => { const bytes = new TextEncoder().encode(JSON.stringify(obj)); let s = ""; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };

export const found = (world, name, deposit) => ({ receiver: world, method: "found_clan", args: { name }, deposit: BigInt(deposit), gas: T(GAS.found) });
export const bless = (world, clanId, deposit) => ({ receiver: world, method: "bless", args: { clan_id: clanId }, deposit: BigInt(deposit), gas: T(GAS.bless) });
export const joinDao = (world, clanId, bond) => ({ receiver: world, method: "join_dao", args: { clan_id: clanId }, deposit: BigInt(bond), gas: T(GAS.join) });
export const withdraw = (world, clanId) => ({ receiver: world, method: "withdraw", args: { clan_id: clanId }, deposit: 0n, gas: T(GAS.withdraw) });
export const claimGift = (world, giftId) => ({ receiver: world, method: "claim_gift", args: { gift_id: giftId }, deposit: 0n, gas: T(GAS.claimGift) });
export const claimOwed = (world) => ({ receiver: world, method: "claim_owed", args: {}, deposit: 0n, gas: T(GAS.claimOwed) });

/** The DAO proposal kind that makes the clan's DAO call `method` on the world. */
export const daoKind = (world, method, args) => ({ FunctionCall: { receiver_id: world, actions: [{ method_name: method, args: b64(args), deposit: "0", gas: String(T(GAS.inner[method])) }] } });

/**
 * A DAO power: [propose, vote yes], signed one after the other. The vote is bound to the id the
 * proposal ACTUALLY got (add_proposal's return value), never a guessed "next id": this Sputnik
 * version doesn't check a vote's `proposal` kind (proven on testnet, testnet-gods.mjs f4), so a
 * guessed id could approve somebody else's proposal that landed first.
 */
export function daoPower(world, dao, bond, method, args, description) {
  const kind = daoKind(world, method, args);
  const yes = (id) => ({ receiver: dao, method: "act_proposal", args: { id, action: "VoteApprove", proposal: kind }, show: { id, action: "VoteApprove" }, deposit: 0n, gas: T(GAS.vote), note: "Your yes vote on it." });
  return [
    { receiver: dao, method: "add_proposal", args: { proposal: { description, kind } }, show: { proposal: { description, kind: { FunctionCall: { receiver_id: world, actions: [{ method_name: method, args, deposit: "0" }] } } } }, deposit: BigInt(bond), gas: T(GAS.propose), note: `Proposes it to the nation's DAO. The ${near(bond)} NEAR bond comes back to you when the proposal passes or expires.` },
    { ...yes("the new proposal's number"), bind: (proposalId) => yes(Number(proposalId)), note: "Your yes vote on it. Your wallet asks a second time, once the proposal has its number." },
  ];
}

/** The value a successful call returned (e.g. add_proposal's new id), from an execution outcome. */
export function returned(outcome) {
  const v = outcome?.status?.SuccessValue;
  if (v == null || v === "") return null;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v), (c) => c.charCodeAt(0)))); } catch { return null; }
}

/** A vote on an open proposal (as read from get_proposals). */
export function vote(dao, proposal, action) {
  const act = proposal.kind.FunctionCall?.actions?.[0];
  let args = {};
  try { args = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(act.args), (c) => c.charCodeAt(0)))); } catch {}
  return { receiver: dao, method: "act_proposal", args: { id: proposal.id, action, proposal: proposal.kind }, show: { id: proposal.id, action, runs: { method: act?.method_name, args } }, deposit: 0n, gas: T(GAS.vote), decoded: { method: act?.method_name, args } };
}

/** Yes votes a proposal still needs: Sputnik's RoleWeight threshold 1/2 = floor(n/2) + 1. */
export const needed = (gods, yes) => Math.max(0, Math.floor(gods / 2) + 1 - yes);
