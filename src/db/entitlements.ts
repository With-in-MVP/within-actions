/**
 * Entitlement — per-user quota ledger
 * Unique: (vendor_id, email)
 *
 * quotaUsed lazily resets when the period rolls over.
 */

import { getSupabase } from './client.js';

export interface Entitlement {
  id: string;
  vendor_id: string;
  email: string;
  domain: string;
  tier: number;
  scopes: string[];
  quota_limit: number;
  quota_used: number;
  quota_reset_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LedgerResponse {
  email: string;
  domain: string;
  tier: number;
  scopes: string[];
  plan: string;
  quotaLimit: number;
  quotaUsed: number;
  quotaRemaining: number;
  isActive: boolean;
  quotaResetAt: string;
}

const TIER_QUOTA: Record<number, number> = {
  0: 0,
  1: 10,
  2: 50,
  3: 200,
  4: 500,
};

export async function getEntitlement(
  vendorId: string,
  email: string,
): Promise<LedgerResponse | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('entitlements')
    .select('*')
    .eq('vendor_id', vendorId)
    .eq('email', email)
    .maybeSingle();

  if (!data) return null;

  const ent = data as Entitlement;

  // Lazy quota reset: if the reset date has passed, reset the counter
  const now = new Date();
  const resetAt = new Date(ent.quota_reset_at);
  if (now > resetAt) {
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    await supabase
      .from('entitlements')
      .update({ quota_used: 0, quota_reset_at: nextReset, updated_at: now.toISOString() })
      .eq('id', ent.id);
    ent.quota_used = 0;
    ent.quota_reset_at = nextReset;
  }

  return {
    email: ent.email,
    domain: ent.domain,
    tier: ent.tier,
    scopes: ent.scopes,
    plan: `tier_${ent.tier}`,
    quotaLimit: ent.quota_limit,
    quotaUsed: ent.quota_used,
    quotaRemaining: Math.max(0, ent.quota_limit - ent.quota_used),
    isActive: ent.is_active,
    quotaResetAt: ent.quota_reset_at,
  };
}

export async function upsertEntitlement(
  vendorId: string,
  email: string,
  domain: string,
  tier: number,
  scopes: string[],
): Promise<void> {
  const supabase = getSupabase();
  const quotaLimit = TIER_QUOTA[tier] ?? 0;
  const nextReset = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString();

  await supabase
    .from('entitlements')
    .upsert(
      {
        vendor_id: vendorId,
        email,
        domain,
        tier,
        scopes,
        quota_limit: quotaLimit,
        quota_reset_at: nextReset,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'vendor_id,email' },
    );
}

export async function incrementUsage(
  vendorId: string,
  email: string,
): Promise<void> {
  const supabase = getSupabase();

  // Increment quota_used by 1
  const { data } = await supabase
    .from('entitlements')
    .select('id, quota_used')
    .eq('vendor_id', vendorId)
    .eq('email', email)
    .maybeSingle();

  if (data) {
    await supabase
      .from('entitlements')
      .update({ quota_used: data.quota_used + 1, updated_at: new Date().toISOString() })
      .eq('id', data.id);
  }
}
