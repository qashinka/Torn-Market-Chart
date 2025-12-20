from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class ItemBase(BaseModel):
    torn_id: int
    name: str
    description: Optional[str] = None
    type: Optional[str] = None
    is_tracked: bool = True

class ItemCreate(ItemBase):
    pass

class ItemUpdate(ItemBase):
    pass

class ItemOut(ItemBase):
    id: int
    last_market_price: Optional[int]
    last_bazaar_price: Optional[int]
    last_updated_at: Optional[datetime]

    class Config:
        from_attributes = True

class PriceLogOut(BaseModel):
    item_id: int
    timestamp: datetime
    market_price: Optional[int]
    bazaar_price: Optional[int]

    class Config:
        from_attributes = True
