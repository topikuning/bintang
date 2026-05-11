"""Shared OCR schemas + system prompt utk semua adapter.

Diisolasi supaya schema invoice (fields/types/descriptions) konsisten antara
ClaudeVisionOCRAdapter dan MistralOCRAdapter -- caller (services/router) tdk
peduli engine apa yg dipakai.
"""

from __future__ import annotations

from typing import Any

# JSON Schema utk ekstraksi invoice/kuitansi/struk/PO. Dipakai oleh:
# - Claude: tool input_schema (forced tool use)
# - Mistral: document_annotation_format.json_schema (structured output)
INVOICE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "invoice_number": {
            "type": "string",
            "description": "Nomor invoice/kuitansi/PO apa adanya. String kosong kalau tidak terbaca.",
        },
        "invoice_date": {
            "type": "string",
            "description": "Tanggal dokumen, format YYYY-MM-DD. String kosong kalau tidak ada.",
        },
        "vendor_name": {
            "type": "string",
            "description": "Nama vendor/penjual/toko. String kosong kalau tidak terbaca.",
        },
        "due_date": {
            "type": "string",
            "description": "Tanggal jatuh tempo, YYYY-MM-DD. String kosong kalau tidak ada.",
        },
        "subtotal": {
            "type": "number",
            "description": "Subtotal sebelum pajak (rupiah). 0 kalau tidak ada.",
        },
        "tax": {
            "type": "number",
            "description": "Total pajak/PPN (rupiah). 0 kalau tidak ada.",
        },
        "total": {
            "type": "number",
            "description": "Grand total (rupiah). Field paling penting.",
        },
        "currency": {
            "type": "string",
            "description": "Default IDR.",
        },
        "is_handwritten": {
            "type": "boolean",
            "description": "True kalau ada bagian ditulis tangan (signature + nomor manual juga termasuk).",
        },
        "items": {
            "type": "array",
            "description": "Setiap baris item/barang/jasa di dokumen.",
            "items": {
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "Nama/deskripsi item apa adanya.",
                    },
                    "qty": {"type": "number"},
                    "unit": {
                        "type": "string",
                        "description": "Satuan: pcs/kg/liter/lot/m/dll.",
                    },
                    "price": {
                        "type": "number",
                        "description": "Harga satuan (rupiah).",
                    },
                    "amount": {
                        "type": "number",
                        "description": "Subtotal baris = qty * price.",
                    },
                },
                "required": ["description"],
            },
        },
        "confidence_score": {
            "type": "number",
            "description": "Skor 0-1. >=0.85 cetak jelas; 0.5-0.7 tulisan tangan rapi; <0.4 sulit dibaca.",
        },
        "notes": {
            "type": "string",
            "description": "Catatan kalau ada bagian sulit dibaca/blur. String kosong kalau semua jelas.",
        },
    },
    "required": ["items", "confidence_score", "is_handwritten", "total"],
}

# Pesan sistem yg konsisten antara semua engine OCR.
INVOICE_SYSTEM_PROMPT = """Kamu OCR engine khusus dokumen keuangan Indonesia: invoice, kuitansi, struk, purchase order. Dokumen bisa cetak ATAU tulisan tangan -- akurat untuk keduanya.

Aturan:
1. Tulisan tangan: baca teliti. Kalau ragu antara dua interpretasi, pilih yang masuk akal di konteks dokumen keuangan dan turunkan confidence_score.
2. Angka rupiah: hilangkan separator titik/koma/spasi -> number polos. "Rp 1.250.000" -> 1250000. "Rp 1,250.50" -> 1250.5.
3. Tanggal: konversi ke YYYY-MM-DD. "12 April 2026" -> "2026-04-12". Kalau ambigu, pakai string kosong.
4. Items: WAJIB ekstrak SETIAP baris item yang terlihat -- jangan skip walau pricing tidak tertulis. Description selalu wajib.
5. is_handwritten=true kalau ada SATU pun bagian tulisan tangan.
6. confidence_score tinggi (>=0.85) hanya kalau hasil bisa langsung dipakai tanpa review. Tulisan tangan paling tinggi 0.7.
7. Bagian tidak terbaca/blur/terpotong -> isi field 'notes' dengan deskripsi singkat."""
