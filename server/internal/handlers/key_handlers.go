package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/akagifreeez/torn-market-chart/internal/services"
	"github.com/akagifreeez/torn-market-chart/pkg/tornapi"
)

type KeyHandler struct {
	keyManager *services.KeyManager
	client     *tornapi.Client
}

func NewKeyHandler(km *services.KeyManager, client *tornapi.Client) *KeyHandler {
	return &KeyHandler{
		keyManager: km,
		client:     client,
	}
}

// RegisterKey adds a new API key
func (h *KeyHandler) RegisterKey(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Key   string `json:"key"`
		Label string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Invalid input", http.StatusBadRequest)
		return
	}

	if input.Key == "" {
		http.Error(w, "Key is required", http.StatusBadRequest)
		return
	}

	if err := h.keyManager.AddKey(r.Context(), input.Key, input.Label); err != nil {
		log.Error().Err(err).Msg("Failed to register key")
		http.Error(w, "Failed to register key", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

// ListKeys returns all registered keys (masked)
func (h *KeyHandler) ListKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := h.keyManager.GetKeys(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("Failed to list keys")
		http.Error(w, "Failed to list keys", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(keys)
}

// DeleteKey removes a key
func (h *KeyHandler) DeleteKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	if err := h.keyManager.DeleteKey(r.Context(), id); err != nil {
		log.Error().Err(err).Str("id", id).Msg("Failed to delete key")
		http.Error(w, "Failed to delete key", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// GetInventory fetches inventory using a stored key
func (h *KeyHandler) GetInventory(w http.ResponseWriter, r *http.Request) {
	// Ideally we should get key ID from the request to know WHICH user's inventory to fetch
	// For now, let's assume we pass the raw key in a header or query param?
	// NO, we want to use the STORED key. So we need the Key ID.

	keyID := r.URL.Query().Get("key_id")
	if keyID == "" {
		http.Error(w, "key_id query parameter is required", http.StatusBadRequest)
		return
	}

	// We need a way to get the decrypted key from KeyManager by ID
	// Currently KeyManager doesn't expose "GetDecryptedKeyByID"
	// Let's implement a quick lookup or just rely on KeyManager internal map?
	// KeyManager's map is Key -> ID. We need ID -> Key.
	// Since KeyManager is designed for Pooling, getting a specific key for inventory is a slightly different use case.
	// We might need to fetch it from DB and decrypt it on the fly.

	// Quick implementation: Fetch from DB and decrypt
	dbKey, err := h.keyManager.GetKeyByID(r.Context(), keyID)
	if err != nil {
		log.Error().Err(err).Str("id", keyID).Msg("Failed to get key by ID")
		http.Error(w, "Failed to get key", http.StatusInternalServerError)
		return
	}

	items, err := h.client.FetchInventoryWithKey(r.Context(), dbKey)
	if err != nil {
		// Check for specific API error message indicating the feature is disabled
		if strings.Contains(err.Error(), "The inventory selection is no longer available") {
			http.Error(w, "Torn API Inventory feature is currently disabled by game developers", http.StatusServiceUnavailable)
			return
		}
		log.Error().Err(err).Msg("Failed to fetch inventory")
		http.Error(w, fmt.Sprintf("Failed to fetch inventory: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}
