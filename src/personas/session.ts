/**
 * Run ONE free-running persona session against the LIVE stack:
 *   create user (real domain) -> ROPG -> read tier/quota -> the actor (Claude)
 *   runs FREE as the generated character, deciding tool calls from its situation
 *   -> stops on natural disengagement / quota / iteration guardrail -> summarize.
 *
 * The actor's behavior EMERGES from the persona brief (see author.ts). Tier/quota
 * come from real scoring of the domain. maxIterations is a pure cost guardrail,
 * NOT a behavior shaper — a low-motivation character disengages well before it.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createUser, ropgLogin, deleteUser } from './auth.js';
import type { GeneratedPersona } from './author.js';
import { judgeConversion, PLAN_TO_INT } from './judge.js';

const MODEL = process.env.PERSONA_MODEL ?? 'claude-haiku-4-5';
const VENDOR_ID = process.env.VENDOR_ID ?? 'test-vendor-real-estate';
const MAX_ITERATIONS = 20; // cost guardrail only — emergent behavior usually stops sooner
const TIER_QUOTA: Record<number, number> = { 0: 0, 1: 10, 2: 50, 3: 200, 4: 500 };
// Quota exhaustion is terminal (nothing more will work). Scope denials are NOT —
// they're fed back so the actor can react and reach for a tool it IS allowed to use.
const QUOTA_EXHAUSTED = /trial has ended|used all free/i;

export interface SessionSummary {
  domain: string;
  latentIntent: number;
  email: string;
  tier: number;
  quotaLimit: number;
  toolCalls: number;
  iterations: number;
  stoppedBy: 'disengaged' | 'quota' | 'iteration_cap';
  outcomes: Record<string, number>;
  pConvert: number;
  converted: boolean;
  plan: number;
}

// Reads tier+quota from the LEDGER — the source of truth. The token's tier can be
// floored to 1 if the Post-Login Action timed out, so we never display the token tier.
async function readLedger(
  supabase: SupabaseClient,
  email: string,
  tokenTier: number,
): Promise<{ tier: number; limit: number; used: number; remaining: number }> {
  for (let i = 0; i < 4; i++) {
    const { data } = await supabase
      .from('entitlements')
      .select('tier, quota_limit, quota_used')
      .eq('vendor_id', VENDOR_ID)
      .eq('email', email)
      .limit(1);
    const row = data?.[0];
    if (row) {
      const limit = row.quota_limit ?? TIER_QUOTA[tokenTier] ?? 10;
      const used = row.quota_used ?? 0;
      return { tier: row.tier ?? tokenTier, limit, used, remaining: Math.max(0, limit - used) };
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  const limit = TIER_QUOTA[tokenTier] ?? 10;
  return { tier: tokenTier, limit, used: 0, remaining: limit };
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return String(content ?? '');
  return content
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
}

export interface VisitResult {
  tier: number;
  quotaLimit: number;
  quotaRemaining: number;
  toolCalls: number;
  iterations: number;
  stoppedBy: SessionSummary['stoppedBy'];
  outcomes: Record<string, number>;
  transcript: string[];
  floored: boolean;
}

/**
 * Run ONE visit for an ALREADY-AUTHENTICATED persona: read tier/quota, connect
 * the MCP client, run the actor loop, summarize this visit's usage_events. This
 * is the reusable behavior core — `runPersonaSession` (one-shot) and the cron
 * scheduler (spawn + return) both build on it. It does NOT judge or delete; the
 * caller owns lifecycle. Pass `opts.preamble` to frame a return visit, and
 * `opts.since` (ISO) to count only events from this visit forward.
 */
