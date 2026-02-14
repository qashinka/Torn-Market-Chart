# Bug Fix: Frontend Runtime Error (null array access)

## Diagnosis
The user reported a runtime error: `Uncaught TypeError: can't access property "length", l is null`.
This error occurred because certain API endpoints were returning `null` JSON when no data was found, instead of an empty array `[]`. The frontend components (specifically `WatchlistPanel`) expected an array and crashed when trying to access `.length` or iterate over `null`.

## Fixes Implemented

### Backend (Go)
Modified `server/internal/handlers/handlers.go`:
1.  **`ListWatched` Handler**: Changed `var items []models.Item` (nil slice) to `items := make([]models.Item, 0)` (empty slice). This ensures the API returns `[]` instead of `null` when the user has no watched items.
2.  **`GetTopListings` Handler**: Changed `var listings []ListingResponse` to `listings := make([]ListingResponse, 0)`.

```go
// Before
var items []models.Item // JSON: null

// After
items := make([]models.Item, 0) // JSON: []
```

## Verification
- Rebuilt the `api` container with the fix.
- Components `WatchlistPanel` and `AnalysisPanel` should now safely receive `[]` and render their "empty" states correctly without crashing.

# Bug Fix: Empty Item List

## Diagnosis
The user reported that the item list was empty even after fixing the frontend crash.
Investigation revealed:
1.  **Worker Initialization Failure**: The background workers (`GlobalSync`, `BazaarPoller`, `BackgroundCrawler`) responsible for fetching data were not being initialized or started in `server/cmd/api/main.go`. This meant the application never even attempted to sync with the Torn API.
2.  **Missing API Key**: The `TORN_API_KEY` was missing from the environment configuration (`.env` and `docker-compose.yml`), which is required for `GlobalSync` to authenticate with Torn.

## Fixes Implemented

### Backend (Go)
Modified `server/cmd/api/main.go`:
1.  Imported `github.com/akagifreeez/torn-market-chart/internal/workers`.
2.  Initialized `GlobalSync`, `BazaarPoller`, and `BackgroundCrawler` services.
3.  Started these workers in background goroutines before starting the HTTP server.

### Configuration
1.  Updated `docker-compose.yml` to pass `TORN_API_KEYS` environment variable to the API container.
2.  User provided a valid `TORN_API_KEY` in `.env`.

## Verification
- Rebuilt `api` container.
- Confirmed `GlobalSync` worker started successfully via logs.
- Verified database population: `items` table count is now **1483** (was 0).
- Frontend search and lists should now display data correctly.
