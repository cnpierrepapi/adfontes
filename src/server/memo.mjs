// Memory limits for the web server (server.mjs). 15 Nov: the web service sat at 250-600 MB.
// Tested in tests/server-memory.test.mjs.

// API cache entries are { t, ms, v }. An entry nobody has asked for since it expired is dropped two
// minutes later. Busy keys refresh themselves and never get that old; a key with a refresh running is
// left alone. Before this, every key ever made (each star, each turn) stayed until the next deploy.
export function sweepExpired(cache, inflight, now = Date.now(), graceMs = 120_000) {
  let dropped = 0;
  for (const [key, e] of cache) {
    if (inflight.has(key)) continue;
    if (now - e.t > (e.ms ?? 0) + graceMs) { cache.delete(key); dropped++; }
  }
  return dropped;
}

// Static files held in memory (load test 8 Nov), now inside a byte budget. The game's own files are
// about 10 MB, plus their gzip copies; anything that would go past the budget is read from disk.
export function makeFileCache(budget = 32e6) {
  const files = new Map();
  let bytes = 0;
  const sizeOf = (f) => f.raw.length + (f.gz ? f.gz.length : 0);
  return {
    get(p, mtime) {
      const f = files.get(p);
      return f && f.mtime === mtime ? f : null;
    },
    put(p, f) {
      const old = files.get(p);
      if (old) { bytes -= sizeOf(old); files.delete(p); }
      if (bytes + sizeOf(f) > budget) return false;
      files.set(p, f);
      bytes += sizeOf(f);
      return true;
    },
    get bytes() { return bytes; },
    get size() { return files.size; },
  };
}

// public/_lab is the character lab's 132 MB of source textures. The lab page uses them under
// `vite dev`; no live page ever loads them, so the site never serves them.
export const hiddenPath = (pathname) => /^\/_lab(\/|$)/i.test(pathname);
