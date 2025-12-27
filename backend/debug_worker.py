import asyncio
import traceback
import sys
# Make sure we can import app modules
sys.path.append('/app')

from app.services.price_service import price_service

async def run():
    print("Starting manual update...")
    try:
        await price_service.update_all_prices()
        print("Update Success")
    except Exception:
        with open("traceback.log", "w") as f:
            traceback.print_exc(file=f)
        print("Error logged to traceback.log")

if __name__ == "__main__":
    asyncio.run(run())
