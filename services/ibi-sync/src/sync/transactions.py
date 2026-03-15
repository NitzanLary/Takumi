"""Parse and normalize IBI transaction data."""

import hashlib
import logging
from datetime import datetime
from typing import Any

from ..models import Transaction

logger = logging.getLogger(__name__)

# Known IBI field name mappings (Hebrew → English)
# These will be confirmed/adjusted after first live API call
FIELD_MAPPINGS: dict[str, str] = {
    # English field names (if API returns English)
    "ReferenceNumber": "trade_id",
    "SecurityName": "security_name",
    "SecuritySymbol": "ticker",
    "Quantity": "quantity",
    "Price": "price",
    "Commission": "commission",
    "TransactionDate": "trade_date",
    "Currency": "currency",
    "Exchange": "market",
    "TransactionType": "direction",
    # Common Hebrew field names (from IBI)
    "מספר אסמכתא": "trade_id",
    "שם נייר": "security_name",
    "סמל": "ticker",
    "כמות": "quantity",
    "מחיר": "price",
    "עמלה": "commission",
    "תאריך": "trade_date",
    "מטבע": "currency",
    "בורסה": "market",
    "סוג פעולה": "direction",
}

# IBI API returns minified single-letter keys in two struct types.
# These mappings normalize them to our canonical field names.
# StructAccountTransaction: older format from GetAccountTransactions
_STRUCT_ACCOUNT_TX_FIELDS: dict[str, str] = {
    "a": "_account",
    "b": "trade_date",
    "c": "_security_code",
    "d": "_ref",
    "e": "_market_code",
    "f": "security_name",
    "i": "quantity",
    "j": "direction",
    "k": "_balance",
    "l": "_signed_quantity",
    "m": "price",
    "n": "_cash_amount",
    "o": "_total",
}

# NewStructAccountTransaction: newer format from GetNewAccountTransactions
_NEW_STRUCT_ACCOUNT_TX_FIELDS: dict[str, str] = {
    "a": "_branch",
    "b": "_account",
    "c": "trade_date",
    "e": "_security_code",
    "f": "security_name",
    "g": "_ref_string",
    "h": "direction",
    "i": "_direction_desc",
    "j": "_currency_type",
    "k": "currency",
    "k2": "_currency_symbol",
    "l": "quantity",
    "m": "price",
    "n": "_net_amount",
    "o": "commission",
    "p": "_currency_type2",
    "q": "_currency_name2",
    "v": "trade_id",
    "x": "ticker",
}

MARKET_MAPPINGS: dict[str, str] = {
    "תל אביב": "TASE",
    "TASE": "TASE",
    "ת\"א": "TASE",
    "NYSE": "NYSE",
    "NASDAQ": "NASDAQ",
    "נאסד\"ק": "NASDAQ",
}

DIRECTION_MAPPINGS: dict[str, str] = {
    "קניה": "BUY",
    "קנייה": "BUY",
    "buy": "BUY",
    "BUY": "BUY",
    "ק/חו\"ל": "BUY",
    "ק/חול": "BUY",
    "קניה חול מטח": "BUY",
    "קניה שח": "BUY",
    "מכירה": "SELL",
    "sell": "SELL",
    "SELL": "SELL",
    "מכ/חו\"ל": "SELL",
    "מכ/חול": "SELL",
    "העברה": "TRANSFER",
    "הפקדה": "DEPOSIT",
    "משיכה": "WITHDRAWAL",
    "מש/עמל": "FEE",
}

CURRENCY_MAPPINGS: dict[str, str] = {
    "שקל": "ILS",
    "שקל חדש": "ILS",
    "ש\"ח": "ILS",
    "ILS": "ILS",
    "NIS": "ILS",
    "₪": "ILS",
    "דולר": "USD",
    "דולר ארה\"ב": "USD",
    "USD": "USD",
    "$": "USD",
    "אירו": "EUR",
    "EUR": "EUR",
    "€": "EUR",
}


def _expand_minified_keys(raw: dict[str, Any]) -> dict[str, Any]:
    """Expand single-letter IBI API keys to canonical field names.

    Returns a new dict with expanded keys (plus any keys that weren't mapped).
    """
    struct_type = raw.get("_t", "")
    if struct_type == "NewStructAccountTransaction":
        mapping = _NEW_STRUCT_ACCOUNT_TX_FIELDS
    elif struct_type == "StructAccountTransaction":
        mapping = _STRUCT_ACCOUNT_TX_FIELDS
    else:
        return raw  # Not a minified struct, return as-is

    expanded: dict[str, Any] = {}
    for key, val in raw.items():
        canonical = mapping.get(key, key)
        # Don't overwrite if we already have a value for this canonical name
        if canonical not in expanded:
            expanded[canonical] = val
    return expanded


