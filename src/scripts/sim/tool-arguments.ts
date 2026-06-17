/**
 * Generate realistic per-call arguments matching the REAL real-estate MCP
 * server's tool schemas (test-vendor-real-estate/src/server.ts):
 *
 *   get_property      { name: string }                                   (required)
 *   search_properties { name?, address?, square_footage_min/max?,        (all optional)
 *                       price_min/max? }
 *   get_price_summary {}                                                 (no args)
 *
 * Every argument is derived from a SINGLE real property (sim/properties.ts),
 * so name / address / square_footage / price always cohere. Intent nudges
 * specificity: higher-intent users add more search filters.
 */
import { PROPERTIES } from './properties.js';
import type { Rng } from './rng.js';

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * @param specificity 0..1 (typically the user's latent intent) — higher => more filters.
 */
export function generateToolArgs(
  rng: Rng,
  toolName: string,
  specificity: number,
): Record<string, unknown> {
  const detailed = rng.bool(specificity); // serious users add more constraints
  const target = rng.pick(PROPERTIES); // one real property anchors the whole call

  switch (toolName) {
    case 'get_property':
      return { name: target.name };

    case 'search_properties': {
      const args: Record<string, unknown> = {};
      if (detailed || rng.bool(0.5)) args.name = target.name;
      if (detailed) {
        args.address = target.address;
        args.square_footage_min = roundTo(target.square_footage * 0.8, 100);
        args.square_footage_max = roundTo(target.square_footage * 1.2, 100);
        args.price_min = roundTo(target.price * 0.8, 10_000);
        args.price_max = roundTo(target.price * 1.2, 10_000);
      }
      // A search always carries at least one constraint — fall back to a price range
      // bracketing the anchor property.
      if (Object.keys(args).length === 0) {
        args.price_min = roundTo(target.price * 0.8, 10_000);
        args.price_max = roundTo(target.price * 1.2, 10_000);
      }
      return args;
    }

    case 'get_price_summary':
      return {};

    default:
      return {};
  }
}
