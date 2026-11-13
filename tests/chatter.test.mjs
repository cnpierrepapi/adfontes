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
    { kind: "battle", war: "w1", round: 24, sides: { 2: { spend: 1 }, 3: { spend: 2 } } }, // the real shape (13 Nov: "nation undefined")
  ];
  for (const r of cases) {
    const l = L.lineFor(r, name);
    ok(l && typeof l.who === "string" && l.who.length && typeof l.text === "string" && l.text.length > 8 && l.text.length <= 160 && !/—/.test(l.text), `a ${r.kind} record becomes a line: ${l?.who}: "${l?.text}"`);
  }
  ok(L.lineFor({ kind: "corpus", clan: 1, scholar: "Rafa Ibsen", title: "X", cites: 12 }, name).who === "Rafa Ibsen", "the scholar who did it speaks");
  ok(cases.every((r) => !/undefined|null|NaN/.test(L.lineFor(r, name)?.text || "")), "no line ever says undefined, null or NaN");
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

// 3. His call 13 Nov evening: the lines speak through the dialogue box (the citizen's face), not a text strip, and a
//    line about one of your nations asks for you: it carries something to do.
{
  ok(L.lineFor({ kind: "needs", clan: 2, mood: "hungry" }, name).ask?.act === "bless", "a hungry nation asks to be blessed");
  ok(L.lineFor({ kind: "warden", clan: 1, fake: ["W1"], fine: 1 }, name).ask?.act === "whisper" && L.lineFor({ kind: "warden", clan: 1, fake: ["W1"], fine: 1 }, name).ask.text, "a caught fake asks for a whisper, with words ready");
  ok(L.lineFor({ kind: "battle", war: "w", round: 3, sides: { 2: {}, 3: {} } }, name).ask?.act === "whisper", "a war round asks for a whisper");
  ok(L.lineFor({ kind: "corpus", clan: 1, scholar: "A", title: "t", cites: 3 }, name).ask?.act === "whisper", "fresh research asks for a whisper");
  ok(!L.lineFor({ kind: "trade", buyer: 2, seller: 1, about: "x", price: 1 }, name).ask, "a trade needs nothing from you");
  ok(L.AUTO_CLOSE_MS >= 8000 && L.AUTO_CLOSE_MS < L.EVERY_MS, "a line left alone closes by itself before the next one");
}

// 4. The wiring.
{
  const feed = fs.readFileSync(new URL("../src/live/feed.js", import.meta.url), "utf8"), ch = fs.readFileSync(new URL("../src/live/chatter.js", import.meta.url), "utf8"), dlg = fs.readFileSync(new URL("../src/live/dialogue.js", import.meta.url), "utf8");
  ok(/createChatter/.test(feed) && /chatter\?\.add\(r\)/.test(feed), "the feed starts the chatter and hands it every record");
  ok(/say\(/.test(ch) && !/className = "chatter"/.test(ch), "the chatter speaks through the dialogue box, not its own strip");
  ok(/d\.actions/.test(dlg) && /d\.auto/.test(dlg) && /stopPropagation/.test(dlg), "the dialogue box shows buttons (a click on one doesn't skip the line) and can close by itself");
  ok(/busy\(\)/.test(ch), "it waits while a citizen is already speaking");
}
