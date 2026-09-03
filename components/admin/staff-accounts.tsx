"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { User, Lock, LockOpen, Plus, Pencil, Users, UserCheck, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { getStaffMembers, updateStaffMember, createStaffAccount, type StaffMember, type StaffRole } from "@/lib/supabase/staff-data"
import { StaffMemberForm } from "@/components/admin/staff-member-form"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"

const ROLE_STYLES: Record<StaffRole, string> = {
  admin: "bg-primary/10 text-primary",
  manager: "bg-secondary/10 text-secondary",
  staff: "bg-accent/20 text-accent-foreground",
}

const PAGE_SIZE = 5

type FormMode = { type: "add" } | { type: "edit"; member: StaffMember } | null

export function StaffAccounts() {
  const t = useTranslations("AdminStaff")
  const [supabase] = useState(() => createClient())
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)

  const loadStaff = useCallback(async ({ isStale }: LoadContext) => {
    try {
      const rows = await getStaffMembers(supabase)
      if (isStale()) return
      setStaff(rows)
      setError(null)
    } catch (loadError) {
      if (!isStale()) setError(t("loadError"))
      throw loadError
    }
  }, [supabase, t])
  const { run: refetch } = useLatestRefetch(loadStaff, 0)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) setCurrentUserId(user?.id ?? null)
    })

    async function loadInitialStaff() {
      await refetch()
      if (!cancelled) setIsLoading(false)
    }
    void loadInitialStaff()

    const channel = supabase
      .channel("staff-accounts-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        if (!cancelled) void refetch()
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" && status !== "CLOSED") {
          console.warn(`Staff accounts realtime subscription status: ${status}`)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [refetch, supabase])

  const totalPages = Math.max(1, Math.ceil(staff.length / PAGE_SIZE))
  const visiblePage = Math.min(currentPage, totalPages)
  const pageStart = (visiblePage - 1) * PAGE_SIZE
  const pagedStaff = useMemo(() => staff.slice(pageStart, pageStart + PAGE_SIZE), [staff, pageStart])

  const activeCount = staff.filter((member) => member.isActive).length

  async function toggleActive(member: StaffMember) {
    setError(null)
    try {
      await updateStaffMember(supabase, member.id, {
        fullName: member.fullName,
        role: member.role,
        isActive: !member.isActive,
      })
    } catch {
      setError(t("saveError"))
    }
  }

  async function saveMember(input: { fullName: string; email: string; role: StaffRole; isActive: boolean }) {
    setError(null)
    try {
      if (formMode?.type === "edit") {
        await updateStaffMember(supabase, formMode.member.id, {
          fullName: input.fullName,
          role: input.role,
          isActive: input.isActive,
        })
        setFormMode(null)
      } else {
        const result = await createStaffAccount(supabase, {
          fullName: input.fullName,
          email: input.email,
          role: input.role,
        })
        setFormMode(null)
        setCreatedPassword(result.temporaryPassword)
      }
    } catch {
      setError(t("saveError"))
    }
  }

  const roleLabel = (role: StaffRole) =>
    role === "admin" ? t("roleAdmin") : role === "manager" ? t("roleManager") : t("roleStaff")

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-card-foreground">{t("title")}</h2>
        <Button variant="neubrutal" className="h-10 gap-2" onClick={() => setFormMode({ type: "add" })}>
          <Plus className="h-4 w-4" />
          {t("addStaff")}
        </Button>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {createdPassword && (
        <div className="nb-border-sm flex items-center justify-between gap-3 rounded-lg bg-chip px-4 py-3">
          <div>
            <p className="text-sm font-bold text-card-foreground">{t("passwordCreatedTitle")}</p>
            <p className="font-mono text-sm text-primary">{createdPassword}</p>
            <p className="text-xs text-muted-foreground">{t("passwordCreatedNote")}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(createdPassword)}
          >
            {t("copyPassword")}
          </Button>
        </div>
      )}

      {formMode && (
        <StaffMemberForm
          initialMember={formMode.type === "edit" ? formMode.member : undefined}
          disableActiveToggle={formMode.type === "edit" && formMode.member.id === currentUserId}
          onCancel={() => setFormMode(null)}
          onSave={saveMember}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="nb-border-sm nb-shadow-sm flex items-center gap-3 rounded-xl bg-card p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("totalStaff")}</p>
            <p className="text-xl font-bold text-card-foreground">{staff.length}</p>
          </div>
        </div>
        <div className="nb-border-sm nb-shadow-sm flex items-center gap-3 rounded-xl bg-card p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("activeCount")}</p>
            <p className="text-xl font-bold text-card-foreground">{activeCount}</p>
          </div>
        </div>
        <div className="nb-border-sm nb-shadow-sm flex items-center gap-3 rounded-xl bg-card p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserX className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("inactiveCount")}</p>
            <p className="text-xl font-bold text-card-foreground">{staff.length - activeCount}</p>
          </div>
        </div>
      </div>

      <div className="nb-border-sm nb-shadow-sm overflow-x-auto rounded-xl bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("name")}</th>
              <th className="px-4 py-3 font-medium">{t("email")}</th>
              <th className="px-4 py-3 font-medium">{t("role")}</th>
              <th className="px-4 py-3 font-medium">{t("status")}</th>
              <th className="px-4 py-3 text-right font-medium">
                <span className="sr-only">{t("status")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  {t("loading")}
                </td>
              </tr>
            ) : (
              pagedStaff.map((member) => (
                <tr key={member.id} className={cn(!member.isActive && "opacity-60")}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <User className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-bold text-card-foreground">{member.fullName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{member.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "nb-border-sm rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide",
                        ROLE_STYLES[member.role]
                      )}
                    >
                      {roleLabel(member.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 rounded-full", member.isActive ? "bg-green-500" : "bg-muted-foreground")} />
                      <span className="text-card-foreground">{member.isActive ? t("active") : t("disabled")}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setFormMode({ type: "edit", member })}
                        aria-label={t("edit")}
                        title={t("edit")}
                        className="rounded-lg p-2 text-secondary transition-colors hover:bg-secondary/10"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(member)}
                        disabled={member.id === currentUserId}
                        className={cn(
                          "rounded-lg p-2 transition-colors disabled:pointer-events-none disabled:opacity-30",
                          member.isActive
                            ? "text-destructive hover:bg-destructive/10"
                            : "text-green-600 hover:bg-green-100"
                        )}
                        title={member.id === currentUserId ? t("cannotDisableSelf") : member.isActive ? t("disabled") : t("active")}
                      >
                        {member.isActive ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="flex flex-col items-center justify-between gap-3 border-t bg-muted/40 px-4 py-3 sm:flex-row">
          <span className="text-xs text-muted-foreground">
            {t("showingItems", {
              start: staff.length === 0 ? 0 : pageStart + 1,
              end: Math.min(pageStart + PAGE_SIZE, staff.length),
              total: staff.length,
            })}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={visiblePage === 1}
              className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {t("previous")}
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={cn(
                  "nb-border-sm nb-press-sm rounded-lg px-3 py-1 text-xs font-extrabold",
                  page === visiblePage
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground"
                )}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={visiblePage === totalPages}
              className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {t("next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
