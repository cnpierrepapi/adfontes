// Check one record against NEAR from the browser: hash it, climb its Merkle path to the turn's
// fingerprint, then ask the world contract directly what fingerprint it holds for that turn.
// Shared by the judges' page's "Check a random record" and the agents' talk.
import { api } from "./net.js";

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
export const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);

export async function rootOnNear(rpc, world, day) {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: world, method_name: "get_root", args_base64: btoa(JSON.stringify({ day })) } }) }).then((x) => x.json());
  return JSON.parse(String.fromCharCode(...r.result.result));
}

/** Record i of turn d: { ok, record, mine, onchain, steps, world, explorer } or { error }. */
export async function verifyRecord(d, i) {
  const p = await api(`proof?d=${d}&i=${i}`);
  if (p.error) return { error: "That record doesn't exist." };
  const leaf = p.scheme === "original text" ? await sha256(p.raw) : await sha256(canon(p.record));
  let h = leaf;
  for (const s of p.path) h = s.left ? await sha256(s.hash + h) : await sha256(h + s.hash);
  const onchain = await rootOnNear(p.rpc, p.world, d);
  return { ok: h === onchain, record: p.record, mine: h, onchain, steps: p.path.length, world: p.world, explorer: p.explorer };
}
