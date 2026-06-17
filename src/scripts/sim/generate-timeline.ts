/**
 * Generate a backdated usage-event timeline DRIVEN by the user's latent intent.
 * This is where the structured signal lives — high-intent users get more
 * sessions, denser/broader calls, shorter gaps, and escalation over time.
 * Low-intent users get one shallow burst. The shape of the timeline encodes
 * the hidden intent the model must recover.
 */
import type { Rng } from './rng.js';
import { generateToolArgs } from './tool-arguments.js';
import type { SimEvent, SimUser } from './types.js';

// Real-estate vendor tool surface — matches test-vendor-real-estate/src/server.ts exactly.
const TOOLS = ['get_property', 'search_properties', 'get_price_summary'];

const WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateTimeline(rng: Rng, user: SimUser, nowMs: number): SimEvent[] {
  const { intent } = user;
  const events: SimEvent[] = [];

  // Number of sessions scales with intent (~1 for cold, ~6 for hot).
  const sessions = Math.max(1, Math.round(rng.gaussian(1 + intent * 5, 1.0)));

  // Tool diversity scales with intent: cold users hammer 1-2 tools; hot users explore.
  const maxTools = Math.max(1, Math.round(1 + intent * (TOOLS.length - 1)));
  const toolPool = shuffle(rng, TOOLS).slice(0, maxTools);

  const startMs = nowMs - WINDOW_DAYS * MS_PER_DAY;

  for (let s = 0; s < sessions; s++) {
    const sessionFrac = sessions === 1 ? rng.float(0, 1) : s / (sessions - 1);

    // Spread sessions across the window with a little jitter.
    const sessionDay = clamp(sessionFrac * WINDOW_DAYS + rng.float(-0.4, 0.4), 0, WINDOW_DAYS - 0.01);
    let t = startMs + sessionDay * MS_PER_DAY + rng.float(0, MS_PER_DAY * 0.3);

    const sessionId = `sim-sess-${user.email}-${s}`;

    // Escalation: for high-intent users, later sessions get denser.
    const escalation = 1 + intent * sessionFrac;
    const baseCalls = 1 + intent * 6;
    const calls = Math.max(1, Math.round(rng.gaussian(baseCalls * escalation, 1.2)));

    // Gaps between calls shrink with intent (~120s cold -> ~30s hot).
    const meanGapSec = 120 - intent * 90;

    for (let c = 0; c < calls; c++) {
      const r = rng.next();
      const outcome: SimEvent['outcome'] =
        r < 0.88 ? 'success' : r < 0.96 ? 'failure' : 'quota_exceeded';

      const tool = rng.pick(toolPool);
      events.push({
        tool_name: tool,
        outcome,
        agent_session_id: sessionId,
        tool_arguments: generateToolArgs(rng, tool, intent),
        created_at: new Date(t).toISOString(),
      });

      t += Math.max(2000, rng.gaussian(meanGapSec, meanGapSec * 0.4) * 1000);
    }
  }

  events.sort((x, y) => x.created_at.localeCompare(y.created_at));
  return events;
}
