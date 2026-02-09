# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum* ./
RUN go mod download

# Copy source
COPY . .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -o /api ./cmd/api

# Runtime stage
FROM alpine:latest

WORKDIR /app

# Install CA certificates for HTTPS calls
RUN apk --no-cache add ca-certificates tzdata

# Copy binary from builder
COPY --from=builder /api /app/api

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose port
EXPOSE 8080

# Run
ENTRYPOINT ["/entrypoint.sh"]
