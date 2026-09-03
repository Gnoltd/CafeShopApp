"use client"

// Route-level Suspense fallback for /admin/*. Dense, matching this area's
// existing density convention (see components/admin/CLAUDE.md).
import { AsyncSkeleton } from "@/components/shared/async-state"

export default function AdminLoading() {
  return (
    <div className="p-4">
      <AsyncSkeleton variant="list" rows={5} />
    </div>
  )
}
