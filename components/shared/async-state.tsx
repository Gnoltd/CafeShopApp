"use client"

import type { ReactNode } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * The states any client-fetched view can be in. Kept generic over the data
 * shape so this one module serves order tracking, table sessions, review
 * lookups, and every later async view (loyalty, dashboard, address book,
 * cart) alike -- see daily.md Task 3.
 *
 * `stale` is intentionally distinct from `data`: a background refresh
 * failed, but the last-good `data` is still shown (never silently dropped
 * back to loading/error) with a visible "may be outdated" flag until the
 * next refresh recovers. Producing/consuming `stale` is optional -- a view
 * that only needs "skeleton + retry instead of blank" (this dispatch's
 * scope) only ever needs `loading`/`data`/`error`.
 */
export type AsyncViewState<T> =
  | { status: "loading" }
  | { status: "data"; data: T }
  | { status: "empty" }
  | { status: "error"; error?: unknown }
  | { status: "stale"; data: T; error?: unknown }

export function loadingState(): AsyncViewState<never> {
  return { status: "loading" }
}
export function dataState<T>(data: T): AsyncViewState<T> {
  return { status: "data", data }
}
export function emptyState(): AsyncViewState<never> {
  return { status: "empty" }
}
export function errorState(error?: unknown): AsyncViewState<never> {
  return { status: "error", error }
}
export function staleState<T>(data: T, error?: unknown): AsyncViewState<T> {
  return { status: "stale", data, error }
}

type SkeletonVariant = "page" | "list" | "block"

/**
 * On-theme pulsing placeholder, standing in for whatever content is about
 * to load. `page` is a centered full-view placeholder (order tracking, QR
 * table resolution); `list` is a stack of row placeholders (a cart/order
 * list); `block` is a single inline placeholder sized to fit inline
 * content (e.g. the review-lookup card nested inside an order line item).
 */
export function AsyncSkeleton({
  className,
  variant = "block",
  rows = 3,
  label,
}: {
  className?: string
  variant?: SkeletonVariant
  rows?: number
  label?: string
}) {
  const t = useTranslations("AsyncState")
  const resolvedLabel = label ?? t("loadingLabel")

  if (variant === "page") {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={resolvedLabel}
        className={cn(
          "mx-auto flex min-h-[50vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6",
          className
        )}
      >
        <div className="nb-border nb-shadow h-24 w-24 animate-pulse rounded-full bg-muted" />
        <div className="h-4 w-40 animate-pulse rounded-full bg-muted" />
        <div className="h-3 w-56 animate-pulse rounded-full bg-muted" />
        <span className="sr-only">{resolvedLabel}</span>
      </div>
    )
  }

  if (variant === "list") {
    return (
      <div role="status" aria-busy="true" aria-label={resolvedLabel} className={cn("space-y-2", className)}>
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="nb-border-sm h-14 w-full animate-pulse rounded-xl bg-muted" />
        ))}
        <span className="sr-only">{resolvedLabel}</span>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={resolvedLabel}
      className={cn("nb-border-sm h-16 w-full animate-pulse rounded-lg bg-muted", className)}
    />
  )
}

/**
 * Error state WITH a retry action -- this is the piece that turns a dead
 * end (blank screen, or a form stuck loading forever) into something a
 * user can recover from without reloading the page.
 */
export function AsyncRetryError({
  onRetry,
  isRetrying = false,
  message,
  className,
  compact = false,
}: {
  onRetry: () => void
  isRetrying?: boolean
  message?: string
  className?: string
  /** Compact: fits inline inside an existing card (e.g. the review-lookup
   * slot), instead of taking over the whole view. */
  compact?: boolean
}) {
  const t = useTranslations("AsyncState")

  return (
    <div
      role="alert"
      className={cn(
        compact
          ? "flex flex-wrap items-center justify-between gap-2 rounded-lg bg-destructive/10 px-3 py-2"
          : "nb-border nb-shadow mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-xl bg-chip p-6 text-center",
        className
      )}
    >
      {!compact && (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>
      )}
      <p className={cn("text-destructive", compact ? "text-xs" : "text-sm font-medium")}>
        {message ?? t("genericErrorMessage")}
      </p>
      <Button
        variant="neubrutal"
        size={compact ? "xs" : "sm"}
        onClick={onRetry}
        disabled={isRetrying}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")} />
        {isRetrying ? t("retryingButton") : t("retryButton")}
      </Button>
    </div>
  )
}

/** Generic "nothing here yet" state -- distinct from `error` (a failed
 * fetch must never render as this; see the false-empty-state item this
 * dispatch deliberately leaves to a sibling dispatch). */
export function AsyncEmpty({ message, className }: { message?: string; className?: string }) {
  const t = useTranslations("AsyncState")
  return (
    <div
      className={cn(
        "mx-auto flex min-h-[30vh] w-full max-w-md flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground",
        className
      )}
    >
      <p className="text-sm">{message ?? t("emptyMessage")}</p>
    </div>
  )
}

/** A small on-theme banner to place above/around already-rendered `stale`
 * data -- last-good content stays visible and usable, flagged as possibly
 * outdated, with an optional inline retry. */
export function StaleNotice({ onRetry, className }: { onRetry?: () => void; className?: string }) {
  const t = useTranslations("AsyncState")
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg bg-accent/20 px-3 py-1.5 text-xs text-accent-foreground",
        className
      )}
    >
      <span>{t("staleNotice")}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-bold underline underline-offset-2">
          {t("retryButton")}
        </button>
      )}
    </div>
  )
}

/**
 * Dispatches an `AsyncViewState` to the right presentational piece above.
 * Optional -- call sites are equally free to switch on `state.status`
 * themselves and use the pieces directly (several of this dispatch's
 * retrofits do exactly that, since they keep their existing
 * undefined/null-shaped state rather than adopting the full union).
 */
export function AsyncStateView<T>({
  state,
  onRetry,
  isRetrying,
  renderData,
  skeleton,
  empty,
  errorMessage,
  className,
}: {
  state: AsyncViewState<T>
  onRetry?: () => void
  isRetrying?: boolean
  renderData: (data: T, meta: { stale: boolean }) => ReactNode
  skeleton?: ReactNode
  empty?: ReactNode
  errorMessage?: string
  className?: string
}): ReactNode {
  switch (state.status) {
    case "loading":
      return skeleton ?? <AsyncSkeleton className={className} />
    case "empty":
      return empty ?? <AsyncEmpty className={className} />
    case "error":
      return (
        <AsyncRetryError
          onRetry={onRetry ?? (() => {})}
          isRetrying={isRetrying}
          message={errorMessage}
          className={className}
        />
      )
    case "data":
      return <>{renderData(state.data, { stale: false })}</>
    case "stale":
      return (
        <div className={className}>
          <StaleNotice onRetry={onRetry} className="mb-2" />
          {renderData(state.data, { stale: true })}
        </div>
      )
    default:
      return null
  }
}
