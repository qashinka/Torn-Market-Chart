package discordbot

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/akagifreeez/torn-market-chart/internal/models"
	"github.com/akagifreeez/torn-market-chart/internal/services"
	"github.com/bwmarrin/discordgo"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

type BotHandler struct {
	apiBaseURL   string
	httpClient   *http.Client
	chartService *services.ChartService
}

func NewBotHandler(apiBaseURL string) *BotHandler {
	return &BotHandler{
		apiBaseURL:   apiBaseURL,
		httpClient:   &http.Client{Timeout: 10 * time.Second},
		chartService: services.NewChartService(),
	}
}

var commands = []*discordgo.ApplicationCommand{
	{
		Name:        "price",
		Description: "Check the current price of an item",
		Options: []*discordgo.ApplicationCommandOption{
			{
				Type:         discordgo.ApplicationCommandOptionString,
				Name:         "item",
				Description:  "Name of the item",
				Required:     true,
				Autocomplete: true,
			},
		},
	},
	{
		Name:        "summary",
		Description: "View the biggest market movers in the last 24h",
	},
	{
		Name:        "alerts",
		Description: "List your current price alerts",
	},
	{
		Name:        "alert_add",
		Description: "Add a price alert for an item",
		Options: []*discordgo.ApplicationCommandOption{
			{
				Type:         discordgo.ApplicationCommandOptionString,
				Name:         "item",
				Description:  "Name of the item",
				Required:     true,
				Autocomplete: true,
			},
			{
				Type:        discordgo.ApplicationCommandOptionString,
				Name:        "condition",
				Description: "Trigger when price is above or below",
				Required:    true,
				Choices: []*discordgo.ApplicationCommandOptionChoice{
					{Name: "Above", Value: "above"},
					{Name: "Below", Value: "below"},
				},
			},
			{
				Type:        discordgo.ApplicationCommandOptionInteger,
				Name:        "price",
				Description: "The price threshold",
				Required:    true,
			},
		},
	},
	{
		Name:        "alert_remove",
		Description: "Remove a price alert",
		Options: []*discordgo.ApplicationCommandOption{
			{
				Type:         discordgo.ApplicationCommandOptionString,
				Name:         "item",
				Description:  "Name of the item to remove the alert for",
				Required:     true,
				Autocomplete: true,
			},
		},
	},
	{
		Name:        "help",
		Description: "Display help information about Torn Market Chart Bot",
	},
}

func (h *BotHandler) RegisterHandlers(s *discordgo.Session) {
	s.AddHandler(func(s *discordgo.Session, i *discordgo.InteractionCreate) {
		switch i.Type {
		case discordgo.InteractionApplicationCommand:
			switch i.ApplicationCommandData().Name {
			case "price":
				h.handlePrice(s, i)
			case "summary":
				h.handleSummary(s, i)
			case "alerts":
				h.handleAlerts(s, i)
			case "alert_add":
				h.handleAlertAdd(s, i)
			case "alert_remove":
				h.handleAlertRemove(s, i)
			case "help":
				h.handleHelp(s, i)
			}
		case discordgo.InteractionApplicationCommandAutocomplete:
			h.handleAutocomplete(s, i)
		}
	})
}

func (h *BotHandler) RegisterCommands(s *discordgo.Session, appID, guildID string) ([]*discordgo.ApplicationCommand, error) {
	registeredCommands := make([]*discordgo.ApplicationCommand, len(commands))
	var err error
	for idx, cmd := range commands {
		registeredCommands[idx], err = s.ApplicationCommandCreate(appID, guildID, cmd)
		if err != nil {
			return nil, fmt.Errorf("cannot create '%v' command: %w", cmd.Name, err)
		}
	}
	return registeredCommands, nil
}

