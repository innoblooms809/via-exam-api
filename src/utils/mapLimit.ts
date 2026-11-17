/**
 * Runs `fn` over `items`, at most `limit` at a time, results in the items' order. For work
 * that is several queries per item (an exam's roster): all at once would queue far more
 * queries than the connection pool holds and slow every other request down.
 */
export const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
  return out;
};
