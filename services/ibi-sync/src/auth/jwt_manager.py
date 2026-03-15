"""JWT token manager with automatic refresh for IBI Spark API."""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from ..api.endpoints import BASE_URL, GET_AUTH_DATA

logger = logging.getLogger(__name__)

TOKEN_REFRESH_INTERVAL = 15  # seconds
TOKEN_TTL = 240  # 4 minutes
MAX_CONSECUTIVE_FAILURES = 3


class AuthenticationRequired(Exception):
    """Raised when the user needs to re-authenticate."""

    pass


class JWTManager:
    """Manages IBI JWT token with automatic refresh loop."""

    def __init__(self) -> None:
        self._access_token: Optional[str] = None
        self._token_set_at: Optional[datetime] = None
        self._last_refresh: Optional[datetime] = None
        self._refresh_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self._consecutive_failures = 0
        self._http_client: Optional[httpx.AsyncClient] = None

    @property
    def is_authenticated(self) -> bool:
        return self._access_token is not None

    @property
    def last_refresh(self) -> Optional[datetime]:
        return self._last_refresh

    async def set_token(self, token: str) -> None:
        """Set the JWT token (from initial Auth0 bootstrap)."""
        async with self._lock:
            self._access_token = token
            self._token_set_at = datetime.now(timezone.utc)
            self._last_refresh = self._token_set_at
            self._consecutive_failures = 0
            logger.info("JWT token set successfully")

        # Start refresh loop if not already running
        if self._refresh_task is None or self._refresh_task.done():
            self._refresh_task = asyncio.create_task(self._refresh_loop())
            logger.info("Token refresh loop started")

    async def get_token(self) -> str:
        """Get the current valid JWT token."""
        if self._access_token is None:
            raise AuthenticationRequired("No token available. Please authenticate first.")

        # Check if token is too old (clock skew safety)
        if self._token_set_at:
            age = (datetime.now(timezone.utc) - self._token_set_at).total_seconds()
            if age > TOKEN_TTL:
                raise AuthenticationRequired(
                    "Token has expired. Please re-authenticate."
                )

        return self._access_token

    async def stop(self) -> None:
        """Stop the refresh loop and clean up."""
        if self._refresh_task and not self._refresh_task.done():
            self._refresh_task.cancel()
            try:
                await self._refresh_task
            except asyncio.CancelledError:
                pass

        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

        logger.info("JWT manager stopped")

    async def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                base_url=BASE_URL,
                timeout=30.0,
            )
        return self._http_client

    async def _refresh_loop(self) -> None:
        """Background loop that refreshes the JWT every 15 seconds."""
        while True:
            await asyncio.sleep(TOKEN_REFRESH_INTERVAL)
            try:
                await self._refresh_token()
                self._consecutive_failures = 0
            except Exception as e:
                self._consecutive_failures += 1
                logger.warning(
                    f"Token refresh failed ({self._consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}): {e}"
                )
                if self._consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    logger.error(
                        "Max consecutive refresh failures reached. Token invalidated."
                    )
                    self._access_token = None
                    break
                # Retry sooner on failure
                await asyncio.sleep(5)

    async def _refresh_token(self) -> None:
        """Call GetAuthData to refresh the JWT."""
        async with self._lock:
            if self._access_token is None:
                raise AuthenticationRequired("No token to refresh")

            client = await self._get_http_client()
            response = await client.get(
                GET_AUTH_DATA,
                headers={
                    "Authorization": f"Bearer {self._access_token}",
                    "Accept-Language": "he",
                },
            )
            response.raise_for_status()

            data = response.json()

            # The refresh endpoint returns a new token in the response
            new_token = data.get("token") or data.get("Token")
            if new_token:
                self._access_token = new_token
            # If no new token in response, the existing token was extended

            self._token_set_at = datetime.now(timezone.utc)
            self._last_refresh = self._token_set_at
            logger.debug("Token refreshed successfully")


# Singleton instance
jwt_manager = JWTManager()
