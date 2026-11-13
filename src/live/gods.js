// The god panel (SPEC §12j). A wallet chip in the HUD, "Your powers" in each nation's panel, and a
// confirm card that shows the exact transaction before your wallet ever opens. Every deposit is read
// live from the chain (get_config, the DAO's policy), never hard-coded.
import { createWallet, toYocto, near, failure, TGAS } from "./wallet.js";
import * as C from "./calls.js";
import { api } from "../net.js";
import { godName, isAi } from "../says.js";
import { entryOptions } from "./emailentry.js";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
const short = (a) => (a.length > 22 ? `${a.slice(0, 10)}…${a.slice(-9)}` : a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Power tile icons: simple line drawings, inherit the tile's colour.
const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  bless: svg('<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/><circle cx="12" cy="12" r="2.5"/>'),
  seat: svg('<path d="M6 21V11a6 6 0 0 1 12 0v10M4 21h16M9 15h6"/>'),
  whisper: svg('<path d="M4 6h16v10H9l-5 4z"/><path d="M8 10h8M8 13h5"/>'),
  fire: svg('<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 2-5 5-5 8 0 4 3 7 7 7z"/>'),
  smite: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  root: svg('<path d="M12 3v8M12 11c-4 0-6 3-6 6M12 11c4 0 6 3 6 6M12 11v10M4 21h16"/><path d="M8 3l8 8M16 3l-8 8"/>'),
  staking: svg('<path d="M4 17h16M6 13h12M8 9h8M10 5h4"/>'),
  claim: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
};
// Florins (SPEC §14): 1 florin = 10^22 units on chain.
const fl = (u) => (Number(BigInt(u || 0) / 10n ** 16n) / 1e6).toFixed(1);
// What a god put in, in plain words (SPEC §14). The contract keeps only what counts toward the
// stake; a nation's founder also paid the founding costs (the DAO deposit and the staking fund,
// from the world's config), so they see the whole amount and where it went. The founder is the
// first god in the list (a founder who left hands that place on, so this is the usual case).
function putInWords(clan, me, cfg, st) {
  const put = BigInt(st.put_in), given = BigInt(st.granted || 0), counts = put + given;
  const pct = counts ? Math.round((Number(BigInt(st.near)) / Number(counts)) * 100) : 0;
  const founder = clan.gods[0]?.account === me.account && cfg;
  if (founder && given) {
    const costs = BigInt(cfg.dao_deposit) + BigInt(cfg.staking_deposit), paid = put + costs;
    return {
      short: `founded with ${near(paid)} grace, the world gave back ${near(given)} of the founding costs, so your stake counts ${near(counts)} grace (${pct}% of it today)`,
      long: `You founded ${clan.name} with about ${near(paid)} grace. ${near(costs)} of that set up the nation's council and its savings, and the world gave ${near(given)} back to you as florins. So your stake counts ${near(counts)} grace, and today it's worth ${pct}% of that.`,
    };
  }
  if (given) return { short: `${pct}% of the ${near(counts)} grace your stake counts (${near(put)} you put in, ${near(given)} from the world)`, long: `Your stake counts ${near(counts)} grace: ${near(put)} you put in and ${near(given)} the world gave you. Today it's worth ${pct}% of that.` };
  if (founder) return { short: `${pct}% of the ${near(put)} grace in your stake (founding costs aside)`, long: `After founding costs, ${near(put)} grace of what you paid went into your stake, and today it's worth ${pct}% of that.` };
  return { short: `${pct}% of the ${near(put)} grace you put in`, long: `You put in ${near(put)} grace, so that's ${pct}% of it.` };
}

