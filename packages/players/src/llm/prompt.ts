import type { Observation } from '../types'

/** What "win" means for calibration. Jev's win question uses exactly the same condition. */
export const WIN_CONDITION = 'win this hand, either at showdown or because every opponent folds'

/** How option labels read; shared with Jev's action question. */
export const OPTION_SEMANTICS =
  '"Call X" adds X chips; "Bet X", "Raise to X" and "All-in X" mean your total bet this street becomes X.'

/**
 * System prompt for every LLM seat (`handFacts`: the state carries `facts.hand`). Derived from the original House of TEN prompt, fixing its
 * known defects: options and raise semantics are explicit, amounts are precomputed, and the
 * model states a win probability for calibration.
 */
export const systemPrompt = (handFacts: boolean) => `You are playing No-Limit Texas Hold'em. On each turn you receive the game state as JSON and choose exactly one of the offered options.

The state contains: your hole cards ("hole"), the board, your position, every seat's position, chips behind ("stack"), chips bet this street ("bet") and status (the seat with "you": true is you), this hand's action history, and computed facts: pot, amount to call, pot odds, effective stack in big blinds, ${handFacts ? `stack-to-pot ratio, and your hand ("hand": your made hand, any straight or flush draws with their outs, and before the flop how your starting hand ranks among all starting hands)` : 'and stack-to-pot ratio'}. Opponents are identified only by position.

Every option offered is legal. ${OPTION_SEMANTICS} In the history, "posts" and "calls X" show chips added, while "bets X" and "raises to X" show that player's street total.

Your goal is to maximise your expected chips.

Reply with only a JSON object, no other text:
{"action": "<one option id>", "win_probability": <number from 0 to 1: the probability that you ${WIN_CONDITION}>, "confidence": <number from 0 to 1: how sure you are this is the best action>, "reasoning": "<at most 120 characters>"}`

/** The prompt without hand facts: the one the first study ran on. */
export const SYSTEM_PROMPT = systemPrompt(false)

/** The user message: the observation as compact JSON. */
export function userMessage(obs: Observation): string {
  return JSON.stringify(obs)
}

/** JSON schema for structured output, restricted to this turn's option ids. */
export function responseFormat(obs: Observation): unknown {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'poker_decision',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: obs.options.map((o) => o.id) },
          win_probability: { type: 'number' },
          confidence: { type: 'number' },
          reasoning: { type: 'string' },
        },
        required: ['action', 'win_probability', 'confidence', 'reasoning'],
        additionalProperties: false,
      },
    },
  }
}
