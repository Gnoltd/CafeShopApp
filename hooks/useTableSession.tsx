"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"
import { nextAsyncLoadFlags } from "@/lib/async-refetch-flags"
import {
  isRelevantTableSessionChange,
  EMPTY_KNOWN_TABLE_SESSION,
  type KnownTableSession,
} from "@/lib/table-session-changes"
import {
  getTableSession,
  addCartItem as addCartItemQuery,
  updateCartItemQuantity as updateCartItemQuantityQuery,
  removeCartItem as removeCartItemQuery,
  placeTableRound as placeTableRoundQuery,
  abandonTableSession as abandonTableSessionQuery,
  type AddCartItemInput,
  type TableSessionCartItem,
  type TableSessionRound,
} from "@/lib/supabase/table-session-data"

// Design doc Section 5 / Q9, Q18: the "still there?" idle-clear only
// ever applies to an unsubmitted draft cart, and stops entirely once
// the session has at least one placed round.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const IDLE_PROMPT_RESPONSE_MS = 60 * 1000

// One "Place Order" writes an `orders` row, N `order_items` rows, clears N
// `table_cart_items` rows and touches `table_sessions` -- a single logical
// action arriving as a burst of change events. 300ms is well past that burst
// while keeping another diner's cart edit feeling instantaneous.
const TABLE_SESSION_REFETCH_DELAY_MS = 300

// Poll interval for the guest-invisible-order safety net (see the comment on
// its effect below).
const GUEST_ORDER_POLL_MS = 10_000

type TableSessionState = {
  hasSession: boolean
  cartItems: TableSessionCartItem[]
  rounds: TableSessionRound[]
  unpaidTotal: number
  paymentPending: boolean
  isLoading: boolean
  /** True only when the session has never loaded successfully and its most
   * recent load attempt failed -- distinct from `hasStaleData` below, which
   * covers a background Realtime/poll-refetch failure once real data is
   * already showing. */
  hasLoadError: boolean
  /** True when the session HAS loaded successfully at least once, but the
   * most recent background refetch (Realtime trigger or the guest poll)
   * failed. `cartItems`/`rounds`/etc. still hold the last-good data --
   * never cleared on a refetch failure -- this only flags it as possibly
   * outdated until the next successful refetch clears it. */
  hasStaleData: boolean
  showIdlePrompt: boolean
  addItem: (input: AddCartItemInput) => Promise<void>
  updateQuantity: (cartItemId: string, quantity: number) => Promise<void>
  removeItem: (cartItemId: string) => Promise<void>
  placeRound: () => Promise<{ orderId: string; total: number }>
  confirmStillHere: () => void
  dismissAndAbandon: () => Promise<void>
  refetch: () => Promise<void>
  /** Re-runs the initial load after `hasLoadError` -- distinct from
   * `refetch` only in that it also drives `isLoading` back to true, so a
   * retry from the blank/error state shows the loading skeleton again. */
  retryLoad: () => void
}

