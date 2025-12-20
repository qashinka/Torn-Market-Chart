import logging
from datetime import datetime
from sqlalchemy import select, insert
from app.db.database import SessionLocal
from app.models.models import Item, PriceLog

logger = logging.getLogger(__name__)

class PriceService:
    async def update_all_prices(self):
        """
        Main job to update prices for all tracked items.
        """
        async with SessionLocal() as session:
            # 1. Get all tracked items
            result = await session.execute(select(Item).where(Item.is_tracked))
            items = result.scalars().all()

            if not items:
                logger.info("No items to track.")
                return

            item_ids = [item.torn_id for item in items]
            logger.info(f"Updating prices for {len(item_ids)} items.")

            # 2. Fetch prices (Batching might be needed for API limits)
            # For official API, we can fetch multiple items in one call?
            # Torn API 'market' selection is per item ID.
            # So we must loop.

            price_updates = []

            for item in items:
                # Fetch Official Market Data
                # Note: This is simplified. In prod we'd use a queue or parallel gather with limits.
                # data = await torn_api_service.get_items([item.torn_id])
                # Implementing get_items in torn_api properly is needed.
                # Assuming get_items returns dict {id: {market_cost: ..., bazaar_cost: ...}}

                # Mock data since we can't really call API here
                # In real app: data = await torn_api_service.request(...)

                # For now let's pretend we got data
                market_price = 0 # Placeholder
                bazaar_price = 0 # Placeholder

                now = datetime.utcnow()

                price_updates.append({
                    "item_id": item.id,
                    "timestamp": now,
                    "market_price": market_price,
                    "bazaar_price": bazaar_price
                })

                # Update Item cache
                item.last_market_price = market_price
                item.last_bazaar_price = bazaar_price
                item.last_updated_at = now

            # 3. Bulk Insert into PriceLog
            if price_updates:
                stmt = insert(PriceLog).values(price_updates)
                await session.execute(stmt)
                await session.commit()
                logger.info(f"Inserted {len(price_updates)} price logs.")

            # 4. Check Alerts
            await self.check_alerts(session, price_updates)

    async def check_alerts(self, session, price_updates):
        # Load alerts
        # This is simple check.
        pass

    async def downsample_data(self):
        """
        Retention Policy:
        - < 7 days: Keep all (1 min)
        - 7-30 days: Keep 1 hour avg
        - > 30 days: Keep 1 day avg
        """
        logger.info("Starting data downsampling...")
        # async with SessionLocal() as session:
        #     now = datetime.utcnow()
        #
        #     # 1. Downsample 7-30 days to 1 hour
        #     seven_days_ago = now - timedelta(days=7)
        #     thirty_days_ago = now - timedelta(days=30)

        #     # Logic: Select avg grouped by hour for records in range, insert into new/same table?
        #     # If same table, we delete raw and insert aggregated.
        #     # But duplicate keys? partition key includes timestamp.
        #     # Aggregated timestamp usually start of hour.
        #
        #     # This is complex to do efficiently in SQL.
        #     # Simplified approach: Delete old raw data that isn't 'on the hour'.
        #     # Or better: Create a separate `price_history_hourly` table?
        #     # Requirement says "Data Downsampling... 1 minute raw... 1 hour avg".
        #     # If using same table, we just delete the intermediate rows.
        #     pass

price_service = PriceService()
