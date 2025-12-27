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
            all_price_updates = []  # Accumulate ALL updates for alert checking
            
            for i, chunk in enumerate(chunks):
                # Extract IDs for this chunk
                chunk_ids = [item.torn_id for item in chunk]
                
                if not chunk_ids:
                    continue

                logger.info(f"Processing batch {i+1}/{len(chunks)} ({len(chunk_ids)} items)")
                
                # Fetch data for this chunk
                fetched_data = await torn_api_service.get_items(chunk_ids, include_listings=True)
                
                # Save data
                price_updates = []  # Per-chunk updates for DB insert
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

                    # Get cheapest bazaar seller ID for notification URL
                    cheapest_bazaar_seller = None
                    if data and data.get('listings') and data['listings'].get('bazaar'):
                        bazaar_list = data['listings']['bazaar']
                        if bazaar_list and len(bazaar_list) > 0:
                            cheapest_bazaar_seller = bazaar_list[0].get('id')  # seller ID

                    price_updates.append({
                        "item_id": item.id,
                        "torn_id": item.torn_id,  # For Torn Market URL
                        "item_name": item.name, # Added for alerts
                        "timestamp": now,
                        "market_price": market_price,
                        "bazaar_price": bazaar_price,
                        "market_price_avg": market_price_avg,
                        "bazaar_price_avg": bazaar_price_avg,
                        "cheapest_bazaar_seller": cheapest_bazaar_seller  # For Bazaar URL
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
                    # Filter out keys not in PriceLog model (like item_name, torn_id, cheapest_bazaar_seller)
                    db_inserts = [{k: v for k, v in u.items() if k not in ('item_name', 'torn_id', 'cheapest_bazaar_seller')} for u in price_updates]
                    stmt = insert(PriceLog).values(db_inserts)
                    await session.execute(stmt)
                    await session.commit()
                    processed_count += len(price_updates)
                    all_price_updates.extend(price_updates)  # Accumulate for alert check
            
            logger.info(f"Finished updating prices. Total processed: {processed_count}")

            # 4. Check Alerts (using ALL accumulated updates)
            await self.check_alerts(session, all_price_updates)

    async def check_alerts(self, session, price_updates):
        """
        Check active alerts against the latest price updates.
        price_updates: List of dicts {item_id, market_price, bazaar_price, ...}
        """
        from app.models.models import PriceAlert
        from app.services.notification_service import notification_service
        
        if not price_updates:
            return

        # Extract item IDs from updates
        updated_item_ids = [u['item_id'] for u in price_updates]
        
        # 1. Fetch active alerts for these items
        stmt = select(PriceAlert).where(
            PriceAlert.item_id.in_(updated_item_ids),
            PriceAlert.is_active == True
        )
        result = await session.execute(stmt)
        active_alerts = result.scalars().all()
        
        if not active_alerts:
            return

        # Map updates for quick lookup
        updates_map = {u['item_id']: u for u in price_updates}
        
        alerts_triggered = []
        
        for alert in active_alerts:
            update = updates_map.get(alert.item_id)
            if not update:
                continue
                
            market_price = update.get('market_price') or 0
            bazaar_price = update.get('bazaar_price') or 0
            
            # We check both prices against the target? 
            # Usually users want "Cheapest available price".
            # So let's check the minimum non-zero price.
            prices = []
            if market_price > 0: prices.append(market_price)
            if bazaar_price > 0: prices.append(bazaar_price)
            
            if not prices:
                logger.info(f"Alert Check: Item {alert.item_id} has no valid prices. Skipping.")
                continue
                
            best_price = min(prices)
            market_type = "Market" if best_price == market_price else "Bazaar"
            if market_price > 0 and bazaar_price > 0 and market_price == bazaar_price:
                market_type = "Market/Bazaar"

            logger.info(f"Alert Check: Item {alert.item_id}. Best Price: {best_price}. Target: {alert.target_price} ({alert.condition})")

            triggered = False
            if alert.condition == 'below' and best_price < alert.target_price:
                triggered = True
            elif alert.condition == 'above' and best_price > alert.target_price:
                triggered = True
            
            if triggered:
                # Send Notification
                # We need item Name.. verifying if it's in update or we need to fetch.
                # The update dict doesn't have name. Item object has it.
                # Optimization: In `update_all_prices`, we have the `item` objects.
                # But here we only have IDs.
                # Let's just fetch item name or assume we can get it from relationship if eager loaded.
                # For now, let's just re-fetch or use what we have.
                # Actually, `alert.item` relationship should work if lazy loading is async-compatible or we join it.
                # asyncmy/sqlalchemy async relationships often require explicit options. 
                # Let's do a quick lookup query or pass Item names in price_updates?
                # Passing names in price_updates is easier.
                pass
                
                # We will trigger the notification task
                item_name = update.get('item_name', f"Item {alert.item_id}")
                torn_id = update.get('torn_id', alert.item_id)  # Use torn_id for URL
                bazaar_seller_id = update.get('cheapest_bazaar_seller')  # For Bazaar URL
                logger.info(f"Sending alert for {item_name}: torn_id={torn_id}, market_type={market_type}, bazaar_seller={bazaar_seller_id}")
                await notification_service.send_discord_alert(
                    item_name=item_name,
                    item_id=torn_id,  # This is now torn_id for correct URL
                    price=best_price,
                    market_type=market_type,
                    condition=alert.condition,
                    target_price=alert.target_price,
                    bazaar_seller_id=bazaar_seller_id
                )
                
                # Deactivate alert only if it's a one-time alert
                if not alert.is_persistent:
                    alert.is_active = False
                alerts_triggered.append(alert)
        
        if alerts_triggered:
            # Commit changes (deactivations)
            await session.commit()
            logger.info(f"Triggered {len(alerts_triggered)} alerts.")

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
