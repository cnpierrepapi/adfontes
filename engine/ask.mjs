// Ask the accused (PLAN_13NOV step 2, his call 12 Nov: asking comes FIRST). A god answers a report by asking
// the accused (a signed choice, kind "ask"); the accused answers in their own words, and only then can a stunt
// settle the report (reverence.mjs answerReport). A dead or stunted accused can't answer: silent, the stunt
// unlocks at once. Silence = today: a report nobody asks about lapses on its clock. Asking moves no faith.
// Tested in engine/test-ask.mjs.

/** Has the accused answered (or been unable to)? */
export const answered = (rep) => !!rep?.answer;

/** Mark open reports of nation `id` asked by this turn's ask choices. Returns 'asked' records. */
export function markAsked(s, choices, id, day) {
  const out = [];
  for (const ch of choices || []) {
    if (ch.kind !== "ask" || Number(ch.clan) !== id) continue;
    const rep = s.reports?.[ch.payload?.report];
    if (!rep || rep.clan !== id || rep.settled || rep.asked) continue;
    rep.asked = { by: ch.account, day };
    out.push({ kind: "asked", clan: id, report: rep.id, accused: rep.accused, god: ch.account });
  }
  return out;
}

/** Can the accused speak? Alive and not stunted on this day. */
export function canAnswer(agent, day) {
  return !!agent && agent.alive !== false && !((agent.stunted_until ?? 0) > day);
}

/** Answer every asked, unanswered, open report of nation `id`. reply({ accused, role, claim, kind, guilty })
 *  returns { says }. A failed reply leaves it unanswered for the next look. Returns records. */
export async function answerAsked(s, id, agents, day, reply) {
  const out = [];
  for (const rep of Object.values(s.reports || {})) {
    if (rep.clan !== id || rep.settled || !rep.asked || rep.answer) continue;
    const who = (agents || []).find((a) => a.name === rep.accused);
    if (!canAnswer(who, day)) {
      rep.answer = { says: null, silent: true, day };
      out.push({ kind: "answer", clan: id, report: rep.id, accused: rep.accused, silent: true, says: null });
      continue;
    }
    try {
      const r = await reply({ accused: rep.accused, role: who.role, claim: rep.claim, kind: rep.kind, guilty: !!rep.truth });
      const says = String(r?.says || "").replace(/\s+/g, " ").trim().slice(0, 220);
      if (!says) throw new Error("no words");
      rep.answer = { says, silent: false, day };
      out.push({ kind: "answer", clan: id, report: rep.id, accused: rep.accused, role: who.role, silent: false, says });
    } catch (e) {
      out.push({ kind: "error", clan: id, error: `ask: ${rep.accused} couldn't answer (${String(e.message || e).slice(0, 120)}); tried again next look` });
    }
  }
  return out;
}
