/**
 * Phase B runner (free-running personas).
 *
 *   npm run persona:run                  # 4 personas
 *   npm run persona:run -- --count 8     # 8 personas
 *   npm run persona:run -- --keep        # don't delete the Auth0 users
 *
 * Each persona = an independent draw of (domain, latent intent). The author turns
 * the latent into a backstory; the actor runs free. Fit (tier/quota) comes from
 * live scoring of the domain; engagement emerges from the character. The summary
 * prints latent intent vs. tier vs. calls so you can eyeball whether behavior
 * tracks the hidden intent (and the firmographic fit is independent of it).
 */
import { createClient } from '@supabase/supabase-js';
import { getMgmtToken } from './auth.js';
import { sampleDomain, sampleIntent } from './personas.js';
import { generatePersona } from './author.js';
import { runPersonaSession, type SessionSummary } from './session.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const count = Number(arg('count') ?? 4);
  const keep = flag('keep');

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const mgmtToken = await getMgmtToken();

  console.log(`Running ${count} free-running persona(s)\n`);
  const summaries: SessionSummary[] = [];
  for (let i = 0; i < count; i++) {
    const { domain } = sampleDomain();
    const intent = sampleIntent();
    try {
      const persona = await generatePersona(domain, intent);
      console.log(`— persona ${i + 1}: ${domain} (latent intent ${intent})`);
      console.log(`  brief: ${persona.brief.replace(/\s+/g, ' ').slice(0, 160)}...`);
      summaries.push(await runPersonaSession(persona, mgmtToken, supabase, { keep }));
    } catch (e) {
      console.error(`  [${domain}] 💥 ${(e as Error).message}`);
    }
    console.log('');
  }

  // Report — sorted by latent intent so the fit/intent relationship is legible ---
  console.log('=== SESSION SUMMARY (sorted by latent intent) ===');
  console.log('domain                 latentIntent  tier  quota  calls  stoppedBy');
  for (const s of [...summaries].sort((a, b) => a.latentIntent - b.latentIntent)) {
    console.log(
      `${s.domain.padEnd(22)} ${String(s.latentIntent).padEnd(13)} ${String(s.tier).padEnd(5)} ` +
        `${String(s.quotaLimit).padEnd(6)} ${String(s.toolCalls).padEnd(6)} ${s.stoppedBy}`,
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
