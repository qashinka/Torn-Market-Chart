package models

import (
	"time"
)

type ApiKey struct {
	ID           string     `json:"id"`
	EncryptedKey string     `json:"-"`
	Label        string     `json:"label"`
	IsActive     bool       `json:"is_active"`
	CreatedAt    time.Time  `json:"created_at"`
	LastUsedAt   *time.Time `json:"last_used_at"` // Pointer to handle NULL
	UsageCount   int64      `json:"usage_count"`
	ErrorCount   int        `json:"error_count"`
}
