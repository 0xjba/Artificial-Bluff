'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The way back to the table, at the right of the header (the design has it on this page). The header
 * belongs to the layout, so this fills the same slot the broadcast screen uses for the programme.
 */
export function WatchLive() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById('site-status')), [])
  if (!slot) return null
  return createPortal(
    <Link className="watch-live" href="/">
      WATCH THE LIVE TABLE <span aria-hidden="true">→</span>
    </Link>,
    slot,
  )
}
