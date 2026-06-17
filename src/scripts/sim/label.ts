/**
 * Assign a conversion label from the latent variables.
 *
 *   score = W_INTENT*intent + W_FIT*fit + INTERCEPT + noise
 *   p     = sigmoid(score)        // unbounded score -> probability 0..1
 *   label = Bernoulli(p)          // probability -> actual yes/no (weighted coin)
 *
 * Bernoulli (not a threshold) keeps it stochastic: a p=0.8 user converts ~80%
 * of the time, not always. That fuzziness is the realistic accuracy ceiling.
 *
 * Tunable knobs:
 *   W_INTENT > W_FIT  -> intent matters more than firmographic fit
 *   INTERCEPT (more negative) -> rarer conversions (base-rate dial)
 *   NOISE_STD -> per-user randomness
 * Current defaults target a realistic overall conversion rate (~15-20%).
 */
import type { Rng } from './rng.js';
import type { SimUser } from './types.js';

const W_INTENT = 5.0;
const W_FIT = 1.2;
const INTERCEPT = -4.0;
const NOISE_STD = 0.4;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// Plan tiers: 0 = no conversion, 1 = base, 2 = pro, 3 = enterprise.
// Two-stage labeling:
//   Stage 1 — DOES this user convert?  sigmoid(score) -> Bernoulli (unchanged).
//   Stage 2 — IF so, WHICH plan?  higher intent/fit skews toward higher tiers.
export function labelUser(
  rng: Rng,
  user: SimUser,
): { converted: boolean; plan: number; p: number } {
  const score = W_INTENT * user.intent + W_FIT * user.fit + INTERCEPT + rng.gaussian(0, NOISE_STD);
  const p = sigmoid(score);
  const converted = rng.bool(p);

  let plan = 0;
  if (converted) {
    const value = Math.max(0, Math.min(1, 0.5 * user.intent + 0.5 * user.fit));
    // Weighted draw over base(1)/pro(2)/enterprise(3): low value favors base,
    // high value favors enterprise, pro is always plausible in the middle.
    plan = rng.weighted([1, 2, 3], [(1 - value) * 2 + 0.1, 1, value * 2 + 0.1]);
  }

  return { converted, plan, p };
}
