
import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def migrate():
    url = os.getenv('DATABASE_URL') # Should be mysql+asyncmy://...
    engine = create_async_engine(url)
    
    async with engine.begin() as conn:
        print("Migrating...")
        try:
            await conn.execute(text("ALTER TABLE items ADD COLUMN last_market_trend BIGINT NULL;"))
            print("Added last_market_trend")
        except Exception as e:
            print(f"Error adding last_market_trend: {e}")

        try:
            await conn.execute(text("ALTER TABLE items ADD COLUMN last_bazaar_trend BIGINT NULL;"))
            print("Added last_bazaar_trend")
        except Exception as e:
            print(f"Error adding last_bazaar_trend: {e}")
            
    await engine.dispose()
    print("Migration complete")

if __name__ == "__main__":
    asyncio.run(migrate())
