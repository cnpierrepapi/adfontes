// 17 Nov: the nations' DAOs ran out of storage NEAR (every motion they keep costs some, and nothing paid it back),
// so the world's vote to seat three AI gods failed (LackBalanceForState) and their motions were refused.
// 1. daoTopUp: under 0.2 spare, top back up to 1; never for a healthy DAO or a bad read.
// 2. run.mjs calls chain.keepDao for every nation on scheduled turns only, and logs what it sent.
// 3. chain.mjs sends daoTopUp's amount from the operator; the stand-in chain has a keepDao too.
import fs from "node:fs";
import { daoTopUp, DAO_RESERVE } from "./reserve.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };

ok(DAO_RESERVE.min === 0.2 && DAO_RESERVE.topTo === 1, "the rule: under 0.2 spare, back up to 1");
ok(daoTopUp(0.0012) === 0.9988, `Kristalnjik on 16 Nov (0.0012 spare) gets 0.9988 (${daoTopUp(0.0012)})`);
ok(daoTopUp(0.1999) === 0.8001, "just under the line: topped up");
ok(daoTopUp(0.2) === 0 && daoTopUp(1.02) === 0, "at or over the line: nothing");
ok(daoTopUp(-0.05) === 1, "a DAO already short gets the full 1, never more");
ok(daoTopUp(null) === 0 && daoTopUp(undefined) === 0 && daoTopUp(NaN) === 0, "a read that failed sends nothing");

const run = fs.readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
ok(/if \(!INSTANT && chain\.keepDao && oc\.dao\)[\s\S]{0,200}chain\.keepDao\(oc\.dao\)[\s\S]{0,120}kind: "gas", clan: oc\.id, role: "DAO"/.test(run), "run.mjs tops each nation's DAO on scheduled turns and logs it as gas for the DAO");
const chain = fs.readFileSync(new URL("./chain.mjs", import.meta.url), "utf8");
ok(/async keepDao\(dao\) \{[\s\S]{0,400}daoTopUp\(spare\)[\s\S]{0,200}op\.transfer\(\{ receiverId: dao/.test(chain), "chain.mjs keepDao sends daoTopUp's amount from the operator");
const sim = fs.readFileSync(new URL("./chain-sim.mjs", import.meta.url), "utf8");
ok(/keepDao: async/.test(sim), "the stand-in chain has keepDao");

console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
