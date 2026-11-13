// "Play with email" (his report 13 Nov: it signed into whatever key the browser held, often a new account, and gave
// no way to log into his email account that holds North Pole). It must always offer Log in and Sign up; a browser
// last used with an email may also offer "Continue as <email>"; it never signs into a leftover key without asking.
// Written before src/live/emailentry.js.   node tests/email-entry.test.mjs
import fs from "node:fs";
import { entryOptions } from "../src/live/emailentry.js";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
const ids = (o) => o.map((x) => x.id).join(",");
ok(ids(entryOptions({ hasLocalKey: false, savedEmail: null })) === "login,signup", "a fresh browser: Log in, then Sign up");
ok(ids(entryOptions({ hasLocalKey: true, savedEmail: null })) === "login,signup,this-browser", "a browser holding a key with no email: Log in and Sign up first; the old key only as a small last choice");
ok(ids(entryOptions({ hasLocalKey: true, savedEmail: "a@b.co" })) === "continue,login,signup", "a browser last used with an email: Continue as it, or log into another, or sign up");
ok(entryOptions({ hasLocalKey: true, savedEmail: "a@b.co" })[0].label.includes("a@b.co"), "Continue names the email");
ok(entryOptions({ hasLocalKey: false, savedEmail: null })[0].label === "Log in with my email", "Log in is the first and plain");
const gods = fs.readFileSync(new URL("../src/live/gods.js", import.meta.url), "utf8");
ok(!/w\.id === "local" && !wallet\.hasLocalKey\?\.\(\)\) \{ b\.disabled = false; return emailForm\(\); \}/.test(gods) && /emailStart\(\)/.test(gods), "the Play with email button always opens the email page, never signs in silently");
