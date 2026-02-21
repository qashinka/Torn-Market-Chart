package main

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/bwmarrin/discordgo"
	"github.com/joho/godotenv"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/akagifreeez/torn-market-chart/internal/discordbot"
)

func main() {
	// Setup zerolog
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stdout})

	// Load .env if exists
	_ = godotenv.Load()

	token := os.Getenv("DISCORD_BOT_TOKEN")
	if token == "" {
		log.Fatal().Msg("DISCORD_BOT_TOKEN environment variable is required")
	}

	appID := os.Getenv("DISCORD_CLIENT_ID")
	if appID == "" {
		log.Fatal().Msg("DISCORD_CLIENT_ID environment variable is required")
	}

	guildID := os.Getenv("DISCORD_GUILD_ID")

	apiBaseURL := os.Getenv("API_BASE_URL")
	if apiBaseURL == "" {
		apiBaseURL = "http://localhost:8080" // Fallback for local testing
	}

	// Create a new Discord session using the provided bot token.
	dg, err := discordgo.New("Bot " + token)
	if err != nil {
		log.Fatal().Err(err).Msg("error creating Discord session")
	}

	// Initialize bot handler
	botHandler := discordbot.NewBotHandler(apiBaseURL)
	botHandler.RegisterHandlers(dg)

	// Open a websocket connection to Discord and begin listening.
	err = dg.Open()
	if err != nil {
		log.Fatal().Err(err).Msg("error opening connection")
	}

	// Register commands
	log.Info().Msg("Registering commands...")
	_, err = botHandler.RegisterCommands(dg, appID, guildID)
	if err != nil {
		log.Fatal().Err(err).Msg("error registering commands")
	}

	log.Info().Msg("Bot is now running. Press CTRL-C to exit.")
	sc := make(chan os.Signal, 1)
	signal.Notify(sc, syscall.SIGINT, syscall.SIGTERM, os.Interrupt)
	<-sc

	log.Info().Msg("Gracefully shutting down.")

	// Cleanly close down the Discord session.
	dg.Close()
}
