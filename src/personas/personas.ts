/**
 * Sampling for free-running personas. Two INDEPENDENT axes, drawn separately so
 * any domain can pair with any motivation (no hardcoded domain→behavior coupling):
 *
 *   - domain  → FIT. Determines tier/quota via the live scoring engine at runtime.
 *               The fitHint here is only our reference label, not an input to scoring.
 *   - intent  → the HIDDEN latent. Drives behavior, but ONLY by being turned into a
 *               motivation-driven backstory (see author.ts) — never an action count.
 *
 * This mirrors the simulator's two-level draw (fit & intent independent, skewed
 * population), but on the live stack with emergent rather than scripted behavior.
 */
export interface DomainEntry {
  domain: string;
  fitHint: string; // our reference only — real fit comes from live scoring
}

// Real domains spanning ICP fit for a real-estate-data vendor.
export const DOMAINS: DomainEntry[] = [
  { domain: 'compass.com', fitHint: 'real-estate brokerage' },
  { domain: 'cbre.com', fitHint: 'commercial real estate' },
  { domain: 'jll.com', fitHint: 'commercial real estate' },
  { domain: 'kw.com', fitHint: 'real-estate brokerage' },
  { domain: 'redfin.com', fitHint: 'real-estate tech' },
  { domain: 'rocketmortgage.com', fitHint: 'mortgage / fintech' },
  { domain: 'wellsfargo.com', fitHint: 'bank' },
  { domain: 'mckinsey.com', fitHint: 'consulting' },
  { domain: 'gmail.com', fitHint: 'personal email' },
  { domain: 'starbucks.com', fitHint: 'unrelated retail' },
];

export function sampleDomain(): DomainEntry {
  return DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
}

/**
 * Latent intent in [0,1], skewed LOW (most prospects are tire-kickers/non-leads,
 * a handful are hot) — squaring a uniform draw biases toward 0, like the
 * simulator's archetype weights. The actor never sees this number.
 */
export function sampleIntent(): number {
  const u = Math.random();
  return Math.round(u * u * 100) / 100;
}
