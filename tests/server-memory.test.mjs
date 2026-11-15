// Web server memory (15 Nov: the web service sat at 250-600 MB). Checks the three fixes in
// src/server/memo.mjs: expired API cache entries get swept, the file cache keeps to a byte budget,
// and the lab textures (public/_lab) are never served. Exits non-zero on any failure.
import assert from "node:assert/strict";
import { sweepExpired, makeFileCache, hiddenPath } from "../src/server/memo.mjs";

let failed = 0;
const t = (name, fn) => { try { fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n ", e.message); } };

t("sweep drops an entry two minutes past its expiry", () => {
  const cache = new Map([["old", { t: 0, ms: 5_000, v: 1 }]]);
  assert.equal(sweepExpired(cache, new Map(), 5_000 + 120_001), 1);
  assert.equal(cache.has("old"), false);
});
t("sweep keeps an entry still inside its grace", () => {
  const cache = new Map([["warm", { t: 0, ms: 5_000, v: 1 }]]);
  assert.equal(sweepExpired(cache, new Map(), 5_000 + 119_000), 0);
  assert.equal(cache.has("warm"), true);
});
t("sweep keeps an entry whose refresh is running", () => {
  const cache = new Map([["busy", { t: 0, ms: 5_000, v: 1 }]]);
  sweepExpired(cache, new Map([["busy", Promise.resolve()]]), 10_000_000);
  assert.equal(cache.has("busy"), true);
});
t("sweep reads each entry's own lifetime (a 5 min entry outlives a 5 s one)", () => {
  const cache = new Map([["short", { t: 0, ms: 5_000, v: 1 }], ["long", { t: 0, ms: 300_000, v: 1 }]]);
  sweepExpired(cache, new Map(), 200_000);
  assert.deepEqual([...cache.keys()], ["long"]);
});

const file = (n, gz = 0) => ({ raw: Buffer.alloc(n), gz: gz ? Buffer.alloc(gz) : null, mtime: 1 });
t("file cache stores files while they fit the budget", () => {
  const fc = makeFileCache(100);
  assert.equal(fc.put("/a", file(40, 10)), true);
  assert.equal(fc.put("/b", file(40)), true);
  assert.equal(fc.bytes, 90);
});
t("file cache refuses a file that would go over the budget", () => {
  const fc = makeFileCache(100);
  fc.put("/a", file(80));
  assert.equal(fc.put("/b", file(30)), false);
  assert.equal(fc.get("/b", 1), null);
  assert.equal(fc.bytes, 80);
});
t("file cache counts a replaced file once", () => {
  const fc = makeFileCache(100);
  fc.put("/a", file(60));
  assert.equal(fc.put("/a", { ...file(70), mtime: 2 }), true);
  assert.equal(fc.bytes, 70);
  assert.equal(fc.size, 1);
});
t("file cache misses when the file changed on disk", () => {
  const fc = makeFileCache(100);
  fc.put("/a", file(10));
  assert.equal(fc.get("/a", 1)?.raw.length, 10);
  assert.equal(fc.get("/a", 2), null);
});
t("the default budget holds every game file (9.8 MB raw + gzip)", () => {
  const fc = makeFileCache();
  assert.equal(fc.put("/game", file(9.8e6, 3e6)), true);
});

t("lab paths are hidden", () => {
  for (const p of ["/_lab", "/_lab/", "/_lab/outfits/T_Peasant_Normal.png", "/_LAB/x.png"]) assert.equal(hiddenPath(p), true, p);
});
t("game paths are not hidden", () => {
  for (const p of ["/", "/live/index.html", "/citizens/kit.glb", "/assets/_lab.js", "/lab/citizens.html"]) assert.equal(hiddenPath(p), false, p);
});

console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
