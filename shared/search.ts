// Server-side search without a search service: each searchable record keeps
// `searchKeys`, the prefixes of every word of its name, email and mobile, so
// one Firestore array-contains query finds it while someone is still typing.
const words = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    // Marks belong to their word: Devanagari vowel signs and virama are
    // marks, not letters ("रश्मि").
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
const shortest = 2,
  longest = 20;

export function searchKeys(...values: unknown[]) {
  const keys = new Set<string>();
  for (const word of values.flatMap(words))
    for (let n = shortest; n <= Math.min(word.length, longest); n++)
      keys.add(word.slice(0, n));
  return [...keys].sort();
}

// The words of a search box entry as key lookups ("ravi neg" → ravi, neg).
export function searchTerms(query: unknown) {
  return [
    ...new Set(
      words(query)
        .filter((w) => w.length >= shortest)
        .map((w) => w.slice(0, longest)),
    ),
  ];
}

export function matchesTerms(keys: unknown, terms: string[]) {
  return (
    Array.isArray(keys) && terms.every((term) => keys.includes(term as never))
  );
}

// Fields whose words a record is found by.
export const personSearchKeys = (person: {
  fullName?: unknown;
  email?: unknown;
  mobile?: unknown;
}) => searchKeys(person.fullName, person.email, person.mobile);
