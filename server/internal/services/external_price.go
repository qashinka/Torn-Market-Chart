package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/rs/zerolog/log"
)

// ExternalPriceClient fetches prices from TornExchange and Weav3r
type ExternalPriceClient struct {
	httpClient *http.Client

	// TornExchange Rate Limiting & Caching
	teLimiter *rate.Limiter
	teCache   sync.Map // map[int64]*teCacheEntry
}

type teCacheEntry struct {
	Price     *TornExchangePrice
	ExpiresAt time.Time
}

// NewExternalPriceClient creates a new client for external price APIs
func NewExternalPriceClient() *ExternalPriceClient {
	return &ExternalPriceClient{
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		// Limit to 10 requests per minute (1 request every 6 seconds) to be safe
		// Allow burst of 1 to strictly enforce spacing
		teLimiter: rate.NewLimiter(rate.Every(6*time.Second), 1),
	}
}

// TornExchangeResponse represents the API response structure
type TornExchangeResponse struct {
	Status string `json:"status"`
	Data   struct {
		ItemName  string `json:"item"`
		TEPrice   int64  `json:"te_price"`
		TornPrice int64  `json:"torn_price"`
	} `json:"data"`
}

// TornExchangePrice represents price data (internal use)
type TornExchangePrice struct {
	ItemID    int64 `json:"item_id"`
	TEPrice   int64 `json:"te_price"`   // TornExchange buy price
	TornPrice int64 `json:"torn_price"` // Torn market reference
}

// Weav3rListing represents a listing from Weav3r API
type Weav3rListing struct {
	Price      int64  `json:"price"`
	Quantity   int64  `json:"quantity"`
	SellerID   int64  `json:"player_id"`   // API returns "player_id" not "seller_id"
	PlayerName string `json:"player_name"` // Player name from Weav3r
}

// Weav3rMarketResponse represents the response from Weav3r marketplace API
type Weav3rMarketResponse struct {
	ItemID   int64           `json:"item_id"`
	Listings []Weav3rListing `json:"listings"`
}

// FetchTornExchangePrice gets the trader price from TornExchange
// Endpoint: GET https://tornexchange.com/api/te_price?item_id={id}
// Implements caching (10 min) and rate limiting (10 req/min)
func (c *ExternalPriceClient) FetchTornExchangePrice(ctx context.Context, itemID int64) (*TornExchangePrice, error) {
	// 1. Check Cache
	if val, ok := c.teCache.Load(itemID); ok {
		entry := val.(*teCacheEntry)
		if time.Now().Before(entry.ExpiresAt) {
			return entry.Price, nil
		}
		// Cache expired, proceed to fetch
		c.teCache.Delete(itemID)
	}

	// 2. Check Rate Limiter
	// Wait until allowed. Context cancellation will abort this.
	if err := c.teLimiter.Wait(ctx); err != nil {
		return nil, fmt.Errorf("rate limiter wait: %w", err)
	}

	// Correct endpoint per Swagger: /api/te_price?item_id={id}
	url := fmt.Sprintf("https://tornexchange.com/api/te_price?item_id=%d", itemID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", "TornMarketChart/1.0")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		// Truncate body to avoid flooding logs with HTML
		errMsg := string(body)
		if len(errMsg) > 200 {
			errMsg = errMsg[:200] + "..."
		}
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, errMsg)
	}

	var response TornExchangeResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if response.Status != "success" {
		return nil, fmt.Errorf("API returned non-success status: %s", response.Status)
	}

	result := &TornExchangePrice{
		ItemID:    itemID, // Not in response data for this endpoint, set manually
		TEPrice:   response.Data.TEPrice,
		TornPrice: response.Data.TornPrice,
	}

	// 3. Update Cache (TTL 10 min)
	c.teCache.Store(itemID, &teCacheEntry{
		Price:     result,
		ExpiresAt: time.Now().Add(10 * time.Minute),
	})

	return result, nil
}

// FetchWeav3rMarketplace gets bazaar listings from Weav3r
// Endpoint: GET https://weav3r.dev/api/marketplace/{item_id}
func (c *ExternalPriceClient) FetchWeav3rMarketplace(ctx context.Context, itemID int64) (*Weav3rMarketResponse, error) {
	url := fmt.Sprintf("https://weav3r.dev/api/marketplace/%d", itemID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "TornMarketChart/1.0")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		// Log rate limit details if available
		log.Warn().
			Str("retry_after", resp.Header.Get("Retry-After")).
			Str("limit_reset", resp.Header.Get("X-RateLimit-Reset")).
			Msg("Rate limited by Weav3r API")
		return nil, fmt.Errorf("rate limited by Weav3r")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	var result Weav3rMarketResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	result.ItemID = itemID
	return &result, nil
}

// GetTraderPriceOverlay fetches external prices for chart overlay
func (c *ExternalPriceClient) GetTraderPriceOverlay(ctx context.Context, itemID int64) (map[string]int64, error) {
	result := make(map[string]int64)

	// Fetch TornExchange price (with rate limit awareness)
	tePrice, err := c.FetchTornExchangePrice(ctx, itemID)
	if err != nil {
		log.Warn().Err(err).Int64("item_id", itemID).Msg("Failed to fetch TornExchange price")
	} else if tePrice.TEPrice > 0 {
		result["tornexchange_buy_price"] = tePrice.TEPrice
		result["torn_market_price"] = tePrice.TornPrice
	}

	// Fetch Weav3r marketplace (for cross-checking)
	weav3rData, err := c.FetchWeav3rMarketplace(ctx, itemID)
	if err != nil {
		log.Warn().Err(err).Int64("item_id", itemID).Msg("Failed to fetch Weav3r marketplace")
	} else if len(weav3rData.Listings) > 0 {
		// Get lowest listing price
		minPrice := weav3rData.Listings[0].Price
		for _, listing := range weav3rData.Listings {
			if listing.Price < minPrice {
				minPrice = listing.Price
			}
		}
		result["weav3r_min_bazaar"] = minPrice
	}

	return result, nil
}

// CheckArbOpportunity checks if there's an arbitrage opportunity
// Returns true if market price < trader buy price
func (c *ExternalPriceClient) CheckArbOpportunity(ctx context.Context, itemID int64, currentMarketPrice int64) (bool, int64, error) {
	tePrice, err := c.FetchTornExchangePrice(ctx, itemID)
	if err != nil {
		return false, 0, err
	}

	if tePrice.TEPrice > 0 && currentMarketPrice < tePrice.TEPrice {
		profit := tePrice.TEPrice - currentMarketPrice
		log.Info().
			Int64("item_id", itemID).
			Int64("market_price", currentMarketPrice).
			Int64("te_buy_price", tePrice.TEPrice).
			Int64("potential_profit", profit).
			Msg("Arbitrage opportunity detected!")
		return true, profit, nil
	}

	return false, 0, nil
}
