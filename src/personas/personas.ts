/**
 * Persona archetypes for the live harness. Mirrors src/scripts/sim/archetypes.ts
 * (hot/warm/tire-kicker/non-lead) but for the REAL flow:
 *
 *   - `domain` is a REAL company domain so the scoring engine enriches it and
 *     assigns a genuine tier/quota (vs. fake domains that floor to tier 1).
 *   - `intent` lives in the SYSTEM PROMPT (behavior), not the domain.
 *
 * Key parallel to the simulator: a tire-kicker has HIGH fit but LOW intent — so
 * it gets a STRONG domain (high tier/quota) but a low-intent prompt. That way the
 * archetype difference shows up in BEHAVIOR within a generous budget, not just in
 * how soon quota runs out.
 *
 * Domains are best-guess for a real-estate-data vendor's ICP; adjust to taste.
 * `maxIterations` caps how many agentic turns the persona takes (engagement
 * level), independent of the quota ceiling — keeps cost bounded and models that
 * a tire-kicker disengages quickly even when it has quota left.
 */
export interface PersonaArchetype {
  key: string;
  label: string;
  domain: string;
  expectedFit: string;
  maxIterations: number;
  systemPrompt: string;
}

export const PERSONA_ARCHETYPES: PersonaArchetype[] = [
  {
    key: 'hot_lead',
    label: 'Hot lead',
    domain: 'compass.com', // major real-estate brokerage → strong ICP fit
    expectedFit: 'high → expect tier 3-4',
    maxIterations: 12,
    systemPrompt:
      'You are a highly motivated commercial real-estate analyst at an active brokerage with real budget and urgency to source properties for clients. ' +
      'You are using a property-data tool with three functions: search_properties, get_property, get_price_summary. ' +
      'Do thorough due diligence: run MULTIPLE searches with specific, varied criteria (price ranges, square footage, locations), drill into individual listings you like with get_property, and use get_price_summary to gauge the market. ' +
      'ESCALATE — make each search more targeted than the last as you home in on candidates. ' +
      'Keep going until you have genuinely explored the inventory, then give a short closing summary and stop. Prefer calling tools over chatting.',
  },
  {
    key: 'warm_lead',
    label: 'Warm lead',
    domain: 'rocketmortgage.com', // adjacent fintech/mortgage → moderate fit
    expectedFit: 'moderate → expect tier 2',
    maxIterations: 6,
    systemPrompt:
      'You are a moderately interested buyer doing some research on a property-data tool with three functions: search_properties, get_property, get_price_summary. ' +
      'Run a few searches and look at a couple of specific properties that catch your eye, but do not be exhaustive. ' +
      'After a moderate look around, give a brief summary and stop. Use the tools rather than just talking.',
  },
  {
    key: 'tire_kicker',
    label: 'Tire-kicker',
    domain: 'cbre.com', // large commercial real-estate firm → strong fit (HIGH fit, LOW intent)
    expectedFit: 'high → expect tier 3-4 (but low-intent behavior)',
    maxIterations: 3,
    systemPrompt:
      'You are idly browsing a property-data tool out of mild curiosity, with no real intent to buy. ' +
      'It has three functions: search_properties, get_property, get_price_summary. ' +
      'Do just one or two casual, vague searches and maybe glance at a single property, then lose interest. ' +
      'Keep it brief and shallow — when you feel mildly satisfied or bored, stop with a one-line remark.',
  },
  {
    key: 'non_lead',
    label: 'Non-lead',
    domain: 'gmail.com', // personal/unrelated → weak fit → expect floor tier
    expectedFit: 'low → expect tier 1',
    maxIterations: 2,
    systemPrompt:
      'You opened a property-data tool almost by accident and are barely curious. ' +
      'It has three functions: search_properties, get_property, get_price_summary. ' +
      'Make at most one quick, generic search, then stop — you are not really interested.',
  },
];

export function getArchetype(key: string): PersonaArchetype | undefined {
  return PERSONA_ARCHETYPES.find((a) => a.key === key);
}
