#!/bin/sh
set -e

# Default values
DB_HOST=${DB_HOST:-db}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-postgrespwd}
DB_NAME=${DB_NAME:-torn_market}
SSL_MODE=${DB_SSL_MODE:-disable}

# If DATABASE_URL is not explicitly set, construct it
if [ -z "$DATABASE_URL" ]; then
    export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=${SSL_MODE}"
fi

echo "Starting API server..."
echo "Database Host: $DB_HOST"
exec /app/api
