/**
 * The persona AUTHOR — turns a hidden latent intent into a motivation-driven
 * character brief. This is the "draw a latent → generate from it" middle step:
 *
 *   latent intent (number)  →  [author]  →  backstory (natural language)  →  [actor] → behavior
 *
 * The ACTOR only ever sees the backstory, so its engagement EMERGES from the
 * character's circumstances — not from any instruction about how many tools to
 * call. The author is explicitly forbidden from naming action counts or using
 * any simulation/meta vocabulary.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.PERSONA_MODEL ?? 'claude-haiku-4-5';

// Latent intent → a qualitative motivation the author dramatizes (actor never sees this).
function motivationFor(intent: number): string {
  if (intent < 0.2) return 'almost no motivation — essentially no reason to be looking and no personal stake';
  if (intent < 0.4) return 'low motivation — mildly curious at most, no urgency, no budget or mandate';
  if (intent < 0.6) return 'moderate motivation — a real but non-pressing reason to look, weighing options';
  if (intent < 0.8) return 'high motivation — an active need with real stakes and some time pressure';
  return 'very high motivation — an urgent, high-stakes need with budget approved and a deadline';
}

const AUTHOR_SYSTEM =
  'You write short, realistic persona briefs for simulating how different people use a real-estate property-data tool. ' +
  'Given the company someone works at (inferred from their email domain) and their underlying motivation level, ' +
  'write a SECOND-PERSON character brief (3-5 sentences) for a role-player to embody. ' +
  'Cover who they are, their role, their current situation, and — woven naturally into the situation — their motivation and urgency (or lack of it) for looking at property data right now. ' +
  'Let the motivation level emerge from believable circumstances (workload, mandate, stake, deadline), not from stated effort. ' +
  'Hard rules: do NOT say how many searches or actions to take; do NOT use the words "intent", "motivation level", "lead", "tire-kicker", "persona", or any simulation/meta language; do NOT give instructions about the tool itself. Output only the brief.';

export interface GeneratedPersona {
  domain: string;
  latentIntent: number; // ground truth — retained for later validation, hidden from the actor
  brief: string;
  systemPrompt: string;
}

export async function generatePersona(domain: string, latentIntent: number): Promise<GeneratedPersona> {
  const anthropic = new Anthropic();
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 320,
    system: AUTHOR_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Email domain: ${domain}\nUnderlying motivation: ${motivationFor(latentIntent)}\n\nWrite the brief.`,
      },
    ],
  });
  const brief = resp.content[0]?.type === 'text' ? resp.content[0].text.trim() : '';

  // Actor system = the character + a neutral tool framing (no behavior shaping).
  const systemPrompt =
    `${brief}\n\n` +
    'You are using a property-data tool with three functions: search_properties, get_property, get_price_summary. ' +
    'Act exactly as this person would in this situation: use the tools to do what they would actually do, and stop when they would naturally be finished. Prefer calling tools over narrating.';

  return { domain, latentIntent, brief, systemPrompt };
}
