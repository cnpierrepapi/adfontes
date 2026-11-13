// PLAN_13NOV step 0 (signed choices) and step 1 (the Scholars' pitch), written before the code (13 Nov).
// A god signs a small message with its own key; the server checks the signature, that the key is on the god's
// account, that the account is a god of that nation, the turn and the kind; one choice per kind, nation and
// turn (a new one replaces the old). The engine reads them at the start of a turn and seals each as a record.
// Silence = today's behaviour. Pitch: the 3 pitched are exactly the 3 the dice would draw from this turn; a pick
// replaces the draw; no pick, or a stale one, and the dice decide.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { baseEncode } from "near-api-js";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adf-choice-"));
Object.assign(process.env, { ADF_STATE_DIR: dir, DATABASE_URL: "" });
const CH = await import("./choices.mjs");
const store = await import("./store.mjs");
const W = await import("./world.mjs");

// A god's browser key (as "Play with email" makes one).
const seed = new Uint8Array(32).fill(7), pub = ed25519.getPublicKey(seed);
const publicKey = `ed25519:${baseEncode(pub)}`, account = "olive-codex-852.adf-pool1-hf0w8.testnet", world = "w6.adf-pool1-hf0w8.testnet";
const sign = (m) => Buffer.from(ed25519.sign(new TextEncoder().encode(m), seed)).toString("base64");
const make = (over = {}) => { const c = { world, kind: "pitch", clan: 12, payload: { point: "green chemistry" }, day: 66, nonce: "n1", ...over }; return { ...c, account, publicKey, signature: sign(CH.messageOf(c)) }; };
const env = { world, day: 66, keyOn: async (a, k) => a === account && k === publicKey, godOf: async (clan, a) => clan === 12 && a === account };

// 0. The channel.
const good = await CH.acceptChoice(make(), env);
ok(good.ok === true, `a choice signed by a god of the nation is accepted (${good.error || "ok"})`);
const forged = make(); forged.payload = { point: "something else" };
ok((await CH.acceptChoice(forged, env)).error?.match(/signature/i), "a choice changed after signing is refused (bad signature)");
const otherKey = { ...make(), publicKey: `ed25519:${baseEncode(ed25519.getPublicKey(new Uint8Array(32).fill(9)))}` };
ok((await CH.acceptChoice(otherKey, env)).error, "a signature from another key is refused");
ok((await CH.acceptChoice(make(), { ...env, keyOn: async () => false })).error?.match(/key/i), "a key that isn't on the account is refused");
ok((await CH.acceptChoice(make({ clan: 5 }), env)).error?.match(/god/i), "someone who isn't a god of that nation is refused");
ok((await CH.acceptChoice(make({ day: 60 }), env)).error?.match(/turn/i), "a choice for another turn is refused");
ok((await CH.acceptChoice(make({ kind: "withdraw" }), env)).error?.match(/kind/i), "an unknown kind of choice is refused");
ok((await CH.acceptChoice(make({ payload: { point: "" } }), env)).error, "an empty pitch pick is refused");
await store.putChoice("testnet", good.row);
await store.putChoice("testnet", (await CH.acceptChoice(make({ payload: { point: "co2 capture" }, nonce: "n2" }), env)).row);
const got = await store.choicesFor("testnet", 66);
ok(got.length === 1 && got[0].payload.point === "co2 capture", "a second choice of the same kind, nation and turn replaces the first");
ok(CH.recordOf(got[0]).kind === "choice" && CH.recordOf(got[0]).god === account && CH.recordOf(got[0]).choice === "pitch", "each choice becomes a record for the turn (sealed with it)");
ok((await store.choicesFor("testnet", 67)).length === 0, "no choices = nothing changes (silence is today's behaviour)");

// 1. The Scholars' pitch.
const c = { mbti: "ESFP", frontier: Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k, i) => [k, { depth: 1 + (i % 3) }])) };
const p1 = W.pitchOf(c, "seed-66"), p2 = W.pitchOf(c, "seed-66");
ok(p1.length === 3 && JSON.stringify(p1) === JSON.stringify(p2), `the pitch is 3 points, the same all turn (${p1})`);
ok(p1.includes(W.pickTarget(c, null, "seed-66")), "with no pick, the dice draw from exactly those 3");
ok(W.pickTarget(c, p1[2], "seed-66") === p1[2], "a god's pick from the pitch replaces the draw");
ok(p1.includes(W.pickTarget(c, "zzz-not-there", "seed-66")), "a pick that's no longer on the frontier falls back to the dice");
const deep = { mbti: "INTJ", frontier: c.frontier };
{ const d = W.pitchOf(deep, "s").map((k) => deep.frontier[k].depth); ok(d.join() === "3,3,2", `a deep-thinking nation pitches its deepest points first (depths ${d})`); }
const run = fs.readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
ok(/choicesFor\(net, day\)/.test(run) && /kind: "choice"|CH\.recordOf/.test(run), "run.mjs reads the turn's choices and records them");
ok(/pickTarget\(c, pitchPick/.test(run), "research uses the god's pitch pick when there is one");
fs.rmSync(dir, { recursive: true, force: true });
