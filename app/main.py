import os
import time
import logging
import random
import itertools
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session, joinedload
from apscheduler.schedulers.background import BackgroundScheduler

from . import models, schemas, database, marketplace

# === Configuration ===
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# === State ===
LAST_ITEM_SYNC = 0
ITEM_SYNC_TTL = 3600
API_KEY_INDEX = 0

# === Background Task Logic ===

def get_rotated_api_key(db: Session):
    global API_KEY_INDEX
    keys = db.query(models.ApiKey).filter_by(is_active=True).order_by(models.ApiKey.id).all()
    if not keys:
        return None

    key = keys[API_KEY_INDEX % len(keys)].key
    API_KEY_INDEX += 1
    return key

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
    """
    logger.info("Starting scheduled price check...")
    db = database.SessionLocal()
    try:
        tracked_items = db.query(models.TrackedItem).filter_by(is_active=True).all()

        if not tracked_items:
            logger.info("No items to track.")
            return

        # Fetch keys once for round-robin distribution within this batch
        api_keys_objs = db.query(models.ApiKey).filter_by(is_active=True).order_by(models.ApiKey.id).all()
        if not api_keys_objs:
            logger.warning("No active API keys found.")
            return

        # Use itertools.cycle to rotate through keys for the items
        key_cycle = itertools.cycle([k.key for k in api_keys_objs])

        for item in tracked_items:
            api_key = next(key_cycle)

            # Fetch Data using marketplace.py
            # Note: marketplace.fetch_bazaar_data prints errors, we might want to capture logging better later
            bazaar_data = marketplace.fetch_bazaar_data(item.item_id)
            market_listings = marketplace.fetch_item_market_data(item.item_id, api_key)

            bazaar_listings = bazaar_data.listings if bazaar_data else []

            # --- Separate Calculations ---
            b_min, b_avg = calculate_stats(bazaar_listings)
            m_min, m_avg = calculate_stats(market_listings)

            # --- Update Current Listings ---
            all_listings = bazaar_listings + market_listings
            all_listings.sort(key=lambda x: x.price)
            top_5 = all_listings[:5]

            # Clear old listings
            db.query(models.CurrentListing).filter_by(item_id=item.item_id).delete()

            # Add new listings
            for lst in top_5:
                # Listing object doesn't have seller_name for ItemMarket sometimes, handle gracefully
                # bazaar listings from weav3r.dev have player_name
                # itemmarket listings from torn api v2 have NO player name usually (unless we query differently, but here we just get listings)
                # app/marketplace.py: Listing.from_item_market_dict sets player_name="Item Market"

                db.add(models.CurrentListing(
                    item_id=item.item_id,
                    price=lst.price,
                    quantity=lst.quantity,
                    source=lst.source,
                    seller_name=lst.player_name,
                    player_id=lst.player_id
                ))

            # NOTE: We no longer update item name in TrackedItem from Bazaar data
            # because TrackedItem no longer has item_name, it's in ItemDefinition (all_items table)
            # We could update ItemDefinition if we wanted, but let's stick to the periodic full sync for names.

            # Save Log (skip if both empty? or just record Nones/Zeroes?)
            if b_min is None and m_min is None:
                continue

            new_log = models.PriceLog(
                item_id=item.item_id,
                timestamp=int(time.time()),
                bazaar_min=b_min,
                bazaar_avg=b_avg,
                market_min=m_min,
                market_avg=m_avg
            )
            db.add(new_log)

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
        api_key = get_rotated_api_key(db)
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
        # We can look for logs around that time.
        # Strategy: Get the first log AFTER target_time - margin (e.g. 1 hour) or BEFORE?
        # A simple way is to query logs around that time and sort by abs difference.
        # Efficient way: Get one before and one after, or just the nearest one.
        # Since we index on timestamp, we can find the one just before or after.

        # Let's try to find the last log BEFORE (or at) target_time + some buffer?
        # Actually, "closest" usually means absolute difference.
        # Let's query a range [target_time - 2h, target_time + 2h] and pick closest.

        # Simpler approach: order by ABS(timestamp - target_time) LIMIT 1.
        # But SQL doesn't do ABS(timestamp - target) efficiently without index on expression or scanning.
        # Since we have index on timestamp, we can get the latest log <= target_time
        # and earliest log >= target_time.

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
            # Prefer bazaar_min, fallback to market_min?
            # Usually we track "min price".
            # In PriceLog, we have bazaar_min and market_min.
            # Which one to compare against?
            # We should probably take min(bazaar_min, market_min) ignoring Nones.

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
