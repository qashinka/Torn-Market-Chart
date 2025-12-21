import httpx
import logging
from app.core.config import settings
from app.services.redis_service import redis_service

logger = logging.getLogger(__name__)

class TornApiService:
    BASE_URL = "https://api.torn.com"

    def __init__(self):
        # We don't load key from settings here anymore, we check DB or fallback
        self.client = httpx.AsyncClient(timeout=10.0)

    async def close(self):
        await self.client.aclose()

    async def _get_api_key(self):
        """
        Get an active API key, rotating through available keys.
        """
        from app.db.database import SessionLocal
        from app.models.models import ApiKey
        from sqlalchemy import select
        
        # 1. Fetch all active keys from DB
        async with SessionLocal() as session:
            result = await session.execute(select(ApiKey).where(ApiKey.is_active == True))
            db_keys = result.scalars().all()
            
            if not db_keys:
                return settings.TORN_API_KEY
            
            keys_list = [k.key for k in db_keys]
            
            if len(keys_list) == 1:
                return keys_list[0]

            # 2. Use Redis to rotate (Round Robin)
            # Increment a counter and use modulo
            index = await redis_service.client.incr("apikey:rotation_index")
            selected_key = keys_list[index % len(keys_list)]
            
            return selected_key

    async def _request(self, endpoint: str, params: dict = None):
        """Standard v1 Request"""
        if not params:
            params = {}

        from app.services.config_service import config_service
        from app.models.models import ApiKey
        from app.db.database import SessionLocal
        from sqlalchemy import select, func

        base_limit = int(await config_service.get_config('api_rate_limit', '100'))
        
        # Calculate effective limit
        async with SessionLocal() as session:
            result = await session.execute(select(func.count(ApiKey.id)).where(ApiKey.is_active == True))
            key_count = result.scalar() or 1
        
        limit = base_limit * key_count

        allowed = await redis_service.check_rate_limit("rate_limit:torn_api", limit, 60)
        if not allowed:
            logger.warning("Rate limit reached for Torn API")
            return None 

        current_key = await self._get_api_key()
        if not current_key or current_key == "PLACEHOLDER_KEY":
            logger.error("No valid API Key found. Please configure it in Settings.")
            return None

        params['key'] = current_key

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

    async def _request_v2(self, endpoint: str, params: dict = None):
        """Helper for v2 requests"""
        if not params:
            params = {}
            
        # Rate limit check reuse
        # Rate limit check reuse
        from app.services.config_service import config_service
        from app.models.models import ApiKey
        from app.db.database import SessionLocal
        from sqlalchemy import select, func

        base_limit = int(await config_service.get_config('api_rate_limit', '100'))
        
        # Calculate effective limit
        async with SessionLocal() as session:
            result = await session.execute(select(func.count(ApiKey.id)).where(ApiKey.is_active == True))
            key_count = result.scalar() or 1
        
        limit = base_limit * key_count

        allowed = await redis_service.check_rate_limit("rate_limit:torn_api", limit, 60)
        if not allowed:
            logger.warning("Rate limit reached for Torn API")
            return None

        current_key = await self._get_api_key()
        if not current_key or current_key == "PLACEHOLDER_KEY":
            logger.error("No valid API Key found.")
            return None

        headers = {
            'Authorization': f'ApiKey {current_key}',
            'accept': 'application/json'
        }

        try:
            url = f"{self.BASE_URL}/v2/{endpoint}"
            response = await self.client.get(url, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            if 'error' in data:
                 logger.error(f"Torn API v2 Error: {data['error']}")
                 return None
                 
            return data
        except httpx.HTTPError as e:
            logger.error(f"HTTP Error fetching v2 {endpoint}: {e}")
            return None

    async def get_items(self, item_ids: list[int] = None):
        """
        Fetch item details using v2 API for Item Market and weav3r.dev (scraped) for Bazaar.
        Uses asyncio.gather with Semaphore to limit concurrency.
        """
        if not item_ids:
            return {}

        results = {}
        # Import curl_cffi here
        from curl_cffi.requests import AsyncSession
        import asyncio

        # CONCURRENCY LIMIT: 5 concurrent requests
        semaphore = asyncio.Semaphore(5)

        async def fetch_single_item(item_id, scraper):
            async with semaphore:
                # 1. Fetch Item Market (Official API v2)
                # /v2/market/{id}/itemmarket
                im_data = await self._request_v2(f"market/{item_id}/itemmarket", {"limit": 10, "sort": "price"})
                lowest_itemmarket = 0
                if im_data and 'itemmarket' in im_data and 'listings' in im_data['itemmarket']:
                    listings = im_data['itemmarket']['listings']
                    if listings:
                        lowest_itemmarket = listings[0]['price']

                # 2. Fetch Bazaar (weav3r.dev - External Service)
                # Legacy method with Cloudflare protection bypass
                lowest_bazaar = 0
                try:
                    url = f"https://weav3r.dev/api/marketplace/{item_id}"
                    response = await scraper.get(url)
                    
                    if response.status_code == 200:
                        data = response.json()
                        listings = data.get("listings", [])
                        
                        # Find lowest price from listings
                        if listings:
                             prices = [l.get('price') for l in listings if l.get('price')]
                             if prices:
                                 lowest_bazaar = min(prices)
                    else:
                        logger.warning(f"weav3r.dev returned {response.status_code} for item {item_id}")
                except Exception as e:
                    logger.error(f"Error scraping bazaar for item {item_id}: {e}")

                # Optional Jitter to prevent instant burst
                await asyncio.sleep(0.1)

                return item_id, {
                    'market_price': lowest_itemmarket,
                    'bazaar_price': lowest_bazaar
                }

        # Create a session for scraping (mimic Chrome to bypass Cloudflare)
        async with AsyncSession(impersonate="chrome") as scraper:
            tasks = [fetch_single_item(item_id, scraper) for item_id in item_ids]
            
            # Executing tasks concurrently
            fetched_results = await asyncio.gather(*tasks)
            
            for item_id, data in fetched_results:
                results[item_id] = data
        
        return results

    async def get_torn_items_list(self):
        """Fetch all items definitions"""
        # https://api.torn.com/torn/?selections=items&key=
        data = await self._request("torn/", {"selections": "items"})
        if data and 'items' in data:
            return data['items']
        return {}

torn_api_service = TornApiService()
