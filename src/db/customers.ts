/**
 * Customer DB — answers "is this person a paying customer?"
 *
 * Table: customers
 * Unique: (vendor_id, domain) — with optional per-email seat lookup
 * Only active/trialing statuses count as "customer".
 */

import { getSupabase } from './client.js';

export interface Customer {
  id: string;
  vendor_id: string;
  email?: string;
  domain: string;
  status: 'active' | 'trialing' | 'churned' | 'cancelled';
  plan?: string;
  company_name?: string;
  created_at: string;
}

/**
 * Check if a user is a paying customer for a given vendor.
 * Lookup order: email exact match first → domain fallback.
 * Only active/trialing counts.
 */
export async function checkIfCustomer(
  vendorId: string,
  domain: string,
  email?: string,
): Promise<{ isCustomer: boolean; plan?: string; status?: string; companyName?: string }> {
  const supabase = getSupabase();

  // 1. Try email exact match first (if provided)
  if (email) {
    const { data: emailMatch } = await supabase
      .from('customers')
      .select('*')
      .eq('vendor_id', vendorId)
      .eq('email', email)
      .in('status', ['active', 'trialing'])
      .maybeSingle();

    if (emailMatch) {
      return {
        isCustomer: true,
        plan: emailMatch.plan,
        status: emailMatch.status,
        companyName: emailMatch.company_name,
      };
    }
  }

  // 2. Domain fallback
  const { data: domainMatch } = await supabase
    .from('customers')
    .select('*')
    .eq('vendor_id', vendorId)
    .eq('domain', domain)
    .in('status', ['active', 'trialing'])
    .limit(1)
    .maybeSingle();

  if (domainMatch) {
    return {
      isCustomer: true,
      plan: domainMatch.plan,
      status: domainMatch.status,
      companyName: domainMatch.company_name,
    };
  }

  return { isCustomer: false };
}