export async function createGods({ live, W, nav, toast, route, replayIntro }) {
  const WORLD = W.world;
  const wallet = await createWallet(W.net);
  let account = wallet.account();
  // Your god name (12 Nov): the world names every god; until it has seen you, you're "a new god".
  const myName = () => { const n = godName(account); return n === "a god" ? "a new god" : n; };
  let refreshPanel = () => {};

  // ---------------------------------------------------------------- the HUD chip
  const chip = el("button", { className: "chip wallet", type: "button" });
  nav.prepend(chip, " ");
  const menu = el("div", { className: "walletmenu", hidden: true });
  document.getElementById("visor").append(menu);
  // The chip shows your email when you signed up with one (the account stays underneath).
  const showChip = () => { const shown = account ? (wallet.email?.() || myName()) : null; chip.replaceChildren("◈ ", el("span", { className: "word", textContent: shown ? short(shown) : "Become a god" })); chip.classList.toggle("god", !!account); };
  showChip();
  wallet.onAccount((a) => { account = a; showChip(); refreshPanel(); if (!menu.hidden) openMenu(); });
  chip.addEventListener("click", () => (menu.hidden ? openMenu() : (menu.hidden = true)));
  document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target) && !chip.contains(e.target)) menu.hidden = true; });

  async function openMenu() {
    menu.replaceChildren();
    menu.hidden = false;
    if (!account) {
      menu.append(el("p", { className: "lead", textContent: "Become a god. Bless nations, whisper to their people, call down fire." }));
      let others = false;
      for (const w of await wallet.wallets()) {
        // Email first and big (his call 11 Nov: it should feel like a game); NEAR wallets under it, smaller.
        if (w.id !== "local" && !others) { others = true; menu.append(el("p", { className: "fine others", textContent: "Or sign in with Meteor" })); }
        const b = el("button", { type: "button", className: `walletpick${w.id === "local" ? " primary" : " small"}` }, w.icon ? el("img", { src: w.icon, alt: "", width: w.id === "local" ? 28 : 18, height: w.id === "local" ? 28 : 18 }) : null, el("span", {}, w.name, w.id === "local" ? el("small", { textContent: w.note }) : ""));
        b.addEventListener("click", async () => {
          b.disabled = true;
          // Play with email (13 Nov): always the email page (log in or sign up), never a silent sign-in to a leftover key.
          if (w.id === "local") { b.disabled = false; return emailStart(); }
          try { await wallet.signIn(w.id); menu.hidden = true; if (w.id === "local") { showChip(); quickStart(); } } catch (e) { toast(`${w.name}: ${e.message || "could not connect"}`); }
          b.disabled = false;
        });
        menu.append(b);
      }
      if (W.net !== "mainnet") menu.append(el("p", { className: "fine", textContent: "This season is a practice world: grace here is free." }));
      return;
    }
    menu.append(el("p", { className: "lead" }, "You are ", el("b", { textContent: myName() })), wallet.email?.() ? el("p", { className: "fine", textContent: `Signed in as ${wallet.email()}` }) : "");
    // Your route as a god (SPEC §12n): what you've done, and what to try next.
    if (route) {
      const steps = route.progress(), nextStep = steps.find((x) => !x.done);
      const box = el("div", { className: "route" }, el("p", { className: "fine", textContent: `Your route: ${steps.filter((x) => x.done).length} of ${steps.length}` }));
      for (const x of steps) box.append(el("p", { className: x.done ? "done" : x === nextStep ? "next" : "", textContent: x === nextStep ? `Next: ${x.hint}` : x.title }));
      menu.append(box);
    }
    const [clans, owed] = await Promise.all([wallet.view(WORLD, "list_clans", { limit: 100 }).catch(() => []), wallet.view(WORLD, "get_owed", { account_id: account }).catch(() => "0")]);
    const mine = clans.filter((c) => c.alive && c.gods.some((g) => g.account === account));
    menu.append(el("p", { className: "fine", textContent: mine.length ? "You are a god of:" : "You are not a god of any nation yet. Bless one, or found your own." }));
    // Your stakes: each nation's rank in the season, your reverence there, and your stake: your
    // florins there and what claiming them pays today (SPEC §14), read from the contract.
    const ranked = (live.world.clans || []).filter((k) => k.alive !== false).sort((x, y) => (y.reverence?.standing ?? 0) - (x.reverence?.standing ?? 0));
    for (const c of mine) {
      const me = c.gods.find((g) => g.account === account);
      const st = await wallet.view(WORLD, "get_stake", { clan_id: c.id, account }).catch(() => null);
      const w = live.world.clans.find((k) => k.id === c.id);
      const rank = ranked.findIndex((k) => k.id === c.id) + 1;
      const myRev = w?.reverence?.gods?.[account]?.r;
      const b = el("button", { type: "button", className: "walletpick stake" }, el("span", { textContent: c.name }),
        el("small", { textContent: `${rank ? `#${rank} of ${ranked.length}` : ""}${myRev != null ? ` · your reverence ${myRev}` : ""} · your stake ${st ? `${fl(st.florins)} florins, ${near(st.near)} grace` : "?"}` }));
      b.addEventListener("click", () => { menu.hidden = true; live.flyTo(c.id); });
      menu.append(b);
    }
    const row = el("div", { className: "row" });
    const found = el("button", { type: "button", className: "viewbtn gold", textContent: "Found a nation" });
    found.addEventListener("click", () => { menu.hidden = true; foundCard(); });
    row.append(found);
    // The any-crypto top-up (NEAR Intents, src/live/intents.js) isn't offered: the game reads web2 (12 Nov).
    if (BigInt(owed || 0) > 0n) {
      const claim = el("button", { type: "button", className: "viewbtn", textContent: `Claim ${near(owed)} grace owed` });
      claim.addEventListener("click", () => { menu.hidden = true; claimOwedCard(owed); });
      row.append(claim);
    }
    if (replayIntro) { const intro = el("button", { type: "button", className: "viewbtn", textContent: "Watch the intro" }); intro.addEventListener("click", () => { menu.hidden = true; replayIntro(); }); row.append(intro); }
    const out = el("button", { type: "button", className: "viewbtn", textContent: "Leave" });
    out.addEventListener("click", async () => { await wallet.signOut(); menu.hidden = true; });
    row.append(out);
    menu.append(row);
    // Playing without a wallet: the key lives in this browser only. Save it, or lose the account
    // with the browser's storage.
    if (wallet.isLocal?.()) {
      const save = el("button", { type: "button", className: "viewbtn", textContent: "Back up your account" });
      save.addEventListener("click", saveKey);
      if (wallet.email?.()) {
        const forget = el("button", { type: "button", className: "viewbtn", textContent: "Forget my email" });
        forget.addEventListener("click", () => forgetForm());
        menu.append(el("p", { className: "fine", textContent: "Your account is saved to your email, locked with your passphrase. Log in on any browser. We never see either." }), el("div", { className: "row" }, save, forget));
      } else {
        const keep = el("button", { type: "button", className: "viewbtn gold", textContent: "Save it to an email" });
        keep.addEventListener("click", () => emailForm("signup"));
        menu.append(el("p", { className: "fine", textContent: "Your account lives only in this browser. Save it to an email so you can come back from anywhere." }), el("div", { className: "row" }, keep, save));
      }
    }
  }

  // The email page (13 Nov, src/live/emailentry.js): Log in, Sign up, and Continue for the email this browser last used.
  function emailStart() {
    menu.replaceChildren();
    menu.hidden = false;
    menu.append(el("p", { className: "lead", textContent: "Play with email" }));
    for (const o of entryOptions({ hasLocalKey: !!wallet.hasLocalKey?.(), savedEmail: wallet.savedEmail?.() || null })) {
      const b = el("button", { type: "button", className: o.id === "this-browser" ? "linkish" : `walletpick${o.id === "signup" ? " small" : " primary"}` }, el("span", { textContent: o.label }));
      b.addEventListener("click", async () => {
        if (o.id === "login") return emailForm("login");
        if (o.id === "signup") return emailForm("signup");
        try { await wallet.signIn("local"); menu.hidden = true; showChip(); quickStart(); } catch (e) { toast(e.message || "That didn't work. Try again."); }
      });
      menu.append(b);
    }
  }
  // Sign up or log in with an email (11 Nov). The passphrase stays in this browser: it locks the key
  // here before anything is sent (src/live/wallet.js signUpEmail / logInEmail).
  function emailForm(mode = "signup") {
    menu.replaceChildren();
    menu.hidden = false;
    const email = el("input", { className: "txin", type: "email", autocomplete: "email", placeholder: "you@example.com" });
    const pass = el("input", { className: "txin", type: "password", autocomplete: mode === "signup" ? "new-password" : "current-password", placeholder: "a passphrase, 10 characters or more" });
    const again = mode === "signup" ? el("input", { className: "txin", type: "password", autocomplete: "new-password", placeholder: "the passphrase again" }) : null;
    const go = el("button", { type: "button", className: "viewbtn gold", textContent: mode === "signup" ? "Sign up" : "Log in" });
    const swap = el("button", { type: "button", className: "linkish", textContent: mode === "signup" ? "I already signed up: log in" : "New here: sign up", onclick: () => emailForm(mode === "signup" ? "login" : "signup") });
    const msg = el("p", { className: "fine" });
    go.addEventListener("click", async () => {
      msg.textContent = "";
      if (again && again.value !== pass.value) { msg.textContent = "The two passphrases don't match."; return; }
      go.disabled = true; go.textContent = mode === "signup" ? "Making your account…" : "Opening your account…";
      try {
        if (mode === "signup") await wallet.signUpEmail(email.value, pass.value); else await wallet.logInEmail(email.value, pass.value);
        menu.hidden = true; showChip();
        toast(mode === "signup" ? `Signed up as ${wallet.email?.() || myName()}.` : `Welcome back, ${wallet.email?.() || myName()}.`);
        quickStart();
      } catch (e) { msg.textContent = e.message || "That didn't work. Try again."; go.disabled = false; go.textContent = mode === "signup" ? "Sign up" : "Log in"; }
    });
    menu.append(
      el("p", { className: "lead", textContent: mode === "signup" ? "Become a god" : "Welcome back" }),
      el("p", { className: "fine", textContent: mode === "signup" ? "Free to play. Your email is your name here. Your passphrase locks your account in this browser before it's saved, so we can't open it, and can't reset it if you forget." : "Your account comes back to this browser and opens with your passphrase." }),
      el("label", { className: "fine" }, "Email", email), el("label", { className: "fine" }, "Passphrase", pass), again ? el("label", { className: "fine" }, "Again", again) : "",
      el("div", { className: "row" }, go), msg, swap,
      mode === "signup" ? el("p", { className: "fine", textContent: "We keep a scrambled form of your email (never the email itself) and your locked key, only so you can log in. Forget my email deletes both." }) : "");
    email.focus();
  }
  function forgetForm() {
    menu.replaceChildren();
    const pass = el("input", { className: "txin", type: "password", autocomplete: "current-password", placeholder: "your passphrase" });
    const go = el("button", { type: "button", className: "viewbtn", textContent: "Delete it" });
    const msg = el("p", { className: "fine" });
    go.addEventListener("click", async () => {
      go.disabled = true;
      try { await wallet.forgetEmail(pass.value); menu.hidden = true; showChip(); toast("Done. Your email and locked key are gone from our side. The key is still in this browser: save it as a file if you want to keep it."); }
      catch (e) { msg.textContent = e.message; go.disabled = false; }
    });
    menu.append(el("p", { className: "lead", textContent: "Forget my email" }), el("p", { className: "fine", textContent: "We delete your scrambled email and locked key. You stay signed in here, but you can't log in with the email anywhere else." }), el("label", { className: "fine" }, "Passphrase", pass), el("div", { className: "row" }, go), msg);
    pass.focus();
  }

  // The browser key as a file (only when playing without a wallet).
  function saveKey() {
    const k = wallet.exportKey();
    if (!k) return;
    const blob = new Blob([JSON.stringify(k, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `adfontes-${k.account.slice(0, 8)}.json` });
    a.click(); URL.revokeObjectURL(a.href);
    toast("Backup saved. Anyone with this file can play as you, so keep it private.");
  }

  // ---------------------------------------------------------------- the confirm card
  // spec: { title, words: () => string, fields: [...inputs], calls: () => [{receiver, method, args, deposit, gas, note?}],
  //         check: () => error string | null, after: async (outcomes) => message }
  let cardOpen = null;
  function card(spec) {
    cardOpen?.remove();
    const box = el("div", { className: "txcard", role: "dialog" });
    const shade = el("div", { className: "txshade" }, box);
    cardOpen = shade;
    const close = () => { shade.remove(); if (cardOpen === shade) cardOpen = null; };
    shade.addEventListener("pointerdown", (e) => { if (e.target === shade) close(); });
    const words = el("p", { className: "words" });
    const err = el("p", { className: "err" });
    const sign = el("button", { type: "button", className: "viewbtn gold", textContent: wallet.isLocal?.() ? "Do it" : "Approve in Meteor" });
    const cancel = el("button", { type: "button", className: "viewbtn", textContent: "Cancel" });
    cancel.addEventListener("click", close);
    const fields = el("div", { className: "fields" }, ...(spec.fields || []));
    box.append(el("h3", { textContent: spec.title }), words, fields, err, el("div", { className: "row" }, sign, cancel));
    let calls = [];
    function redraw() {
      words.textContent = spec.words();
      const bad = spec.check?.() ?? null;
      err.textContent = bad ?? "";
      sign.disabled = !!bad || !account;
      if (bad) return;
      // His call 10 Nov: no contract, method, arguments or gas on the card. The words above say
      // what happens; the wallet itself shows the details to anyone who wants them.
      try { calls = spec.calls(); } catch (e) { err.textContent = e.message; sign.disabled = true; return; }
    }
    for (const f of spec.fields || []) f.addEventListener("input", redraw);
    sign.addEventListener("click", async () => {
      sign.disabled = cancel.disabled = true;
      err.textContent = "";
      sign.textContent = wallet.isLocal?.() ? (spec.working ?? "Sending…") : "Approve it in Meteor…";
      try {
        await spec.before?.(); // a last look at the chain before anything is signed
        spec.start?.(); // what can begin as soon as it's signed (a founding watches for its island)
        const sent = wallet.send(calls);
        // Plain words while NEAR works (a founding builds the nation's DAO and takes a little while).
        if (spec.working && !wallet.isLocal?.()) setTimeout(() => { if (sign.isConnected && sign.textContent !== "Done") sign.textContent = spec.working; }, 15000);
        // spec.settled() can finish first: the chain already shows the result, so nobody waits on a slow wallet.
        const got = spec.settled ? await Promise.race([sent, spec.settled()]) : await sent;
        const outs = Array.isArray(got) ? got : [];
        const bad = outs.map(failure).find(Boolean);
        if (bad) throw new Error(`The world refused it: ${bad}`);
        const hash = outs.map((o) => o?.transaction?.hash).find(Boolean);
        sign.textContent = "Done";
        const msg = (await spec.after?.(outs)) ?? "Done.";
        if (spec.closeAfter) { close(); refreshPanel(); return; } // something else carries on from here (a founding's birth panel)
        box.replaceChildren(el("h3", { textContent: spec.title }), el("p", { className: "words", textContent: msg }),
          hash ? el("p", { className: "fine" }, el("a", { href: `${wallet.explorer}/txns/${hash}`, target: "_blank", rel: "noopener", textContent: "Public record ↗" })) : null,
          el("div", { className: "row" }, Object.assign(el("button", { type: "button", className: "viewbtn", textContent: "Close" }), { onclick: close })));
        refreshPanel();
      } catch (e) {
        if (e.partial?.length) { // the proposal went in, the vote didn't
          box.replaceChildren(el("h3", { textContent: spec.title }), el("p", { className: "words", textContent: "Your motion is in, but your yes vote wasn't sent. Vote on it under Open motions in the nation's panel." }),
            el("div", { className: "row" }, Object.assign(el("button", { type: "button", className: "viewbtn", textContent: "Close" }), { onclick: close })));
          refreshPanel();
          return;
        }
        err.textContent = /reject|cancel|closed|denied/i.test(e.message || "") ? "You cancelled in Meteor. Nothing was sent." : e.message || "Something went wrong. Nothing was charged unless Meteor says so.";
        sign.textContent = wallet.isLocal?.() ? "Do it" : "Approve in Meteor";
        sign.disabled = cancel.disabled = false;
      }
    });
    document.body.append(shade);
    redraw();
    return { redraw, close };
  }
  const input = (props) => el("input", { className: "txin", ...props });
  const label = (text, ctl) => el("label", { className: "txlabel" }, el("span", { textContent: text }), ctl);

  // A DAO power is one proposal (with the DAO's bond) plus your approving vote, signed together
  // in one wallet approval (prepDao below builds both calls).
  async function daoResult(clan, id) {
    await sleep(1500);
    const p = await wallet.view(clan.dao, "get_proposal", { id }).catch(() => null);
    if (p?.status === "Approved") return { passed: true };
    const policy = await wallet.view(clan.dao, "get_policy");
    const n = policy.roles.find((r) => r.name === "gods")?.kind?.Group?.length ?? 1;
    const yes = Object.values(p?.votes || {}).filter((v) => v === "Approve").length;
    return { passed: false, left: Math.max(1, C.needed(n, yes)) };
  }
  const waiting = (left) => `Your motion is open. It needs ${left} more yes vote${left === 1 ? "" : "s"} from this nation's other gods, who see it in this panel. It runs as soon as it passes.`;

  // Play without a wallet, the quick way (his call 8 Nov): the browser key is made, the sponsor pool
  // funds it (once per account), and the found card opens ready. The player names the nation and
  // presses Found; the browser key signs, so there's no wallet popup. Someone who already has a
  // nation just lands in the world.
  async function quickStart() {
    if (W.net !== "testnet") return;
    const clans = await wallet.view(WORLD, "list_clans", { limit: 100 }).catch(() => []);
    if (clans.some((c) => c.alive && c.gods.some((g) => g.account === account))) return;
    // A named account from the pool (9 Nov) arrives already funded: straight to naming the nation.
    const sent = wallet.takeSponsored?.();
    if (sent) { toast(`You have ${sent} grace to start. Now name your nation.`); setTimeout(foundCard, 2500); return; }
    toast("You're in. Fetching your starting grace…");
    const r = await fetch("/api/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the world." }));
    if (r.ok) toast(`${r.sent} grace is yours. Now name your nation.`);
    else if (r.error) toast(r.error);
    setTimeout(foundCard, r.ok ? 2500 : 300); // the new account needs a moment to show its balance
  }

  // ---------------------------------------------------------------- the powers
  function foundCard() {
    Promise.all([wallet.view(WORLD, "get_config"), wallet.balance(account).catch(() => null), W.net === "testnet" ? api("sponsor").catch(() => null) : null, wallet.view(WORLD, "get_founding").catch(() => null)]).then(([cfg, bal, sp, fund]) => {
      // The world's founding fund (9 Nov): while it pays the DAO and staking, a founder needs only
      // its smaller minimum, and all of it becomes florins. A world without the fund keeps min_found.
      if (fund?.[1]) cfg = { ...cfg, min_found: fund[1] };
      const fundPays = !!(fund && BigInt(fund[0]) > 0n && BigInt(fund[1]) < 2n * 10n ** 24n);
      // A brand-new browser-key account isn't on chain until NEAR reaches it: it has 0, not "?".
      if (bal == null && /^[0-9a-f]{64}$/.test(account || "")) bal = 0n;
      const name = input({ placeholder: "Name your nation", maxLength: 40 });
      // Testnet: put in everything you have (less 0.15 for gas). With the founding fund paying the DAO,
      // all of it becomes florins: a sponsored player's 8.3 makes about 7 NEAR of florins.
      const most = bal != null ? bal - 15n * 10n ** 22n : 0n;
      const amt = input({ value: near(W.net === "testnet" && most > BigInt(cfg.min_found) ? most : cfg.min_found), inputMode: "decimal" });
      // Founding pays Sputnik for the nation's DAO, so it can't be cheap. Mainnet: real NEAR. Testnet:
      // the sponsor pool tops a founder up once (SPEC §12m C); when the pool is spent, new testnet
      // nations are full and the way in is blessing a nation.
      const need = BigInt(cfg.min_found) + 10n ** 23n; // plus about 0.1 NEAR for gas and the account's own reserve
      const short = bal != null && bal < need;
      const help = el("div", { className: "fields" });
      const line = (t, warn) => el("p", { className: `fine${warn ? " warn" : ""}`, textContent: t });
      help.append(line(`You have ${bal == null ? "?" : near(bal)} grace; founding takes at least ${near(cfg.min_found)} plus a little for fees.`, short));
      if (W.net === "testnet" && sp?.available) {
        const left = sp.nations_left;
        const refill = sp.next_refill_ms ? Math.max(1, Math.round((sp.next_refill_ms - Date.now()) / 3600e3)) : null;
        if (short && left > 0) {
          const b = el("button", { type: "button", className: "viewbtn gold", textContent: `Get free grace to found (${left} new nation${left === 1 ? "" : "s"} left)` });
          b.addEventListener("click", async () => {
            b.disabled = true; b.textContent = "Sending…";
            const r = await fetch("/api/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the world. Try again." }));
            if (r.ok) { toast(`${r.sent} grace is yours. Now name your nation.`); cardOpen?.remove(); setTimeout(foundCard, 1500); }
            else { b.textContent = r.error; }
          });
          help.append(line("The world gives every new founder enough grace to start, once, while its pool lasts."), b);
        } else if (short) {
          help.append(line(`New nations are full for now${refill ? ` (the pool refills in about ${refill} hour${refill === 1 ? "" : "s"})` : ""}. Bless a nation to become one of its gods.`, true));
          const b = el("button", { type: "button", className: "viewbtn gold", textContent: "Bless a nation instead" });
          b.addEventListener("click", () => { cardOpen?.remove(); live.home(); toast("Tap a nation, then press Bless this nation in its panel."); });
          help.append(b);
        } else help.append(line(`${left} free new nation${left === 1 ? "" : "s"} left this round.`));
      }
      card({
        title: "Found a nation",
        fields: [help, label("Name", name), label("Grace to put in", amt)],
        words: () => fundPays
          ? `You found "${name.value.trim() || "…"}" and become its first god. The world pays to set up its council, so everything you put in is the nation's money: 86% for its citizens to spend, 14% to the season jackpot.`
          : `You found "${name.value.trim() || "…"}" and become its first god. ${near(cfg.dao_deposit)} grace sets up its council, ${near(cfg.staking_deposit)} grace goes to its savings and a little pays for upkeep. The rest is the nation's money: 86% for its citizens to spend, 14% to the season jackpot.`,
        working: "Founding… your nation is rising. About 20 seconds.",
        start: () => { const want = name.value.trim(); live.refresh?.(want); route?.founded(want); birthPanel(want); },
        closeAfter: true, // the birth panel takes over once it's signed
        // Done as soon as the world lists the nation with you as its god, whatever the wallet is doing.
        settled: () => new Promise((res) => {
          const want = name.value.trim(), t0 = Date.now();
          const look = async () => {
            const cs = await wallet.view(WORLD, "list_clans", { limit: 200 }).catch(() => []);
            if (cs.some((c) => c.name === want && c.gods?.some((g) => g.account === account))) return res(true);
            if (Date.now() - t0 < 120e3) setTimeout(look, 4000);
          };
          setTimeout(look, 4000);
        }),
        check: () => {
          if (cfg.paused) return "The world is paused for new money right now.";
          if (!name.value.trim()) return "Give it a name.";
          try {
            if (toYocto(amt.value) < BigInt(cfg.min_found)) return `The minimum to found a nation is ${near(cfg.min_found)} grace.`;
            if (bal != null && toYocto(amt.value) + 10n ** 23n > bal) return `You can put in at most ${near(bal - 10n ** 23n)} grace (you have ${near(bal)}; 0.1 stays back for fees).`;
          } catch (e) { return e.message; }
          return null;
        },
        calls: () => [C.found(WORLD, name.value.trim(), toYocto(amt.value))],
        after: async () => {
          const want = name.value.trim(); // the island watch began when you signed (start, above)
          return `${want} is founded. Watch its island rise. Its first citizens arrive within seconds.`;
        },
      });
    });
  }
  function claimOwedCard(owed) {
    card({
      title: "Claim what you're owed",
      words: () => `An earlier payout of ${near(owed)} grace to you couldn't be sent. This sends it now.`,
      calls: () => [C.claimOwed(WORLD)],
      after: async () => `${near(owed)} grace is on its way to you.`,
    });
  }

  // "Your powers" for one nation, built into the panel. Re-drawn when the account changes or a
  // transaction lands.
  function section(c, status) {
    const box = el("section", { className: "powers" });
    let token = 0;
    // Reverence and reports (SPEC §12m): everyone sees them; a god can answer a report.
    const rev = el("div", { className: "reverence" });
    async function drawReverence(me, seated, clan) {
      // Fresh (10 Nov): the 20-second cache could show a newborn nation's reverence before it existed.
      const info = await api(`clan?id=${c.id}&fresh=1`).catch(() => null);
      rev.replaceChildren();
      const R = info?.reverence;
      if (!R) return;
      rev.append(el("h4", { textContent: "Reverence" }));
      const who = (a) => (a === account ? "you" : godName(a));
      if (R.waiting) rev.append(el("p", { className: "fine warn", textContent: "Its citizens are waiting in the plaza for their god's first whisper. Nothing gets researched until then." }));
      else if (R.followed) rev.append(el("p", { className: "fine" }, `Its citizens follow ${who(R.followed)}${R.claimed_by && R.gods?.[R.claimed_by]?.outsider ? " (an outside god who claimed this nation after it turned on its own)" : ""}. Standing: `, el("b", { textContent: String(R.standing) }), " of 100."));
      else rev.append(el("p", { className: "fine warn", textContent: "Its citizens follow no god right now." }));
      const list = el("div", { className: "revlist" });
      for (const [a, g] of Object.entries(R.gods).sort((x, y) => y[1].r - x[1].r)) {
        const bar = el("i", {}); bar.style.width = `${g.r}%`;
        list.append(el("div", { className: `revrow${a === account ? " me" : ""}` }, el("span", {}, who(a), ...(isAi(a) ? [" ", el("i", { className: "aitag", textContent: "AI", title: "An AI god: Claude decides what it does" })] : []), g.outsider ? " (outside god)" : ""), el("span", { className: "bar" }, bar), el("b", { textContent: String(g.r) }), g.enemies ? el("small", { textContent: `${g.enemies} enem${g.enemies === 1 ? "y" : "ies"}` }) : null));
      }
      rev.append(list);
      const mine = R.gods[account];
      if (mine && mine.r < 30) rev.append(el("p", { className: "fine warn", textContent: mine.r === 0 ? "This nation has turned on you. Your whispers are ignored." : "Your reverence is low: the citizens ignore your whispers and go their own way. Whisper, rule well and let the nation do well to win them back." }));
      // Ask the accused first (PLAN_13NOV step 2): Ask -> their answer -> Stunt, or let it lapse.
      const open = (info.reports || []).filter((x) => !x.settled);
      const choiceDay = open.length && me && seated ? (await api("next").catch(() => null))?.choice_day : null;
      for (const r of open) {
        const row = el("div", { className: "gift report" }, el("span", { textContent: `Report, turn ${r.day}: ${r.claim}. Lapses on turn ${r.lapses_day}.` }));
        if (r.answer) row.append(el("p", { className: "fine answer" }, r.answer.silent ? `${r.accused} can't answer: they're stunted or gone.` : `${r.accused} answers: `, r.answer.silent ? "" : el("i", { textContent: r.answer.says })));
        else if (r.asked) row.append(el("p", { className: "fine" }, `You asked ${r.accused}. Their answer is on its way.`));
        if (me && seated) {
          if (r.answer) {
            const b = el("button", { type: "button", className: "viewbtn", textContent: `Stunt ${r.accused}` });
            b.addEventListener("click", () => smiteCard(clan, r.accused));
            row.append(b, el("small", { textContent: "or do nothing and let it lapse. A guilty one may lie. Stunt the guilty and the nation sees justice; stunt the innocent and you make an enemy; ignore a true report and the accuser loses faith." }));
          } else if (!r.asked && choiceDay) {
            const b = el("button", { type: "button", className: "viewbtn", textContent: `Ask ${r.accused}` });
            b.addEventListener("click", () => { b.disabled = true; choose("ask", c.id, { report: r.id }, choiceDay).then((done) => { if (!done) b.disabled = false; }); });
            row.append(b, el("small", { textContent: "Hear them out first: they answer in their own words, then you decide. Or let it lapse." }));
          }
        }
        rev.append(row);
      }
      for (const r of (info.reports || []).filter((x) => x.settled).slice(0, 2))
        rev.append(el("p", { className: "fine" }, `Settled: ${r.claim}. `, el("b", { textContent: r.truth ? "It was true" : "It was a grudge" }), r.outcome === "stunted" ? `, and ${r.accused} was stunted.` : ", and nobody acted."));
    }
    async function draw() {
      const my = ++token;
      box.replaceChildren(el("h4", { textContent: "Gods" }));
      // Fallen in war (his pick 8 Nov): the winner took half its florins; its gods can still claim the rest.
      if (c.fallen) {
        const by = live.world.clans.find((k) => k.id === c.fallen.by)?.name ?? "a rival";
        box.append(el("p", { className: "fine", textContent: `Fallen. ${by} brought this island down in war and took half its florins, its knowledge and two of its people. Its gods can still take out what's left.` }));
        if (!account) return;
        const clan = await wallet.view(WORLD, "get_clan", { clan_id: c.id }).catch(() => null);
        const me = clan?.gods.find((g) => g.account === account);
        if (my === token && me) {
          const b = el("button", { type: "button", className: "powertile claim" });
          b.innerHTML = `<span class="pi">${ICONS.claim}</span><span class="pt"><b>Claim what's left</b><small>Take your share of its florins out as grace.</small></span>`;
          b.addEventListener("click", () => withdrawCard(clan, me));
          box.append(el("div", { className: "powertiles" }, b));
        }
        return;
      }
      if (status === "dead" || c.alive === false) { box.append(el("p", { className: "fine", textContent: "Ruins. Its last god left, so there is nothing left to command." })); return; }
      if (!account) {
        box.append(rev);
        drawReverence(false, false, null).catch(() => {});
        const b = el("button", { type: "button", className: "viewbtn gold", textContent: "Become a god" });
        b.addEventListener("click", openMenu);
        box.append(el("p", { className: "fine", textContent: "Anyone can bless this nation with grace and become one of its gods." }), b);
        return;
      }
      box.append(el("p", { className: "fine", textContent: "Reading the world…" }));
      const [clan, policy, cfg] = await Promise.all([wallet.view(WORLD, "get_clan", { clan_id: c.id }), wallet.view(c.dao, "get_policy").catch(() => null), wallet.view(WORLD, "get_config")]);
      if (my !== token || !clan) return;
      const me = clan.gods.find((g) => g.account === account);
      const seats = policy?.roles.find((r) => r.name === "gods")?.kind?.Group ?? [];
      box.replaceChildren(el("h4", { textContent: me ? "Your powers" : "Gods" }));
      drawReverence(!!me, seats.includes(account), clan).catch(() => {});
      box.append(el("p", { className: "fine", textContent: me ? `You are one of ${clan.gods.length} god${clan.gods.length === 1 ? "" : "s"} here, with ${near(me.put_in)} grace put in.` : `${clan.gods.length} god${clan.gods.length === 1 ? "" : "s"} watch over ${clan.name}.` }));
      // Your stake, big and clear (SPEC §14): your florins here and what claiming pays today.
      if (me) {
        const stakeBox = el("div", { className: "stakebox" }, el("small", { textContent: "Your stake" }), el("b", { textContent: "…" }));
        box.append(stakeBox);
        wallet.view(WORLD, "get_stake", { clan_id: clan.id, account }).then((st) => {
          if (my !== token) return;
          // Put in = what bought florins plus what the world granted back (9 Nov, the founders' DAO cost).
          const put = Number((BigInt(st.put_in) + BigInt(st.granted || "0")) / 10n ** 18n), got = Number(BigInt(st.near) / 10n ** 18n);
          const pct = put ? Math.round((got / put) * 100) : 0;
          stakeBox.replaceChildren(el("small", { textContent: "Your stake" }), el("b", { textContent: `${fl(st.florins)} florins` }),
            el("span", { className: pct >= 100 ? "up" : "down", textContent: `${near(st.near)} grace if you claim today` }),
            el("span", { className: "fine", textContent: putInWords(clan, me, cfg, st).short }));
        }).catch(() => stakeBox.remove());
      }
      // Powers as tiles (his note 8 Nov: "our CTA buttons are so basic"): an icon in a coloured
      // disc, the power, one line on what it does.
      const grid = el("div", { className: "powertiles" });
      const power = (label, fn, kind, sub) => {
        const b = el("button", { type: "button", className: `powertile ${kind}` });
        b.innerHTML = `<span class="pi">${ICONS[kind] ?? ""}</span><span class="pt"><b></b><small></small></span>`;
        b.querySelector("b").textContent = label; b.querySelector("small").textContent = sub;
        b.addEventListener("click", fn); grid.append(b);
      };
      power(me ? "Bless again" : "Bless this nation", () => blessCard(clan, !me), "bless", me ? "Put more grace in. It lifts reverence up to 60." : "Put grace in and become one of its gods.");
      if (me) {
        if (!seats.includes(account)) power("Take your seat on the council", () => joinCard(clan, policy), "seat", "Get your vote among its gods.");
        else {
          power("Whisper", () => whisperCard(clan), "whisper", "Tell your citizens what matters.");
          power("Smite a citizen", () => smiteCard(clan), "smite", "Stun a cheat, or remove them.");
          power("Root it out", () => rootCard(clan), "root", "Cut knowledge that unsettles them.");
          power("Act of God", () => fireCard(clan), "fire", "Rain fire on another nation's florins.");
        }
        power("Claim your stake", () => withdrawCard(clan, me), "claim", "Take your florins out as grace.");
      }
      box.append(grid, rev);
      if (clan.whisper) box.append(el("p", { className: "fine" }, "The gods' last whisper: ", el("i", { textContent: `"${clan.whisper}"` })));
      // The DAO's open proposals (read straight from the DAO, never a cache), and every gift's status
      // live from the world contract: a ruling already waiting, or one that can't do anything any
      // more, shows as such (9 Nov: a second god's ruling waited for the other vote, the panel kept
      // offering "Rule on it", and seven more rulings piled up on a gift already settled).
      const nowNs = BigInt(Date.now()) * 1_000_000n;
      let open = [];
      if (policy) {
        const last = await wallet.view(c.dao, "get_last_proposal_id").catch(() => 0);
        const props = last ? await wallet.view(c.dao, "get_proposals", { from_index: Math.max(0, last - 15), limit: 15 }).catch(() => []) : [];
        if (my !== token) return;
        const period = BigInt(policy.proposal_period);
        open = props.filter((p) => p.status === "InProgress" && BigInt(p.submission_time) + period > nowNs && p.kind.FunctionCall?.receiver_id === WORLD).reverse();
      }
      const argsOf = (p) => C.vote(c.dao, p, "VoteApprove").decoded;
      const rulingFor = new Map(); // gift id -> the open ruling proposal on it (the newest)
      for (const p of open) { const d = argsOf(p); if (d.method === "rule" && d.args?.gift_id != null && !rulingFor.has(d.args.gift_id)) rulingFor.set(d.args.gift_id, p); }
      const giftNow = new Map(); // gift id -> its status on the world contract, now
      await Promise.all([...new Set([...rulingFor.keys(), ...open.map((p) => argsOf(p).args?.gift_id).filter((x) => x != null)])]
        .map((id) => wallet.view(WORLD, "get_gift", { gift_id: id }).then((x) => giftNow.set(id, x?.status)).catch(() => {})));
      // Drafts to rule on (own, within 24h). Drafts can't be claimed any more (SPEC §14).
      if (me) {
        const g = await api(`gifts?id=${c.id}`).catch(() => ({ gifts: [] }));
        if (my !== token) return;
        const now = g.now_ms ?? Date.now();
        const toRule = (g.gifts || []).filter((x) => x.clan === c.id && (giftNow.get(x.id) ?? x.status) === "Pending" && now < x.ends_ms);
        if (seats.includes(account)) for (const x of toRule) {
          const hrs = Math.max(1, Math.round((x.ends_ms - now) / 3600000));
          const row = el("div", { className: "gift" }, el("span", { textContent: `Gift #${x.id}: ${x.title ?? "a draft"} (${x.passed ? "the Warden passed it" : "the Warden failed it"}, ${hrs}h left to rule)` }));
          const waitingP = rulingFor.get(x.id);
          if (waitingP) {
            const yes = Object.values(waitingP.votes || {}).filter((v) => v === "Approve").length, need = C.needed(seats.length, 0);
            row.append(el("small", { textContent: ` A ruling is already waiting: ${yes} of ${need} yes votes.${waitingP.votes?.[account] ? " Yours is in; the other gods vote under Open motions." : " Vote on it under Open motions."}` }));
          } else {
            const b = el("button", { type: "button", className: "viewbtn", textContent: "Rule on it" });
            b.addEventListener("click", () => ruleCard(clan, x));
            row.append(b);
          }
          box.append(row);
        }
      }
      // Open motions: nations with more than one god vote on each power (and a lone god can finish
      // a proposal whose vote they didn't sign).
      if (policy) {
        if (open.length) box.append(el("h4", { textContent: "Open motions" }));
        for (const p of open) {
          const yes = Object.values(p.votes || {}).filter((v) => v === "Approve").length;
          const need = C.needed(seats.length, 0);
          const row = el("div", { className: "gift" }, el("span", { textContent: `${p.description.replace(/^AD FONTES: /, "")} · by ${godName(p.proposer)} · ${yes} of ${need} yes votes` }));
          // A ruling on a gift that's no longer pending can't do anything: no vote buttons.
          const d = argsOf(p), gs = d.method === "rule" ? giftNow.get(d.args?.gift_id) : null;
          const stale = d.method === "rule" && (gs !== "Pending" || rulingFor.get(d.args?.gift_id) !== p);
          if (stale) row.append(el("small", { textContent: gs && gs !== "Pending" ? ` Out of date: gift #${d.args.gift_id} was already ruled on, so this can't do anything now. It lapses on its own.` : " A newer ruling on the same gift is open; vote on that one." }));
          else if (seats.includes(account) && !p.votes?.[account]) {
            for (const [lab, action] of [["Approve", "VoteApprove"], ["Reject", "VoteReject"]]) {
              const b = el("button", { type: "button", className: "viewbtn", textContent: lab });
              b.addEventListener("click", () => voteCard(clan, p, action));
              row.append(b);
            }
          } else if (p.votes?.[account]) row.append(el("small", { textContent: ` You voted ${p.votes[account] === "Approve" ? "yes" : "no"}.` }));
          box.append(row);
        }
      }
    }
    draw().catch((e) => box.replaceChildren(el("p", { className: "fine", textContent: `Couldn't read the world just now (${e.message}).` })));
    refreshPanel = () => draw().catch(() => {});
    return box;
  }

  function blessCard(clan, isNew) {
    const amt = input({ value: "1", inputMode: "decimal" });
    card({
      title: `Bless ${clan.name}`,
      fields: [label("Grace to give", amt)],
      words: () => `Your grace goes into ${clan.name}: 86% for its citizens to spend, 14% kept in reserve.${isNew ? " You become one of its gods with a seat on its council. 0.01 grace of it pays for the seat and a little for upkeep." : ""} You can take your share back out at any time. Your citizens feel it, but a blessing only lifts their reverence up to 60, each one counts less than the last on the same day, and under 0.1 grace moves nobody. Past that, your words do the work.`,
      check: () => { try { const y = toYocto(amt.value); if (y <= 0n) return "Put in some grace."; if (isNew && y < toYocto("0.05")) return "A first blessing needs at least 0.05 grace (your council seat and upkeep come out of it)."; } catch (e) { return e.message; } return null; },
      calls: () => [C.bless(WORLD, clan.id, toYocto(amt.value))],
      after: async () => {
        live.fx.play({ kind: "bless", clan: clan.id, text: `${myName()} blessed ${clan.name} with ${amt.value} grace` });
        return `${clan.name} is blessed with ${amt.value} grace.${isNew ? " You are now one of its gods." : ""}`;
      },
    });
  }
  function joinCard(clan, policy) {
    card({
      title: "Take your seat on the council",
      words: () => `You are a god of ${clan.name}, but your council seat didn't go through when you blessed it. This asks again. The ${near(policy.proposal_bond)} grace pays for the motion.`,
      calls: () => [C.joinDao(WORLD, clan.id, policy.proposal_bond)],
      after: async () => "The world approved your seat. Your council powers work in a few seconds.",
    });
  }
  // Born (10 Nov): from the moment you sign a founding until its island is up, what's happening step by
  // step (read from the API every 2 s), and a place to write your first whisper while you wait. When the
  // island has risen, the whisper card opens with it filled in, ready to sign.
  function birthPanel(want) {
    document.querySelector(".birth")?.remove();
    const t0 = Date.now();
    const step = (t) => el("li", { className: "todo", textContent: t });
    const steps = [step(`The world is making ${want} and its council.`), step("Its first citizens are on their way."), step("Their reverence for you starts with them."), step("Then the island rises.")];
    const done = (i, t) => { steps[i].className = "done"; if (t) steps[i].textContent = t; };
    const clock = el("span", { className: "clock" });
    const text = el("textarea", { className: "txin", maxLength: 280, rows: 3, placeholder: "e.g. Read slowly. Only cite what you can check." });
    const hide = el("button", { type: "button", className: "viewbtn", textContent: "Hide" });
    // Playing without a wallet (no email or Google sign-in needed): say who they are on NEAR and that
    // the key lives only in this browser, with the save button right there.
    let who = null, save = null;
    if (wallet.isLocal?.()) {
      who = el("div", { className: "whoami" },
        wallet.email?.() ? el("p", {}, "You're signed in as ", el("b", { textContent: wallet.email() }), ".") : el("p", {}, "You're signed in."),
        el("p", { className: "fine", textContent: wallet.email?.() ? "Nothing pops up when you act. Your account is saved to your email, locked with your passphrase, so you can come back from any browser." : "Nothing pops up when you act. Your account lives only in this browser: back it up so you can come back from anywhere." }));
      if (!wallet.email?.()) { save = el("button", { type: "button", className: "viewbtn gold", textContent: "Save a backup" }); save.addEventListener("click", saveKey); }
    }
    const box = el("aside", { className: "birth", role: "status" },
      el("h3", {}, `${want} is being born `, clock),
      el("ol", {}, ...steps),
      who,
      el("p", { className: "fine", textContent: "While you wait, write your first whisper. Tell them what matters. It opens for you to send the moment they're here." }),
      text, el("div", { className: "row" }, save, hide));
    let stop = false, id = null;
    hide.addEventListener("click", () => { stop = true; box.remove(); });
    document.body.append(box);
    const tick = async () => {
      if (stop || !box.isConnected) return;
      clock.textContent = `${Math.round((Date.now() - t0) / 1000)} s`;
      try {
        const w = await api("world");
        const c = w.clans.find((x) => x.name === want);
        if (c) { id = c.id; done(0, `${want} is in the world, with its own council.`); }
        if (c?.ready) {
          const d = await api(`clan?id=${c.id}&fresh=1`).catch(() => null);
          const people = (d?.agents || []).filter((a) => a.alive);
          if (people.length) done(1, `Here: ${people.map((a) => `${a.name} (${a.role})`).join(", ")}.`);
          const mine = c.reverence?.gods?.[account]?.r ?? Math.max(0, ...Object.values(c.reverence?.gods || {}).map((g) => g.r));
          if (c.reverence) done(2, `They revere you at ${Math.round(mine)} to start.`);
        }
        const isl = id != null && live.islands.get(id);
        if (isl?.visible && isl.userData.rose) {
          done(3, `${want} is up. Your people are on the plaza.`);
          stop = true;
          const words = text.value.trim();
          setTimeout(() => { box.remove(); if (words) whisperCard(W.clans.find((x) => x.id === id) ?? c, words); }, 4500);
          return;
        }
      } catch {}
      if (Date.now() - t0 < 180e3) setTimeout(tick, 2000);
      else done(3, "This is taking longer than usual. The island rises as soon as its people are made.");
    };
    tick();
  }
  async function whisperCard(clan, preset = "") {
    const p = await prepDao(clan);
    const text = el("textarea", { className: "txin", maxLength: 280, rows: 3, placeholder: "e.g. Take fewer risks this season. Honesty first." });
    text.value = preset;
    card({
      title: "Whisper",
      fields: [label("Your whisper (280 characters at most)", text)],
      words: () => `Your citizens hear this against what's happening to them right now. Say something that fits the moment and they'll take it as prophecy and revere you more. Something vague moves little, and something that misreads them costs you. It's how a god wins reverence past 60, where blessings stop. They also lean their choices toward it every turn. ${clan.name}'s council of gods votes on it, and yours is the first vote.`,
      check: () => (!text.value.trim() ? "Write the whisper." : new TextEncoder().encode(text.value.trim()).length > 280 ? "That's over 280 characters." : null),
      calls: () => { const w = text.value.trim(); return p.build("whisper", { clan_id: clan.id, text: w }, `AD FONTES: whisper to ${clan.name}: "${w}"`).calls; },
      after: async (outs) => {
        const r = await daoResult(clan, C.returned(outs[0]));
        if (!r.passed) return waiting(r.left);
        live.fx.play({ kind: "whisper", clan: clan.id, text: `The gods whisper: "${text.value.trim()}"` });
        return `Whispered. ${clan.name}'s citizens hear it from their next turn.`;
      },
    });
  }
  // Reads the DAO once, then builds proposal calls for any arguments without another round trip.
  async function prepDao(clan) {
    const policy = await wallet.view(clan.dao, "get_policy");
    const p = { policy };
    p.build = (method, args, description) => ({ calls: C.daoPower(WORLD, clan.dao, policy.proposal_bond, method, args, description) });
    return p;
  }
  async function citizenPicker(clan) {
    const agents = (await wallet.view(WORLD, "list_agents", { clan_id: clan.id, limit: 100 })).filter((a) => a.alive);
    const sel = el("select", { className: "txin" }, ...agents.map((a) => el("option", { value: a.name, textContent: `${a.name}, ${a.role}` })));
    return { sel, agents };
  }
  const verdictPicker = () => el("select", { className: "txin" }, el("option", { value: "Stunt", textContent: "Stunt: no work or learning for 3 turns (about 6 hours)" }), el("option", { value: "Kill", textContent: "Kill: gone for good (the name stays taken)" }));
  async function smiteCard(clan, accused = null) {
    const [{ sel, agents }, p] = await Promise.all([citizenPicker(clan), prepDao(clan)]);
    if (!agents.length) return toast(`${clan.name} has no living citizens to smite.`);
    const v = verdictPicker();
    if (accused && agents.some((a) => a.name === accused)) { sel.value = accused; v.value = "Stunt"; } // answering a report
    card({
      title: "Smite a citizen",
      fields: [label("Citizen", sel), label("Verdict", v)],
      words: () => `${sel.value} is ${v.value === "Kill" ? "killed. A gravestone takes their place and their name is never used again" : "stunted: they can't work or learn for 3 turns (about 6 hours)"}. ${clan.name}'s council of gods votes on it, and yours is the first vote.`,
      calls: () => p.build("smite", { clan_id: clan.id, agent: sel.value, verdict: v.value }, `AD FONTES: ${v.value === "Kill" ? "kill" : "stunt"} ${sel.value} of ${clan.name}`).calls,
      after: async (outs) => {
        const r = await daoResult(clan, C.returned(outs[0]));
        if (!r.passed) return waiting(r.left);
        live.smite(clan.id, sel.value, v.value);
        return `${sel.value} is ${v.value === "Kill" ? "dead" : "stunted for 3 turns (about 6 hours)"}.`;
      },
    });
  }
  // Root it out (SPEC §14): cut a point of knowledge, and all that grew from it, from the mind map.
  async function rootCard(clan) {
    const [info, p] = await Promise.all([api(`clan?id=${clan.id}`).catch(() => null), prepDao(clan)]);
    const pts = (info?.points || []).filter((x) => x.parent && x.how !== "root");
    if (!pts.length) return toast(`${clan.name} has no knowledge to cut yet.`);
    // Points that unsettle the citizens first; the rest after.
    pts.sort((a, b) => (b.stir === "doubt") - (a.stir === "doubt") || a.depth - b.depth);
    const grew = (k) => { let n = 0; const q = [k]; while (q.length) { const x = q.shift(); for (const y of pts) if (y.parent === x) { n++; q.push(y.point); } } return n; };
    const sel = el("select", { className: "txin" }, ...pts.map((x) => el("option", { value: x.point, textContent: `${x.stir === "doubt" ? "Unsettling: " : ""}${x.point}${grew(x.point) ? ` (+${grew(x.point)} that grew from it)` : ""}` })));
    const pick = () => pts.find((x) => x.point === sel.value);
    card({
      title: "Root it out",
      fields: [label("Knowledge to cut", sel)],
      words: () => {
        const x = pick(), n = grew(x.point);
        return `"${x.point}"${n ? ` and the ${n} point${n === 1 ? "" : "s"} that grew from it` : ""} leave ${clan.name}'s mind map for good. ` +
          (x.stir === "doubt" ? `It unsettles the citizens${x.stir_why ? ` ("${x.stir_why}")` : ""}, so their faith stops sliding and they'll thank you for it. ` : "Nobody is worried about this one, so the citizens won't thank you for cutting it. ") +
          `The cost: the nation's lines get shorter, so a patent draft gets less likely. ${clan.name}'s council of gods votes on it, and yours is the first vote.`;
      },
      calls: () => p.build("root_out", { clan_id: clan.id, point: sel.value }, `AD FONTES: root out "${sel.value}" from ${clan.name}`).calls,
      after: async (outs) => {
        const r = await daoResult(clan, C.returned(outs[0]));
        if (!r.passed) return waiting(r.left);
        return `Done. "${sel.value}" leaves ${clan.name}'s mind map on the world's next turn.`;
      },
    });
  }
  // Act of God (engine/fire.mjs): rain fire on another nation. Its florins burn, more the richer it
  // is next to the richest nation; walls shield some of it. Your own nation pays a tenth of the damage,
  // and each god can do it once a real day. It goes through your nation's DAO like root out (the
  // point "act of god: <id>"), so the vote is on NEAR.
  async function fireCard(clan, target = null) {
    const p = await prepDao(clan);
    // Nations at war are never a target: they're already being hit (his rule 10 Nov).
    // Fire burns what a nation can spend: florins less its gods' ring-fenced grant (as the engine does).
    const sp = (x) => x.spendable ?? x.florins ?? 0;
    const targets = W.clans.filter((x) => x.alive && !x.fallen && x.id !== clan.id && x.war?.enemy == null && sp(x) > 1);
    if (!targets.length) return toast("There's no nation at peace with florins to burn. Nations at war can't be struck.");
    const top = Math.max(...W.clans.filter((x) => x.alive && !x.fallen).map(sp));
    const est = (x) => { const shield = Math.min(0.3, ((x.war?.walls || 0) / 300) * 0.3); const pct = (0.05 + 0.2 * (sp(x) / top)) * (1 - shield); return { pct, fl: sp(x) * pct }; };
    targets.sort((a, b) => sp(b) - sp(a));
    const sel = el("select", { className: "txin" }, ...targets.map((x) => el("option", { value: String(x.id), textContent: `${x.name}: about ${Math.round(est(x).fl)} of its ${Math.round(sp(x))} spendable florins burn` })));
    if (target != null && targets.some((x) => x.id === Number(target))) sel.value = String(target);
    const pick = () => targets.find((x) => String(x.id) === sel.value);
    // Try it in a copy first (11 Nov): the sandbox opens with this fire set up, so you see it land and
    // whether the target recovers before you cast it for real.
    const tryIt = el("a", { className: "trycopy", target: "_blank", rel: "noopener", textContent: "🔥 Try it in a copy first" });
    const setTry = () => (tryIt.href = `/timelapse/?caster=${clan.id}&target=${sel.value}`);
    sel.addEventListener("change", setTry); setTry();
    card({
      title: "Act of God",
      fields: [label("The nation to burn", sel), tryIt],
      words: () => {
        const x = pick(), e = est(x);
        const fenced = Math.round((x.florins || 0) - sp(x));
        return `Fire rains on ${x.name}. About ${Math.round(e.pct * 100)}% of the florins it can spend burn (${Math.round(e.fl)}), more the richer it is${sp(x) >= top ? " (it's the richest)" : ""}${x.war?.walls ? ", less for its walls" : ""}.${fenced > 1 ? ` Its gods' ${fenced} ring-fenced florins can't burn.` : ""} Burnt florins are gone, so every other florin in the world is worth a little more. ` +
          `${clan.name} pays for it: a tenth of the damage burns from its own florins. You can call fire once a real day, never on your own nation, and never on a nation at war. ${clan.name}'s council of gods votes on it, and yours is the first vote, and burns on the world's next turn.`;
      },
      calls: () => p.build("root_out", { clan_id: clan.id, point: `act of god: ${sel.value}` }, `AD FONTES: an Act of God. ${clan.name}'s gods rain fire on ${pick().name}`).calls,
      after: async (outs) => {
        const r = await daoResult(clan, C.returned(outs[0]));
        if (!r.passed) return waiting(r.left);
        return `Done. Fire falls on ${pick().name} on the world's next turn, and it burns there until that turn ends.`;
      },
    });
  }
  async function ruleCard(clan, gift) {
    const [{ sel, agents }, p] = await Promise.all([citizenPicker(clan), prepDao(clan)]);
    const choice = el("select", { className: "txin" }, el("option", { value: "reward", textContent: "Reward the gift" }), el("option", { value: "punish", textContent: "Punish a citizen for it" }));
    const v = verdictPicker();
    const pick = label("Citizen", sel), verd = label("Verdict", v);
    const sync = () => { pick.hidden = verd.hidden = choice.value !== "punish"; };
    choice.addEventListener("input", sync);
    sync();
    card({
      title: `Rule on gift #${gift.id}`,
      fields: [label("Ruling", choice), pick, verd],
      words: () => (choice.value === "reward" ? `You record that the gods reward "${gift.title ?? "this draft"}". To reward it with grace too, bless the nation.` : `You punish ${sel.value} for this gift: ${v.value === "Kill" ? "killed for good" : "stunted for 3 turns (about 6 hours)"}.`) + ` ${clan.name}'s council of gods votes on it, and yours is the first vote.`,
      check: () => (choice.value === "punish" && !agents.length ? "There is no living citizen to punish." : null),
      calls: () => p.build("rule", choice.value === "reward" ? { gift_id: gift.id, reward: true, verdict: null, agent: null } : { gift_id: gift.id, reward: false, verdict: v.value, agent: sel.value }, `AD FONTES: ${choice.value} gift #${gift.id}${choice.value === "punish" ? ` (${v.value.toLowerCase()} ${sel.value})` : ""}`).calls,
      after: async (outs) => {
        const r = await daoResult(clan, C.returned(outs[0]));
        if (!r.passed) return waiting(r.left);
        if (choice.value === "punish") live.smite(clan.id, sel.value, v.value);
        live.fx.play({ kind: "ruling", clan: clan.id, text: choice.value === "reward" ? `The gods rewarded gift #${gift.id}` : `The gods punished ${sel.value} for gift #${gift.id}` });
        return `Ruled: gift #${gift.id} is ${choice.value === "reward" ? "rewarded" : "punished"}.`;
      },
    });
  }
  async function withdrawCard(clan, me) {
    const last = clan.gods.length === 1;
    const [st, cfg] = await Promise.all([wallet.view(WORLD, "get_stake", { clan_id: clan.id, account }).catch(() => null), wallet.view(WORLD, "get_config").catch(() => null)]);
    if (!st) return toast("Couldn't read your stake. Try again.");
    const pays = BigInt(st.near), out = last ? pays + BigInt(clan.staking_fund) : pays > 10n ** 22n ? pays - 10n ** 22n : 0n;
    card({
      title: "Claim your stake",
      words: () => `Your stake in ${clan.name} is ${fl(st.florins)} florins. At today's florin value they pay ${near(st.near)} grace. ${putInWords(clan, me, cfg, st).long} ` +
        "The 14% of every blessing that went to the jackpot stays there for the season's winner. " +
        (last
          ? `You are ${clan.name}'s last god, so claiming ends the nation: its citizens are gone and its island becomes ruins that other nations can absorb. You get about ${near(out)} grace, with its savings. This can't be undone.`
          : `You leave ${clan.name}'s gods with about ${near(out)} grace (0.01 grace for giving up your council seat comes out of it). The nation goes on with its other gods.`),
      calls: () => [C.withdraw(WORLD, clan.id)],
      after: async () => {
        live.fx.play({ kind: "withdraw", clan: clan.id, text: last ? `The last god left ${clan.name}` : `A god left ${clan.name}` });
        if (last) live.refresh?.();
        return last ? `You claimed your stake. ${clan.name} falls to ruins on the next look at the world.` : `You claimed your stake from ${clan.name}.`;
      },
    });
  }
  function voteCard(clan, p, action) {
    const yes = action === "VoteApprove";
    const call = C.vote(clan.dao, p, action), { method, args } = call.decoded;
    card({
      title: yes ? "Approve this motion" : "Reject this motion",
      words: () => `${p.description.replace(/^AD FONTES: /, "")}. Proposed by ${p.proposer}. Your ${yes ? "yes" : "no"} vote${yes ? " runs it straight away if it's the last one needed" : " counts against it"}.`,
      calls: () => [call],
      // Still open? (9 Nov: a vote on a proposal another god had just finished failed in the wallet.)
      before: async () => {
        const now = await wallet.view(clan.dao, "get_proposal", { id: p.id }).catch(() => null);
        if (now && now.status !== "InProgress") throw new Error(`This motion was already decided (${now.status.toLowerCase()}), so there's nothing to vote on. Nothing was sent.`);
      },
      after: async () => {
        const r = yes ? await daoResult(clan, p.id) : { passed: false };
        if (!r.passed) return yes ? waiting(r.left) : "Your no vote is in.";
        if (method === "smite" || (method === "rule" && !args.reward)) live.smite(clan.id, args.agent, args.verdict);
        live.fx.play({ kind: method === "whisper" ? "whisper" : method === "release_staking" ? "staking" : "ruling", clan: clan.id, text: method === "whisper" ? `The gods whisper: "${args.text}"` : `The gods voted: ${p.description.replace(/^AD FONTES: /, "")}` });
        return "It passed and ran.";
      },
    });
  }

  /** The live nations the signed-in account is a god of (oldest first). */
  async function myNations() {
    if (!account) return [];
    const clans = await wallet.view(WORLD, "list_clans", { limit: 100 }).catch(() => []);
    return clans.filter((c) => c.alive && c.gods.some((g) => g.account === account)).map((c) => c.id);
  }
  /** The personal feed's buttons (src/live/feed.js): open a god's card on a nation, preset. */
  async function act({ kind, clan: clanId, target = null, text = "", agent = null }) {
    const clan = (live.world?.clans || W.clans).find((c) => c.id === Number(clanId)) || W.clans.find((c) => c.id === Number(clanId));
    if (!account) { openMenu(); return toast("Become a god first: it takes a few seconds."); }
    if (!clan) return;
    if (kind === "fire") return fireCard(clan, target);
    if (kind === "whisper") return whisperCard(clan, text);
    if (kind === "bless") return blessCard(clan);
    if (kind === "smite") { const ch = await wallet.view(WORLD, "get_clan", { clan_id: clan.id }).catch(() => null); return ch ? smiteCard(ch, agent) : toast("Couldn't read the world just now. Try again."); }
  }
  /** A signed choice (PLAN_13NOV step 0): the same text the server checks (engine/choices.mjs messageOf). */
  async function choose(kind, clan, payload, day) {
    const c = { world: WORLD, kind, clan: Number(clan), payload, day: Number(day), nonce: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
    const msg = `adfontes-choice:${JSON.stringify({ world: c.world, kind: c.kind, clan: c.clan, payload: c.payload, day: c.day, nonce: c.nonce })}`;
    const signed = await wallet.signChoice(msg);
    if (!signed) { toast(account ? "The choice wasn't signed, so nothing was saved." : "Become a god first to choose."); return false; }
    const r = await fetch("/api/choice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...c, ...signed }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the world. Try again." }));
    toast(r.ok ? (kind === "ask" ? "Asked. The accused answers in a moment." : "Chosen. Your Scholars follow it next turn.") : r.error);
    if (r.ok) setTimeout(() => refreshPanel(), 1500); // asked: the panel shows "waiting for the answer"
    return !!r.ok;
  }
  return { section, wallet, openMenu, myNations, act, choose, account: () => account };
}
