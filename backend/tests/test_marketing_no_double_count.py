"""Regression test: marketing tdk double-count di rincian proyek.

User lapor: TX OUT dgn kategori marketing dihitung 2x -- sekali di
Biaya Aktual (sum semua OUT), sekali di formula Marketing 15%.

Fix: Category.is_marketing flag + breakdown function adjustment.
Audit 2026-05-23.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.api.v1.dashboard import _project_finance_breakdown


def test_breakdown_no_marketing_actual_uses_full_aktual():
    """Tdk ada marketing aktual -> Profit Saat Ini = Cair - Aktual TOTAL."""
    r = _project_finance_breakdown(
        nilai_kontrak=Decimal("10000000000"),
        ppn_pct=Decimal("11"),
        pph_pct=Decimal("2.65"),
        marketing_pct=Decimal("15"),
        biaya_aktual=Decimal("6000000000"),
        biaya_proyeksi=Decimal("6500000000"),
        marketing_aktual=Decimal("0"),
    )
    # Cair = 10M / 1.11 - PPh
    cair = r["nilai_cair"]
    # Profit Saat Ini = Cair - biaya_aktual TOTAL (tanpa subtract marketing lagi)
    assert r["profit_now"] == pytest.approx(cair - 6000000000, rel=0.001)
    # Profit Proyeksi tetap pakai marketing reserve (budget) krn aktual=0
    assert r["profit_proj"] == pytest.approx(
        cair - r["marketing_budget"] - 6500000000, rel=0.001,
    )


def test_breakdown_marketing_actual_no_double_count():
    """Marketing aktual 500jt + biaya_aktual TOTAL 6M (incl marketing).
    Profit Saat Ini tdk subtract marketing terpisah -- cuma sekali."""
    r = _project_finance_breakdown(
        nilai_kontrak=Decimal("10000000000"),
        ppn_pct=Decimal("11"),
        pph_pct=Decimal("2.65"),
        marketing_pct=Decimal("15"),
        biaya_aktual=Decimal("6000000000"),
        biaya_proyeksi=Decimal("6500000000"),
        marketing_aktual=Decimal("500000000"),
    )
    cair = r["nilai_cair"]
    # Profit Saat Ini = Cair - 6M (sudah include 500jt marketing aktual)
    assert r["profit_now"] == pytest.approx(cair - 6000000000, rel=0.001)
    # Marketing aktual ke-expose terpisah utk info
    assert r["marketing_aktual"] == 500000000
    # Biaya non-marketing = 6M - 500jt
    assert r["biaya_aktual_non_marketing"] == 5500000000
    # Variance: actual - budget = 500jt - (15% * cair)
    assert r["marketing_variance"] == pytest.approx(
        500000000 - r["marketing_budget"], rel=0.001,
    )


def test_breakdown_marketing_actual_exceeds_budget():
    """Marketing aktual > budget. Reserve pakai aktual (lebih besar)."""
    r = _project_finance_breakdown(
        nilai_kontrak=Decimal("10000000000"),
        ppn_pct=Decimal("11"),
        pph_pct=Decimal("2.65"),
        marketing_pct=Decimal("10"),  # smaller budget
        biaya_aktual=Decimal("3000000000"),
        biaya_proyeksi=Decimal("5000000000"),
        marketing_aktual=Decimal("2000000000"),  # > 10% budget
    )
    cair = r["nilai_cair"]
    # Profit Proyeksi pakai max(budget, aktual) sbg marketing reserve.
    # marketing_budget ~ cair * 0.10 ≈ 880jt; aktual 2M -> reserve = 2M.
    assert r["marketing_budget"] < r["marketing_aktual"]
    expected_proj = cair - r["marketing_aktual"] - 5000000000
    assert r["profit_proj"] == pytest.approx(expected_proj, rel=0.001)


def test_breakdown_negative_marketing_actual_clamped():
    """Marketing aktual negatif (mis. data corrupt) clamp ke 0."""
    r = _project_finance_breakdown(
        nilai_kontrak=Decimal("1000000000"),
        ppn_pct=Decimal("11"),
        pph_pct=Decimal("2.65"),
        marketing_pct=Decimal("15"),
        biaya_aktual=Decimal("500000000"),
        biaya_proyeksi=Decimal("600000000"),
        marketing_aktual=Decimal("-100"),  # negative (shouldnt happen)
    )
    assert r["marketing_aktual"] == 0
    # Non-marketing = 500jt (clamp)
    assert r["biaya_aktual_non_marketing"] == 500000000
