/**
 * ICP Scoring — uses Claude to produce a 0-100 score from enrichment data.
 *
 * For now this is a placeholder that uses heuristics. The Claude-based scoring
 * agent will be wired in once the basic flow works end-to-end.
 */

import { getCachedEnrichment } from '../db/enrichment-cache.js';
import { isPersonalDomain } from '../enrichment/domain-lists.js';

export interface ScoringInput {
  email: string;
  domain: string;
  vendorId: string;
}

export interface ScoringResult {
  icpScore: number;
  signals: string[];
}

/**
 * Score a prospect. Returns 0-100 ICP score.
 *
 * Current implementation: heuristic scoring based on enrichment data.
 * Future: Claude-based scoring agent with vendor-specific ICP criteria.
 */
export async function scoreProspect(input: ScoringInput): Promise<ScoringResult> {
  const { email, domain } = input;
  let score = 0;
  const signals: string[] = [];

  // Personal email → low score
  if (isPersonalDomain(domain)) {
    return { icpScore: 5, signals: ['personal_email'] };
  }

  // Business email baseline
  score += 25;
  signals.push('business_email');

  // Check enrichment cache for firmographic signals
  const enrichment = await getCachedEnrichment(domain);

  if (enrichment) {
    signals.push('enriched');

    // Company size signal
    if (enrichment.employee_range) {
      const range = enrichment.employee_range;
      if (['51-200', '201-500', '501-1000'].includes(range)) {
        score += 20;
        signals.push('mid_market');
      } else if (['1001-5000', '5001-10000', '10000+'].includes(range)) {
        score += 30;
        signals.push('enterprise');
      } else {
        score += 10;
        signals.push('smb');
      }
    }

    // Industry signal (placeholder — vendor-specific ICP criteria will refine this)
    if (enrichment.industry) {
      score += 15;
      signals.push('known_industry');
    }
  } else {
    // No enrichment data — moderate score for business email
    score += 10;
    signals.push('no_enrichment');
  }

  // Clamp to 0-100
  const icpScore = Math.max(0, Math.min(100, score));

  return { icpScore, signals };
}
