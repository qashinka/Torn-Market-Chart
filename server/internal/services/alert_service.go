package services

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// AlertService handles alert deduplication and triggering
type AlertService struct {
	db       *pgxpool.Pool
	settings *SettingsService
	discord  *discordgo.Session
}

// NewAlertService creates a new AlertService with dynamic settings
func NewAlertService(db *pgxpool.Pool, settings *SettingsService, cooldown time.Duration, priceThreshold float64, botToken string) *AlertService {
	var session *discordgo.Session
	if botToken != "" {
		s, err := discordgo.New("Bot " + botToken)
		if err == nil {
			session = s
		} else {
			log.Error().Err(err).Msg("Failed to initialize discordgo session in AlertService")
		}
	}

	return &AlertService{
		db:       db,
		settings: settings,
		discord:  session,
	}
}

// PriceUpdate represents an incoming price update
type PriceUpdate struct {
	ItemID    int64 // This IS the Torn item ID
	ItemName  string
	Price     int64
	Type      string // "market" or "bazaar"
	Quantity  int64
	SellerID  int64
	ListingID int64
}

// AlertState represents the last alert state for deduplication
type AlertState struct {
	LastPrice int64
	LastHash  string
}

// ItemAlertConfig holds the alert configuration for an item
type ItemAlertConfig struct {
	AlertPriceAbove    *int64
	AlertPriceBelow    *int64
	AlertChangePercent *float64
}

// CheckAndTrigger checks if an alert should be triggered for any subscribing users
func (a *AlertService) CheckAndTrigger(ctx context.Context, update PriceUpdate, _ int64) (bool, error) {
	// Generate unique hash for this listing
	currentHash := a.generateHash(update)

	// Fetch all users with alert configurations for this item
	rows, err := a.db.Query(ctx, `
		SELECT ua.user_id, ua.alert_price_above, ua.alert_price_below, ua.alert_change_percent, u.discord_id
		FROM user_alerts ua
		LEFT JOIN users u ON u.id = ua.user_id
		WHERE ua.item_id = $1
	`, update.ItemID)
	if err != nil {
		log.Debug().Err(err).Int64("item_id", update.ItemID).Msg("No alert configs found for item")
		return false, nil
	}
	defer rows.Close()

	anyTriggered := false

	type UserAlert struct {
		UserID             int64
		AlertPriceAbove    *int64
		AlertPriceBelow    *int64
		AlertChangePercent *float64
		DiscordID          *string
	}
	var alerts []UserAlert

	for rows.Next() {
		var ua UserAlert
		if err := rows.Scan(&ua.UserID, &ua.AlertPriceAbove, &ua.AlertPriceBelow, &ua.AlertChangePercent, &ua.DiscordID); err != nil {
			continue
		}
		alerts = append(alerts, ua)
	}

	for _, config := range alerts {
		// Get last alert state for this user/item
		var state AlertState
		err = a.db.QueryRow(ctx, `
			SELECT last_price, last_hash
			FROM alert_states
			WHERE item_id = $1 AND user_id = $2
		`, update.ItemID, config.UserID).Scan(&state.LastPrice, &state.LastHash)

		isNewState := err != nil

		// Check duplicate hash
		if !isNewState && currentHash == state.LastHash {
			continue
		}

		shouldAlert := false
		alertReason := ""

		// Check conditions
		if config.AlertPriceAbove != nil && update.Price >= *config.AlertPriceAbove {
			shouldAlert = true
			alertReason = fmt.Sprintf("Price $%d is above threshold $%d", update.Price, *config.AlertPriceAbove)
		} else if config.AlertPriceBelow != nil && update.Price <= *config.AlertPriceBelow {
			shouldAlert = true
			alertReason = fmt.Sprintf("Price $%d is below threshold $%d", update.Price, *config.AlertPriceBelow)
		} else if config.AlertChangePercent != nil && !isNewState && state.LastPrice > 0 {
			priceDiffPct := math.Abs(float64(update.Price-state.LastPrice)) / float64(state.LastPrice) * 100
			if priceDiffPct >= *config.AlertChangePercent {
				shouldAlert = true
				changeDir := "increased"
				if update.Price < state.LastPrice {
					changeDir = "decreased"
				}
				alertReason = fmt.Sprintf("Price %s by %.1f%% (threshold: %.1f%%)", changeDir, priceDiffPct, *config.AlertChangePercent)
			}
		}

		// Update state regardless of trigger (to track history/dedup)
		// But if we don't alert, maybe we shouldn't update hash?
		// Logic: If it matched criteria but we didn't alert because... wait.

		if shouldAlert {
			anyTriggered = true

			log.Info().
				Int64("item_id", update.ItemID).
				Int64("user_id", config.UserID).
				Int64("price", update.Price).
				Str("reason", alertReason).
				Msg("Alert triggered for user")

			a.updateAlertState(ctx, update, currentHash, config.UserID, isNewState)

			// Send notification
			go func(ua UserAlert, reason string) {
				if err := a.SendAlert(context.Background(), update, reason, ua.UserID, ua.DiscordID); err != nil {
					log.Error().Err(err).Int64("user_id", ua.UserID).Msg("Failed to send alert notification")
				}
			}(config, alertReason)
		} else {
			// Use updateAlertState to keep 'latest seen' up to date?
			// If we don't update key, then next price might be same hash and skipped.
			// If price changed but didn't trigger alert, we DO want to update last_price/hash so next check is against THIS price.
			// BUT legacy logic was:
			// if !shouldAlert { a.updateAlertState(...) return false }
			// So yes, we should update state.
			a.updateAlertState(ctx, update, currentHash, config.UserID, isNewState)
		}
	}

	return anyTriggered, nil
}

