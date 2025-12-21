# Torn Market Chart

Torn City Market Tracker & Visualization Tool with TradingView-like charts and real-time order book.

## Features

### 📊 Advanced Charting
- **TradingView-Style Charts**: Powered by `lightweight-charts` with Area and Line series
- **Price Visualization**: Displays Low prices, Averages (Top 5), and 24-hour Moving Average trends
- **Interactive Legend**: Real-time crosshair tooltip showing all price metrics
- **Auto-scaling**: Automatically adjusts chart scale when switching between items
- **Data Quality**: Filters out invalid data (zero/null values) for clean visualization

### 📈 Order Book Integration
- **Live Top 5 Listings**: View cheapest 5 listings from both Item Market and Bazaar
- **DB Caching**: Instant display from database cache, updated every minute by background worker
- **Direct Links**: Click any listing to navigate directly to Item Market or seller's Bazaar
- **Dual Source**: Fetches from Torn Official API (Market) and weav3r.dev (Bazaar)

### 🔑 Multi-API Key Management
- **Key Rotation**: Round-robin rotation through configured API keys
- **Dynamic Rate Limiting**: Automatically scales requests based on number of active keys
- **Per-Key Tracking**: Monitor last usage time and status for each key
- **Fallback Support**: Uses environment variable as fallback if no DB keys configured

### ⚙️ Smart Price Updates
- **Concurrent Fetching**: Parallelized API requests with semaphore-controlled concurrency (limit: 5)
- **Error Resilience**: Failed fetches don't block other items; recorded with timestamp
- **Backoff Strategy**: Reduces fetch frequency for consistently failing items
- **Listings Snapshot**: Stores top 5 market/bazaar listings in DB for instant access

## Setup

1. Copy `.env.example` to `.env` and configure:
   ```env
   DB_ROOT_PASSWORD=your_root_password
   DB_NAME=torn_market
   DB_USER=torn_market
   DB_PASSWORD=your_db_password
   DB_HOST=db # Or your external DB IP
   DB_PORT=3306
   ADMIN_PASSWORD=your_admin_password
   TORN_API_KEY=optional_fallback_key
   ```

   **Using an External Database:**
   To use your own database server instead of the Docker container:
   1. Set `DB_HOST` to your database server's IP address (e.g., `192.168.1.100` or `host.docker.internal`).
   2. Set `DB_PORT` to your database port (default: 3306).
   3. Ensure `DB_USER` and `DB_PASSWORD` match your external database credentials.


2. Start the application:
   ```bash
   docker-compose up -d --build
   ```

3. Access the dashboard at `http://localhost:3000`

4. Configure API Keys:
   - Navigate to **Settings** page
   - Add one or more Torn API keys
   - Keys will be automatically rotated during price fetching

5. Track Items:
   - Go to **Manage Items**
   - Search for items in the Torn catalog
   - Click **Track** to add them to your dashboard

## Tech Stack

### Backend
- **FastAPI**: Modern Python web framework with async support
- **SQLAlchemy**: ORM with async MySQL/MariaDB support (`asyncmy`)
- **APScheduler**: Background job scheduling for periodic price updates
- **Redis**: Rate limiting and API key rotation management
- **curl_cffi**: Cloudflare-bypassing HTTP client for bazaar scraping

### Frontend
- **React 18**: Modern UI library with hooks
- **Vite**: Fast development and build tooling
- **lightweight-charts**: TradingView-quality charting library
- **TanStack Query**: Data fetching and caching
- **Axios**: HTTP client for API communication
- **TailwindCSS**: Utility-first CSS framework

### Database
- **MySQL 8.0**: Primary data store for items, prices, and metadata
- **Redis**: In-memory cache for rate limiting and key rotation

### Infrastructure
- **Docker & Docker Compose**: Containerized deployment
- **Nginx**: Reverse proxy for frontend static files (in production)
- **PHPMyAdmin**: Database management interface (`http://localhost:8081`)

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Frontend   │────▶│   FastAPI    │────▶│   MySQL     │
│  (React)    │     │   Backend    │     │  Database   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │                      
                           ▼                      
                    ┌──────────────┐              
                    │    Redis     │              
                    │  (Caching)   │              
                    └──────────────┘              
                           │                      
                           ▼                      
                    ┌──────────────┐              
                    │   Worker     │              
                    │ (APScheduler)│              
                    └──────────────┘              
                           │                      
                ┌──────────┴──────────┐           
                ▼                     ▼           
         ┌─────────────┐       ┌─────────────┐   
         │  Torn API   │       │ weav3r.dev  │   
         │  (Market)   │       │  (Bazaar)   │   
         └─────────────┘       └─────────────┘   
```

## Development

### Local Development
```bash
# Backend (with hot reload)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend (with HMR)
cd frontend
npm install
npm run dev
```

### Database Migration
When adding new columns:
1. Update `backend/app/models/models.py`
2. Access PHPMyAdmin at `http://localhost:8081`
3. Execute ALTER TABLE statement in SQL tab

## API Endpoints

- `GET /api/v1/items` - List tracked items
- `GET /api/v1/items/torn` - Get Torn catalog items
- `POST /api/v1/items` - Add item to tracking
- `DELETE /api/v1/items/{id}` - Stop tracking item
- `GET /api/v1/items/{id}/history` - Get price history
- `GET /api/v1/items/{id}/orderbook` - Get live order book (Top 5 listings)
- `GET /api/v1/settings/apikeys` - List API keys
- `POST /api/v1/settings/apikeys` - Add API key
- `DELETE /api/v1/settings/apikeys/{id}` - Remove API key

## License

MIT

