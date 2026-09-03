"use client"

// Route-level Suspense fallback for /staff/*. Denser than the customer
// version, matching this area's existing density convention (see
// components/staff/CLAUDE.md) -- a thin top strip rather than a
// centered full-screen placeholder, since staff screens are worked
// against all day.
import { AsyncSkeleton } from "@/components/shared/async-state"

export default function StaffLoading() {
  return (
    <div className="p-3">
      <AsyncSkeleton variant="list" rows={4} />
    </div>
  )
}
