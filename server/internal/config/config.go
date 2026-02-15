package config

import (
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	// Server
	Port        string
	Environment string

	// Database
	DatabaseURL string

	// Torn API
	TornAPIKeys []string
	TornWSURL   string
	TornWSToken string

	// Notifications
	DiscordWebhookURL string

	// Redis
	RedisURL string

	// Workers
	BazaarPollInterval      time.Duration
	BackgroundCrawlInterval time.Duration
	GlobalSyncInterval      time.Duration
	KeyCheckInterval        time.Duration
	MaxConcurrentFetches    int
	BazaarRateLimit         int

	// Alerts
	AlertCooldown  time.Duration
	PriceThreshold float64

	// Security
	EncryptionKey string
}

func Load() (*Config, error) {
	// Try loading from current directory first, then parent.
	// We ignore errors here as we might be running in an environment
	// where env vars are set directly (e.g. docker/k8s).
	_ = godotenv.Load()
	_ = godotenv.Load("../.env")

	cfg := &Config{
		Port:              getEnv("PORT", "8080"),
		Environment:       getEnv("ENVIRONMENT", "development"),
		DatabaseURL:       getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/torn_market?sslmode=disable"),
		TornWSURL:         getEnv("TORN_WS_URL", "wss://ws-centrifugo.torn.com/connection/websocket"),
		TornWSToken:       getEnv("TORN_WS_TOKEN", ""),
		DiscordWebhookURL: getEnv("DISCORD_WEBHOOK_URL", ""),
		RedisURL:          getEnv("REDIS_URL", "redis://127.0.0.1:6379"),

		BazaarPollInterval:      getDurationEnv("BAZAAR_POLL_INTERVAL", 30*time.Second),
		BackgroundCrawlInterval: getDurationEnv("BACKGROUND_CRAWL_INTERVAL", 500*time.Millisecond),
		GlobalSyncInterval:      getDurationEnv("GLOBAL_SYNC_INTERVAL", 24*time.Hour),
		KeyCheckInterval:        getDurationEnv("KEY_CHECK_INTERVAL", 1*time.Hour),
		MaxConcurrentFetches:    getIntEnv("MAX_CONCURRENT_FETCHES", 50),
		BazaarRateLimit:         getIntEnv("BAZAAR_RATE_LIMIT", 1800), // 30 req/s

		AlertCooldown:  getDurationEnv("ALERT_COOLDOWN", 5*time.Minute),
		PriceThreshold: getFloatEnv("PRICE_THRESHOLD", 0.05), // 5% change

		// Key for encrypting API keys in database
		// Default is a 32-byte dummy key for development. IN PRODUCTION, CHANGE THIS!
		EncryptionKey: getEnv("ENCRYPTION_KEY", "dummy_encryption_key_32_bytes_lk"),
	}

	// Parse API keys (comma-separated)
	if keys := os.Getenv("TORN_API_KEYS"); keys != "" {
		cfg.TornAPIKeys = splitAndTrim(keys, ",")
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getIntEnv(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return defaultValue
}

func getFloatEnv(key string, defaultValue float64) float64 {
	if value := os.Getenv(key); value != "" {
		if f, err := strconv.ParseFloat(value, 64); err == nil {
			return f
		}
	}
	return defaultValue
}

func getDurationEnv(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if d, err := time.ParseDuration(value); err == nil {
			return d
		}
	}
	return defaultValue
}

func splitAndTrim(s, sep string) []string {
	var result []string
	for _, part := range splitString(s, sep) {
		trimmed := trimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func splitString(s, sep string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(s); i++ {
		if i+len(sep) <= len(s) && s[i:i+len(sep)] == sep {
			parts = append(parts, s[start:i])
			start = i + len(sep)
			i += len(sep) - 1
		}
	}
	parts = append(parts, s[start:])
	return parts
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}
