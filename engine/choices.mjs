// Signed choices (PLAN_13NOV step 0, 13 Nov): what gods decide that the contract doesn't cover (the Scholars'
// pitch, and the next steps: asking the accused, telling the Broker what to list). A god signs a small message with
// its own key; server.mjs checks it here and stores it; engine/run.mjs reads the turn's choices at its start and
// seals each one as a record. Silence = today's behaviour. AI gods' choices are written by the engine itself.
// Tested in engine/test-choices.mjs.
import { ed25519 } from "@noble/curves/ed25519.js";
import { baseDecode } from "near-api-js";
import { createHash } from "node:crypto";

// Outside wallets (Meteor) sign NEAR's standard way (NEP-413): sha256(borsh(tag, { message, nonce, recipient,
// callbackUrl: none })). Only signatures meant for this site count.
export const RECIPIENTS = new Set(["adfontes.fun"]);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = (s) => { const b = Buffer.from(String(s), "utf8"); return Buffer.concat([u32(b.length), b]); };
export function verify413(message, nep413, signature, publicKey) {
  try {
    const nonce = Buffer.from(String(nep413?.nonce || ""), "base64");
    if (nonce.length !== 32 || !RECIPIENTS.has(nep413?.recipient) || !/^ed25519:/.test(publicKey)) return false;
    const hash = createHash("sha256").update(Buffer.concat([u32(2147484061), str(message), nonce, str(nep413.recipient), Buffer.from([0])])).digest();
    return ed25519.verify(Buffer.from(String(signature), "base64"), hash, baseDecode(publicKey.slice(8)));
  } catch { return false; }
}

/** The kinds of choice, and what a valid payload looks like. */
export const KINDS = {
  pitch: (p) => typeof p?.point === "string" && p.point.trim().length > 0 && p.point.length <= 120,
};

/** The exact text a god signs (the browser builds the same string). */
export const messageOf = ({ world, kind, clan, payload, day, nonce }) =>
  `adfontes-choice:${JSON.stringify({ world, kind, clan: Number(clan), payload, day: Number(day), nonce: String(nonce) })}`;

/** Does `signature` (base64) by `publicKey` ("ed25519:<base58>") sign `message`? */
export function verifySignature(message, signature, publicKey) {
  try {
    if (!/^ed25519:/.test(publicKey)) return false;
    return ed25519.verify(Buffer.from(String(signature), "base64"), new TextEncoder().encode(message), baseDecode(publicKey.slice(8)));
  } catch { return false; }
}

/** Check a signed choice. env = { world, day (the open turn), keyOn(account, publicKey), godOf(clan, account) }.
 *  Returns { ok, row } or { error } (plain words for the page). */
export async function acceptChoice(b, env) {
  if (!b || typeof b !== "object") return { error: "Nothing to read." };
  if (!Object.hasOwn(KINDS, b.kind)) return { error: "That kind of choice doesn't exist." };
  if (b.world !== env.world) return { error: "That choice is for another world." };
  if (Number(b.day) !== Number(env.day)) return { error: "That choice is for another turn. Reload and choose again." };
  if (!KINDS[b.kind](b.payload)) return { error: "That choice is empty or too long." };
  const signedOk = b.nep413 ? verify413(messageOf(b), b.nep413, b.signature, b.publicKey) : verifySignature(messageOf(b), b.signature, b.publicKey);
  if (!signedOk) return { error: "The signature doesn't match. Nothing was saved." };
  if (!(await env.keyOn(b.account, b.publicKey))) return { error: "That key isn't on this account." };
  if (!(await env.godOf(Number(b.clan), b.account))) return { error: "Only a god of this nation can choose for it." };
  return { ok: true, row: { day: Number(b.day), clan: Number(b.clan), kind: b.kind, account: b.account, payload: b.payload } };
}

/** The record a choice becomes in its turn (sealed on NEAR with the rest). */
export const recordOf = (row) => ({ kind: "choice", clan: row.clan, choice: row.kind, god: row.account, payload: row.payload });
