/**
 * ProspectIdentity — one row per (vendor_id, email)
 * Holds the latest tier, ICP score, and scoring metadata.
 */

import { getSupabase } from './client.js';

export interface ProspectIdentity {
  id: string;
  vendor_id: string;
  email: string;
  domain: string;
  tier: number;
  icp_score: number;
  scopes: string[];
  scored_at: string;
  enrichment_status?: string;
  scoring_signals?: string[];
  created_at: string;
}

export async function findProspect(
  vendorId: string,
  email: string,
): Promise<ProspectIdentity | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('prospect_identities')
    .select('*')
    .eq('vendor_id', vendorId)
    .eq('email', email)
    .maybeSingle();
  return data as ProspectIdentity | null;
}

export async function upsertProspect(
  vendorId: string,
  email: string,
  fields: Partial<Omit<ProspectIdentity, 'id' | 'vendor_id' | 'email' | 'created_at'>>,
): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from('prospect_identities')
    .upsert(
      { vendor_id: vendorId, email, ...fields },
      { onConflict: 'vendor_id,email' },
    );
}
