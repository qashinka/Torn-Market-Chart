from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Index, BigInteger, Text, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base

class Item(Base):
    __tablename__ = 'items'

    id = Column(Integer, primary_key=True, index=True)
    torn_id = Column(Integer, unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(String(50), nullable=True)

    # Tracking status
    is_tracked = Column(Boolean, default=True)

    # Last known prices (cached for quick access)
    last_market_price = Column(BigInteger, nullable=True)
    last_bazaar_price = Column(BigInteger, nullable=True)
    last_updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    price_logs = relationship("PriceLog", back_populates="item", cascade="all, delete-orphan")
    alerts = relationship("PriceAlert", back_populates="item", cascade="all, delete-orphan")

class PriceLog(Base):
    __tablename__ = 'price_logs'

    # We use a composite primary key or just an ID.
    # For partitioning, the partition key (timestamp) must be part of the primary key if we use one.
    # We will use (id, timestamp) as PK or just remove ID and use (item_id, timestamp) as PK.
    # Given high volume, (item_id, timestamp) is natural.

    item_id = Column(Integer, ForeignKey('items.id', ondelete="CASCADE"), primary_key=True, nullable=False)
    timestamp = Column(DateTime, primary_key=True, nullable=False, index=True)

    market_price = Column(BigInteger, nullable=True)
    bazaar_price = Column(BigInteger, nullable=True)

    item = relationship("Item", back_populates="price_logs")

    __table_args__ = (
        Index('idx_item_timestamp', 'item_id', 'timestamp'),
        # Partitioning definition would typically go here for some dialects,
        # but SQLAlchemy support for partitioning DDL is limited.
        # We will handle the actual PARTITION BY clause in Alembic migrations or raw SQL.
        {"mysql_engine": "InnoDB"}
    )

class PriceAlert(Base):
    __tablename__ = 'price_alerts'

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey('items.id', ondelete="CASCADE"), nullable=False)
    target_price = Column(BigInteger, nullable=False)
    condition = Column(String(10), nullable=False) # "above", "below"
    is_active = Column(Boolean, default=True)

    item = relationship("Item", back_populates="alerts")

class ApiKey(Base):
    __tablename__ = 'api_keys'

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(255), unique=True, nullable=False)
    comment = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    last_used_at = Column(DateTime, nullable=True)

class SystemConfig(Base):
    __tablename__ = 'system_config'

    key = Column(String(100), primary_key=True)
    value = Column(String(255), nullable=True)
