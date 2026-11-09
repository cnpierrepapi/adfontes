import { setEnded } from "./says.js";
// Which world you're looking at (SPEC §12m B): testnet (practice, free test NEAR) or mainnet (real
// NEAR). ?net= in the address wins, then your last choice on this device, then testnet.
const q = new URLSearchParams(location.search).get("net");
export const NET = q === "mainnet" || q === "testnet" ? q : localStorage.getItem("adf-net") === "mainnet" ? "mainnet" : "testnet";
if (q === "mainnet" || q === "testnet") localStorage.setItem("adf-net", q);
/** GET /api/<path> for this world. */
// The season world (/timelapse/) sets globalThis.__adfApi to answer from the season data instead.
// The world's list of ended nations (10 Nov) goes to says.js, so every page rewords their names when
// it shows a sealed record (which is served exactly as sealed).
export const api = (p) => globalThis.__adfApi ? globalThis.__adfApi(p) : fetch(`/api/${p}${p.includes("?") ? "&" : "?"}net=${NET}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (p.startsWith("world") && Array.isArray(j?.ended)) setEnded(j.ended); return j; });
/** Switch worlds: remembered on this device, then the page reloads into the other one. */
export function switchNet(to) {
  localStorage.setItem("adf-net", to);
  const u = new URL(location.href);
  u.searchParams.set("net", to);
  location.href = u.toString();
}
