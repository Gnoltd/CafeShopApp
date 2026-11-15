"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  nextAsyncLoadFlags,
  useLatestRefetch,
  type LoadContext,
} from "@/hooks/useLatestRefetch"
import { clearGuestActiveTable } from "@/lib/guest-active-table"
import {
  createSupabaseTableSessionAdapter,
  isStaleCartItemError,
  type AddCartItemInput,
  type PlaceTableRoundResult,
  type TableSessionCartItem,
  type TableSessionPort,
  type TableSessionRound,
} from "@/lib/supabase/table-session-data"

// Design doc Section 5 / Q9, Q18: the "still there?" idle-clear only
// ever applies to an unsubmitted draft cart, and stops entirely once
// the session has at least one placed round.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const IDLE_PROMPT_RESPONSE_MS = 60 * 1000

// Coalesce poll/focus refreshes while mutations refresh immediately.
const TABLE_SESSION_REFETCH_DELAY_MS = 300

// Shared cart and order reads are authorized by QR, including across devices.
const GUEST_ORDER_POLL_MS = 3_000

export type TableSessionErrorKind =
  | "add_item"
  | "stale_cart_item"
  | "cart_update"
  | "place_round"

export type UseTableSessionOptions = {
  port?: TableSessionPort
  onAbandon?: (qrToken: string) => void
}

export type TableSessionState = {
  hasSession: boolean
  cartItems: TableSessionCartItem[]
  rounds: TableSessionRound[]
  unpaidTotal: number
  paymentPending: boolean
  isLoading: boolean
  /** True only when the session has never loaded successfully and its most
   * recent load attempt failed -- distinct from `hasStaleData` below, which
   * covers a background poll-refetch failure once real data is already showing. */
  hasLoadError: boolean
  /** True when the session HAS loaded successfully at least once, but the
   * most recent background refetch (focus/visibility or guest poll) failed.
   * `cartItems`/`rounds`/etc. still hold the last-good data -- never cleared
   * on a refetch failure -- this only flags it as possibly outdated until the
   * next successful refetch clears it. */
  hasStaleData: boolean
  showIdlePrompt: boolean
  pendingCartItemIds: Set<string>
  isPlacingRound: boolean
  error: TableSessionErrorKind | null
  addItem: (input: AddCartItemInput) => Promise<void>
  updateQuantity: (cartItemId: string, quantity: number) => Promise<void>
  removeItem: (cartItemId: string) => Promise<void>
  placeRound: () => Promise<PlaceTableRoundResult | null>
  requestBill: () => Promise<void>
  confirmStillHere: () => void
  dismissAndAbandon: () => Promise<void>
  refetch: () => Promise<void>
  /** Re-runs the initial load after `hasLoadError` -- distinct from
   * `refetch` only in that it also drives `isLoading` back to true, so a
   * retry from the blank/error state shows the loading skeleton again. */
  retryLoad: () => void
}

