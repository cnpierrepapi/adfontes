// Agent names: random first + last name, unique across the whole world (the contract refuses a
// taken name, dead or alive). The exclusion list blocks real famous names and anything silly.
const FIRST = [
  "Ada", "Bram", "Cleo", "Dara", "Emeka", "Freya", "Goran", "Hana", "Ines", "Joaquin", "Kemi", "Lior",
  "Mira", "Nikolai", "Odo", "Priya", "Quinn", "Rafa", "Sade", "Tamsin", "Ugo", "Vera", "Wren", "Ximena",
  "Yusuf", "Zora", "Anouk", "Bodhi", "Chidi", "Dagny", "Elio", "Farah", "Ilse", "Kofi", "Leda", "Mateo",
  "Nneka", "Oskar", "Petra", "Rumi", "Saoirse", "Tariq", "Uma", "Viggo", "Wanjiru", "Yara",
];
const LAST = [
  "Achebe", "Brann", "Castell", "Duarte", "Eze", "Falk", "Grimaldi", "Holt", "Ibsen", "Jovanovic",
  "Kaur", "Lindqvist", "Mbeki", "Nakamura", "Okafor", "Petrov", "Quiroga", "Rasmussen", "Sato",
  "Tanaka", "Ulloa", "Varga", "Wexler", "Xu", "Yilmaz", "Zamora", "Adeyemi", "Bauer", "Conti", "Delacroix",
  "Esposito", "Fonseca", "Halloran", "Ishikawa", "Kowalski", "Moreau", "Novak", "Osei", "Pereira", "Sørensen",
];
// Real, well-known people we don't want an NPC to impersonate.
const EXCLUDE = new Set(["Ada Lovelace", "Chidi Anagonye", "Viggo Mortensen", "Rumi Balkhi", "Mateo Messi"]);

export function newName(taken) {
  for (let i = 0; i < 500; i++) {
    const n = `${FIRST[Math.floor(Math.random() * FIRST.length)]} ${LAST[Math.floor(Math.random() * LAST.length)]}`;
    if (!EXCLUDE.has(n) && !taken.has(n)) return n;
  }
  throw new Error("ran out of names");
}
