package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/akagifreeez/torn-market-chart/internal/models"
	"github.com/akagifreeez/torn-market-chart/internal/services"
	"github.com/akagifreeez/torn-market-chart/pkg/database"
	"github.com/go-chi/chi/v5"
)

type PriceHandler struct {
	db *database.DB
}

func NewPriceHandler(db *database.DB) *PriceHandler {
	return &PriceHandler{db: db}
}

// GetHistory returns price history for an item
// GET /api/v1/items/{id}/history?interval=1h&days=7 (id IS the Torn item ID now)
func (h *PriceHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// Parse query params
	interval := r.URL.Query().Get("interval")
	if interval == "" {
		interval = "1h"
	}
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days <= 0 {
		days = 7
	}
	priceType := r.URL.Query().Get("type")
	if priceType == "" {
		priceType = "market"
	}

	// Select appropriate view based on interval and type
	var viewName string
	var rawTable string
	var pgInterval string
	prefix := "market_prices"
	rawTable = "market_prices"

	if priceType == "bazaar" {
		prefix = "bazaar_prices"
		rawTable = "bazaar_prices"
	}

	switch interval {
	case "1m":
		viewName = prefix + "_1m"
		pgInterval = "1 minute"
	case "1h":
		viewName = prefix + "_1h"
		pgInterval = "1 hour"
	case "1d":
		viewName = prefix + "_1d"
		pgInterval = "1 day"
	default:
		viewName = prefix + "_1h"
		pgInterval = "1 hour"
	}

	// 1. Prepare query to fetch history combined with real-time data using SQL UNION
	// This covers potential continuous aggregate lag by fetching recent raw data

	// 2. Fetch history combined with real-time data using SQL UNION
	// This covers potential continuous aggregate lag by fetching recent raw data

	finalQuery := fmt.Sprintf(`
		WITH materialized AS (
			SELECT bucket, item_id, open, high, low, close, avg_price, volume
			FROM %s
			WHERE item_id = $1 AND bucket >= NOW() - $2::INTERVAL
		),
		realtime AS (
			SELECT 
				time_bucket($3, time) AS bucket,
				item_id,
				first(price, time) AS open,
				max(price) AS high,
				min(price) AS low,
				last(price, time) AS close,
				avg(price)::BIGINT AS avg_price,
				avg(quantity)::BIGINT AS volume
			FROM %s
			WHERE item_id = $1 AND time >= (
				SELECT COALESCE(MAX(bucket), NOW() - $2::INTERVAL) FROM materialized
			)
			GROUP BY bucket, item_id
		)
		SELECT * FROM materialized
		UNION ALL
		SELECT * FROM realtime WHERE bucket NOT IN (SELECT bucket FROM materialized)
		ORDER BY bucket ASC
	`, viewName, rawTable)

	rows, err := h.db.Pool.Query(ctx, finalQuery, itemID, strconv.Itoa(days)+" days", pgInterval)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	candles := make([]models.PriceCandle, 0)
	for rows.Next() {
		var c models.PriceCandle
		if err := rows.Scan(
			&c.Time,
			&c.ItemID,
			&c.Open,
			&c.High,
			&c.Low,
			&c.Close,
			&c.AvgPrice,
			&c.Volume,
		); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		candles = append(candles, c)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(candles)
}

// GetLatest returns the latest price for an item
// GET /api/v1/items/{id}/latest (id IS the Torn item ID now)
func (h *PriceHandler) GetLatest(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID, _ := GetUserIDFromContext(ctx) // Optional

	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	query := `
		SELECT 
			i.id, i.name, i.type, i.circulation, 
			i.last_market_price, i.last_bazaar_price, i.last_updated_at,
			CASE WHEN uw.user_id IS NOT NULL THEN true ELSE false END as is_watched,
			ua.alert_price_above, ua.alert_price_below, ua.alert_change_percent
		FROM items i
		LEFT JOIN user_watchlists uw ON i.id = uw.item_id AND uw.user_id = $2
		LEFT JOIN user_alerts ua ON i.id = ua.item_id AND ua.user_id = $2
		WHERE i.id = $1
	`

	var item models.Item
	err = h.db.Pool.QueryRow(ctx, query, itemID, userID).Scan(
		&item.ID, &item.Name, &item.Type, &item.Circulation,
		&item.LastMarketPrice, &item.LastBazaarPrice, &item.LastUpdatedAt, &item.IsWatched,
		&item.AlertPriceAbove, &item.AlertPriceBelow, &item.AlertChangePercent,
	)
	if err != nil {
		http.Error(w, "Item not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(item)
}

// ListTracked returns all tracked items (including user's watched items)
// GET /api/v1/items
func (h *PriceHandler) ListTracked(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID, _ := GetUserIDFromContext(ctx) // Optional: might be 0 if public endpoint, but we should handle it

	query := `
		SELECT 
			i.id, i.name, i.type, i.circulation, i.is_tracked, 
			CASE WHEN uw.user_id IS NOT NULL THEN true ELSE false END as is_watched,
			COALESCE(mp.price, i.last_market_price, 0) as last_market_price,
			COALESCE(bp.price, i.last_bazaar_price, 0) as last_bazaar_price,
			GREATEST(mp.time, bp.time, i.last_updated_at) as last_updated_at
		FROM items i
		LEFT JOIN user_watchlists uw ON i.id = uw.item_id AND uw.user_id = $1
		LEFT JOIN LATERAL (
			SELECT price, time FROM market_prices WHERE item_id = i.id ORDER BY time DESC LIMIT 1
		) mp ON true
		LEFT JOIN LATERAL (
			SELECT price, time FROM bazaar_prices WHERE item_id = i.id ORDER BY time DESC LIMIT 1
		) bp ON true
		WHERE i.is_tracked = true OR uw.user_id IS NOT NULL
		ORDER BY i.name ASC
	`

	rows, err := h.db.Pool.Query(ctx, query, userID)
	if err != nil {
		fmt.Printf("Database error in ListTracked: %v\n", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	items := make([]models.Item, 0)
	for rows.Next() {
		var item models.Item
		if err := rows.Scan(
			&item.ID, &item.Name, &item.Type, &item.Circulation, &item.IsTracked, &item.IsWatched,
			&item.LastMarketPrice, &item.LastBazaarPrice, &item.LastUpdatedAt,
		); err != nil {
			fmt.Printf("Scan error in ListTracked: %v\n", err)
			continue
		}
		items = append(items, item)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// SearchItems searches for items by name
// GET /api/v1/items/search?q=query
func (h *PriceHandler) SearchItems(w http.ResponseWriter, r *http.Request) {
	queryParam := r.URL.Query().Get("q")
	if queryParam == "" {
		// Return empty list if no query
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]models.Item{})
		return
	}

	ctx := r.Context()
	userID, _ := GetUserIDFromContext(ctx)

	// SQL to search both tracked and untracked items
	// We also return 'is_watched' status if user is logged in
	sql := `
		SELECT 
			i.id, i.name, i.type, i.circulation, i.is_tracked, 
			CASE WHEN uw.user_id IS NOT NULL THEN true ELSE false END as is_watched,
			COALESCE(i.last_market_price, 0) as last_market_price,
			COALESCE(i.last_bazaar_price, 0) as last_bazaar_price,
			i.last_updated_at
		FROM items i
		LEFT JOIN user_watchlists uw ON i.id = uw.item_id AND uw.user_id = $1
		WHERE i.name ILIKE $2
		ORDER BY 
			CASE WHEN i.name ILIKE $3 THEN 0 ELSE 1 END, -- Prioritize exact starts
			i.name ASC
		LIMIT 20
	`

	// $2 = %query%, $3 = query%
	likeQuery := "%" + queryParam + "%"
	startQuery := queryParam + "%"

	rows, err := h.db.Pool.Query(ctx, sql, userID, likeQuery, startQuery)
	if err != nil {
		fmt.Printf("Database error in SearchItems: %v\n", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	items := make([]models.Item, 0)
	for rows.Next() {
		var item models.Item
		if err := rows.Scan(
			&item.ID, &item.Name, &item.Type, &item.Circulation, &item.IsTracked, &item.IsWatched,
			&item.LastMarketPrice, &item.LastBazaarPrice, &item.LastUpdatedAt,
		); err != nil {
			fmt.Printf("Scan error in SearchItems: %v\n", err)
			continue
		}
		items = append(items, item)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// GetExternalPrices returns trader prices from TornExchange and Weav3r
// GET /api/v1/items/{id}/external-prices
func (h *PriceHandler) GetExternalPrices(w http.ResponseWriter, r *http.Request) {
	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	client := services.NewExternalPriceClient()
	prices, err := client.GetTraderPriceOverlay(r.Context(), itemID)
	if err != nil {
		http.Error(w, "Failed to fetch external prices", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(prices)
}

// GetTopListings returns top 5 bazaar listings from Weav3r
// GET /api/v1/items/{id}/listings?type=bazaar
func (h *PriceHandler) GetTopListings(w http.ResponseWriter, r *http.Request) {
	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	priceType := r.URL.Query().Get("type")
	if priceType == "" {
		priceType = "bazaar"
	}

	type ListingResponse struct {
		PlayerID   int64  `json:"player_id"`
		PlayerName string `json:"player_name"`
		Price      int64  `json:"price"`
		Quantity   int64  `json:"quantity"`
		URL        string `json:"url"`
	}

	listings := make([]ListingResponse, 0)

	if priceType == "bazaar" {
		client := services.NewExternalPriceClient()
		weav3rData, err := client.FetchWeav3rMarketplace(r.Context(), itemID)
		if err != nil {
			fmt.Printf("GetTopListings: Failed to fetch Weav3r data for item %d: %v\n", itemID, err)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(listings)
			return
		}

		// Update DB with latest bazaar price for non-watched items
		if len(weav3rData.Listings) > 0 {
			minPrice := weav3rData.Listings[0].Price
			minQty := weav3rData.Listings[0].Quantity
			sellerID := weav3rData.Listings[0].SellerID
			now := time.Now()

			// Run DB updates asynchronously to not block response significantly
			go func() {
				defer func() {
					if r := recover(); r != nil {
						fmt.Printf("Recovered from panic in GetTopListings async update: %v\n", r)
					}
				}()

				ctx := context.Background() // New context for async operation

				// Insert into bazaar_prices
				_, err := h.db.Pool.Exec(ctx, `
					INSERT INTO bazaar_prices (time, item_id, price, quantity, seller_id)
					VALUES ($1, $2, $3, $4, $5)
				`, now, itemID, minPrice, minQty, sellerID)
				if err != nil {
					fmt.Printf("Failed to insert bazaar price for item %d: %v\n", itemID, err)
				} else {
					// fmt.Printf("Successfully updated bazaar price for item %d: %d\n", itemID, minPrice)
				}

				// Update item cache
				_, err = h.db.Pool.Exec(ctx, `
					UPDATE items SET last_bazaar_price = $1, last_updated_at = $2 WHERE id = $3
				`, minPrice, now, itemID)
				if err != nil {
					fmt.Printf("Failed to update item cache for item %d: %v\n", itemID, err)
				}
			}()
		}

		// Get top 5 listings sorted by price
		for i, listing := range weav3rData.Listings {
			if i >= 5 {
				break
			}
			listings = append(listings, ListingResponse{
				PlayerID:   listing.SellerID,
				PlayerName: listing.PlayerName,
				Price:      listing.Price,
				Quantity:   listing.Quantity,
				URL:        "https://www.torn.com/bazaar.php?userId=" + strconv.FormatInt(listing.SellerID, 10) + "#/",
			})
		}
	} else {
		// Market type - return link to market
		listings = append(listings, ListingResponse{
			PlayerID:   0,
			PlayerName: "Torn Market",
			Price:      0,
			Quantity:   0,
			URL:        "https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=" + strconv.FormatInt(itemID, 10),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(listings)
}

// ToggleWatchlist adds or removes an item from the user's watchlist
// POST /api/v1/items/{id}/watch
func (h *PriceHandler) ToggleWatchlist(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID, ok := GetUserIDFromContext(ctx)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	// Check current status
	var exists bool
	err = h.db.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM user_watchlists WHERE user_id = $1 AND item_id = $2)", userID, itemID).Scan(&exists)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	if exists {
		// Remove
		_, err = h.db.Pool.Exec(ctx, "DELETE FROM user_watchlists WHERE user_id = $1 AND item_id = $2", userID, itemID)
	} else {
		// Add
		_, err = h.db.Pool.Exec(ctx, "INSERT INTO user_watchlists (user_id, item_id) VALUES ($1, $2)", userID, itemID)
	}

	if err != nil {
		http.Error(w, "Failed to update watchlist", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"item_id":    itemID,
		"is_watched": !exists,
	})
}

// ListWatched returns all items in the user's watchlist
// GET /api/v1/items/watched
func (h *PriceHandler) ListWatched(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID, ok := GetUserIDFromContext(ctx)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	query := `
		SELECT 
			i.id, i.name, i.type, i.circulation, i.is_tracked, true as is_watched,
			COALESCE(mp.price, i.last_market_price, 0) as last_market_price,
			COALESCE(bp.price, i.last_bazaar_price, 0) as last_bazaar_price,
			GREATEST(mp.time, bp.time, i.last_updated_at) as last_updated_at,
			ua.alert_price_above, ua.alert_price_below, ua.alert_change_percent
		FROM items i
		JOIN user_watchlists uw ON i.id = uw.item_id AND uw.user_id = $1
		LEFT JOIN user_alerts ua ON i.id = ua.item_id AND ua.user_id = $1
		LEFT JOIN LATERAL (
			SELECT price, time FROM market_prices WHERE item_id = i.id ORDER BY time DESC LIMIT 1
		) mp ON true
		LEFT JOIN LATERAL (
			SELECT price, time FROM bazaar_prices WHERE item_id = i.id ORDER BY time DESC LIMIT 1
		) bp ON true
		ORDER BY i.name ASC
	`

	rows, err := h.db.Pool.Query(ctx, query, userID)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	items := make([]models.Item, 0)
	for rows.Next() {
		var item models.Item
		if err := rows.Scan(
			&item.ID, &item.Name, &item.Type, &item.Circulation,
			&item.IsTracked, &item.IsWatched, &item.LastMarketPrice, &item.LastBazaarPrice, &item.LastUpdatedAt,
			&item.AlertPriceAbove, &item.AlertPriceBelow, &item.AlertChangePercent,
		); err != nil {
			fmt.Printf("Scan error in ListWatched: %v\n", err)
			continue
		}
		items = append(items, item)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// AlertSettingsRequest represents the request body for updating alert settings
type AlertSettingsRequest struct {
	AlertPriceAbove    *int64   `json:"alert_price_above"`
	AlertPriceBelow    *int64   `json:"alert_price_below"`
	AlertChangePercent *float64 `json:"alert_change_percent"`
}

// UpdateAlertSettings updates alert configuration for an item
// PUT /api/v1/items/{id}/alerts
func (h *PriceHandler) UpdateAlertSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID, ok := GetUserIDFromContext(ctx)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	var req AlertSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	_, err = h.db.Pool.Exec(ctx, `
		INSERT INTO user_alerts (user_id, item_id, alert_price_above, alert_price_below, alert_change_percent, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (user_id, item_id) DO UPDATE 
		SET alert_price_above = $3, alert_price_below = $4, alert_change_percent = $5
	`, userID, itemID, req.AlertPriceAbove, req.AlertPriceBelow, req.AlertChangePercent)

	if err != nil {
		http.Error(w, "Failed to update alert settings", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"item_id":              itemID,
		"alert_price_above":    req.AlertPriceAbove,
		"alert_price_below":    req.AlertPriceBelow,
		"alert_change_percent": req.AlertChangePercent,
	})
}

type WebhookHandler struct {
	db *database.DB
}

func NewWebhookHandler(db *database.DB) *WebhookHandler {
	return &WebhookHandler{db: db}
}

// HandleUpdate processes incoming price updates from webhooks
// POST /api/webhook/update
func (h *WebhookHandler) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	var payload models.WebhookPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	now := time.Now()
	processed := 0

	for _, item := range payload.Items {
		// item.TornID IS the internal item ID now
		itemID := item.TornID

		// Check if item exists/is tracked (optional but good for safety)
		var exists bool
		err := h.db.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM items WHERE id = $1)", itemID).Scan(&exists)
		if err != nil || !exists {
			continue // Item not tracked or DB error
		}

		ts := now
		if item.Timestamp > 0 {
			ts = time.Unix(item.Timestamp, 0)
		}

		if item.Type == "market" {
			// Insert into market_prices
			_, err = h.db.Pool.Exec(ctx,
				"INSERT INTO market_prices (time, item_id, price) VALUES ($1, $2, $3)",
				ts, itemID, item.Price,
			)
			if err == nil {
				// Update item cache
				h.db.Pool.Exec(ctx,
					"UPDATE items SET last_market_price = $1, last_updated_at = $2 WHERE id = $3",
					item.Price, now, itemID,
				)
				processed++
			}
		} else if item.Type == "bazaar" {
			// Insert into bazaar_prices
			_, err = h.db.Pool.Exec(ctx,
				"INSERT INTO bazaar_prices (time, item_id, price, quantity, seller_id, listing_id) VALUES ($1, $2, $3, $4, $5, $6)",
				ts, itemID, item.Price, 0, item.SellerID, item.ListingID,
			)
			if err == nil {
				// Update item cache
				h.db.Pool.Exec(ctx,
					"UPDATE items SET last_bazaar_price = $1, last_updated_at = $2 WHERE id = $3",
					item.Price, now, itemID,
				)
				processed++
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ok",
		"processed": processed,
		"total":     len(payload.Items),
	})
}
