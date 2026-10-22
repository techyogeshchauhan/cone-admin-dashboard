// Share concurrent lookups and briefly cache successful responses. Mutation
// dependencies evict only affected namespaces; transient Firebase failures have
// bounded backoff while authentication/authorization refusals are never kept.
import { firebaseOutage } from "./firebase-errors.js";
const ttl = Number(process.env.API_CACHE_MS ?? 30000);
const caches = new Map<
  Map<string, { until: number; value: Promise<unknown> }>,
  string[]
>();
const statistics = { hits: 0, misses: 0, failures: 0, invalidations: 0 };
export const requestCacheStatistics = () => ({ ...statistics });

export function memo<T>(
  options: { max?: number; tags?: string[]; ttl?: number } = {},
) {
  const entries = new Map<string, { until: number; value: Promise<unknown> }>();
  caches.set(entries, options.tags ?? []);
  return (
    key: string,
    load: () => Promise<T>,
    // Some values must not outlive their own expiry (an ID token).
    expiresAt: (value: T) => number = () => Infinity,
  ): Promise<T> => {
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.until > now) {
      statistics.hits++;
      return hit.value as Promise<T>;
    }
    statistics.misses++;
    const value = Promise.resolve().then(load);
    const duration = options.ttl ?? ttl;
    if (duration <= 0) return value;
    const entry = { until: now + duration, value };
    entries.set(key, entry);
    value.then(
      (result) => {
        entry.until = Math.min(entry.until, expiresAt(result));
      },
      (error) => {
        statistics.failures++;
        // Share transient Firebase failures too; never cache auth/permission refusals.
        const kind = firebaseOutage(error)?.kind;
        if (kind === "quota" || kind === "network")
          entry.until = Date.now() + (kind === "quota" ? 60000 : 5000);
        else if (entries.get(key) === entry) entries.delete(key);
      },
    );
    if (entries.size > (options.max ?? 1000))
      for (const [k, e] of entries)
        if (e.until <= now || entries.size > (options.max ?? 1000))
          entries.delete(k);
    return value;
  };
}

export function clearRequestCaches(tags?: string[]) {
  for (const [entries, dependencies] of caches)
    if (!tags || dependencies.some((tag) => tags.includes(tag))) {
      entries.clear();
      statistics.invalidations++;
    }
}
