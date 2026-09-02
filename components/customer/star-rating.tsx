import { Star } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

export function StarRating({
  rating,
  size = "sm",
  onRate,
}: {
  rating: number
  size?: "sm" | "lg"
  onRate?: (value: number) => void
}) {
  const t = useTranslations("OrderTracking")
  const starSize = size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => {
        const filled = i < Math.round(rating)
        const star = (
          <Star className={cn(starSize, filled ? "fill-accent text-accent" : "fill-none text-muted-foreground/40")} />
        )
        if (!onRate) return <span key={i}>{star}</span>
        return (
          <button key={i} type="button" onClick={() => onRate(i + 1)} aria-label={t("starRatingLabel", { value: i + 1 })} className="p-0.5">
            {star}
          </button>
        )
      })}
    </div>
  )
}
