package database

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB wraps the PostgreSQL connection pool
type DB struct {
	Pool *pgxpool.Pool
}

// New creates a new database connection pool
func New(ctx context.Context, databaseURL string) (*DB, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database URL: %w", err)
	}

	// Connection pool settings optimized for high-frequency writes
	config.MaxConns = 50
	config.MinConns = 10

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Test connection
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &DB{Pool: pool}, nil
}

// Close closes the database connection pool
func (db *DB) Close() {
	db.Pool.Close()
}

// Migrate runs database migrations (creates tables and hypertables)
func (db *DB) Migrate(ctx context.Context) error {
	migrations := []string{
		// Enable TimescaleDB extension
		`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;`,

		// Items table
		`CREATE TABLE IF NOT EXISTS items (
			id BIGINT PRIMARY KEY, -- This IS the Torn item ID
			name VARCHAR(255) NOT NULL,
			description TEXT,
			type VARCHAR(100),
			circulation BIGINT DEFAULT 0,
			is_tracked BOOLEAN DEFAULT false,
			is_watched BOOLEAN DEFAULT false,
			last_market_price BIGINT DEFAULT 0,
			last_bazaar_price BIGINT DEFAULT 0,
			last_updated_at TIMESTAMPTZ DEFAULT NOW(),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			alert_price_above BIGINT DEFAULT NULL,
			alert_price_below BIGINT DEFAULT NULL,
			alert_change_percent REAL DEFAULT NULL
		);`,

		// Add alert columns to existing items table (for existing databases)
		`ALTER TABLE items ADD COLUMN IF NOT EXISTS alert_price_above BIGINT DEFAULT NULL;`,
		`ALTER TABLE items ADD COLUMN IF NOT EXISTS alert_price_below BIGINT DEFAULT NULL;`,
		`ALTER TABLE items ADD COLUMN IF NOT EXISTS alert_change_percent REAL DEFAULT NULL;`,

		// Market prices hypertable
		`CREATE TABLE IF NOT EXISTS market_prices (
			time TIMESTAMPTZ NOT NULL,
			item_id BIGINT NOT NULL REFERENCES items(id),
			price BIGINT NOT NULL,
			quantity BIGINT DEFAULT 0
		);`,

		// Bazaar prices hypertable
		`CREATE TABLE IF NOT EXISTS bazaar_prices (
			time TIMESTAMPTZ NOT NULL,
			item_id BIGINT NOT NULL REFERENCES items(id),
			price BIGINT NOT NULL,
			quantity BIGINT DEFAULT 0,
			seller_id BIGINT,
			listing_id BIGINT
		);`,

		// Alert states for deduplication
		`CREATE TABLE IF NOT EXISTS alert_states (
			id BIGSERIAL PRIMARY KEY,
			item_id BIGINT NOT NULL REFERENCES items(id),
			user_id BIGINT NOT NULL,
			last_price BIGINT DEFAULT 0,
			last_hash VARCHAR(64),
			last_triggered_at TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(item_id, user_id)
		);`,

		// API keys table (Recreated for encryption support)
		`DROP TABLE IF EXISTS api_keys CASCADE;`,
		`CREATE TABLE IF NOT EXISTS api_keys (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			encrypted_key TEXT NOT NULL,
			label TEXT,
			is_active BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			last_used_at TIMESTAMPTZ,
			usage_count BIGINT DEFAULT 0,
			error_count INT DEFAULT 0
		);`,

		// Users table
		`CREATE TABLE IF NOT EXISTS users (
			id BIGINT PRIMARY KEY,           -- Torn User ID
			name VARCHAR(255) NOT NULL,
			api_key_hash TEXT NOT NULL,      -- Hashed API key (for quick lookup/auth)
			encrypted_api_key TEXT,          -- Encrypted API key (for background crawling)
			created_at TIMESTAMPTZ DEFAULT NOW(),
			last_login_at TIMESTAMPTZ DEFAULT NOW()
		);`,
		// Add encrypted_api_key column to existing users table
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_api_key TEXT;`,

		// User watchlists (replaces item.is_watched for multi-user)
		`CREATE TABLE IF NOT EXISTS user_watchlists (
			user_id BIGINT REFERENCES users(id),
			item_id BIGINT REFERENCES items(id),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			PRIMARY KEY (user_id, item_id)
		);`,

		// User alerts (replaces item.alert_* for multi-user)
		`CREATE TABLE IF NOT EXISTS user_alerts (
			id BIGSERIAL PRIMARY KEY,
			user_id BIGINT REFERENCES users(id),
			item_id BIGINT REFERENCES items(id),
			alert_price_above BIGINT,
			alert_price_below BIGINT,
			alert_change_percent REAL,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(user_id, item_id)
		);`,

		// Drop system api_keys table as requested
		`DROP TABLE IF EXISTS api_keys CASCADE;`,

		// Create indexes
		`CREATE INDEX IF NOT EXISTS idx_items_is_tracked ON items(is_tracked) WHERE is_tracked = true;`,
		`CREATE INDEX IF NOT EXISTS idx_items_is_watched ON items(is_watched) WHERE is_watched = true;`,
		`CREATE INDEX IF NOT EXISTS idx_alert_states_item_user ON alert_states(item_id, user_id);`,
		`CREATE INDEX IF NOT EXISTS idx_user_watchlists_user ON user_watchlists(user_id);`,
		`CREATE INDEX IF NOT EXISTS idx_users_encrypted_key ON users(encrypted_api_key) WHERE encrypted_api_key IS NOT NULL;`,
		`CREATE INDEX IF NOT EXISTS idx_market_prices_item_time ON market_prices (item_id, time DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_bazaar_prices_item_time ON bazaar_prices (item_id, time DESC);`,
	}

	for _, migration := range migrations {
		if _, err := db.Pool.Exec(ctx, migration); err != nil {
			return fmt.Errorf("migration failed: %w\nQuery: %s", err, migration)
		}
	}

	// Create hypertables (TimescaleDB specific)
	hypertables := []struct {
		table   string
		timeCol string
	}{
		{"market_prices", "time"},
		{"bazaar_prices", "time"},
	}

	for _, ht := range hypertables {
		query := fmt.Sprintf(`
			SELECT create_hypertable('%s', '%s', 
				chunk_time_interval => INTERVAL '1 week',
				if_not_exists => TRUE
			);
		`, ht.table, ht.timeCol)
		if _, err := db.Pool.Exec(ctx, query); err != nil {
			// Ignore error if hypertable already exists
			fmt.Printf("Note: %v (may already be a hypertable)\n", err)
		}
	}

	// Create continuous aggregates for fast charting
	aggregates := []string{
		// Market Prices
		`CREATE MATERIALIZED VIEW IF NOT EXISTS market_prices_1m
		WITH (timescaledb.continuous) AS
		SELECT
			time_bucket('1 minute', time) AS bucket,
			item_id,
			first(price, time) AS open,
			max(price) AS high,
			min(price) AS low,
			last(price, time) AS close,
			avg(price)::BIGINT AS avg_price,
			avg(quantity)::BIGINT AS volume
		FROM market_prices
		GROUP BY bucket, item_id
		WITH NO DATA;`,

		`CREATE MATERIALIZED VIEW IF NOT EXISTS market_prices_1h
		WITH (timescaledb.continuous) AS
		SELECT
			time_bucket('1 hour', time) AS bucket,
			item_id,
			first(price, time) AS open,
			max(price) AS high,
			min(price) AS low,
			last(price, time) AS close,
			avg(price)::BIGINT AS avg_price,
			avg(quantity)::BIGINT AS volume
		FROM market_prices
		GROUP BY bucket, item_id
		WITH NO DATA;`,

		`CREATE MATERIALIZED VIEW IF NOT EXISTS market_prices_1d
		WITH (timescaledb.continuous) AS
		SELECT
			time_bucket('1 day', time) AS bucket,
			item_id,
			first(price, time) AS open,
			max(price) AS high,
			min(price) AS low,
			last(price, time) AS close,
			avg(price)::BIGINT AS avg_price,
			avg(quantity)::BIGINT AS volume
		FROM market_prices
		GROUP BY bucket, item_id
		WITH NO DATA;`,

		// Bazaar Prices
		`CREATE MATERIALIZED VIEW IF NOT EXISTS bazaar_prices_1m
		WITH (timescaledb.continuous) AS
		SELECT
			time_bucket('1 minute', time) AS bucket,
			item_id,
			first(price, time) AS open,
			max(price) AS high,
			min(price) AS low,
			last(price, time) AS close,
			avg(price)::BIGINT AS avg_price,
			avg(quantity)::BIGINT AS volume
		FROM bazaar_prices
		GROUP BY bucket, item_id
		WITH NO DATA;`,

		`CREATE MATERIALIZED VIEW IF NOT EXISTS bazaar_prices_1h
		WITH (timescaledb.continuous) AS
		SELECT
			time_bucket('1 hour', time) AS bucket,
			item_id,
			first(price, time) AS open,
			max(price) AS high,
			min(price) AS low,
			last(price, time) AS close,
			avg(price)::BIGINT AS avg_price,
			avg(quantity)::BIGINT AS volume
		FROM bazaar_prices
		GROUP BY bucket, item_id
		WITH NO DATA;`,

		`CREATE MATERIALIZED VIEW IF NOT EXISTS bazaar_prices_1d
		WITH (timescaledb.continuous) AS
		SELECT
			time_bucket('1 day', time) AS bucket,
			item_id,
			first(price, time) AS open,
			max(price) AS high,
			min(price) AS low,
			last(price, time) AS close,
			avg(price)::BIGINT AS avg_price,
			avg(quantity)::BIGINT AS volume
		FROM bazaar_prices
		GROUP BY bucket, item_id
		WITH NO DATA;`,
	}

	for _, agg := range aggregates {
		if _, err := db.Pool.Exec(ctx, agg); err != nil {
			fmt.Printf("Note: %v (continuous aggregate may already exist)\n", err)
		}
	}

	// Add refresh policies
	policies := []string{
		"SELECT add_continuous_aggregate_policy('market_prices_1m', start_offset => INTERVAL '1 hour', end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 minute');",
		"SELECT add_continuous_aggregate_policy('market_prices_1h', start_offset => INTERVAL '1 day', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour');",
		"SELECT add_continuous_aggregate_policy('market_prices_1d', start_offset => INTERVAL '1 month', end_offset => INTERVAL '1 day', schedule_interval => INTERVAL '1 day');",
		"SELECT add_continuous_aggregate_policy('bazaar_prices_1m', start_offset => INTERVAL '1 hour', end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 minute');",
		"SELECT add_continuous_aggregate_policy('bazaar_prices_1h', start_offset => INTERVAL '1 day', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour');",
		"SELECT add_continuous_aggregate_policy('bazaar_prices_1d', start_offset => INTERVAL '1 month', end_offset => INTERVAL '1 day', schedule_interval => INTERVAL '1 day');",
	}

	for _, policy := range policies {
		if _, err := db.Pool.Exec(ctx, policy); err != nil {
			// Ignore error if policy already exists
			fmt.Printf("Note: %v (policy may already exist)\n", err)
		}
	}

	return nil
}
