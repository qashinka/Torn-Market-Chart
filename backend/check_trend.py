
import asyncio
import sys
import os

# Add app to path
sys.path.append('/app')

from app.db.database import SessionLocal
from app.models.models import Item
from sqlalchemy import select

async def check_trend():
    async with SessionLocal() as session:
        result = await session.execute(select(Item).limit(10))
        items = result.scalars().all()
        
        print(f"{'ID':<5} {'Name':<30} {'Market Price':<15} {'M Trend':<15} {'B Trend':<15}")
        print("-" * 80)
        for item in items:
            print(f"{item.id:<5} {item.name[:28]:<30} {item.last_market_price or 0:<15} {item.last_market_trend or 'None':<15} {item.last_bazaar_trend or 'None':<15}")

if __name__ == "__main__":
    asyncio.run(check_trend())
