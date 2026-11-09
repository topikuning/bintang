import "server-only";
import ExcelJS from "exceljs";

/**
 * Pembuat buku Excel. Angka rupiah ditulis sebagai ANGKA (bukan teks) dengan
 * format ribuan, jadi bisa langsung dijumlah/diolah di Excel. Nilai dihitung
 * di calculation layer – di sini hanya ditata.
 */

export type Kolom = { header: string; key: string; width?: number; uang?: boolean; tanggal?: boolean };

export function bukuBaru(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bintang";
  wb.created = new Date();
  return wb;
}

export function tambahSheet(
  wb: ExcelJS.Workbook,
  nama: string,
  judul: string,
  sub: string,
  kolom: Kolom[],
  baris: Record<string, unknown>[],
  total?: Record<string, unknown>,
) {
  const ws = wb.addWorksheet(nama, { views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = kolom.map((k) => ({ key: k.key, width: k.width ?? (k.uang ? 18 : 16) }));
  ws.getCell("A1").value = judul;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = sub;
  ws.getCell("A2").font = { color: { argb: "FF64748B" } };
  const header = ws.getRow(4);
  kolom.forEach((k, i) => {
    const c = header.getCell(i + 1);
    c.value = k.header;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4338CA" } };
    c.alignment = { vertical: "middle", horizontal: k.uang ? "right" : "left" };
  });
  header.height = 20;
  for (const b of baris) {
    const r = ws.addRow(kolom.map((k) => konversi(b[k.key], k)));
    kolom.forEach((k, i) => {
      if (k.uang) r.getCell(i + 1).numFmt = "#,##0;[Red]-#,##0";
      if (k.tanggal) r.getCell(i + 1).numFmt = "dd/mm/yyyy";
    });
  }
  if (total) {
    const r = ws.addRow(kolom.map((k) => konversi(total[k.key], k)));
    r.font = { bold: true };
    kolom.forEach((k, i) => {
      if (k.uang) r.getCell(i + 1).numFmt = "#,##0;[Red]-#,##0";
      r.getCell(i + 1).border = { top: { style: "thin" } };
    });
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: kolom.length } };
  return ws;
}

function konversi(v: unknown, k: Kolom): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v); // aman sampai 9 kuadriliun
  if (k.tanggal && v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  return v;
}

export async function responsXlsx(wb: ExcelJS.Workbook, namaBerkas: string): Promise<Response> {
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${namaBerkas}"`,
      "Cache-Control": "no-store",
    },
  });
}
