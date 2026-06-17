/**
 * Run ONE persona session end-to-end against the LIVE stack:
 *   create user (real domain) -> ROPG -> read tier/quota -> Claude drives the 3
 *   MCP tools as the archetype -> stop on quota / disengagement / iteration cap
 *   -> summarize the usage_events it produced.
 *
 * Claude is the "behavior brain": given the archetype system prompt and the 3
 * tool schemas, it decides which tools to call and with what arguments. The MCP
 * server enforces scope/quota and logs every call — same path a real user hits.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createUser, ropgLogin, deleteUser } from './auth.js';
import type { PersonaArchetype } from './personas.js';

const MODEL = process.env.PERSONA_MODEL ?? 'claude-haiku-4-5';
const VENDOR_ID = process.env.VENDOR_ID ?? 'test-vendor-real-estate';
const TIER_QUOTA: Record<number, number> = { 0: 0, 1: 10, 2: 50, 3: 200, 4: 500 };
const BLOCKED = /trial has ended|requires a higher plan tier|used all free/i;

// Anthropic tool schemas — mirror the MCP server's 3 tools exactly.
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_properties',
    description: 'Search properties by name, address, min/max square footage, and min/max price.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        address: { type: 'string' },
        square_footage_min: { type: 'number' },
        square_footage_max: { type: 'number' },
        price_min: { type: 'number' },
        price_max: { type: 'number' },
      },
    },
  },
  {
    name: 'get_property',
    description: 'Look up a single property by name; returns address, square footage, and price.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'property name' } },
      required: ['name'],
    },
  },
  {
    name: 'get_price_summary',
    description: 'Return a price summary across all properties.',
    input_schema: { type: 'object', properties: {} },
  },
];

export interface SessionSummary {
  archetype: string;
  email: string;
  tier: number;
  quotaLimit: number;
  toolCalls: number;
  iterations: number;
  outcomes: Record<string, number>;
  stoppedBy: 'disengaged' | 'quota' | 'iteration_cap';
}

async function readQuota(
  supabase: SupabaseClient,
  email: string,
  fallbackTier: number,
): Promise<{ limit: number; used: number; remaining: number }> {
  // The Post-Login Action writes the entitlement during login; allow brief lag.
  for (let i = 0; i < 4; i++) {
    const { data } = await supabase
      .from('entitlements')
      .select('quota_limit, quota_used')
      .eq('vendor_id', VENDOR_ID)
      .eq('email', email)
      .limit(1);
    const row = data?.[0];
    if (row) {
      const limit = row.quota_limit ?? TIER_QUOTA[fallbackTier] ?? 10;
      const used = row.quota_used ?? 0;
      return { limit, used, remaining: Math.max(0, limit - used) };
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  const limit = TIER_QUOTA[fallbackTier] ?? 10;
  return { limit, used: 0, remaining: limit };
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return String(content ?? '');
  return content
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
}

export async function runPersonaSession(
  archetype: PersonaArchetype,
  mgmtToken: string,
  supabase: SupabaseClient,
  opts: { keep?: boolean } = {},
): Promise<SessionSummary> {
  const mcpUrl = process.env.MCP_URL!;
  const anthropic = new Anthropic();

  // 1. Provision + authenticate -------------------------------------------
  const { userId, email, password } = await createUser(archetype.domain, mgmtToken);
  const { accessToken, tier } = await ropgLogin(email, password);
  console.log(`  [${archetype.key}] ${email} → tier ${tier} (${archetype.expectedFit})`);

  // 2. Read the quota the scoring engine actually assigned -----------------
  const quota = await readQuota(supabase, email, tier);
  console.log(`  [${archetype.key}] quota ${quota.remaining}/${quota.limit}`);

  // 3. MCP client (bearer + per-persona User-Agent → agent_client_name) ----
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: { authorization: `Bearer ${accessToken}`, 'user-agent': `persona-${archetype.key}` },
    },
  });
  const client = new Client({ name: `persona-${archetype.key}`, version: '0.1.0' });
  await client.connect(transport);

  // 4. Agent loop — Claude drives the tools as the archetype --------------
  const budget = Math.min(archetype.maxIterations, Math.max(1, quota.remaining));
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: 'You have just opened the property-data tool. Begin exploring based on what you are looking for.' },
  ];
  let iterations = 0;
  let toolCalls = 0;
  let stoppedBy: SessionSummary['stoppedBy'] = 'disengaged';

  while (iterations < budget) {
    iterations++;
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: archetype.systemPrompt,
      tools: TOOLS,
      messages,
    });
    messages.push({ role: 'assistant', content: resp.content });

    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      stoppedBy = 'disengaged'; // persona decided it was done
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let blocked = false;
    for (const tu of toolUses) {
      const result = await client.callTool({ name: tu.name, arguments: tu.input as Record<string, unknown> });
      toolCalls++;
      const text = extractText(result.content);
      console.log(`  [${archetype.key}] call ${toolCalls}: ${tu.name}(${JSON.stringify(tu.input)})`);
      if (BLOCKED.test(text)) blocked = true;
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: text });
    }
    messages.push({ role: 'user', content: toolResults });

    if (blocked || toolCalls >= quota.remaining) {
      stoppedBy = 'quota';
      break;
    }
  }
  if (iterations >= budget && stoppedBy !== 'quota') {
    stoppedBy = iterations >= archetype.maxIterations ? 'iteration_cap' : 'quota';
  }

  await client.close();

  // 5. Summarize the usage_events this persona actually produced ----------
  await new Promise((r) => setTimeout(r, 1200)); // let final metering land
  const { data: events } = await supabase
    .from('usage_events')
    .select('tool_name, outcome')
    .eq('vendor_id', VENDOR_ID)
    .eq('email', email);
  const outcomes: Record<string, number> = {};
  for (const e of events ?? []) outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1;

  // 6. Cleanup -----------------------------------------------------------
  if (!opts.keep) {
    try {
      await deleteUser(userId, mgmtToken);
    } catch (e) {
      console.log(`  [${archetype.key}] ⚠️ could not delete user: ${(e as Error).message}`);
    }
  }

  return {
    archetype: archetype.key,
    email,
    tier,
    quotaLimit: quota.limit,
    toolCalls,
    iterations,
    outcomes,
    stoppedBy,
  };
}
