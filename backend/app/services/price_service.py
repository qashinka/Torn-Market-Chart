import logging
from datetime import datetime, timedelta
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
            
            items_to_process = []
            now_utc = datetime.utcnow()
            
            # Backoff Strategy Constants
            FAILURE_THRESHOLD_LOW = 5   # If failures >= 5, check every 10 min
            FAILURE_THRESHOLD_HIGH = 20 # If failures >= 20, check every 60 min
            BACKOFF_LOW_MINUTES = 10
            BACKOFF_HIGH_MINUTES = 60
            
            # Filter Tracked Items
            # Always fetch tracked items (User requirement: prioritization)
            for item in tracked_items:
                items_to_process.append(item)

            tracked_count_filtered = len(items_to_process)
            
            if tracked_count_filtered < rate_limit:
                remaining_capacity = rate_limit - tracked_count_filtered
                logger.info(f"Tracked items: {tracked_count_filtered}. Spare capacity: {remaining_capacity}. Fetching untracked items...")
                
                # Fetch untracked items
                # Exclude items that satisfy the backoff condition:
                # (FC >= HIGH and Updated > Now - 60m) OR (FC >= LOW and Updated > Now - 10m)
                
                # In SQL logic for Exclusion:
                # WHERE is_tracked = False AND NOT ( ... )
                
                # Since we want to update checking often, constructing this query:
                from sqlalchemy import or_, and_
                
                limit_high = now_utc - timedelta(minutes=BACKOFF_HIGH_MINUTES)
                limit_low = now_utc - timedelta(minutes=BACKOFF_LOW_MINUTES)
                
                # Condition for items TO IGNORE (Backoff active)
                # Ignore if: (Fail >= High AND LastUpd > limit_high) OR (Fail >= Low AND LastUpd > limit_low)
                
                # So we select items where NOT that condition.
                # De Morgan's:
                # Select where:
                # (Fail < High OR LastUpd <= limit_high) AND (Fail < Low OR LastUpd <= limit_low)
                
                # Simpler:
                # is_tracked == False
                # AND (failure_count < LOW OR last_updated_at <= limit_low) 
                # AND (failure_count < HIGH OR last_updated_at <= limit_high) # Redundant if limit_high < limit_low? 
                
                # Actually, simpler to just say:
                # We want eligible items.
                # An item is eligible if:
                # 1. failure_count < LOW
                # OR
                # 2. failure_count >= LOW AND failure_count < HIGH AND last_updated_at <= limit_low
                # OR
                # 3. failure_count >= HIGH AND last_updated_at <= limit_high
                
                stmt = select(Item).where(
                    Item.is_tracked == False,
                    or_(
                        Item.failure_count < FAILURE_THRESHOLD_LOW,
                        and_(
                            Item.failure_count >= FAILURE_THRESHOLD_LOW,
                            Item.failure_count < FAILURE_THRESHOLD_HIGH,
                            Item.last_updated_at <= limit_low
                        ),
                        and_(
                            Item.failure_count >= FAILURE_THRESHOLD_HIGH,
                            Item.last_updated_at <= limit_high
                        )
                    )
                ).order_by(Item.last_updated_at.asc()).limit(remaining_capacity)
                
                result = await session.execute(stmt)
                untracked_items = result.scalars().all()
                items_to_process.extend(untracked_items)
            
            total_items = len(items_to_process)
            logger.info(f"Targeting usage: {rate_limit} req/min. Total items to update in this cycle: {total_items}")
            
            # Limit strictly to rate limit
            items_to_process = items_to_process[:rate_limit]

            # Chunk Process
            chunk_size = 50 
            chunks = [items_to_process[i:i + chunk_size] for i in range(0, len(items_to_process), chunk_size)]
            
            processed_count = 0
            
            for i, chunk in enumerate(chunks):
                # Extract IDs for this chunk
                chunk_ids = [item.torn_id for item in chunk]
                
                if not chunk_ids:
                    continue

                logger.info(f"Processing batch {i+1}/{len(chunks)} ({len(chunk_ids)} items)")
                
                # Fetch data for this chunk
                fetched_data = await torn_api_service.get_items(chunk_ids, include_listings=True)
                
                # Save data
                price_updates = []
                now = datetime.utcnow()
                
                for item in chunk:
                    data = fetched_data.get(item.torn_id)
                    market_price = 0
                    bazaar_price = 0
                    market_price_avg = 0
                    bazaar_price_avg = 0
                    status = {}
                    
                    if data:
                        market_price = data.get('market_price', 0)
                        bazaar_price = data.get('bazaar_price', 0)
                        market_price_avg = data.get('market_price_avg', 0)
                        bazaar_price_avg = data.get('bazaar_price_avg', 0)
                        status = data.get('status', {})
                    else:
                        logger.warning(f"Failed to fetch data for item {item.name} ({item.torn_id})")
                    
                    # Update Failure Count
                    # Success = API request succeeded (even if price is 0/OOS)
                    # Failure = API request failed (network error, rate limit, etc.)
                    if status.get('market') or status.get('bazaar'):
                        item.failure_count = 0
                    else:
                        item.failure_count = (item.failure_count or 0) + 1
                        if item.failure_count >= FAILURE_THRESHOLD_LOW:
                             logger.info(f"Item {item.name} ({item.torn_id}) failed {item.failure_count} times (API Error). Backing off.")

                    price_updates.append({
                        "item_id": item.id,
                        "timestamp": now,
                        "market_price": market_price,
                        "bazaar_price": bazaar_price,
                        "market_price_avg": market_price_avg,
                        "bazaar_price_avg": bazaar_price_avg
                    })

                    # Update Item cache
                    item.last_market_price = market_price
                    item.last_bazaar_price = bazaar_price
                    item.last_market_price_avg = market_price_avg
                    item.last_bazaar_price_avg = bazaar_price_avg
                    item.last_updated_at = now
                    
                    # Save orderbook snapshot (top 5 for each)
                    if data and data.get('listings'):
                        import json
                        snapshot = {
                            "market": data['listings'].get('market', [])[:5],
                            "bazaar": data['listings'].get('bazaar', [])[:5],
                        }
                        item.orderbook_snapshot = json.dumps(snapshot)
                
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
