/**
 * Generate one user: draw latent intent/fit from the archetype, then derive
 * the observable firmographics (diverse domain + ICP score + tier + scopes).
 *
 * The model later sees domain/icp_score/tier — NOT intent/fit. Its job is to
 * infer the hidden intent from observable behavior.
 */
import type { Rng } from './rng.js';
import type { Archetype, SimUser } from './types.js';
import { scopesForTier, tierForScore } from './tiers.js';

// Word pool for synthetic domains. Combined with the row index they stay unique
// (prospect_identities is UNIQUE(vendor_id, email)) while looking varied.
const DOMAIN_WORDS = [
  'acme', 'bright', 'summit', 'harbor', 'vertex', 'pioneer', 'keystone',
  'meridian', 'atlas', 'beacon', 'cobalt', 'delta', 'ember', 'frontier',
  'granite', 'horizon', 'ironwood', 'juniper', 'kestrel', 'lumina',
];

// MCP clients a prospect might connect through.
const CLIENTS = ['claude-desktop', 'claude-code', 'chatgpt-desktop', 'cursor', 'vscode-mcp'];

function syntheticIp(rng: Rng): string {
  return `${rng.int(1, 223)}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function generateUser(rng: Rng, archetype: Archetype, index: number): SimUser {
  const intent = clamp01(rng.gaussian(archetype.intentMean, archetype.intentStd));
  const fit = clamp01(rng.gaussian(archetype.fitMean, archetype.fitStd));

  // ICP score (observable firmographic signal) tracks latent fit, with noise.
  const icpScore = Math.round(clamp01(fit + rng.gaussian(0, 0.05)) * 100);
  const tier = tierForScore(icpScore);
  const scopes = scopesForTier(tier);

  const word = rng.pick(DOMAIN_WORDS);
  const idx = String(index).padStart(4, '0');
  const domain = `${word}${idx}.com`;
  const email = `user${idx}@${domain}`;

  const clientName = rng.pick(CLIENTS);
  const ipAddress = syntheticIp(rng);

  return {
    email,
    domain,
    archetype: archetype.name,
    intent,
    fit,
    icpScore,
    tier,
    scopes,
    clientName,
    ipAddress,
  };
}
