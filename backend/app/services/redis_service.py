import redis.asyncio as redis
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

class RedisService:
    def __init__(self):
        self.redis_url = settings.REDIS_URL
        self.client: redis.Redis | None = None

    async def connect(self):
        if not self.client:
            self.client = redis.from_url(self.redis_url, encoding="utf-8", decode_responses=True)
            logger.info("Connected to Redis")

    async def close(self):
        if self.client:
            await self.client.close()
            self.client = None

    async def get_client(self) -> redis.Redis:
        if not self.client:
            await self.connect()
        return self.client

    async def check_rate_limit(self, key: str, limit: int, period: int) -> bool:
        """
        Token bucket or simple counter.
        Returns True if allowed, False if limited.
        """
        if not self.client:
            await self.connect()

        # Simple fixed window counter
        current = await self.client.incr(key)
        if current == 1:
            await self.client.expire(key, period)

        if current > limit:
            return False
        return True

redis_service = RedisService()