def _generate_composite_id(raw: dict[str, Any]) -> str:
    """Generate a deterministic ID from transaction fields when no explicit ID exists."""
    parts = [
        str(raw.get("trade_date", "")),
        str(raw.get("_security_code", raw.get("security_name", ""))),
        str(raw.get("quantity", "")),
        str(raw.get("price", "")),
        str(raw.get("direction", "")),
        str(raw.get("_total", raw.get("_net_amount", ""))),
    ]
    composite = "|".join(parts)
    return hashlib.sha256(composite.encode()).hexdigest()[:16]


def normalize_field(raw: dict[str, Any], field: str, default: Any = None) -> Any:
    """Try to extract a field using known mappings."""
    # Direct access
    if field in raw:
        return raw[field]

    # Try mapped names
    for raw_key, mapped in FIELD_MAPPINGS.items():
        if mapped == field and raw_key in raw:
            return raw[raw_key]

    # Case-insensitive fallback
    field_lower = field.lower()
    for key, val in raw.items():
        if key.lower() == field_lower:
            return val

    return default


def parse_transaction(raw: dict[str, Any]) -> Transaction | None:
    """Parse a raw IBI transaction dict into a Transaction model."""
    try:
        # Expand minified single-letter keys from IBI API
        data = _expand_minified_keys(raw)

        trade_id = str(
            normalize_field(data, "trade_id")
            or normalize_field(data, "ReferenceNumber")
            or normalize_field(data, "Id")
            or ""
        )
        if not trade_id:
            # Generate a composite ID from available fields
            trade_id = _generate_composite_id(data)
            logger.debug(f"Generated composite ID {trade_id} for transaction: {data.get('security_name', 'unknown')}")

        ticker = str(
            normalize_field(data, "ticker")
            or normalize_field(data, "SecuritySymbol")
            or normalize_field(data, "Symbol")
            or "UNKNOWN"
        )

        security_name = str(
            normalize_field(data, "security_name")
            or normalize_field(data, "SecurityName")
            or ticker
        )

        raw_market = str(normalize_field(data, "market") or normalize_field(data, "Exchange") or "")
        market = MARKET_MAPPINGS.get(raw_market, raw_market or "TASE")

        raw_direction = str(normalize_field(data, "direction") or normalize_field(data, "TransactionType") or "")
        direction = DIRECTION_MAPPINGS.get(raw_direction, raw_direction.upper() or "BUY")

        quantity = abs(float(normalize_field(data, "quantity") or 0))
        price = float(normalize_field(data, "price") or 0)
        commission = abs(float(normalize_field(data, "commission") or 0))

        raw_currency = str(normalize_field(data, "currency") or normalize_field(data, "Currency") or "ILS")
        currency = CURRENCY_MAPPINGS.get(raw_currency, raw_currency)

        trade_date_raw = normalize_field(data, "trade_date") or normalize_field(data, "TransactionDate")
        if isinstance(trade_date_raw, str):
            # Try common date formats
            for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%fZ", "%d/%m/%Y", "%Y-%m-%d"]:
                try:
                    trade_date = datetime.strptime(trade_date_raw[:len(fmt) + 5], fmt)
                    break
                except ValueError:
                    continue
            else:
                trade_date = datetime.fromisoformat(trade_date_raw.replace("Z", "+00:00"))
        elif isinstance(trade_date_raw, (int, float)):
            trade_date = datetime.fromtimestamp(trade_date_raw / 1000)
        else:
            trade_date = datetime.now()

        return Transaction(
            trade_id=trade_id,
            ticker=ticker,
            security_name=security_name,
            market=market,
            direction=direction,
            quantity=quantity,
            price=price,
            currency=currency,
            commission=commission,
            trade_date=trade_date,
            raw=raw,
        )

    except Exception as e:
        logger.error(f"Failed to parse transaction: {e} — raw: {raw}")
        return None


def parse_transactions(raw_list: list[dict[str, Any]]) -> list[Transaction]:
    """Parse a list of raw IBI transactions, skipping invalid ones."""
    results = []
    for raw in raw_list:
        tx = parse_transaction(raw)
        if tx is not None:
            results.append(tx)

    logger.info(f"Parsed {len(results)} of {len(raw_list)} transactions")
    return results
