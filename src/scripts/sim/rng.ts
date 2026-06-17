/**
 * Seedable PRNG (mulberry32) + sampling helpers.
 * Seedable so runs are reproducible: same --seed => same population.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Normal draw via Box-Muller. */
  gaussian(mean: number, std: number): number;
  /** Bernoulli trial — true with probability p. */
  bool(p: number): boolean;
  /** Uniform pick from a list. */
  pick<T>(items: T[]): T;
  /** Weighted pick — items[i] chosen proportional to weights[i]. */
  weighted<T>(items: T[], weights: number[]): T;
}

export function makeRng(seed: number): Rng {
  let a = (seed >>> 0) || 1;

  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const float = (min: number, max: number): number => min + (max - min) * next();

  const int = (min: number, max: number): number => Math.floor(float(min, max + 1));

  const gaussian = (mean: number, std: number): number => {
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + n * std;
  };

  const bool = (p: number): boolean => next() < p;

  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)];

  const weighted = <T>(items: T[], weights: number[]): T => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  return { next, int, float, gaussian, bool, pick, weighted };
}