func (a *AlertService) updateAlertState(ctx context.Context, update PriceUpdate, hash string, userID int64, isNew bool) {
	var err error
	if isNew {
		_, err = a.db.Exec(ctx, `
			INSERT INTO alert_states (item_id, user_id, last_price, last_hash, last_triggered_at)
			VALUES ($1, $2, $3, $4, $5)
		`, update.ItemID, userID, update.Price, hash, time.Now())
	} else {
		_, err = a.db.Exec(ctx, `
			UPDATE alert_states
			SET last_price = $1, last_hash = $2, last_triggered_at = $3
			WHERE item_id = $4 AND user_id = $5
		`, update.Price, hash, time.Now(), update.ItemID, userID)
	}
	if err != nil {
		log.Error().Err(err).Int64("item_id", update.ItemID).Msg("Failed to update alert state")
	}
}

// generateHash creates a unique hash for deduplication
func (a *AlertService) generateHash(update PriceUpdate) string {
	// Include available identifiers for more accurate deduplication
	data := fmt.Sprintf("%d:%d:%d:%d", update.ItemID, update.Price, update.SellerID, update.ListingID)
	hash := md5.Sum([]byte(data))
	return hex.EncodeToString(hash[:])
}

// SendAlert sends the actual alert notification to Discord via Webhook and/or DM
func (a *AlertService) SendAlert(ctx context.Context, update PriceUpdate, reason string, userID int64, discordID *string) error {
	// 1. Determine Color based on alert type
	color := 0xFFA500 // Orange default

	// 2. Determine URL based on source type
	var alertURL string
	if update.Type == "bazaar" && update.SellerID > 0 {
		alertURL = fmt.Sprintf("https://www.torn.com/bazaar.php?userId=%d#/", update.SellerID)
	} else {
		alertURL = fmt.Sprintf("https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=%d", update.ItemID)
	}

	// 3. Create Embed Map for Webhook
	embedMap := map[string]interface{}{
		"title": fmt.Sprintf("🚨 Price Alert: %s", update.ItemName),
		"url":   alertURL,
		"color": color,
		"fields": []map[string]interface{}{
			{
				"name":   "Price",
				"value":  fmt.Sprintf("$%d", update.Price),
				"inline": true,
			},
			{
				"name":   "Quantity",
				"value":  fmt.Sprintf("%d", update.Quantity),
				"inline": true,
			},
			{
				"name":   "Source",
				"value":  update.Type,
				"inline": true,
			},
			{
				"name":   "Trigger",
				"value":  reason,
				"inline": false,
			},
		},
		"footer": map[string]interface{}{
			"text": "Torn Market Chart Bot",
		},
		"timestamp": time.Now().Format(time.RFC3339),
	}

	if update.SellerID > 0 {
		embedMap["fields"] = append(embedMap["fields"].([]map[string]interface{}), map[string]interface{}{
			"name":   "Seller ID",
			"value":  fmt.Sprintf("[%d](https://www.torn.com/profiles.php?XID=%d)", update.SellerID, update.SellerID),
			"inline": true,
		})
	}

	// Content for desktop notifications
	content := fmt.Sprintf("🚨 **%s** - Price: $%d, Qty: %d", update.ItemName, update.Price, update.Quantity)

	// 4. Send Global Webhook if configured and enabled
	webhookEnabled, _ := a.settings.GetForUser(ctx, userID, "global_webhook_enabled", "true")
	if webhookEnabled != "false" {
		webhookURL, err := a.settings.GetForUser(ctx, userID, "discord_webhook_url", "")
		if err == nil && webhookURL != "" {
			payload := map[string]interface{}{
				"content": content,
				"embeds":  []interface{}{embedMap},
			}

			jsonData, err := json.Marshal(payload)
			if err == nil {
				req, err := http.NewRequestWithContext(ctx, "POST", webhookURL, bytes.NewBuffer(jsonData))
				if err == nil {
					req.Header.Set("Content-Type", "application/json")
					client := &http.Client{Timeout: 10 * time.Second}
					resp, err := client.Do(req)
					if err == nil {
						resp.Body.Close()
					}
				}
			}
		}
	}

	// 5. Send Discord DM if Discord ID is present, bot is configured, and enabled
	dmEnabled, _ := a.settings.GetForUser(ctx, userID, "discord_dm_enabled", "true")
	if dmEnabled != "false" && discordID != nil && *discordID != "" && a.discord != nil {
		// Create the discordgo Embed struct
		discordgoFields := []*discordgo.MessageEmbedField{
			{Name: "Price", Value: fmt.Sprintf("$%d", update.Price), Inline: true},
			{Name: "Quantity", Value: fmt.Sprintf("%d", update.Quantity), Inline: true},
			{Name: "Source", Value: update.Type, Inline: true},
			{Name: "Trigger", Value: reason, Inline: false},
		}

		if update.SellerID > 0 {
			discordgoFields = append(discordgoFields, &discordgo.MessageEmbedField{
				Name:   "Seller ID",
				Value:  fmt.Sprintf("[%d](https://www.torn.com/profiles.php?XID=%d)", update.SellerID, update.SellerID),
				Inline: true,
			})
		}

		discordEmbed := &discordgo.MessageEmbed{
			Title:     fmt.Sprintf("🚨 Price Alert: %s", update.ItemName),
			URL:       alertURL,
			Color:     color,
			Fields:    discordgoFields,
			Footer:    &discordgo.MessageEmbedFooter{Text: "Torn Market Chart Bot"},
			Timestamp: time.Now().Format(time.RFC3339),
		}

		// Create channel and send
		channel, err := a.discord.UserChannelCreate(*discordID)
		if err != nil {
			log.Error().Err(err).Str("discord_id", *discordID).Msg("Failed to create DM channel")
			return err
		}

		_, err = a.discord.ChannelMessageSendComplex(channel.ID, &discordgo.MessageSend{
			Content: content,
			Embeds:  []*discordgo.MessageEmbed{discordEmbed},
		})
		if err != nil {
			log.Error().Err(err).Str("discord_id", *discordID).Msg("Failed to send DM message")
			return err
		}
	}

	return nil
}
