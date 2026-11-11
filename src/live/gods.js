// The god panel (SPEC §12j). A wallet chip in the HUD, "Your powers" in each nation's panel, and a
// confirm card that shows the exact transaction before your wallet ever opens. Every deposit is read
// live from the chain (get_config, the DAO's policy), never hard-coded.
import { createWallet, toYocto, near, failure, TGAS } from "./wallet.js";
import * as C from "./calls.js";
import * as Intents from "./intents.js";
import { api } from "../net.js";

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
      short: `founded with ${near(paid)} NEAR, the world gave back ${near(given)} of the founding costs, so your stake counts ${near(counts)} NEAR (${pct}% of it today)`,
      long: `You founded ${clan.name} with about ${near(paid)} NEAR. ${near(costs)} of that paid for the nation's DAO and its staking fund, and the world gave ${near(given)} back to you as florins. So your stake counts ${near(counts)} NEAR, and today it's worth ${pct}% of that.`,
    };
  }
  if (given) return { short: `${pct}% of the ${near(counts)} NEAR your stake counts (${near(put)} you put in, ${near(given)} from the world)`, long: `Your stake counts ${near(counts)} NEAR: ${near(put)} you put in and ${near(given)} the world gave you. Today it's worth ${pct}% of that.` };
  if (founder) return { short: `${pct}% of the ${near(put)} NEAR in your stake (founding costs aside)`, long: `After founding costs, ${near(put)} NEAR of what you paid went into your stake, and today it's worth ${pct}% of that.` };
  return { short: `${pct}% of the ${near(put)} NEAR you put in`, long: `You put in ${near(put)} NEAR, so that's ${pct}% of it.` };
}

