// What "Play with email" offers (13 Nov, his report: it signed into whatever key the browser held and gave no way to
// log into his own email account). Always Log in and Sign up; Continue only for the email this browser last used;
// a leftover key without an email only as a last, small choice. Tested in tests/email-entry.test.mjs.
export function entryOptions({ hasLocalKey, savedEmail }) {
  const out = [];
  if (hasLocalKey && savedEmail) out.push({ id: "continue", label: `Continue as ${savedEmail}` });
  out.push({ id: "login", label: "Log in with my email" }, { id: "signup", label: "Sign up" });
  if (hasLocalKey && !savedEmail) out.push({ id: "this-browser", label: "Keep playing with this browser's account" });
  return out;
}
