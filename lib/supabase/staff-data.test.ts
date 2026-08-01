import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getStaffMembers, updateStaffMember, createStaffAccount } from "./staff-data"

describe("getStaffMembers", () => {
  it("maps snake_case RPC rows to camelCase StaffMember", async () => {
    const row = {
      id: "staff-1",
      full_name: "Nguyễn Thu Hà",
      phone: "0901234567",
      role: "admin",
      is_active: true,
      email: "thuha.nguyen@phadincafe.vn",
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: [row], error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await getStaffMembers(supabase)

    expect(rpcSpy).toHaveBeenCalledWith("get_staff_members")
    expect(result).toEqual([
      {
        id: "staff-1",
        fullName: "Nguyễn Thu Hà",
        phone: "0901234567",
        role: "admin",
        isActive: true,
        email: "thuha.nguyen@phadincafe.vn",
      },
    ])
  })
})

describe("updateStaffMember", () => {
  it("updates full_name, role, and is_active in one call", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateStaffMember(supabase, "staff-1", { fullName: "New Name", role: "manager", isActive: false })

    expect(updateSpy).toHaveBeenCalledWith({ full_name: "New Name", role: "manager", is_active: false })
    expect(eqSpy).toHaveBeenCalledWith("id", "staff-1")
  })
})

describe("createStaffAccount", () => {
  it("invokes the Edge Function with the right body and returns its result", async () => {
    const invokeSpy = vi.fn(() =>
      Promise.resolve({ data: { userId: "new-id", temporaryPassword: "Abc123XyZ9" }, error: null })
    )
    const supabase = { functions: { invoke: invokeSpy } } as unknown as SupabaseClient

    const result = await createStaffAccount(supabase, {
      fullName: "Test Staffer",
      email: "test@phadincafe.dev",
      role: "staff",
    })

    expect(invokeSpy).toHaveBeenCalledWith("create-staff-account", {
      body: { fullName: "Test Staffer", email: "test@phadincafe.dev", role: "staff" },
    })
    expect(result).toEqual({ userId: "new-id", temporaryPassword: "Abc123XyZ9" })
  })

  it("throws when the Edge Function returns a body-level error", async () => {
    const invokeSpy = vi.fn(() => Promise.resolve({ data: { error: "duplicate email" }, error: null }))
    const supabase = { functions: { invoke: invokeSpy } } as unknown as SupabaseClient

    await expect(
      createStaffAccount(supabase, { fullName: "X", email: "x@x.com", role: "staff" })
    ).rejects.toThrow("duplicate email")
  })
})
