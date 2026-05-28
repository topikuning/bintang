import { useEffect } from "react"

/**
 * Set browser tab title sesuai page. Format: "Title · CACAK".
 * Cleanup di unmount supaya title reset ke parent-route value.
 */
export function usePageTitle(title: string | undefined | null) {
  useEffect(() => {
    if (!title) return
    const prev = document.title
    document.title = `${title} · CACAK`
    return () => {
      document.title = prev
    }
  }, [title])
}
