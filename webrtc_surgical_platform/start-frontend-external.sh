#!/bin/bash
#
# Start frontend with external backend URL
#

BACKEND_URL="https://b8c921c14705.ngrok-free.app"

echo "🎨 Starting frontend with external backend: $BACKEND_URL"

# Kill existing frontend
pkill -f "npm start" || true
sleep 2

# Start frontend with external backend URL
cd frontend
REACT_APP_API_URL="$BACKEND_URL" npm start