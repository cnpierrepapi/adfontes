// Agent names: random first + last name, unique across the whole world (the contract refuses a
// taken name, dead or alive). The exclusion list blocks real famous names and anything silly.
const FIRST = [
  "Ada", "Bram", "Cleo", "Dara", "Elena", "Freya", "Goran", "Hana", "Ines", "Joaquin", "Klara", "Lior",
  "Mira", "Nikolai", "Otto", "Priya", "Quinn", "Rafa", "Sofia", "Tamsin", "Hugo", "Vera", "Wren", "Ximena",
  "Yusuf", "Zora", "Anouk", "Bodhi", "Celia", "Dagny", "Elio", "Farah", "Ilse", "Felix", "Leda", "Mateo",
  "Nora", "Oskar", "Petra", "Rumi", "Saoirse", "Tariq", "Uma", "Viggo", "Wilma", "Yara",
];
const LAST = [
  "Abernathy", "Brann", "Castell", "Duarte", "Engel", "Falk", "Grimaldi", "Holt", "Ibsen", "Jovanovic",
  "Kaur", "Lindqvist", "Moretti", "Nakamura", "Olsen", "Petrov", "Quiroga", "Rasmussen", "Sato",
  "Tanaka", "Ulloa", "Varga", "Wexler", "Xu", "Yilmaz", "Zamora", "Albrecht", "Bauer", "Conti", "Delacroix",
  "Esposito", "Fonseca", "Halloran", "Ishikawa", "Kowalski", "Moreau", "Novak", "Oyama", "Pereira", "Sørensen",
];
// Real, well-known people we don't want an NPC to impersonate.
const EXCLUDE = new Set(["Ada Lovelace", "Viggo Mortensen", "Rumi Balkhi", "Mateo Messi", "Hugo Boss", "Elena Ferrante", "Otto Wagner"]);

export function newName(taken) {
  for (let i = 0; i < 500; i++) {
    const n = `${FIRST[Math.floor(Math.random() * FIRST.length)]} ${LAST[Math.floor(Math.random() * LAST.length)]}`;
    if (!EXCLUDE.has(n) && !taken.has(n)) return n;
  }
  throw new Error("ran out of names");
}
