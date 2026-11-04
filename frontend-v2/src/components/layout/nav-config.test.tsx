import { describe, expect, it } from "vitest"

import {
  DESKTOP_NAV,
  filterNavGroups,
  filterNavItems,
  MOBILE_BOTTOM_NAV,
  MOBILE_MORE_NAV,
} from "./nav-config"

const flatten = <T,>(groups: Array<{ items: T[] }>): T[] =>
  groups.flatMap((group) => group.items)

describe("navigation contract", () => {
  it("keeps desktop routes unique", () => {
    const routes = flatten(DESKTOP_NAV).map((item) => item.to)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it("exposes every desktop menu policy on mobile", () => {
    const desktopIds = flatten(DESKTOP_NAV).flatMap((item) => (item.id ? [item.id] : []))
    const mobileIds = [...MOBILE_BOTTOM_NAV, ...flatten(MOBILE_MORE_NAV)].flatMap((item) =>
      item.id ? [item.id] : [],
    )
    expect(new Set(mobileIds)).toEqual(new Set(desktopIds))
  })

  it("removes denied groups and retains only explicitly allowed menu items", () => {
    const filtered = filterNavGroups(DESKTOP_NAV, new Set(["dashboard", "reports"]))
    expect(filtered.map((group) => group.label)).toEqual(["Command Center", "Analisis"])
    expect(flatten(filtered).map((item) => item.to)).toEqual([
      "/dashboard",
      "/action-center",
      "/reports",
    ])
  })

  it("keeps the unguarded mobile aggregator available", () => {
    const filtered = filterNavItems(MOBILE_BOTTOM_NAV, new Set())
    expect(filtered.map((item) => item.to)).toEqual(["/more"])
  })

  it("places decisions before domain modules on mobile", () => {
    expect(MOBILE_BOTTOM_NAV.slice(0, 2).map((item) => item.to)).toEqual([
      "/dashboard",
      "/action-center",
    ])
  })
})
