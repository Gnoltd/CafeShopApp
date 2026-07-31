import Image from "next/image"
import { Coffee, CupSoda, Cookie, Milk } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MenuIcon, MenuItem } from "@/lib/supabase/menu-data"

export const ICONS: Record<MenuIcon, typeof Coffee> = {
  coffee: Coffee,
  "cup-soda": CupSoda,
  cookie: Cookie,
  milk: Milk,
}

/**
 * Real uploaded photo when set, falling back to the item's category icon —
 * used anywhere a menu item's image appears (menu, landing best sellers,
 * product detail). `className` sizes the wrapper box (this component always
 * renders it `relative` so `next/image`'s `fill` mode has a positioned
 * ancestor); `imageClassName` is for the image's own visual treatment
 * (object-fit, hover-zoom transforms, filters) — kept separate so a
 * `group-hover:scale-110` on the image doesn't also scale the box it sits in.
 */
export function ItemImage({
  item,
  className,
  imageClassName,
  sizes = "(max-width: 768px) 112px, 300px",
}: {
  item: MenuItem
  className?: string
  imageClassName?: string
  sizes?: string
}) {
  if (item.imageUrl) {
    return (
      <div className={cn("relative overflow-hidden", className)}>
        <Image src={item.imageUrl} alt="" fill sizes={sizes} className={cn("object-cover", imageClassName)} />
      </div>
    )
  }
  const Icon = ICONS[item.icon]
  return (
    <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
      <Icon className="h-8 w-8" />
    </div>
  )
}
