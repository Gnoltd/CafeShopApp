"use client"

import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

export type SegmentOption<T extends string> = {
  value: T
  label: string
  disabled?: boolean
  title?: string
}

const VARIANT_STYLES = {
  tabs: {
    container: "nb-border-sm flex gap-1 rounded-lg bg-muted p-1",
    option: "relative flex-1 rounded-md py-3 text-sm font-bold transition-colors",
    activeText: "text-card-foreground",
    inactiveText: "text-muted-foreground",
    pill: "nb-border-sm absolute inset-0 rounded-md bg-card",
  },
  chips: {
    // min-h-11 (44px): the un-bumped py-2 chip only reached ~36px tall,
    // below the WCAG 2.5.5/Apple HIG 44x44 touch-target minimum.
    container: "flex gap-2 overflow-x-auto pb-1",
    option:
      "nb-border-sm relative inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-muted px-4 py-2 text-sm font-medium transition-colors",
    activeText: "text-primary-foreground",
    inactiveText: "text-muted-foreground hover:bg-accent/40",
    pill: "nb-border-sm absolute inset-0 rounded-full bg-primary",
  },
} as const

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  variant = "tabs",
  className,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  layoutId: string
  variant?: "tabs" | "chips"
  className?: string
}) {
  const styles = VARIANT_STYLES[variant]
  return (
    <div className={cn(styles.container, className)}>
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            title={option.title}
            onClick={() => !option.disabled && onChange(option.value)}
            className={cn(
              styles.option,
              isActive ? styles.activeText : styles.inactiveText,
              option.disabled && "opacity-50"
            )}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className={styles.pill}
                transition={{ type: "spring", stiffness: 300, damping: 22 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
