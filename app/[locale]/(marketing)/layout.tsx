import { BottomNav } from "@/components/customer/bottom-nav"

// No CustomerHeader here: the landing hero's LandingNav is the header for this
// route; a second brand bar above the 100dvh hero pushes its bottom CTAs
// underneath the fixed BottomNav.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="min-h-dvh pb-20 md:pb-0">{children}</div>
      <BottomNav />
    </>
  )
}
