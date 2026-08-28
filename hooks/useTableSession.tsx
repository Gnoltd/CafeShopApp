"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
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

type TableSessionState = {
  hasSession: boolean
  cartItems: TableSessionCartItem[]
  rounds: TableSessionRound[]
  unpaidTotal: number
  paymentPending: boolean
  isLoading: boolean
  showIdlePrompt: boolean
  addItem: (input: AddCartItemInput) => Promise<void>
  updateQuantity: (cartItemId: string, quantity: number) => Promise<void>
  removeItem: (cartItemId: string) => Promise<void>
  placeRound: () => Promise<{ orderId: string; total: number }>
  confirmStillHere: () => void
  dismissAndAbandon: () => Promise<void>
  refetch: () => Promise<void>
}

export function useTableSession(qrToken: string | undefined): TableSessionState {
  const [supabase] = useState(() => createClient())
  const [hasSession, setHasSession] = useState(false)
  const [cartItems, setCartItems] = useState<TableSessionCartItem[]>([])
  const [rounds, setRounds] = useState<TableSessionRound[]>([])
  const [unpaidTotal, setUnpaidTotal] = useState(0)
  const [paymentPending, setPaymentPending] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [showIdlePrompt, setShowIdlePrompt] = useState(false)
  const [stillHereNonce, setStillHereNonce] = useState(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const promptTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const refetch = useCallback(async () => {
    if (!qrToken) return
    const session = await getTableSession(supabase, qrToken)
    setHasSession(session.hasSession)
    setCartItems(session.cartItems)
    setRounds(session.rounds)
    setUnpaidTotal(session.unpaidTotal)
    setPaymentPending(session.paymentPending)
  }, [supabase, qrToken])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    refetch().finally(() => {
      if (!cancelled) setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [refetch])

  // Unfiltered subscribe + refetch on any change, matching this
  // project's established Realtime convention (a server-side `filter`
  // doesn't reliably combine with RLS-gated Realtime).
  useRealtimeChannel(
    supabase,
    `table-session-${qrToken ?? "none"}`,
    [
      { table: "table_cart_items", event: "*", onChange: () => refetch().catch(() => {}) },
      { table: "orders", event: "*", onChange: () => refetch().catch(() => {}) },
      { table: "table_sessions", event: "*", onChange: () => refetch().catch(() => {}) },
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
  // table_sessions, which ARE guest-visible.
  useEffect(() => {
    if (!qrToken) return
    const interval = setInterval(() => {
      refetch().catch(() => {})
    }, 10_000)
    return () => clearInterval(interval)
  }, [qrToken, refetch])

  async function dismissAndAbandon() {
    if (!qrToken) return
    setShowIdlePrompt(false)
    await abandonTableSessionQuery(supabase, qrToken)
  }

  // I-2: a content-based fingerprint, not the raw `cartItems` array --
  // refetch() (triggered by ANY unfiltered Realtime event, including
  // ones from other tables entirely) produces a fresh array reference
  // every time even when the contents haven't changed. Depending on the
  // array itself re-armed this timer on unrelated activity elsewhere in
  // the cafe, so an abandoned draft essentially never idled out.
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
    await updateCartItemQuantityQuery(supabase, qrToken, cartItemId, quantity)
  }

  async function removeItem(cartItemId: string) {
    if (!qrToken) return
    await removeCartItemQuery(supabase, qrToken, cartItemId)
  }

  async function placeRound() {
    if (!qrToken) throw new Error("no qr token")
    return placeTableRoundQuery(supabase, qrToken)
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
    showIdlePrompt,
    addItem,
    updateQuantity,
    removeItem,
    placeRound,
    confirmStillHere,
    dismissAndAbandon,
    refetch,
  }
}
