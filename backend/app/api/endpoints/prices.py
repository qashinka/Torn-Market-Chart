from typing import List, Optional, Union
from sqlalchemy import select, func, text, literal_column
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, Query
from datetime import datetime, timedelta

from app.db.database import get_db
from app.models.models import PriceLog
from app.schemas.schemas import PriceLogOut, PriceCandle

router = APIRouter()

@router.get("/{item_id}", response_model=Union[List[PriceCandle], List[PriceLogOut]])
async def get_price_history(
    item_id: int,
    days: int = Query(7, description="Number of days to look back (default 7). Ignored if start_date is set."),
    start_date: Optional[datetime] = Query(None, description="Start date for filtering (inclusive)."),
    end_date: Optional[datetime] = Query(None, description="End date for filtering (inclusive)."),
    interval: str = Query("raw", description="Aggregation interval: raw, 1h, 4h, 1d"),
    db: AsyncSession = Depends(get_db)
):
    # 1. Determine Date Range
    now = datetime.utcnow()
    limit_end = end_date if end_date else now
    
    if start_date:
        limit_start = start_date
    else:
        limit_start = now - timedelta(days=days)

    # 2. Base Filter
    filters = [
        PriceLog.item_id == item_id,
        PriceLog.timestamp >= limit_start,
        PriceLog.timestamp <= limit_end
    ]

    # 3. Handle Aggregation
    if interval == "raw":
        stmt = select(PriceLog).where(*filters).order_by(PriceLog.timestamp.asc())
        # Safety limit for raw data if range is huge?
        # For now, let's assume frontend manages reasonable chunks or limit it.
        # stmt = stmt.limit(50000) 
        result = await db.execute(stmt)
        return result.scalars().all()

    else:
        # Determine Grouping SQL
        if interval == "1h":
            # Round down to hour
            # MySQL: DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00')
            time_group = func.date_format(PriceLog.timestamp, '%Y-%m-%d %H:00:00')
        elif interval == "15m":
            # 15 min = 15 * 60 = 900
            time_group = func.from_unixtime(
                func.floor(func.unix_timestamp(PriceLog.timestamp) / 900) * 900
            )
        elif interval == "30m":
            # 30 min = 30 * 60 = 1800
            time_group = func.from_unixtime(
                func.floor(func.unix_timestamp(PriceLog.timestamp) / 1800) * 1800
            )
        elif interval == "4h":
            # 4h = 4 * 3600
            time_group = func.from_unixtime(
                func.floor(func.unix_timestamp(PriceLog.timestamp) / (4 * 3600)) * (4 * 3600)
            )
        elif interval == "12h":
            # 12h = 12 * 3600
            time_group = func.from_unixtime(
                func.floor(func.unix_timestamp(PriceLog.timestamp) / (12 * 3600)) * (12 * 3600)
            )
        elif interval == "1d":
            time_group = func.date_format(PriceLog.timestamp, '%Y-%m-%d 00:00:00')
        elif interval == "1w":
            # Weekly aggregation
            # Start of week? OR just ISO week?
            # Simple: Year-Week. But formatting specific.
            # Alternative: Div by 7*24*3600. But aligns to epoch (Thu).
            # Better: YEARWEEK(timestamp, 1) -> but we need date output.
            # STR_TO_DATE(CONCAT(YEARWEEK(timestamp, 1), ' Monday'), '%X%V %W')
            # Let's use unixtime/604800 for simplicity as long as frontend handles potential offset?
            # Epoch (1970-01-01) was Thursday.
            # To align with Monday: (unix_timestamp - 345600) / 604800
            # Let's actually just use MySQL func.yearweek
            time_group = func.str_to_date(
                func.concat(func.yearweek(PriceLog.timestamp, 1), ' Monday'), 
                '%X%V %W'
            )
        else:
            # Fallback to raw if invalid
            stmt = select(PriceLog).where(*filters).order_by(PriceLog.timestamp.asc())
            result = await db.execute(stmt)
            return result.scalars().all()

        # Build Aggregation Query
        # Notes on Open/Close:
        # We use GROUP_CONCAT to get all prices ordered by time, then take the first/last.
        # MySQL 8.0 Default GROUP_CONCAT max len is 1024. This might risk truncation if > 200 items in a group.
        # "1h" group has max 60 items. 1d has 1440. 
        # For 1d, GROUP_CONCAT might truncate!
        # Alternative: Substring Index of GROUP_CONCAT is risky for large groups.
        
        # Better approach for Close: 
        # Since we are aggregating, we can just take the price of the latest record in that group.
        # But this requires a join or complex window function.
        # Given simpler requirements, let's try the GROUP_CONCAT but cast to char.
        # IMPORTANT: If GROUP_CONCAT fails/truncates, we get garbage.
        
        # Let's use a simpler heuristic for High/Low/Avg which are safe.
        # For Open/Close, let's use the min/max time's price ?? No, that's complex to join.
        
        # Let's use SUBSTRING_INDEX trick but be aware of 1d limits.
        # We can increase group_concat_max_len session variable if needed.
        # await db.execute(text("SET group_concat_max_len = 100000"))
        
        await db.execute(text("SET SESSION group_concat_max_len = 100000"))

        stmt = select(
            time_group.label("timestamp"),
            # Market
            func.max(PriceLog.market_price).label("market_high"),
            func.min(func.nullif(PriceLog.market_price, 0)).label("market_low"),
            func.avg(func.nullif(PriceLog.market_price_avg, 0)).label("market_avg"),
            # Open/Close
            literal_column("SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(market_price, 0) ORDER BY timestamp ASC SEPARATOR ','), ',', 1)").label("market_open"),
            literal_column("SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(market_price, 0) ORDER BY timestamp DESC SEPARATOR ','), ',', 1)").label("market_close"),

            # Bazaar
            func.max(PriceLog.bazaar_price).label("bazaar_high"),
            func.min(func.nullif(PriceLog.bazaar_price, 0)).label("bazaar_low"),
            func.avg(func.nullif(PriceLog.bazaar_price_avg, 0)).label("bazaar_avg"),
            literal_column("SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(bazaar_price, 0) ORDER BY timestamp ASC SEPARATOR ','), ',', 1)").label("bazaar_open"),
            literal_column("SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(bazaar_price, 0) ORDER BY timestamp DESC SEPARATOR ','), ',', 1)").label("bazaar_close"),
        ).where(*filters).group_by(time_group).order_by(time_group.asc())

        result = await db.execute(stmt)
        rows = result.all()
        
        # Convert to Pydantic models
        # Note: The result rows match the select labels.
        return [
            PriceCandle(
                timestamp=row.timestamp,
                market_open=int(row.market_open) if row.market_open and str(row.market_open).isdigit() else None,
                market_close=int(row.market_close) if row.market_close and str(row.market_close).isdigit() else None,
                market_high=row.market_high,
                market_low=row.market_low,
                market_avg=row.market_avg,
                bazaar_open=int(row.bazaar_open) if row.bazaar_open and str(row.bazaar_open).isdigit() else None,
                bazaar_close=int(row.bazaar_close) if row.bazaar_close and str(row.bazaar_close).isdigit() else None,
                bazaar_high=row.bazaar_high,
                bazaar_low=row.bazaar_low,
                bazaar_avg=row.bazaar_avg,
            )
            for row in rows
        ]
