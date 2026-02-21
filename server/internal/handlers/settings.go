package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/akagifreeez/torn-market-chart/internal/services"
)

type SettingsHandler struct {
	service *services.SettingsService
}

func NewSettingsHandler(service *services.SettingsService) *SettingsHandler {
	return &SettingsHandler{service: service}
}

func (h *SettingsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.service.GetAll(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

func (h *SettingsHandler) UpdateSetting(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key         string `json:"key"`
		Value       string `json:"value"`
		Description string `json:"description"`
		IsSecret    bool   `json:"is_secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Key == "" {
		http.Error(w, "Key is required", http.StatusBadRequest)
		return
	}

	// Basic validation or filtering could be added here

	if err := h.service.Set(r.Context(), req.Key, req.Value, req.Description, req.IsSecret); err != nil {
		http.Error(w, "Failed to update setting", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status": "updated"}`))
}

// GetUserSettings returns settings for the authenticated user
func (h *SettingsHandler) GetUserSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID, ok := GetUserIDFromContext(ctx)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	keys := []string{"discord_webhook_url", "global_webhook_enabled", "discord_dm_enabled"}
	settings := make(map[string]string)

	for _, key := range keys {
		val, err := h.service.GetForUser(ctx, userID, key, "")
		if err != nil {
			continue
		}
		settings[key] = val
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

// UpdateUserSetting updates a specific setting for the authenticated user
func (h *SettingsHandler) UpdateUserSetting(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID, ok := GetUserIDFromContext(ctx)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	allowedKeys := map[string]bool{
		"discord_webhook_url":    true,
		"global_webhook_enabled": true,
		"discord_dm_enabled":     true,
	}

	if !allowedKeys[req.Key] {
		http.Error(w, "Invalid setting key", http.StatusBadRequest)
		return
	}

	if err := h.service.SetForUser(ctx, userID, req.Key, req.Value); err != nil {
		http.Error(w, "Failed to update setting", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status": "updated"}`))
}
