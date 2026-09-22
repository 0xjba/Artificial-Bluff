import { relayDeps, relayTypeSafe } from '../../../../lib/byo/relay'

/** POST /api/typesafe/v1/systemone: Jev calls from tables in visitors' browsers (see lib/byo/relay.ts). */
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return relayTypeSafe(req, path, relayDeps)
}
