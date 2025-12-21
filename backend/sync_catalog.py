import asyncio
import logging
from app.services.item_service import item_service

logging.basicConfig(level=logging.INFO)

async def main():
    await item_service.sync_item_catalog()

if __name__ == "__main__":
    asyncio.run(main())
