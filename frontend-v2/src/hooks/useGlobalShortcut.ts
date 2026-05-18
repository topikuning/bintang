import { useEffect } from "react"

interface Options {
  /** Modifier key combos. Default: ["Meta+k", "Control+k"] (Cmd/Ctrl + K). */
  combos?: string[]
  /** Skip kalau focus di input/textarea (default true) -- supaya tdk
   * conflict dgn typing biasa. */
  skipInInputs?: boolean
}

/**
 * Global keyboard shortcut listener. Pass combos sbg `"Meta+k"` /
 * `"Control+/"` / `"Escape"` (case insensitive).
 *
 * Saat skipInInputs=true (default), Esc tetap di-handle (utk close
 * modal/dropdown), tapi combo lain di-skip kalau focus di
 * input/textarea/contenteditable.
 */
export function useGlobalShortcut(
  onTrigger: () => void,
  options: Options = {},
) {
  const { combos = ["Meta+k", "Control+k"], skipInInputs = true } = options

  useEffect(() => {
    const normalize = (s: string) => s.toLowerCase()
    const targets = combos.map(normalize)

    const handler = (e: KeyboardEvent) => {
      // Skip kalau di input field (kecuali combo Escape).
      if (skipInInputs) {
        const t = e.target as HTMLElement | null
        const tag = t?.tagName?.toLowerCase()
        const editable = t?.isContentEditable
        const inField = tag === "input" || tag === "textarea" || tag === "select" || editable
        if (inField && e.key !== "Escape") return
      }

      const parts: string[] = []
      if (e.metaKey) parts.push("Meta")
      if (e.ctrlKey) parts.push("Control")
      if (e.shiftKey) parts.push("Shift")
      if (e.altKey) parts.push("Alt")
      parts.push(e.key)
      const combo = normalize(parts.join("+"))

      if (targets.includes(combo)) {
        e.preventDefault()
        onTrigger()
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onTrigger, combos, skipInInputs])
}
