import logging
from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert
from app.db.database import SessionLocal
from app.models.models import Item
from app.services.torn_api import torn_api_service

logger = logging.getLogger(__name__)

class ItemService:
    async def sync_item_catalog(self):
        """
        Fetch all items from Torn API and sync to local database.
        """
        logger.info("Starting Torn item catalog sync...")
        items_data = await torn_api_service.get_torn_items_list()
        
        if not items_data:
            logger.error("Failed to fetch items from Torn API during catalog sync.")
            return

        async with SessionLocal() as session:
            # Prepare data for UPSERT
            # torn_id, name, description, type
            count = 0
            for tid, info in items_data.items():
                stmt = insert(Item).values(
                    torn_id=int(tid),
                    name=info.get('name', 'Unknown'),
                    description=info.get('description', ''),
                    type=info.get('type', 'Unknown'),
                    is_tracked=False # Keep existing tracked status if already present? 
                                     # Actually, use on_duplicate_key_update to NOT overwrite is_tracked
                )
                
                stmt = stmt.on_duplicate_key_update(
                    name=stmt.inserted.name,
                    description=stmt.inserted.description,
                    type=stmt.inserted.type
                    # We EXCLUDE is_tracked from update so we don't accidentally stop tracking items
                )
                
                await session.execute(stmt)
                count += 1
                
                # Commit in batches if needed, but for items (~1000) it's fine
            
            await session.commit()
            logger.info(f"Synced {count} items from Torn to local database.")

    async def get_items_catalog(self):
        """
        Returns all items from local database catalog.
        """
        async with SessionLocal() as session:
            result = await session.execute(select(Item).order_by(Item.name))
            return result.scalars().all()

item_service = ItemService()
