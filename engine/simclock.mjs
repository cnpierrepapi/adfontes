// The fast-forward simulation's clock (scripts/sim-week.mjs): with ADF_NOW set, the engine believes
// it is that moment, and time runs on from there. Imported first by engine/run.mjs; does nothing
// otherwise. Covers Date.now() and new Date() (the UTC day the Claude cap counts by, too).
if (process.env.ADF_NOW) {
  const t0 = Number(process.env.ADF_NOW), RealDate = Date, r0 = RealDate.now();
  class SimDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [SimDate.now()])); }
    static now() { return t0 + (RealDate.now() - r0); }
  }
  globalThis.Date = SimDate;
}
