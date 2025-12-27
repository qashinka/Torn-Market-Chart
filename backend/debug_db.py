import asyncio
from sqlalchemy import text
from app.db.database import SessionLocal
from app.services.config_service import config_service
from app.services.notification_service import notification_service

async def check_db():
    print("--- DEBUG START ---")
    from app.core.config import settings
    print(f"DB_URL: {settings.DATABASE_URL.replace(settings.DATABASE_URL.split(':')[2].split('@')[0], '***')}") # Mask password
    async with SessionLocal() as session:
        # 1. Check Webhook
        webhook = await config_service.get_config('discord_webhook_url')
        print(f"Webhook URL in DB/Env: {webhook}")
        
        # 2. Check Item 206 (Assuming ID 206 from previous logs)
        # We want to see if it exists and what its torn_id is
        res = await session.execute(text("SELECT id, torn_id, name, is_tracked, last_updated_at, failure_count FROM items WHERE torn_id=206 OR id=206"))
        items = res.fetchall()
        print(f"Items found (matching 206): {items}")
        
        if not items:
            print("Item 206 NOT found in items table.")
        
        # 3. Check Alerts for these items
        if items:
            item_ids = [i[0] for i in items] # Tuple index 0 is id
            res = await session.execute(text(f"SELECT * FROM price_alerts WHERE item_id in {tuple(item_ids) if len(item_ids)>1 else f'({item_ids[0]})'}"))
            alerts = res.fetchall()
            print(f"Alerts for items {item_ids}: {alerts}")

            # 4. Test Notification Trigger manually
            if webhook:
                print("Sending Test Notification to Discord...")
                try:
                    await notification_service.send_discord_alert(
                        item_name=items[0][2], # Name
                        item_id=items[0][1], # Torn ID
                        price=999,
                        market_type="Market",
                        condition="below",
                        target_price=1000
                    )
                    print("Test Notification Sent.")
                except Exception as e:
                    print(f"Test Notification Failed: {e}")
            else:
                print("No Webhook URL found, skipping test.")

        # 5. Check Connection Limits
        res = await session.execute(text("SHOW VARIABLES LIKE 'max_connections'"))
        print(f"Max Connections: {res.fetchall()}")
        res = await session.execute(text("SHOW VARIABLES LIKE 'max_user_connections'"))
        print(f"Max User Connections: {res.fetchall()}")
        
        res = await session.execute(text("SHOW PROCESSLIST"))
        procs = res.fetchall()
        print(f"Active Processes: {len(procs)}")
        # print(f"Processes: {procs}")

    print("--- DEBUG END ---")

if __name__ == "__main__":
    asyncio.run(check_db())
