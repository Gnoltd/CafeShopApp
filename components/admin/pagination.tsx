"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

type PaginationProps = {
  currentPage: number
  totalPages: number
  rangeStart: number
  rangeEnd: number
  totalCount: number
  onPageChange: (page: number) => void
}

export function Pagination({ currentPage, totalPages, rangeStart, rangeEnd, totalCount, onPageChange }: PaginationProps) {
  const t = useTranslations("AdminMenu")

  return (
    <>
      <span className="text-xs text-muted-foreground">
        {t("showingItems", { start: rangeStart, end: rangeEnd, total: totalCount })}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          {t("previous")}
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            className={cn(
              "nb-border-sm nb-press-sm rounded-lg px-3 py-1 text-xs font-extrabold",
              page === currentPage ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
            )}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          {t("next")}
        </button>
      </div>
    </>
  )
}
