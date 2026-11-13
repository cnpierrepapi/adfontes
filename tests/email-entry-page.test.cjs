// Play with email, clicked through in a real browser (13 Nov): a browser holding a leftover key, or last used with an
// email, must get Log in / Sign up (and Continue), never a silent sign-in.   node tests/email-entry-page.test.cjs [baseUrl]
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  let bad = 0; const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) bad++; };
  for (const [label, saved] of [["leftover key, no email", null], ["last used with an email", "chuks@example.com"]]) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 810 } });
    await ctx.addInitScript((em) => { localStorage.setItem("adf-cinema-seen", "1"); localStorage.setItem("adf-tutorial-done", "1"); localStorage.setItem("adf-quality", "low");
      localStorage.setItem("adf-local-key-testnet", JSON.stringify({ account: "leftover-browser-123.adf-pool1-hf0w8.testnet", key: "ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8tnFQuwoGUC51DowKqorvkr2pytJSnwuSbsNVfqygr", sponsored: null }));
      if (em) localStorage.setItem("adf-local-key-testnet-email", em); }, saved);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(`${process.argv[2] || "https://adfontes.fun"}/live/`, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__live?.quality, null, { timeout: 120000 });
    await p.waitForTimeout(4000);
    await p.evaluate(() => document.querySelector(".chip.wallet")?.click());
    await p.waitForTimeout(1500);
    await p.evaluate(() => [...document.querySelectorAll(".walletpick")].find((x) => /Play with email/.test(x.textContent))?.click());
    await p.waitForTimeout(1500);
    const page1 = await p.evaluate(() => document.querySelector(".godmenu, .menu, [class*=menu]:not([hidden])")?.innerText || document.body.innerText);
    const signedIn = await p.evaluate(() => document.querySelector(".chip.wallet")?.textContent);
    console.log(`\n[${label}] chip: ${signedIn?.trim()} | page: ${page1.replace(/\s+/g, " ").slice(0, 160)}`);
    ok(!/leftover/.test(signedIn || "") && /Become a god/.test(signedIn || ""), `${label}: not signed in silently`);
    ok(/Log in with my email/.test(page1) && /Sign up/.test(page1), `${label}: Log in and Sign up are offered`);
    if (saved) ok(page1.includes(`Continue as ${saved}`), `${label}: Continue as the email is offered`);
    await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => /Log in with my email/.test(x.textContent))?.click());
    await p.waitForTimeout(800);
    const page2 = await p.evaluate(() => document.body.innerText);
    ok(/Welcome back/.test(page2) && /Passphrase/.test(page2), `${label}: Log in opens the email and passphrase form`);
    if (label.startsWith("leftover")) await p.screenshot({ path: "stills/email-login.png" });
    ok(errs.length === 0, `${label}: no page errors`);
    await ctx.close();
  }
  await b.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
})();
