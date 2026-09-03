import { CustomerHeader } from "@/components/customer/header"
import { CartProvider } from "@/hooks/useCart"

// CartProvider wraps this route group solely because CustomerHeader (shared
// chrome, rendered below) reads useCart() for its item-count badge -- login/
// signup/reset-password have no cart UI of their own. See the matching note
// in (marketing)/layout.tsx: Task 4's provider-scoping pass moved
// CartProvider down to just (customer) and missed this shared-header usage,
// causing a live 500 on every auth page, hotfixed here.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <CustomerHeader />
      <div className="flex min-h-[calc(100dvh-56px)] items-center justify-center py-8 md:min-h-[calc(100dvh-64px)]">{children}</div>
    </CartProvider>
  )
}
