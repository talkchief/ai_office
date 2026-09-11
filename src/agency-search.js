// Ranked search over the Agency catalogue, shared by the server (GET /api/agency?q=) and the hire picker.
// Every word of the query has to match a whole word (or the start of one) somewhere in the persona; a match in the name
// or the persona's main role counts most, then tags, the role line and the division, and the description least. So
// "developer" lists the people whose job is writing code first, and a description that merely mentions developers last.
const WEIGHT = { name: 12, tags: 9, role: 5, label: 4, description: 2 };

// A light stemmer, so developer, developers, development and developing all search as "develop" (and designer as "design",
// tester and testing as "test"). A suffix only goes when four letters stay; "engineer" keeps its "er".
const stem = word => {
  let w = word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
  const cut = (suffix, keep = 4) => (w.endsWith(suffix) && w.length - suffix.length >= keep ? ((w = w.slice(0, -suffix.length)), true) : false);
  cut('ment') || cut('ing') || cut('ed');
  if (!w.endsWith('eer')) cut('er');
  return w;
};
const SYNONYMS = Object.fromEntries(Object.entries({ dev: 'developer', programmer: 'developer', coder: 'developer', swe: 'engineer', qa: 'tester', ux: 'designer', copywriter: 'writer', ml: 'ai', llm: 'ai', sre: 'reliability', pm: 'manager', hr: 'recruiting' }).map(([k, v]) => [stem(k), stem(v)]));
export const searchWords = text => String(text || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').split(/[^a-z0-9+#]+/).filter(Boolean).map(stem);

const cache = new WeakMap();
function fieldsOf(p) {
  let f = cache.get(p);
  if (!f) { f = { name: searchWords(p.name), tags: searchWords((p.tags || []).join(' ')), role: searchWords(p.role), label: searchWords(p.label), description: searchWords(p.description), main: searchWords((p.tags || [])[0])[0] || '' }; cache.set(p, f); }
  return f;
}
// 1 for a whole-word match, 0.6 for the start of a word (three letters or more), 0.5 when a long word is most of the query
// ("accountant" finds "accounting", stemmed to "account"), 0 for none.
const hit = (words, t) => (words.includes(t) ? 1 : t.length >= 3 && words.some(w => w.startsWith(t)) ? 0.6 : words.some(w => w.length >= 5 && w.length >= 0.7 * t.length && t.startsWith(w)) ? 0.5 : 0);

export function scorePersona(p, terms) {
  const f = fieldsOf(p); let score = 0;
  for (const t of terms) {
    // The best field counts in full and every other field a quarter, so repeating a word everywhere does not outrank a title.
    // The division only counts as the best field: "Game Development" must not lift every game developer above the rest.
    const alt = SYNONYMS[t], fields = Object.fromEntries(Object.keys(WEIGHT).map(k => [k, WEIGHT[k] * Math.max(hit(f[k], t), alt ? hit(f[k], alt) : 0)]));
    const best = Math.max(...Object.values(fields)); if (!best) return 0; // every word of the query has to match somewhere
    const rest = fields.name + fields.tags + fields.role + fields.description - (fields.label === best ? 0 : best);
    score += best + rest / 4 + (f.main && (f.main === t || f.main === alt) ? 14 : 0);
  }
  // The more of the title the query covers, the better the answer: "developer" puts "Android Developer" above
  // "Azure Identity .NET Developer".
  const covered = f.name.filter(w => terms.some(t => { const alt = SYNONYMS[t]; return w === t || w === alt || (t.length >= 3 && w.startsWith(t)); })).length;
  return score + (f.name.length ? 8 * covered / f.name.length : 0);
}

// Personas matching the query and division, best first (catalogue order without a query); on a tie the shorter title wins.
export function searchAgency(personas, { q = '', division = '' } = {}) {
  const terms = [...new Set(searchWords(q))], pool = division ? personas.filter(p => p.division === division) : personas;
  if (!terms.length) return pool.slice();
  const phrase = String(q).toLowerCase().trim();
  return pool.map(p => { const s = scorePersona(p, terms); return [s && s + (p.name.toLowerCase().includes(phrase) ? 10 : 0), p]; })
    .filter(([s]) => s > 0).sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name)).map(([, p]) => p);
}
