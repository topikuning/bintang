import { useEffect, useState } from "react"

/**
 * Return value yang ter-debounce. Berguna utk search input supaya
 * react-query tdk re-fetch setiap keystroke -- cuma fire kalau user
 * berhenti ngetik selama `delay` ms.
 *
 * Pemakaian:
 *   const [q, setQ] = useState("")
 *   const dq = useDebouncedValue(q, 300)
 *   const params = useMemo(() => ({ q: dq || undefined }), [dq])
 *   const query = useApi(params)
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
