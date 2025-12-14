import os
import time
import logging
import random
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from apscheduler.schedulers.background import BackgroundScheduler

from . import models, schemas, database, marketplace

# === Configuration ===
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# === Background Task Logic ===

def get_rotated_api_key(db: Session):
    keys = db.query(models.ApiKey).filter_by(is_active=True).all()
    if not keys:
        return None
    return random.choice(keys).key

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

        for item in tracked_items:
            api_key = get_rotated_api_key(db)
            if not api_key:
                logger.warning("No active API keys found.")
                # Return or continue? Original code returned.
                return

            # Fetch Data using marketplace.py
            # Note: marketplace.fetch_bazaar_data prints errors, we might want to capture logging better later
            bazaar_data = marketplace.fetch_bazaar_data(item.item_id)
            market_listings = marketplace.fetch_item_market_data(item.item_id, api_key)

            bazaar_listings = bazaar_data.listings if bazaar_data else []

            # --- Separate Calculations ---
            b_min, b_avg = calculate_stats(bazaar_listings)
            m_min, m_avg = calculate_stats(market_listings)

            # Update Name if available from Bazaar data
            if bazaar_data and bazaar_data.item_name and "Item" not in bazaar_data.item_name:
                 if item.item_name != bazaar_data.item_name and "Item" in item.item_name:
                     item.item_name = bazaar_data.item_name
                     db.commit()

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

# Mount static if needed (though app.py didn't seem to have explicit static mount,
# but usually Flask serves static folder automatically.
# Let's check if 'app/static' exists.
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
    items = db.query(models.TrackedItem).all()
    return items

@app.post("/api/items", response_model=schemas.TrackedItemResponse, status_code=201)
def create_item(item_data: schemas.TrackedItemCreate, db: Session = Depends(database.get_db)):
    if not item_data.item_id:
        raise HTTPException(status_code=400, detail="Item ID is required")

    if db.query(models.TrackedItem).filter_by(item_id=item_data.item_id).first():
        raise HTTPException(status_code=400, detail="Item already tracked")

    item_name = item_data.item_name or f"Item {item_data.item_id}"
    new_item = models.TrackedItem(item_id=item_data.item_id, item_name=item_name)
    db.add(new_item)
    db.commit()
    db.refresh(new_item)
    return new_item

@app.delete("/api/items/{db_id}")
def delete_item(db_id: int, db: Session = Depends(database.get_db)):
    item = db.query(models.TrackedItem).filter(models.TrackedItem.id == db_id).first()
    if item:
        db.delete(item)
        db.commit()
        return {"success": True}
    raise HTTPException(status_code=404, detail="Not found")

@app.get("/api/history/{item_id}", response_model=List[schemas.PriceLogResponse])
def get_history(item_id: int, db: Session = Depends(database.get_db)):
    # Get last 1000 logs for the item
    logs = db.query(models.PriceLog)\
        .filter_by(item_id=item_id)\
        .order_by(models.PriceLog.timestamp.asc())\
        .limit(1000)\
        .all() # Limit applied after ordering? No, typically better to limit. Original had no limit but comment said 1000?
               # Original: .all() -- Wait, original said "# Get last 1000 logs" but code was `logs = PriceLog.query.filter_by(item_id=item_id).order_by(PriceLog.timestamp.asc()).all()`. It did NOT limit.
               # I will replicate behavior (fetch all) but maybe consider adding limit if it gets slow. The comment in original code might have been aspirational.

    # Mapping to schema
    return [
        schemas.PriceLogResponse(
            time=log.timestamp,
            bazaar_min=log.bazaar_min,
            bazaar_avg=log.bazaar_avg,
            market_min=log.market_min,
            market_avg=log.market_avg
        ) for log in logs
    ]
