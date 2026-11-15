import { describe, it, expect } from "vitest"
import {
  canAccessAdmin,
  canAccessRoute,
  resolveRedirect,
  getAdminNavItems,
  getAdminExternalNavItems,
  getOperationsNavItems,
} from "./roles"

describe("canAccessAdmin", () => {
  it("returns true for manager", () => {
    expect(canAccessAdmin("manager")).toBe(true)
  })

  it("returns true for admin", () => {
    expect(canAccessAdmin("admin")).toBe(true)
  })

  it("returns false for staff", () => {
    expect(canAccessAdmin("staff")).toBe(false)
  })

  it("returns false for customer", () => {
    expect(canAccessAdmin("customer")).toBe(false)
  })

  it("returns false for null (logged out)", () => {
    expect(canAccessAdmin(null)).toBe(false)
  })
})

describe("canAccessRoute", () => {
  it("allows public customer routes for any role including null", () => {
    for (const path of ["/", "/menu", "/menu/item-1", "/table/token-1", "/login"]) {
      expect(canAccessRoute(path, null)).toBe(true)
      expect(canAccessRoute(path, "customer")).toBe(true)
      expect(canAccessRoute(path, "staff")).toBe(true)
    }
  })

  it("gates /staff/* to staff, manager, and admin", () => {
    expect(canAccessRoute("/staff/orders", "staff")).toBe(true)
    expect(canAccessRoute("/staff/tables", "manager")).toBe(true)
    expect(canAccessRoute("/staff/orders", "admin")).toBe(true)
    expect(canAccessRoute("/staff/orders", "customer")).toBe(false)
    expect(canAccessRoute("/staff/orders", null)).toBe(false)
  })

  it("gates /admin/menu to manager and admin only", () => {
    expect(canAccessRoute("/admin/menu", "manager")).toBe(true)
    expect(canAccessRoute("/admin/menu", "admin")).toBe(true)
    expect(canAccessRoute("/admin/menu", "staff")).toBe(false)
    expect(canAccessRoute("/admin/menu", "customer")).toBe(false)
    expect(canAccessRoute("/admin/menu", null)).toBe(false)
  })

  it("gates /admin/staff and /admin/settings strictly to admin", () => {
    for (const path of ["/admin/staff", "/admin/staff/sub", "/admin/settings"]) {
      expect(canAccessRoute(path, "admin")).toBe(true)
      expect(canAccessRoute(path, "manager")).toBe(false)
      expect(canAccessRoute(path, "staff")).toBe(false)
      expect(canAccessRoute(path, "customer")).toBe(false)
      expect(canAccessRoute(path, null)).toBe(false)
    }
  })

  it("matches route prefixes on segment boundaries", () => {
    expect(canAccessRoute("/staffing", null)).toBe(true)
    expect(canAccessRoute("/admin-help", null)).toBe(true)
    expect(canAccessRoute("/admin/staffing", "manager")).toBe(true)
  })
})

describe("resolveRedirect", () => {
  it("returns null when access is permitted", () => {
    expect(resolveRedirect("/staff/orders", "staff")).toBeNull()
    expect(resolveRedirect("/admin/menu", "manager")).toBeNull()
    expect(resolveRedirect("/admin/staff", "admin")).toBeNull()
    expect(resolveRedirect("/admin/settings", "admin")).toBeNull()
  })

  it("redirects unauthenticated visitors to /login", () => {
    expect(resolveRedirect("/staff/orders", null)).toBe("/login")
    expect(resolveRedirect("/admin/menu", null)).toBe("/login")
    expect(resolveRedirect("/admin/staff", null)).toBe("/login")
  })

  it("redirects manager away from admin-only routes to /staff/orders", () => {
    expect(resolveRedirect("/admin/staff", "manager")).toBe("/staff/orders")
    expect(resolveRedirect("/admin/settings", "manager")).toBe("/staff/orders")
  })

  it("redirects staff away from all /admin routes to /staff/orders", () => {
    expect(resolveRedirect("/admin", "staff")).toBe("/staff/orders")
    expect(resolveRedirect("/admin/menu", "staff")).toBe("/staff/orders")
    expect(resolveRedirect("/admin/staff", "staff")).toBe("/staff/orders")
  })

  it("redirects customer away from staff/admin routes to /menu", () => {
    expect(resolveRedirect("/staff/orders", "customer")).toBe("/menu")
    expect(resolveRedirect("/admin/menu", "customer")).toBe("/menu")
    expect(resolveRedirect("/admin/staff", "customer")).toBe("/menu")
  })
})

describe("navigation policy filters", () => {
  it("filters admin nav items strictly by role", () => {
    expect(getAdminNavItems("admin").map((i) => i.href)).toEqual([
      "/admin/menu",
      "/admin/staff",
      "/admin/settings",
    ])
    expect(getAdminNavItems("manager").map((i) => i.href)).toEqual(["/admin/menu"])
    expect(getAdminNavItems("staff")).toEqual([])
    expect(getAdminNavItems(null)).toEqual([])
  })

  it("filters external admin links by role", () => {
    expect(getAdminExternalNavItems("manager").map((i) => i.href)).toEqual(["/staff/orders"])
    expect(getAdminExternalNavItems("admin").map((i) => i.href)).toEqual(["/staff/orders"])
    expect(getAdminExternalNavItems("customer")).toEqual([])
    expect(getAdminExternalNavItems(null)).toEqual([])
  })

  it("filters operations switcher tabs by role", () => {
    expect(getOperationsNavItems("staff").map((i) => i.href)).toEqual(["/staff/orders", "/staff/tables"])
    expect(getOperationsNavItems("manager").map((i) => i.href)).toEqual([
      "/staff/orders",
      "/staff/tables",
      "/admin/menu",
    ])
    expect(getOperationsNavItems("admin").map((i) => i.href)).toEqual([
      "/staff/orders",
      "/staff/tables",
      "/admin/menu",
      "/admin/staff",
      "/admin/settings",
    ])
    expect(getOperationsNavItems("customer")).toEqual([])
    expect(getOperationsNavItems(null)).toEqual([])
  })
})
