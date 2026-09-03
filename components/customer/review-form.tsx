"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { StarRating } from "@/components/customer/star-rating"
import { getMyReviewForItem, submitReview } from "@/lib/supabase/reviews-data"
import { AsyncRetryError, AsyncSkeleton } from "@/components/shared/async-state"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"

export function ReviewForm({ itemId, onDone }: { itemId: string; onDone: () => void }) {
  const t = useTranslations("OrderTracking")
  const [supabase] = useState(() => createClient())
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadReview = useCallback(async ({ isStale }: LoadContext) => {
    try {
      const existing = await getMyReviewForItem(supabase, itemId)
      if (isStale()) return
      if (existing) {
        setRating(existing.rating)
        setComment(existing.comment)
      }
      setLoadError(false)
      setIsLoading(false)
    } catch {
        // getMyReviewForItem throws on any RPC/network error -- without
        // this catch `isLoading` stayed true forever, a permanently blank
        // review slot with no way to recover short of a page reload.
        if (isStale()) return
        setLoadError(true)
        setIsLoading(false)
    }
  }, [itemId, supabase])
  const { run: runReviewLoad } = useLatestRefetch(loadReview, 0)

  useEffect(() => {
    void runReviewLoad()
  }, [itemId, runReviewLoad])

  function handleRetryLoad() {
    setIsLoading(true)
    setLoadError(false)
    void runReviewLoad()
  }

  async function handleSubmit() {
    if (rating < 1) {
      setError(t("reviewRatingRequiredError"))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await submitReview(supabase, itemId, rating, comment.trim())
      onDone()
    } catch {
      setError(t("reviewSubmitError"))
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="mt-2 rounded-lg bg-chip p-3">
        <AsyncSkeleton variant="block" className="border-0" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="nb-border-sm mt-2 rounded-lg bg-chip p-3">
        <AsyncRetryError onRetry={handleRetryLoad} compact />
      </div>
    )
  }

  return (
    <div className="nb-border-sm mt-2 space-y-2 rounded-lg bg-chip p-3">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <StarRating rating={rating} size="lg" onRate={setRating} />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("reviewCommentPlaceholder")}
        rows={2}
        className="nb-border-sm w-full resize-none rounded-lg bg-card px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="neubrutal" size="sm" className="bg-card text-foreground" onClick={onDone} disabled={isSaving}>
          {t("reviewCancelButton")}
        </Button>
        <Button type="button" variant="neubrutal" size="sm" onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? t("reviewSubmitLoading") : t("submitReviewButton")}
        </Button>
      </div>
    </div>
  )
}
