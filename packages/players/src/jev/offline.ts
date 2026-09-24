import { deriveSeed, mulberry32 } from '@ab/engine'

type Question = { type: 'choice'; criteria: Record<string, unknown> } | { type: 'noul' } | { type: 'score'; criteria: unknown[] }

/**
 * A stand-in for TypeSafe's API, for free rehearsals: it answers every question in the API's shape
 * (Choice, Noul, Score) with seeded random values, the same for the same request, so the real Jev
 * player's request and decision code runs without a key, a network or a bill. The answers mean
 * nothing about poker.
 */
export function offlineTypeSafeFetch(): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (_url, init) => {
    const text = String(init?.body ?? '{}')
    const body = JSON.parse(text) as { model?: string; questions?: Record<string, Question> }
    const rand = mulberry32(deriveSeed('offline-typesafe', text))
    const answers: Record<string, unknown> = {}
    for (const [id, q] of Object.entries(body.questions ?? {})) {
      if (q.type === 'noul') answers[id] = { type: 'noul', noul: rand() }
      else if (q.type === 'choice') {
        const keys = Object.keys(q.criteria)
        const weights = keys.map(() => rand() ** 2)
        const total = weights.reduce((a, b) => a + b, 0) || 1
        const probabilities = Object.fromEntries(keys.map((k, i) => [k, weights[i]! / total]))
        const choice = keys.reduce((best, k) => (probabilities[k]! > probabilities[best]! ? k : best), keys[0]!)
        answers[id] = { type: 'choice', choice, confidence: probabilities[choice], probabilities }
      } else {
        const top = q.criteria.length - 1
        const score = rand() * top
        const low = Math.floor(score)
        const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === low ? 1 - (score - low) : i === low + 1 ? score - low : 0]))
        const legend = Object.fromEntries(q.criteria.map((c, i) => [String(i), c]))
        answers[id] = { type: 'score', score, confidence: 0.5, legend, probabilities }
      }
    }
    const reply = { model: body.model ?? 'offline', answers, usage: { input_tokens: Math.ceil(text.length / 4), output_tokens: Object.keys(answers).length } }
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}
