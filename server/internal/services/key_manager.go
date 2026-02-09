package services

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/akagifreeez/torn-market-chart/internal/config"
	"github.com/akagifreeez/torn-market-chart/internal/models"
	"github.com/akagifreeez/torn-market-chart/pkg/crypto"
	"github.com/akagifreeez/torn-market-chart/pkg/database"
)

type KeyManager struct {
	db  *database.DB
	cfg *config.Config

	// In-memory key pool for crawler
	mu      sync.RWMutex
	pool    []string
	poolIdx uint64
	keyMap  map[string]string // plaintext key -> user_id (string)
}

func NewKeyManager(db *database.DB, cfg *config.Config) *KeyManager {
	km := &KeyManager{
		db:     db,
		cfg:    cfg,
		keyMap: make(map[string]string),
	}
	// Initial load
	km.RefreshPool(context.Background())
	return km
}

// StartAutoRefresh starts a background goroutine to refresh the key pool periodically
func (km *KeyManager) StartAutoRefresh(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				km.RefreshPool(ctx)
			}
		}
	}()
}

func (km *KeyManager) AddKey(ctx context.Context, key, label string) error {
	return fmt.Errorf("manual key management is deprecated; keys are managed via user login")
}

func (km *KeyManager) GetKeys(ctx context.Context) ([]models.ApiKey, error) {
	// Deprecated
	return []models.ApiKey{}, nil
}

func (km *KeyManager) DeleteKey(ctx context.Context, id string) error {
	return fmt.Errorf("manual key management is deprecated")
}

// RefreshPool loads active keys from users table, decrypts them, and updates the in-memory pool
func (km *KeyManager) RefreshPool(ctx context.Context) {
	log.Info().Msg("Refreshing API key pool from users...")

	// Select keys from users table where encrypted_api_key is set
	query := `SELECT id, encrypted_api_key FROM users WHERE encrypted_api_key IS NOT NULL`
	rows, err := km.db.Pool.Query(ctx, query)
	if err != nil {
		log.Error().Err(err).Msg("Failed to query active keys from users")
		return
	}
	defer rows.Close()

	var newPool []string
	newMap := make(map[string]string)

	for rows.Next() {
		var id int64
		var encrypted string
		if err := rows.Scan(&id, &encrypted); err != nil {
			continue
		}

		decrypted, err := crypto.Decrypt(km.cfg.EncryptionKey, encrypted)
		if err != nil {
			log.Error().Err(err).Int64("user_id", id).Msg("Failed to decrypt key")
			continue
		}

		if decrypted != "" {
			newPool = append(newPool, decrypted)
			newMap[decrypted] = fmt.Sprintf("%d", id) // Store user ID as string
		}
	}

	km.mu.Lock()
	km.pool = newPool
	km.keyMap = newMap
	km.mu.Unlock()

	log.Info().Int("count", len(newPool)).Msg("API key pool refreshed")
}

// GetNextKey returns the next available key in round-robin fashion
func (km *KeyManager) GetNextKey() string {
	km.mu.RLock()
	defer km.mu.RUnlock()

	if len(km.pool) == 0 {
		return ""
	}

	idx := atomic.AddUint64(&km.poolIdx, 1)
	return km.pool[idx%uint64(len(km.pool))]
}

// RecordUsage updates usage stats for a key (async)
func (km *KeyManager) RecordUsage(key string, success bool) {
	km.mu.RLock()
	idStr, ok := km.keyMap[key]
	km.mu.RUnlock()

	if !ok {
		return
	}

	// Currently skipping DB usage stats for user keys to avoid complexity/perf impact on user table.
	// Logging failure is enough for now.
	if !success {
		log.Warn().Str("user_id", idStr).Msg("API Key usage failed")
	}
}

// DisableKey marks a key as inactive (e.g. after too many errors)
func (km *KeyManager) DisableKey(key string) {
	km.mu.RLock()
	idStr, ok := km.keyMap[key]
	km.mu.RUnlock()

	if !ok {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		// Remove encrypted key from user record if it's bad
		query := `UPDATE users SET encrypted_api_key = NULL WHERE id = $1`
		_, err := km.db.Pool.Exec(ctx, query, idStr)
		if err == nil {
			log.Warn().Str("user_id", idStr).Msg("Disabled invalid/error-prone API key for user")
			km.RefreshPool(context.Background())
		}
	}()
}

// GetKeyByID retrieves a decrypted key by its ID (deprecated/unused for user keys currently)
func (km *KeyManager) GetKeyByID(ctx context.Context, id string) (string, error) {
	return "", fmt.Errorf("deprecated")
}
