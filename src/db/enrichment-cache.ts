/**
 * EnrichmentCache — domain-keyed firmographic cache with 7-day TTL
 */

import { getSupabase } from './client.js';

export interface EnrichmentCache {
  domain: string;
  company_name?: string;
  industry?: string;
  employee_range?: string;
  revenue_range?: string;
  location?: string;
  enriched_at: string;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function getCachedEnrichment(domain: string): Promise<EnrichmentCache | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('enrichment_cache')
    .select('*')
    .eq('domain', domain)
    .maybeSingle();

  if (!data) return null;

  // Check TTL
  const enrichedAt = new Date(data.enriched_at).getTime();
  if (Date.now() - enrichedAt > TTL_MS) return null;

  return data as EnrichmentCache;
}

export async function upsertEnrichmentCache(entry: EnrichmentCache): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from('enrichment_cache')
    .upsert(entry, { onConflict: 'domain' });
}
