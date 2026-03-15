"""Parse and normalize IBI holdings data."""

import logging
from typing import Any

from ..models import Holding

logger = logging.getLogger(__name__)


def parse_holding(raw: dict[str, Any]) -> Holding | None:
    """Parse a raw IBI holding dict into a Holding model."""
    try:
        ticker = str(
            raw.get("Symbol")
            or raw.get("SecuritySymbol")
            or raw.get("סמל")
            or "UNKNOWN"
        )
        security_name = str(
            raw.get("SecurityName")
            or raw.get("שם נייר")
            or ticker
        )

        raw_market = str(raw.get("Exchange") or raw.get("בורסה") or "TASE")
        from .transactions import MARKET_MAPPINGS
        market = MARKET_MAPPINGS.get(raw_market, raw_market)

        quantity = float(raw.get("Quantity") or raw.get("כמות") or 0)
        avg_cost = float(raw.get("AverageCost") or raw.get("מחיר ממוצע") or 0)
        current_price = float(raw.get("LastPrice") or raw.get("שער אחרון") or 0)

        raw_currency = str(raw.get("Currency") or raw.get("מטבע") or "ILS")
        from .transactions import CURRENCY_MAPPINGS
        currency = CURRENCY_MAPPINGS.get(raw_currency, raw_currency)

        market_value = float(raw.get("MarketValue") or raw.get("שווי שוק") or (quantity * current_price))

        return Holding(
            ticker=ticker,
            security_name=security_name,
            market=market,
            quantity=quantity,
            avg_cost=avg_cost,
            current_price=current_price,
            currency=currency,
            market_value=market_value,
        )

    except Exception as e:
        logger.error(f"Failed to parse holding: {e} — raw: {raw}")
        return None


def parse_holdings(raw_list: list[dict[str, Any]]) -> list[Holding]:
    """Parse a list of raw IBI holdings."""
    results = []
    for raw in raw_list:
        h = parse_holding(raw)
        if h is not None:
            results.append(h)
    logger.info(f"Parsed {len(results)} of {len(raw_list)} holdings")
    return results
