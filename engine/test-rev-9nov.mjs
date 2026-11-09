// His calls 9 Nov: blessings tire within a day, cap at 60, dust doesn't count; whispers are heard
// (judged against the nation) with no 60 cap. Each check fails if its rule is taken away.
process.env.ADF_REV_RULES ||= "new"; // these are the new rules' tests (live keeps the old ones for now)
const { REV, act, ensure } = await import("./reverence.mjs");

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const fresh = (r = 30) => ({ gods: { ann: { r, whispers: [], flourish: 0, enemies: [], justiceUntil: 0, faithLossUntil: 0 } }, waiting: false });

{ // dust: no reverence
  const rv = fresh(30), ch = [];
  act(rv, "ann", "bless", 5, ch, { near: 0.001 });
  ok(rv.gods.ann.r === 30, `a 0.001 NEAR blessing moves nothing (${rv.gods.ann.r})`);
}
{ // the k-th blessing in a day counts 1/k
  const rv = fresh(30), ch = [];
  act(rv, "ann", "bless", 5, ch, { near: 1 });
  const one = rv.gods.ann.r - 30;
  act(rv, "ann", "bless", 6, ch, { near: 1 });
  const two = rv.gods.ann.r - 30 - one;
  ok(Math.abs(one - REV.bless(1)) < 0.11 && Math.abs(two - REV.bless(1) / 2) < 0.11, `same day: first +${one.toFixed(1)}, second +${two.toFixed(1)} (half)`);
  act(rv, "ann", "bless", 6 + REV.blessWindow, ch, { near: 1 }); // a full window after the LAST blessing (day 6)
  ok(rv.gods.ann.r - 30 - one - two > REV.bless(1) * 0.9, "a new real day: full again");
}
{ // blessings cap at 60
  const rv = fresh(55), ch = [];
  act(rv, "ann", "bless", 5, ch, { near: 10 });
  ok(rv.gods.ann.r === 60, `blessings alone stop at 60 (${rv.gods.ann.r})`);
  const hi = fresh(80);
  act(hi, "ann", "bless", 5, ch, { near: 10 });
  ok(hi.gods.ann.r === 80, "a god already above 60 isn't pulled down by a blessing");
}
{ // heard whispers: no 60 cap, can lose, tire within the day
  const rv = fresh(58), ch = [];
  act(rv, "ann", "whisper", 5, ch, { text: "Hold the walls", heard: { delta: 20, verdict: "prophecy" } });
  ok(rv.gods.ann.r === 78, `a prophetic whisper lifts past 60 (${rv.gods.ann.r})`);
  act(rv, "ann", "whisper", 6, ch, { text: "again", heard: { delta: 20, verdict: "prophecy" } });
  ok(rv.gods.ann.r === 88, `the second whisper the same day counts half (${rv.gods.ann.r})`);
  const low = fresh(40);
  act(low, "ann", "whisper", 5, ch, { text: "Rest easy", heard: { delta: -10, verdict: "misread" } });
  ok(low.gods.ann.r === 30, `a whisper that misreads the nation costs reverence (${low.gods.ann.r})`);
  const big = fresh(40);
  act(big, "ann", "whisper", 5, ch, { text: "x", heard: { delta: 999, verdict: "prophecy" } });
  ok(big.gods.ann.r === 40 + REV.heardMax, `a judgement is held to +${REV.heardMax} (${big.gods.ann.r})`);
}
{ // no judgement: the old whisper rule (capped at 60)
  const rv = fresh(55), ch = [];
  act(rv, "ann", "whisper", 5, ch, { text: "hello" });
  ok(rv.gods.ann.r === 60, `an unheard whisper falls back to the old rule, capped at 60 (${rv.gods.ann.r})`);
}
{ // a god moved to a new account (move_god) keeps their reverence and isn't read as a new blessing
  const s = { rev: {} }, P = "5892820000000000000000000";
  const rv = ensure(s, { id: 6, gods: [{ account: "lost", put_in: P }] }, 1, { fresh: true });
  rv.gods.lost.r = 42; rv.followed = "lost"; rv.putIn.lost = P;
  ensure(s, { id: 6, gods: [{ account: "russet", put_in: P }] }, 9, { fresh: false });
  ok(rv.gods.russet?.r === 42 && !rv.gods.lost, `the moved god keeps reverence 42 (${rv.gods.russet?.r})`);
  ok(rv.followed === "russet", "the nation follows the new account");
  ok(rv.putIn.russet === P, "the blessing baseline moves too, so no fake blessing");
}
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
