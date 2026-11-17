// The world contract's spare NEAR (13 Nov). The world pays the storage of whispers, gifts and each turn's
// root itself (a god must always be able to whisper to a nation that lost everything), so its spare
// (balance - what it owes - what storage locks) shrinks every turn. scripts/verify.mjs #1 fails below zero.
// Each scheduled turn the operator tops the spare back up to RESERVE.topTo when it's under RESERVE.min.
export const RESERVE = { min: 0.3, topTo: 1.0, max: 2 };

const micro = (y) => BigInt(y) / 10n ** 18n; // yoctoNEAR -> millionths of a NEAR (exact)

/** NEAR to send so the spare is RESERVE.topTo again, or 0. Never more than RESERVE.max at once. */
export function reserveTopUp(t) {
  if (!t || t.balance == null || t.liabilities == null || t.storage_locked == null) return 0;
  const spare = micro(t.balance) - micro(t.liabilities) - micro(t.storage_locked);
  if (spare >= BigInt(RESERVE.min * 1e6)) return 0;
  const send = Number(BigInt(RESERVE.topTo * 1e6) - spare) / 1e6;
  return Math.min(RESERVE.max, +send.toFixed(6));
}

// Each nation's DAO (17 Nov). Every motion a DAO keeps (whispers, stuns, seats) costs it storage, paid from its own
// NEAR, and nothing paid it back: by 16 Nov the older DAOs had 0.001-0.009 spare, and the world's vote to seat three
// AI gods failed (LackBalanceForState), so their motions were refused. Each scheduled turn the operator tops a DAO
// whose spare (balance - what its storage locks) is under DAO_RESERVE.min back up to DAO_RESERVE.topTo. A DAO's
// NEAR is no game number (florins live in the world contract), so this changes no score.
export const DAO_RESERVE = { min: 0.2, topTo: 1.0 };

/** NEAR to send a DAO with `spare` NEAR over its storage, or 0. */
export function daoTopUp(spare) {
  if (spare == null || !Number.isFinite(spare) || spare >= DAO_RESERVE.min) return 0;
  return +(DAO_RESERVE.topTo - Math.max(0, spare)).toFixed(6);
}
