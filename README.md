# Torn Market Chart

Torn City Market Tracker & Visualization Tool.

## Features
- **Price Tracking**: Periodically fetches Item Market and Bazaar prices.
- **Charts**: Visualizes price history with TradingView-like charts (Recharts).
- **Multi-API Key Support**: Rotates through configured keys to maximize rate limits.
- **Dynamic Rate Limiting**: Adjusts requests based on key count and user settings.
- **Dockerized**: Easy deployment with Docker Compose.

## Setup
1. Copy `.env.example` to `.env` and fill in your DB credentials.
2. Run `docker-compose up -d --build`.
3. Access Dashboard at `http://localhost:3000`.
4. Go to Settings and add your Torn API Key(s).

## Tech Stack
- **Backend**: FastAPI (Python), SQLAlchemy, APScheduler
- **Frontend**: React, Vite, Recharts, TailwindCSS
- **Database**: MySQL (MariaDB)
- **Cache**: Redis
