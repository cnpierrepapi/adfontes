// Citizen chatter (PLAN_13NOV §6, his ask 13 Nov: "something happens every N seconds", 15 s): a small strip near the
// bottom where a citizen says one line about something that really happened (src/live/chatterlines.js). It fades by
// itself, never takes a click, and waits while someone is speaking in the dialogue box or the tab is hidden.
import { pick, EVERY_MS } from "./chatterlines.js";

export function createChatter({ busy, mine, name }) {
  const box = document.createElement("div");
  box.className = "chatter";
  box.hidden = true;
  box.style.pointerEvents = "none";
  document.body.append(box);
  const records = [], spoken = new Set();
  let hideT = 0;
  function show(l) {
    box.replaceChildren();
    const who = document.createElement("b"); who.textContent = l.who;
    const tag = document.createElement("small"); tag.textContent = [l.role, l.clan != null ? name(l.clan) : null].filter(Boolean).join(", ");
    const text = document.createElement("span"); text.textContent = l.text;
    box.append(who, tag, text);
    box.hidden = false;
    box.classList.remove("in"); void box.offsetWidth; box.classList.add("in");
    clearTimeout(hideT);
    hideT = setTimeout(() => { box.hidden = true; }, EVERY_MS - 4000);
  }
  setInterval(() => {
    if (document.hidden || busy()) return;
    const l = pick(records, spoken, mine(), name);
    if (!l) return;
    spoken.add(l.key);
    show(l);
  }, EVERY_MS);
  return { add(r) { records.push(r); if (records.length > 400) records.splice(0, records.length - 400); } };
}
