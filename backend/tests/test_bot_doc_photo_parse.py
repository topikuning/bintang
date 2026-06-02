"""Test parse_doc_cmd: caption parsing utk doc commands (audit 2026-06-02).

Verifikasi:
- Detect command head (/po, /invoice, variants)
- Extract project_hint dr "proyek X" pattern
- Extract vendor_hint dr "vendor Y" pattern
- Extract context dr "konteks:/catatan:/keterangan: ..." keyword
- Fallback: sisa teks setelah hints jadi context
"""
from __future__ import annotations

import pytest

from app.models.models import InvoiceType
from app.services.bot_doc_photo import parse_doc_cmd


def test_returns_none_for_non_command():
    assert parse_doc_cmd("") is None
    assert parse_doc_cmd("halo bot") is None
    assert parse_doc_cmd("/keluar PRJ-001 5000000") is None  # bukan doc cmd


def test_basic_po():
    spec = parse_doc_cmd("/po")
    assert spec is not None
    assert spec.entity == "PO"
    assert spec.invoice_type is None


def test_basic_invoice_default_type_in():
    spec = parse_doc_cmd("/invoice")
    assert spec is not None
    assert spec.entity == "INVOICE"
    assert spec.invoice_type == InvoiceType.IN


def test_invoice_out_variant():
    spec = parse_doc_cmd("/invoice-out")
    assert spec.entity == "INVOICE"
    assert spec.invoice_type == InvoiceType.OUT


def test_extract_project_hint():
    spec = parse_doc_cmd("/invoice proyek BMJ1")
    assert spec.project_hint == "BMJ1"
    assert spec.context is None
    assert spec.notes is None  # alias


def test_extract_vendor_hint():
    spec = parse_doc_cmd("/po vendor PT Sumber Besi proyek BMJ1")
    assert spec.vendor_hint.startswith("PT Sumber Besi")
    assert spec.project_hint == "BMJ1"


def test_explicit_context_keyword_konteks():
    spec = parse_doc_cmd(
        "/invoice proyek BMJ1 konteks: pembelian material besi tulangan"
    )
    assert spec.project_hint == "BMJ1"
    assert spec.context == "pembelian material besi tulangan"
    # Backward-compat alias.
    assert spec.notes == "pembelian material besi tulangan"


def test_explicit_context_keyword_catatan():
    spec = parse_doc_cmd("/po catatan: ini biaya konstruksi proyek")
    assert spec.context == "ini biaya konstruksi proyek"


def test_explicit_context_keyword_keterangan():
    spec = parse_doc_cmd("/invoice keterangan: overhead bulan mei")
    assert spec.context == "overhead bulan mei"


def test_fallback_context_without_keyword():
    """Tanpa keyword: text non-hint = context."""
    spec = parse_doc_cmd("/invoice proyek BMJ1 ini invoice konstruksi")
    assert spec.project_hint == "BMJ1"
    assert spec.context == "ini invoice konstruksi"


def test_multiline_context():
    """Caption multi-baris dgn keyword di akhir."""
    spec = parse_doc_cmd(
        "/invoice\nproyek BMJ1\nkonteks: invoice utk pengadaan besi & wiremesh"
    )
    assert spec.project_hint == "BMJ1"
    assert "besi" in spec.context.lower()


def test_command_aliases():
    """Aliases /buatpo, /buat-po, /inv, /invoiceIn, /invoiceOut."""
    assert parse_doc_cmd("/buatpo").entity == "PO"
    assert parse_doc_cmd("/buat-po").entity == "PO"
    assert parse_doc_cmd("/inv").invoice_type == InvoiceType.IN
    assert parse_doc_cmd("/invoiceIn").invoice_type == InvoiceType.IN
    assert parse_doc_cmd("/invoiceOut").invoice_type == InvoiceType.OUT


def test_case_insensitive_command():
    """Head command tdk case-sensitive."""
    spec = parse_doc_cmd("/INVOICE proyek bmj1")
    assert spec is not None
    assert spec.entity == "INVOICE"


def test_command_with_bot_suffix():
    """`/po@mybot` (Telegram group convention) tetap dikenali."""
    spec = parse_doc_cmd("/po@bintangbot proyek BMJ1")
    assert spec is not None
    assert spec.entity == "PO"
    assert spec.project_hint == "BMJ1"
