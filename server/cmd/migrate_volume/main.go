package main

import (
	"context"
	"fmt"
	"os"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/akagifreeez/torn-market-chart/internal/config"
	"github.com/akagifreeez/torn-market-chart/pkg/database"
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

	ctx := context.Background()

	// Connect to database
	db, err := database.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to database")
	}
	defer db.Close()

	views := []string{
		"market_prices_1m",
		"market_prices_1h",
		"market_prices_1d",
		"bazaar_prices_1m",
		"bazaar_prices_1h",
		"bazaar_prices_1d",
	}

	for _, view := range views {
		query := fmt.Sprintf("DROP MATERIALIZED VIEW IF EXISTS %s CASCADE;", view)
		log.Info().Str("view", view).Msg("Dropping materialized view")
		if _, err := db.Pool.Exec(ctx, query); err != nil {
			log.Error().Err(err).Str("view", view).Msg("Failed to drop view")
		} else {
			log.Info().Str("view", view).Msg("View dropped successfully")
		}
	}

	log.Info().Msg("Migration completed. Please restart the API server to recreate views.")
}
