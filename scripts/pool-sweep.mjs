// One-off: sweep the helper accounts made by helper-limit-test.mjs (adf-pool2..) into the sponsor
// pool (adf-pool1-…). Keys are read from .keys and never printed; swept accounts' key files go.
import fs from "node:fs";
import { sweep, balanceOf, nationsLeft } from "../engine/sponsor.mjs";
const files = fs.readdirSync(".keys").filter((f) => /^adf-pool\d+-/.test(f)).sort((a, b) => parseInt(a.slice(8)) - parseInt(b.slice(8)));
const pool = JSON.parse(fs.readFileSync(`.keys/${files[0]}`, "utf8")).account_id;
console.log("pool:", pool);
for (const f of files.slice(1)) {
  const k = JSON.parse(fs.readFileSync(`.keys/${f}`, "utf8"));
  try { await sweep(k.account_id, k.private_key, pool); fs.unlinkSync(`.keys/${f}`); console.log("swept", k.account_id); }
  catch (e) { console.log("failed", k.account_id, String(e.message).slice(0, 120)); }
}
await new Promise((r) => setTimeout(r, 3000));
const b = await balanceOf(pool);
console.log(`pool balance ${Number(b / 10n ** 21n) / 1000} NEAR -> new testnet nations it can sponsor: ${await nationsLeft(pool)}`);
