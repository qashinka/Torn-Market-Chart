package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/akagifreeez/torn-market-chart/pkg/database"
	"github.com/go-chi/chi/v5"
)

// BotInternalHandler provides endpoints for the Discord bot to manage
// users' data (like alerts) securely via a shared secret.
type BotInternalHandler struct {
	db *database.DB
}

func NewBotInternalHandler(db *database.DB) *BotInternalHandler {
	return &BotInternalHandler{db: db}
}

// GetUserAlerts returns all alerts for a given Discord User ID
// GET /api/v1/bot/alerts/{discord_id}
func (h *BotInternalHandler) GetUserAlerts(w http.ResponseWriter, r *http.Request) {
	discordID := chi.URLParam(r, "discord_id")

	// 1. Get our internal user ID from the Discord ID
	var userID int64
	err := h.db.Pool.QueryRow(r.Context(), "SELECT id FROM users WHERE discord_id = $1", discordID).Scan(&userID)
	if err != nil {
		http.Error(w, "User not found or not linked to Discord", http.StatusNotFound)
		return
	}

	// 2. Fetch all alerts for this user, including item names
	query := `
		SELECT 
			ua.item_id, i.name, ua.alert_price_above, ua.alert_price_below, ua.alert_change_percent
		FROM user_alerts ua
		JOIN items i ON ua.item_id = i.id
		WHERE ua.user_id = $1
		ORDER BY i.name ASC
	`

	rows, err := h.db.Pool.Query(r.Context(), query, userID)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type UserAlert struct {
		ItemID             int64    `json:"item_id"`
		ItemName           string   `json:"item_name"`
		AlertPriceAbove    *int64   `json:"alert_price_above"`
		AlertPriceBelow    *int64   `json:"alert_price_below"`
		AlertChangePercent *float64 `json:"alert_change_percent"`
	}

	var alerts []UserAlert
	for rows.Next() {
		var a UserAlert
		if err := rows.Scan(&a.ItemID, &a.ItemName, &a.AlertPriceAbove, &a.AlertPriceBelow, &a.AlertChangePercent); err == nil {
			alerts = append(alerts, a)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(alerts)
}

// AddOrUpdateAlert adds or updates an alert for a given Discord User ID
// POST /api/v1/bot/alerts/{discord_id}
func (h *BotInternalHandler) AddOrUpdateAlert(w http.ResponseWriter, r *http.Request) {
	discordID := chi.URLParam(r, "discord_id")

	var userID int64
	err := h.db.Pool.QueryRow(r.Context(), "SELECT id FROM users WHERE discord_id = $1", discordID).Scan(&userID)
	if err != nil {
		http.Error(w, "User not found or not linked to Discord", http.StatusNotFound)
		return
	}

	type AlertRequest struct {
		ItemID             int64    `json:"item_id"`
		AlertPriceAbove    *int64   `json:"alert_price_above"`
		AlertPriceBelow    *int64   `json:"alert_price_below"`
		AlertChangePercent *float64 `json:"alert_change_percent"`
	}

	var req AlertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	_, err = h.db.Pool.Exec(r.Context(), `
		INSERT INTO user_alerts (user_id, item_id, alert_price_above, alert_price_below, alert_change_percent, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (user_id, item_id) DO UPDATE 
		SET alert_price_above = $3, alert_price_below = $4, alert_change_percent = $5
	`, userID, req.ItemID, req.AlertPriceAbove, req.AlertPriceBelow, req.AlertChangePercent)

	if err != nil {
		http.Error(w, "Failed to update alert settings", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// DeleteAlert removes an alert for a given Discord User ID
// DELETE /api/v1/bot/alerts/{discord_id}/items/{item_id}
func (h *BotInternalHandler) DeleteAlert(w http.ResponseWriter, r *http.Request) {
	discordID := chi.URLParam(r, "discord_id")
	itemIDStr := chi.URLParam(r, "item_id")
	itemID, err := strconv.ParseInt(itemIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	var userID int64
	err = h.db.Pool.QueryRow(r.Context(), "SELECT id FROM users WHERE discord_id = $1", discordID).Scan(&userID)
	if err != nil {
		http.Error(w, "User not found or not linked to Discord", http.StatusNotFound)
		return
	}

	_, err = h.db.Pool.Exec(r.Context(), "DELETE FROM user_alerts WHERE user_id = $1 AND item_id = $2", userID, itemID)
	if err != nil {
		http.Error(w, "Failed to delete alert", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
