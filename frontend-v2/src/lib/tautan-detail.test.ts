import { describe, expect, it } from "vitest"

// Detail transaksi/invoice/PO dibuka lewat daftar + ?id=N (drawer), bukan
// /transactions/N. Tautan model lama pernah berujung 404 di aplikasi.
const sumber = import.meta.glob("../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const POLA_LAMA = /to=\{`\/(transactions|invoices|purchase-orders)\/\$\{/

describe("tautan detail", () => {
  it("memakai ?id= untuk transaksi, invoice, dan PO", () => {
    const salah = Object.entries(sumber)
      .filter(([berkas]) => !berkas.endsWith("routes.tsx"))
      .flatMap(([berkas, isi]) =>
        isi
          .split("\n")
          .map((baris, i) => ({ berkas, no: i + 1, baris }))
          .filter(({ baris }) => POLA_LAMA.test(baris) || baris.includes("/transactions?open=")),
      )
      .map(({ berkas, no, baris }) => `${berkas}:${no}: ${baris.trim()}`)
    expect(salah).toEqual([])
  })

  it("mengalihkan bookmark lama /x/:id ke daftar", () => {
    const rute = sumber["../routes.tsx"]
    for (const x of ["transactions", "invoices", "purchase-orders"]) {
      expect(rute).toContain(`path: "${x}/:id", element: <RedirectDetail ke="${x}" />`)
    }
  })
})
