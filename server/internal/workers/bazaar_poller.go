package workers

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/akagifreeez/torn-market-chart/internal/config"
	"github.com/akagifreeez/torn-market-chart/internal/services"
	"github.com/akagifreeez/torn-market-chart/pkg/tornapi"
)

// ItemState tracks the health of an item for smart suspension
type ItemState struct {
	FailCount     int
	CooldownUntil time.Time
}

// BazaarPoller handles high-frequency bazaar price fetching using Weav3r.dev API
type BazaarPoller struct {
	db              *pgxpool.Pool
	weav3rClient    *services.ExternalPriceClient
	alertService    *services.AlertService
	interval        time.Duration
	maxConcurrent   int
	bazaarRateLimit int
	itemStates      map[int64]*ItemState
	statesMu        sync.RWMutex
	limiter         *tornapi.RateLimiter
}

// NewBazaarPoller creates a new BazaarPoller worker
func NewBazaarPoller(db *pgxpool.Pool, cfg *config.Config, alertService *services.AlertService, limiter *tornapi.RateLimiter) *BazaarPoller {
	return &BazaarPoller{
		db:              db,
		weav3rClient:    services.NewExternalPriceClient(),
		alertService:    alertService,
		interval:        cfg.BazaarPollInterval,
		maxConcurrent:   cfg.MaxConcurrentFetches,
		bazaarRateLimit: cfg.BazaarRateLimit,
		itemStates:      make(map[int64]*ItemState),
		limiter:         limiter,
	}
}

// Start begins the periodic polling
func (b *BazaarPoller) Start(ctx context.Context) {
	log.Info().
		Dur("interval", b.interval).
		Int("maxConcurrent", b.maxConcurrent).
		Msg("Starting Bazaar Poller worker (using Weav3r.dev API)")

	ticker := time.NewTicker(b.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("Bazaar Poller worker stopped")
			return
		case <-ticker.C:
			b.pollAll(ctx)
		}
	}
}

// pollAll fetches prices using Weav3r.dev API in two phases:
// Phase 1: Watched items (high priority, every cycle)
// Phase 2: Stale tracked items (fill remaining rate budget)
func (b *BazaarPoller) pollAll(ctx context.Context) {
	start := time.Now()

	// Phase 1: Watched items (high priority)
	watchedItems := b.getWatchedItems(ctx)
	watchedCount := b.fetchItems(ctx, watchedItems, "Phase1-Watched")

	// Phase 2: Fill remaining rate budget with stale tracked items
	// Calculate how many requests we can still make this cycle
	// Rate budget per cycle = (rateLimit / 60) * interval_seconds
	intervalSec := b.interval.Seconds()
	budgetPerCycle := int(float64(b.bazaarRateLimit) / 60.0 * intervalSec)
	remaining := budgetPerCycle - watchedCount
	if remaining > 0 {
		staleItems := b.getStaleTrackedItems(ctx, remaining)
		if len(staleItems) > 0 {
			staleCount := b.fetchItems(ctx, staleItems, "Phase2-Stale")
			log.Debug().
				Int("watched", watchedCount).
				Int("stale", staleCount).
				Int("budget", budgetPerCycle).
				Dur("elapsed", time.Since(start)).
				Msg("Bazaar poll cycle completed (2-phase)")
			return
		}
	}

	log.Debug().
		Int("watched", watchedCount).
		Int("budget", budgetPerCycle).
		Dur("elapsed", time.Since(start)).
		Msg("Bazaar poll cycle completed")
}

// getWatchedItems returns items in user watchlists
func (b *BazaarPoller) getWatchedItems(ctx context.Context) []itemInfo {
	rows, err := b.db.Query(ctx, `
		SELECT DISTINCT i.id, i.name 
		FROM items i
		JOIN user_watchlists uw ON i.id = uw.item_id
		ORDER BY i.id
	`)
	if err != nil {
		log.Error().Err(err).Msg("Failed to fetch watched items")
		return nil
	}
	defer rows.Close()

	return b.scanItems(rows)
}

// getStaleTrackedItems returns tracked items NOT in watchlists, ordered by staleness
func (b *BazaarPoller) getStaleTrackedItems(ctx context.Context, limit int) []itemInfo {
	rows, err := b.db.Query(ctx, `
		SELECT i.id, i.name FROM items i
		WHERE i.is_tracked = true
			AND NOT EXISTS (SELECT 1 FROM user_watchlists uw WHERE uw.item_id = i.id)
			AND (i.last_updated_at IS NULL OR i.last_updated_at < NOW() - INTERVAL '5 minutes')
		ORDER BY i.last_updated_at ASC NULLS FIRST
		LIMIT $1
	`, limit)
	if err != nil {
		log.Error().Err(err).Msg("Failed to fetch stale tracked items")
		return nil
	}
	defer rows.Close()

	return b.scanItems(rows)
}

type itemInfo struct {
	ID   int64
	Name string
}

func (b *BazaarPoller) scanItems(rows interface {
	Next() bool
	Scan(...interface{}) error
}) []itemInfo {
	var items []itemInfo
	for rows.Next() {
		var item itemInfo
		if err := rows.Scan(&item.ID, &item.Name); err != nil {
			continue
		}

		// Check cooldown
		b.statesMu.RLock()
		state := b.itemStates[item.ID]
		b.statesMu.RUnlock()

		if state != nil && time.Now().Before(state.CooldownUntil) {
			continue
		}

		items = append(items, item)
	}
	return items
}

