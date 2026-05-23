"""Per-model price estimate (USD per 1M token). Audit 2026-05-23 AI foundation.

Update manual saat provider naik/turun price. Source:
- https://www.anthropic.com/pricing  (Anthropic API)
- https://mistral.ai/technology  (Mistral)

Cost estimate dipakai utk:
- Display di UI ("biaya OCR ini: ~$0.005")
- Per-user/-tenant analytics (budgeting)
- Auto-fallback decision (cheap model dulu, mahal kalau perlu)

Default fallback kalau model unknown: input $5 / output $25 / 1M (worst case).
"""
from __future__ import annotations

from decimal import Decimal

# Format: model_name -> (input_per_mtok_usd, output_per_mtok_usd)
PRICES: dict[str, tuple[Decimal, Decimal]] = {
    # Anthropic Claude 4.x (per 2026-05)
    "claude-haiku-4-5":  (Decimal("1.00"), Decimal("5.00")),
    "claude-sonnet-4-6": (Decimal("3.00"), Decimal("15.00")),
    "claude-opus-4-7":   (Decimal("15.00"), Decimal("75.00")),
    # Mistral
    "mistral-ocr-latest":   (Decimal("0.10"), Decimal("0.30")),
    "mistral-large-latest": (Decimal("2.00"), Decimal("6.00")),
    "mistral-small-latest": (Decimal("0.20"), Decimal("0.60")),
}

_FALLBACK = (Decimal("5"), Decimal("25"))


def estimate_cost(
    model: str,
    *,
    input_tokens: int,
    output_tokens: int,
) -> Decimal:
    """Return estimasi cost USD (Decimal). Round to 6 decimal places."""
    in_price, out_price = PRICES.get(model, _FALLBACK)
    cost = (
        in_price * Decimal(input_tokens) / Decimal(1_000_000)
        + out_price * Decimal(output_tokens) / Decimal(1_000_000)
    )
    return cost.quantize(Decimal("0.000001"))
