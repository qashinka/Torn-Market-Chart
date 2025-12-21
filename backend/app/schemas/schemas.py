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
    last_market_price_avg: Optional[int]
    last_bazaar_price_avg: Optional[int]
    last_updated_at: Optional[datetime]

    class Config:
        from_attributes = True

class PriceLogOut(BaseModel):
    item_id: int
    timestamp: datetime
    market_price: Optional[int]
    bazaar_price: Optional[int]
    market_price_avg: Optional[int]
    bazaar_price_avg: Optional[int]

    class Config:
        from_attributes = True

class ApiKeyBase(BaseModel):
    key: str
    comment: Optional[str] = None

class ApiKeyCreate(ApiKeyBase):
    pass

class ApiKeyOut(ApiKeyBase):
    id: int
    is_active: bool
    last_used_at: Optional[datetime]

    class Config:
        from_attributes = True
