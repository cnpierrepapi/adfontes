// The email log-in for /play (27 Nov). The same log-in as the live world's (src/live/wallet.js, server.mjs
// loginPost): the passphrase never leaves this browser; PBKDF2 (600,000 rounds) turns it into a key that
// encrypts a NEAR key made here, and a token the server checks. The game only needs the token: every game
// call sends the email and the token (x-adf-email, x-adf-auth). Kept in this browser until you log out.
const SAVE = "adf-play-login";
const hexOf = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const bytesOf = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
async function derive(pass, saltHex) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: bytesOf(saltHex), iterations: 600000 }, base, 512));
  return { aes: await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]), auth: hexOf(bits.slice(32)) };
}
const postJ = (p, b) => fetch(`/api/login${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Couldn't reach the world. Try again."); return j; });

export const me = () => { try { return JSON.parse(localStorage.getItem(SAVE) || "null"); } catch { return null; } };
export const headers = () => { const m = me(); return m ? { "x-adf-email": m.email, "x-adf-auth": m.auth } : {}; };
export function logOut() { localStorage.removeItem(SAVE); }

/** Log in with an email that already has a log-in here (made on /play or on the live world). */
export async function logIn(email, pass) {
  email = email.trim().toLowerCase();
  const { salt } = await postJ("/salt", { email });
  const { auth } = await derive(pass, salt);
  await postJ("", { email, auth }); // the server says no for a wrong passphrase
  localStorage.setItem(SAVE, JSON.stringify({ email, auth }));
  return email;
}

/** Sign up: a NEAR key made in this browser (never funded by the game: the game plays with play NEAR), saved
 *  under your email, encrypted here, so the same log-in works on the live world too. */
export async function signUp(email, pass) {
  if (String(pass).length < 10) throw new Error("Use a passphrase of 10 characters or more.");
  email = email.trim().toLowerCase();
  const { KeyPair } = await import("@near-js/crypto");
  const kp = KeyPair.fromRandom("ed25519");
  const account = hexOf(kp.getPublicKey().data);
  const salt = hexOf(crypto.getRandomValues(new Uint8Array(16))), iv = crypto.getRandomValues(new Uint8Array(12));
  const { aes, auth } = await derive(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify({ account, key: kp.toString() }))));
  await postJ("/signup", { email, auth, salt, iv: hexOf(iv), ct: btoa(String.fromCharCode(...ct)), account });
  localStorage.setItem(SAVE, JSON.stringify({ email, auth }));
  return email;
}
