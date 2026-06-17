/**
 * Reusable Auth0 helpers for the persona harness:
 *   getMgmtToken -> createUser -> ropgLogin -> deleteUser
 * Same flow proven by probe.ts, factored out so the session loop can reuse it.
 */
import { randomUUID } from 'node:crypto';

export interface Claims {
  email?: string;
  sub?: string;
  [key: string]: unknown;
}

export interface Persona {
  userId: string;
  email: string;
  accessToken: string;
  claims: Claims;
  tier: number;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function decodeClaims(jwt: string): Claims {
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

export async function getMgmtToken(): Promise<string> {
  const domain = need('AUTH0_DOMAIN');
  const tok = await postJson(`https://${domain}/oauth/token`, {
    grant_type: 'client_credentials',
    client_id: need('AUTH0_MGMT_CLIENT_ID'),
    client_secret: need('AUTH0_MGMT_CLIENT_SECRET'),
    audience: need('AUTH0_MGMT_AUDIENCE'),
  });
  return tok.access_token;
}

/**
 * Create a persona user on a REAL domain (so the scoring engine can enrich it
 * and assign a genuine tier/quota). Local-part is prefixed `persona-` so the
 * rows are easy to identify and clean up later.
 */
export async function createUser(domain: string, mgmtToken: string): Promise<{ userId: string; email: string; password: string }> {
  const authDomain = need('AUTH0_DOMAIN');
  const email = `persona-${randomUUID().slice(0, 8)}@${domain}`;
  const password = `Aa1!${randomUUID()}`;
  const user = await postJson(
    `https://${authDomain}/api/v2/users`,
    { email, password, connection: 'Username-Password-Authentication', email_verified: true },
    mgmtToken,
  );
  return { userId: user.user_id, email, password };
}

/** ROPG: exchange the persona's credentials for a claims-stamped access token. */
export async function ropgLogin(email: string, password: string): Promise<{ accessToken: string; claims: Claims; tier: number }> {
  const domain = need('AUTH0_DOMAIN');
  const tok = await postJson(`https://${domain}/oauth/token`, {
    grant_type: 'password',
    username: email,
    password,
    audience: need('AUTH0_AUDIENCE'),
    scope: 'openid profile email',
    client_id: need('AUTH0_CLIENT_ID'),
    client_secret: need('AUTH0_CLIENT_SECRET'),
  });
  const claims = decodeClaims(tok.access_token);
  const tier = Number(claims['https://within.com/tier'] ?? 1);
  return { accessToken: tok.access_token, claims, tier };
}

export async function deleteUser(userId: string, mgmtToken: string): Promise<void> {
  const domain = need('AUTH0_DOMAIN');
  await fetch(`https://${domain}/api/v2/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${mgmtToken}` },
  });
}
