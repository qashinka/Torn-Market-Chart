import asyncio
from app.services.config_service import config_service
# Import price_service to see if it breaks things
from app.services.price_service import price_service
from app.core.config import settings

async def run():
    print("Testing config service with PriceService imported...")
    print(f"DB_URL: {settings.DATABASE_URL.replace(settings.DATABASE_URL.split(':')[2].split('@')[0], '***')}")
    try:
        val = await config_service.get_config('discord_webhook_url')
        print(f"Success! Value: {val}")
    except Exception as e:
        print(f"Failed! Error: {e}")

if __name__ == '__main__':
    asyncio.run(run())
