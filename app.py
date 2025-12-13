import os
import random
import time
import logging
from datetime import datetime
from typing import List, Optional, Union, Dict

from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.schedulers import SchedulerNotRunningError
import requests
from curl_cffi import requests as cffi_requests
import atexit

# === Configuration ===
# === Configuration ===
BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# Database Configuration
# Use environment variable for DB URL if available (e.g., from Docker), else SQLite
db_url = os.environ.get('DATABASE_URL')
if not db_url:
    # Fallback to local SQLite
    DB_PATH = os.path.join(BASE_DIR, "torn_tracker.db")
    db_url = f'sqlite:///{DB_PATH}'

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
scheduler = BackgroundScheduler()

# === Logging ===
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# === Models ===
class ApiKey(db.Model):
    __tablename__ = 'api_keys'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(255), unique=True, nullable=False)
    is_active = db.Column(db.Boolean, default=True)

    def to_dict(self):
        return {"id": self.id, "key": self.key, "is_active": self.is_active}

class TrackedItem(db.Model):
    __tablename__ = 'tracked_items'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, nullable=False, unique=True)
    item_name = db.Column(db.String(255), nullable=False)
    is_active = db.Column(db.Boolean, default=True)

    def to_dict(self):
        return {"id": self.id, "item_id": self.item_id, "item_name": self.item_name, "is_active": self.is_active}

class PriceLog(db.Model):
    __tablename__ = 'price_logs'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('tracked_items.item_id'), nullable=False)
    timestamp = db.Column(db.Integer, nullable=False)
    
    # Bazaar Stats
    bazaar_min = db.Column(db.Integer, nullable=True) # Allow null if no listings
    bazaar_avg = db.Column(db.Float, nullable=True)

    # Item Market Stats
    market_min = db.Column(db.Integer, nullable=True)
    market_avg = db.Column(db.Float, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "item_id": self.item_id,
            "timestamp": self.timestamp,
            "bazaar_min": self.bazaar_min,
            "bazaar_avg": self.bazaar_avg,
            "market_min": self.market_min,
            "market_avg": self.market_avg
        }

# === Marketplace Logic ===

class Listing:
    def __init__(self, price, quantity, item_id=0, player_id=0, player_name="Market", source="Unknown"):
        self.item_id = int(item_id) if item_id is not None else 0
        self.price = int(price)
        self.quantity = int(quantity)
        self.source = source
        self.player_name = player_name

    @classmethod
    def from_bazaar_dict(cls, data):
        return cls(
            price=data.get("price", 0),
            quantity=data.get("quantity", 0),
            item_id=data.get("item_id", 0),
            player_name=data.get("player_name", "Unknown"),
            source="Bazaar"
        )

    @classmethod
    def from_item_market_dict(cls, data, item_id):
        return cls(
            price=data.get("price", 0),
            quantity=data.get("amount", 0),
            item_id=item_id,
            player_name="Item Market",
            source="ItemMarket"
        )

class MarketResponse:
    def __init__(self, item_name, listings):
        self.item_name = item_name
        self.listings = listings

    @classmethod
    def from_dict(cls, data):
        listings_data = data.get("listings", [])
        listings = [Listing.from_bazaar_dict(x) for x in listings_data]
        return cls(item_name=data.get("item_name", "Unknown"), listings=listings)

def fetch_bazaar_data(item_id: int) -> Optional[MarketResponse]:
    url = f"https://weav3r.dev/api/marketplace/{item_id}"
    try:
        response = cffi_requests.get(url, impersonate="chrome")
        response.raise_for_status()
        data = response.json()
        return MarketResponse.from_dict(data)
    except Exception as e:
        logger.error(f"[Bazaar] Error fetching item {item_id}: {e}")
        return None

def fetch_item_market_data(item_id: int, api_key: str) -> List[Listing]:
    if not api_key:
        return []
    url = f"https://api.torn.com/v2/market/{item_id}/itemmarket?limit=30&offset=0"
    headers = {'accept': 'application/json', 'Authorization': f'ApiKey {api_key}'}
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        listings_data = data.get("itemmarket", {}).get("listings", [])
        return [Listing.from_item_market_dict(item, item_id) for item in listings_data]
    except Exception as e:
        logger.error(f"[Item Market] Error fetching item {item_id} with key ending in ...{api_key[-4:]}: {e}")
        return []

def get_rotated_api_key():
    with app.app_context():
        keys = ApiKey.query.filter_by(is_active=True).all()
        if not keys:
            return None
        return random.choice(keys).key

def calculate_stats(listings: List[Listing]):
    if not listings:
        return None, None
    
    listings.sort(key=lambda x: x.price)
    min_price = listings[0].price
    
    # Calculate top 3 average
    top3 = listings[:3]
    avg_price = sum(l.price for l in top3) / len(top3)
    
    return min_price, avg_price

