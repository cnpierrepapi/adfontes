// The fast-forward's simulated gods (his rule 8 Nov): visit at 30+, drift away under 30, rush back
// under 10 and keep coming until the nation is back above 30.
import { nextMode, visits } from "../scripts/sim-gods.mjs";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
ok(nextMode(null, 50) === "faithful" && nextMode(null, 20) === "away" && nextMode(null, 5) === "rescue", "first look: faithful / away / rescue by standing");
ok(visits(nextMode("faithful", 30)), "30 or more: they keep visiting");
ok(nextMode("faithful", 29.9) === "away" && !visits("away"), "under 30: they stop coming");
ok(nextMode("away", 15) === "away", "between 10 and 30: still away");
ok(nextMode("away", 9.9) === "rescue" && visits("rescue"), "under 10: they rush back");
ok(nextMode("rescue", 20) === "rescue", "...and keep coming between 10 and 30 (no flicker at 10)");
ok(nextMode("rescue", 30) === "faithful", "back above 30: faithful again");
ok(nextMode("faithful", 5) === "rescue", "a crash straight under 10 brings them back at once");
ok(nextMode("faithful", 31, 2) === "away" && nextMode("faithful", 31, -2) === "faithful", "each god's own offset: one drifts while another stays");
// The walk he described: 50 -> 25 -> 8 -> 20 -> 32 -> 26
let m = null; const path = [50, 25, 8, 20, 32, 26].map((x) => (m = nextMode(m, x)));
ok(path.join(",") === "faithful,away,rescue,rescue,faithful,away", `decline and comeback: ${path.join(" -> ")}`);
