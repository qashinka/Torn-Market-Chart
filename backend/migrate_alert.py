import asyncio
from sqlalchemy import text
from app.db.database import engine

async def run_migration():
    print("Running migration to update price_alerts table...")
    async with engine.begin() as conn:
        try:
            await conn.execute(text("ALTER TABLE price_alerts ADD COLUMN last_triggered_id VARCHAR(255) NULL;"))
            print("Added last_triggered_id column.")
        except Exception as e:
            if "Duplicate column" in str(e): print("last_triggered_id already exists.")
            else: print(f"Error adding last_triggered_id: {e}")

        try:
            await conn.execute(text("ALTER TABLE price_alerts ADD COLUMN last_triggered_at DATETIME NULL;"))
            print("Added last_triggered_at column.")
        except Exception as e:
            if "Duplicate column" in str(e): print("last_triggered_at already exists.")
            else: print(f"Error adding last_triggered_at: {e}")

if __name__ == "__main__":
    asyncio.run(run_migration())
