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
        Respects configured API rate limits and execution time.
        """
        from app.services.config_service import config_service
        from app.services.torn_api import torn_api_service
        import asyncio

        # 1. Load Configuration
        from app.models.models import ApiKey
        from sqlalchemy import func

        # 1. Load Configuration & Active Keys
        base_limit = int(await config_service.get_config('api_rate_limit', '50')) # requests per minute per key
        
        async with SessionLocal() as session:
            # Count active keys
            result = await session.execute(select(func.count(ApiKey.id)).where(ApiKey.is_active == True))
            key_count = result.scalar()
            
            # If no DB keys, we assume 1 env key is available (fallback)
            if not key_count:
                key_count = 1
                
            rate_limit = base_limit * key_count
            logger.info(f"Rate Limit Config: {base_limit}/key. Active Keys: {key_count}. Effective Limit: {rate_limit} req/min.")

            # 1. Get all tracked items (Priority 1)
            result = await session.execute(select(Item).where(Item.is_tracked))
            tracked_items = result.scalars().all()
            
            # Simple Rate Limiter Logic for this run
            # We want to process ALL tracked items if possible, but we are bound by rate_limit * time?
            # Actually, user wants tracked items to be updated every cycle (every minute).
            # So rate_limit MUST be >= tracked_items count for optimal performance.
            # If rate_limit < tracked_items, we process what we can (first N tracked).
            
            # Additional Request: Use "Spare" capacity for untracked items.
            # 1. Update Tracked Items
            # 2. If count < rate_limit, fetch Untracked Items (oldest updated first) and update them.
            
            items_to_process = list(tracked_items)
            tracked_count = len(items_to_process)
            
            if tracked_count < rate_limit:
                remaining_capacity = rate_limit - tracked_count
                logger.info(f"Tracked items: {tracked_count}. Spare capacity: {remaining_capacity}. Fetching untracked items...")
                
                # Fetch untracked items, sorted by last_updated_at ASC (oldest first)
                stmt = select(Item).where(Item.is_tracked == False).order_by(Item.last_updated_at.asc()).limit(remaining_capacity)
                result = await session.execute(stmt)
                untracked_items = result.scalars().all()
                items_to_process.extend(untracked_items)
            
            total_items = len(items_to_process)
            logger.info(f"Targeting usage: {rate_limit} req/min. Total items to update in this cycle: {total_items}")
            
            # Group items into chunks of `rate_limit` size
            # Since we constructed items_to_process to be <= rate_limit (mostly), 
            # this loop might just run once or twice depending on how we handle large lists.
            # Wait, if tracked_items > rate_limit, we still only process `rate_limit` items?
            # Or do we process ALL tracked items regardless of limit (and take longer)?
            # The user requirement implies "strict rate limit". So we must cap at rate_limit per minute.
            
            # So we slice the list to rate_limit.
            items_to_process = items_to_process[:rate_limit]
            
            # Since we are now strictly limiting to `rate_limit` items per cycle (which is 1 min),
            # check chunking is not really needed for "wait" purposes within the cycle, 
            # unless we want to spread load? 
            # Implemented: One big batch or small batches with no wait (since total <= limit).
            
            chunk_size = 50 # Internal batching for API calls
            chunks = [items_to_process[i:i + chunk_size] for i in range(0, len(items_to_process), chunk_size)]
            
            processed_count = 0
            
            for i, chunk in enumerate(chunks):
                # Extract IDs for this chunk
                chunk_ids = [item.torn_id for item in chunk]
                
                if not chunk_ids:
                    continue

                logger.info(f"Processing batch {i+1}/{len(chunks)} ({len(chunk_ids)} items)")
                
                # Fetch data for this chunk
                fetched_data = await torn_api_service.get_items(chunk_ids)
                
                # Save data
                price_updates = []
                now = datetime.utcnow()
                
                for item in chunk:
                    data = fetched_data.get(item.torn_id)
                    market_price = 0
                    bazaar_price = 0
                    
                    if data:
                        market_price = data.get('market_price', 0)
                        bazaar_price = data.get('bazaar_price', 0)
                    else:
                        logger.warning(f"Failed to fetch data for item {item.name} ({item.torn_id})")
                    
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
                
                if price_updates:
                    stmt = insert(PriceLog).values(price_updates)
                    await session.execute(stmt)
                    await session.commit()
                    processed_count += len(price_updates)
            
            logger.info(f"Finished updating prices. Total processed: {processed_count}")

            # 4. Check Alerts (Simplified)
            # await self.check_alerts(session, [])

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
