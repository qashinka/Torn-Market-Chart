from sqlalchemy import Column, Integer, String, Boolean, Float, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base

class ApiKey(Base):
    __tablename__ = 'api_keys'
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(255), unique=True, nullable=False)
    is_active = Column(Boolean, default=True)

class ItemDefinition(Base):
    __tablename__ = 'all_items'
    item_id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)

class TrackedItem(Base):
    __tablename__ = 'tracked_items'
    # removed id, item_id is now PK
    item_id = Column(Integer, ForeignKey('all_items.item_id'), primary_key=True, index=True)
    # removed item_name, accessed via relationship
    is_active = Column(Boolean, default=True)

    item_def = relationship("ItemDefinition")

class PriceLog(Base):
    __tablename__ = 'price_logs'
    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey('tracked_items.item_id'), nullable=False)
    timestamp = Column(Integer, nullable=False)

    # Bazaar Stats
    bazaar_min = Column(Integer, nullable=True) # Allow null if no listings
    bazaar_avg = Column(Float, nullable=True)

    # Item Market Stats
    market_min = Column(Integer, nullable=True)
    market_avg = Column(Float, nullable=True)

    item = relationship("TrackedItem")
