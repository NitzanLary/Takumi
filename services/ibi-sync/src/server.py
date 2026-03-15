"""FastAPI server for IBI Spark API sync service."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException

from .auth.jwt_manager import jwt_manager, AuthenticationRequired
from .auth.pkce import bootstrap_auth, discover_api_calls
from .api.client import ibi_client
from .models import SyncRequest, SyncResponse, HoldingsResponse, HealthResponse
from .sync.transactions import parse_transactions
from .sync.holdings import parse_holdings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("IBI Sync Service starting...")
    yield
    logger.info("IBI Sync Service shutting down...")
    await jwt_manager.stop()
    await ibi_client.close()


app = FastAPI(
    title="Takumi IBI Sync Service",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        authenticated=jwt_manager.is_authenticated,
        last_token_refresh=jwt_manager.last_refresh,
    )


@app.post("/auth/bootstrap")
async def auth_bootstrap(
    username: str | None = None,
    password: str | None = None,
) -> dict:
    """Run the Auth0 PKCE bootstrap to obtain an IBI JWT."""
    try:
        token = await bootstrap_auth(username=username, password=password)
        await jwt_manager.set_token(token)
        return {"status": "ok", "message": "Authentication successful"}
    except Exception as e:
        logger.error(f"Auth bootstrap failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/set-token")
async def set_token(token: str) -> dict:
    """Manually set an IBI JWT token (for development/testing)."""
    await jwt_manager.set_token(token)
    return {"status": "ok", "message": "Token set successfully"}


@app.post("/debug/discover")
async def debug_discover() -> list[dict]:
    """Login to IBI SPA and capture all API calls it makes — for endpoint discovery."""
    try:
        calls = await discover_api_calls()
        return calls
    except Exception as e:
        logger.error(f"Discovery failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sync/transactions", response_model=SyncResponse)
async def sync_transactions(request: SyncRequest) -> SyncResponse:
    """Fetch transactions from IBI for the given date range."""
    try:
        raw_transactions = await ibi_client.get_transactions(
            start=request.start_date,
            end=request.end_date,
        )
        transactions = parse_transactions(raw_transactions)
        return SyncResponse(
            transactions=transactions,
            count=len(transactions),
        )
    except AuthenticationRequired as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        logger.error(f"Transaction sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sync/holdings", response_model=HoldingsResponse)
async def sync_holdings() -> HoldingsResponse:
    """Fetch current holdings from IBI."""
    try:
        raw_holdings = await ibi_client.get_holdings()
        holdings = parse_holdings(raw_holdings)
        return HoldingsResponse(
            holdings=holdings,
            count=len(holdings),
        )
    except AuthenticationRequired as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        logger.error(f"Holdings sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
