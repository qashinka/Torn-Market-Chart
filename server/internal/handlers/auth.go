package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/akagifreeez/torn-market-chart/internal/config"
	"github.com/akagifreeez/torn-market-chart/internal/models"
	"github.com/akagifreeez/torn-market-chart/pkg/crypto"
	"github.com/akagifreeez/torn-market-chart/pkg/database"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"
)

type AuthHandler struct {
	db  *database.DB
	cfg *config.Config
}

func NewAuthHandler(db *database.DB, cfg *config.Config) *AuthHandler {
	return &AuthHandler{db: db, cfg: cfg}
}

type LoginRequest struct {
	APIKey string `json:"api_key"`
}

type LoginResponse struct {
	Token string      `json:"token"`
	User  models.User `json:"user"`
}

// Login validates Torn API key and returns JWT token
// POST /api/v1/auth/login
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.APIKey == "" {
		http.Error(w, "API Key is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// 1. Verify API Key with Torn API
	// Simple direct verification
	verificationURL := "https://api.torn.com/user/?selections=basic&key=" + req.APIKey
	resp, err := http.Get(verificationURL)
	if err != nil {
		http.Error(w, "Failed to connect to Torn API", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	var tornResp struct {
		PlayerID int64  `json:"player_id"`
		Name     string `json:"name"`
		Error    struct {
			Code  int    `json:"code"`
			Error string `json:"error"`
		} `json:"error"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tornResp); err != nil {
		http.Error(w, "Invalid response from Torn API", http.StatusBadGateway)
		return
	}

	if tornResp.Error.Code > 0 {
		http.Error(w, "Torn API Error: "+tornResp.Error.Error, http.StatusUnauthorized)
		return
	}

	if tornResp.PlayerID == 0 {
		http.Error(w, "Invalid API Key", http.StatusUnauthorized)
		return
	}

	// 2. Encrypt API Key
	encryptedKey, err := crypto.Encrypt(h.cfg.EncryptionKey, req.APIKey)
	if err != nil {
		http.Error(w, "Failed to encrypt key", http.StatusInternalServerError)
		return
	}

	// 3. Check/Create User in DB
	now := time.Now()

	// Check if this is a temporary Discord user attempting to link a Torn account
	var currentUserID int64
	if val := ctx.Value(UserContextKey); val != nil {
		currentUserID = val.(int64)
	}

	var discordID, discordUsername, discordAvatar *string
	if currentUserID < 0 {
		h.db.Pool.QueryRow(ctx, "SELECT discord_id, discord_username, discord_avatar FROM users WHERE id = $1", currentUserID).
			Scan(&discordID, &discordUsername, &discordAvatar)
	}

	// Delete the temporary proxy user before upserting the actual Torn user
	// This prevents a UNIQUE constraint violation on discord_id if the Torn user already existed
	if currentUserID < 0 {
		_, _ = h.db.Pool.Exec(ctx, "DELETE FROM users WHERE id = $1", currentUserID)
	}

	user := models.User{
		ID:          tornResp.PlayerID,
		Name:        tornResp.Name,
		LastLoginAt: now,
	}

	// Upsert user with encrypted key and potential Discord details
	_, err = h.db.Pool.Exec(ctx, `
		INSERT INTO users (id, name, api_key_hash, encrypted_api_key, last_login_at, created_at, discord_id, discord_username, discord_avatar)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (id) DO UPDATE 
		SET name = EXCLUDED.name, 
		    last_login_at = EXCLUDED.last_login_at,
			encrypted_api_key = EXCLUDED.encrypted_api_key,
			discord_id = COALESCE(EXCLUDED.discord_id, users.discord_id),
			discord_username = COALESCE(EXCLUDED.discord_username, users.discord_username),
			discord_avatar = COALESCE(EXCLUDED.discord_avatar, users.discord_avatar)
	`, user.ID, user.Name, "hashed_key_placeholder", encryptedKey, now, now, discordID, discordUsername, discordAvatar)

	if err != nil {
		fmt.Printf("Login DB Upsert error: %v\n", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	// Fetch full user object (including created_at)
	err = h.db.Pool.QueryRow(ctx, "SELECT created_at, discord_id, discord_username, discord_avatar FROM users WHERE id = $1", user.ID).
		Scan(&user.CreatedAt, &user.DiscordID, &user.DiscordUsername, &user.DiscordAvatar)
	if err != nil {
		user.CreatedAt = now
	}

	// 4. Generate JWT
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "default-insecure-secret-change-me"
	}

	// Create claims
	claims := jwt.MapClaims{
		"user_id": user.ID,
		"name":    user.Name,
		"exp":     time.Now().Add(24 * time.Hour * 30).Unix(), // 30 days
		"iat":     time.Now().Unix(),
		"iss":     "torn-market-chart",
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(jwtSecret))
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	// 5. Response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(LoginResponse{
		Token: tokenString,
		User:  user,
	})
}

// GetMe returns current user info
// GET /api/v1/auth/me
func (h *AuthHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(UserContextKey).(int64)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()
	var user models.User
	err := h.db.Pool.QueryRow(ctx, "SELECT id, name, created_at, last_login_at, discord_id, discord_username, discord_avatar FROM users WHERE id = $1", userID).
		Scan(&user.ID, &user.Name, &user.CreatedAt, &user.LastLoginAt, &user.DiscordID, &user.DiscordUsername, &user.DiscordAvatar)

	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (h *AuthHandler) getDiscordOAuthConfig() *oauth2.Config {
	return &oauth2.Config{
		RedirectURL:  os.Getenv("NEXT_PUBLIC_API_URL") + "/api/v1/auth/discord/callback",
		ClientID:     os.Getenv("DISCORD_CLIENT_ID"),
		ClientSecret: os.Getenv("DISCORD_CLIENT_SECRET"),
		Scopes:       []string{"identify"},
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://discord.com/api/oauth2/authorize",
			TokenURL: "https://discord.com/api/oauth2/token",
		},
	}
}

// DiscordOAuthLogin initiates the Discord OAuth flow
// GET /api/v1/auth/discord/login
func (h *AuthHandler) DiscordOAuthLogin(w http.ResponseWriter, r *http.Request) {
	config := h.getDiscordOAuthConfig()

	token := r.URL.Query().Get("token")

	// Create a state string that contains both a random nonce and the token (if present)
	// In production, encrypt or base64 encode this state object to prevent tampering
	state := "random-state-string"
	if token != "" {
		state = fmt.Sprintf("random-state-string|%s", token)
	}

	url := config.AuthCodeURL(state)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// DiscordOAuthCallback handles the Discord OAuth callback
// GET /api/v1/auth/discord/callback
func (h *AuthHandler) DiscordOAuthCallback(w http.ResponseWriter, r *http.Request) {
	state := r.FormValue("state")

	// Split state into nonce and token
	parts := strings.SplitN(state, "|", 2)
	nonce := parts[0]
	tokenStringFrontend := ""
	if len(parts) > 1 {
		tokenStringFrontend = parts[1]
	}

	if nonce != "random-state-string" { // Validate state
		http.Error(w, "Invalid state", http.StatusBadRequest)
		return
	}

	code := r.FormValue("code")
	if code == "" {
		http.Error(w, "Code not found", http.StatusBadRequest)
		return
	}

	config := h.getDiscordOAuthConfig()
	ctx := r.Context()
	token, err := config.Exchange(ctx, code)
	if err != nil {
		http.Error(w, "Failed to exchange token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Fetch user details from Discord
	client := config.Client(ctx, token)
	resp, err := client.Get("https://discord.com/api/users/@me")
	if err != nil {
		http.Error(w, "Failed to fetch user info", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	var discordUser struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Avatar   string `json:"avatar"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&discordUser); err != nil {
		http.Error(w, "Failed to decode user info", http.StatusInternalServerError)
		return
	}

	now := time.Now()
	var user models.User
	var existingUserID int64
	var foundExistingTornUser bool

	// 1. Try to validate the frontend token to see if a Torn user is currently logged in
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "default-insecure-secret-change-me"
	}

	if tokenStringFrontend != "" {
		token, err := jwt.Parse(tokenStringFrontend, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(jwtSecret), nil
		})

		if err == nil && token.Valid {
			if claims, ok := token.Claims.(jwt.MapClaims); ok {
				if idFloat, ok := claims["user_id"].(float64); ok {
					existingUserID = int64(idFloat)
					// Verify this user exists in DB
					err = h.db.Pool.QueryRow(ctx, "SELECT id, name, created_at FROM users WHERE id = $1", existingUserID).
						Scan(&user.ID, &user.Name, &user.CreatedAt)
					if err == nil {
						foundExistingTornUser = true
					}
				}
			}
		}
	}

	if foundExistingTornUser {
		// Clean up any placeholder accounts that might have this discord ID from previous failed links
		_, _ = h.db.Pool.Exec(ctx, "DELETE FROM users WHERE discord_id = $1 AND id < 0", discordUser.ID)

		// Unlink this discord account from any other real users to prevent unique constraint violations
		_, _ = h.db.Pool.Exec(ctx, "UPDATE users SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL WHERE discord_id = $1", discordUser.ID)

		// User is logged into a Torn account, we must link the discord details to it
		_, err = h.db.Pool.Exec(ctx, `
			UPDATE users 
			SET discord_id = $1, discord_username = $2, discord_avatar = $3, last_login_at = $4
			WHERE id = $5
		`, discordUser.ID, discordUser.Username, discordUser.Avatar, now, user.ID)

		if err != nil {
			http.Error(w, "Failed to link discord account to existing profile: "+err.Error(), http.StatusInternalServerError)
			return
		}
		user.LastLoginAt = now
	} else {
		// No valid Torn session. Check if user with this discord ID already exists
		err = h.db.Pool.QueryRow(ctx, "SELECT id, name, created_at FROM users WHERE discord_id = $1", discordUser.ID).
			Scan(&user.ID, &user.Name, &user.CreatedAt)

		if err != nil {
			// User doesn't exist AND not logged into a Torn session.
			// Create a placeholder user ID for them because Torn ID is the PK
			user.ID = -time.Now().UnixMilli() // Temporary ID
			user.Name = "Discord User (" + discordUser.Username + ")"
			user.CreatedAt = now

			_, err = h.db.Pool.Exec(ctx, `
				INSERT INTO users (id, name, api_key_hash, last_login_at, created_at, discord_id, discord_username, discord_avatar)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			`, user.ID, user.Name, "discord_oauth_login", now, now, discordUser.ID, discordUser.Username, discordUser.Avatar)

			if err != nil {
				http.Error(w, "Failed to create user", http.StatusInternalServerError)
				return
			}
		} else {
			// Update existing user's discord details
			_, err = h.db.Pool.Exec(ctx, `
				UPDATE users 
				SET discord_username = $1, discord_avatar = $2, last_login_at = $3
				WHERE discord_id = $4
			`, discordUser.Username, discordUser.Avatar, now, discordUser.ID)

			if err != nil {
				// Non-fatal, just log in production
				fmt.Printf("Warning: Failed to update discord details: %v\n", err)
			}
			user.LastLoginAt = now
		}
	}

	claims := jwt.MapClaims{
		"user_id": user.ID,
		"name":    user.Name,
		"exp":     time.Now().Add(24 * time.Hour * 30).Unix(), // 30 days
		"iat":     time.Now().Unix(),
		"iss":     "torn-market-chart",
	}

	jwtToken := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := jwtToken.SignedString([]byte(jwtSecret))
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	// Redirect to frontend with token
	frontendURL := os.Getenv("NEXT_PUBLIC_FRONTEND_URL")
	if frontendURL == "" {
		frontendURL = "http://localhost:3000"
	}

	http.Redirect(w, r, fmt.Sprintf("%s/oauth/callback?token=%s", frontendURL, tokenString), http.StatusFound)
}
