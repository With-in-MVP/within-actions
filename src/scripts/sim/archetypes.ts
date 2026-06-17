/**
 * Archetypes = the skewed population. Real user bases aren't uniform:
 * a handful of hot leads, some warm, mostly tire-kickers and non-leads.
 *
 * Each archetype defines the RANGES (mean/std) for its latent intent & fit.
 * Level 1 sampling picks an archetype (by weight); Level 2 draws this user's
 * specific intent/fit within that archetype's range.
 *
 * Note: tire_kicker has LOW intent but HIGH fit — a great firmographic match
 * who just won't convert. That's the whole reason fit != intent.
 */
import type { Archetype } from './types.js';

export const ARCHETYPES: Archetype[] = [
  { name: 'hot_lead', weight: 0.1, intentMean: 0.85, intentStd: 0.08, fitMean: 0.82, fitStd: 0.1 },
  { name: 'warm_lead', weight: 0.2, intentMean: 0.55, intentStd: 0.12, fitMean: 0.6, fitStd: 0.15 },
  { name: 'tire_kicker', weight: 0.4, intentMean: 0.22, intentStd: 0.1, fitMean: 0.7, fitStd: 0.15 },
  { name: 'non_lead', weight: 0.3, intentMean: 0.12, intentStd: 0.08, fitMean: 0.25, fitStd: 0.12 },
];
