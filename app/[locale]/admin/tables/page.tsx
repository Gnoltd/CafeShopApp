import { redirect } from "next/navigation"

// Table CRUD was absorbed into the new /staff/tables "Operations" area
// (Task 16) -- components/admin/tables-management.tsx/table-form.tsx are
// deleted, so this route just forwards to its replacement instead of
// rendering anything of its own. The route file itself (this page +
// layout.tsx, which still wraps in TablesProvider -- harmless for a page
// that redirects immediately) is deliberately left in place rather than
// deleted here: that's Task 18/19's job, alongside the rest of the admin
// area trim, to avoid double-deleting the same files across two tasks.
export default async function TablesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect(`/${locale}/staff/tables`)
}
