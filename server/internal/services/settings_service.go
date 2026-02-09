package services

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// Setting represents a system configuration entry
type Setting struct {
	Key         string    `json:"key"`
	Value       string    `json:"value"`
	Description string    `json:"description"`
	IsSecret    bool      `json:"is_secret"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// SettingsService handles database-backed configuration
type SettingsService struct {
	db    *pgxpool.Pool
	cache map[string]string
	mu    sync.RWMutex
}

// NewSettingsService creates a new service and initializes the schema
func NewSettingsService(db *pgxpool.Pool) *SettingsService {
	s := &SettingsService{
		db:    db,
		cache: make(map[string]string),
	}
	s.initSchema()
	s.loadCache()
	return s
}

// initSchema creates the settings table if it doesn't exist
func (s *SettingsService) initSchema() {
	ctx := context.Background()
	query := `
	CREATE TABLE IF NOT EXISTS system_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		description TEXT,
		is_secret BOOLEAN DEFAULT FALSE,
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS user_settings (
		user_id BIGINT REFERENCES users(id),
		key TEXT NOT NULL,
		value TEXT NOT NULL,
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		PRIMARY KEY (user_id, key)
	);
	`
	_, err := s.db.Exec(ctx, query)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to create settings tables")
	}
}

// ... Get, Set, GetAll, GetRaw etc ...

// GetForUser returns a setting value for a specific user
func (s *SettingsService) GetForUser(ctx context.Context, userID int64, key string, defaultValue string) (string, error) {
	var value string
	err := s.db.QueryRow(ctx, "SELECT value FROM user_settings WHERE user_id = $1 AND key = $2", userID, key).Scan(&value)
	if err != nil {
		if err == pgx.ErrNoRows {
			return defaultValue, nil
		}
		return "", err
	}
	return value, nil
}

// SetForUser updates a user-specific setting
func (s *SettingsService) SetForUser(ctx context.Context, userID int64, key, value string) error {
	query := `
		INSERT INTO user_settings (user_id, key, value, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id, key) DO UPDATE 
		SET value = EXCLUDED.value, 
		    updated_at = NOW()
	`
	_, err := s.db.Exec(ctx, query, userID, key, value)
	return err
}

// loadCache loads all settings into memory
func (s *SettingsService) loadCache() {
	ctx := context.Background()
	rows, err := s.db.Query(ctx, "SELECT key, value FROM system_settings")
	if err != nil {
		log.Error().Err(err).Msg("Failed to load settings cache")
		return
	}
	defer rows.Close()

	s.mu.Lock()
	defer s.mu.Unlock()

	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		s.cache[key] = value
	}
}

// Get returns a setting value, checking cache first
func (s *SettingsService) Get(ctx context.Context, key string, defaultValue string) string {
	s.mu.RLock()
	val, ok := s.cache[key]
	s.mu.RUnlock()

	if ok {
		return val
	}
	return defaultValue
}

// Set updates a setting in DB and cache
func (s *SettingsService) Set(ctx context.Context, key, value, description string, isSecret bool) error {
	query := `
		INSERT INTO system_settings (key, value, description, is_secret, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (key) DO UPDATE 
		SET value = EXCLUDED.value, 
		    description = EXCLUDED.description,
			is_secret = EXCLUDED.is_secret,
		    updated_at = NOW()
	`
	_, err := s.db.Exec(ctx, query, key, value, description, isSecret)
	if err != nil {
		return err
	}

	s.mu.Lock()
	s.cache[key] = value
	s.mu.Unlock()

	return nil
}

// GetAll returns all settings (masking secrets)
func (s *SettingsService) GetAll(ctx context.Context) ([]Setting, error) {
	rows, err := s.db.Query(ctx, "SELECT key, value, description, is_secret, updated_at FROM system_settings ORDER BY key")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var settings []Setting
	for rows.Next() {
		var st Setting
		if err := rows.Scan(&st.Key, &st.Value, &st.Description, &st.IsSecret, &st.UpdatedAt); err != nil {
			return nil, err
		}
		if st.IsSecret {
			st.Value = "********" // Mask secret values
		}
		settings = append(settings, st)
	}
	return settings, nil
}

// GetDecrypted returns the actual value for a specific key (internal use)
func (s *SettingsService) GetRaw(ctx context.Context, key string) (string, error) {
	var value string
	err := s.db.QueryRow(ctx, "SELECT value FROM system_settings WHERE key = $1", key).Scan(&value)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	return value, nil
}
