import { MotionConfig } from "framer-motion"
import { CustomerHeader } from "@/components/customer/header"
import { BottomNav } from "@/components/customer/bottom-nav"
import { RouteTransition } from "@/components/motion/route-transition"

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <CustomerHeader showBack />
      <div className="min-h-dvh pb-20 md:pb-0">
        <RouteTransition>{children}</RouteTransition>
      </div>
      <BottomNav />
    </MotionConfig>
  )
}
