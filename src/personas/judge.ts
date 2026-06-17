/**
 * Conversion judge — the missing LABEL step for live personas.
 *
 * After a persona's trial session, a skeptical judge estimates the PROBABILITY
 * they'd upgrade to a paid plan, given (a) who they are and (b) what the trial
 * was like — including the attribution/upgrade messages they saw. We then draw a
 * Bernoulli from that probability (realistic ceiling: some hot leads don't
 * convert, some cold ones do) and write the result to `conversions`.
 *
 * This is what makes persona data TRAINABLE (usage_events + a conversion label),
 * AND turns the harness into an attribution-copy testbed: change `eventMessages`,
 * re-run, watch conversion rate move.
 *
 * Still synthetic — a judged decision is not a real purchase. Real labels need
 * the Stripe→/api/conversions webhook (Phase 3).
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.PERSONA_MODEL ?? 'claude-haiku-4-5';

const JUDGE_SYSTEM =
  'You estimate whether a prospect on a FREE TRIAL of a SaaS tool would convert to a PAID plan, from their situation and how the trial went. ' +
  'Be skeptical and calibrated: the large majority of free trials do NOT convert. Assign meaningful probability only when there is genuine need AND budget AND authority AND the trial reinforced value — e.g. they hit limits or paywalls on features they clearly wanted and kept pushing. ' +
  'Casual, idle, no-budget, or junior users almost never convert (p well under 0.1). Reserve p>0.5 for clear, motivated, well-resourced buyers. Respond with ONLY a JSON object.';

const PROMPT = `PROSPECT:
{brief}

TRIAL ACTIVITY (tools called, outcomes, and any upgrade prompts they were shown):
{transcript}

Return ONLY:
{
  "p_convert": <float 0-1, probability this person upgrades to a paid plan — remember most do NOT>,
  "plan": "<none|base|pro|enterprise — which plan they'd pick IF they convert, scaled to their apparent budget/seniority>",
  "reasoning": "<one sentence>"
}`;

export interface ConversionJudgment {
  pConvert: number;
  plan: 'none' | 'base' | 'pro' | 'enterprise';
  reasoning: string;
}

export async function judgeConversion(brief: string, transcript: string): Promise<ConversionJudgment> {
  const anthropic = new Anthropic();
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 250,
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: PROMPT.replace('{brief}', brief).replace('{transcript}', transcript) }],
  });
  const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
  try {
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const plan = ['none', 'base', 'pro', 'enterprise'].includes(parsed.plan) ? parsed.plan : 'none';
    return {
      pConvert: Math.max(0, Math.min(1, Number(parsed.p_convert) || 0)),
      plan,
      reasoning: String(parsed.reasoning ?? ''),
    };
  } catch {
    return { pConvert: 0, plan: 'none', reasoning: 'judge parse failed' };
  }
}

export const PLAN_TO_INT: Record<string, number> = { none: 0, base: 1, pro: 2, enterprise: 3 };
