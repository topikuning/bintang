/**
 * Breakpoint detection -- 3-tier (mobile/tablet/desktop) sesuai design system.
 *
 * mobile  : < 768px   (HP)
 * tablet  : 768-1023  (tablet portrait, landscape)
 * desktop : >= 1024px (laptop, desktop)
 *
 * SSR-safe (default ke "desktop" saat tidak ada window).
 */
import { useEffect, useState } from "react"

export type Breakpoint = "mobile" | "tablet" | "desktop"

const MQL = {
  mobile: "(max-width: 767px)",
  tablet: "(min-width: 768px) and (max-width: 1023px)",
  desktop: "(min-width: 1024px)",
} as const

function detect(): Breakpoint {
  if (typeof window === "undefined") return "desktop"
  if (window.matchMedia(MQL.mobile).matches) return "mobile"
  if (window.matchMedia(MQL.tablet).matches) return "tablet"
  return "desktop"
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(detect)

  useEffect(() => {
    const mqlMobile = window.matchMedia(MQL.mobile)
    const mqlTablet = window.matchMedia(MQL.tablet)
    const handler = () => setBp(detect())
    mqlMobile.addEventListener("change", handler)
    mqlTablet.addEventListener("change", handler)
    return () => {
      mqlMobile.removeEventListener("change", handler)
      mqlTablet.removeEventListener("change", handler)
    }
  }, [])

  return bp
}

export function isMobile(bp: Breakpoint): boolean {
  return bp === "mobile"
}
export function isTablet(bp: Breakpoint): boolean {
  return bp === "tablet"
}
export function isDesktop(bp: Breakpoint): boolean {
  return bp === "desktop"
}
