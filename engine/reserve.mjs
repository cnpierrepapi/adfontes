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