export function useTableSession(
  qrToken: string | undefined,
  options: UseTableSessionOptions = {}
): TableSessionState {
  const [fallbackPort] = useState<TableSessionPort>(() =>
    options.port ?? createSupabaseTableSessionAdapter(createClient())
  )
  const port = options.port ?? fallbackPort

  const onAbandonRef = useRef(options.onAbandon)
  useEffect(() => {
    onAbandonRef.current = options.onAbandon
  }, [options.onAbandon])

  const [hasSession, setHasSession] = useState(false)
  const [cartItems, setCartItems] = useState<TableSessionCartItem[]>([])
  const [rounds, setRounds] = useState<TableSessionRound[]>([])
  const [unpaidTotal, setUnpaidTotal] = useState(0)
  const [paymentPending, setPaymentPending] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadError, setHasLoadError] = useState(false)
  const [hasStaleData, setHasStaleData] = useState(false)
  const [showIdlePrompt, setShowIdlePrompt] = useState(false)
  const [stillHereNonce, setStillHereNonce] = useState(0)
  const [pendingCartItemIds, setPendingCartItemIds] = useState<Set<string>>(() => new Set())
  const [isPlacingRound, setIsPlacingRound] = useState(false)
  const [error, setError] = useState<TableSessionErrorKind | null>(null)

  const hasLoadedOnceRef = useRef(false)
  const cartItemsRef = useRef<TableSessionCartItem[]>([])
  const pendingIdsRef = useRef<Set<string>>(new Set())
  const isPlacingRoundRef = useRef(false)
  const activeQrTokenRef = useRef(qrToken)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const promptTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const roundSubmissionId = useRef(crypto.randomUUID())

  const load = useCallback(
    async ({ isStale }: LoadContext) => {
      if (!qrToken) return
      try {
        const session = await port.getSession(qrToken)
        // Latest wins: an older response resolving after a newer one must
        // not roll this device's view of the shared cart backwards.
        if (isStale()) return
        cartItemsRef.current = session.cartItems
        setHasSession(session.hasSession)
        setCartItems(session.cartItems)
        setRounds(session.rounds)
        setUnpaidTotal(session.unpaidTotal)
        setPaymentPending(session.paymentPending)
        hasLoadedOnceRef.current = true
        setHasLoadError(false)
        setHasStaleData(false)
      } catch (err) {
        if (isStale()) return
        // First load (never succeeded yet): blocking error, nothing safe to
        // show. Background refetch failing once real data is already on screen:
        // keep last-good data and only flag it as possibly outdated.
        const flags = nextAsyncLoadFlags(hasLoadedOnceRef.current, "failure")
        setHasLoadError(flags.hasBlockingError)
        setHasStaleData(flags.hasStaleData)
        throw err
      }
    },
    [port, qrToken]
  )

  const { trigger, run, invalidate } = useLatestRefetch(load, TABLE_SESSION_REFETCH_DELAY_MS)

  const refetch = useCallback(() => run(), [run])

  useEffect(() => {
    activeQrTokenRef.current = qrToken
    hasLoadedOnceRef.current = false
    cartItemsRef.current = []
    pendingIdsRef.current.clear()
    isPlacingRoundRef.current = false
    roundSubmissionId.current = crypto.randomUUID()
    // A load still in flight for the previous qrToken must not apply to the
    // table we just switched to.
    invalidate()
    let cancelled = false
    queueMicrotask(async () => {
      if (cancelled) return
      setError(null)
      setPendingCartItemIds(new Set())
      setIsPlacingRound(false)
      setIsLoading(true)
      setHasLoadError(false)
      setHasStaleData(false)
      await run()
      if (!cancelled) setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [run, invalidate, qrToken])

  const retryLoad = useCallback(() => {
    setIsLoading(true)
    void run().finally(() => setIsLoading(false))
  }, [run])

  // Guests have no table-wide SELECT/Realtime access. Every read must
  // present the QR capability to the narrow RPC. Pause hidden tabs and
  // refresh on focus; the runner coalesces overlapping requests.
  useEffect(() => {
    if (!qrToken) return
    const refreshVisible = () => {
      if (document.visibilityState !== "hidden") trigger()
    }
    const interval = setInterval(refreshVisible, GUEST_ORDER_POLL_MS)
    document.addEventListener("visibilitychange", refreshVisible)
    window.addEventListener("focus", refreshVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", refreshVisible)
      window.removeEventListener("focus", refreshVisible)
    }
  }, [qrToken, trigger])

  const dismissAndAbandon = useCallback(async () => {
    if (!qrToken) return
    clearTimeout(idleTimer.current)
    clearTimeout(promptTimer.current)
    setShowIdlePrompt(false)
    const capturedToken = qrToken
    try {
      await port.abandonSession(qrToken)
      if (onAbandonRef.current) {
        onAbandonRef.current(qrToken)
      } else {
        clearGuestActiveTable(qrToken)
      }
    } catch {
      if (activeQrTokenRef.current === capturedToken) setError("cart_update")
    } finally {
      await run()
    }
  }, [port, qrToken, run])

  // Use content, not array identity: polling unchanged data must not keep
  // an abandoned draft alive by restarting its idle timer.
  const cartFingerprint = cartItems.map((i) => `${i.id}:${i.quantity}`).join(",")

  // Idle-draft timeout: only while the session has no placed rounds
  // yet. Re-arms on any cart/round change -- one shared session, so
  // the clock tracks the session's liveness, not any one device's.
  useEffect(() => {
    clearTimeout(idleTimer.current)
    clearTimeout(promptTimer.current)
    queueMicrotask(() => setShowIdlePrompt(false))

    if (!hasSession || rounds.length > 0) return

    idleTimer.current = setTimeout(() => {
      setShowIdlePrompt(true)
      promptTimer.current = setTimeout(() => {
        void dismissAndAbandon()
      }, IDLE_PROMPT_RESPONSE_MS)
    }, IDLE_TIMEOUT_MS)

    return () => {
      clearTimeout(idleTimer.current)
      clearTimeout(promptTimer.current)
    }
  }, [hasSession, rounds.length, cartFingerprint, stillHereNonce, dismissAndAbandon])

  const addItem = useCallback(
    async (input: AddCartItemInput) => {
      if (!qrToken) return
      setError(null)
      const capturedToken = qrToken
      try {
        await port.addCartItem(qrToken, input)
        await run()
      } catch {
        if (activeQrTokenRef.current === capturedToken) setError("add_item")
      }
    },
    [port, qrToken, run]
  )

  const runCartItemMutation = useCallback(
    async (cartItemId: string, mutation: () => Promise<void>) => {
      if (!qrToken) return
      if (pendingIdsRef.current.has(cartItemId)) return
      setError(null)
      const capturedToken = qrToken
      pendingIdsRef.current.add(cartItemId)
      setPendingCartItemIds(new Set(pendingIdsRef.current))
      try {
        await mutation()
        await run()
      } catch (err) {
        if (activeQrTokenRef.current === capturedToken) {
          setError(isStaleCartItemError(err) ? "stale_cart_item" : "cart_update")
        }
        await run()
      } finally {
        if (activeQrTokenRef.current === capturedToken) {
          pendingIdsRef.current.delete(cartItemId)
          setPendingCartItemIds(new Set(pendingIdsRef.current))
        }
      }
    },
    [qrToken, run]
  )

  const updateQuantity = useCallback(
    async (cartItemId: string, quantity: number) => {
      if (!qrToken) return
      const item = cartItemsRef.current.find((candidate) => candidate.id === cartItemId)
      if (!item) {
        setError("cart_update")
        await run()
        return
      }
      await runCartItemMutation(cartItemId, () =>
        port.updateCartItemQuantity(qrToken, cartItemId, quantity - item.quantity, item.version)
      )
    },
    [port, qrToken, run, runCartItemMutation]
  )

  const removeItem = useCallback(
    async (cartItemId: string) => {
      if (!qrToken) return
      await runCartItemMutation(cartItemId, () => port.removeCartItem(qrToken, cartItemId))
    },
    [port, qrToken, runCartItemMutation]
  )

  const placeRound = useCallback(async (): Promise<PlaceTableRoundResult | null> => {
    if (!qrToken) return null
    if (isPlacingRoundRef.current) return null
    setError(null)
    const capturedToken = qrToken
    isPlacingRoundRef.current = true
    setIsPlacingRound(true)
    try {
      const result = await port.placeRound(qrToken, roundSubmissionId.current)
      roundSubmissionId.current = crypto.randomUUID()
      await run()
      return result
    } catch {
      if (activeQrTokenRef.current === capturedToken) setError("place_round")
      return null
    } finally {
      if (activeQrTokenRef.current === capturedToken) {
        isPlacingRoundRef.current = false
        setIsPlacingRound(false)
      }
    }
  }, [port, qrToken, run])

  const requestBill = useCallback(async () => {
    if (!qrToken) throw new Error("no qr token")
    await port.requestBill(qrToken)
    await run()
  }, [port, qrToken, run])

  const confirmStillHere = useCallback(() => {
    clearTimeout(promptTimer.current)
    setShowIdlePrompt(false)
    // Bumping stillHereNonce re-runs the idle-timer effect even when
    // hasSession/rounds.length/cartFingerprint haven't changed, so a guest
    // who confirms "still here" and then leaves still gets re-armed.
    setStillHereNonce((n) => n + 1)
  }, [])

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
    pendingCartItemIds,
    isPlacingRound,
    error,
    addItem,
    updateQuantity,
    removeItem,
    placeRound,
    requestBill,
    confirmStillHere,
    dismissAndAbandon,
    refetch,
    retryLoad,
  }
}
