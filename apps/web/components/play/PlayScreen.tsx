'use client'
import { characterFor } from '@ab/mascot'
import type { FeedMessage } from '@ab/server'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { usd } from '../../lib/format'
import { initialFeed, reduceFeed, type FeedState } from '../../lib/feed'
import { beginSignIn, finishSignIn, forgetKeys, loadKeys, saveKeys } from '../../lib/byo/keys'
import { loadCatalog, supportedModels, type CatalogEntry, type ModelOption } from '../../lib/byo/models'
import { checkSetup, DEFAULT_SEATS, LocalTable, TABLE_PACE_MS } from '../../lib/byo/table'
import { Broadcast } from '../Broadcast'
import { PlaySetup, type SetupState } from './PlaySetup'

const name = (id: string) => characterFor(id).name

/** /play: set up a table with your own keys, then watch it on the broadcast screen. */
export function PlayScreen({ paceMs = TABLE_PACE_MS }: { paceMs?: number }) {
  const [setup, setSetup] = useState<SetupState>({ seats: DEFAULT_SEATS, openrouterKey: '', typesafeKey: '', remember: false, budgetUsd: 1 })
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [feed, dispatch] = useReducer((s: FeedState, m: FeedMessage) => reduceFeed(s, m, name), undefined, initialFeed)
  const [phase, setPhase] = useState<'setup' | 'playing' | 'over'>('setup')
  const [spent, setSpent] = useState(0)
  const table = useRef<LocalTable | null>(null)

  // Keys kept from before, and a sign-in coming back from OpenRouter (?code=…).
  useEffect(() => {
    const keys = loadKeys()
    setSetup((s) => ({ ...s, openrouterKey: keys.openrouter ?? '', typesafeKey: keys.typesafe ?? '', remember: keys.remember }))
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) return
    window.history.replaceState(null, '', window.location.pathname)
    finishSignIn(code).then(
      (key) => setSetup((s) => ({ ...s, openrouterKey: key })),
      (e: unknown) => setSignInError((e as Error).message),
    )
  }, [])

  useEffect(() => {
    loadCatalog().then(setCatalog, (e: unknown) => setCatalogError((e as Error).message))
  }, [])

  // Leaving the page ends the game (it runs here): ask first, and stop it when the page goes away.
  useEffect(() => {
    if (phase !== 'playing') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    const tick = setInterval(() => setSpent(table.current?.spentUsd() ?? 0), 1000)
    return () => {
      window.removeEventListener('beforeunload', warn)
      clearInterval(tick)
    }
  }, [phase])
  useEffect(() => () => table.current?.stop(), [])

  const models: ModelOption[] | null = useMemo(() => (catalog ? supportedModels(catalog) : null), [catalog])
  const modelMap = useMemo(() => new Map((models ?? []).map((m) => [m.id, m])), [models])
  const tableSetup = { seats: setup.seats, openrouterKey: setup.openrouterKey || null, typesafeKey: setup.typesafeKey || null, budgetUsd: setup.budgetUsd }
  const problems = catalog ? checkSetup(tableSetup, modelMap) : ['loading the model list…']

  const start = () => {
    if (setup.remember) saveKeys({ openrouter: tableSetup.openrouterKey, typesafe: tableSetup.typesafeKey, remember: true })
    else {
      forgetKeys()
      saveKeys({ openrouter: tableSetup.openrouterKey, typesafe: tableSetup.typesafeKey, remember: false })
    }
    const t = new LocalTable(
      tableSetup,
      { catalog: new Map((catalog ?? []).map((m) => [m.id, m])), relayBase: `${window.location.origin}/api/typesafe`, referer: window.location.origin, paceMs },
      dispatch,
    )
    table.current = t
    setSpent(0)
    setPhase('playing')
    t.start().then(
      () => {
        setSpent(t.spentUsd())
        setPhase('over')
      },
      () => setPhase('over'),
    )
  }

  const signIn = () => {
    beginSignIn(`${window.location.origin}/play`).then((link) => window.location.assign(link), (e: unknown) => setSignInError((e as Error).message))
  }

  if (phase === 'setup') {
    return (
      <div className="page play">
        {signInError ? <p className="warn">{signInError}</p> : null}
        <PlaySetup value={setup} onChange={setSetup} models={models} modelsError={catalogError} problems={problems} onSignIn={signIn} onStart={start} />
      </div>
    )
  }

  const controls = (
    <span className="controls">
      {phase === 'playing' ? (
        <button type="button" onClick={() => table.current?.stop()}>
          Stop after this hand
        </button>
      ) : (
        <button type="button" onClick={() => setPhase('setup')}>
          New table
        </button>
      )}
      <span className="progress">
        spent {usd(spent)} of {usd(setup.budgetUsd)}
      </span>
    </span>
  )
  return <Broadcast channel={feed.channel} view={feed.view} log={feed.log} decisionEquity={feed.decisionEquity} controls={controls} />
}
