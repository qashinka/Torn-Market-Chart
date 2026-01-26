import logging
import os
import httpx
from datetime import datetime, timedelta
from app.services.config_service import config_service

logger = logging.getLogger(__name__)

class NotificationService:
    def __init__(self):
        self._bazaar_cooldowns = {}
        self.COOLDOWN_DURATION = timedelta(minutes=30)

    async def get_webhook_url(self) -> str:
        # Priority: DB Config > Environment Variable
        url = await config_service.get_config('discord_webhook_url')
        if not url:
            url = os.getenv('DISCORD_WEBHOOK_URL')
        return url

    async def send_discord_alert(self, item_name: str, item_id: int, price: int, market_type: str, condition: str, target_price: int, bazaar_seller_id: int = None):
        # Bazaar Cooldown Check
        if bazaar_seller_id:
            now = datetime.utcnow()
            key = (bazaar_seller_id, item_id)

            if key in self._bazaar_cooldowns:
                last_sent = self._bazaar_cooldowns[key]
                if now - last_sent < self.COOLDOWN_DURATION:
                    logger.info(f"Skipping alert for {item_name} from seller {bazaar_seller_id} (Cooldown active)")
                    return

            self._bazaar_cooldowns[key] = now

        url = await self.get_webhook_url()
        if not url:
            logger.warning("Discord Webhook URL not configured. Skipping alert.")
            return

        # Format price with commas
        formatted_price = f"${price:,}"
        formatted_target = f"${target_price:,}"
        
        # Determine color (Green for below target/buy opportunity, Red for above/sell?)
        # Let's use generic Orange for now, or Green if "below" (Buy) and Red if "above".
        color = 0x00FF00 if condition == 'below' else 0xFF0000
        
        description = f"**{item_name}** is now **{formatted_price}** in the **{market_type}**!\n" \
                      f"Target: {condition} {formatted_target}"

        # Generate URL based on market type
        if market_type == "Bazaar" and bazaar_seller_id:
            # Link directly to seller's bazaar
            item_url = f"https://www.torn.com/bazaar.php?userId={bazaar_seller_id}#/"
        else:
            # Item Market search URL (default, also works for "Market/Bazaar" case)
            item_url = f"https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID={item_id}"

        embed = {
            "title": f"🔔 Price Alert: {item_name}",
            "url": item_url,
            "description": description,
            "color": color,
            "footer": {
                "text": "Torn Market Chart Alert System"
            },
            "timestamp": datetime.utcnow().isoformat()
        }

        payload = {
            "embeds": [embed]
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, timeout=10.0)
                response.raise_for_status()
                logger.info(f"Sent Discord alert for {item_name}")
        except Exception as e:
            logger.error(f"Failed to send Discord alert: {e}")

    async def send_system_alert(self, title: str, message: str, color: int = 0xFF0000):
        url = await self.get_webhook_url()
        if not url:
            return

        embed = {
            "title": f"⚠️ System Alert: {title}",
            "description": message,
            "color": color,
            "footer": {
                "text": "Torn Market Chart System"
            },
            "timestamp": datetime.utcnow().isoformat()
        }
        
        payload = { "embeds": [embed] }
        
        try:
            async with httpx.AsyncClient() as client:
                await client.post(url, json=payload, timeout=10.0)
        except Exception as e:
            logger.error(f"Failed to send system alert: {e}")

notification_service = NotificationService()