func (h *BotHandler) handlePrice(s *discordgo.Session, i *discordgo.InteractionCreate) {
	// Acknowledge the interaction immediately to avoid timeout
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
	})

	data := i.ApplicationCommandData()
	var query string
	for _, opt := range data.Options {
		if opt.Name == "item" {
			query = opt.StringValue()
			break
		}
	}

	reqURL := fmt.Sprintf("%s/api/v1/items/search?q=%s", h.apiBaseURL, url.QueryEscape(query))
	resp, err := h.httpClient.Get(reqURL)
	if err != nil || resp.StatusCode != http.StatusOK {
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string { str := "Error fetching data from API."; return &str }(),
		})
		return
	}
	defer resp.Body.Close()

	var items []models.Item
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil || len(items) == 0 {
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string { str := "Item not found."; return &str }(),
		})
		return
	}

	item := items[0] // take the best match

	p := message.NewPrinter(language.English)
	marketPrice := "N/A"
	if item.LastMarketPrice > 0 {
		marketPrice = p.Sprintf("$%d", item.LastMarketPrice)
	}

	bazaarPrice := "N/A"
	if item.LastBazaarPrice > 0 {
		bazaarPrice = p.Sprintf("$%d", item.LastBazaarPrice)
	}

	embed := &discordgo.MessageEmbed{
		Title:       fmt.Sprintf("Price for %s", item.Name),
		Description: fmt.Sprintf("[View on Torn Official Market](https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=%d)", item.ID),
		Color:       0x0099ff,
		Fields: []*discordgo.MessageEmbedField{
			{
				Name:   "Market Price",
				Value:  marketPrice,
				Inline: true,
			},
			{
				Name:   "Bazaar Price",
				Value:  bazaarPrice,
				Inline: true,
			},
		},
		Footer: &discordgo.MessageEmbedFooter{
			Text: fmt.Sprintf("Last updated: %s", item.LastUpdatedAt.Format("2006-01-02 15:04:05 UTC")),
		},
	}

	var files []*discordgo.File

	// ---------------------------------------------------------
	// Fetch History & Generate Chart
	// ---------------------------------------------------------
	historyReqURL := fmt.Sprintf("%s/api/v1/items/%d/history", h.apiBaseURL, item.ID)
	hResp, hErr := h.httpClient.Get(historyReqURL)
	if hErr == nil && hResp.StatusCode == http.StatusOK {
		defer hResp.Body.Close()
		var history []models.Item
		if err := json.NewDecoder(hResp.Body).Decode(&history); err == nil && len(history) > 1 {
			// Generate PNG
			chartBytes, err := h.chartService.GeneratePriceChartPNG(item.Name, history)
			if err == nil {
				// Attach the image
				files = append(files, &discordgo.File{
					Name:        fmt.Sprintf("chart_%d.png", item.ID),
					ContentType: "image/png",
					Reader:      bytes.NewReader(chartBytes),
				})
				// Reference the attachment in the embed
				embed.Image = &discordgo.MessageEmbedImage{
					URL: fmt.Sprintf("attachment://chart_%d.png", item.ID),
				}
			}
		}
	}

	s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
		Embeds: &[]*discordgo.MessageEmbed{embed},
		Files:  files,
	})
}

func (h *BotHandler) handleHelp(s *discordgo.Session, i *discordgo.InteractionCreate) {
	embed := &discordgo.MessageEmbed{
		Title:       "Torn Market Chart Bot Help",
		Description: "This bot allows you to quickly check item prices from Torn City.",
		Color:       0x00ff00,
		Fields: []*discordgo.MessageEmbedField{
			{
				Name:  "/price <item>",
				Value: "Search for an item and get its current Market and Bazaar prices.",
			},
		},
	}
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Embeds: []*discordgo.MessageEmbed{embed},
		},
	})
}

type summaryItem struct {
	ID            int64   `json:"id"`
	Name          string  `json:"name"`
	CurrentPrice  int64   `json:"current_price"`
	OldPrice      int64   `json:"old_price"`
	ChangePercent float64 `json:"change_percent"`
}

