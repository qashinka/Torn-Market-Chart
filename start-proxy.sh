#!/bin/sh
set -e

# Start tailscaled in the background
# --tun=userspace-networking is strictly not needed if we have NET_ADMIN,
# but often safer in containers if /dev/net/tun isn't available.
# However, the user granted NET_ADMIN in the prompt requirements.
echo "Starting tailscaled..."
tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &

# Wait for the socket to be created
echo "Waiting for tailscaled socket..."
timeout=10
while [ ! -S /var/run/tailscale/tailscaled.sock ]; do
    if [ "$timeout" -le 0 ]; then
        echo "Timed out waiting for tailscaled socket."
        exit 1
    fi
    sleep 1
    timeout=$((timeout - 1))
done

# Authenticate if needed
if [ -n "$TS_AUTHKEY" ]; then
    echo "Authenticating with Tailscale..."
    tailscale up --authkey="${TS_AUTHKEY}" --hostname="${TS_HOSTNAME:-db-proxy}" --reset
fi

# Start socat
echo "Starting socat proxy forwarding 0.0.0.0:3306 -> ${REMOTE_DB_HOST}:3306"
exec socat TCP-LISTEN:3306,fork,bind=0.0.0.0 TCP:${REMOTE_DB_HOST}:3306
