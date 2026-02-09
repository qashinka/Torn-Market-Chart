package models

import (
	"time"
)

// Item represents a Torn item with its current price cache
// Note: id IS the Torn item ID (previously torn_id)
type Item struct {
	ID                 int64     `json:"id" db:"id"` // This IS the Torn item ID
	Name               string    `json:"name" db:"name"`
	Description        string    `json:"description,omitempty" db:"description"`
	Type               string    `json:"type,omitempty" db:"type"`
	Circulation        int64     `json:"circulation" db:"circulation"`
	IsTracked          bool      `json:"is_tracked" db:"is_tracked"`
	IsWatched          bool      `json:"is_watched" db:"is_watched"`
	LastMarketPrice    int64     `json:"last_market_price" db:"last_market_price"`
	LastBazaarPrice    int64     `json:"last_bazaar_price" db:"last_bazaar_price"`
	LastUpdatedAt      time.Time `json:"last_updated_at" db:"last_updated_at"`
	CreatedAt          time.Time `json:"created_at" db:"created_at"`
	AlertPriceAbove    *int64    `json:"alert_price_above,omitempty" db:"alert_price_above"`
	AlertPriceBelow    *int64    `json:"alert_price_below,omitempty" db:"alert_price_below"`
	AlertChangePercent *float64  `json:"alert_change_percent,omitempty" db:"alert_change_percent"`
}

// MarketPrice represents a single price point in the item market (Hypertable)
type MarketPrice struct {
	Time     time.Time `json:"time" db:"time"`
	ItemID   int64     `json:"item_id" db:"item_id"`
	Price    int64     `json:"price" db:"price"`
	Quantity int64     `json:"quantity,omitempty" db:"quantity"`
}

// BazaarPrice represents a single price point in bazaars (Hypertable)
type BazaarPrice struct {
	Time      time.Time `json:"time" db:"time"`
	ItemID    int64     `json:"item_id" db:"item_id"`
	Price     int64     `json:"price" db:"price"`
	Quantity  int64     `json:"quantity,omitempty" db:"quantity"`
	SellerID  int64     `json:"seller_id,omitempty" db:"seller_id"`
	ListingID int64     `json:"listing_id,omitempty" db:"listing_id"`
}

// AlertState tracks the last alert state for deduplication
type AlertState struct {
	ID              int64     `json:"id" db:"id"`
	ItemID          int64     `json:"item_id" db:"item_id"`
	UserID          int64     `json:"user_id" db:"user_id"`
	LastPrice       int64     `json:"last_price" db:"last_price"`
	LastHash        string    `json:"last_hash" db:"last_hash"`
	LastTriggeredAt time.Time `json:"last_triggered_at" db:"last_triggered_at"`
}

// APIKey represents a Torn API key for rotation
type APIKey struct {
	ID         int64     `json:"id" db:"id"`
	Key        string    `json:"key" db:"key"`
	OwnerID    int64     `json:"owner_id" db:"owner_id"`
	IsActive   bool      `json:"is_active" db:"is_active"`
	LastUsedAt time.Time `json:"last_used_at" db:"last_used_at"`
	FailCount  int       `json:"fail_count" db:"fail_count"`
	CooldownAt time.Time `json:"cooldown_at,omitempty" db:"cooldown_at"`
}

// PriceCandle represents an aggregated price candle (from Continuous Aggregates)
type PriceCandle struct {
	Time     time.Time `json:"time" db:"bucket"`
	ItemID   int64     `json:"item_id" db:"item_id"`
	Open     int64     `json:"open" db:"open"`
	High     int64     `json:"high" db:"high"`
	Low      int64     `json:"low" db:"low"`
	Close    int64     `json:"close" db:"close"`
	AvgPrice float64   `json:"avg_price" db:"avg_price"`
	Volume   int64     `json:"volume,omitempty" db:"volume"`
}

// User represents a registered user (via Torn API Key)
type User struct {
	ID          int64     `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	APIKeyHash  string    `json:"-" db:"api_key_hash"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	LastLoginAt time.Time `json:"last_login_at" db:"last_login_at"`
}

// UserWatchlist represents an item in a user's watchlist
type UserWatchlist struct {
	UserID    int64     `json:"user_id" db:"user_id"`
	ItemID    int64     `json:"item_id" db:"item_id"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// UserAlert represents a user capability to set price alerts
type UserAlert struct {
	ID                 int64     `json:"id" db:"id"`
	UserID             int64     `json:"user_id" db:"user_id"`
	ItemID             int64     `json:"item_id" db:"item_id"`
	AlertPriceAbove    *int64    `json:"alert_price_above" db:"alert_price_above"`
	AlertPriceBelow    *int64    `json:"alert_price_below" db:"alert_price_below"`
	AlertChangePercent *float64  `json:"alert_change_percent" db:"alert_change_percent"`
	CreatedAt          time.Time `json:"created_at" db:"created_at"`
}

// WebhookPayload represents incoming data from external sources
type WebhookPayload struct {
	Items []WebhookItem `json:"items"`
}

// WebhookItem represents a single item update in a webhook
type WebhookItem struct {
	TornID    int64  `json:"torn_id"`
	Price     int64  `json:"price"`
	Type      string `json:"type"` // "market" or "bazaar"
	SellerID  int64  `json:"seller_id,omitempty"`
	ListingID int64  `json:"listing_id,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
}