func (h *BotHandler) handleSummary(s *discordgo.Session, i *discordgo.InteractionCreate) {
	// Acknowledge the interaction immediately
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
	})

	reqURL := fmt.Sprintf("%s/api/v1/market/summary", h.apiBaseURL)
	resp, err := h.httpClient.Get(reqURL)
	if err != nil || resp.StatusCode != http.StatusOK {
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string { str := "Error fetching summary data from API."; return &str }(),
		})
		return
	}
	defer resp.Body.Close()

	var items []summaryItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil || len(items) == 0 {
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string { str := "No summary data available."; return &str }(),
		})
		return
	}

	p := message.NewPrinter(language.English)
	embed := &discordgo.MessageEmbed{
		Title:       "Market Summary (Last 24h)",
		Description: "Top 10 items with the largest percent price changes.",
		Color:       0x00ff00,
	}

	for _, it := range items {
		emoji := "📈"
		if it.ChangePercent < 0 {
			emoji = "📉"
		}

		changeStr := fmt.Sprintf("%s %.2f%%", emoji, it.ChangePercent)
		priceStr := p.Sprintf("$%d -> $%d", it.OldPrice, it.CurrentPrice)

		embed.Fields = append(embed.Fields, &discordgo.MessageEmbedField{
			Name:   fmt.Sprintf("%s (%s)", it.Name, changeStr),
			Value:  priceStr,
			Inline: false,
		})
	}

	s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
		Embeds: &[]*discordgo.MessageEmbed{embed},
	})
}

// ----------------------------------------------------------------------
// Alert Management Handlers
// ----------------------------------------------------------------------

type UserAlert struct {
	ItemID             int64    `json:"item_id"`
	ItemName           string   `json:"item_name"`
	AlertPriceAbove    *int64   `json:"alert_price_above"`
	AlertPriceBelow    *int64   `json:"alert_price_below"`
	AlertChangePercent *float64 `json:"alert_change_percent"`
}

func (h *BotHandler) handleAlerts(s *discordgo.Session, i *discordgo.InteractionCreate) {
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Flags: discordgo.MessageFlagsEphemeral, // Only the user who ran it can see
		},
	})

	userID := i.Member.User.ID

	reqURL := fmt.Sprintf("%s/api/v1/bot/alerts/%s", h.apiBaseURL, userID)
	resp, err := h.httpClient.Get(reqURL)
	if err != nil {
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string { str := "Internal API error."; return &str }(),
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string {
				str := "You don't have an account linked. Please login to the dashboard and link your Discord account first."
				return &str
			}(),
		})
		return
	}

	var alerts []UserAlert
	if err := json.NewDecoder(resp.Body).Decode(&alerts); err != nil || len(alerts) == 0 {
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string { str := "You currently have no active alerts."; return &str }(),
		})
		return
	}

	p := message.NewPrinter(language.English)
	embed := &discordgo.MessageEmbed{
		Title: "Your Active Alerts",
		Color: 0x5865F2,
	}

	for _, a := range alerts {
		var conditions []string
		if a.AlertPriceAbove != nil {
			conditions = append(conditions, p.Sprintf("**Above:** $%d", *a.AlertPriceAbove))
		}
		if a.AlertPriceBelow != nil {
			conditions = append(conditions, p.Sprintf("**Below:** $%d", *a.AlertPriceBelow))
		}
		val := "No conditions set"
		if len(conditions) > 0 {
			val = ""
			for _, c := range conditions {
				val += c + "\n"
			}
		}

		embed.Fields = append(embed.Fields, &discordgo.MessageEmbedField{
			Name:   a.ItemName,
			Value:  val,
			Inline: true,
		})
	}

	s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
		Embeds: &[]*discordgo.MessageEmbed{embed},
	})
}

func (h *BotHandler) resolveItemByName(name string) (*models.Item, error) {
	reqURL := fmt.Sprintf("%s/api/v1/items/search?q=%s", h.apiBaseURL, url.QueryEscape(name))
	resp, err := h.httpClient.Get(reqURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned %d", resp.StatusCode)
	}

	var items []models.Item
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, err
	}

	if len(items) == 0 {
		return nil, fmt.Errorf("No items found")
	}

	return &items[0], nil
}

