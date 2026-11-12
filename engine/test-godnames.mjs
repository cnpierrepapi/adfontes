// God names (his calls 12 Nov): every god, human or AI, shows under a generated name taken from the gods of the
// world's cultures; we never say what a god is "god of"; no account id is ever shown in the game.
// Written before engine/godnames.mjs. Exits 1 on any failure.
import { NAMES, nameFor, isAccountLike } from "./godnames.mjs";

const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };

ok(NAMES.length >= 300, `the pool holds at least 300 names (${NAMES.length})`);
ok(new Set(NAMES.map((n) => n.toLowerCase())).size === NAMES.length, "no name appears twice");
ok(NAMES.every((n) => /^[A-Z][A-Za-z'’\- ]{1,22}$/.test(n) && !/\bgod(dess)? of\b/i.test(n)), "every entry is just a name (capitalised, no 'god of', no punctuation tricks)");
ok(NAMES.every((n) => !isAccountLike(n)), "no name looks like an account id");
const cultures = ["Zeus", "Odin", "Ra", "Shiva", "Ogun", "Amaterasu", "Quetzalcoatl", "Pele", "Perun", "Inti", "Brigid", "Ahura Mazda", "Guanyin", "Anansi", "Tengri"];
ok(cultures.every((n) => NAMES.includes(n)), "names come from many cultures (Greek, Norse, Egyptian, Hindu, Yoruba, Shinto, Aztec, Hawaiian, Slavic, Inca, Celtic, Persian, Chinese, Akan, Turkic...)");

// Assignment: one name per account, stable, never shared.
const taken = new Map(); // name -> account
const give = (a) => { const n = nameFor(a, taken); taken.set(n, a); return n; };
const a1 = "olive-codex-852.adf-pool1-hf0w8.testnet", a2 = "29d5d1842a76061cfcedcb867b6cfbe2da1856b6b1af199471178694b161f12d";
const n1 = give(a1), n2 = give(a2);
ok(n1 && n2 && n1 !== n2, `two accounts, two names (${n1}, ${n2})`);
ok(nameFor(a1, new Map()) === n1, "the same account gets the same first-choice name on a fresh start (deterministic)");
ok(!isAccountLike(n1) && !isAccountLike(n2), "a name never looks like the account behind it");
ok(isAccountLike(a1) && isAccountLike(a2) && isAccountLike("russet-tallow-962.adf-pool1-hf0w8.testnet") && isAccountLike("someone.near"), "isAccountLike spots named and 64-hex accounts");
// Fill the pool: everyone still gets a distinct name (numbered once the pool runs out).
const many = Array.from({ length: NAMES.length + 50 }, (_, i) => `g${i}.adf-pool1-hf0w8.testnet`).map(give);
ok(new Set([...many, n1, n2]).size === many.length + 2, `${many.length + 2} accounts, all distinct names, even past the pool's end (e.g. ${many.at(-1)})`);
