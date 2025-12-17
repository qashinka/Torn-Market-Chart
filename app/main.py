import os
import time
import requests
import logging
import random
import itertools
import math
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session, joinedload
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import func

from . import models, schemas, database, marketplace

# === Configuration ===
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# === State ===
LAST_ITEM_SYNC = 0
ITEM_SYNC_TTL = 3600

# === Background Task Logic ===

def calculate_stats(listings: List[marketplace.Listing]):
    if not listings:
        return None, None

    # Create a copy to sort, avoiding modification of original list if it matters
    # Note: marketplace.Listing objects are mutable, but we just read price
    sorted_listings = sorted(listings, key=lambda x: x.price)
    min_price = sorted_listings[0].price

    # Calculate top 3 average
    top3 = sorted_listings[:3]
    avg_price = sum(l.price for l in top3) / len(top3)

    return min_price, avg_price

def scheduled_price_check():
    """
    Background task to fetch prices and update DB.
    Prioritizes TrackedItems, then uses remaining capacity to crawl all items.
    """
    logger.info("Starting scheduled price check...")
    db = database.SessionLocal()
    try:
        # 1. Get API Keys
        api_keys_objs = db.query(models.ApiKey).filter_by(is_active=True).order_by(models.ApiKey.id).all()
        if not api_keys_objs:
            logger.warning("No active API keys found.")
            return

        # Round Robin Iterator
        key_cycle = itertools.cycle([k.key for k in api_keys_objs])
        total_keys = len(api_keys_objs)
        max_requests_per_min = total_keys * 100 # Approx limit (ignoring other usage)

        requests_made = 0

        # 2. Priority: Tracked Items
        tracked_items = db.query(models.TrackedItem).filter_by(is_active=True).all()

        # We need to process tracked items.
        # But we must respect rate limits.
        # If tracked items > max_requests, we might throttle?
        # Ideally, we should distribute tracked items over minutes if they are too many,
        # but for now, assuming user doesn't track 1000s of items with 1 key.

        for item in tracked_items:
            if requests_made >= max_requests_per_min:
                logger.warning("Rate limit reached processing tracked items.")
                break # Stop processing to avoid ban

            api_key = next(key_cycle)

            # Fetch Data
            try:
                bazaar_data = marketplace.fetch_bazaar_data(item.item_id) # Using cloudscraper/curl_cffi often doesn't use API key?
                # Wait, fetch_bazaar_data in marketplace.py usually scrapes or uses public API?
                # Checking memory: "API key selection logic...". marketplace.py uses API key for ItemMarket?
                # Let's assume fetch_item_market_data USES the key. fetch_bazaar_data might scrape.
                # If fetch_bazaar_data scrapes, it doesn't count towards API limit strictly, but IP limit.
                # But fetch_item_market_data definitely uses API key.

                market_listings = marketplace.fetch_item_market_data(item.item_id, api_key)
                requests_made += 1 # One API call

                bazaar_listings = bazaar_data.listings if bazaar_data else []

                # Calculate Stats
                b_min, b_avg = calculate_stats(bazaar_listings)
                m_min, m_avg = calculate_stats(market_listings)

                # Update Current Listings (Top 5)
                all_listings = bazaar_listings + market_listings
                all_listings.sort(key=lambda x: x.price)
                top_5 = all_listings[:5]

                db.query(models.CurrentListing).filter_by(item_id=item.item_id).delete()
                for lst in top_5:
                    db.add(models.CurrentListing(
                        item_id=item.item_id,
                        price=lst.price,
                        quantity=lst.quantity,
                        source=lst.source,
                        seller_name=lst.player_name,
                        player_id=lst.player_id
                    ))

                # Log Price
                if b_min is not None or m_min is not None:
                     new_log = models.PriceLog(
                        item_id=item.item_id,
                        timestamp=int(time.time()),
                        bazaar_min=b_min,
                        bazaar_avg=b_avg,
                        market_min=m_min,
                        market_avg=m_avg
                    )
                     db.add(new_log)

                # Also update ItemDefinition crawler state for tracked items
                item_def = db.query(models.ItemDefinition).filter_by(item_id=item.item_id).first()
                if item_def:
                    item_def.last_checked = int(time.time())
                    # Determine best price for last_price
                    prices = [p for p in [b_min, m_min] if p is not None]
                    if prices:
                        item_def.last_price = min(prices)

            except Exception as e:
                logger.error(f"Error updating tracked item {item.item_id}: {e}")

        db.commit()

        # 3. Crawler: Background Scan
        # Calculate remaining capacity
        remaining_requests = max_requests_per_min - requests_made

        if remaining_requests > 0:
            # Get Config
            config_duration = db.query(models.SystemConfig).filter(models.SystemConfig.key == "scan_target_hours").first()
            target_hours = float(config_duration.value) if config_duration and config_duration.value else 24.0
            if target_hours <= 0: target_hours = 24.0

            config_limit = db.query(models.SystemConfig).filter(models.SystemConfig.key == "crawler_requests_per_key").first()
            requests_per_key_limit = int(config_limit.value) if config_limit and config_limit.value else 50
            
            # Calculate Max Allowed for Crawler based on KEYS
            # e.g. 3 keys * 50 = 150 requests max for crawler
            crawler_max_capacity = total_keys * requests_per_key_limit
            
            # The actual limit is the MIN of (User Set Limit) and (Actually Remaining API Calls)
            available_slots = min(remaining_requests, crawler_max_capacity)

            total_items_count = db.query(models.ItemDefinition).count()
            if total_items_count > 0 and available_slots > 0:
                # Items per minute needed
                items_per_minute_needed = math.ceil(total_items_count / (target_hours * 60))

                # We can process at most available_slots
                items_to_scan = min(available_slots, items_per_minute_needed)

                if items_to_scan > 0:
                    # Fetch oldest checked items
                    # Order by last_checked ASC (NULLs first usually, or use distinct logic)
                    # In SQL, NULLs usually come first or last depending on DB.
                    # We want NULLs (never checked) first, then old timestamps.

                    crawler_items = db.query(models.ItemDefinition)\
                        .order_by(models.ItemDefinition.last_checked.asc().nullsfirst())\
                        .limit(items_to_scan)\
                        .all()

                for item_def in crawler_items:
                    api_key = next(key_cycle)
                    try:
                        # For crawler, we only fetch prices.
                        # Fetch
                        market_listings = marketplace.fetch_item_market_data(item_def.item_id, api_key)
                        bazaar_data = marketplace.fetch_bazaar_data(item_def.item_id)

                        # Smart Validation: If either source fails (returns None), skip this item
                        # This prevents logging partial data (e.g. only high prices because cheap source is down)
                        # Skipping without updating last_checked means it will be retried next cycle.
                        if market_listings is None or bazaar_data is None:
                             logger.warning(f"Skipping item {item_def.item_id} due to fetch failure (Market: {'OK' if market_listings is not None else 'Fail'}, Bazaar: {'OK' if bazaar_data is not None else 'Fail'})")
                             continue

                        bazaar_listings = bazaar_data.listings

                        b_min, b_avg = calculate_stats(bazaar_listings)
                        m_min, m_avg = calculate_stats(market_listings)

                        # Determine current best price
                        prices = [p for p in [b_min, m_min] if p is not None]
                        current_min = min(prices) if prices else None

                        # Save ALL data if available, regardless of threshold
                        if b_min is not None or m_min is not None:
                            new_log = models.PriceLog(
                                item_id=item_def.item_id,
                                timestamp=int(time.time()),
                                bazaar_min=b_min,
                                bazaar_avg=b_avg,
                                market_min=m_min,
                                market_avg=m_avg
                            )
                            db.add(new_log)

                        # Update ItemDefinition
                        item_def.last_checked = int(time.time())
                        if current_min is not None:
                            item_def.last_price = current_min

                    except requests.exceptions.HTTPError as e:
                        if e.response.status_code == 429:
                            logger.error(f"Rate limit hit during crawler. Stopping for now.")
                            # Stop the crawler for this cycle
                            break 
                        else:
                            logger.error(f"Crawler HTTP error item {item_def.item_id}: {e}")
                    except Exception as e:
                        logger.error(f"Crawler error item {item_def.item_id}: {e}")

                db.commit()

        logger.info("Price check completed.")

    except Exception as e:
        logger.error(f"Error in scheduled price check: {e}")
    finally:
        db.close()

