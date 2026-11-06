// The live world page. Reads the read-only API, and does the record check itself:
// it hashes the record in the browser, walks the proof path, and asks NEAR for the root.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};
const api = (p) => fetch(`/api/${p}`, { cache: "no-store" }).then((r) => r.json());
const n2 = (x) => (Math.round(x * 1000) / 1000).toString();

let W = null;
const clanName = (id) => W?.clans.find((c) => c.id === Number(id))?.name ?? `clan ${id}`;

// One line per record, in plain words.
function says(r) {
  const c = clanName;
  switch (r.kind) {
    case "corpus": return `${r.scholar} of ${c(r.clan)} wrote up "${r.point}" from ${r.cites} citations${r.fake ? `, ${r.fake} of them made up` : ""}.`;
    case "trade": return r.tool ? `${c(r.buyer)} bought a figure kit from ${c(r.seller)} for ${n2(r.price)} NEAR.` : `${c(r.buyer)} bought what ${c(r.seller)} knows about "${r.point}" for ${n2(r.price)} NEAR.`;
    case "gift": return `${c(r.clan)} gave its gods a draft: "${r.title}". The Warden says ${r.passed ? "clean" : "it has a problem"}.`;
    case "warden": return `The Warden caught a made-up citation in ${c(r.clan)}'s work. ${n2(r.bounty)} NEAR fine.`;
    case "trickster": return `A Trickster called ${r.name} moved into ${c(r.clan)}. Nobody was watching that clan.`;
    case "absorb": return `${c(r.clan)} reached "${r.via[0]}" and found ${r.points.length} point${r.points.length === 1 ? "" : "s"} of a dead clan's knowledge in the ruins.`;
    case "ruins": return `${c(r.clan)} died. Its ${r.points} points are ruins now, waiting to be found.`;
    case "upkeep": return `${c(r.clan)} paid ${n2(r.paid ?? r.amount)} NEAR to keep ${r.agents} agents fed.`;
    case "team": return `${c(r.clan)} gathered its first team.`;
    case "tool": return `${c(r.clan)}'s Smith made a figure kit.`;
    case "ruling": return `${c(r.clan)}'s gods ${r.status === "Rewarded" ? "rewarded" : r.status === "Punished" ? "punished" : "ignored"} a gift.`;
    case "sweep": return "The day's fees went to the treasury.";
    case "weather": return `Weather: NEAR ${n2(r.price)} in the week of ${r.week}.`;
    case "error": return `${c(r.clan)} had a bad day (a service didn't answer).`;
    default: return r.kind;
  }
}

async function loadWorld() {
  W = await api("world");
  const net = W.net === "mainnet" ? "NEAR mainnet" : "NEAR testnet, the practice world";
  $("where").textContent = `${W.season} · day ${W.day} · ${net}`;
  if (W.weather) {
    const w = W.weather;
    const mood = w.change > 0.1 ? "hot" : w.change < -0.05 ? "cold" : "mild";
    $("weather").className = `weather ${mood}`;
    $("weather").textContent = `${mood === "hot" ? "Hot week" : mood === "cold" ? "Cold week" : "Mild week"}: NEAR was $${w.price.toFixed(2)} (${w.change > 0 ? "+" : ""}${(w.change * 100).toFixed(1)}%) in the week of ${w.week}. ${mood === "hot" ? "Agents rush." : mood === "cold" ? "Agents slow down and get careful." : ""}`;
  }

  $("clans").replaceChildren(
    ...W.clans.map((c) =>
      el("article", { className: `clan${c.alive ? "" : " dead"}` },
        el("h3", { textContent: c.name }),
        el("p", { className: "meta", textContent: `${c.field ?? "?"} · ${c.mbti ?? ""} · ${c.gods} god${c.gods === 1 ? "" : "s"}${c.alive ? "" : " · gone"}` }),
        el("div", { className: "nums" },
          el("div", {}, String(c.points), el("small", { textContent: "points on its mindmap" })),
          el("div", {}, n2(c.play), el("small", { textContent: "NEAR to spend" })),
          el("div", {}, String(c.clean_gifts), el("small", { textContent: "clean gifts" })),
        ),
        el("p", { className: "line" }, el("b", { textContent: "Deepest line: " }), c.line.length ? c.line.join(" → ") : "nothing yet"),
        c.whisper ? el("p", { className: "line", textContent: `Its gods whisper: "${c.whisper}"` }) : "",
        el("p", { className: "line" }, el("a", { href: `https://${W.net === "mainnet" ? "" : "testnet."}nearblocks.io/address/${c.dao}`, target: "_blank", rel: "noopener", textContent: "its DAO on NEAR" })),
      ),
    ),
  );

  const feed = W.recent.slice().reverse();
  $("feed").replaceChildren(...(feed.length ? feed.map((r) => el("li", { className: r.kind }, el("span", { className: "k", textContent: r.kind }), says(r))) : [el("li", { className: "empty", textContent: "Quiet so far today." })]));

  $("pd").max = W.day;
  if (!$("pd").value) { $("pd").value = Math.max(1, W.day - 1); loadDay(); }
}

