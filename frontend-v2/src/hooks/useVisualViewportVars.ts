import { useEffect } from "react"

/**
 * Tulis ukuran area layar yang benar-benar terlihat ke variabel CSS di
 * <html>, selama komponen pemanggil terpasang:
 *   --vv-h       tinggi area terlihat (berkurang saat keyboard ponsel muncul)
 *   --vv-bottom  jarak tepi bawah area terlihat ke tepi bawah layout
 *
 * Elemen `position: fixed` di iOS menempel ke layout viewport, yang TIDAK
 * mengecil saat keyboard muncul. Tanpa ini, panel bawah tertutup keyboard
 * dan halaman meloncat-loncat saat berpindah kolom isian.
 */
export function useVisualViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const set = () => {
      const bawah = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      root.style.setProperty("--vv-h", `${vv.height}px`)
      root.style.setProperty("--vv-bottom", `${bawah}px`)
    }
    set()
    vv.addEventListener("resize", set)
    vv.addEventListener("scroll", set)
    return () => {
      vv.removeEventListener("resize", set)
      vv.removeEventListener("scroll", set)
      root.style.removeProperty("--vv-h")
      root.style.removeProperty("--vv-bottom")
    }
  }, [])
}
