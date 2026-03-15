"""IBI Spark REST API client with automatic retry."""

import logging
from datetime import datetime
from typing import Any

import httpx

from .endpoints import (
    BASE_URL,
    ACCOUNT_KEY,
    GET_ACCOUNT_TRANSACTIONS,
    GET_NEW_ACCOUNT_TRANSACTIONS,
    GET_ACCOUNT_SECURITIES,
    GET_ACCOUNT_DAILY_YIELDS,
    GET_ACCOUNT_MONTHLY_YIELDS,
    GET_HOLDINGS,
)
from ..auth.jwt_manager import jwt_manager

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_BACKOFF = [1, 3, 10]  # seconds


class IBIClient:
    """HTTP client for IBI Spark API with token injection and retry."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=BASE_URL,
                timeout=30.0,
            )
        return self._client

    async def _request(
        self, method: str, path: str,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
    ) -> Any:
        """Make an authenticated request with retry logic."""
        import asyncio

        last_error: Exception | None = None

        for attempt in range(MAX_RETRIES):
            try:
                token = await jwt_manager.get_token()
                client = await self._get_client()
                response = await client.request(
                    method,
                    path,
                    params=params,
                    json=json_body,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept-Language": "he",
                    },
                )
                response.raise_for_status()
                return response.json()

            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code == 401:
                    logger.warning("Got 401 — token may have expired")
                    # Let the refresh loop handle it, retry after a short wait
                    await asyncio.sleep(RETRY_BACKOFF[attempt])
                    continue
                raise
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                last_error = e
                logger.warning(
                    f"Request failed (attempt {attempt + 1}/{MAX_RETRIES}): {e}"
                )
                await asyncio.sleep(RETRY_BACKOFF[attempt])

        raise last_error or RuntimeError("Request failed after retries")

    @staticmethod
    def _extract_transactions(data: Any, endpoint: str) -> list[dict[str, Any]]:
        """Extract transaction list from an API response, regardless of wrapper key."""
        if isinstance(data, list):
            logger.info(f"{endpoint} returned a list with {len(data)} items")
            return data

        if isinstance(data, dict):
            top_keys = list(data.keys())
            logger.info(f"{endpoint} returned dict with keys: {top_keys}")

            # Try known key names (case-insensitive search)
            for key in top_keys:
                val = data[key]
                if isinstance(val, list):
                    logger.info(
                        f"{endpoint}: found list under key '{key}' with {len(val)} items"
                    )
                    return val

        logger.warning(
            f"{endpoint}: could not extract transactions from response type {type(data).__name__}"
        )
        return []

    async def subscribe(self, channels: list[str]) -> dict[str, Any]:
        """Subscribe to IBI data channels (pub/sub API)."""
        data = await self._request(
            "POST", "/api/subscription/subscribe", json_body=channels
        )
        return data

    @staticmethod
    def _chunk_date_range(
        start: datetime, end: datetime, max_days: int = 90
    ) -> list[tuple[datetime, datetime]]:
        """Split a date range into chunks of max_days."""
        from datetime import timedelta

        chunks: list[tuple[datetime, datetime]] = []
        current = start
        while current < end:
            chunk_end = min(current + timedelta(days=max_days), end)
            chunks.append((current, chunk_end))
            current = chunk_end
        return chunks

    async def get_transactions(
        self, start: datetime, end: datetime
    ) -> list[dict[str, Any]]:
        """Fetch historical transactions for a date range.

        The IBI API returns empty results for large date ranges,
        so we chunk into 90-day windows (matching what the SPA does).
        """
        results: list[dict[str, Any]] = []

        chunks = self._chunk_date_range(start, end, max_days=90)
        logger.info(
            f"Fetching transactions from {start.date()} to {end.date()} "
            f"in {len(chunks)} chunk(s)"
        )

        for chunk_start, chunk_end in chunks:
            params = {
                "accountKey": ACCOUNT_KEY,
                "startDate": chunk_start.strftime("%Y-%m-%dT00:00:00.000Z"),
                "endDate": chunk_end.strftime("%Y-%m-%dT00:00:00.000Z"),
            }
            for endpoint_name, endpoint_path in [
                ("GetAccountTransactions", GET_ACCOUNT_TRANSACTIONS),
                ("GetNewAccountTransactions", GET_NEW_ACCOUNT_TRANSACTIONS),
            ]:
                try:
                    data = await self._request("GET", endpoint_path, params)
                    extracted = self._extract_transactions(data, endpoint_name)
                    results.extend(extracted)
                except Exception as e:
                    logger.warning(f"{endpoint_name} failed for chunk {chunk_start.date()}-{chunk_end.date()}: {e}")

        # Deduplicate by whatever unique ID the API provides
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for tx in results:
            tx_id = str(
                tx.get("ReferenceNumber")
                or tx.get("referenceNumber")
                or tx.get("_k")
                or tx.get("Id")
                or tx.get("id")
                or id(tx)
            )
            if tx_id not in seen:
                seen.add(tx_id)
                unique.append(tx)

        return unique

    async def get_holdings(self) -> list[dict[str, Any]]:
        """Fetch current account securities/holdings."""
        params = {"accountKey": ACCOUNT_KEY}
        data = await self._request("GET", GET_ACCOUNT_SECURITIES, params)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("securities", data.get("Securities", []))
        return []

    async def get_detailed_holdings(self) -> list[dict[str, Any]]:
        """Fetch detailed holdings with cost basis."""
        params = {"accountKey": ACCOUNT_KEY}
        data = await self._request("GET", GET_HOLDINGS, params)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("holdings", data.get("Holdings", []))
        return []

    async def get_daily_yields(self, year: int) -> list[dict[str, Any]]:
        """Fetch daily P&L yields for a given year."""
        params = {"accountKey": ACCOUNT_KEY, "year": str(year)}
        data = await self._request("GET", GET_ACCOUNT_DAILY_YIELDS, params)
        if isinstance(data, list):
            return data
        return []

    async def get_monthly_yields(self) -> list[dict[str, Any]]:
        """Fetch monthly P&L yields (all-time)."""
        params = {"accountKey": ACCOUNT_KEY}
        data = await self._request("GET", GET_ACCOUNT_MONTHLY_YIELDS, params)
        if isinstance(data, list):
            return data
        return []

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()


# Singleton
ibi_client = IBIClient()
