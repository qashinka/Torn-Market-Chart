import logging
import os
import httpx
from app.services.config_service import config_service

logger = logging.getLogger(__name__)

class NotificationService:
    async def get_webhook_url(self) -> str:
        # Priority: DB Config > Environment Variable
        url = await config_service.get_config('discord_webhook_url')
        if not url:
            url = os.getenv('DISCORD_WEBHOOK_URL')
        return url

    async def send_discord_alert(self, item_name: str, item_id: int, price: int, market_type: str, condition: str, target_price: int):
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

        embed = {
            "title": f"Price Alert: {item_name}",
            "url": f"https://www.torn.com/imarket.php#/p=shop&step=shop&type={item_id}", # Deep link to item
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

from datetime import datetime
notification_service = NotificationService()
