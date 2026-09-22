import { LiveScreen } from '../components/LiveScreen'

export default function Home() {
  return <LiveScreen feedUrl={process.env.NEXT_PUBLIC_FEED_URL ?? '/api/feed'} />
}
