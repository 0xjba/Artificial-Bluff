'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'

const KEY = 'artificialBluff.newHere'

/** The one-line explainer for first-time viewers; dismissed for good on this device. */
export function NewHere() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== 'seen')
    } catch {
      setShow(true) // storage blocked: show it, it's only a line
    }
  }, [])
  if (!show) return null
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, 'seen')
    } catch {
      // not remembered
    }
    setShow(false)
  }
  return (
    <aside className="new-here">
      <span className="label">NEW HERE?</span>
      <p>Five AI models play Texas Hold&apos;em against each other. Nobody human is in the hand — you see every card, and the win chances the players cannot.</p>
      <Link className="how" href="/about">
        How it works
      </Link>
      <button type="button" className="dismiss" aria-label="dismiss" onClick={dismiss}>
        ✕
      </button>
    </aside>
  )
}
