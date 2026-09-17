// Deterministic shuffles (stable across renders and reloads) and arrow-based reordering.

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Permutation of `0..length-1` seeded by a string; never the identity when length ≥ 2. */
export function shuffledIndexes(length: number, seedText: string): number[] {
  const order = Array.from({ length }, (_, i) => i);
  const random = mulberry32(hashString(seedText));
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = order[i] as number;
    order[i] = order[j] as number;
    order[j] = tmp;
  }
  if (length >= 2 && order.every((value, index) => value === index)) order.push(order.shift() as number);
  return order;
}

/** Moves the item at `index` one step up (-1) or down (+1); out-of-range moves return a copy unchanged. */
export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const copy = [...items];
  const target = index + delta;
  if (index < 0 || index >= copy.length || target < 0 || target >= copy.length) return copy;
  const moved = copy[index] as T;
  copy[index] = copy[target] as T;
  copy[target] = moved;
  return copy;
}
