/**
 * UsageEvent — one row per metered tool call
 */

import { getSupabase } from './client.js';

export interface UsageEvent {
  id: string;
  vendor_id: string;
  email: string;
  domain: string;
  tool_name: string;
  outcome: 'success' | 'failure' | 'quota_exceeded' | 'scope_denied';
  agent_session_id?: string;
  latency_ms?: number;
  tool_arguments?: Record<string, unknown>;
  created_at: string;
}

export async function recordUsage(event: Omit<UsageEvent, 'id' | 'created_at'>): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('usage_events').insert(event);
}

export async function getUsageStats(
  vendorId: string,
  email: string,
): Promise<{ total: number; successes: number }> {
  const supabase = getSupabase();

  const { count: total } = await supabase
    .from('usage_events')
    .select('*', { count: 'exact', head: true })
    .eq('vendor_id', vendorId)
    .eq('email', email);

  const { count: successes } = await supabase
    .from('usage_events')
    .select('*', { count: 'exact', head: true })
    .eq('vendor_id', vendorId)
    .eq('email', email)
    .eq('outcome', 'success');

  return { total: total ?? 0, successes: successes ?? 0 };
}
