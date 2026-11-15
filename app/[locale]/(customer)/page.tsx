import { getLocale, getTranslations } from "next-intl/server"
import { Clock, Coffee, MapPin, Phone } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { ScanQrButton } from "@/components/customer/scan-qr-button"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import { getPublicMenuData } from "@/lib/supabase/menu-data-cached"
import { getShopSettings } from "@/lib/supabase/settings-data"
import { createClient } from "@/lib/supabase/server"

const BEST_SELLER_LIMIT = 6

export default async function HomePage() {
  const [t, tBrand, locale, supabase] = await Promise.all([
    getTranslations("Home"),
    getTranslations("Brand"),
    getLocale(),
    createClient(),
  ])
  const [{ items }, shop] = await Promise.all([getPublicMenuData(), getShopSettings(supabase)])

  const bestSellers = items.filter((i) => i.isPopular && i.isAvailable).slice(0, BEST_SELLER_LIMIT)
  const shopName = shop.shopName || tBrand("name")

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-4 pb-8 md:max-w-5xl md:px-8 md:pt-6">
      <section className="home-rise nb-border nb-shadow rounded-2xl bg-primary p-5 text-primary-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-wider opacity-85">{t("welcome")}</p>
            <h1 className="mt-1.5 font-playfair text-3xl italic leading-tight">{shopName}</h1>
            <p className="mt-2 max-w-[30ch] text-xs leading-relaxed opacity-90">{t("scanMessage")}</p>
          </div>
          <Coffee className="h-14 w-14 shrink-0 opacity-90" aria-hidden />
        </div>
        <div className="mt-4 flex flex-col gap-2 md:max-w-sm">
          <ScanQrButton />
          <Button variant="outline" className="h-11 w-full bg-card text-foreground" render={<Link href="/menu" />} nativeButton={false}>
            {t("viewMenu")}
          </Button>
        </div>
      </section>

      {bestSellers.length > 0 && (
        <section className="home-rise" style={{ animationDelay: "90ms" }}>
          <h2 className="mb-2 text-sm font-extrabold text-card-foreground">{t("bestSellers")}</h2>
          <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-6">
            {bestSellers.map((item) => (
              <li key={item.id} className="w-40 shrink-0 snap-start md:w-auto">
                <Link href={`/menu/${item.id}`} className="nb-border nb-shadow-sm block overflow-hidden rounded-xl bg-card">
                  <ItemImage item={item} className="aspect-square w-full" sizes="(max-width: 768px) 160px, 200px" />
                  <div className="p-2.5">
                    <p className="truncate text-sm font-extrabold text-card-foreground">
                      {locale === "vi" ? item.nameVi : item.nameEn}
                    </p>
                    <p className="mt-0.5 text-sm font-extrabold text-price">{formatVND(item.basePrice)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(shop.address || shop.openingHours || shop.phone) && (
        <section className="home-rise nb-border nb-shadow-sm flex flex-col gap-2.5 rounded-xl bg-card p-3.5" style={{ animationDelay: "180ms" }}>
          <p className="text-sm font-extrabold text-card-foreground">{shopName}</p>
          {shop.address && (
            <p className="flex items-start gap-2 text-xs font-semibold leading-relaxed text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden />
              {shop.address}
            </p>
          )}
          {shop.openingHours && (
            <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0 text-secondary" aria-hidden />
              {shop.openingHours}
            </p>
          )}
          {shop.phone && (
            <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Phone className="h-4 w-4 shrink-0 text-secondary" aria-hidden />
              {shop.phone}
            </p>
          )}
          <p className="text-[11px] font-semibold leading-relaxed text-muted-foreground">{t("storeNote")}</p>
        </section>
      )}
    </div>
  )
}
