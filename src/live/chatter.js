// Citizen chatter (PLAN_13NOV §6, his asks 13 Nov): every 15 seconds a citizen speaks through the dialogue box, face
// and all, about something that really happened (src/live/chatterlines.js). A line about one of your nations asks
// something of you (a button: whisper back, bless them); left alone, it closes by itself before the next one. It
// waits while someone is already speaking, and while the tab is hidden.
import { pick, EVERY_MS, AUTO_CLOSE_MS } from "./chatterlines.js";

export function createChatter({ say, busy, mine, name, actionsFor }) {
  const records = [], spoken = new Set();
  setInterval(() => {
    if (document.hidden || busy()) return;
    const l = pick(records, spoken, mine(), name);
    if (!l) return;
    spoken.add(l.key);
    say({ key: `chat:${l.key}`, name: l.who, role: l.role, nation: l.clan != null ? name(l.clan) : null, text: l.text, actions: actionsFor(l), auto: AUTO_CLOSE_MS });
  }, EVERY_MS);
  return { add(r) { records.push(r); if (records.length > 400) records.splice(0, records.length - 400); } };
}
