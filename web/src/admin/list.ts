/** Pure, immutable list helpers used by the ListEditor and the sections. */

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Move the item at `from` to position `to` (clamped). Returns a new array. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (from < 0 || from >= arr.length) return out;
  const target = clamp(to, 0, arr.length - 1);
  if (target === from) return out;
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item as T);
  return out;
}

/** Insert `item` at `index` (clamped to 0..length). Returns a new array. */
export function insertItem<T>(arr: readonly T[], index: number, item: T): T[] {
  const out = arr.slice();
  out.splice(clamp(index, 0, arr.length), 0, item);
  return out;
}

/** Remove the item at `index`. Out-of-range indexes return an unchanged copy. */
export function removeItem<T>(arr: readonly T[], index: number): T[] {
  if (index < 0 || index >= arr.length) return arr.slice();
  return arr.slice(0, index).concat(arr.slice(index + 1));
}

/** Replace the item at `index`. Out-of-range indexes return an unchanged copy. */
export function replaceItem<T>(arr: readonly T[], index: number, item: T): T[] {
  if (index < 0 || index >= arr.length) return arr.slice();
  const out = arr.slice();
  out[index] = item;
  return out;
}

/**
 * Keep a parallel array of stable React keys in step with a list whose length
 * changed from outside (e.g. a history version was loaded). Existing keys stay,
 * missing ones are appended with `next()`, extra ones are dropped.
 */
export function syncKeys(keys: readonly number[], length: number, next: () => number): number[] {
  if (keys.length === length) return keys.slice();
  if (keys.length > length) return keys.slice(0, length);
  const out = keys.slice();
  while (out.length < length) out.push(next());
  return out;
}

/** Stable order for timeline frames: by date, then by original index (same rule as the site). */
export function dateOrder<T extends { date: string }>(items: readonly T[]): number[] {
  return items
    .map((item, i) => ({ d: item.date, i }))
    .sort((a, b) => (a.d === b.d ? a.i - b.i : a.d < b.d ? -1 : 1))
    .map((x) => x.i);
}