# === Background Task ===
def scheduled_price_check():
    with app.app_context():
        logger.info("Starting scheduled price check...")
        tracked_items = TrackedItem.query.filter_by(is_active=True).all()
        
        if not tracked_items:
            logger.info("No items to track.")
            return

        for item in tracked_items:
            api_key = get_rotated_api_key()
            if not api_key:
                logger.warning("No active API keys found.")
                # We can still check Bazaar without a key, but for now we skip to be safe/consistent
                # Or continue if you want allow Bazaar-only tracking when no keys.
                # Let's return for now as per previous logic
                return

            # Fetch Data
            bazaar_data = fetch_bazaar_data(item.item_id)
            market_listings = fetch_item_market_data(item.item_id, api_key)
            
            bazaar_listings = bazaar_data.listings if bazaar_data else []
            
            # --- Separate Calculations ---
            b_min, b_avg = calculate_stats(bazaar_listings)
            m_min, m_avg = calculate_stats(market_listings)

            # Update Name
            if bazaar_data and bazaar_data.item_name and "Item" not in bazaar_data.item_name:
                 if item.item_name != bazaar_data.item_name and "Item" in item.item_name:
                     item.item_name = bazaar_data.item_name
                     db.session.commit()

            # Save Log (skip if both empty? or just record Nones/Zeroes?)
            # Records even if one is missing so we can compare
            if b_min is None and m_min is None:
                continue

            new_log = PriceLog(
                item_id=item.item_id,
                timestamp=int(time.time()),
                bazaar_min=b_min,
                bazaar_avg=b_avg,
                market_min=m_min,
                market_avg=m_avg
            )
            db.session.add(new_log)
        
        db.session.commit()
        logger.info("Price check completed.")

# === Routes ===

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/keys', methods=['GET', 'POST'])
def handle_keys():
    if request.method == 'POST':
        data = request.json
        key_val = data.get('key')
        if not key_val:
            return jsonify({"error": "Key is required"}), 400
        
        if ApiKey.query.filter_by(key=key_val).first():
            return jsonify({"error": "Key already exists"}), 400
            
        new_key = ApiKey(key=key_val)
        db.session.add(new_key)
        db.session.commit()
        return jsonify(new_key.to_dict()), 201
    else:
        keys = ApiKey.query.all()
        return jsonify([k.to_dict() for k in keys])

@app.route('/api/keys/<int:key_id>', methods=['DELETE'])
def delete_key(key_id):
    key = ApiKey.query.get(key_id)
    if key:
        db.session.delete(key)
        db.session.commit()
        return jsonify({"success": True})
    return jsonify({"error": "Not found"}), 404

@app.route('/api/items', methods=['GET', 'POST'])
def handle_items():
    if request.method == 'POST':
        data = request.json
        item_id = data.get('item_id')
        if not item_id:
            return jsonify({"error": "Item ID is required"}), 400
        
        # Try to fetch name if not provided
        item_name = data.get('item_name', f"Item {item_id}")
        
        if TrackedItem.query.filter_by(item_id=item_id).first():
             return jsonify({"error": "Item already tracked"}), 400

        new_item = TrackedItem(item_id=item_id, item_name=item_name)
        db.session.add(new_item)
        db.session.commit()
        return jsonify(new_item.to_dict()), 201
    else:
        items = TrackedItem.query.all()
        return jsonify([i.to_dict() for i in items])

@app.route('/api/items/<int:db_id>', methods=['DELETE'])
def delete_item(db_id):
    item = TrackedItem.query.get(db_id)
    if item:
        db.session.delete(item)
        db.session.commit()
        return jsonify({"success": True})
    return jsonify({"error": "Not found"}), 404

@app.route('/api/history/<int:item_id>')
def get_history(item_id):
    # Get last 1000 logs for the item
    logs = PriceLog.query.filter_by(item_id=item_id).order_by(PriceLog.timestamp.asc()).all()
    data = [{
        "time": log.timestamp,
        "bazaar_min": log.bazaar_min,
        "bazaar_avg": log.bazaar_avg,
        "market_min": log.market_min,
        "market_avg": log.market_avg
    } for log in logs]
    return jsonify(data)

# === Initialization ===

def start_scheduler():
    if not scheduler.running:
        scheduler.add_job(
            func=scheduled_price_check,
            trigger="interval",
            minutes=1,
            id="price_check_job",
            replace_existing=True
        )
        scheduler.start()

def shutdown_scheduler():
    try:
        if scheduler.running:
            scheduler.shutdown()
    except SchedulerNotRunningError:
        pass

atexit.register(shutdown_scheduler)

if __name__ == '__main__':
    with app.app_context():
        # Setup DB tables if they don't exist
        db.create_all()
        
        if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not app.debug:
            start_scheduler()

    app.run(host='0.0.0.0', debug=True, port=5000)
