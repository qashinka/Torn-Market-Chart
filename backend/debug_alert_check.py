import asyncio
from sqlalchemy import text
from app.db.database import SessionLocal

async def check():
    async with SessionLocal() as s:
        # Get Item 206
        r = await s.execute(text("SELECT torn_id, name, last_market_price, last_bazaar_price, is_tracked FROM items WHERE id=206 OR torn_id=206"))
        item = r.fetchone()
        print(f"Item: {item}")
        
        # Get Alert for item_id matching
        if item:
            item_id = item[0] # torn_id
            r = await s.execute(text(f"SELECT * FROM price_alerts WHERE item_id={item_id}"))
            # Actually item_id in price_alerts is items.id, not torn_id. Let me fix.
            r = await s.execute(text(f"SELECT * FROM price_alerts"))
            alerts = r.fetchall()
            print(f"All Alerts: {alerts}")
            
            # Best price
            mp = item[2] or 0
            bp = item[3] or 0
            prices = [p for p in [mp, bp] if p > 0]
            best = min(prices) if prices else 0
            print(f"Market: {mp}, Bazaar: {bp}, Best: {best}")

if __name__ == "__main__":
    asyncio.run(check())
