import { setEnded, setNames } from "./says.js";
// Which world you're looking at (SPEC §12m B): testnet (practice, free test NEAR) or mainnet (real
// NEAR). ?net= in the address wins, then your last choice on this device, then testnet.
const q = new URLSearchParams(location.search).get("net");
// Mainnet's first world was retired on 10 Nov 2026; until the current contract opens there after the
// hackathon, every page stays on testnet whatever the address or a past choice says.
export const MAINNET_OPEN = false;
export const NET = !MAINNET_OPEN ? "testnet" : q === "mainnet" || q === "testnet" ? q : localStorage.getItem("adf-net") === "mainnet" ? "mainnet" : "testnet";
if (q === "mainnet" || q === "testnet") localStorage.setItem("adf-net", q);
/** GET /api/<path> for this world. */
// The season world (/timelapse/) sets globalThis.__adfApi to answer from the season data instead.
// The world's list of ended nations (10 Nov: ids and names) goes to says.js, so a sealed record about
// one of them still reads exactly as it was written.
// Gods' names (12 Nov) go to says.js the same way, on every path (the sandbox answers through __adfApi).
const seen = (p, j) => { if (p.startsWith("world") && Array.isArray(j?.ended)) setEnded(j.ended); if (p.startsWith("world") && j?.names) setNames(j.names); return j; };
export const api = (p) => Promise.resolve(globalThis.__adfApi ? globalThis.__adfApi(p) : fetch(`/api/${p}${p.includes("?") ? "&" : "?"}net=${NET}`, { cache: "no-store" }).then((r) => r.json())).then((j) => seen(p, j));
/** Switch worlds: remembered on this device, then the page reloads into the other one. */
export function switchNet(to) {
  localStorage.setItem("adf-net", to);
  const u = new URL(location.href);
  u.searchParams.set("net", to);
  location.href = u.toString();
}
