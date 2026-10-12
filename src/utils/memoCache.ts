// Small in-process TTL cache for expensive read-only aggregates (dashboards).
// Concurrent callers for the same key share one in-flight promise, so a burst of
// requests runs the underlying queries once. Failed loads are never cached.

interface Entry<T> {
  value?: T;
  expiresAt: number;
  pending?: Promise<T>;
}

const store = new Map<string, Entry<unknown>>();
const MAX_KEYS = 500;

export const memoize = async <T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> => {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit?.pending) return hit.pending;
  if (hit && hit.expiresAt > now && hit.value !== undefined) return hit.value;

  const pending = load()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((err) => {
      store.delete(key);
      throw err;
    });

  if (store.size >= MAX_KEYS) store.delete(store.keys().next().value as string);
  store.set(key, { ...hit, expiresAt: hit?.expiresAt ?? 0, pending });
  return pending;
};

/** Drops every cached key that starts with `prefix` (call after writes that change the numbers). */
export const invalidate = (prefix: string): void => {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
};
