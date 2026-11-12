// God names (his calls 12 Nov): every god in the game, human or AI, shows under a name taken from the gods
// of the world's cultures, worshipped today or not. We never say what a god is "god of": a name is a name.
// No account id ever shows in the game; the server assigns each account one name for good (god_names table).
// Left out on purpose: the names of the one God of the Abrahamic faiths and of prophets.

export const NAMES = [
  // Greek
  "Zeus", "Hera", "Athena", "Apollo", "Artemis", "Hermes", "Hestia", "Demeter", "Dionysus", "Poseidon", "Hades", "Persephone", "Hephaestus", "Aphrodite", "Ares", "Nyx", "Eos", "Helios", "Selene", "Gaia", "Rhea", "Kronos", "Hecate", "Iris", "Nike", "Pan", "Eris", "Tyche", "Nemesis", "Asclepius",
  // Roman and Etruscan
  "Jupiter", "Juno", "Minerva", "Janus", "Vesta", "Mars", "Venus", "Mercury", "Neptune", "Ceres", "Diana", "Fortuna", "Bellona", "Pomona", "Flora", "Saturn", "Vulcan", "Tinia", "Uni", "Menrva", "Turan",
  // Norse and Germanic
  "Odin", "Frigg", "Thor", "Freyja", "Freyr", "Tyr", "Loki", "Baldur", "Heimdall", "Idun", "Bragi", "Njord", "Skadi", "Sif", "Hel", "Ullr", "Forseti", "Eir", "Sol", "Mani", "Nerthus", "Wodan",
  // Celtic
  "Brigid", "Dagda", "Lugh", "Morrigan", "Danu", "Cernunnos", "Epona", "Belenus", "Taranis", "Nuada", "Ogma", "Aengus", "Manannan", "Rhiannon", "Arawn", "Ceridwen", "Sulis", "Toutatis",
  // Slavic and Baltic
  "Perun", "Veles", "Mokosh", "Svarog", "Dazhbog", "Stribog", "Lada", "Jarilo", "Marzanna", "Triglav", "Perkunas", "Laima", "Saule", "Dievas", "Zemyna", "Menulis",
  // Finnish, Sami, Estonian
  "Ukko", "Akka", "Tapio", "Ahti", "Ilmarinen", "Mielikki", "Tuoni", "Beaivi", "Taara",
  // Egyptian
  "Ra", "Isis", "Osiris", "Horus", "Anubis", "Thoth", "Bastet", "Sekhmet", "Hathor", "Ptah", "Amun", "Nut", "Geb", "Shu", "Tefnut", "Maat", "Sobek", "Khnum", "Neith", "Aten", "Khonsu", "Taweret", "Bes", "Wadjet", "Seshat",
  // Mesopotamian, Canaanite, Hittite
  "Inanna", "Ishtar", "Enki", "Enlil", "Anu", "Marduk", "Shamash", "Nanna", "Ninhursag", "Ereshkigal", "Tiamat", "Nabu", "Ninurta", "Dumuzi", "Baal", "Anat", "Asherah", "Dagon", "El Elyon", "Astarte", "Teshub", "Hebat", "Kumarbi", "Arinna",
  // Persian and Zoroastrian, Armenian, Georgian
  "Ahura Mazda", "Mithra", "Anahita", "Tishtrya", "Vayu", "Rashnu", "Aramazd", "Vahagn", "Astghik", "Tir", "Armazi",
  // Hindu
  "Shiva", "Vishnu", "Brahma", "Lakshmi", "Saraswati", "Parvati", "Durga", "Kali", "Ganesha", "Krishna", "Rama", "Hanuman", "Indra", "Agni", "Surya", "Varuna", "Yama", "Kartikeya", "Ganga", "Ushas", "Soma", "Kubera", "Annapurna", "Rati", "Kamadeva", "Aditi", "Bhumi", "Murugan", "Ayyappan", "Meenakshi",
  // Buddhist and Tibetan
  "Tara", "Avalokiteshvara", "Manjushri", "Vajrapani", "Mahakala", "Palden Lhamo", "Kshitigarbha", "Maitreya",
  // Chinese
  "Guanyin", "Nuwa", "Fuxi", "Pangu", "Mazu", "Guan Yu", "Caishen", "Chang'e", "Houyi", "Zhurong", "Gonggong", "Leigong", "Xiwangmu", "Shennong", "Erlang Shen", "Doumu", "Wenchang", "Yuelao", "Zao Jun", "Houtu",
  // Japanese (Shinto) and Ainu
  "Amaterasu", "Susanoo", "Tsukuyomi", "Izanagi", "Izanami", "Inari", "Hachiman", "Raijin", "Fujin", "Ebisu", "Benzaiten", "Daikokuten", "Kagutsuchi", "Ame-no-Uzume", "Kannon", "Kamuy Fuchi", "Okikurmi",
  // Korean, Mongolian, Turkic, Siberian
  "Hwanin", "Hwanung", "Dangun", "Mago", "Jowangsin", "Tengri", "Umay", "Ulgen", "Erlik", "Kayra", "Ay Ata", "Etugen", "Bai-Ulgan", "Ajysyt",
  // Southeast Asian and Pacific islands
  "Bathala", "Mayari", "Tala", "Apolaki", "Lakapati", "Dewi Sri", "Nang Thoranee", "Po Nagar", "Mae Phosop", "Hainuwele",
  // Polynesian, Hawaiian, Maori
  "Pele", "Kane", "Lono", "Ku", "Kanaloa", "Hina", "Maui", "Tangaroa", "Tane", "Rangi", "Papatuanuku", "Tawhirimatea", "Rongo", "Haumia", "Whiro", "Oro", "Tagaloa", "Laka", "Poliahu",
  // Aboriginal Australian
  "Baiame", "Bunjil", "Yhi", "Wuriupranili", "Bila", "Daramulun", "Gnowee", "Barraiya", "Waaq",
  // Yoruba and Orisha traditions
  "Ogun", "Shango", "Oshun", "Yemoja", "Obatala", "Oya", "Eshu", "Orunmila", "Olokun", "Osanyin", "Ochosi", "Babalu Aye", "Nana Buruku", "Ibeji", "Oko", "Aganju",
  // Akan, Igbo, Fon/Vodun, Bantu, Nilotic, East and North African
  "Nyame", "Asase Yaa", "Anansi", "Tano", "Bia", "Chukwu", "Ala", "Amadioha", "Ikenga", "Anyanwu", "Ekwensu", "Mawu", "Lisa", "Legba", "Dan", "Sakpata", "Gu", "Unkulunkulu", "Mbaba Mwana", "Nkosazana", "Mulungu", "Ngai", "Enkai", "Nhialic", "Kibuka", "Mukasa", "Wele", "Atete", "Tanit", "Amanai", "Ifri", "Gurzil",
  // Haitian Vodou and Caribbean
  "Erzulie", "Damballa", "Agwe", "Baron Samedi", "Ogou", "Ayizan", "Simbi", "Yemaya", "Atabey", "Yucahu", "Guabancex", "Maketaori",
  // Aztec and Mesoamerican
  "Quetzalcoatl", "Tezcatlipoca", "Huitzilopochtli", "Tlaloc", "Chalchiuhtlicue", "Xochiquetzal", "Mictlantecuhtli", "Coatlicue", "Tonatiuh", "Xipe Totec", "Mayahuel", "Tlazolteotl", "Itzpapalotl", "Xolotl", "Centeotl", "Ometeotl", "Coyolxauhqui",
  // Maya
  "Itzamna", "Ixchel", "Kukulkan", "Chaac", "Kinich Ahau", "Ah Puch", "Hunahpu", "Xbalanque", "Ixtab", "Hurakan", "Tepeu", "Gucumatz", "Bolon Tzacab",
  // Andean and South American
  "Inti", "Pachamama", "Viracocha", "Mama Quilla", "Illapa", "Pachacamac", "Supay", "Mama Cocha", "Kon", "Ngenechen", "Tupa", "Jaci", "Ruda", "Bochica", "Chie", "Bachue",
  // North American peoples
  "Wakan Tanka", "Inyan", "Wi", "Hanwi", "Wohpe", "Tate", "Sedna", "Nanook", "Tekkeitsertok", "Malina", "Anningan", "Kokopelli", "Tawa", "Spider Grandmother", "Changing Woman", "Estsanatlehi", "Glooscap", "Nanabozho", "Raven", "Kitchi Manitou", "Hahgwehdiyu", "Atahensic", "Gaoh", "Coyote", "Awonawilona",
  // Pre-Islamic Arabian and Nabataean
  "Hubal", "Al-Lat", "Manat", "Al-Uzza", "Dushara", "Wadd", "Almaqah", "Athtar",
  // Basque, Iberian, Thracian, Sami extras, Albanian
  "Mari", "Sugaar", "Ekhi", "Ataegina", "Endovelicus", "Zalmoxis", "Bendis", "Sabazios", "Perendi", "Prende",
  // New gods of today (his ask): named, never explained
  "Neon", "Wire", "Cipher", "Pixel", "Static", "Echo", "Signal", "Circuit", "Glimmer", "Velvet", "Ember", "Hush", "Fever", "Lumen", "Voltage", "Mirage", "Halo", "Riot", "Satin", "Nova",
];

/** Does this look like an account id (named "x.testnet"/"x.near" or 64-hex implicit)? Never shown in the game. */
export const isAccountLike = (s) => /^[0-9a-f]{64}$/.test(String(s)) || /^[a-z0-9_\-.]+\.(testnet|near)$/.test(String(s));

const ROMAN = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };

/** The name for an account: its first choice (a hash of the account into the pool), or the next free one.
 *  `taken`: Map or Set of names already given to OTHER accounts. Past the pool's end: "Odin II", "Odin III"... */
export function nameFor(account, taken = new Map()) {
  const has = (n) => (taken instanceof Map ? taken.has(n) : taken.has(n));
  const start = hashOf(account) % NAMES.length;
  for (const suffix of ["", ...ROMAN.map((r) => ` ${r}`)]) {
    for (let k = 0; k < NAMES.length; k++) {
      const n = NAMES[(start + k) % NAMES.length] + suffix;
      if (!has(n)) return n;
    }
  }
  return `${NAMES[start]} ${hashOf(account + "x") % 1000}`;
}
