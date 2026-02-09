package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/akagifreeez/torn-market-chart/internal/config"
	"github.com/akagifreeez/torn-market-chart/internal/models"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

const (
	ReconnectInterval = 10 * time.Second
	SubscriptionBatch = 10 // Interval between subscription batches
)

type TornWebSocketService struct {
	config       *config.Config
	db           *pgxpool.Pool
	alertService *AlertService
	conn         *websocket.Conn
	mu           sync.Mutex
	subscribed   map[int64]bool // itemID -> true
	running      bool
}

func NewTornWebSocketService(cfg *config.Config, db *pgxpool.Pool, alertService *AlertService) *TornWebSocketService {
	return &TornWebSocketService{
		config:       cfg,
		db:           db,
		alertService: alertService,
		subscribed:   make(map[int64]bool),
	}
}

func (s *TornWebSocketService) Start(ctx context.Context) {
	s.running = true
	log.Info().Msg("Starting Torn WebSocket Service...")

	for s.running {
		select {
		case <-ctx.Done():
			return
		default:
			if err := s.run(ctx); err != nil {
				log.Error().Err(err).Msg("WebSocket service error, restarting in 10s...")
			}
			// Wait before reconnecting
			select {
			case <-ctx.Done():
				return
			case <-time.After(ReconnectInterval):
				continue
			}
		}
	}
}

func (s *TornWebSocketService) run(ctx context.Context) error {
	token := s.config.TornWSToken
	if token == "" {
		return fmt.Errorf("TORN_WS_TOKEN is not set")
	}

	log.Info().Str("url", s.config.TornWSURL).Msg("Connecting to Torn WebSocket...")

	conn, _, err := websocket.DefaultDialer.Dial(s.config.TornWSURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	s.mu.Lock()
	s.conn = conn
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		if s.conn != nil {
			s.conn.Close()
			s.conn = nil
		}
		s.mu.Unlock()
	}()

	// Configure KeepAlive
	conn.SetReadLimit(512 * 1024) // 512KB
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Start Ping Loop
	go func() {
		pingTicker := time.NewTicker(50 * time.Second) // Send ping every 50s
		defer pingTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-pingTicker.C:
				s.mu.Lock()
				if s.conn == nil {
					s.mu.Unlock()
					return
				}
				err := s.conn.WriteMessage(websocket.PingMessage, []byte{})
				s.mu.Unlock()
				if err != nil {
					log.Warn().Err(err).Msg("Failed to send ping")
					return
				}
			}
		}
	}()

	// Authenticate
	authPayload := map[string]interface{}{
		"connect": map[string]string{
			"token": token,
			"name":  "js",
		},
		"id": 1,
	}
	if err := conn.WriteJSON(authPayload); err != nil {
		return fmt.Errorf("auth send failed: %w", err)
	}

	// Read auth response
	var authResponse map[string]interface{}
	if err := conn.ReadJSON(&authResponse); err != nil {
		return fmt.Errorf("auth read failed: %w", err)
	}

	if errVal, ok := authResponse["error"]; ok && errVal != nil {
		return fmt.Errorf("auth failed: %v", errVal)
	}
	log.Info().Msg("WebSocket authenticated successfully")

	// Subscribe to watched items
	if err := s.SubscribeWatchedItems(ctx); err != nil {
		log.Error().Err(err).Msg("Failed to subscribe to watched items")
	}

	// Start sync loop for dynamic subscriptions (every 60s)
	go s.syncSubscriptionsLoop(ctx)

	// Listen loop
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
			var msg map[string]interface{}
			if err := conn.ReadJSON(&msg); err != nil {
				return fmt.Errorf("read error: %w", err)
			}
			s.handleMessage(ctx, msg)
		}
	}
}

func (s *TornWebSocketService) SubscribeWatchedItems(ctx context.Context) error {
	// Fetch items where is_watched = true (User requirement)
	rows, err := s.db.Query(ctx, "SELECT id, id FROM items WHERE is_watched = true")
	if err != nil {
		return err
	}
	defer rows.Close()

	var items []int64
	for rows.Next() {
		var id, tornID int64 // currently id == tornID
		if err := rows.Scan(&id, &tornID); err != nil {
			continue
		}
		items = append(items, id)
	}

	log.Info().Int("count", len(items)).Msg("Subscribing to watched items...")

	for i, id := range items {
		if err := s.subscribe(id); err != nil {
			log.Error().Err(err).Int64("id", id).Msg("Failed to subscribe")
		}
		if i > 0 && i%10 == 0 {
			time.Sleep(100 * time.Millisecond) // Rate limit protection
		}
	}
	return nil
}

