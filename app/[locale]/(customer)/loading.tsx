"use client"

// Next.js App Router convention: automatically wraps this route group's
// pages in a <Suspense> boundary, shown while a Server Component here
// suspends on data. "use client" + useTranslations so the fallback can be
// bilingual without itself needing to be async (an async fallback can't
// suspend safely -- see daily.md Task 3).
import { AsyncSkeleton } from "@/components/shared/async-state"

export default function CustomerLoading() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center justify-center px-4">
      <AsyncSkeleton variant="page" />
    </div>
  )
}
