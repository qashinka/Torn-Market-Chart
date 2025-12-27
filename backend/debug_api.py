import asyncio
import traceback
import sys
# Make sure we can import app modules
sys.path.append('/app')

from app.services.price_service import price_service

async def run():
    print("Starting manual update in API container...")
    from app.core.config import settings
    print(f"DB_URL: {settings.DATABASE_URL.replace(settings.DATABASE_URL.split(':')[2].split('@')[0], '***')}")
    try:
        from app.services.config_service import config_service
        print("Pre-check: Testing get_config('discord_webhook_url')...")
        for i in range(20):
            val = await config_service.get_config('discord_webhook_url')
            if i % 5 == 0:
                print(f"Loop {i} success: {str(val)[:10]}...")
        
        print("Pre-check 2: Testing get_config('api_rate_limit')...")
        val2 = await config_service.get_config('api_rate_limit', '50')
        print(f"Pre-check 2 success: {val2}")

        print("Calling update_all_prices()...")
        await price_service.update_all_prices()
        print("Update Success")
    except Exception:
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(run())