func (s *TornWebSocketService) subscribe(id int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.conn == nil {
		return fmt.Errorf("no connection")
	}
	if s.subscribed[id] {
		return nil // Already subscribed
	}

	channel := fmt.Sprintf("item-market_%d", id)
	payload := map[string]interface{}{
		"subscribe": map[string]string{
			"channel": channel,
		},
		"id": id + 1000,
	}

	if err := s.conn.WriteJSON(payload); err != nil {
		return err
	}

	s.subscribed[id] = true
	return nil
}

func (s *TornWebSocketService) syncSubscriptionsLoop(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Refresh subscriptions based on DB state
			if err := s.SubscribeWatchedItems(ctx); err != nil {
				log.Error().Err(err).Msg("Periodic subscription sync failed")
			}
		}
	}
}

func (s *TornWebSocketService) handleMessage(ctx context.Context, data map[string]interface{}) {
	// Parse Centrifugo push message
	// expected: push -> pub -> data -> message -> namespace="item-market", action="update"
	push, ok := data["push"].(map[string]interface{})
	if !ok {
		// Log if it's not a push message (e.g. connect response or other control msg) but we expect those to be handled earlier or ignored
		return
	}
	pub, ok := push["pub"].(map[string]interface{})
	if !ok {
		return
	}
	pubData, ok := pub["data"].(map[string]interface{})
	if !ok {
		return
	}
	message, ok := pubData["message"].(map[string]interface{})
	if !ok {
		return
	}

	namespace, _ := message["namespace"].(string)
	action, _ := message["action"].(string)

	if namespace == "item-market" && action == "update" {
		updates, ok := message["data"].([]interface{})
		if !ok {
			return
		}

		for _, updateFunc := range updates {
			update, ok := updateFunc.(map[string]interface{})
			if !ok {
				continue
			}

			// Extract data
			// itemID in WS is TornID. Since our ID mirrors TornID:
			tornIDFloat, _ := update["itemID"].(float64)
			tornID := int64(tornIDFloat)

			minPriceFloat, _ := update["minPrice"].(float64)
			minPrice := int64(minPriceFloat)

			// Try to get quantity if available
			quantity := int64(1)
			if qtyFloat, ok := update["quantity"].(float64); ok {
				quantity = int64(qtyFloat)
			}

			if tornID > 0 && minPrice > 0 {
				s.processUpdate(ctx, tornID, minPrice, quantity)
			}
		}
	}
}

func (s *TornWebSocketService) processUpdate(ctx context.Context, id int64, price int64, quantity int64) {
	log.Info().Int64("id", id).Int64("price", price).Int64("qty", quantity).Msg("WS Update received")

	now := time.Now()

	// Insert into market_prices for historical data
	_, err := s.db.Exec(ctx, `
		INSERT INTO market_prices (time, item_id, price, quantity)
		VALUES ($1, $2, $3, $4)
	`, now, id, price, quantity)
	if err != nil {
		log.Warn().Err(err).Int64("id", id).Msg("Failed to insert market price from WS")
	}

	// Update items cache
	_, err = s.db.Exec(ctx, `
		UPDATE items 
		SET last_market_price = $1, last_updated_at = $2
		WHERE id = $3
	`, price, now, id)

	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("Failed to update market price from WS")
		return
	}

	// Fetch item for alert check
	// We need Name and Bazaar price for the alert payload
	var item models.Item
	err = s.db.QueryRow(ctx, "SELECT id, name, last_bazaar_price FROM items WHERE id = $1", id).
		Scan(&item.ID, &item.Name, &item.LastBazaarPrice)

	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("Failed to fetch item for alert check")
		return
	}

	// Trigger Alert
	update := PriceUpdate{
		ItemID:    item.ID,
		ItemName:  item.Name,
		Price:     price,
		Type:      "market",
		Quantity:  quantity,
		SellerID:  0, // WS doesn't provide seller
		ListingID: 0, // WS doesn't provide listing ID
	}

	triggered, err := s.alertService.CheckAndTrigger(ctx, update, 0) // UserID 0 for global alerts?
	if err != nil {
		log.Error().Err(err).Msg("Alert check failed")
	}
	if triggered {
		log.Info().Int64("id", id).Int64("price", price).Msg("Alert triggered via WebSocket!")
	}
}