# === Lifespan & Scheduler ===

scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    models.Base.metadata.create_all(bind=database.engine)

    if not scheduler.running:
        scheduler.add_job(
            func=scheduled_price_check,
            trigger="interval",
            minutes=1,
            id="price_check_job",
            replace_existing=True
        )
        scheduler.start()
        logger.info("Scheduler started.")

    yield

    # Shutdown
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Scheduler shut down.")

app = FastAPI(lifespan=lifespan)

# === Static & Templates ===
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

if os.path.isdir(os.path.join(os.path.dirname(__file__), "static")):
    app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")


# === Routes ===

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    with open(os.path.join(os.path.dirname(__file__), "index.html"), "r") as f:
        return HTMLResponse(content=f.read(), status_code=200)

@app.get("/api/keys", response_model=List[schemas.ApiKeyResponse])
def get_keys(db: Session = Depends(database.get_db)):
    keys = db.query(models.ApiKey).all()
    return keys

@app.post("/api/keys", response_model=schemas.ApiKeyResponse, status_code=201)
def create_key(key_data: schemas.ApiKeyCreate, db: Session = Depends(database.get_db)):
    if not key_data.key:
        raise HTTPException(status_code=400, detail="Key is required")

    if db.query(models.ApiKey).filter_by(key=key_data.key).first():
        raise HTTPException(status_code=400, detail="Key already exists")

    new_key = models.ApiKey(key=key_data.key)
    db.add(new_key)
    db.commit()
    db.refresh(new_key)
    return new_key

