const MAX_RESULTS = 8;

/**
 * Case, accents, spaces and punctuation stripped, so "m31" finds "M 31",
 * "bootes" finds "Boötes" and "3c273" finds "3C 273". Signs and dots survive:
 * they separate the numbers in catalogue designations like "J1340.6+4018".
 */
const normalise = (text) => String(text ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9+\-.]/g, '');

const keysCache = new WeakMap();

function keysOf(entry) {
  let keys = keysCache.get(entry);
  if (!keys) {
    keys = {
      label: normalise(entry.label),
      ids: [entry.mainId, entry.name, ...(entry.ids ?? [])].filter(Boolean).map(normalise)
    };
    keysCache.set(entry, keys);
  }
  return keys;
}

function score(entry, query) {
  const { label, ids } = keysOf(entry);
  if (label.startsWith(query)) return 4;
  if (ids.some((id) => id.startsWith(query))) return 3;
  if (label.includes(query)) return 2;
  if (ids.some((id) => id.includes(query))) return 1;
  return 0;
}

/** Best matches first: how well the name matches, then prominence, then brevity. */
export function searchEntries(entries, rawQuery, limit = MAX_RESULTS) {
  const query = normalise(rawQuery);
  if (!query) return [];

  const hits = [];
  for (const entry of entries) {
    const s = score(entry, query);
    if (s > 0) hits.push({ entry, s });
  }
  hits.sort((a, b) =>
    b.s - a.s || (b.entry.weight ?? 0) - (a.entry.weight ?? 0) || a.entry.label.length - b.entry.label.length);
  return hits.slice(0, limit).map((hit) => hit.entry);
}
