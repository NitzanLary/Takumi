"""Auth0 PKCE bootstrap via Playwright for IBI Spark API.

Navigates to the IBI Spark SPA, which initiates its own Auth0 PKCE flow.
We fill in credentials (or wait for manual login), then intercept the
IBI JWT from the AuthenticateAuth0 network response.
"""

import asyncio
import logging
import os
from typing import Optional

from ..api.endpoints import BASE_URL, AUTHENTICATE_AUTH0

logger = logging.getLogger(__name__)

# Timeout for waiting for the user to complete manual login
MANUAL_LOGIN_TIMEOUT = 120_000  # 2 minutes


async def discover_api_calls(
    username: Optional[str] = None,
    password: Optional[str] = None,
) -> list[dict]:
    """
    Login to IBI SPA and capture all API requests the SPA makes after login.
    Returns a list of {method, url, status, response_type, response_keys, sample} dicts.
    """
    from playwright.async_api import async_playwright

    ibi_username = username or os.environ.get("IBI_USERNAME", "")
    ibi_password = password or os.environ.get("IBI_PASSWORD", "")
    headless = bool(ibi_username and ibi_password)

    captured: list[dict] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        context = await browser.new_context()
        page = await context.new_page()

        async def _capture_all(response):
            if "/api/" in response.url and response.status == 200:
                entry: dict = {
                    "method": response.request.method,
                    "url": response.url,
                    "status": response.status,
                }
                # Capture POST request body
                if response.request.method == "POST":
                    try:
                        entry["request_body"] = response.request.post_data
                    except Exception:
                        pass
                try:
                    data = await response.json()
                    if isinstance(data, list):
                        entry["response_type"] = f"list[{len(data)}]"
                        if data:
                            entry["sample_item"] = data[0]
                    elif isinstance(data, dict):
                        entry["response_type"] = "dict"
                        entry["response_keys"] = list(data.keys())[:30]
                        for k, v in data.items():
                            if isinstance(v, list) and len(v) > 0:
                                entry[f"nested_{k}_len"] = len(v)
                                entry[f"nested_{k}_sample"] = v[0]
                            elif not isinstance(v, (list, dict)):
                                entry[f"val_{k}"] = v
                    else:
                        entry["response_type"] = type(data).__name__
                except Exception:
                    entry["response_type"] = "non-json"
                captured.append(entry)

        page.on("response", _capture_all)

        logger.info("[discover] Navigating to IBI Spark...")
        await page.goto(BASE_URL, wait_until="networkidle")

        if ibi_username and ibi_password:
            logger.info("[discover] Auto-filling credentials...")
            await page.fill("#username", ibi_username)
            await page.fill("#password", ibi_password)
            await page.click('button:has-text("Login")')

        logger.info("[discover] Waiting for SPA to load after login...")
        try:
            await page.wait_for_url(f"{BASE_URL}/**", timeout=60_000, wait_until="networkidle")
        except Exception:
            pass

        # Wait extra time for the SPA to make its initial data fetches
        await asyncio.sleep(10)

        logger.info(f"[discover] Captured {len(captured)} API calls")
        await browser.close()

    return captured


async def bootstrap_auth(
    username: Optional[str] = None,
    password: Optional[str] = None,
) -> str:
    """
    Complete the Auth0 login flow via Playwright browser.
    Returns the IBI JWT token.

    Navigates to the IBI Spark SPA and lets it drive the Auth0 PKCE flow.
    If username/password are provided, auto-fills credentials in headless mode.
    Otherwise, launches a visible browser for manual login.
    """
    from playwright.async_api import async_playwright

    ibi_username = username or os.environ.get("IBI_USERNAME", "")
    ibi_password = password or os.environ.get("IBI_PASSWORD", "")
    headless = bool(ibi_username and ibi_password)

    ibi_jwt: Optional[str] = None

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        context = await browser.new_context()
        page = await context.new_page()

        # Intercept the AuthenticateAuth0 response to capture the IBI JWT
        async def _capture_auth_response(response):
            nonlocal ibi_jwt
            if AUTHENTICATE_AUTH0 in response.url and response.status == 200:
                try:
                    data = await response.json()
                    # The IBI JWT is in field "l" (minified), or "token"/"Token"
                    token = (
                        data.get("l")
                        or data.get("token")
                        or data.get("Token")
                    )
                    if token and isinstance(token, str) and len(token) > 40:
                        ibi_jwt = token
                        logger.info("Captured IBI JWT from AuthenticateAuth0 response")
                except Exception as e:
                    logger.warning(f"Failed to parse AuthenticateAuth0 response: {e}")

        page.on("response", _capture_auth_response)

        # Navigate to the SPA — it will redirect to Auth0 login
        logger.info("Navigating to IBI Spark (will redirect to Auth0)...")
        await page.goto(BASE_URL, wait_until="networkidle")

        # We should now be on the Auth0 login page
        if ibi_username and ibi_password:
            logger.info("Auto-filling credentials...")
            await page.fill("#username", ibi_username)
            await page.fill("#password", ibi_password)
            await page.click('button:has-text("Login")')
        else:
            logger.info("Waiting for manual login (browser is visible)...")

        # Wait for the SPA to complete auth and redirect back
        logger.info("Waiting for auth to complete...")
        try:
            await page.wait_for_url(
                f"{BASE_URL}/**",
                timeout=MANUAL_LOGIN_TIMEOUT,
                wait_until="networkidle",
            )
        except Exception:
            # May already be on the right URL, or timeout on manual login
            pass

        # The URL match can resolve before the auth network call completes.
        # Poll for the JWT from network interception or browser storage.
        if not ibi_jwt:
            import asyncio

            logger.info("JWT not captured from network, polling browser storage...")
            for attempt in range(15):
                ibi_jwt = await page.evaluate(
                    """() => {
                        for (const storage of [sessionStorage, localStorage]) {
                            for (const key of Object.keys(storage)) {
                                if (key.toLowerCase().includes('token')) {
                                    try {
                                        const val = storage.getItem(key);
                                        const parsed = JSON.parse(val);
                                        if (typeof parsed === 'string' && parsed.length > 40) {
                                            return parsed;
                                        }
                                    } catch {}
                                }
                            }
                        }
                        return null;
                    }"""
                )
                if ibi_jwt:
                    break
                await asyncio.sleep(2)

        await browser.close()

    if not ibi_jwt:
        raise RuntimeError(
            "Failed to obtain IBI JWT. "
            "The login may not have completed successfully."
        )

    logger.info("IBI JWT obtained successfully")
    return ibi_jwt