func (h *BotHandler) handleAlertAdd(s *discordgo.Session, i *discordgo.InteractionCreate) {
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Flags: discordgo.MessageFlagsEphemeral,
		},
	})

	var itemName, condition string
	var price int64
	for _, opt := range i.ApplicationCommandData().Options {
		switch opt.Name {
		case "item":
			itemName = opt.StringValue()
		case "condition":
			condition = opt.StringValue()
		case "price":
			price = opt.IntValue()
		}
	}

	discordID := i.Member.User.ID

	// Resolve Item ID
	item, err := h.resolveItemByName(itemName)
	if err != nil {
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string { str := "Could not find an item entirely matching that name."; return &str }(),
		})
		return
	}

	// Prepare payload
	payload := map[string]interface{}{
		"item_id": item.ID,
	}
	if condition == "above" {
		payload["alert_price_above"] = price
	} else {
		payload["alert_price_below"] = price
	}

	body, _ := json.Marshal(payload)
	reqURL := fmt.Sprintf("%s/api/v1/bot/alerts/%s", h.apiBaseURL, discordID)
	req, _ := http.NewRequest("POST", reqURL, bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.httpClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil && resp.StatusCode == http.StatusNotFound {
			s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
				Content: func() *string { str := "You are not linked. Login on the Web Dashboard first."; return &str }(),
			})
			return
		}
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string { str := "Failed to save alert setting. Internal Server Error."; return &str }(),
		})
		return
	}

	p := message.NewPrinter(language.English)
	s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
		Content: func() *string {
			str := p.Sprintf("✅ Alert added for **%s** when price goes %s $%d", item.Name, condition, price)
			return &str
		}(),
	})
}

func (h *BotHandler) handleAlertRemove(s *discordgo.Session, i *discordgo.InteractionCreate) {
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Flags: discordgo.MessageFlagsEphemeral,
		},
	})

	var itemName string
	for _, opt := range i.ApplicationCommandData().Options {
		if opt.Name == "item" {
			itemName = opt.StringValue()
		}
	}

	discordID := i.Member.User.ID

	item, err := h.resolveItemByName(itemName)
	if err != nil {
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string { str := "Item unresolvable."; return &str }(),
		})
		return
	}

	reqURL := fmt.Sprintf("%s/api/v1/bot/alerts/%s/items/%d", h.apiBaseURL, discordID, item.ID)
	req, _ := http.NewRequest("DELETE", reqURL, nil)

	resp, err := h.httpClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content: func() *string { str := "Failed to remove the alert."; return &str }(),
		})
		return
	}

	s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
		Content: func() *string { str := fmt.Sprintf("🗑️ Alert removed for **%s**", item.Name); return &str }(),
	})
}

func (h *BotHandler) handleAutocomplete(s *discordgo.Session, i *discordgo.InteractionCreate) {
	data := i.ApplicationCommandData()
	var query string
	for _, opt := range data.Options {
		if opt.Name == "item" && opt.Focused {
			query = opt.StringValue()
			break
		}
	}

	choices := []*discordgo.ApplicationCommandOptionChoice{}
	if query != "" {
		reqURL := fmt.Sprintf("%s/api/v1/items/search?q=%s", h.apiBaseURL, url.QueryEscape(query))
		resp, err := h.httpClient.Get(reqURL)
		if err == nil {
			defer resp.Body.Close()
			var items []models.Item
			if err := json.NewDecoder(resp.Body).Decode(&items); err == nil {
				limit := len(items)
				if limit > 25 {
					limit = 25
				}
				for _, item := range items[:limit] {
					choices = append(choices, &discordgo.ApplicationCommandOptionChoice{
						Name:  item.Name,
						Value: item.Name,
					})
				}
			}
		}
	}

	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionApplicationCommandAutocompleteResult,
		Data: &discordgo.InteractionResponseData{
			Choices: choices,
		},
	})
}
