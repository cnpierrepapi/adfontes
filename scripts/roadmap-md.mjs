// Writes ROADMAP.md from public/roadmap.json, the same file the /roadmap page reads, so the two
// never drift. The page adds live checks against NEAR; the file can't, so it says where to see them.
//   node scripts/roadmap-md.mjs
import fs from "node:fs";
const R = JSON.parse(fs.readFileSync("public/roadmap.json", "utf8"));
const lines = [
  "# AD FONTES roadmap",
  "",
  `Last edited ${R.updated}. The live version, where each item is checked against NEAR when you open it, is at https://adfontes.fun/roadmap/ (linked from the judge page). This file is written from the same list by \`scripts/roadmap-md.mjs\`.`,
  "",
];
for (const g of R.groups) {
  lines.push(`## ${g.title}`, "", g.intro, "");
  for (const it of R.items.filter((x) => x.group === g.id)) lines.push(`- **${it.title}.** ${it.text}`);
  lines.push("");
}
fs.writeFileSync("ROADMAP.md", lines.join("\n"));
console.log(`ROADMAP.md: ${R.items.length} items in ${R.groups.length} groups`);
