// The section buttons under the header (judge page, marketplace): the one for the section you're
// reading lights up, and it scrolls into view in the button row on a phone.
export function sectionNav() {
  const links = [...document.querySelectorAll(".jump a")];
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
    const best = [...seen.entries()].filter(([, r]) => r > 0).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!best) return;
    for (const a of links) a.classList.toggle("on", a === byId.get(best));
    byId.get(best)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, { rootMargin: "-130px 0px -40% 0px", threshold: [0, 0.2, 0.5, 1] });
  for (const id of byId.keys()) { const s = document.getElementById(id); if (s) io.observe(s); }
}
