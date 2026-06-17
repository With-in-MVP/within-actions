/**
 * Domain enrichment via Claude — extracts firmographic data from domain knowledge.
 * No external API calls. Claude infers company info from its training data.
 * Falls back gracefully for unknown domains.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getCachedEnrichment, upsertEnrichmentCache, type EnrichmentCache } from '../db/enrichment-cache.js';

const anthropic = new Anthropic();

export async function enrichDomain(domain: string): Promise<EnrichmentCache | null> {
  // Check cache first (7-day TTL handled by getCachedEnrichment)
  const cached = await getCachedEnrichment(domain);
  if (cached) return cached;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `What company uses the email domain "${domain}"? If you know this company, return JSON with the following fields. If you don't recognize this domain, return {"unknown": true}.

{
  "company_name": "string",
  "industry": "string (e.g. Real Estate, SaaS, Fintech, Healthcare)",
  "employee_range": "string (e.g. 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10000+)",
  "revenue_range": "string or null (e.g. $1M-$10M, $10M-$50M, $50M-$100M, $100M+)",
  "location": "string or null (e.g. New York, NY)"
}

Return ONLY the JSON object, no other text.`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = JSON.parse(text);

    if (parsed.unknown) return null;

    const entry: EnrichmentCache = {
      domain,
      company_name: parsed.company_name,
      industry: parsed.industry,
      employee_range: parsed.employee_range,
      revenue_range: parsed.revenue_range,
      location: parsed.location,
      enriched_at: new Date().toISOString(),
    };

    await upsertEnrichmentCache(entry);
    return entry;
  } catch (err) {
    console.error(`[enrichment] Failed to enrich ${domain}:`, err);
    return null;
  }
}
