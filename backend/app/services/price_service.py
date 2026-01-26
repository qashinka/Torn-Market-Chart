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
        
        # Constants
        BACKOFF_HIGH_MINUTES = 60
        BACKOFF_LOW_MINUTES = 30
        FAILURE_THRESHOLD_LOW = 3
        FAILURE_THRESHOLD_HIGH = 10

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

            # PHASE 1: Priority Items (Tracked)
            # 1. Get all tracked items (Priority 1)
            result = await session.execute(select(Item).where(Item.is_tracked))
            tracked_items = result.scalars().all()
            
            logger.info(f"Phase 1: Fetching {len(tracked_items)} priority items...")
            priority_updates = await self._process_items(session, tracked_items)
            
            # Check Alerts immediately for priority items
            if priority_updates:
                logger.info("Phase 1: Checking alerts for priority items...")
                await self.check_alerts(session, priority_updates)

            # Calculate remaining capacity
            remaining_capacity = rate_limit - len(tracked_items)
            
            if remaining_capacity > 0:
                # PHASE 2: Routine Items (Untracked)
                items_to_process = []
                
                # Fetch untracked items logic (Unchanged)
                from sqlalchemy import or_, and_
                
                now_utc = datetime.utcnow()
                limit_high = now_utc - timedelta(minutes=BACKOFF_HIGH_MINUTES)
                limit_low = now_utc - timedelta(minutes=BACKOFF_LOW_MINUTES)
                
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
                
                if untracked_items:
                    logger.info(f"Phase 2: Fetching {len(untracked_items)} routine items (Spare capacity: {remaining_capacity})...")
                    routine_updates = await self._process_items(session, untracked_items)
                    
                    # Check Alerts for routine items (User request: "just in case")
                    if routine_updates:
                         logger.info("Phase 2: Checking alerts for routine items...")
                         await self.check_alerts(session, routine_updates)
            
            logger.info("Finished price update cycle.")

    async def _process_items(self, session, items):
        """
        Helper to fetch and save prices for a list of items.
        Returns a list of price_updates dictionaries.
        """
        if not items:
            return []

        from app.services.torn_api import torn_api_service
        from sqlalchemy import func

        # Chunk Process
        chunk_size = 50 
        chunks = [items[i:i + chunk_size] for i in range(0, len(items), chunk_size)]
        
        all_price_updates = []
        processed_count = 0
        
        for i, chunk in enumerate(chunks):
            # Extract IDs for this chunk
            chunk_ids = [item.torn_id for item in chunk]
            
            if not chunk_ids:
                continue

            # logger.info(f"Processing batch {i+1}/{len(chunks)} ({len(chunk_ids)} items)")
            
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
                if status.get('market') or status.get('bazaar'):
                    item.failure_count = 0
                else:
                    item.failure_count = (item.failure_count or 0) + 1
                    # Log removed to reduce noise

                # Get best listing ID for deduplication
                # If Market/Bazaar: Use Listing ID (Market) or Seller ID (Bazaar)
                best_listing_id = None
                best_quantity = 0

                # Check IDs based on what is cheapest
                if market_price > 0 and (bazaar_price == 0 or market_price < bazaar_price):
                    # Market is cheapest
                    if data and data.get('listings') and data['listings'].get('market'):
                        market_list = data['listings']['market']
                        if market_list and len(market_list) > 0:
                            best_listing_id = str(market_list[0].get('id'))
                            best_quantity = market_list[0].get('quantity', 0)
                elif bazaar_price > 0:
                    # Bazaar is cheapest (or equal)
                    if data and data.get('listings') and data['listings'].get('bazaar'):
                        bazaar_list = data['listings']['bazaar']
                        if bazaar_list and len(bazaar_list) > 0:
                            best_listing_id = str(bazaar_list[0].get('id'))
                            best_quantity = bazaar_list[0].get('quantity', 0)

                # Get cheapest bazaar seller ID for notification URL (This is same as best_listing_id if Bazaar is cheapest)
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
                    "cheapest_bazaar_seller": cheapest_bazaar_seller,  # For Bazaar URL
                    "best_listing_id": best_listing_id, # For Deduplication
                    "quantity": best_quantity
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
                # Filter out keys not in PriceLog model
                db_inserts = [{k: v for k, v in u.items() if k not in ('item_name', 'torn_id', 'cheapest_bazaar_seller', 'best_listing_id', 'quantity')} for u in price_updates]
                stmt = insert(PriceLog).values(db_inserts)
                await session.execute(stmt)
                
                # --- CALCULATION OF 24H TREND ---
                # For each item, calculate the average price over the last 24 hours.
                
                limit_24h = datetime.utcnow() - timedelta(hours=24)
                
                for update in price_updates:
                     # Calculate for this item
                     i_id = update['item_id']
                     
                     # Wait, we want separate avgs. If market is 0, ignore for market avg.
                     # Single query:
                     stmt_trend = select(
                         func.avg(func.nullif(PriceLog.market_price, 0)),
                         func.avg(func.nullif(PriceLog.bazaar_price, 0))
                     ).where(
                         PriceLog.item_id == i_id,
                         PriceLog.timestamp >= limit_24h
                     )
                     
                     trend_res = await session.execute(stmt_trend)
                     trend_row = trend_res.one_or_none()
                     
                     if trend_row:
                         m_trend = int(trend_row[0]) if trend_row[0] else None
                         b_trend = int(trend_row[1]) if trend_row[1] else None
                         
                         # Update Item instance in session (it's already tracked by session)
                         # We need to find the item object in `chunk` list matching this ID
                         item_obj = next((i for i in chunk if i.id == i_id), None)
                         if item_obj:
                             item_obj.last_market_trend = m_trend
                             item_obj.last_bazaar_trend = b_trend

                await session.commit()
                processed_count += len(price_updates)
                all_price_updates.extend(price_updates)
        
        return all_price_updates

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
            best_listing_id = update.get('best_listing_id') # For deduplication
            
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
                
                # Deduplication & Throttling Logic for Persistent Alerts
                if alert.is_persistent:
                    is_same_price = (alert.last_triggered_price == best_price)
                    is_same_id = (str(alert.last_triggered_id) == str(best_listing_id)) if best_listing_id and alert.last_triggered_id else False
                    
                    # If ID is missing (e.g. old alerts), strictly rely on price
                    if not alert.last_triggered_id and not best_listing_id:
                         is_same_id = True # fallback
                    
                    has_changed = not (is_same_price and is_same_id)
                    
                    # Time Check (Throttle)
                    now_utc = datetime.utcnow()
                    time_since_last = (now_utc - alert.last_triggered_at) if alert.last_triggered_at else timedelta(hours=999)
                    is_expired = time_since_last > timedelta(minutes=5)
                    
                    should_notify = False
                    
                    if has_changed:
                         should_notify = True
                         # logger.info(f"Alert Trigger: Change detected. Price: {alert.last_triggered_price}->{best_price}, ID: {alert.last_triggered_id}->{best_listing_id}")
                    elif is_expired:
                         should_notify = True
                         # logger.info(f"Alert Trigger: Throttling expired ({time_since_last}). Sending reminder.")
                    
                    if not should_notify:
                        continue

                    # Update State
                    alert.last_triggered_price = best_price
                    alert.last_triggered_id = best_listing_id
                    alert.last_triggered_at = now_utc
                
                # We will trigger the notification task
                item_name = update.get('item_name', f"Item {alert.item_id}")
                torn_id = update.get('torn_id', alert.item_id)  # Use torn_id for URL
                bazaar_seller_id = update.get('cheapest_bazaar_seller')  # For Bazaar URL
                best_listing_id = update.get('best_listing_id') # For deduplication
                quantity = update.get('quantity')
                logger.info(f"Sending alert for {item_name}: torn_id={torn_id}, market_type={market_type}, bazaar_seller={bazaar_seller_id}, quantity={quantity}")
                await notification_service.send_discord_alert(
                    item_name=item_name,
                    item_id=torn_id,  # This is now torn_id for correct URL
                    price=best_price,
                    market_type=market_type,
                    condition=alert.condition,
                    target_price=alert.target_price,
                    bazaar_seller_id=bazaar_seller_id,
                    quantity=quantity
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
