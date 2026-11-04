// Spike 2b: read a clan DAO's council and config back from chain.
import { provider } from "./lib.mjs";

const daoId = process.argv[2];
if (!daoId) throw new Error("usage: node spikes/02b-dao-policy.mjs <dao account>");
const pol = await provider.callFunction({ contractId: daoId, method: "get_policy", args: {} });
const cfg = await provider.callFunction({ contractId: daoId, method: "get_config", args: {} });
console.log("config:", JSON.stringify(cfg));
console.log("council:", JSON.stringify(pol.roles.find((r) => r.name === "council")?.kind));
console.log("proposal bond:", pol.proposal_bond, "yocto");
