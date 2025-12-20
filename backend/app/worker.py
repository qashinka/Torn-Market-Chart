import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from app.services.price_service import price_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def tick():
    logger.info("Tick! The worker is alive.")

async def main():
    logger.info("Starting Worker...")

    scheduler = AsyncIOScheduler()

    # Add jobs

    # 1. Fetch Prices every 1 minute
    scheduler.add_job(
        price_service.update_all_prices,
        IntervalTrigger(minutes=1),
        id="update_prices",
        replace_existing=True
    )

    # 2. Downsample Data every day at 2 AM
    scheduler.add_job(
        price_service.downsample_data,
        IntervalTrigger(days=1, start_date='2023-01-01 02:00:00'),
        id="downsample_data",
        replace_existing=True
    )

    # 3. Heartbeat
    scheduler.add_job(tick, IntervalTrigger(seconds=60))

    scheduler.start()

    # Keep the worker running
    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        pass

if __name__ == "__main__":
    asyncio.run(main())
