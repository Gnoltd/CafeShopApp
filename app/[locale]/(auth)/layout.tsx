import { CustomerHeader } from "@/components/customer/header"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CustomerHeader />
      <div className="flex min-h-[calc(100dvh-56px)] items-center justify-center py-8 md:min-h-[calc(100dvh-64px)]">{children}</div>
    </>
  )
}
