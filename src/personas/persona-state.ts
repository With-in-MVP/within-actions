/**
 * The persona roster — the one piece cron adds that Phase B didn't need: STATE
 * BETWEEN TICKS. A persona is born once (spawn), comes back on later ticks
 * (return), and is judged + freed at the end (resolve). These helpers are the
 * only thing that touches the `persona_state` table (migration 007).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GeneratedPersona } from './author.js';

export interface PersonaStateRow {
  id: string;
  vendor_id: string;
  email: string;
  auth0_user_id: string;
  password: string;
  domain: string;
  latent_intent: number;
  brief: string;
  system_prompt: string;
  status: 'active' | 'converted' | 'churned';
  visit_count: number;
  total_tool_calls: number;
  transcript: string;
  spawned_at: string;
  last_visit_at: string | null;
  resolved_at: string | null;
}

const TABLE = 'persona_state';

/** Persist a freshly-spawned persona after its first visit. */
export async function insertPersona(
  supabase: SupabaseClient,
  row: {
    vendorId: string;
    email: string;
    auth0UserId: string;
    password: string;
    domain: string;
    latentIntent: number;
    brief: string;
    systemPrompt: string;
    toolCalls: number;
    transcript: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from(TABLE).insert({
    vendor_id: row.vendorId,
    email: row.email,
    auth0_user_id: row.auth0UserId,
    password: row.password,
    domain: row.domain,
    latent_intent: row.latentIntent,
    brief: row.brief,
    system_prompt: row.systemPrompt,
    status: 'active',
    visit_count: 1,
    total_tool_calls: row.toolCalls,
    transcript: row.transcript,
    last_visit_at: now,
  });
  if (error) throw new Error(`insertPersona: ${error.message}`);
}

/** The active roster for a vendor — the candidates for return/resolve each tick. */
export async function listActive(supabase: SupabaseClient, vendorId: string): Promise<PersonaStateRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('vendor_id', vendorId)
    .eq('status', 'active');
  if (error) throw new Error(`listActive: ${error.message}`);
  return (data ?? []) as PersonaStateRow[];
}

/** Record a return visit: bump counters, append the new transcript, stamp last_visit_at. */
export async function recordVisit(
  supabase: SupabaseClient,
  p: PersonaStateRow,
  visit: { toolCalls: number; transcriptChunk: string },
): Promise<void> {
  const sep = p.transcript ? '\n--- next visit ---\n' : '';
  const { error } = await supabase
    .from(TABLE)
    .update({
      visit_count: p.visit_count + 1,
      total_tool_calls: p.total_tool_calls + visit.toolCalls,
      transcript: p.transcript + sep + visit.transcriptChunk,
      last_visit_at: new Date().toISOString(),
    })
    .eq('id', p.id);
  if (error) throw new Error(`recordVisit: ${error.message}`);
}

/** Close out a finished journey (converted or churned) and free its Auth0 slot upstream. */
export async function resolvePersona(
  supabase: SupabaseClient,
  p: PersonaStateRow,
  status: 'converted' | 'churned',
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', p.id);
  if (error) throw new Error(`resolvePersona: ${error.message}`);
}

/** Rebuild the in-memory persona the actor needs from a stored row (no author call). */
export function rehydratePersona(p: PersonaStateRow): GeneratedPersona {
  return {
    domain: p.domain,
    latentIntent: p.latent_intent,
    brief: p.brief,
    systemPrompt: p.system_prompt,
  };
}
