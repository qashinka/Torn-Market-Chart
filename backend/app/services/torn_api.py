import httpx
import logging
from app.core.config import settings
from app.services.redis_service import redis_service

logger = logging.getLogger(__name__)

class TornApiService:
    BASE_URL = "https://api.torn.com"

    def __init__(self):
        self.api_key = settings.TORN_API_KEY
        self.client = httpx.AsyncClient(timeout=10.0)

    async def close(self):
        await self.client.aclose()

    async def _request(self, endpoint: str, params: dict = None):
        if not params:
            params = {}

        # Simple rate limiting check (Global 100 req/min default for Torn)
        # We use Redis to enforce this strict limit if needed, or rely on API headers.
        # Here we implement a simple check.
        allowed = await redis_service.check_rate_limit("rate_limit:torn_api", 100, 60)
        if not allowed:
            logger.warning("Rate limit reached for Torn API")
            return None # Or raise exception

        params['key'] = self.api_key

        try:
            response = await self.client.get(f"{self.BASE_URL}/{endpoint}", params=params)
            response.raise_for_status()
            data = response.json()

            if 'error' in data:
                logger.error(f"Torn API Error: {data['error']}")
                return None

            return data
        except httpx.HTTPError as e:
            logger.error(f"HTTP Error fetching {endpoint}: {e}")
            return None

    async def get_items(self, item_ids: list[int] = None):
        """Fetch item details (market value etc)"""
        # Torn 'market' selection provides item market info
        # https://api.torn.com/market/{ID}?selections=itemmarket,bazaar&key={KEY}
        pass

    async def get_torn_items_list(self):
        """Fetch all items definitions"""
        # https://api.torn.com/torn/?selections=items&key=
        return await self._request("torn/", {"selections": "items"})

torn_api_service = TornApiService()
