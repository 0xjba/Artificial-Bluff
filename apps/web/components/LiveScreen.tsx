'use client'
import { Broadcast } from './Broadcast'
import { useFeed } from './useFeed'

/** The home screen: whatever the server is showing (live game, replay, or the idle card). */
export function LiveScreen({ feedUrl }: { feedUrl: string }) {
  const feed = useFeed(feedUrl)
  return <Broadcast channel={feed.channel} view={feed.view} log={feed.log} decisionEquity={feed.decisionEquity} connection={feed.connection} />
}
