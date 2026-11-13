// PLAN_13NOV §6 (his ask 13 Nov, "15s is fine"): something every ~15 seconds. A citizen says one line about something
// that really happened (a sealed record), in a small strip that fades by itself and never blocks a click. No Claude
// call: the lines are built from the records. Your own nations come first. Written before src/live/chatterlines.js.
//    node tests/chatter.test.mjs
import fs from "node:fs";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const L = await import("../src/live/chatterlines.js");
const name = (id) => ({ 1: "Helios", 2: "North Pole", 3: "Numdial" })[id] ?? `nation ${id}`;

// 1. Lines from real records.
{
  const cases = [
    { kind: "corpus", clan: 1, scholar: "Rafa Ibsen", title: "Sol-gel TiO2 for battery electrodes", cites: 12, fake: 0 },
    { kind: "trade", buyer: 2, seller: 1, about: "p3ht:pcbm", price: 3.4 },
    { kind: "market-sale", buyer: 3, seller: 1, title: "Battery Energy Density", price: 4.5 },
    { kind: "listed", clan: 1, title: "Surface Energy in Battery Electrodes", price: 8.29 },
    { kind: "warden", clan: 1, fake: ["W1"], fine: 1.07 },
    { kind: "needs", clan: 2, mood: "hungry" },
    { kind: "tech", clan: 3, name: "Printing Press" },
    { kind: "heard", clan: 2, citizen: "Dagny Ulloa", says: "The god sees where we stand." },
    { kind: "arrival", name: "Tate", found: true, nation: "Tate's Reach" },
    { kind: "seat-sold", clan: 3, price: 9.7, as: "Saturn" },
  ];
  for (const r of cases) {
    const l = L.lineFor(r, name);
    ok(l && typeof l.who === "string" && l.who.length && typeof l.text === "string" && l.text.length > 8 && l.text.length <= 160 && !/—/.test(l.text), `a ${r.kind} record becomes a line: ${l?.who}: "${l?.text}"`);
  }
  ok(L.lineFor({ kind: "corpus", clan: 1, scholar: "Rafa Ibsen", title: "X", cites: 12 }, name).who === "Rafa Ibsen", "the scholar who did it speaks");
  ok(L.lineFor({ kind: "reverence", clan: 1 }, name) === null && L.lineFor({ kind: "tokens" }, name) === null && L.lineFor({ kind: "error", error: "boom" }, name) === null, "bookkeeping and errors never become chatter");
}

// 2. Picking the next one: unspoken, your nations first, newest first.
{
  const recs = [
    { kind: "corpus", clan: 1, scholar: "A", title: "t1", cites: 3, at: 1 },
    { kind: "corpus", clan: 2, scholar: "B", title: "t2", cites: 3, at: 2 },
    { kind: "corpus", clan: 3, scholar: "C", title: "t3", cites: 3, at: 3 },
    { kind: "tokens", at: 4 },
  ];
  const spoken = new Set();
  const p1 = L.pick(recs, spoken, new Set([2]), name);
  ok(p1?.who === "B", "your own nation's line first");
  spoken.add(p1.key);
  const p2 = L.pick(recs, spoken, new Set([2]), name);
  ok(p2?.who === "C", "then the newest of the rest");
  spoken.add(p2.key); spoken.add(L.pick(recs, spoken, new Set([2]), name).key);
  ok(L.pick(recs, spoken, new Set([2]), name) === null, "nothing left unspoken: silence, never a repeat");
  ok(L.EVERY_MS === 15000, "every 15 seconds");
}

// 3. The wiring.
{
  const live = fs.readFileSync(new URL("../src/live/feed.js", import.meta.url), "utf8"), ch = fs.readFileSync(new URL("../src/live/chatter.js", import.meta.url), "utf8");
  ok(/createChatter/.test(live) && /chatter\?\.add\(r\)/.test(live), "the feed starts the chatter and hands it every record");
  ok(/pointer-events:\s*none|pointerEvents = "none"/.test(ch + fs.readFileSync(new URL("../src/live/live.css", import.meta.url), "utf8")) && /hidden/.test(ch), "the strip never takes a click and fades on its own");
  ok(/busy\(\)/.test(ch), "it waits while a citizen is speaking in the dialogue box");
}
