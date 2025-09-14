#!/bin/sh

# Frontend Docker entrypoint script

set -e

echo "🚀 Starting WebRTC Surgical Platform Frontend..."

# Environment configuration
echo "📋 Environment Configuration:"
echo "   - Backend API: ${REACT_APP_API_URL:-http://localhost:3001}"
echo "   - WebSocket Bridge: ${REACT_APP_WEBSOCKET_URL:-ws://localhost:8765}"
echo "   - Environment: ${NODE_ENV:-production}"

# Inject environment variables into built app
if [ -n "$REACT_APP_API_URL" ]; then
    echo "🔧 Configuring API URL: $REACT_APP_API_URL"
    find /usr/share/nginx/html -name "*.js" -exec sed -i "s|REACT_APP_API_URL_PLACEHOLDER|$REACT_APP_API_URL|g" {} \;
fi

if [ -n "$REACT_APP_WEBSOCKET_URL" ]; then
    echo "🔧 Configuring WebSocket URL: $REACT_APP_WEBSOCKET_URL"
    find /usr/share/nginx/html -name "*.js" -exec sed -i "s|REACT_APP_WEBSOCKET_URL_PLACEHOLDER|$REACT_APP_WEBSOCKET_URL|g" {} \;
fi

# Set proper permissions
chown -R nginx:nginx /usr/share/nginx/html
chmod -R 755 /usr/share/nginx/html

echo "✅ Frontend initialization complete"
echo "🌐 Starting nginx server on port 80..."

# Execute the main command
exec "$@"