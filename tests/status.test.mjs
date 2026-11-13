// A nation's status label (13 Nov, his note: "neglected" showed on most nations although the AI gods tend them
// every day). Neglected now means what it says: no god has acted there for 24 hours. Hunger and Tricksters are
// their own facts. Written before src/live/status.js.   node tests/status.test.mjs
import { statusOf, plateWords, panelWords } from "../src/live/status.js";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const now = Date.UTC(2026, 10, 13, 2), H = 3600e3;
const tended = { alive: true, tricksters: 2, mood: "content", last_act_at: now - 2 * H };
ok(statusOf(tended, now) === "ok", "Tricksters but a god acted 2 hours ago: not neglected");
ok(statusOf({ ...tended, last_act_at: now - 25 * H }, now) === "neglected", "no god action for 25 hours: neglected");
ok(statusOf({ ...tended, mood: "hungry" }, now) === "hungry", "tended but hungry: hungry, not neglected");
ok(statusOf({ ...tended, mood: "sated" }, now) === "rich", "sated: rich");
ok(statusOf({ ...tended, alive: false }, now) === "dead" && statusOf({ ...tended, seen: false }, now) === "new", "dead and new as before");
ok(statusOf({ alive: true, tricksters: 0, mood: "content" }, now) === "ok", "no record of a god's last act: not called neglected");
ok(plateWords(tended, "ok") === "" && plateWords(tended, "neglected") === " · neglected" && plateWords(tended, "hungry") === " · hungry", "the plate's short words");
ok(/a Trickster moved in/.test(panelWords(tended, "ok")) && !/neglected/.test(panelWords(tended, "ok")), "the panel still says a Trickster moved in, without calling it neglected");
ok(/no god has acted/.test(panelWords(tended, "neglected")), "the panel explains what neglected means");