// fetchItems concurrently fetches bazaar prices for the given items, returns success count
func (b *BazaarPoller) fetchItems(ctx context.Context, items []itemInfo, phase string) int {
	if len(items) == 0 {
		return 0
	}

	sem := make(chan struct{}, b.maxConcurrent)
	var wg sync.WaitGroup

	successCount := 0
	failCount := 0
	var countMu sync.Mutex

	for _, item := range items {
		wg.Add(1)
		sem <- struct{}{} // Acquire

		go func(item itemInfo) {
			defer wg.Done()
			defer func() { <-sem }() // Release

			// Rate Limiting
			if b.limiter != nil {
				if err := b.limiter.WaitForTicket(ctx, 1); err != nil {
					return
				}
			}

			if err := b.fetchAndStore(ctx, item.ID); err != nil {
				countMu.Lock()
				failCount++
				countMu.Unlock()

				b.handleFailure(item.ID, err)
			} else {
				countMu.Lock()
				successCount++
				countMu.Unlock()

				b.resetFailure(item.ID)
			}
		}(item)
	}

	wg.Wait()

	if failCount > 0 {
		log.Debug().
			Str("phase", phase).
			Int("success", successCount).
			Int("failed", failCount).
			Msg("Bazaar fetch phase completed with failures")
	}

	return successCount
}

// fetchAndStore retrieves market data from Weav3r.dev and stores it
// itemID IS the Torn item ID now
func (b *BazaarPoller) fetchAndStore(ctx context.Context, itemID int64) error {
	// Fetch from Weav3r.dev API (itemID is already the Torn item ID)
	weav3rData, err := b.weav3rClient.FetchWeav3rMarketplace(ctx, itemID)
	if err != nil {
		return err
	}

	now := time.Now()

	// Store bazaar price from Weav3r if available
	if len(weav3rData.Listings) > 0 {
		// Find minimum price
		minPrice := weav3rData.Listings[0].Price
		minQty := weav3rData.Listings[0].Quantity
		sellerID := weav3rData.Listings[0].SellerID
		listingID := int64(0) // Not available in Weav3r API

		for _, listing := range weav3rData.Listings {
			if listing.Price < minPrice {
				minPrice = listing.Price
				minQty = listing.Quantity
				sellerID = listing.SellerID
				// listingID remains 0
			}
		}

		// Insert into bazaar_prices
		_, err = b.db.Exec(ctx, `
			INSERT INTO bazaar_prices (time, item_id, price, quantity, seller_id)
			VALUES ($1, $2, $3, $4, $5)
		`, now, itemID, minPrice, minQty, sellerID)
		if err != nil {
			log.Warn().Err(err).Int64("item_id", itemID).Msg("Failed to insert bazaar price")
		}

		// Update cache
		_, err = b.db.Exec(ctx, `
			UPDATE items SET last_bazaar_price = $1, last_updated_at = $2 WHERE id = $3
		`, minPrice, now, itemID)

		if err != nil {
			log.Error().Err(err).Int64("item_id", itemID).Msg("Failed to update item cache")
		}

		log.Debug().
			Int64("item_id", itemID).
			Int64("price", minPrice).
			Int64("seller_id", sellerID).
			Msg("Stored Weav3r bazaar price")

		// Trigger Alert Check
		// We need item name for the alert, fetch from DB
		var itemName string
		err = b.db.QueryRow(ctx, "SELECT name FROM items WHERE id = $1", itemID).Scan(&itemName)
		if err != nil {
			itemName = "Unknown Item"
		}

		update := services.PriceUpdate{
			ItemID:    itemID,
			ItemName:  itemName,
			Price:     minPrice,
			Type:      "bazaar",
			Quantity:  minQty,
			SellerID:  sellerID,
			ListingID: listingID,
		}

		// Use userID=0 for system alerts
		if _, err := b.alertService.CheckAndTrigger(ctx, update, 0); err != nil {
			log.Error().Err(err).Int64("item_id", itemID).Msg("Alert check failed")
		}
	}

	return nil
}

// handleFailure implements smart suspension logic
func (b *BazaarPoller) handleFailure(itemID int64, err error) {
	b.statesMu.Lock()
	defer b.statesMu.Unlock()

	state, exists := b.itemStates[itemID]
	if !exists {
		state = &ItemState{}
		b.itemStates[itemID] = state
	}

	state.FailCount++

	// After 3 consecutive failures, put item in cooldown
	if state.FailCount >= 3 {
		state.CooldownUntil = time.Now().Add(1 * time.Hour)
		log.Warn().
			Int64("item_id", itemID).
			Int("fail_count", state.FailCount).
			Time("cooldown_until", state.CooldownUntil).
			Msg("Item put in cooldown due to repeated failures")
	}
}

// resetFailure clears failure state on successful fetch
func (b *BazaarPoller) resetFailure(itemID int64) {
	b.statesMu.Lock()
	defer b.statesMu.Unlock()

	if state, exists := b.itemStates[itemID]; exists {
		state.FailCount = 0
	}
}
