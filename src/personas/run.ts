/**
 * Phase B runner — drive AI personas through the live stack and report the
 * usage_events they generate.
 *
 *   npm run persona:run                       # one session per archetype
 *   npm run persona:run -- --archetype hot_lead
 *   npm run persona:run -- --repeat 2         # 2 sessions per archetype
 *   npm run persona:run -- --keep             # don't delete the Auth0 users
 *
 * Sessions run sequentially (keeps cost legible and avoids hammering Auth0).
 */
import { createClient } from '@supabase/supabase-js';
import { getMgmtToken } from './auth.js';
import { PERSONA_ARCHETYPES, getArchetype } from './personas.js';
import { runPersonaSession, type SessionSummary } from './session.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const which = arg('archetype');
  const repeat = Number(arg('repeat') ?? 1);
  const keep = flag('keep');

  const archetypes =
    which && which !== 'all'
      ? [getArchetype(which)].filter((a): a is NonNullable<typeof a> => {
          if (!a) console.error(`Unknown archetype "${which}". Options: ${PERSONA_ARCHETYPES.map((x) => x.key).join(', ')}`);
          return !!a;
        })
      : PERSONA_ARCHETYPES;
  if (archetypes.length === 0) process.exit(1);

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const mgmtToken = await getMgmtToken();

  console.log(`Running ${archetypes.length} archetype(s) × ${repeat} → ${archetypes.length * repeat} sessions\n`);
  const summaries: SessionSummary[] = [];
  for (let r = 0; r < repeat; r++) {
    for (const a of archetypes) {
      try {
        summaries.push(await runPersonaSession(a, mgmtToken, supabase, { keep }));
      } catch (e) {
        console.error(`  [${a.key}] 💥 ${(e as Error).message}`);
      }
      console.log('');
    }
  }

  // Report ----------------------------------------------------------------
  console.log('=== SESSION SUMMARY ===');
  console.log('archetype      tier  quota  calls  stoppedBy        outcomes');
  for (const s of summaries) {
    const oc = Object.entries(s.outcomes).map(([k, v]) => `${k}:${v}`).join(' ') || '(none)';
    console.log(
      `${s.archetype.padEnd(14)} ${String(s.tier).padEnd(5)} ${String(s.quotaLimit).padEnd(6)} ` +
        `${String(s.toolCalls).padEnd(6)} ${s.stoppedBy.padEnd(16)} ${oc}`,
    );
  }
  const totalEvents = summaries.reduce((n, s) => n + Object.values(s.outcomes).reduce((a, b) => a + b, 0), 0);
  console.log(`\n${summaries.length} sessions, ${totalEvents} usage_events generated.`);
  if (keep) console.log('(--keep set: Auth0 users NOT deleted)');
}

main().catch((e) => {
  console.error('💥 runner failed:', e.message);
  process.exit(1);
});
