package tornapi

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

// RateLimiter enforces API rate limits using Redis
type RateLimiter struct {
	client  *redis.Client
	limit   int
	window  time.Duration
	baseKey string
}

// NewRateLimiter creates a new RateLimiter
func NewRateLimiter(redisURL string, limit int, baseKey string) (*RateLimiter, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("invalid redis url: %w", err)
	}

	client := redis.NewClient(opts)

	// Verify connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to redis: %w", err)
	}

	return &RateLimiter{
		client:  client,
		limit:   limit,
		window:  60 * time.Second, // 1 minute fixed window
		baseKey: baseKey,
	}, nil
}

// SetLimit updates the rate limit dynamically
func (r *RateLimiter) SetLimit(limit int) {
	r.limit = limit
}

// WaitForTicket blocks until a request is allowed
func (r *RateLimiter) WaitForTicket(ctx context.Context, keyCount int) error {
	// Calculate total limit based on number of keys
	// Rule: Limit is per key? Or global?
	// User said: "Current implementation logic is base_limit * key_count"
	// Let's stick to that.

	effectiveLimit := r.limit * keyCount
	if effectiveLimit <= 0 {
		effectiveLimit = 50 // Safe fallback
	}

	// Simple Fixed Window Counter
	// Key: torn_api:rate_limit:<minute_timestamp>
	now := time.Now()
	minuteKey := fmt.Sprintf("%s:%d", r.baseKey, now.Unix()/60)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Increment counter
		// We use Lua script or transaction for atomicity if needed, but simple INCR is fine for this scale
		count, err := r.client.Incr(ctx, minuteKey).Result()
		if err != nil {
			log.Error().Err(err).Msg("RateLimiter: Redis error")
			// Fail open or closed? Let's sleep and retry to avoid flooding if Redis is down
			time.Sleep(1 * time.Second)
			continue
		}

		// Set expiry on first increment
		if count == 1 {
			r.client.Expire(ctx, minuteKey, 2*time.Minute)
		}

		if count <= int64(effectiveLimit) {
			// Allowed
			return nil
		}

		// Limit exceeded, wait
		log.Warn().
			Int64("count", count).
			Int("limit", effectiveLimit).
			Msg("Rate limit exceeded, waiting...")

		// Wait until next minute + small jitter
		nextMinute := now.Truncate(time.Minute).Add(time.Minute).Add(100 * time.Millisecond)
		waitDuration := time.Until(nextMinute)
		if waitDuration < 0 {
			waitDuration = 1 * time.Second
		}

		timer := time.NewTimer(waitDuration)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
			// Retry loop with new minute key
			now = time.Now()
			minuteKey = fmt.Sprintf("%s:%d", r.baseKey, now.Unix()/60)
		}
	}
}

// Close closes the Redis client
func (r *RateLimiter) Close() error {
	return r.client.Close()
}
