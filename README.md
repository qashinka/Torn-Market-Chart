# Torn Market Tracker

A web application to track and visualize item prices from Torn City, monitoring both the Bazaar and Item Market.

## Features

- **Price Tracking**: Automatically fetches item prices every minute.
- **Dual Source Monitoring**: Tracks `Bazaar` and `Item Market` prices separately.
- **Interactive Charts**:
    - Selectable timeframes (1 min to 1 day).
    - Toggle between Line and Candlestick charts.
    - Customizable visibility for Min/Avg prices.
- **Dockerized**: Easy deployment with Docker Compose.
- **MySQL Support**: Robust data storage using MySQL 8.0.

## Tech Stack

- **Backend**: Python (Flask), SQLAlchemy, APScheduler
- **Frontend**: HTML5, Vanilla JS, TradingView Lightweight Charts
- **Database**: MySQL 8.0
- **Containerization**: Docker, Docker Compose

## Setup & Running

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd torn-market-tracker
   ```

2. **Start with Docker Compose:**
   ```bash
   docker-compose up --build -d
   ```

3. **Access the application:**
   Open your browser and navigate to `http://localhost:5000`.

4. **Configuration:**
   - Click "Settings" in the UI.
   - Add your **Torn API Key**.
   - Add items to track by their ID (e.g., Xanax ID is `206`).

## Development

- The backend is located in `app.py`.
- Frontend templates are in `templates/index.html`.
- Background tasks are handled by `APScheduler` within the Flask app.

## License

MIT
