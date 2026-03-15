from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class Transaction(BaseModel):
    trade_id: str
    ticker: str
    security_name: str
    market: str  # TASE | NYSE | NASDAQ
    direction: str  # BUY | SELL
    quantity: float
    price: float
    currency: str  # ILS | USD
    commission: float = 0.0
    trade_date: datetime
    raw: Optional[dict] = None


class Holding(BaseModel):
    ticker: str
    security_name: str
    market: str
    quantity: float
    avg_cost: float
    current_price: float
    currency: str
    market_value: float


class SyncRequest(BaseModel):
    start_date: datetime
    end_date: datetime


class SyncResponse(BaseModel):
    transactions: list[Transaction]
    count: int


class HoldingsResponse(BaseModel):
    holdings: list[Holding]
    count: int


class HealthResponse(BaseModel):
    status: str
    authenticated: bool
    last_token_refresh: Optional[datetime] = None
