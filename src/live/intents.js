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
