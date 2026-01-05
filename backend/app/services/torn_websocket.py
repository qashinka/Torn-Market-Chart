
import asyncio
import json
import logging
import websockets
from sqlalchemy import select, update
from datetime import datetime
from app.db.database import SessionLocal
from app.models.models import Item
from app.services.config_service import config_service
from app.services.notification_service import notification_service
from app.services.price_service import price_service

logger = logging.getLogger(__name__)

WS_URL = "wss://ws-centrifugo.torn.com/connection/websocket"

class TornWebSocketService:
    def __init__(self):
        self.running = False
        self.token = None
        self.subscribed_items = set()

    async def run(self):
        self.running = True
        logger.info("Starting Torn WebSocket Service...")

        while self.running:
            try:
                # 1. Get Token from DB (Dynamic Config)
                self.token = await config_service.get_config('torn_ws_token')
                
                if not self.token:
                    logger.warning("No Torn WebSocket Token found in SystemConfig. Waiting 30s...")
                    await asyncio.sleep(30)
                    continue

                logger.info("Token found. Connecting to Torn WebSocket...")
                
                async with websockets.connect(WS_URL) as websocket:
                    # 2. Authenticate
                    auth_payload = {
                        "connect": {
                            "token": self.token,
                            "name": "js"
                        },
                        "id": 1
                    }
                    await websocket.send(json.dumps(auth_payload))
                    
                    # Wait for auth response
                    auth_response = await websocket.recv()
                    logger.debug(f"Auth Response: {auth_response}")
                    
                    if "error" in auth_response:
                        logger.error(f"Auth Failed: {auth_response}")
                        await notification_service.send_system_alert(
                            "WebSocket Auth Failed", 
                            f"Token might be expired or invalid.\nResponse: {auth_response}",
                            color=0xFF0000
                        )
                        await asyncio.sleep(60) 
                        continue

                    logger.info("Authenticated successfully.")

                    # 3. Subscribe to Tracked Items
                    await self._subscribe_active_items(websocket)

                    # 4. Listen Loop
                    while self.running:
                        try:
                            message = await websocket.recv()
                            await self._handle_message(message)
                        except websockets.ConnectionClosed:
                            logger.warning("WebSocket connection closed. Reconnecting...")
                            break
                        except Exception as e:
                            logger.error(f"Error in listen loop: {e}")
                            break
            
            except Exception as e:
                logger.error(f"WebSocket Service Crashed: {e}. Restarting in 10s...")
                await asyncio.sleep(10)

    async def _subscribe_active_items(self, websocket):
        async with SessionLocal() as session:
            # We need torn_id for subscription channel
            result = await session.execute(
                select(Item.id, Item.torn_id).where(Item.is_tracked == True)
            )
            tracked_items = result.all() # list of (id, torn_id)
        
        if not tracked_items:
            logger.info("No tracked items found.")
            return

        logger.info(f"Subscribing to {len(tracked_items)} items...")
        
        count = 0
        for pk_id, torn_id in tracked_items:
            # Use torn_id for channel name
            channel = f"item-market_{torn_id}"
            sub_payload = {
                "subscribe": {"channel": channel},
                "id": torn_id + 1000 
            }
            await websocket.send(json.dumps(sub_payload))
            self.subscribed_items.add(pk_id)
            count += 1
            
            if count % 10 == 0:
                await asyncio.sleep(0.1) 
        
        logger.info(f"Subscription requests sent for {count} items.")

    async def _handle_message(self, message_str: str):
        try:
            data = json.loads(message_str)
            # Parse structure: push -> pub -> data -> message
            
            push = data.get("push", {}).get("pub", {}).get("data", {}).get("message", {})
            if not push:
                return

            if push.get("namespace") == "item-market" and push.get("action") == "update":
                updates = push.get("data", []) # List of {itemID, minPrice, marketID}
                
                if updates:
                    async with SessionLocal() as session:
                        for update_data in updates:
                            torn_id = update_data.get("itemID") # This is Torn ID
                            min_price = update_data.get("minPrice")
                            
                            if torn_id and min_price:
                                # Fetch item object to get name, last_bazaar_price, etc.
                                stmt = select(Item).where(Item.torn_id == torn_id)
                                result = await session.execute(stmt)
                                item = result.scalar_one_or_none()
                                
                                if item:
                                    # Update Price
                                    item.last_market_price = min_price
                                    # We don't verify if it's actually different here, we assume WS update is meaningful.
                                    # (Torn sends update when market LOWEST price changes)
                                    
                                    await session.commit()
                                    logger.info(f"WS Update: {item.name} ({torn_id}) -> ${min_price}")
                                    
                                    # --- Instant Alert Check ---
                                    # Construct payload matching PriceService.check_alerts expectation
                                    # We use the just-updated market price, and the EXISTING bazaar price from DB.
                                    alert_payload = [{
                                        "item_id": item.id,
                                        "torn_id": item.torn_id,
                                        "item_name": item.name,
                                        "market_price": min_price,
                                        "bazaar_price": item.last_bazaar_price or 0,
                                        "bazaar_price_avg": item.last_bazaar_price_avg or 0, # Not strictly needed for alerts but good practice
                                        "best_listing_id": None, # WS doesn't give listing ID, only price.
                                        # Note on Deduplication: 
                                        # check_alerts uses (price, listing_id). 
                                        # If listing_id is None, it falls back to price-only deduplication (if implemented there)
                                        # or might just trigger if price matches last trigger price (which prevents spam).
                                        # Let's hope check_alerts logic handles None listing_id gracefully (it does: is_same_id defaulting)
                                        "cheapest_bazaar_seller": None 
                                    }]
                                    
                                    logger.info(f"Triggering instant alert check for {item.name}...")
                                    await price_service.check_alerts(session, alert_payload)
                                else:
                                    logger.warning(f"Received WS update for unknown Torn ID: {torn_id}")

        except Exception as e:
            logger.error(f"Error handling message: {e}")

torn_websocket_service = TornWebSocketService()
