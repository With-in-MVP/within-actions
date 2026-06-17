/**
 * Deterministic test of ledger-authoritative scopes (SDK v1.1.5+).
 *
 * PRECONDITION: a tool on the vendor must be gated above tier 1. We assume
 * `get_price_summary` is gated to `crm:read` (tier 3+). Set that in the vendor's
 * toolScopeMap and redeploy before running this.
 *
 * It manufactures a token≠ledger divergence (the floored-token bug, on demand):
 *   - login a persona on a LOW-fit domain → the TOKEN lacks crm:read
 *   - then UPSERT that user's entitlement row to whatever scopes the case needs
 *   - call the gated tool and see if it's allowed
 *
 * Case A (the fix):  ledger HAS crm:read, token lacks it  → expect ALLOWED  (old SDK would DENY)
 * Case B (control):  ledger LACKS crm:read, token lacks it → expect DENIED  (proves gating works)
 *
 * A=ALLOWED and B=DENIED ⇒ scope is read from the live ledger, not the token. ✅
 *
 * Run:  npm run persona:scope-test
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getMgmtToken, createUser, ropgLogin, deleteUser } from './auth.js';

const VENDOR_ID = process.env.VENDOR_ID ?? 'test-vendor-real-estate';
const GATED_TOOL = 'get_price_summary';
const GATED_SCOPE = 'crm:read';
const LOW_FIT_DOMAIN = 'starbucks.com'; // scores low → token reliably lacks crm:read

const TIER4_SCOPES = ['tools:run', 'data:read', 'data:write_limited', 'data:write', 'crm:read', 'crm:write_limited', 'analytics:read'];
const TIER1_SCOPES = ['tools:run', 'data:read'];

function isDenied(text: string): boolean {
  return /higher access tier|higher plan tier|not available on (their|your) current tier/i.test(text);
}

async function forceLedger(sb: SupabaseClient, email: string, domain: string, scopes: string[]) {
  const future = new Date(new Date().getFullYear() + 1, 0, 1).toISOString();
  await sb.from('entitlements').upsert(
    {
      vendor_id: VENDOR_ID,
      email,
      domain,
      tier: scopes.includes(GATED_SCOPE) ? 4 : 1,
      scopes,
      quota_limit: 500,
      quota_used: 0,
      quota_reset_at: future,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'vendor_id,email' },
  );
}

async function callGated(accessToken: string): Promise<string> {
  const transport = new StreamableHTTPClientTransport(new URL(process.env.MCP_URL!), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}`, 'user-agent': 'scope-test' } },
  });
  const client = new Client({ name: 'scope-test', version: '0.1.0' });
  await client.connect(transport);
  const result = await client.callTool({ name: GATED_TOOL, arguments: {} });
  await client.close();
  return Array.isArray(result.content)
    ? result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    : String(result.content);
}

async function runCase(label: string, sb: SupabaseClient, mgmtToken: string, ledgerScopes: string[]) {
  const { userId, email, password } = await createUser(LOW_FIT_DOMAIN, mgmtToken);
  const { accessToken, claims } = await ropgLogin(email, password);
  const tokenScopes = (claims['https://within.com/scopes'] as string[] | undefined) ?? [];

  // Overwrite the ledger to the exact state this case needs (overrides what the Action wrote).
  await forceLedger(sb, email, LOW_FIT_DOMAIN, ledgerScopes);

  const text = await callGated(accessToken);
  const denied = isDenied(text);
  console.log(`\n[${label}]`);
  console.log(`  token has ${GATED_SCOPE}?  ${tokenScopes.includes(GATED_SCOPE)}`);
  console.log(`  ledger has ${GATED_SCOPE}? ${ledgerScopes.includes(GATED_SCOPE)}`);
  console.log(`  ${GATED_TOOL} → ${denied ? 'DENIED' : 'ALLOWED'}`);
  console.log(`  raw: ${text.replace(/\s+/g, ' ').slice(0, 130)}`);

  await deleteUser(userId, mgmtToken).catch(() => {});
  return denied ? 'DENIED' : 'ALLOWED';
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const mgmtToken = await getMgmtToken();

  const a = await runCase('FIX — token lacks crm:read, ledger HAS it', sb, mgmtToken, TIER4_SCOPES);
  const b = await runCase('CONTROL — token lacks crm:read, ledger ALSO lacks it', sb, mgmtToken, TIER1_SCOPES);

  console.log('\n=== VERDICT ===');
  if (a === 'ALLOWED' && b === 'DENIED') {
    console.log('✅ Ledger-authoritative scopes CONFIRMED — scope is read from the live ledger, not the token.');
  } else if (a === 'DENIED' && b === 'DENIED') {
    console.log('❌ Still token-based: ledger had crm:read but the call was denied. (old SDK behavior — check the deploy)');
  } else {
    console.log(`⚠️ Unexpected: fix-case=${a}, control-case=${b}. If control is ALLOWED, the tool may not be gated to crm:read on the vendor.`);
  }
}

main().catch((e) => {
  console.error('💥 scope-test failed:', e.message);
  process.exit(1);
});
