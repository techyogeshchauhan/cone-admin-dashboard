// Short-lived memory for lookups every dashboard request repeats (token
// verification, the caller's profile and role, runtime switches). Each one is
// a network round trip to Firebase, so a page that makes several requests at
// once would otherwise repeat them all. Concurrent callers share one pending
// lookup, failures are never kept, and any write through the API clears
// everything so access changes made in the dashboard apply immediately.
const ttl = Number(process.env.API_CACHE_MS ?? 30000);
const caches = new Set<
  Map<string, { until: number; value: Promise<unknown> }>
>();

export function memo<T>(options: { max?: number } = {}) {
  const entries = new Map<string, { until: number; value: Promise<unknown> }>();
  caches.add(entries);
  return (
    key: string,
    load: () => Promise<T>,
    // Some values must not outlive their own expiry (an ID token).
    expiresAt: (value: T) => number = () => Infinity,
  ): Promise<T> => {
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.until > now) return hit.value as Promise<T>;
    const value = load();
    if (ttl <= 0) return value;
    const entry = { until: now + ttl, value };
    entries.set(key, entry);
    value.then(
      (result) => {
        entry.until = Math.min(entry.until, expiresAt(result));
      },
      () => {
        if (entries.get(key) === entry) entries.delete(key);
      },
    );
    if (entries.size > (options.max ?? 1000))
      for (const [k, e] of entries)
        if (e.until <= now || entries.size > (options.max ?? 1000))
          entries.delete(k);
    return value;
  };
}

export function clearRequestCaches() {
  for (const entries of caches) entries.clear();
}