export async function runVisit(
  persona: GeneratedPersona,
  email: string,
  accessToken: string,
  tokenTier: number,
  supabase: SupabaseClient,
  opts: { preamble?: string; since?: string } = {},
): Promise<VisitResult> {
  const mcpUrl = process.env.MCP_URL!;
  const anthropic = new Anthropic();
  const tag = persona.domain.split('.')[0];

  // Read tier+quota from the LEDGER (source of truth; token tier can be floored)
  const quota = await readLedger(supabase, email, tokenTier);
  const tier = quota.tier;
  const floored = tokenTier !== quota.tier;
  console.log(
    `  [${tag}] ${email} → tier ${tier} (latent intent ${persona.latentIntent})` +
      (floored ? ` ⚠️ token floored to ${tokenTier}` : ''),
  );
  console.log(`  [${tag}] quota ${quota.remaining}/${quota.limit}`);

  // MCP client (bearer + per-domain User-Agent → agent_client_name) --------
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: { authorization: `Bearer ${accessToken}`, 'user-agent': `persona-${tag}` },
    },
  });
  const client = new Client({ name: `persona-${tag}`, version: '0.1.0' });
  await client.connect(transport);

  // Discover the vendor's tools dynamically — the actor uses whatever the server
  // exposes, so adding vendor tools needs no harness change.
  const { tools: mcpTools } = await client.listTools();
  const tools: Anthropic.Tool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
  }));

  // Actor loop — Claude runs FREE as the character ------------------------
  const budget = Math.min(MAX_ITERATIONS, Math.max(1, quota.remaining));
  const opener =
    opts.preamble ?? 'You have just opened the property-data tool. Do whatever you would naturally do.';
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opener }];
  let iterations = 0;
  let toolCalls = 0;
  let stoppedBy: SessionSummary['stoppedBy'] = 'disengaged';
  const transcript: string[] = []; // what the persona did + the messages it saw (for the judge)

  while (iterations < budget) {
    iterations++;
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: persona.systemPrompt,
      tools,
      messages,
    });
    messages.push({ role: 'assistant', content: resp.content });

    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      stoppedBy = 'disengaged';
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let quotaExhausted = false;
    for (const tu of toolUses) {
      const result = await client.callTool({ name: tu.name, arguments: tu.input as Record<string, unknown> });
      toolCalls++;
      const text = extractText(result.content);
      console.log(`  [${tag}] call ${toolCalls}: ${tu.name}(${JSON.stringify(tu.input)})`);
      transcript.push(`${tu.name}(${JSON.stringify(tu.input)}) → ${text.replace(/\s+/g, ' ').slice(0, 180)}`);
      if (QUOTA_EXHAUSTED.test(text)) quotaExhausted = true;
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: text });
    }
    messages.push({ role: 'user', content: toolResults });

    // Only quota exhaustion ends the session. A scope denial just flows back to the
    // actor, which adapts on its next turn (tries an allowed tool, or disengages).
    if (quotaExhausted || toolCalls >= quota.remaining) {
      stoppedBy = 'quota';
      break;
    }
  }
  if (iterations >= budget && stoppedBy !== 'quota') {
    stoppedBy = iterations >= MAX_ITERATIONS ? 'iteration_cap' : 'quota';
  }

  await client.close();

  // Summarize the usage_events from THIS visit (filtered by `since` when given) --
  await new Promise((r) => setTimeout(r, 1200));
  let q = supabase
    .from('usage_events')
    .select('outcome')
    .eq('vendor_id', VENDOR_ID)
    .eq('email', email);
  if (opts.since) q = q.gte('created_at', opts.since);
  const { data: events } = await q;
  const outcomes: Record<string, number> = {};
  for (const e of events ?? []) outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1;

  return {
    tier,
    quotaLimit: quota.limit,
    quotaRemaining: quota.remaining,
    toolCalls,
    iterations,
    stoppedBy,
    outcomes,
    transcript,
    floored,
  };
}

/**
 * One-shot persona session: provision a fresh Auth0 user, run a single visit,
 * judge the (single-session) journey into a conversion label, and delete the
 * user. This is the Phase B flow used by run.ts / probe — unchanged in behavior;
 * it now delegates the visit to runVisit(). Cron does NOT use this (it owns the
 * provision/judge/delete lifecycle across many ticks via runVisit directly).
 */
export async function runPersonaSession(
  persona: GeneratedPersona,
  mgmtToken: string,
  supabase: SupabaseClient,
  opts: { keep?: boolean } = {},
): Promise<SessionSummary> {
  const tag = persona.domain.split('.')[0];

  // 1. Provision + authenticate -------------------------------------------
  const { userId, email, password } = await createUser(persona.domain, mgmtToken);
  const { accessToken, tier: tokenTier } = await ropgLogin(email, password);

  // 2. Run the visit (tier/quota read + actor loop + per-visit event summary) ---
  const visit = await runVisit(persona, email, accessToken, tokenTier, supabase);

  // 3. Conversion label — judge P(convert), Bernoulli draw, write the label ----
  const transcriptStr = visit.transcript.length
    ? visit.transcript.join('\n')
    : '(made no tool calls — disengaged immediately)';
  const judgment = await judgeConversion(persona.brief, transcriptStr);
  const converted = Math.random() < judgment.pConvert;
  const plan = converted ? Math.max(1, PLAN_TO_INT[judgment.plan] ?? 1) : 0;
  const nowIso = new Date().toISOString();
  await supabase.from('conversions').upsert(
    { vendor_id: VENDOR_ID, email, converted, plan, converted_at: converted ? nowIso : null },
    { onConflict: 'vendor_id,email' },
  );
  // Retain latent ground truth (intent + fit) for live validation — mirrors sim_ground_truth.
  await supabase.from('sim_ground_truth').upsert(
    { vendor_id: VENDOR_ID, email, archetype: 'persona-live', latent_intent: persona.latentIntent, latent_fit: visit.tier / 4 },
    { onConflict: 'vendor_id,email' },
  );
  console.log(`  [${tag}] conversion: p=${judgment.pConvert.toFixed(2)} → ${converted ? `CONVERTED (plan ${plan})` : 'no'}`);

  // 4. Cleanup ------------------------------------------------------------
  if (!opts.keep) {
    try {
      await deleteUser(userId, mgmtToken);
    } catch (e) {
      console.log(`  [${tag}] ⚠️ could not delete user: ${(e as Error).message}`);
    }
  }

  return {
    domain: persona.domain,
    latentIntent: persona.latentIntent,
    email,
    tier: visit.tier,
    quotaLimit: visit.quotaLimit,
    toolCalls: visit.toolCalls,
    iterations: visit.iterations,
    stoppedBy: visit.stoppedBy,
    outcomes: visit.outcomes,
    pConvert: judgment.pConvert,
    converted,
    plan,
  };
}
