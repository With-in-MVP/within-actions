/**
 * Synthetic prospect simulator (Step 1).
 *
 * Populates the DB with mock users + labels + realistic usage-event timelines
 * under vendor_id='sim-vendor' so the ML read/train pipeline (Step 2) has data
 * to consume. NOT random — structured signal with realistic variation.
 *
 * Usage:
 *   npm run simulate -- --users 300 --seed 42     # generate 300 users
 *   npm run simulate -- --reset                   # wipe all sim-vendor rows
 *   npm run simulate -- --reset --users 300       # wipe, then regenerate
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.
 * Run sql/003-create-conversions.sql first (creates conversions + sim_ground_truth).
 */
import { getSupabase } from '../db/client.js';
import { ARCHETYPES } from './sim/archetypes.js';
import { generateTimeline } from './sim/generate-timeline.js';
import { generateUser } from './sim/generate-user.js';
import { labelUser } from './sim/label.js';
import { makeRng } from './sim/rng.js';

const VENDOR = 'sim-vendor';
// All sim-vendor-tagged tables; ordered so child rows are deleted before parents.
const SIM_TABLES = ['usage_events', 'conversions', 'sim_ground_truth', 'prospect_identities'];

interface Args {
  users: number;
  seed: number;
  reset: boolean;
}

function parseArgs(argv: string[]): Args {
  let users = 200;
  let seed = 1;
  let reset = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--users') users = Number(argv[++i]);
    else if (a === '--seed') seed = Number(argv[++i]);
    else if (a === '--reset') reset = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!Number.isFinite(users) || users < 0) throw new Error('--users must be a non-negative number');
  if (!Number.isFinite(seed)) throw new Error('--seed must be a number');
  return { users, seed, reset };
}

async function resetSimData(): Promise<void> {
  const sb = getSupabase();
  for (const table of SIM_TABLES) {
    const { error } = await sb.from(table).delete().eq('vendor_id', VENDOR);
    if (error) throw new Error(`reset ${table}: ${error.message}`);
  }
  console.log(`[reset] cleared vendor_id='${VENDOR}' rows from ${SIM_TABLES.length} tables`);
}

async function chunkWrite(
  table: string,
  rows: Record<string, unknown>[],
  mode: { upsert: string } | { insert: true },
  chunk = 500,
): Promise<void> {
  const sb = getSupabase();
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } =
      'upsert' in mode
        ? await sb.from(table).upsert(slice, { onConflict: mode.upsert })
        : await sb.from(table).insert(slice);
    if (error) throw new Error(`write ${table}: ${error.message}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  getSupabase(); // throws early if env vars are missing

  if (args.reset) await resetSimData();
  if (args.users <= 0) {
    console.log('[done] no users requested');
    return;
  }

  const rng = makeRng(args.seed);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const prospects: Record<string, unknown>[] = [];
  const conversions: Record<string, unknown>[] = [];
  const groundTruth: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];

  const archetypeCounts: Record<string, number> = {};
  const planCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let convertedCount = 0;

  for (let i = 1; i <= args.users; i++) {
    const archetype = rng.weighted(ARCHETYPES, ARCHETYPES.map((a) => a.weight));
    const user = generateUser(rng, archetype, i);
    const { converted, plan } = labelUser(rng, user);
    const timeline = generateTimeline(rng, user, nowMs);

    archetypeCounts[archetype.name] = (archetypeCounts[archetype.name] ?? 0) + 1;
    planCounts[plan] = (planCounts[plan] ?? 0) + 1;
    if (converted) convertedCount++;

    prospects.push({
      vendor_id: VENDOR,
      email: user.email,
      domain: user.domain,
      tier: user.tier,
      icp_score: user.icpScore,
      scopes: user.scopes,
      enrichment_status: 'simulated',
      scored_at: nowIso,
    });
    conversions.push({
      vendor_id: VENDOR,
      email: user.email,
      converted,
      plan,
      converted_at: converted ? nowIso : null,
    });
    groundTruth.push({
      vendor_id: VENDOR,
      email: user.email,
      archetype: user.archetype,
      latent_intent: user.intent,
      latent_fit: user.fit,
    });
    for (const e of timeline) {
      events.push({
        vendor_id: VENDOR,
        email: user.email,
        domain: user.domain,
        tool_name: e.tool_name,
        outcome: e.outcome,
        agent_session_id: e.agent_session_id,
        tool_arguments: e.tool_arguments,
        agent_client_name: user.clientName,
        ip_address: user.ipAddress,
        created_at: e.created_at,
      });
    }
  }

  console.log(`[generate] ${args.users} users -> ${events.length} usage events (seed=${args.seed})`);
  await chunkWrite('prospect_identities', prospects, { upsert: 'vendor_id,email' });
  await chunkWrite('conversions', conversions, { upsert: 'vendor_id,email' });
  await chunkWrite('sim_ground_truth', groundTruth, { upsert: 'vendor_id,email' });
  await chunkWrite('usage_events', events, { insert: true });

  const rate = ((convertedCount / args.users) * 100).toFixed(1);
  console.log(`[done] inserted under vendor_id='${VENDOR}'`);
  console.log(`  prospects:    ${prospects.length}`);
  console.log(`  conversions:  ${convertedCount} converted (${rate}%)`);
  console.log(
    `  plans:        ${JSON.stringify(planCounts)} (0=none,1=base,2=pro,3=enterprise)`,
  );
  console.log(`  usage_events: ${events.length} (~${(events.length / args.users).toFixed(1)}/user)`);
  console.log(`  archetypes:   ${JSON.stringify(archetypeCounts)}`);
}

main().catch((err) => {
  console.error('[error]', err instanceof Error ? err.message : err);
  process.exit(1);
});
