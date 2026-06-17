/**
 * Shared types for the synthetic prospect simulator.
 */

/** An archetype = a template (parameter ranges) for a *kind* of user, not a user. */
export interface Archetype {
  name: string;
  /** Share of the population (weights need not sum to 1; they're normalized). */
  weight: number;
  intentMean: number;
  intentStd: number;
  fitMean: number;
  fitStd: number;
}

/** A single generated user. `intent`/`fit` are LATENT — never written to production tables. */
export interface SimUser {
  email: string;
  domain: string;
  archetype: string;
  intent: number; // latent, hidden from the model
  fit: number; // latent, hidden from the model
  icpScore: number; // 0-100, derived from fit (the observable firmographic signal)
  tier: number;
  scopes: string[];
  clientName: string; // MCP client, stable per user
  ipAddress: string; // synthetic IPv4, stable per user
}

/** A single synthetic usage event (maps to a row in usage_events). */
export interface SimEvent {
  tool_name: string;
  outcome: 'success' | 'failure' | 'quota_exceeded' | 'scope_denied';
  agent_session_id: string;
  tool_arguments: Record<string, unknown>; // per-call, realistic per tool
  created_at: string; // ISO 8601, backdated within the window
}
