/**
 * Phase C — the cron POPULATION SIMULATOR.
 *
 * This is NOT "run the batch on a timer". It's a stateful roster that ticks on a
 * schedule and manages personas across their whole lifecycle, at HONEST real-time
 * timestamps (every usage_events row is written at real now()):
 *
 *   SPAWN   — birth a few new personas, run visit 1                 [WIRED]
 *   RETURN  — existing actives re-login and come back, P(return)     [STAGED]
 *   RESOLVE — finished journeys get judged + freed (Auth0 slot)      [STAGED]
 *
 * Reuses the Phase B machinery verbatim — personas.ts (traits), author.ts
 * (character), auth.ts (identity), session.ts/runVisit (behavior), judge.ts
 * (label). Cron only adds WHEN they run + STATE between runs (persona-state.ts).
 *
 * Run one tick:  npm run persona:cron -- --spawn 3
 * On a schedule: Render Cron Job invoking the same command (e.g. daily).
 */
import { getSupabase } from '../db/client.js';
import { getMgmtToken, ropgLogin, createUser, deleteUser } from './auth.js';
import { sampleDomain, sampleIntent } from './personas.js';
import { generatePersona } from './author.js';
import { runVisit } from './session.js';
import { judgeConversion, PLAN_TO_INT } from './judge.js';
import {
  insertPersona,
  listActive,
  recordVisit,
  resolvePersona,
  rehydratePersona,
  type PersonaStateRow,
} from './persona-state.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const VENDOR_ID = process.env.VENDOR_ID ?? 'test-vendor-real-estate';
const TAU_DAYS = 4; // return-probability decay constant: higher = personas linger longer
const MAX_VISITS = 4; // resolve after this many visits (journey has run its course)
const CHURN_DAYS = 14; // resolve as churned after this many idle days

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - Date.parse(iso)) / 86_400_000;
}

/**
 * P(return) — high intent returns sooner/more often; idle time decays the urge.
 * The mechanism that SPREADS activity across days instead of one burst.
 */
function pReturn(latentIntent: number, daysIdle: number): number {
  return latentIntent * Math.exp(-daysIdle / TAU_DAYS);
}

/** A journey is done when it's run its course or gone cold. */
function shouldResolve(p: PersonaStateRow): boolean {
  return p.visit_count >= MAX_VISITS || daysSince(p.last_visit_at) > CHURN_DAYS;
}

/** A neutral time cue for a return visit — a clock signal, not behavior shaping. */
function continuityPreamble(p: PersonaStateRow): string {
  const days = Math.round(daysSince(p.last_visit_at));
  return (
    `It's been about ${days} day(s) since you last looked at properties on this tool. ` +
    'Pick up naturally from where you left off — do whatever this person would do now.'
  );
}

// === SPAWN (wired) ===========================================================
/** Birth one persona: draw traits, write a character, provision, run visit 1, persist. */
async function spawn(supabase: SupabaseClient, mgmtToken: string): Promise<void> {
  const { domain } = sampleDomain();
  const intent = sampleIntent();
  const persona = await generatePersona(domain, intent);

  const { userId, email, password } = await createUser(domain, mgmtToken);
  const { accessToken, tier: tokenTier } = await ropgLogin(email, password);

  const since = new Date().toISOString();
  const visit = await runVisit(persona, email, accessToken, tokenTier, supabase, { since });

  await insertPersona(supabase, {
    vendorId: VENDOR_ID,
    email,
    auth0UserId: userId,
    password,
    domain,
    latentIntent: intent,
    brief: persona.brief,
    systemPrompt: persona.systemPrompt,
    toolCalls: visit.toolCalls,
    transcript: visit.transcript.join('\n'),
  });
  console.log(`  ✦ spawned ${email} (intent ${intent.toFixed(2)}) — ${visit.toolCalls} calls, stopped: ${visit.stoppedBy}`);
}

