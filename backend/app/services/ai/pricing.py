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
# Source per 2026-05 (verified web search):
# - Anthropic: https://www.anthropic.com/pricing
# - Mistral:   https://mistral.ai/pricing
PRICES: dict[str, tuple[Decimal, Decimal]] = {
    # Anthropic Claude 4.x
    "claude-haiku-4-5":  (Decimal("1.00"), Decimal("5.00")),
    "claude-sonnet-4-6": (Decimal("3.00"), Decimal("15.00")),
    "claude-opus-4-7":   (Decimal("15.00"), Decimal("75.00")),
    # Mistral (May 2026 rates -- Large 3 turun signifikan)
    "mistral-ocr-latest":   (Decimal("0.10"), Decimal("0.30")),
    # Aliases yg di-resolve API server-side ke versi terbaru
    "mistral-large-latest": (Decimal("0.50"), Decimal("1.50")),  # alias -> Large 3
    "mistral-small-latest": (Decimal("0.15"), Decimal("0.60")),  # alias -> Small 4
    "mistral-medium-latest": (Decimal("1.50"), Decimal("7.50")),
    # Versi konkret (utk fine-grained tracking)
    "mistral-large-2512": (Decimal("0.50"), Decimal("1.50")),    # Mistral Large 3
    "mistral-small-2603": (Decimal("0.15"), Decimal("0.60")),    # Mistral Small 4
    "mistral-large-2411": (Decimal("2.00"), Decimal("6.00")),    # Large 2.1 (older)
    "pixtral-large-latest": (Decimal("2.00"), Decimal("6.00")),  # Vision (older)
    # Ministral (super murah)
    "ministral-8b-latest": (Decimal("0.10"), Decimal("0.10")),
    "ministral-3b-latest": (Decimal("0.04"), Decimal("0.04")),
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
