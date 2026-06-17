/**
 * Phase A probe — prove the autonomous persona flow end-to-end, once.
 *
 *   create user (Management API) -> ROPG token -> MCP search_properties -> verify usage_events row
 *
 * This isolates the riskiest unknown (non-interactive auth + bearer injection
 * into the MCP client). If this prints all ✅, the rest of Step 3 is layering:
 * wrap step 3 in a Claude-driven loop, then run a fleet on a schedule.
 *
 * Run:  npm run persona:probe
 * Requires (in .env): AUTH0_DOMAIN, AUTH0_AUDIENCE, MCP_URL,
 *   AUTH0_CLIENT_ID/SECRET (ROPG app), AUTH0_MGMT_CLIENT_ID/SECRET + AUTH0_MGMT_AUDIENCE,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *   Optional: KEEP_PERSONA=1 to skip deleting the test user afterwards.
 */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CONNECTION = 'Username-Password-Authentication'; // must match tenant Default Directory
const CLIENT_NAME = 'within-persona-probe'; // becomes agent_client_name (server reads User-Agent)

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function decodeClaims(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
}

async function postJson(url: string, body: unknown, bearer?: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${text}`);
  return data;
}

async function main() {
  const domain = need('AUTH0_DOMAIN');
  const audience = need('AUTH0_AUDIENCE');
  const mcpUrl = need('MCP_URL');

  const email = `persona-probe-${randomUUID().slice(0, 8)}@within-personas.test`;
  const password = `Aa1!${randomUUID()}`; // satisfies typical Auth0 password policy
  let userId: string | undefined;

  try {
    // 1. Management API token (client_credentials) ---------------------------
    console.log('1. minting Management API token...');
    const mgmt = await postJson(`https://${domain}/oauth/token`, {
      grant_type: 'client_credentials',
      client_id: need('AUTH0_MGMT_CLIENT_ID'),
      client_secret: need('AUTH0_MGMT_CLIENT_SECRET'),
      audience: need('AUTH0_MGMT_AUDIENCE'),
    });
    console.log('   ✅ got mgmt token');

    // 2. Create the persona user ---------------------------------------------
    console.log(`2. creating user ${email}...`);
    const user = await postJson(
      `https://${domain}/api/v2/users`,
      { email, password, connection: CONNECTION, email_verified: true },
      mgmt.access_token,
    );
    userId = user.user_id;
    console.log(`   ✅ created ${userId}`);

    // 3. ROPG — authenticate the user, get a stamped token -------------------
    console.log('3. ROPG: exchanging credentials for a token...');
    const tok = await postJson(`https://${domain}/oauth/token`, {
      grant_type: 'password',
      username: email,
      password,
      audience,
      scope: 'openid profile email',
      client_id: need('AUTH0_CLIENT_ID'),
      client_secret: need('AUTH0_CLIENT_SECRET'),
    });
    const accessToken: string = tok.access_token;
    const claims = decodeClaims(accessToken);
    const within = Object.fromEntries(
      Object.entries(claims).filter(([k]) => k.startsWith('https://within.com/')),
    );
    console.log('   ✅ got access token; Within claims:', JSON.stringify(within));
    if (Object.keys(within).length === 0) {
      console.log('   ⚠️  no within.com claims — Post-Login Action may not have stamped them.');
    }

    // 4. MCP client -> search_properties -------------------------------------
    console.log('4. connecting MCP client + calling search_properties...');
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: {
        headers: { authorization: `Bearer ${accessToken}`, 'user-agent': CLIENT_NAME },
      },
    });
    const client = new Client({ name: CLIENT_NAME, version: '0.1.0' });
    await client.connect(transport);
    const result = await client.callTool({
      name: 'search_properties',
      arguments: { price_max: 1_000_000 },
    });
    await client.close();
    const preview = JSON.stringify(result.content).slice(0, 200);
    console.log(`   ✅ tool responded: ${preview}...`);

    // 5. Verify — did a usage_events row land for this persona? ---------------
    console.log('5. verifying usage_events row in Supabase...');
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    // brief retry: enforcement logging can lag the tool response slightly
    let row: any = null;
    for (let i = 0; i < 5 && !row; i++) {
      const { data } = await supabase
        .from('usage_events')
        .select('tool_name, outcome, email, agent_session_id, agent_client_name, created_at')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(1);
      row = data?.[0] ?? null;
      if (!row) await new Promise((r) => setTimeout(r, 800));
    }
    if (row) {
      console.log('   ✅ usage_events row found:', JSON.stringify(row));
      console.log('\n🎉 END-TO-END PROVEN: auth → claims → MCP tool → enforcement → usage_events.');
    } else {
      console.log('   ❌ no usage_events row for this persona. Tool ran but enforcement did not log.');
    }
  } finally {
    // 6. Cleanup -------------------------------------------------------------
    if (userId && !process.env.KEEP_PERSONA) {
      try {
        const mgmt = await postJson(`https://${domain}/oauth/token`, {
          grant_type: 'client_credentials',
          client_id: need('AUTH0_MGMT_CLIENT_ID'),
          client_secret: need('AUTH0_MGMT_CLIENT_SECRET'),
          audience: need('AUTH0_MGMT_AUDIENCE'),
        });
        await fetch(`https://${domain}/api/v2/users/${encodeURIComponent(userId)}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${mgmt.access_token}` },
        });
        console.log(`\n🧹 deleted test user ${userId} (set KEEP_PERSONA=1 to keep).`);
      } catch (e) {
        console.log(`\n⚠️  could not delete ${userId}:`, (e as Error).message);
      }
    }
  }
}

main().catch((e) => {
  console.error('\n💥 probe failed:', e.message);
  process.exit(1);
});