async function loadDrafts() {
  const ds = await api("drafts");
  $("drafts").replaceChildren(
    ...(ds.length
      ? ds.map((d) =>
          el("li", {},
            el("button", { onclick: () => showDraft(d.id) },
              `${d.title ?? d.id}`,
              el("span", { className: `tag ${d.passed ? "ok" : "bad"}`, textContent: d.passed ? "clean" : "caught" }),
              el("span", { className: "tag", textContent: `day ${d.day}, ${clanName(d.clan)}` }),
            ),
          ),
        )
      : [el("li", { className: "empty", textContent: "No drafts yet. A clan needs a line three steps deep before it can write one." })]),
  );
}

async function showDraft(id) {
  const d = await api(`draft?id=${encodeURIComponent(id)}`);
  const v = $("draft-view");
  if (d.error) return;
  const dr = d.draft;
  // Agent-made SVG is shown as an image: browsers never run scripts inside <img>.
  const fig = (f) => el("figure", {}, el("img", { src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(f.svg), alt: f.caption }), el("figcaption", { textContent: `${f.label}: ${f.caption}` }));
  v.replaceChildren(
    el("p", { className: "kicker dark", textContent: `draft ${d.id} · ${clanName(d.clan)} · day ${d.day}` }),
    el("h3", { textContent: dr.title }),
    el("p", { textContent: dr.abstract }),
    el("div", { className: "figs" }, ...dr.figures.map(fig)),
    el("h4", { textContent: "Claims" }),
    el("ol", {}, ...dr.claims.map((c) => el("li", { textContent: c.text }))),
    el("p", { className: d.passed ? "" : "problems", textContent: d.passed ? "The Warden checked every claim against the clan's line of knowledge and every number in the drawings against the text. Clean." : `The Warden caught: ${d.problems.join("; ")}` }),
  );
  v.hidden = false;
  v.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadDay() {
  const d = Number($("pd").value);
  if (!d) return;
  const day = await api(`day?d=${d}`);
  $("pi").replaceChildren(...day.records.map((r) => el("option", { value: r.i, textContent: `${r.i + 1}. ${says(r).slice(0, 70)}` })));
}

// ---- the check, done in this browser ----
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
async function rootOnNear(rpc, world, day) {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: world, method_name: "get_root", args_base64: btoa(JSON.stringify({ day })) } }),
  }).then((x) => x.json());
  return JSON.parse(String.fromCharCode(...r.result.result));
}

$("pd").addEventListener("change", loadDay);
$("prove-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = $("prove-out");
  out.textContent = "Checking…";
  const d = Number($("pd").value), i = Number($("pi").value);
  const p = await api(`proof?d=${d}&i=${i}`);
  if (p.error) return void (out.textContent = "That record doesn't exist.");
  // 1. hash the record here (the same way the engine did)
  const leaf = p.scheme === "original text" ? await sha256(p.raw) : await sha256(canon(p.record));
  // 2. climb the tree with the sibling hashes
  let h = leaf;
  for (const s of p.path) h = s.left ? await sha256(s.hash + h) : await sha256(h + s.hash);
  // 3. ask NEAR, directly, for that day's fingerprint
  const onchain = await rootOnNear(p.rpc, p.world, d);
  const ok = h === onchain;
  out.replaceChildren(
    el("div", { className: `verdict ${ok ? "yes" : "no"}`, textContent: ok ? `Matches NEAR. This is exactly what happened on day ${d}.` : "Doesn't match. This record isn't what was sealed that day." }),
    el("div", { textContent: `The record: ${says(p.record)}` }),
    el("div", { textContent: `Your browser got: ${h}` }),
    el("div", {}, `NEAR holds: ${onchain} (read from `, el("a", { href: `${p.explorer}/address/${p.world}`, target: "_blank", rel: "noopener", textContent: p.world }), ")"),
    el("div", { textContent: `${p.path.length} steps up the tree from this record to the day's fingerprint.` }),
  );
});

loadWorld().then(loadDrafts).catch(() => ($("where").textContent = "The world didn't answer. Try again in a minute."));
setInterval(() => loadWorld().catch(() => {}), 60_000);
