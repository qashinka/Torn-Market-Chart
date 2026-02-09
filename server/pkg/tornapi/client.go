package tornapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// Client wraps Torn API calls with key rotation and rate limiting
type Client struct {
	httpClient *http.Client
	keys       []string
	keyIndex   int
	mu         sync.Mutex
	baseURL    string
	limiter    *RateLimiter
}

// NewClient creates a new Torn API client
func NewClient(apiKeys []string, redisURL string) *Client {
	// Initialize RateLimiter
	var limiter *RateLimiter
	if redisURL != "" {
		l, err := NewRateLimiter(redisURL, 100, "torn_api:rate_limit") // Default 100 req/min
		if err != nil {
			log.Error().Err(err).Msg("Failed to initialize RateLimiter, proceeding without limits")
		} else {
			limiter = l
			log.Info().Msg("RateLimiter initialized")
		}
	}

	return &Client{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		keys:    apiKeys,
		baseURL: "https://api.torn.com",
		limiter: limiter,
	}
}

// UpdateRateLimit updates the rate limiter target
func (c *Client) UpdateRateLimit(limit int) {
	if c.limiter != nil {
		c.limiter.SetLimit(limit)
	}
}

// getNextKey rotates to the next available API key
func (c *Client) getNextKey() string {
	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.keys) == 0 {
		return ""
	}

	key := c.keys[c.keyIndex]
	c.keyIndex = (c.keyIndex + 1) % len(c.keys)
	return key
}

// getKeyCount returns the number of active keys
func (c *Client) getKeyCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.keys)
}

// waitRateLimit blocks until a request is allowed
func (c *Client) waitRateLimit(ctx context.Context) error {
	if c.limiter == nil {
		return nil
	}
	keyCount := c.getKeyCount()
	if keyCount == 0 {
		keyCount = 1 // Prevent potential division/logic errors, though getNextKey would fail anyway
	}
	return c.limiter.WaitForTicket(ctx, keyCount)
}

// TornItem represents an item from the Torn API
type TornItem struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Type        string `json:"type"`
	Circulation int64  `json:"circulation"`
	MarketValue int64  `json:"market_value"`
}

// TornItemsResponse represents the response from torn/items endpoint
type TornItemsResponse struct {
	Items map[string]TornItem `json:"items"`
}

// TornMarketListing represents a single market listing
type TornMarketListing struct {
	Cost     int64 `json:"cost"`
	Quantity int64 `json:"quantity"`
}

// TornMarketV2Listing represents a listing in API v2 format
type TornMarketV2Listing struct {
	ID       int64 `json:"id"`
	Price    int64 `json:"price"`
	Quantity int64 `json:"quantity"`
	UserID   int64 `json:"user_id,omitempty"`
}

// TornMarketV2Section represents itemmarket or bazaar section in v2
type TornMarketV2Section struct {
	Item struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	} `json:"item"`
	Listings []TornMarketV2Listing `json:"listings"`
}

// UnmarshalJSON handles the case where Torn API returns an empty array [] instead of an object
func (s *TornMarketV2Section) UnmarshalJSON(data []byte) error {
	// If it's an array (likely empty), we treat it as an empty section
	if len(data) > 0 && data[0] == '[' {
		return nil
	}

	// Define a type alias to avoid infinite recursion
	type Alias TornMarketV2Section
	var a Alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*s = TornMarketV2Section(a)
	return nil
}

// TornMarketResponse represents the response from market endpoint (API v2)
type TornMarketResponse struct {
	// API v2 format
	ItemMarket *TornMarketV2Section `json:"itemmarket,omitempty"`
	Bazaar     *TornMarketV2Section `json:"bazaar,omitempty"`
}

// FetchAllItems retrieves the complete item catalog
func (c *Client) FetchAllItems(ctx context.Context) (map[int64]TornItem, error) {
	if err := c.waitRateLimit(ctx); err != nil {
		return nil, err
	}

	key := c.getNextKey()
	if key == "" {
		return nil, fmt.Errorf("no API keys available")
	}

	url := fmt.Sprintf("%s/torn/?selections=items&key=%s", c.baseURL, key)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch items: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var response TornItemsResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Convert map keys to int64
	result := make(map[int64]TornItem, len(response.Items))
	for idStr, item := range response.Items {
		var id int64
		fmt.Sscanf(idStr, "%d", &id)
		item.ID = id
		result[id] = item
	}

	log.Info().Int("count", len(result)).Msg("Fetched item catalog from Torn API")
	return result, nil
}

// FetchMarketPrice retrieves the current market price for an item
func (c *Client) FetchMarketPrice(ctx context.Context, itemID int64) (*TornMarketResponse, error) {
	key := c.getNextKey()
	if key == "" {
		return nil, fmt.Errorf("no API keys available")
	}
	return c.FetchMarketPriceWithKey(ctx, itemID, key)
}

// FetchMarketPriceWithKey retrieves the current market price using a specific key
func (c *Client) FetchMarketPriceWithKey(ctx context.Context, itemID int64, key string) (*TornMarketResponse, error) {
	if err := c.waitRateLimit(ctx); err != nil {
		return nil, err
	}

	// API v2 is required for itemmarket and bazaar selections
	url := fmt.Sprintf("https://api.torn.com/v2/market/%d?selections=itemmarket,bazaar&key=%s", itemID, key)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch market data: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("item not found: %d", itemID)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	var response TornMarketResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &response, nil
}

// TornInventoryItem represents an item in user's inventory
type TornInventoryItem struct {
	ID          int64  `json:"ID"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Quantity    int64  `json:"quantity"`
	MarketPrice int64  `json:"market_price"`
}

// TornInventoryResponse represents the response from user/inventory endpoint
type TornInventoryResponse struct {
	Inventory map[string]TornInventoryItem `json:"inventory"`
}

// FetchInventoryWithKey retrieves the user's inventory using a specific key
func (c *Client) FetchInventoryWithKey(ctx context.Context, key string) ([]TornInventoryItem, error) {
	if err := c.waitRateLimit(ctx); err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/user/?selections=inventory&key=%s", c.baseURL, key)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch inventory: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	// Debug logging
	// log.Debug().Str("body", string(body)).Msg("Inventory response") // Uncomment if needed, but might be huge

	// Helper struct to handle potential empty array response for inventory
	type rawResponse struct {
		Inventory json.RawMessage `json:"inventory"`
	}
	var raw rawResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		log.Error().Str("body", string(body)).Err(err).Msg("Failed to parse raw inventory response")
		return nil, fmt.Errorf("failed to parse response structure: %w", err)
	}

	// Check if inventory is empty (array []) or map
	if len(raw.Inventory) > 0 && raw.Inventory[0] == '[' {
		return []TornInventoryItem{}, nil
	}

	// Check if inventory is a string (e.g. error message)
	if len(raw.Inventory) > 0 && raw.Inventory[0] == '"' {
		var errorMsg string
		if err := json.Unmarshal(raw.Inventory, &errorMsg); err == nil {
			return nil, fmt.Errorf("inventory API returned message: %s", errorMsg)
		}
	}

	var invMap map[string]TornInventoryItem
	if err := json.Unmarshal(raw.Inventory, &invMap); err != nil {
		log.Error().Str("raw_inventory", string(raw.Inventory)).Err(err).Msg("Failed to parse inventory map")
		return nil, fmt.Errorf("failed to parse inventory map: %w", err)
	}

	var items []TornInventoryItem
	for _, item := range invMap {
		items = append(items, item)
	}

	return items, nil
}
