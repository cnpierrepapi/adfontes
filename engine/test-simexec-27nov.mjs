// engine/chain-sim.mjs execute (27 Nov): a passed motion on a stand-in chain does what the world contract does.
// Before it, a ruling stayed Pending (its gods then paid the unruled penalty) and a smite stunned nobody.
import { execute } from "./chain-sim.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const motion = (method, args, receiver = "sim.local") => ({ FunctionCall: { receiver_id: receiver, actions: [{ method_name: method, args: b64(args), deposit: "0", gas: "30000000000000" }] } });
const world = () => ({
  config: { day: 40 },
  clans: [{ id: 1, name: "A", dao: "a.sim-dao", whisper: "" }, { id: 2, name: "B", dao: "b.sim-dao", whisper: "" }],
  agents: { 1: [{ name: "Ada", alive: true, stunted_until: 0 }, { name: "Bo", alive: true, stunted_until: 0 }], 2: [{ name: "Cy", alive: true, stunted_until: 0 }] },
  gifts: { 100: { id: 100, clan: 1, status: "Pending" }, 101: { id: 101, clan: 1, status: "Pending" }, 102: { id: 102, clan: 1, status: "Rewarded" } },
});

let S = world();
execute(S, motion("rule", { gift_id: 100, reward: true }));
ok(S.gifts[100].status === "Rewarded" && S.gifts[100].ruled_by === "a.sim-dao", "a reward settles the gift as Rewarded");
execute(S, motion("rule", { gift_id: 101, reward: false, verdict: "Stunt", agent: "Bo" }));
ok(S.gifts[101].status === "Punished" && S.agents[1][1].stunted_until === 43, "a punishment settles it as Punished and stuns the citizen 3 days");
execute(S, motion("rule", { gift_id: 102, reward: false, verdict: "Kill", agent: "Ada" }));
ok(S.gifts[102].status === "Rewarded" && S.agents[1][0].alive, "a gift already settled can't be ruled again");
S = world();
execute(S, motion("rule", { gift_id: 100, reward: false, verdict: "Stunt", agent: "Cy" }));
ok(S.gifts[100].status === "Pending" && S.agents[2][0].stunted_until === 0, "a punishment naming another nation's citizen does nothing");
execute(S, motion("smite", { clan_id: 1, agent: "Ada", verdict: "Stunt" }));
ok(S.agents[1][0].stunted_until === 43, "a smite stuns the citizen 3 days");
execute(S, motion("smite", { clan_id: 1, agent: "Bo", verdict: "Kill" }));
ok(S.agents[1][1].alive === false, "a smite with Kill kills");
execute(S, motion("whisper", { clan_id: 2, text: "build walls" }));
ok(S.clans[1].whisper === "build walls", "a whisper sets the nation's whisper");
S = world();
execute(S, motion("rule", { gift_id: 100, reward: true }, "someone-else.testnet"));
ok(S.gifts[100].status === "Pending", "a motion to another contract does nothing");
execute(S, { Transfer: { amount: "1" } });
ok(S.gifts[100].status === "Pending", "a motion that isn't a function call does nothing");
console.log(fails ? `${fails} FAIL` : "all passed");
process.exit(fails ? 1 : 0);