// === RETURN (staged — not yet called from onTick) ============================
/** Re-login an existing persona and run another visit with a continuity cue. */
async function returnVisit(supabase: SupabaseClient, p: PersonaStateRow): Promise<void> {
  const { accessToken, tier: tokenTier } = await ropgLogin(p.email, p.password);
  const since = new Date().toISOString();
  const visit = await runVisit(rehydratePersona(p), p.email, accessToken, tokenTier, supabase, {
    preamble: continuityPreamble(p),
    since,
  });
  await recordVisit(supabase, p, { toolCalls: visit.toolCalls, transcriptChunk: visit.transcript.join('\n') });
  console.log(`  ↩ returned ${p.email} (visit ${p.visit_count + 1}) — ${visit.toolCalls} calls`);
}

// === RESOLVE (staged — not yet called from onTick) ==========================
/** Judge the FULL multi-session journey, write the label, free the Auth0 slot. */
async function resolveOne(supabase: SupabaseClient, p: PersonaStateRow, mgmtToken: string): Promise<void> {
  const transcript = p.transcript || '(made no tool calls across the journey)';
  const judgment = await judgeConversion(p.brief, transcript);
  const converted = Math.random() < judgment.pConvert;
  const plan = converted ? Math.max(1, PLAN_TO_INT[judgment.plan] ?? 1) : 0;
  const nowIso = new Date().toISOString();
  await supabase.from('conversions').upsert(
    { vendor_id: VENDOR_ID, email: p.email, converted, plan, converted_at: converted ? nowIso : null },
    { onConflict: 'vendor_id,email' },
  );
  await supabase.from('sim_ground_truth').upsert(
    { vendor_id: VENDOR_ID, email: p.email, archetype: 'persona-cron', latent_intent: p.latent_intent, latent_fit: 0 },
    { onConflict: 'vendor_id,email' },
  );
  await resolvePersona(supabase, p, converted ? 'converted' : 'churned');
  try {
    await deleteUser(p.auth0_user_id, mgmtToken);
  } catch (e) {
    console.log(`  ⚠️ could not delete ${p.email}: ${(e as Error).message}`);
  }
  console.log(`  ✓ resolved ${p.email}: p=${judgment.pConvert.toFixed(2)} → ${converted ? `converted (plan ${plan})` : 'churned'}`);
}

// === THE TICK ===============================================================
async function onTick(): Promise<void> {
  const supabase = getSupabase();
  const mgmtToken = await getMgmtToken();
  const newPerTick = Number(arg('spawn') ?? 3);

  // 1. SPAWN — birth a few new personas (wired) -------------------------------
  console.log(`SPAWN: ${newPerTick} new persona(s)`);
  for (let i = 0; i < newPerTick; i++) {
    try {
      await spawn(supabase, mgmtToken);
    } catch (e) {
      console.error(`  💥 spawn failed: ${(e as Error).message}`);
    }
  }

  // 2. RETURN + 3. RESOLVE — STAGED. The helpers above are ready; once reviewed,
  //    flip these on to make the roster live. Sketch of the intended loop:
  //
  //    const actives = await listActive(supabase, VENDOR_ID);
  //    for (const p of actives) {
  //      if (shouldResolve(p)) { await resolveOne(supabase, p, mgmtToken); continue; }
  //      if (Math.random() < pReturn(p.latent_intent, daysSince(p.last_visit_at))) {
  //        await returnVisit(supabase, p);
  //      }
  //    }
  //
  // Suppress unused-symbol noise until the loop above is enabled:
  void listActive; void returnVisit; void resolveOne; void shouldResolve; void pReturn;

  console.log('\nRETURN + RESOLVE staged (spawn-only tick). Roster grows; nothing recycles yet.');
}

onTick()
  .then(() => console.log('tick complete'))
  .catch((e) => {
    console.error('💥 tick failed:', (e as Error).message);
    process.exit(1);
  });