export async function createGods({ live, W, nav, toast, route, replayIntro }) {
  const WORLD = W.world;
  const wallet = await createWallet(W.net);
  let account = wallet.account();
  let refreshPanel = () => {};

  // ---------------------------------------------------------------- the HUD chip
  const chip = el("button", { className: "chip wallet", type: "button" });
  nav.prepend(chip, " ");
  const menu = el("div", { className: "walletmenu", hidden: true });
  document.getElementById("visor").append(menu);
  const showChip = () => { chip.innerHTML = account ? `◈ <span class="word">${short(account)}</span>` : `◈ <span class="word">Connect wallet</span>`; };
  showChip();
  wallet.onAccount((a) => { account = a; showChip(); refreshPanel(); if (!menu.hidden) openMenu(); });
  chip.addEventListener("click", () => (menu.hidden ? openMenu() : (menu.hidden = true)));
  document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target) && !chip.contains(e.target)) menu.hidden = true; });

  async function openMenu() {
    menu.replaceChildren();
    menu.hidden = false;
    if (!account) {
      menu.append(el("p", { className: "lead", textContent: `Connect a NEAR ${W.net} wallet to bless nations and use your powers as a god.` }));
      for (const w of await wallet.wallets()) {
        const b = el("button", { type: "button", className: "walletpick" }, w.icon ? el("img", { src: w.icon, alt: "", width: 22, height: 22 }) : null, el("span", { textContent: w.name }));
        b.addEventListener("click", async () => {
          b.disabled = true;
          try { await wallet.signIn(w.id); menu.hidden = true; if (w.id === "local") quickStart(); } catch (e) { toast(`${w.name}: ${e.message || "could not connect"}`); }
          b.disabled = false;
        });
        menu.append(b);
      }
      if (W.net !== "mainnet") menu.append(el("p", { className: "fine", textContent: "This is the practice world on testnet. HOT joins the list on mainnet." }));
      return;
    }
    menu.append(el("p", { className: "lead" }, "Signed in as ", el("b", { textContent: account })));
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
        el("small", { textContent: `${rank ? `#${rank} of ${ranked.length}` : ""}${myRev != null ? ` · your reverence ${myRev}` : ""} · your stake ${st ? `${fl(st.florins)} florins, ${near(st.near)} NEAR` : "?"}` }));
      b.addEventListener("click", () => { menu.hidden = true; live.flyTo(c.id); });
      menu.append(b);
    }
    const row = el("div", { className: "row" });
    const found = el("button", { type: "button", className: "viewbtn gold", textContent: "Found a nation" });
    found.addEventListener("click", () => { menu.hidden = true; foundCard(); });
    row.append(found);
    // NEAR Intents: top up from any chain (mainnet; on testnet the sponsor pool tops founders up).
    if (W.net === "mainnet") { // on testnet it could only say "not here"
      const topup = el("button", { type: "button", className: "viewbtn", textContent: "Top up with any crypto" });
      topup.addEventListener("click", () => { menu.hidden = true; intentsCard(); });
      row.append(topup);
    }
    if (BigInt(owed || 0) > 0n) {
      const claim = el("button", { type: "button", className: "viewbtn", textContent: `Claim ${near(owed)} NEAR owed` });
      claim.addEventListener("click", () => { menu.hidden = true; claimOwedCard(owed); });
      row.append(claim);
    }
    if (replayIntro) { const intro = el("button", { type: "button", className: "viewbtn", textContent: "Watch the intro" }); intro.addEventListener("click", () => { menu.hidden = true; replayIntro(); }); row.append(intro); }
    const out = el("button", { type: "button", className: "viewbtn", textContent: "Sign out" });
    out.addEventListener("click", async () => { await wallet.signOut(); menu.hidden = true; });
    row.append(out);
    menu.append(row);
    // Playing without a wallet: the key lives in this browser only. Save it, or lose the account
    // with the browser's storage.
    if (wallet.isLocal?.()) {
      const save = el("button", { type: "button", className: "viewbtn gold", textContent: "Save your key" });
      save.addEventListener("click", saveKey);
      menu.append(el("p", { className: "fine", textContent: "You're playing without a wallet. Your key lives in this browser. Save it so you don't lose your nation." }), el("div", { className: "row" }, save));
    }
  }

  // The browser key as a file (only when playing without a wallet).
  function saveKey() {
    const k = wallet.exportKey();
    if (!k) return;
    const blob = new Blob([JSON.stringify(k, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `adfontes-${k.account.slice(0, 8)}.json` });
    a.click(); URL.revokeObjectURL(a.href);
    toast("Key saved. Anyone with this file controls the account, so keep it private. MyNearWallet can import it too.");
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
    const sign = el("button", { type: "button", className: "viewbtn gold", textContent: "Sign in your wallet" });
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
      sign.textContent = wallet.isLocal?.() ? (spec.working ?? "Sending…") : "Approve it in your wallet…";
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
        if (bad) throw new Error(`NEAR refused it: ${bad}`);
        const hash = outs.map((o) => o?.transaction?.hash).find(Boolean);
        sign.textContent = "Done";
        const msg = (await spec.after?.(outs)) ?? "Done.";
        if (spec.closeAfter) { close(); refreshPanel(); return; } // something else carries on from here (a founding's birth panel)
        box.replaceChildren(el("h3", { textContent: spec.title }), el("p", { className: "words", textContent: msg }),
          hash ? el("p", { className: "fine" }, el("a", { href: `${wallet.explorer}/txns/${hash}`, target: "_blank", rel: "noopener", textContent: "See it on NEAR ↗" })) : null,
          el("div", { className: "row" }, Object.assign(el("button", { type: "button", className: "viewbtn", textContent: "Close" }), { onclick: close })));
        refreshPanel();
      } catch (e) {
        if (e.partial?.length) { // the proposal went in, the vote didn't
          box.replaceChildren(el("h3", { textContent: spec.title }), el("p", { className: "words", textContent: "Your proposal is in, but your yes vote wasn't sent. Vote on it under Open proposals in the nation's panel." }),
            el("div", { className: "row" }, Object.assign(el("button", { type: "button", className: "viewbtn", textContent: "Close" }), { onclick: close })));
          refreshPanel();
          return;
        }
        err.textContent = /reject|cancel|closed|denied/i.test(e.message || "") ? "You cancelled in your wallet. Nothing was sent." : e.message || "Something went wrong. Nothing was charged unless your wallet says so.";
        sign.textContent = "Sign in your wallet";
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
  const waiting = (left) => `Your proposal is open. It needs ${left} more yes vote${left === 1 ? "" : "s"} from this nation's other gods, who see it in this panel. It runs as soon as it passes.`;

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
    if (sent) { toast(`You're ${account}, with ${sent} free testnet NEAR. Now name your nation.`); setTimeout(foundCard, 2500); return; }
    toast("Your account is ready. Getting you free testnet NEAR to found a nation…");
    const r = await fetch("/api/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the world." }));
    if (r.ok) toast(`${r.sent} testnet NEAR sent to you. Now name your nation.`);
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
      help.append(line(`You have ${bal == null ? "?" : near(bal)} ${W.net === "mainnet" ? "NEAR" : "testnet NEAR"}; founding takes at least ${near(cfg.min_found)} plus a little for gas.${W.net === "mainnet" ? " This is real NEAR." : ""}`, short));
      if (W.net === "testnet" && sp?.available) {
        const left = sp.nations_left;
        const refill = sp.next_refill_ms ? Math.max(1, Math.round((sp.next_refill_ms - Date.now()) / 3600e3)) : null;
        if (short && left > 0) {
          const b = el("button", { type: "button", className: "viewbtn gold", textContent: `Get sponsored: free testnet NEAR to found (${left} new nation${left === 1 ? "" : "s"} left)` });
          b.addEventListener("click", async () => {
            b.disabled = true; b.textContent = "Sending…";
            const r = await fetch("/api/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the world. Try again." }));
            if (r.ok) { toast(`Sponsored: ${r.sent} testnet NEAR sent to you. Now name your nation.`); cardOpen?.remove(); setTimeout(foundCard, 1500); }
            else { b.textContent = r.error; }
          });
          help.append(line("Founding needs more testnet NEAR than any faucet gives, so the world sponsors new founders once per account, while its pool lasts."), b);
        } else if (short) {
          help.append(line(`New testnet nations are full for now${refill ? ` (the pool refills in about ${refill} hour${refill === 1 ? "" : "s"})` : ""}. Bless a nation to become one of its gods.`, true));
          const b = el("button", { type: "button", className: "viewbtn gold", textContent: "Bless a nation instead" });
          b.addEventListener("click", () => { cardOpen?.remove(); live.home(); toast("Tap a nation, then press Bless this nation in its panel."); });
          help.append(b);
        } else help.append(line(`${left} sponsored new testnet nation${left === 1 ? "" : "s"} left this round.`));
      }
      card({
        title: "Found a nation",
        fields: [help, label("Name", name), label("NEAR to put in", amt)],
        words: () => fundPays
          ? `You found "${name.value.trim() || "…"}" and become its first god. The world pays for its DAO, so everything you put in is the nation's money: 86% for its citizens to spend, 14% to the season jackpot.`
          : `You found "${name.value.trim() || "…"}" and become its first god. ${near(cfg.dao_deposit)} NEAR makes its DAO, ${near(cfg.staking_deposit)} NEAR goes to its staking fund and a little pays for storage. The rest is the nation's money: 86% for its citizens to spend, 14% to the season jackpot.`,
        working: "Founding… NEAR is building your nation's DAO. About 20 seconds.",
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
            if (toYocto(amt.value) < BigInt(cfg.min_found)) return `The minimum to found a nation is ${near(cfg.min_found)} NEAR.`;
            if (bal != null && toYocto(amt.value) + 10n ** 23n > bal) return `You can put in at most ${near(bal - 10n ** 23n)} NEAR (your wallet has ${near(bal)}; 0.1 stays for gas).`;
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
      words: () => `An earlier payout of ${near(owed)} NEAR to you couldn't be sent. This sends it now.`,
      calls: () => [C.claimOwed(WORLD)],
      after: async () => `${near(owed)} NEAR is on its way to ${account}.`,
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
      const who = (a) => (a === account ? "you" : short(a));
      if (R.waiting) rev.append(el("p", { className: "fine warn", textContent: "Its citizens are waiting in the plaza for their god's first whisper. Nothing gets researched until then." }));
      else if (R.followed) rev.append(el("p", { className: "fine" }, `Its citizens follow ${who(R.followed)}${R.claimed_by ? " (an outside god who claimed this nation after it turned on its own)" : ""}. Standing: `, el("b", { textContent: String(R.standing) }), " of 100."));
      else rev.append(el("p", { className: "fine warn", textContent: "Its citizens follow no god right now." }));
      const list = el("div", { className: "revlist" });
      for (const [a, g] of Object.entries(R.gods).sort((x, y) => y[1].r - x[1].r)) {
        const bar = el("i", {}); bar.style.width = `${g.r}%`;
        list.append(el("div", { className: `revrow${a === account ? " me" : ""}` }, el("span", { textContent: who(a) + (g.outsider ? " (outside god)" : "") }), el("span", { className: "bar" }, bar), el("b", { textContent: String(g.r) }), g.enemies ? el("small", { textContent: `${g.enemies} enem${g.enemies === 1 ? "y" : "ies"}` }) : null));
      }
      rev.append(list);
      const mine = R.gods[account];
      if (mine && mine.r < 30) rev.append(el("p", { className: "fine warn", textContent: mine.r === 0 ? "This nation has turned on you. Your whispers are ignored." : "Your reverence is low: the citizens ignore your whispers and go their own way. Whisper, rule well and let the nation do well to win them back." }));
      for (const r of (info.reports || []).filter((x) => !x.settled)) {
        const row = el("div", { className: "gift report" }, el("span", { textContent: `Report, turn ${r.day}: ${r.claim}. Lapses on turn ${r.lapses_day}.` }));
        if (me && seated) {
          const b = el("button", { type: "button", className: "viewbtn", textContent: `Stunt ${r.accused}` });
          b.addEventListener("click", () => smiteCard(clan, r.accused));
          row.append(b, el("small", { textContent: "or do nothing and let it lapse. Stunt the guilty and the nation sees justice; stunt the innocent and you make an enemy; ignore a true report and the accuser loses faith." }));
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
          b.innerHTML = `<span class="pi">${ICONS.claim}</span><span class="pt"><b>Claim what's left</b><small>Take your share of its florins out as NEAR.</small></span>`;
          b.addEventListener("click", () => withdrawCard(clan, me));
          box.append(el("div", { className: "powertiles" }, b));
        }
        return;
      }
      if (status === "dead" || c.alive === false) { box.append(el("p", { className: "fine", textContent: "Ruins. Its last god left, so there is nothing left to command." })); return; }
      if (!account) {
        box.append(rev);
        drawReverence(false, false, null).catch(() => {});
        const b = el("button", { type: "button", className: "viewbtn gold", textContent: "Connect a wallet" });
        b.addEventListener("click", openMenu);
        box.append(el("p", { className: "fine", textContent: "Anyone can bless this nation with NEAR and become one of its gods." }), b);
        return;
      }
      box.append(el("p", { className: "fine", textContent: "Reading the chain…" }));
      const [clan, policy, cfg] = await Promise.all([wallet.view(WORLD, "get_clan", { clan_id: c.id }), wallet.view(c.dao, "get_policy").catch(() => null), wallet.view(WORLD, "get_config")]);
      if (my !== token || !clan) return;
      const me = clan.gods.find((g) => g.account === account);
      const seats = policy?.roles.find((r) => r.name === "gods")?.kind?.Group ?? [];
      box.replaceChildren(el("h4", { textContent: me ? "Your powers" : "Gods" }));
      drawReverence(!!me, seats.includes(account), clan).catch(() => {});
      box.append(el("p", { className: "fine", textContent: me ? `You are one of ${clan.gods.length} god${clan.gods.length === 1 ? "" : "s"} here, with ${near(me.put_in)} NEAR put in.` : `${clan.gods.length} god${clan.gods.length === 1 ? "" : "s"} watch over ${clan.name}.` }));
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
            el("span", { className: pct >= 100 ? "up" : "down", textContent: `${near(st.near)} NEAR if you claim today` }),
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
      power(me ? "Bless again" : "Bless this nation", () => blessCard(clan, !me), "bless", me ? "Put more NEAR in. It lifts reverence up to 60." : "Put NEAR in and become one of its gods.");
      if (me) {
        if (!seats.includes(account)) power("Take your DAO seat", () => joinCard(clan, policy), "seat", "Get your vote in the nation's DAO.");
        else {
          power("Whisper", () => whisperCard(clan), "whisper", "Tell your citizens what matters.");
          power("Smite a citizen", () => smiteCard(clan), "smite", "Stun a cheat, or remove them.");
          power("Root it out", () => rootCard(clan), "root", "Cut knowledge that unsettles them.");
          power("Act of God", () => fireCard(clan), "fire", "Rain fire on another nation's florins.");
        }
        power("Claim your stake", () => withdrawCard(clan, me), "claim", "Take your florins out as NEAR.");
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
            row.append(el("small", { textContent: ` A ruling is already waiting: ${yes} of ${need} yes votes.${waitingP.votes?.[account] ? " Yours is in; the other gods vote under Open proposals." : " Vote on it under Open proposals."}` }));
          } else {
            const b = el("button", { type: "button", className: "viewbtn", textContent: "Rule on it" });
            b.addEventListener("click", () => ruleCard(clan, x));
            row.append(b);
          }
          box.append(row);
        }
      }
      // Open proposals: nations with more than one god vote on each power (and a lone god can finish
      // a proposal whose vote they didn't sign).
      if (policy) {
        if (open.length) box.append(el("h4", { textContent: "Open proposals" }));
        for (const p of open) {
          const yes = Object.values(p.votes || {}).filter((v) => v === "Approve").length;
          const need = C.needed(seats.length, 0);
          const row = el("div", { className: "gift" }, el("span", { textContent: `${p.description.replace(/^AD FONTES: /, "")} · by ${short(p.proposer)} · ${yes} of ${need} yes votes` }));
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
    draw().catch((e) => box.replaceChildren(el("p", { className: "fine", textContent: `Couldn't read the chain just now (${e.message}).` })));
    refreshPanel = () => draw().catch(() => {});
    return box;
  }

  function blessCard(clan, isNew) {
    const amt = input({ value: "1", inputMode: "decimal" });
    card({
      title: `Bless ${clan.name}`,
      fields: [label("NEAR to give", amt)],
      words: () => `Your NEAR goes into ${clan.name}: 86% for its citizens to spend, 14% kept in reserve.${isNew ? " You become one of its gods with a seat in its DAO. 0.01 NEAR of it pays the DAO seat bond and a little pays for storage." : ""} You can take your share back out at any time. Your citizens feel it, but a blessing only lifts their reverence up to 60, each one counts less than the last on the same day, and under 0.1 NEAR moves nobody. Past that, your words do the work.`,
      check: () => { try { const y = toYocto(amt.value); if (y <= 0n) return "Put in some NEAR."; if (isNew && y < toYocto("0.05")) return "A first blessing needs at least 0.05 NEAR (the DAO seat bond and storage come out of it)."; } catch (e) { return e.message; } return null; },
      calls: () => [C.bless(WORLD, clan.id, toYocto(amt.value))],
      after: async () => {
        live.fx.play({ kind: "bless", clan: clan.id, text: `${short(account)} blessed ${clan.name} with ${amt.value} NEAR` });
        return `${clan.name} is blessed with ${amt.value} NEAR.${isNew ? " You are now one of its gods." : ""}`;
      },
    });
  }
  function joinCard(clan, policy) {
    card({
      title: "Take your DAO seat",
      words: () => `You are a god of ${clan.name}, but your seat in its DAO didn't go through when you blessed it. This asks again. The ${near(policy.proposal_bond)} NEAR bond pays for the seat proposal.`,
      calls: () => [C.joinDao(WORLD, clan.id, policy.proposal_bond)],
      after: async () => "Your seat is proposed and approved by the world. You can use the DAO powers in a few seconds.",
    });
  }
  // Born (10 Nov): from the moment you sign a founding until its island is up, what's happening step by
  // step (read from the API every 2 s), and a place to write your first whisper while you wait. When the
  // island has risen, the whisper card opens with it filled in, ready to sign.
  function birthPanel(want) {
    document.querySelector(".birth")?.remove();
    const t0 = Date.now();
    const step = (t) => el("li", { className: "todo", textContent: t });
    const steps = [step(`NEAR is making ${want} and its DAO.`), step("Its first citizens are on their way."), step("Their reverence for you starts with them."), step("Then the island rises.")];
    const done = (i, t) => { steps[i].className = "done"; if (t) steps[i].textContent = t; };
    const clock = el("span", { className: "clock" });
    const text = el("textarea", { className: "txin", maxLength: 280, rows: 3, placeholder: "e.g. Read slowly. Only cite what you can check." });
    const hide = el("button", { type: "button", className: "viewbtn", textContent: "Hide" });
    // Playing without a wallet (no email or Google sign-in needed): say who they are on NEAR and that
    // the key lives only in this browser, with the save button right there.
    let who = null, save = null;
    if (wallet.isLocal?.()) {
      who = el("div", { className: "whoami" },
        el("p", {}, "You're ", el("b", { textContent: account }), " on NEAR testnet."),
        el("p", { className: "fine", textContent: "No wallet and no sign-in: your key signs right here, so nothing pops up when you act. It lives only in this browser. Save it and you can come back to your nation from anywhere." }));
      save = el("button", { type: "button", className: "viewbtn gold", textContent: "Save your key" });
      save.addEventListener("click", saveKey);
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
        if (c) { id = c.id; done(0, `${want} is on NEAR, with its own DAO.`); }
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
      words: () => `Your citizens hear this against what's happening to them right now. Say something that fits the moment and they'll take it as prophecy and revere you more. Something vague moves little, and something that misreads them costs you. It's how a god wins reverence past 60, where blessings stop. They also lean their choices toward it every turn. It goes to ${clan.name}'s DAO as a proposal with your yes vote.`,
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
      words: () => `${sel.value} is ${v.value === "Kill" ? "killed. A gravestone takes their place and their name is never used again" : "stunted: they can't work or learn for 3 turns (about 6 hours)"}. It goes to ${clan.name}'s DAO as a proposal with your yes vote.`,
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
          `The cost: the nation's lines get shorter, so a patent draft gets less likely. It goes to ${clan.name}'s DAO as a proposal with your yes vote.`;
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
  async function fireCard(clan) {
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
    const pick = () => targets.find((x) => String(x.id) === sel.value);
    card({
      title: "Act of God",
      fields: [label("The nation to burn", sel)],
      words: () => {
        const x = pick(), e = est(x);
        const fenced = Math.round((x.florins || 0) - sp(x));
        return `Fire rains on ${x.name}. About ${Math.round(e.pct * 100)}% of the florins it can spend burn (${Math.round(e.fl)}), more the richer it is${sp(x) >= top ? " (it's the richest)" : ""}${x.war?.walls ? ", less for its walls" : ""}.${fenced > 1 ? ` Its gods' ${fenced} ring-fenced florins can't burn.` : ""} Burnt florins are gone, so every other florin in the world is worth a little more. ` +
          `${clan.name} pays for it: a tenth of the damage burns from its own florins. You can call fire once a real day, never on your own nation, and never on a nation at war. It goes to ${clan.name}'s DAO as a proposal with your yes vote, and burns on the world's next turn.`;
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
      words: () => (choice.value === "reward" ? `You record that the gods reward "${gift.title ?? "this draft"}". To reward it with NEAR too, bless the nation.` : `You punish ${sel.value} for this gift: ${v.value === "Kill" ? "killed for good" : "stunted for 3 turns (about 6 hours)"}.`) + ` It goes to ${clan.name}'s DAO as a proposal with your yes vote.`,
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
  // ---- NEAR Intents (1Click): pay from any chain, NEAR lands in your account ----
  function intentsCard() {
    if (W.net !== "mainnet") return toast("NEAR Intents runs on mainnet. On testnet, the found card tops you up from the sponsor pool.");
    if (!account) return toast("Connect a wallet first: the NEAR goes to your account.");
    const box = el("div", { className: "txcard", role: "dialog" }), shade = el("div", { className: "txshade" }, box);
    const close = () => { clearInterval(poll); shade.remove(); };
    shade.addEventListener("pointerdown", (e) => { if (e.target === shade) close(); });
    const tok = el("select", { className: "txin" }, ...Intents.PAY_WITH.map((t, i) => el("option", { value: String(i), textContent: t.label })));
    const amt = el("input", { className: "txin", type: "number", min: "0.5", step: "0.5", value: "4" });
    const refund = el("input", { className: "txin", placeholder: "your address on that chain (for a refund if the swap fails)" });
    const out = el("p", { className: "words", textContent: "Pick what you pay with and how much NEAR you want. You'll see the price before anything moves." });
    const err = el("p", { className: "err" });
    const priceBtn = el("button", { type: "button", className: "viewbtn", textContent: "Get a price" });
    const goBtn = el("button", { type: "button", className: "viewbtn gold", textContent: "Get my deposit address" });
    const cancel = el("button", { type: "button", className: "viewbtn", textContent: "Close" });
    cancel.addEventListener("click", close);
    let poll = null;
    const token = () => Intents.PAY_WITH[Number(tok.value)];
    const fmt = (q) => `${q.amountInFormatted} ${token().sym} (about $${Number(q.amountInUsd).toFixed(2)})`;
    priceBtn.addEventListener("click", async () => {
      err.textContent = ""; out.textContent = "Asking NEAR Intents for a price…";
      try { const q = await Intents.quote({ token: token(), nearOut: Number(amt.value), recipient: account, refundTo: refund.value.trim(), dry: true }); out.textContent = `${amt.value} NEAR will cost ${fmt(q)}, paid as ${token().label}. It lands in your account in about ${q.timeEstimate} seconds after your payment arrives.`; }
      catch (e) { out.textContent = ""; err.textContent = `No price right now: ${e.message}`; }
    });
    goBtn.addEventListener("click", async () => {
      err.textContent = "";
      if (!refund.value.trim()) return void (err.textContent = "Add your address on that chain, so a failed swap can be refunded.");
      goBtn.disabled = true; out.textContent = "Getting your one-time deposit address…";
      try {
        const q = await Intents.quote({ token: token(), nearOut: Number(amt.value), recipient: account, refundTo: refund.value.trim(), dry: false });
        const addr = q.depositAddress;
        out.replaceChildren(`Send exactly ${fmt(q)} to this address on ${token().label.split(" on ")[1] || token().label}:`, el("pre", { textContent: addr }), `It's yours for this swap only. ${amt.value} NEAR then lands in ${account} as wrapped NEAR, and you unwrap it here with one click.`);
        const st = el("p", { className: "fine", textContent: "Waiting for your payment…" });
        out.append(st);
        poll = setInterval(async () => {
          const s = await Intents.status(addr).catch(() => "UNKNOWN");
          st.textContent = { PENDING_DEPOSIT: "Waiting for your payment…", KNOWN_DEPOSIT_TX: "Payment seen, waiting for it to confirm…", PROCESSING: "Payment in. Swapping to NEAR…", SUCCESS: "Done. Your NEAR has arrived.", REFUNDED: "The swap didn't go through, so your payment was refunded.", FAILED: "The swap failed. NEAR Intents refunds failed swaps to your refund address.", INCOMPLETE_DEPOSIT: "Less than the quoted amount arrived. Send the rest, or wait for the refund." }[s] ?? `Status: ${s}`;
          if (s === "SUCCESS") {
            clearInterval(poll);
            const unwrap = el("button", { type: "button", className: "viewbtn gold", textContent: `Unwrap ${amt.value} NEAR` });
            unwrap.addEventListener("click", () => { close(); card({ title: "Unwrap your NEAR", words: () => `NEAR Intents delivered ${amt.value} NEAR as wrapped NEAR. This turns it back into NEAR in your account, ready to bless or found with.`, calls: () => [Intents.unwrapCall(BigInt(Math.round(Number(amt.value) * 1e6)) * 10n ** 18n)], after: async () => "Unwrapped. Your NEAR is ready." }); });
            out.append(unwrap);
          }
          if (s === "REFUNDED" || s === "FAILED") clearInterval(poll);
        }, 8000);
      } catch (e) { goBtn.disabled = false; out.textContent = ""; err.textContent = `Couldn't get an address: ${e.message}`; }
    });
    box.append(el("h3", { textContent: "Top up with any crypto" }), el("p", { className: "fine", textContent: "Through NEAR Intents: pay with USDC, ETH, SOL or BTC from their own chains, and NEAR lands in your account." }),
      el("div", { className: "fields" }, el("label", {}, "Pay with", tok), el("label", {}, "NEAR you want", amt), el("label", {}, "Refund address", refund)), out, err, el("div", { className: "row" }, priceBtn, goBtn, cancel));
    document.body.append(shade);
  }

  async function withdrawCard(clan, me) {
    const last = clan.gods.length === 1;
    const [st, cfg] = await Promise.all([wallet.view(WORLD, "get_stake", { clan_id: clan.id, account }).catch(() => null), wallet.view(WORLD, "get_config").catch(() => null)]);
    if (!st) return toast("Couldn't read your stake. Try again.");
    const pays = BigInt(st.near), out = last ? pays + BigInt(clan.staking_fund) : pays > 10n ** 22n ? pays - 10n ** 22n : 0n;
    card({
      title: "Claim your stake",
      words: () => `Your stake in ${clan.name} is ${fl(st.florins)} florins. At today's florin value they pay ${near(st.near)} NEAR. ${putInWords(clan, me, cfg, st).long} ` +
        "The 14% of every blessing that went to the jackpot stays there for the season's winner. " +
        (last
          ? `You are ${clan.name}'s last god, so claiming ends the nation: its citizens are gone and its island becomes ruins that other nations can absorb. You get about ${near(out)} NEAR, with the staking fund. This can't be undone.`
          : `You leave ${clan.name}'s gods with about ${near(out)} NEAR (the 0.01 NEAR bond that removes your DAO seat comes out of it). The nation goes on with its other gods.`),
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
      title: yes ? "Approve this proposal" : "Reject this proposal",
      words: () => `${p.description.replace(/^AD FONTES: /, "")}. Proposed by ${p.proposer}. Your ${yes ? "yes" : "no"} vote${yes ? " runs it straight away if it's the last one needed" : " counts against it"}.`,
      calls: () => [call],
      // Still open? (9 Nov: a vote on a proposal another god had just finished failed in the wallet.)
      before: async () => {
        const now = await wallet.view(clan.dao, "get_proposal", { id: p.id }).catch(() => null);
        if (now && now.status !== "InProgress") throw new Error(`This proposal was already decided (${now.status.toLowerCase()}), so there's nothing to vote on. Nothing was sent.`);
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
  return { section, wallet, openMenu, myNations };
}
