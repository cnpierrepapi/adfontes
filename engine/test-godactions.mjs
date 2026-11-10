// Reads the REAL testnet DAOs (view calls only, nothing signed) and runs the engine's godActions on
// them, pretending reverence started before today's proposals, to prove each god power is credited
// to the god who proposed it. Needs the internet. Run: node engine/test-godactions.mjs
import { JsonRpcProvider } from "near-api-js";
import { NETWORKS } from "./config.mjs";
import * as RV from "./reverence.mjs";
const n = NETWORKS.testnet, provider = new JsonRpcProvider({ url: n.rpc });
const chain = { world: n.world, dao: (dao, method, args = {}) => provider.callFunction({ contractId: dao, method, args }) };
const clans = await provider.callFunction({ contractId: n.world, method: "list_clans", args: { limit: 100 } });
let bad = 0, credited = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
for (const oc of clans.filter((c) => c.alive)) {
  const s = {}, rv = RV.ensure(s, oc, 100, { fresh: false });
  rv.lastProposal = 0; rv.open = []; // pretend reverence started before every proposal
  const ch = [];
  await RV.godActions({ chain, s, oc, rv, day: 100, changes: ch });
  // Who actually proposed something that passed in this nation's DAO, read straight from the DAO.
  const last = await chain.dao(oc.dao, "get_last_proposal_id");
  const props = last ? await chain.dao(oc.dao, "get_proposals", { from_index: 0, limit: last }) : [];
  const ACTS = new Set(["whisper", "release_staking", "smite", "rule"]); // root_out only counts when it cuts something
  const passed = props.filter((p) => p.status === "Approved" && p.kind?.FunctionCall?.receiver_id === n.world).map((p) => {
    const fc = p.kind.FunctionCall.actions[0];
    let args = {}; try { args = JSON.parse(Buffer.from(fc.args, "base64").toString()); } catch {}
    return { god: p.proposer, method: fc.method_name, clan: Number(args.clan_id) };
  }).filter((p) => p.method === "rule" || p.clan === oc.id);
  const gods = new Set(oc.gods.map((g) => g.account));
  const proposers = new Set(passed.map((p) => p.god));
  const expected = new Set(passed.filter((p) => ACTS.has(p.method) && gods.has(p.god)).map((p) => p.god));
  const got = new Set(ch.map((c) => c.god));
  const strangers = [...got].filter((g) => !proposers.has(g)), missing = [...expected].filter((g) => !got.has(g));
  credited += ch.length;
  const short = (xs) => xs.map((g) => g.slice(0, 12)).join(", ");
  ok(!strangers.length && !missing.length, `${oc.name}: ${ch.length} god action${ch.length === 1 ? "" : "s"} from ${got.size} god${got.size === 1 ? "" : "s"}, each credited to the god who proposed it${strangers.length ? `; credited to a god with no passed proposal: ${short(strangers)}` : ""}${missing.length ? `; a proposer got nothing: ${short(missing)}` : ""}`);
}
ok(credited > 0, `the live DAOs had god actions to check (${credited})`);
if (bad) process.exitCode = 1;