export function useTableSession(qrToken: string | undefined): TableSessionState {
  const [supabase] = useState(() => createClient())
  const [hasSession, setHasSession] = useState(false)
  const [cartItems, setCartItems] = useState<TableSessionCartItem[]>([])
  const [rounds, setRounds] = useState<TableSessionRound[]>([])
  const [unpaidTotal, setUnpaidTotal] = useState(0)
  const [paymentPending, setPaymentPending] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadError, setHasLoadError] = useState(false)
  const [hasStaleData, setHasStaleData] = useState(false)
  const hasLoadedOnceRef = useRef(false)
  const [showIdlePrompt, setShowIdlePrompt] = useState(false)
  const [stillHereNonce, setStillHereNonce] = useState(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const promptTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const roundSubmissionId = useRef(crypto.randomUUID())

  // The ids this device is actually looking at, kept in a ref so the
  // Realtime handlers (subscribed once per qrToken) always read the latest
  // values without re-subscribing the channel.
  const knownRef = useRef<KnownTableSession>(EMPTY_KNOWN_TABLE_SESSION)

  const load = useCallback(
    async ({ isStale }: LoadContext) => {
      if (!qrToken) return
      try {
        const session = await getTableSession(supabase, qrToken)
        // Latest wins: an older response resolving after a newer one must
        // not roll this device's view of the shared cart backwards.
        if (isStale()) return
        knownRef.current = {
          sessionId: session.sessionId,
          cartItemIds: new Set(session.cartItems.map((item) => item.id)),
          roundIds: new Set(session.rounds.map((round) => round.id)),
        }
        setHasSession(session.hasSession)
        setCartItems(session.cartItems)
        setRounds(session.rounds)
        setUnpaidTotal(session.unpaidTotal)
        setPaymentPending(session.paymentPending)
        hasLoadedOnceRef.current = true
        setHasLoadError(false)
        setHasStaleData(false)
      } catch (error) {
        if (isStale()) return
        // First load (never succeeded yet): blocking error, nothing safe to
        // show. Background refetch failing (Realtime trigger, the guest
        // poll) once real data is already on screen: leave cartItems/
        // rounds/etc. exactly as they are (no setState above ran) and just
        // flag them as possibly outdated instead of yanking the screen back
        // to an error/blank state.
        const flags = nextAsyncLoadFlags(hasLoadedOnceRef.current, "failure")
        setHasLoadError(flags.hasBlockingError)
        setHasStaleData(flags.hasStaleData)
        throw error
      }
    },
    [supabase, qrToken]
  )

  const { trigger, run, invalidate } = useLatestRefetch(load, TABLE_SESSION_REFETCH_DELAY_MS)

  const refetch = useCallback(() => run(), [run])

  useEffect(() => {
    knownRef.current = EMPTY_KNOWN_TABLE_SESSION
    hasLoadedOnceRef.current = false
    setIsLoading(true)
    setHasLoadError(false)
    setHasStaleData(false)
    // A load still in flight for the previous qrToken must not apply to the
    // table we just switched to.
    invalidate()
    run().finally(() => setIsLoading(false))
  }, [run, invalidate, qrToken])

  const retryLoad = useCallback(() => {
    setIsLoading(true)
    void run().finally(() => setIsLoading(false))
  }, [run])

  // Unfiltered subscribe + refetch on any change, matching this
  // project's established Realtime convention (a server-side `filter`
  // doesn't reliably combine with RLS-gated Realtime). Because the
  // subscription can't be narrowed, the *payload* is checked instead:
  // every cart/session/order change anywhere in the cafe lands here, and
  // only the ones belonging to this table's own session are worth a
  // refetch (see lib/table-session-changes.ts).
  const onSessionChange = useCallback(
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      if (!isRelevantTableSessionChange(payload, knownRef.current)) return
      trigger()
    },
    [trigger]
  )

  useRealtimeChannel(
    supabase,
    `table-session-${qrToken ?? "none"}`,
    [
      { table: "table_cart_items", event: "*", onChange: onSessionChange },
      { table: "orders", event: "*", onChange: onSessionChange },
      { table: "table_sessions", event: "*", onChange: onSessionChange },
    ],
    { deps: [qrToken] }
  )

  // I-1: a guest round has customer_id null, matching neither
  // orders_select_own nor orders_select_staff -- so Realtime (itself
  // RLS-gated) never delivers `orders` change events to a guest device
  // at all. This low-frequency poll is the safety net for round-status
  // changes (paid -> preparing -> ready -> served) and payment
  // confirmations Realtime can't deliver here, matching this project's
  // own guest order-tracking convention (lib/supabase/order-tracking.ts).
  // Realtime above still gives fast updates for table_cart_items/
  // table_sessions, which ARE guest-visible -- this poll exists only for
  // the order-status gap and stays at its original interval. It goes
  // through the same coalescing trigger, so a tick that lands while a
  // Realtime-driven refetch is already in flight no longer stacks a
  // second concurrent request.
  useEffect(() => {
    if (!qrToken) return
    const interval = setInterval(trigger, GUEST_ORDER_POLL_MS)
    return () => clearInterval(interval)
  }, [qrToken, trigger])

  async function dismissAndAbandon() {
    if (!qrToken) return
    setShowIdlePrompt(false)
    await abandonTableSessionQuery(supabase, qrToken)
  }

  // I-2: a content-based fingerprint, not the raw `cartItems` array -- every
  // refetch (the 10s poll included) produces a fresh array reference even
  // when the contents haven't changed. Depending on the array itself re-armed
  // this timer on unrelated activity, so an abandoned draft essentially never
  // idled out. Still required now that the Realtime payload filter above
  // drops other tables' events: the poll alone would re-arm it forever.
  const cartFingerprint = cartItems.map((i) => `${i.id}:${i.quantity}`).join(",")

  // Idle-draft timeout: only while the session has no placed rounds
  // yet. Re-arms on any cart/round change -- one shared session, so
  // the clock tracks the session's liveness, not any one device's.
  useEffect(() => {
    clearTimeout(idleTimer.current)
    clearTimeout(promptTimer.current)
    setShowIdlePrompt(false)

    if (!hasSession || rounds.length > 0) return

    idleTimer.current = setTimeout(() => {
      setShowIdlePrompt(true)
      promptTimer.current = setTimeout(() => {
        dismissAndAbandon()
      }, IDLE_PROMPT_RESPONSE_MS)
    }, IDLE_TIMEOUT_MS)

    return () => {
      clearTimeout(idleTimer.current)
      clearTimeout(promptTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSession, rounds.length, cartFingerprint, stillHereNonce])

  async function addItem(input: AddCartItemInput) {
    if (!qrToken) return
    await addCartItemQuery(supabase, qrToken, input)
  }

  async function updateQuantity(cartItemId: string, quantity: number) {
    if (!qrToken) return
    const item = cartItems.find((candidate) => candidate.id === cartItemId)
    if (!item) throw new Error("cart_item_not_found")
    await updateCartItemQuantityQuery(supabase, qrToken, cartItemId, quantity - item.quantity, item.version)
  }

  async function removeItem(cartItemId: string) {
    if (!qrToken) return
    await removeCartItemQuery(supabase, qrToken, cartItemId)
  }

  async function placeRound() {
    if (!qrToken) throw new Error("no qr token")
    const result = await placeTableRoundQuery(supabase, qrToken, roundSubmissionId.current)
    roundSubmissionId.current = crypto.randomUUID()
    return result
  }

  function confirmStillHere() {
    clearTimeout(promptTimer.current)
    setShowIdlePrompt(false)
    // Bumping stillHereNonce re-runs the idle-timer effect below even
    // when hasSession/rounds.length/cartFingerprint haven't changed --
    // otherwise a guest who confirms "still here" and then genuinely
    // leaves would never have the idle timer re-armed (found in review:
    // the fingerprint fix for the "unrelated Realtime activity resets
    // every table's timer" bug also stopped this legitimate re-arm case
    // from firing, since dismissing the prompt alone doesn't change any
    // of the other deps).
    setStillHereNonce((n) => n + 1)
  }

  return {
    hasSession,
    cartItems,
    rounds,
    unpaidTotal,
    paymentPending,
    isLoading,
    hasLoadError,
    hasStaleData,
    showIdlePrompt,
    addItem,
    updateQuantity,
    removeItem,
    placeRound,
    confirmStillHere,
    dismissAndAbandon,
    refetch,
    retryLoad,
  }
}
