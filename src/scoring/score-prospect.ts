/**
 * ICP Scoring — uses Claude to produce a 0-100 score from enrichment data.
 *
 * Personal emails short-circuit to score 25 (tier 1).
 * Business emails get enriched (domain → company info via Claude) then scored
 * by Claude against the vendor's ideal customer profile.
 */

import Anthropic from '@anthropic-ai/sdk';
import { isPersonalDomain } from '../enrichment/domain-lists.js';
import { enrichDomain } from '../enrichment/enrich-domain.js';

const anthropic = new Anthropic();

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
 * Pipeline: personal email check → domain enrichment → Claude scoring.
 */
export async function scoreProspect(input: ScoringInput): Promise<ScoringResult> {
  const { domain, vendorId } = input;

  // Personal email — skip enrichment, floor score
  if (isPersonalDomain(domain)) {
    return { icpScore: 25, signals: ['personal_email'] };
  }

  // Enrich the domain (cached, 7-day TTL)
  const enrichment = await enrichDomain(domain);

  if (!enrichment) {
    // Unknown domain — business email but no company info
    return { icpScore: 30, signals: ['business_email', 'unknown_domain'] };
  }

  // Score with Claude
  try {
    const companyProfile = [
      `Company: ${enrichment.company_name}`,
      `Domain: ${domain}`,
      `Industry: ${enrichment.industry}`,
      `Employees: ${enrichment.employee_range}`,
      enrichment.revenue_range ? `Revenue: ${enrichment.revenue_range}` : null,
      enrichment.location ? `Location: ${enrichment.location}` : null,
    ].filter(Boolean).join('\n');

    // TODO: load vendor-specific ICP criteria from database
    const vendorContext = getVendorContext(vendorId);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `You are scoring a prospect for "${vendorContext.name}".

${vendorContext.description}

Ideal customers: ${vendorContext.idealCustomer}

Prospect's company:
${companyProfile}

Score this prospect 0-100 on how well they fit the vendor's ideal customer profile. Consider industry relevance, company size, and likely use case.

Return ONLY a JSON object:
{"score": number, "reasoning": "one sentence"}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = JSON.parse(text);
    const icpScore = Math.max(0, Math.min(100, parsed.score));

    return {
      icpScore,
      signals: ['business_email', 'enriched', 'claude_scored', parsed.reasoning],
    };
  } catch (err) {
    console.error(`[scoring] Claude scoring failed for ${domain}:`, err);
    // Fall back to basic enrichment-based score
    return { icpScore: 35, signals: ['business_email', 'enriched', 'scoring_fallback'] };
  }
}

/**
 * Vendor context for scoring prompts.
 * TODO: move to database so vendors can configure their own ICP criteria.
 */
function getVendorContext(vendorId: string): { name: string; description: string; idealCustomer: string } {
  const vendors: Record<string, { name: string; description: string; idealCustomer: string }> = {
    'test-vendor-real-estate': {
      name: 'Real Estate MCP',
      description: 'A property data tool that provides property search, lookups, and market analytics for real estate professionals.',
      idealCustomer: 'Real estate brokerages, property management firms, commercial real estate companies, real estate tech platforms, and investment firms.',
    },
  };

  return vendors[vendorId] ?? {
    name: vendorId,
    description: 'A software tool.',
    idealCustomer: 'Businesses that would benefit from this tool.',
  };
}
