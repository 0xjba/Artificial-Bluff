'use client'
import { characterFor } from '@ab/mascot'
import type { FeedMessage } from '@ab/server'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { usd } from '../../lib/format'
import { initialFeed, reduceFeed, type FeedState } from '../../lib/feed'
import { beginSignIn, finishSignIn, forgetKeys, loadKeys, saveKeys } from '../../lib/byo/keys'
import { loadCatalog, supportedModels, type CatalogEntry, type ModelOption, type SeatChoice } from '../../lib/byo/models'
import { checkSetup, DEFAULT_SEATS, LocalTable, TABLE_PACE_MS } from '../../lib/byo/table'
import { Broadcast } from '../Broadcast'
import { PlaySetup, type SetupState } from './PlaySetup'

const name = (id: string) => characterFor(id).name
/** The seats and cap, kept for this tab across the round trip to OpenRouter's sign-in page. */
const DRAFT = 'artificialBluff.playDraft'

const trimmed = (seats: SeatChoice[]): SeatChoice[] => seats.map((s) => (s.kind === 'llm' ? { kind: 'llm', model: s.model.trim() } : s))

/** /play: set up a table with your own keys, then watch it on the broadcast screen. */
export function PlayScreen({ paceMs = TABLE_PACE_MS }: { paceMs?: number }) {
  const [setup, setSetup] = useState<SetupState>({ seats: DEFAULT_SEATS, openrouterKey: '', typesafeKey: '', remember: false, budgetUsd: 1 })
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feed, dispatch] = useReducer((s: FeedState, m: FeedMessage) => reduceFeed(s, m, name), undefined, initialFeed)
  const [phase, setPhase] = useState<'setup' | 'playing' | 'over'>('setup')
  const [spent, setSpent] = useState(0)
  const table = useRef<LocalTable | null>(null)

  // Keys kept from before, the draft kept across sign-in, and a sign-in coming back (?code=…).
  useEffect(() => {
    const keys = loadKeys()
    let draft: Partial<SetupState> = {}
    try {
      draft = JSON.parse(sessionStorage.getItem(DRAFT) ?? '{}') as Partial<SetupState>
      sessionStorage.removeItem(DRAFT)
    } catch {
      // no draft
    }
    setSetup((s) => ({ ...s, ...draft, openrouterKey: keys.openrouter ?? '', typesafeKey: keys.typesafe ?? '', remember: keys.remember }))
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) return
    window.history.replaceState(null, '', window.location.pathname)
    finishSignIn(code).then(
      (key) =>
        setSetup((s) => {
          saveKeys({ openrouter: key, typesafe: s.typesafeKey || null, remember: s.remember })
          return { ...s, openrouterKey: key }
        }),
      (e: unknown) => setError((e as Error).message),
    )
  }, [])

  const fetchCatalog = useCallback(() => {
    setCatalogError(null)
    loadCatalog().then(setCatalog, (e: unknown) => setCatalogError((e as Error).message))
  }, [])
  useEffect(fetchCatalog, [fetchCatalog])

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
  const tableSetup = { seats: trimmed(setup.seats), openrouterKey: setup.openrouterKey || null, typesafeKey: setup.typesafeKey || null, budgetUsd: setup.budgetUsd }
  // Model seats need OpenRouter's list; tables of Jev and bots don't.
  const needsCatalog = tableSetup.seats.some((s) => s.kind === 'llm')
  const problems = needsCatalog && !catalog ? [catalogError ? "OpenRouter's model list didn't load" : 'loading the model list…'] : checkSetup(tableSetup, modelMap)

  // Keys are saved (or forgotten) as soon as they or the Remember choice change.
  const change = (next: SetupState) => {
    if (next.openrouterKey !== setup.openrouterKey || next.typesafeKey !== setup.typesafeKey || next.remember !== setup.remember) {
      forgetKeys()
      if (next.openrouterKey || next.typesafeKey) saveKeys({ openrouter: next.openrouterKey || null, typesafe: next.typesafeKey || null, remember: next.remember })
    }
    setSetup(next)
  }
  const forget = () => {
    forgetKeys()
    setSetup((s) => ({ ...s, openrouterKey: '', typesafeKey: '', remember: false }))
  }

  const start = () => {
    if (phase === 'playing' || problems.length) return // one table at a time
    const t = new LocalTable(
      tableSetup,
      {
        catalog: new Map((catalog ?? []).map((m) => [m.id, m])),
        models: modelMap,
        relayBase: `${window.location.origin}/api/typesafe`,
        referer: window.location.origin,
        paceMs,
      },
      dispatch,
    )
    table.current = t
    setSpent(0)
    setError(null)
    setPhase('playing')
    t.start().then(
      () => {
        setSpent(t.spentUsd())
        setPhase('over')
      },
      (e: unknown) => {
        setSpent(t.spentUsd())
        setError(`The game stopped: ${(e as Error).message}`)
        setPhase('over')
      },
    )
  }

  const signIn = () => {
    try {
      sessionStorage.setItem(DRAFT, JSON.stringify({ seats: setup.seats, budgetUsd: setup.budgetUsd }))
    } catch {
      setError('Sign-in needs this browser to allow site storage; paste a key instead.')
      return
    }
    saveKeys({ openrouter: setup.openrouterKey || null, typesafe: setup.typesafeKey || null, remember: setup.remember })
    beginSignIn(`${window.location.origin}/play`).then(
      (link) => window.location.assign(link),
      (e: unknown) => setError((e as Error).message),
    )
  }

  if (phase === 'setup') {
    return (
      <div className="page play">
        {error ? <p className="warn">{error}</p> : null}
        <PlaySetup
          value={setup}
          onChange={change}
          models={models}
          modelsError={catalogError}
          onRetryModels={fetchCatalog}
          problems={problems}
          onSignIn={signIn}
          onForgetKeys={forget}
          onStart={start}
        />
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
        spent ≈ {usd(spent)} of {usd(setup.budgetUsd)}
      </span>
      {error ? <span className="warn">{error}</span> : null}
    </span>
  )
  return <Broadcast channel={feed.channel} view={feed.view} log={feed.log} decisionEquity={feed.decisionEquity} controls={controls} />
}
