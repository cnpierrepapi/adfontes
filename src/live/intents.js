// NEAR Intents (1Click): top up your NEAR account from any chain. Pick a token, get a live price,
// send to a one-time deposit address; 1Click swaps it and delivers wrapped NEAR to your account;
// one click unwraps it, then you bless or found as usual. Mainnet only (Intents runs on mainnet).
// API: https://1click.chaindefuser.com (CORS open; no key = a 0.2% fee).
const ONECLICK = "https://1click.chaindefuser.com/v0";
export const PAY_WITH = [
  { id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC on Base", sym: "USDC", dec: 6, chain: "base" },
  { id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", label: "USDC on Arbitrum", sym: "USDC", dec: 6, chain: "arb" },
  { id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", label: "USDC on Solana", sym: "USDC", dec: 6, chain: "sol" },
  { id: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", label: "USDC on Ethereum", sym: "USDC", dec: 6, chain: "eth" },
  { id: "nep141:eth.omft.near", label: "ETH on Ethereum", sym: "ETH", dec: 18, chain: "eth" },
  { id: "nep141:base.omft.near", label: "ETH on Base", sym: "ETH", dec: 18, chain: "base" },
  { id: "nep141:sol.omft.near", label: "SOL", sym: "SOL", dec: 9, chain: "sol" },
  { id: "nep141:btc.omft.near", label: "BTC", sym: "BTC", dec: 8, chain: "btc" },
];
const WNEAR = "nep141:wrap.near";

/** A 1Click quote for `nearOut` NEAR delivered to `recipient`. dry = price only, no deposit address. */
export async function quote({ token, nearOut, recipient, refundTo, dry }) {
  const amount = (BigInt(Math.round(nearOut * 1e6)) * 10n ** 18n).toString();
  const body = {
    dry, swapType: "EXACT_OUTPUT", slippageTolerance: 100, depositMode: "SIMPLE",
    originAsset: token.id, depositType: "ORIGIN_CHAIN", destinationAsset: WNEAR, amount,
    refundTo: refundTo || recipient, refundType: refundTo ? "ORIGIN_CHAIN" : "INTENTS",
    recipient, recipientType: "DESTINATION_CHAIN", deadline: new Date(Date.now() + 2 * 3600e3).toISOString(),
  };
  const r = await fetch(`${ONECLICK}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || !j.quote) throw new Error(j.message || j.error || `1Click said ${r.status}`);
  return j.quote;
}

/** Where a swap is: PENDING_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED, ... */
export async function status(depositAddress) {
  const j = await fetch(`${ONECLICK}/status?depositAddress=${encodeURIComponent(depositAddress)}`).then((r) => r.json());
  return j.status || "UNKNOWN";
}

/** The call that turns wrapped NEAR back into NEAR in your account (1 yocto attached, as wrap.near asks). */
export const unwrapCall = (yocto) => ({ receiver: "wrap.near", method: "near_withdraw", args: { amount: String(yocto) }, deposit: 1n, gas: 10n * 10n ** 12n, note: "Turns the wrapped NEAR that NEAR Intents delivered back into NEAR in your account." });

// The NEAR Intents top-up card (mainnet only). Moved out of the god panel 12 Nov: the game reads web2 and
// mainnet is closed, so nothing opens it now. Kept whole for when mainnet opens: intentsCard({ W, toast, account, el, card }).
export function intentsCard({ W, toast, account, el, card }) {
  if (W.net !== "mainnet") return toast("NEAR Intents runs on mainnet. On testnet, the found card tops you up from the sponsor pool.");
  if (!account) return toast("Become a god first: the NEAR goes to your account.");
  const box = el("div", { className: "txcard", role: "dialog" }), shade = el("div", { className: "txshade" }, box);
  const close = () => { clearInterval(poll); shade.remove(); };
  shade.addEventListener("pointerdown", (e) => { if (e.target === shade) close(); });
  const tok = el("select", { className: "txin" }, ...PAY_WITH.map((t, i) => el("option", { value: String(i), textContent: t.label })));
  const amt = el("input", { className: "txin", type: "number", min: "0.5", step: "0.5", value: "4" });
  const refund = el("input", { className: "txin", placeholder: "your address on that chain (for a refund if the swap fails)" });
  const out = el("p", { className: "words", textContent: "Pick what you pay with and how much NEAR you want. You'll see the price before anything moves." });
  const err = el("p", { className: "err" });
  const priceBtn = el("button", { type: "button", className: "viewbtn", textContent: "Get a price" });
  const goBtn = el("button", { type: "button", className: "viewbtn gold", textContent: "Get my deposit address" });
  const cancel = el("button", { type: "button", className: "viewbtn", textContent: "Close" });
  cancel.addEventListener("click", close);
  let poll = null;
  const token = () => PAY_WITH[Number(tok.value)];
  const fmt = (q) => `${q.amountInFormatted} ${token().sym} (about $${Number(q.amountInUsd).toFixed(2)})`;
  priceBtn.addEventListener("click", async () => {
    err.textContent = ""; out.textContent = "Asking NEAR Intents for a price…";
    try { const q = await quote({ token: token(), nearOut: Number(amt.value), recipient: account, refundTo: refund.value.trim(), dry: true }); out.textContent = `${amt.value} NEAR will cost ${fmt(q)}, paid as ${token().label}. It lands in your account in about ${q.timeEstimate} seconds after your payment arrives.`; }
    catch (e) { out.textContent = ""; err.textContent = `No price right now: ${e.message}`; }
  });
  goBtn.addEventListener("click", async () => {
    err.textContent = "";
    if (!refund.value.trim()) return void (err.textContent = "Add your address on that chain, so a failed swap can be refunded.");
    goBtn.disabled = true; out.textContent = "Getting your one-time deposit address…";
    try {
      const q = await quote({ token: token(), nearOut: Number(amt.value), recipient: account, refundTo: refund.value.trim(), dry: false });
      const addr = q.depositAddress;
      out.replaceChildren(`Send exactly ${fmt(q)} to this address on ${token().label.split(" on ")[1] || token().label}:`, el("pre", { textContent: addr }), `It's yours for this swap only. ${amt.value} NEAR then lands in ${account} as wrapped NEAR, and you unwrap it here with one click.`);
      const st = el("p", { className: "fine", textContent: "Waiting for your payment…" });
      out.append(st);
      poll = setInterval(async () => {
        const s = await status(addr).catch(() => "UNKNOWN");
        st.textContent = { PENDING_DEPOSIT: "Waiting for your payment…", KNOWN_DEPOSIT_TX: "Payment seen, waiting for it to confirm…", PROCESSING: "Payment in. Swapping to NEAR…", SUCCESS: "Done. Your NEAR has arrived.", REFUNDED: "The swap didn't go through, so your payment was refunded.", FAILED: "The swap failed. NEAR Intents refunds failed swaps to your refund address.", INCOMPLETE_DEPOSIT: "Less than the quoted amount arrived. Send the rest, or wait for the refund." }[s] ?? `Status: ${s}`;
        if (s === "SUCCESS") {
          clearInterval(poll);
          const unwrap = el("button", { type: "button", className: "viewbtn gold", textContent: `Unwrap ${amt.value} NEAR` });
          unwrap.addEventListener("click", () => { close(); card({ title: "Unwrap your NEAR", words: () => `NEAR Intents delivered ${amt.value} NEAR as wrapped NEAR. This turns it back into NEAR in your account, ready to bless or found with.`, calls: () => [unwrapCall(BigInt(Math.round(Number(amt.value) * 1e6)) * 10n ** 18n)], after: async () => "Unwrapped. Your NEAR is ready." }); });
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
