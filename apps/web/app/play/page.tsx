import type { Metadata } from 'next'
import { PlayScreen } from '../../components/play/PlayScreen'

export const metadata: Metadata = { title: 'Run your own table · artificialBluff' }

export default function Play() {
  return <PlayScreen />
}
