package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/akagifreeez/torn-market-chart/internal/config"
	"github.com/akagifreeez/torn-market-chart/internal/handlers"
	"github.com/akagifreeez/torn-market-chart/internal/services"
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

	log.Info().Str("environment", cfg.Environment).Msg("Starting Torn Market Chart API")

	// Create context for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Connect to database
	db, err := database.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to database")
	}
	defer db.Close()

	// Run migrations
	log.Info().Msg("Running database migrations...")
	if err := db.Migrate(ctx); err != nil {
		log.Fatal().Err(err).Msg("Failed to run migrations")
	}
	log.Info().Msg("Migrations completed successfully")

	// Setup router
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	// CORS
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-CSRF-Token")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Initialize services
	keyManager := services.NewKeyManager(db, cfg)
	settingsService := services.NewSettingsService(db.Pool)
	seedSettings(ctx, settingsService, cfg)

	// Initialize Torn API Client for Inventory Fetch
	client := tornapi.NewClient(cfg.TornAPIKeys, cfg.RedisURL)

	// Initialize handlers
	priceHandler := handlers.NewPriceHandler(db)
	webhookHandler := handlers.NewWebhookHandler(db)
	settingsHandler := handlers.NewSettingsHandler(settingsService)
	keyHandler := handlers.NewKeyHandler(keyManager, client)
	authHandler := handlers.NewAuthHandler(db, cfg)

	// API routes
	r.Route("/api/v1", func(r chi.Router) {
		// Public Routes
		r.Post("/auth/login", authHandler.Login)

		// Items (Public Read)
		r.With(handlers.OptionalAuthMiddleware).Get("/items", priceHandler.ListTracked)
		r.With(handlers.OptionalAuthMiddleware).Get("/items/search", priceHandler.SearchItems)
		r.Get("/items/{id}/history", priceHandler.GetHistory)
		r.With(handlers.OptionalAuthMiddleware).Get("/items/{id}/latest", priceHandler.GetLatest)
		r.Get("/items/{id}/external-prices", priceHandler.GetExternalPrices)
		r.Get("/items/{id}/listings", priceHandler.GetTopListings)

		// Protected Routes
		r.Group(func(r chi.Router) {
			r.Use(handlers.AuthMiddleware)

			// Auth
			r.Get("/auth/me", authHandler.GetMe)

			// User Watchlist & Alerts
			r.Get("/items/watched", priceHandler.ListWatched) // Now returns user-specific list
			r.Post("/items/{id}/watch", priceHandler.ToggleWatchlist)
			r.Put("/items/{id}/alerts", priceHandler.UpdateAlertSettings)

			// User Inventory
			r.Get("/user/inventory", keyHandler.GetInventory)

			// User Settings
			r.Get("/user/settings", settingsHandler.GetUserSettings)
			r.Put("/user/settings", settingsHandler.UpdateUserSetting)

			// Settings (Admin/System - could be further restricted later)
			r.Route("/settings", func(r chi.Router) {
				r.Get("/", settingsHandler.GetSettings)
				r.Put("/", settingsHandler.UpdateSetting)

				// Key Management
				r.Route("/keys", func(r chi.Router) {
					r.Get("/", keyHandler.ListKeys)
					r.Post("/", keyHandler.RegisterKey)
					r.Delete("/{id}", keyHandler.DeleteKey)
				})
			})
		})
	})

	// Webhook endpoint (separate from versioned API)
	r.Post("/api/webhook/update", webhookHandler.HandleUpdate)

	// Start server
	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		log.Info().Msg("Shutting down server...")
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Error().Err(err).Msg("Server shutdown error")
		}
		cancel()
	}()

	log.Info().Str("port", cfg.Port).Msg("Server listening")
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal().Err(err).Msg("Server error")
	}

	log.Info().Msg("Server stopped")
}

func seedSettings(ctx context.Context, s *services.SettingsService, cfg *config.Config) {
	// Seed TORN_API_KEY
	if val := s.Get(ctx, "TORN_API_KEY", "NOT_SET"); val == "NOT_SET" {
		log.Info().Msg("Seeding TORN_API_KEY")
		initialVal := ""
		if len(cfg.TornAPIKeys) > 0 {
			initialVal = strings.Join(cfg.TornAPIKeys, ",")
		}
		s.Set(ctx, "TORN_API_KEY", initialVal, "Torn API Keys (Comma separated)", true)
	}

	// Seed DISCORD_WEBHOOK_URL
	if val := s.Get(ctx, "DISCORD_WEBHOOK_URL", "NOT_SET"); val == "NOT_SET" {
		log.Info().Msg("Seeding DISCORD_WEBHOOK_URL")
		s.Set(ctx, "DISCORD_WEBHOOK_URL", cfg.DiscordWebhookURL, "Discord Webhook URL for alerts", true)
	}

	// Seed TORN_WS_TOKEN
	if val := s.Get(ctx, "TORN_WS_TOKEN", "NOT_SET"); val == "NOT_SET" {
		log.Info().Msg("Seeding TORN_WS_TOKEN")
		s.Set(ctx, "TORN_WS_TOKEN", cfg.TornWSToken, "Torn WebSocket Token", true)
	}

	// Seed api_rate_limit
	if val := s.Get(ctx, "api_rate_limit", "NOT_SET"); val == "NOT_SET" {
		log.Info().Msg("Seeding api_rate_limit")
		s.Set(ctx, "api_rate_limit", "100", "API Rate Limit (Requests per minute per key)", false)
	}
}
