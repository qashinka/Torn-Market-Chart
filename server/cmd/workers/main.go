package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/akagifreeez/torn-market-chart/internal/config"
	"github.com/akagifreeez/torn-market-chart/internal/services"
	"github.com/akagifreeez/torn-market-chart/internal/workers"
	"github.com/akagifreeez/torn-market-chart/pkg/database"
	"github.com/akagifreeez/torn-market-chart/pkg/tornapi"
)

func main() {
	// Setup logger
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load configuration")
	}

	log.Info().Str("environment", cfg.Environment).Msg("Starting Torn Market Workers")

	// Create context for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Connect to database
	db, err := database.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to database")
	}
	defer db.Close()

	// Create Torn API client (for GlobalSync and BackgroundCrawler)
	// NewClient now initializes its own RateLimiter internally using "torn_api:rate_limit"
	client := tornapi.NewClient(cfg.TornAPIKeys, cfg.RedisURL)

	// Create services
	keyManager := services.NewKeyManager(db, cfg)
	keyManager.StartAutoRefresh(ctx)
	settingsService := services.NewSettingsService(db.Pool)
	alertService := services.NewAlertService(db.Pool, settingsService, cfg.AlertCooldown, cfg.PriceThreshold)

	// Start a goroutine to update rate limits dynamically
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				limitStr := settingsService.Get(ctx, "api_rate_limit", "100")
				var limit int
				fmt.Sscanf(limitStr, "%d", &limit)
				if limit > 0 {
					client.UpdateRateLimit(limit)
				}
			}
		}
	}()

	// Create Bazaar RateLimiter (separate from API key limits)
	bazaarLimiter, err := tornapi.NewRateLimiter(cfg.RedisURL, cfg.BazaarRateLimit, "bazaar:rate_limit")
	if err != nil {
		log.Warn().Err(err).Msg("Failed to create Bazaar RateLimiter")
		bazaarLimiter = nil
	}

	// Create workers
	globalSync := workers.NewGlobalSync(db.Pool, client, cfg)
	bazaarPoller := workers.NewBazaarPoller(db.Pool, cfg, alertService, bazaarLimiter)  // Uses Weav3r.dev
	backgroundCrawler := workers.NewBackgroundCrawler(db.Pool, client, keyManager, cfg) // Uses Official API v2
	wsService := services.NewTornWebSocketService(cfg, db.Pool, alertService)

	// Start workers in goroutines
	go globalSync.Start(ctx)
	go bazaarPoller.Start(ctx)
	go backgroundCrawler.Start(ctx)
	go wsService.Start(ctx)

	log.Info().Msg("All workers started")

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Info().Msg("Shutdown signal received, stopping workers...")
	cancel()

	log.Info().Msg("Workers stopped")
}
