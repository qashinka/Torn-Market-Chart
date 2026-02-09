package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/akagifreeez/torn-market-chart/internal/config"
	"github.com/akagifreeez/torn-market-chart/internal/models"
	"github.com/akagifreeez/torn-market-chart/pkg/crypto"
	"github.com/akagifreeez/torn-market-chart/pkg/database"
	"github.com/golang-jwt/jwt/v5"
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
	user := models.User{
		ID:          tornResp.PlayerID,
		Name:        tornResp.Name,
		LastLoginAt: now,
	}

	// Upsert user with encrypted key
	_, err = h.db.Pool.Exec(ctx, `
		INSERT INTO users (id, name, api_key_hash, encrypted_api_key, last_login_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (id) DO UPDATE 
		SET name = EXCLUDED.name, 
		    last_login_at = EXCLUDED.last_login_at,
			encrypted_api_key = EXCLUDED.encrypted_api_key
	`, user.ID, user.Name, "hashed_key_placeholder", encryptedKey, now, now)

	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	// Fetch full user object (including created_at)
	err = h.db.Pool.QueryRow(ctx, "SELECT created_at FROM users WHERE id = $1", user.ID).Scan(&user.CreatedAt)
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
	err := h.db.Pool.QueryRow(ctx, "SELECT id, name, created_at, last_login_at FROM users WHERE id = $1", userID).
		Scan(&user.ID, &user.Name, &user.CreatedAt, &user.LastLoginAt)

	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}
