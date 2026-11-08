// The god panel (SPEC §12j). A wallet chip in the HUD, "Your powers" in each nation's panel, and a
// confirm card that shows the exact transaction before your wallet ever opens. Every deposit is read
// live from the chain (get_config, the DAO's policy), never hard-coded.
import { createWallet, toYocto, near, failure, TGAS } from "./wallet.js";
import * as C from "./calls.js";
import { api } from "../net.js";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
const short = (a) => (a.length > 22 ? `${a.slice(0, 10)}…${a.slice(-9)}` : a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Florins (SPEC §14): 1 florin = 10^22 units on chain.
const fl = (u) => (Number(BigInt(u || 0) / 10n ** 16n) / 1e6).toFixed(1);
// What a god put in, in plain words (SPEC §14). The contract keeps only what counts toward the
// stake; a nation's founder also paid the founding costs (the DAO deposit and the staking fund,
// from the world's config), so they see the whole amount and where it went. The founder is the
// first god in the list (a founder who left hands that place on, so this is the usual case).
function putInWords(clan, me, cfg, st) {
  const put = BigInt(st.put_in), pct = put ? Math.round((Number(BigInt(st.near)) / Number(put)) * 100) : 0;
  const founder = clan.gods[0]?.account === me.account && cfg;
  if (!founder) return { short: `${pct}% of the ${near(put)} NEAR you put in`, long: `You put in ${near(put)} NEAR, so that's ${pct}% of it.` };
  const costs = BigInt(cfg.dao_deposit) + BigInt(cfg.staking_deposit), whole = put + costs;
  return {
    short: `founded with ${near(whole)} NEAR: ${near(costs)} went to founding costs, your stake started at ${near(put)} (now ${pct}%)`,
    long: `You founded ${clan.name} with about ${near(whole)} NEAR. ${near(costs)} of that went to founding costs (the nation's DAO and its staking fund), so your stake started at ${near(put)} NEAR, and today it's ${pct}% of that.`,
  };
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
          try { await wallet.signIn(w.id); menu.hidden = true; } catch (e) { toast(`${w.name}: ${e.message || "could not connect"}`); }
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
    const tx = el("div", { className: "tx" });
    const sign = el("button", { type: "button", className: "viewbtn gold", textContent: "Sign in your wallet" });
    const cancel = el("button", { type: "button", className: "viewbtn", textContent: "Cancel" });
    cancel.addEventListener("click", close);
    const fields = el("div", { className: "fields" }, ...(spec.fields || []));
    box.append(el("h3", { textContent: spec.title }), words, fields, el("p", { className: "fine", textContent: "What your wallet will be asked to sign:" }), tx, err, el("div", { className: "row" }, sign, cancel));
    let calls = [];
    function redraw() {
      words.textContent = spec.words();
      const bad = spec.check?.() ?? null;
      err.textContent = bad ?? "";
      sign.disabled = !!bad || !account;
      tx.replaceChildren();
      if (bad) return;
      try { calls = spec.calls(); } catch (e) { err.textContent = e.message; sign.disabled = true; return; }
      calls.forEach((c, i) => {
        const shown = c.show ?? c.args;
        tx.append(el("dl", {},
          calls.length > 1 ? el("dt", { textContent: `Transaction ${i + 1} of ${calls.length}` }) : null,
          el("dd", { className: "note", textContent: c.note ?? "" }),
          el("dt", { textContent: "Contract" }), el("dd", { textContent: c.receiver }),
          el("dt", { textContent: "Method" }), el("dd", { textContent: c.method }),
          el("dt", { textContent: "Arguments" }), el("dd", {}, el("pre", { textContent: JSON.stringify(shown, null, 1) })),
          el("dt", { textContent: "NEAR attached" }), el("dd", { textContent: `${near(c.deposit)} NEAR` }),
          el("dt", { textContent: "Gas" }), el("dd", { textContent: `${BigInt(c.gas) / TGAS} Tgas (unused gas is refunded)` }),
        ));
      });
    }
    for (const f of spec.fields || []) f.addEventListener("input", redraw);
    sign.addEventListener("click", async () => {
      sign.disabled = cancel.disabled = true;
      err.textContent = "";
      sign.textContent = "Waiting for your wallet…";
      try {
        const outs = await wallet.send(calls);
        const bad = outs.map(failure).find(Boolean);
        if (bad) throw new Error(`NEAR refused it: ${bad}`);
        const hashes = outs.map((o) => o?.transaction?.hash).filter(Boolean);
        sign.textContent = "Done";
        const msg = (await spec.after?.(outs)) ?? "Done.";
        box.replaceChildren(el("h3", { textContent: spec.title }), el("p", { className: "words", textContent: msg }),
          ...hashes.map((h) => el("p", { className: "fine" }, el("a", { href: `${wallet.explorer}/txns/${h}`, target: "_blank", rel: "noopener", textContent: `See it on NearBlocks: ${h.slice(0, 10)}…` }))),
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

  // ---------------------------------------------------------------- the powers
  function foundCard() {
    Promise.all([wallet.view(WORLD, "get_config"), wallet.balance(account).catch(() => null), W.net === "testnet" ? api("sponsor").catch(() => null) : null]).then(([cfg, bal, sp]) => {
      const name = input({ placeholder: "Name your nation", maxLength: 40 });
      // Testnet: put in everything you have (less 0.15 for gas), since 5.5 of the minimum makes the DAO
      // and a nation founded at the bare minimum has almost nothing left to spend.
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
        words: () => `You found "${name.value.trim() || "…"}" and become its first god. ${near(cfg.dao_deposit)} NEAR makes its DAO, ${near(cfg.staking_deposit)} NEAR goes to its staking fund and a little pays for storage. The rest is the nation's money: 86% for its citizens to spend, 14% kept in reserve.`,
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
          const want = name.value.trim();
          live.refresh?.(want);
          route?.founded(want); // your island, confetti, "You are a god", the neighbours' welcome
          return `${want} is founded. Its island rises into the world in a moment, and its first citizens arrive within seconds.`;
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
      const info = await api(`clan?id=${c.id}`).catch(() => null);
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
          const put = Number(BigInt(st.put_in) / 10n ** 18n), got = Number(BigInt(st.near) / 10n ** 18n);
          const pct = put ? Math.round((got / put) * 100) : 0;
          stakeBox.replaceChildren(el("small", { textContent: "Your stake" }), el("b", { textContent: `${fl(st.florins)} florins` }),
            el("span", { className: pct >= 100 ? "up" : "down", textContent: `${near(st.near)} NEAR if you claim today` }),
            el("span", { className: "fine", textContent: putInWords(clan, me, cfg, st).short }));
        }).catch(() => stakeBox.remove());
      }
      const grid = el("div", { className: "views" });
      const power = (label, fn, cls = "") => { const b = el("button", { type: "button", className: `viewbtn ${cls}`, textContent: label }); b.addEventListener("click", fn); grid.append(b); };
      power(me ? "Bless again" : "Bless this nation", () => blessCard(clan, !me), "gold");
      if (me) {
        if (!seats.includes(account)) power("Take your DAO seat", () => joinCard(clan, policy));
        else {
          power("Whisper", () => whisperCard(clan));
          power("Smite a citizen", () => smiteCard(clan));
          power("Root it out", () => rootCard(clan));
          if (BigInt(clan.staking_fund) > 0n) power("Release staking fund", () => stakingCard(clan));
        }
        power("Claim your stake", () => withdrawCard(clan, me));
      }
      box.append(grid, rev);
      if (clan.whisper) box.append(el("p", { className: "fine" }, "The gods' last whisper: ", el("i", { textContent: `"${clan.whisper}"` })));
      // Drafts to rule on (own, within 24h). Drafts can't be claimed any more (SPEC §14).
      if (me) {
        const g = await api(`gifts?id=${c.id}`).catch(() => ({ gifts: [] }));
        if (my !== token) return;
        const now = g.now_ms ?? Date.now();
        const toRule = (g.gifts || []).filter((x) => x.clan === c.id && x.status === "Pending" && now < x.ends_ms);
        if (seats.includes(account)) for (const x of toRule) {
          const hrs = Math.max(1, Math.round((x.ends_ms - now) / 3600000));
          const row = el("div", { className: "gift" }, el("span", { textContent: `Gift #${x.id}: ${x.title ?? "a draft"} (${x.passed ? "the Warden passed it" : "the Warden failed it"}, ${hrs}h left to rule)` }));
          const b = el("button", { type: "button", className: "viewbtn", textContent: "Rule on it" });
          b.addEventListener("click", () => ruleCard(clan, x));
          row.append(b);
          box.append(row);
        }
      }
      // Open proposals: nations with more than one god vote on each power (and a lone god can finish
      // a proposal whose vote they didn't sign).
      if (policy) {
        const last = await wallet.view(c.dao, "get_last_proposal_id").catch(() => 0);
        const props = last ? await wallet.view(c.dao, "get_proposals", { from_index: Math.max(0, last - 15), limit: 15 }).catch(() => []) : [];
        if (my !== token) return;
        const period = BigInt(policy.proposal_period);
        const nowNs = BigInt(Date.now()) * 1_000_000n;
        const open = props.filter((p) => p.status === "InProgress" && BigInt(p.submission_time) + period > nowNs && p.kind.FunctionCall?.receiver_id === WORLD).reverse();
        if (open.length) box.append(el("h4", { textContent: "Open proposals" }));
        for (const p of open) {
          const yes = Object.values(p.votes || {}).filter((v) => v === "Approve").length;
          const need = C.needed(seats.length, 0);
          const row = el("div", { className: "gift" }, el("span", { textContent: `${p.description.replace(/^AD FONTES: /, "")} · by ${short(p.proposer)} · ${yes} of ${need} yes votes` }));
          if (seats.includes(account) && !p.votes?.[account]) {
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
      words: () => `Your NEAR goes into ${clan.name}: 86% for its citizens to spend, 14% kept in reserve.${isNew ? " You become one of its gods with a seat in its DAO. 0.01 NEAR of it pays the DAO seat bond and a little pays for storage." : ""} You can take your share back out at any time.`,
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
  async function whisperCard(clan) {
    const p = await prepDao(clan);
    const text = el("textarea", { className: "txin", maxLength: 280, rows: 3, placeholder: "e.g. Take fewer risks this season. Honesty first." });
    card({
      title: "Whisper",
      fields: [label("Your whisper (280 characters at most)", text)],
      words: () => `Your citizens read the gods' whisper every turn and lean their choices toward it: how much risk to take, how honest to be, what to focus on. It goes to ${clan.name}'s DAO as a proposal with your yes vote.`,
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
  async function stakingCard(clan) {
    const p = await prepDao(clan);
    const to = input({ placeholder: "the staking account, e.g. pool.poolv1.near" });
    card({
      title: "Release the staking fund",
      fields: [label("Send it to", to)],
      words: () => `${near(clan.staking_fund)} NEAR set aside for ${clan.name}'s staking goes to ${to.value.trim() || "the account you name"}. Check the account: NEAR sent to the wrong one can't be pulled back. It goes to the DAO as a proposal with your yes vote.`,
      check: () => (/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(to.value.trim()) && to.value.trim().length >= 2 ? null : "Name a NEAR account."),
      calls: () => p.build("release_staking", { clan_id: clan.id, to: to.value.trim() }, `AD FONTES: release ${clan.name}'s staking fund to ${to.value.trim()}`).calls,
      after: async (outs) => {
        const r = await daoResult(clan, C.returned(outs[0]));
        if (!r.passed) return waiting(r.left);
        live.fx.play({ kind: "staking", clan: clan.id, text: `${clan.name}'s staking fund went to ${to.value.trim()}` });
        return `Released: ${near(clan.staking_fund)} NEAR sent to ${to.value.trim()}.`;
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
      after: async () => {
        const r = yes ? await daoResult(clan, p.id) : { passed: false };
        if (!r.passed) return yes ? waiting(r.left) : "Your no vote is in.";
        if (method === "smite" || (method === "rule" && !args.reward)) live.smite(clan.id, args.agent, args.verdict);
        live.fx.play({ kind: method === "whisper" ? "whisper" : method === "release_staking" ? "staking" : "ruling", clan: clan.id, text: method === "whisper" ? `The gods whisper: "${args.text}"` : `The gods voted: ${p.description.replace(/^AD FONTES: /, "")}` });
        return "It passed and ran.";
      },
    });
  }

  return { section, wallet, openMenu };
}
