package workers

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/akagifreeez/torn-market-chart/internal/config"
	"github.com/akagifreeez/torn-market-chart/internal/services"
	"github.com/akagifreeez/torn-market-chart/pkg/tornapi"
)

// BackgroundCrawler fetches market data for items that haven't been updated recently
type BackgroundCrawler struct {
	db         *pgxpool.Pool
	client     *tornapi.Client
	keyManager *services.KeyManager
	interval   time.Duration
}

// NewBackgroundCrawler creates a new BackgroundCrawler worker
func NewBackgroundCrawler(db *pgxpool.Pool, client *tornapi.Client, km *services.KeyManager, cfg *config.Config) *BackgroundCrawler {
	return &BackgroundCrawler{
		db:         db,
		client:     client,
		keyManager: km,
		interval:   cfg.BackgroundCrawlInterval,
	}
}

// Start begins the background crawling
func (c *BackgroundCrawler) Start(ctx context.Context) {
	log.Info().Dur("interval", c.interval).Msg("Starting Background Crawler worker")

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("Background Crawler worker stopped")
			return
		case <-ticker.C:
			c.crawlNext(ctx)
		}
	}
}

// crawlNext fetches the least recently updated item
func (c *BackgroundCrawler) crawlNext(ctx context.Context) {
	// 1. Find the item that hasn't been updated for the longest time
	// Priority: watched items (in user_watchlists), high circulation items, or stale low circulation items
	var itemID int64
	var itemName string
	err := c.db.QueryRow(ctx, `
		SELECT i.id, i.name FROM items i
		WHERE 
			(EXISTS(SELECT 1 FROM user_watchlists uw WHERE uw.item_id = i.id) AND (i.last_updated_at IS NULL OR i.last_updated_at < NOW() - INTERVAL '60 seconds'))
			OR (i.circulation > 10000 AND (i.last_updated_at IS NULL OR i.last_updated_at < NOW() - INTERVAL '1 hour'))
			OR (i.circulation <= 10000 AND (i.last_updated_at IS NULL OR i.last_updated_at < NOW() - INTERVAL '24 hours'))
		ORDER BY 
			CASE WHEN EXISTS(SELECT 1 FROM user_watchlists uw WHERE uw.item_id = i.id) THEN 1 ELSE 0 END DESC,
			i.last_updated_at ASC NULLS FIRST
		LIMIT 1
	`).Scan(&itemID, &itemName)

	if err != nil {
		// It's normal to find no items if everything is up to date according to our rules
		if err.Error() == "no rows in result set" {
			log.Debug().Msg("BackgroundCrawler: No items need updating right now")
			return
		}
		log.Error().Err(err).Msg("BackgroundCrawler: Failed to find next item")
		return
	}

	log.Debug().Int64("id", itemID).Str("name", itemName).Msg("BackgroundCrawler: Fetching item")

	// 2. Fetch market data (uses official API v2)
	// This will use the shared RateLimiter in the client
	// Use KeyManager to get the next available key
	key := c.keyManager.GetNextKey()
	var marketData *tornapi.TornMarketResponse

	if key != "" {
		marketData, err = c.client.FetchMarketPriceWithKey(ctx, itemID, key)
	} else {
		// Fallback to default client keys if key manager has no keys (shouldn't happen if env keys are loaded)
		log.Warn().Msg("BackgroundCrawler: KeyManager returned empty key, using default client rotation")
		marketData, err = c.client.FetchMarketPrice(ctx, itemID)
	}

	if err != nil {
		log.Error().Err(err).Int64("id", itemID).Msg("BackgroundCrawler: Failed to fetch market data")
		// If key was used, record error
		if key != "" {
			c.keyManager.RecordUsage(key, false)
		}
		return
	}

	// Record success
	if key != "" {
		c.keyManager.RecordUsage(key, true)
	}

	// 3. Store data
	now := time.Now()
	minPrice := int64(0)
	minBazaar := int64(0)

	// Store Item Market Data
	if marketData.ItemMarket != nil && len(marketData.ItemMarket.Listings) > 0 {
		minPrice = marketData.ItemMarket.Listings[0].Price
		// Insert into market_prices
		_, err = c.db.Exec(ctx, `
			INSERT INTO market_prices (time, item_id, price, quantity)
			VALUES ($1, $2, $3, $4)
		`, now, itemID, minPrice, marketData.ItemMarket.Listings[0].Quantity)
		if err != nil {
			log.Warn().Err(err).Msg("BackgroundCrawler: Failed to insert market price")
		}
	}

	// Store Bazaar Data
	if marketData.Bazaar != nil && len(marketData.Bazaar.Listings) > 0 {
		minBazaar = marketData.Bazaar.Listings[0].Price
		// Insert into bazaar_prices
		_, err = c.db.Exec(ctx, `
			INSERT INTO bazaar_prices (time, item_id, price, quantity)
			VALUES ($1, $2, $3, $4)
		`, now, itemID, minBazaar, marketData.Bazaar.Listings[0].Quantity)
		if err != nil {
			log.Warn().Err(err).Msg("BackgroundCrawler: Failed to insert bazaar price")
		}
	}

	// 4. Update last_updated_at
	// Don't overwrite prices with 0 if we didn't get them, but DO update timestamp to rotate the crawler
	query := `UPDATE items SET last_updated_at = $1`
	args := []interface{}{now}
	argIdx := 2

	if minPrice > 0 {
		query += fmt.Sprintf(", last_market_price = $%d", argIdx)
		args = append(args, minPrice)
		argIdx++
	}
	if minBazaar > 0 {
		query += fmt.Sprintf(", last_bazaar_price = $%d", argIdx)
		args = append(args, minBazaar)
		argIdx++
	}

	query += fmt.Sprintf(" WHERE id = $%d", argIdx)
	args = append(args, itemID)

	_, err = c.db.Exec(ctx, query, args...)
	if err != nil {
		log.Error().Err(err).Int64("id", itemID).Msg("BackgroundCrawler: Failed to update item timestamp")
	}
}