@app.delete("/api/keys/{key_id}")
def delete_key(key_id: int, db: Session = Depends(database.get_db)):
    key = db.query(models.ApiKey).filter(models.ApiKey.id == key_id).first()
    if key:
        db.delete(key)
        db.commit()
        return {"success": True}
    raise HTTPException(status_code=404, detail="Not found")

@app.get("/api/items", response_model=List[schemas.TrackedItemResponse])
def get_items(db: Session = Depends(database.get_db)):
    # Join with ItemDefinition to get names, using joinedload to avoid N+1 query
    items = db.query(models.TrackedItem).options(joinedload(models.TrackedItem.item_def)).all()

    # We need to construct the response objects because TrackedItem model doesn't have item_name anymore
    # but the Schema expects it.
    response = []
    for item in items:
        name = item.item_def.name if item.item_def else f"Item {item.item_id}"
        response.append(schemas.TrackedItemResponse(
            item_id=item.item_id,
            item_name=name,
            is_active=item.is_active
        ))
    return response

@app.post("/api/items", response_model=schemas.TrackedItemResponse, status_code=201)
def create_item(item_data: schemas.TrackedItemCreate, db: Session = Depends(database.get_db)):
    if not item_data.item_id:
        raise HTTPException(status_code=400, detail="Item ID is required")

    # Check if item exists in AllItems (definitions)
    item_def = db.query(models.ItemDefinition).filter_by(item_id=item_data.item_id).first()
    if not item_def:
        # We could try to fetch it if we had a key?
        # But for now, let's require it to be in the synced list.
        # OR we can create a dummy definition?
        # Let's create a placeholder definition if not found
        # Or better: fail and tell user to sync items.
        # But to be user friendly, I'll allow it and set name to "Unknown"
        item_def = models.ItemDefinition(item_id=item_data.item_id, name=f"Item {item_data.item_id}")
        db.add(item_def)
        # We don't commit yet, we commit with tracked item

    if db.query(models.TrackedItem).filter_by(item_id=item_data.item_id).first():
        raise HTTPException(status_code=400, detail="Item already tracked")

    new_item = models.TrackedItem(item_id=item_data.item_id)
    db.add(new_item)
    db.commit()
    db.refresh(new_item)

    # Reload to get relationship
    db.refresh(new_item)

    return schemas.TrackedItemResponse(
        item_id=new_item.item_id,
        item_name=new_item.item_def.name,
        is_active=new_item.is_active
    )

