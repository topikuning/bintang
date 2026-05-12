import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./index.css"

// Auto-recover dari 'Failed to fetch dynamically imported module' --
// terjadi saat deploy baru: chunk filenames di-hash ulang, tapi browser
// punya index.html cached yg masih reference chunk lama. Reload sekali
// utk fetch index.html baru.
//
// Guard pakai sessionStorage supaya tdk infinite loop (kalau setelah
// reload tetap error -- real issue, biarkan UI tampil error).
const CHUNK_RELOAD_FLAG = "__chunk_reload_done__"
const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Loading chunk \d+ failed/i,
  /Importing a module script failed/i,
]

function isChunkLoadError(msg: string): boolean {
  return CHUNK_ERROR_PATTERNS.some((p) => p.test(msg))
}

function handleChunkError(msg: string): void {
  if (!isChunkLoadError(msg)) return
  if (sessionStorage.getItem(CHUNK_RELOAD_FLAG)) {
    // Sudah pernah reload tapi tetap error -> kemungkinan bukan stale cache.
    // Biarkan UI tampil utk diagnosis.
    return
  }
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1")
  // Hard reload supaya browser fetch index.html fresh (chunk hashes baru).
  window.location.reload()
}

// Clear flag setelah load berhasil (sukses render setelah reload)
window.addEventListener("load", () => {
  // Beri waktu utk first paint stabilize sebelum clear flag.
  setTimeout(() => sessionStorage.removeItem(CHUNK_RELOAD_FLAG), 5000)
})

window.addEventListener("error", (e) => {
  handleChunkError(e.message || "")
})

window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason
  const msg =
    typeof reason === "string"
      ? reason
      : reason?.message || String(reason || "")
  handleChunkError(msg)
})

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("Root element #root tidak ditemukan")

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
