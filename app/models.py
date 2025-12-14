from sqlalchemy import Column, Integer, String, Boolean, Float, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base

class ApiKey(Base):
    __tablename__ = 'api_keys'
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(255), unique=True, nullable=False)
    is_active = Column(Boolean, default=True)

class TrackedItem(Base):
    __tablename__ = 'tracked_items'
    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, nullable=False, unique=True)
    item_name = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)

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