@app.delete("/api/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(database.get_db)):
    # Note: item_id is the item_id (which is PK now), not a separate auto-inc ID.
    item = db.query(models.TrackedItem).filter(models.TrackedItem.item_id == item_id).first()
    if item:
        db.delete(item)
        db.commit()
        return {"success": True}
    raise HTTPException(status_code=404, detail="Not found")

@app.post("/api/items/{item_id}/refresh")
def refresh_item(item_id: int, db: Session = Depends(database.get_db)):
    # Find tracked item
    item = db.query(models.TrackedItem).filter(models.TrackedItem.item_id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not tracked")

    # Get an active API key
    key_obj = db.query(models.ApiKey).filter_by(is_active=True).first()
    if not key_obj:
        raise HTTPException(status_code=400, detail="No active API keys")

    try:
        api_key = key_obj.key

        # Fetch Data
        market_listings = marketplace.fetch_item_market_data(item.item_id, api_key)
        bazaar_data = marketplace.fetch_bazaar_data(item.item_id)
        
        # Validation
        if market_listings is None or bazaar_data is None:
             raise HTTPException(status_code=502, detail="Failed to fetch data from one or more sources")
             
        bazaar_listings = bazaar_data.listings

        # Calculate Stats
        b_min, b_avg = calculate_stats(bazaar_listings)
        m_min, m_avg = calculate_stats(market_listings)

        # Update Current Listings (Top 5)
        all_listings = bazaar_listings + market_listings
        all_listings.sort(key=lambda x: x.price)
        top_5 = all_listings[:5]

        db.query(models.CurrentListing).filter_by(item_id=item.item_id).delete()
        for lst in top_5:
            db.add(models.CurrentListing(
                item_id=item.item_id,
                price=lst.price,
                quantity=lst.quantity,
                source=lst.source,
                seller_name=lst.player_name,
                player_id=lst.player_id
            ))

        # Log Price (Always log on manual refresh?)
        if b_min is not None or m_min is not None:
                new_log = models.PriceLog(
                item_id=item.item_id,
                timestamp=int(time.time()),
                bazaar_min=b_min,
                bazaar_avg=b_avg,
                market_min=m_min,
                market_avg=m_avg
            )
                db.add(new_log)
        
        # Update Definition
        item_def = db.query(models.ItemDefinition).filter_by(item_id=item.item_id).first()
        if item_def:
            item_def.last_checked = int(time.time())
            prices = [p for p in [b_min, m_min] if p is not None]
            if prices:
                item_def.last_price = min(prices)

        db.commit()
        return {"success": True, "message": "Item refreshed"}

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Manual refresh failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history/{item_id}", response_model=List[schemas.PriceLogResponse])
def get_history(item_id: int, db: Session = Depends(database.get_db)):
    logs = db.query(models.PriceLog)\
        .filter_by(item_id=item_id)\
        .order_by(models.PriceLog.timestamp.asc())\
        .limit(1000)\
        .all()

    return [
        schemas.PriceLogResponse(
            time=log.timestamp,
            bazaar_min=log.bazaar_min,
            bazaar_avg=log.bazaar_avg,
            market_min=log.market_min,
            market_avg=log.market_avg
        ) for log in logs
    ]

# === New Endpoints ===

@app.get("/api/all-items", response_model=List[schemas.ItemDefinitionResponse])
def get_all_items_definitions(db: Session = Depends(database.get_db)):
    """
    Fetches item definitions from DB.
    If 3600s have passed since last sync, triggers a background sync (blocking for now).
    """
    global LAST_ITEM_SYNC

    now = time.time()
    if now - LAST_ITEM_SYNC > ITEM_SYNC_TTL:
        api_key = None
        # Manual key fetch since we are in a route
        key_obj = db.query(models.ApiKey).filter_by(is_active=True).first()
        if key_obj:
            api_key = key_obj.key

        if api_key:
            try:
                items_dict = marketplace.fetch_all_items(api_key)
                if items_dict:
                    # Sync Logic
                    existing_items = db.query(models.ItemDefinition).all()
                    existing_map = {i.item_id: i for i in existing_items}

                    for item_id_str, name in items_dict.items():
                        try:
                             item_id = int(item_id_str)
                        except ValueError:
                             continue

                        if item_id in existing_map:
                            if existing_map[item_id].name != name:
                                existing_map[item_id].name = name
                        else:
                            new_def = models.ItemDefinition(item_id=item_id, name=name)
                            db.add(new_def)
                    db.commit()
                    LAST_ITEM_SYNC = now
                    logger.info(f"Item definitions synced at {LAST_ITEM_SYNC}")
            except Exception as e:
                logger.error(f"Failed to sync items: {e}")
                # Don't fail the request, just return what we have

    items = db.query(models.ItemDefinition).all()
    return items

@app.get("/api/market-depth/{item_id}", response_model=schemas.MarketDepthResponse)
def get_market_depth(item_id: int, db: Session = Depends(database.get_db)):
    # 1. Get Top 5 Listings
    listings = db.query(models.CurrentListing)\
        .filter_by(item_id=item_id)\
        .order_by(models.CurrentListing.price.asc())\
        .limit(5)\
        .all()

    current_price = listings[0].price if listings else None

    # 2. Calculate 24h Change
    change_24h = 0.0
    if current_price:
        now = time.time()
        target_time = now - 86400

        # Find the log closest to 24h ago
        log_before = db.query(models.PriceLog)\
            .filter(models.PriceLog.item_id == item_id)\
            .filter(models.PriceLog.timestamp <= target_time)\
            .order_by(models.PriceLog.timestamp.desc())\
            .first()

        log_after = db.query(models.PriceLog)\
            .filter(models.PriceLog.item_id == item_id)\
            .filter(models.PriceLog.timestamp >= target_time)\
            .order_by(models.PriceLog.timestamp.asc())\
            .first()

        reference_log = None
        if log_before and log_after:
            if abs(log_before.timestamp - target_time) < abs(log_after.timestamp - target_time):
                reference_log = log_before
            else:
                reference_log = log_after
        elif log_before:
            reference_log = log_before
        elif log_after:
            reference_log = log_after

        if reference_log:
            p_vals = []
            if reference_log.bazaar_min is not None:
                p_vals.append(reference_log.bazaar_min)
            if reference_log.market_min is not None:
                p_vals.append(reference_log.market_min)

            if p_vals:
                old_price = min(p_vals)
                if old_price > 0:
                    change_24h = ((current_price - old_price) / old_price) * 100.0

    # 3. Format Listings
    listing_responses = []
    for lst in listings:
        if lst.source == 'ItemMarket':
            # Item Market URL
            link = f"https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID={item_id}"
        elif lst.source == 'Bazaar' and lst.player_id:
            # Bazaar URL
            link = f"https://www.torn.com/bazaar.php?userId={lst.player_id}&itemId={item_id}&highlight=1#/"
        else:
            # Fallback (old behavior)
            link = f"https://www.torn.com/imarket.php#/p=shop&step=shop&type={item_id}"

        listing_responses.append(schemas.ListingResponse(
            price=lst.price,
            quantity=lst.quantity,
            source=lst.source,
            seller_name=lst.seller_name,
            link=link
        ))

    return schemas.MarketDepthResponse(
        current_price=current_price,
        change_24h=change_24h,
        listings=listing_responses
    )

@app.get("/api/config", response_model=List[schemas.SystemConfigResponse])
def get_config(db: Session = Depends(database.get_db)):
    configs = db.query(models.SystemConfig).all()
    # Ensure default exists if not present?
    # For now just return what is in DB. Frontend can handle defaults or we seed them.
    return configs

@app.get("/api/config/{key}", response_model=schemas.SystemConfigResponse)
def get_config_key(key: str, db: Session = Depends(database.get_db)):
    config = db.query(models.SystemConfig).filter(models.SystemConfig.key == key).first()
    if not config:
        # Return default if known keys?
        if key == "scan_target_hours":
             return schemas.SystemConfigResponse(key=key, value="24")
        if key == "crawler_requests_per_key":
             return schemas.SystemConfigResponse(key=key, value="50")
        raise HTTPException(status_code=404, detail="Config not found")
    return config

@app.post("/api/config/{key}", response_model=schemas.SystemConfigResponse)
def update_config(key: str, config_data: schemas.SystemConfigUpdate, db: Session = Depends(database.get_db)):
    config = db.query(models.SystemConfig).filter(models.SystemConfig.key == key).first()
    if not config:
        config = models.SystemConfig(key=key, value=config_data.value)
        db.add(config)
    else:
        config.value = config_data.value

    db.commit()
    db.refresh(config)
    return config

@app.get("/api/crawler/status", response_model=schemas.CrawlerStatusResponse)
def get_crawler_status(db: Session = Depends(database.get_db)):
    """
    Returns current crawler progress metrics.
    """
    total_items = db.query(models.ItemDefinition).count()
    
    # Scanned in last 24h
    now = time.time()
    day_ago = now - 86400
    scanned_24h = db.query(models.ItemDefinition).filter(
        models.ItemDefinition.last_checked >= day_ago
    ).count()

    items_left = total_items - scanned_24h
    progress = (scanned_24h / total_items * 100.0) if total_items > 0 else 0.0

    # Config
    config_duration = db.query(models.SystemConfig).filter(models.SystemConfig.key == "scan_target_hours").first()
    target_hours = float(config_duration.value) if config_duration and config_duration.value else 24.0

    # Estimate actual speed? (Optional, maybe for next version)
    # For now, return what we know.
    
    # Calculate estimated days to complete 100% based on CURRENT theoretical speed is tricky,
    # but based on progress we can just return target_hours as reference or N/A
    # Let's just return configured target.

    return schemas.CrawlerStatusResponse(
        total_items=total_items,
        scanned_24h=scanned_24h,
        items_left=items_left,
        scan_progress=round(progress, 2),
        target_hours=target_hours,
        estimated_days=0.0 # Placeholder or calculate if we track detailed history
    )

@app.post("/api/crawler/run")
def run_crawler_now():
    """
    Manually triggers the background price check immediately.
    """
    if not scheduler.running:
         raise HTTPException(status_code=503, detail="Scheduler not running")
    
    # Run the job immediately
    scheduler.add_job(scheduled_price_check, 'date')
    
    return {"status": "triggered"}
