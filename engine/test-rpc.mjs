// The engine's NEAR RPC rides out rate limits (9 Nov: a FastNEAR 429 crashed a turn): a main RPC that
// only answers 429 falls back to the backup; a contract refusal still comes straight back.
import http from "node:http";
import { resilientProvider } from "./chain.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
let hits = 0;
const srv = http.createServer((req, res) => { hits++; res.writeHead(429, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -429, message: "Rate limits exceeded" }, id: "1" })); });
await new Promise((r) => srv.listen(0, r));
const p = resilientProvider("testnet", `http://127.0.0.1:${srv.address().port}`);
const t0 = Date.now();
const cfg = await p.callFunction({ contractId: "w6.adf-pool1-hf0w8.testnet", method: "get_config", args: {} });
ok(cfg?.operator && hits >= 1, `a main RPC answering only 429 (${hits} tries) fell back to the backup RPC (testnet: FastNEAR) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
let refused = null;
try { await p.callFunction({ contractId: "w6.adf-pool1-hf0w8.testnet", method: "no_such_method", args: {} }); } catch (e) { refused = e; }
ok(refused && !/429/.test(String(refused.message)), "a contract error still comes straight back (no retry loop)");
srv.close();
