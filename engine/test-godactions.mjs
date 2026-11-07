// Reads the REAL testnet DAOs (view calls only, nothing signed) and runs the engine's godActions on
// them, pretending reverence started before today's proposals, to prove each god power is credited
// to the god who proposed it. Run: node engine/test-godactions.mjs
import { JsonRpcProvider } from "near-api-js";
import { NETWORKS } from "./config.mjs";
import * as RV from "./reverence.mjs";
const n = NETWORKS.testnet, provider = new JsonRpcProvider({ url: n.rpc });
const chain = { world: n.world, dao: (dao, method, args = {}) => provider.callFunction({ contractId: dao, method, args }) };
const clans = await provider.callFunction({ contractId: n.world, method: "list_clans", args: { limit: 100 } });
for (const oc of clans.filter((c) => c.alive)) {
  const s = {}, rv = RV.ensure(s, oc, 100, { fresh: false });
  rv.lastProposal = 0; rv.open = []; // pretend reverence started before every proposal
  const ch = [];
  await RV.godActions({ chain, s, oc, rv, day: 100, changes: ch });
  console.log(`${oc.name}: ${ch.length ? ch.map((c) => `${c.god.split(".")[0]} ${c.d > 0 ? "+" : ""}${c.d} ${c.why}`).join(" | ") : "no god actions"}`);
}
