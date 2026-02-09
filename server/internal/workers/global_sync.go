package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/akagifreeez/torn-market-chart/internal/config"
	"github.com/akagifreeez/torn-market-chart/pkg/tornapi"
)

// GlobalSync handles daily synchronization of the item catalog
type GlobalSync struct {
	db       *pgxpool.Pool
	client   *tornapi.Client
	interval time.Duration
}

// NewGlobalSync creates a new GlobalSync worker
func NewGlobalSync(db *pgxpool.Pool, client *tornapi.Client, cfg *config.Config) *GlobalSync {
	return &GlobalSync{
		db:       db,
		client:   client,
		interval: cfg.GlobalSyncInterval,
	}
}

// Start begins the periodic synchronization
func (g *GlobalSync) Start(ctx context.Context) {
	log.Info().Dur("interval", g.interval).Msg("Starting Global Sync worker")

	// Run immediately on start
	if err := g.sync(ctx); err != nil {
		log.Error().Err(err).Msg("Initial sync failed")
	}

	ticker := time.NewTicker(g.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("Global Sync worker stopped")
			return
		case <-ticker.C:
			if err := g.sync(ctx); err != nil {
				log.Error().Err(err).Msg("Periodic sync failed")
			}
		}
	}
}

// sync performs the actual synchronization
// Note: id column IS the Torn item ID now (no separate torn_id)
func (g *GlobalSync) sync(ctx context.Context) error {
	log.Info().Msg("Starting item catalog sync...")
	start := time.Now()

	items, err := g.client.FetchAllItems(ctx)
	if err != nil {
		return err
	}

	// Upsert items into database
	updated := 0
	inserted := 0

	for itemID, item := range items {
		// Check if item exists (id IS the Torn item ID)
		var exists bool
		err := g.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM items WHERE id = $1)", itemID).Scan(&exists)
		if err != nil {
			log.Error().Err(err).Int64("item_id", itemID).Msg("Failed to check item existence")
			continue
		}

		if exists {
			// Update existing item
			_, err = g.db.Exec(ctx, `
				UPDATE items SET
					name = $1,
					description = $2,
					type = $3,
					circulation = $4,
					last_market_price = CASE WHEN $5::bigint > 0 THEN $5 ELSE last_market_price END,
					last_updated_at = NOW(),
					is_tracked = CASE WHEN $4::bigint = 0 THEN false ELSE is_tracked END
				WHERE id = $6
			`, item.Name, item.Description, item.Type, item.Circulation, item.MarketValue, itemID)

			if err != nil {
				log.Error().Err(err).Int64("item_id", itemID).Msg("Failed to update item")
			} else {
				updated++
			}
		} else {
			// Insert new item (id = Torn item ID, not auto-increment)
			_, err = g.db.Exec(ctx, `
				INSERT INTO items (id, name, description, type, circulation, last_market_price, is_tracked)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, itemID, item.Name, item.Description, item.Type, item.Circulation, item.MarketValue, item.Circulation > 0)

			if err != nil {
				log.Error().Err(err).Int64("item_id", itemID).Msg("Failed to insert item")
			} else {
				inserted++
			}
		}
	}

	elapsed := time.Since(start)
	log.Info().
		Int("inserted", inserted).
		Int("updated", updated).
		Int("total", len(items)).
		Dur("elapsed", elapsed).
		Msg("Item catalog sync completed")

	return nil
}

// RunOnce performs a single sync (useful for testing)
func (g *GlobalSync) RunOnce(ctx context.Context) error {
	return g.sync(ctx)
}
