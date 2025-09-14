#!/bin/bash
#
# Fixed External Mode Setup - handles missing Ngrok token gracefully
#

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🌐 Starting WebRTC Surgical Platform in External Mode${NC}"
echo -e "${BLUE}================================================${NC}"

# Check if Ngrok auth token is provided
if [ -z "$NGROK_AUTH_TOKEN" ]; then
    echo -e "${RED}❌ NGROK_AUTH_TOKEN environment variable is not set.${NC}"
    echo ""
    echo -e "${YELLOW}📋 To get your Ngrok auth token:${NC}"
    echo "   1. Sign up at: https://ngrok.com/"
    echo "   2. Get your token from: https://dashboard.ngrok.com/get-started/your-authtoken"
    echo "   3. Set it with: export NGROK_AUTH_TOKEN=\"your_token_here\""
    echo ""
    echo -e "${BLUE}💡 Alternative: Test with local mode first${NC}"
    echo "   ./test-local-setup.sh"
    echo ""
    exit 1
fi

# Check if Ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}❌ Ngrok is not installed.${NC}"
    echo ""
    echo -e "${YELLOW}📦 To install Ngrok:${NC}"
    echo "   macOS: brew install ngrok/ngrok/ngrok"
    echo "   Linux: Download from https://ngrok.com/download"
    echo ""
    exit 1
fi

# Validate Ngrok auth token
echo -e "${YELLOW}🔍 Validating Ngrok auth token...${NC}"
ngrok config add-authtoken "$NGROK_AUTH_TOKEN" 2>/dev/null || {
    echo -e "${RED}❌ Invalid Ngrok auth token.${NC}"
    echo "Please check your token and try again."
    exit 1
}

echo -e "${GREEN}✅ Ngrok auth token validated${NC}"

# Set external mode environment
export NODE_ENV=external
export EXTERNAL_MODE=true

# Stop any existing services
echo -e "${YELLOW}🧹 Stopping any existing services...${NC}"
pkill -f "npm run dev" 2>/dev/null || true
pkill -f "npm start" 2>/dev/null || true
pkill -f "webrtc_bridge.py" 2>/dev/null || true
pkill -f "ngrok" 2>/dev/null || true
sleep 2

echo -e "${YELLOW}🚀 Starting external mode setup...${NC}"

# Create .env.external with placeholder values first
cat > .env.external << 'EOF'
# External Configuration - Auto-generated
NODE_ENV=external
EXTERNAL_MODE=true

# Placeholder URLs (will be updated by Ngrok setup)
API_BASE_URL=https://placeholder-backend.ngrok-free.app
BACKEND_EXTERNAL_URL=https://placeholder-backend.ngrok-free.app
FRONTEND_EXTERNAL_URL=https://placeholder-frontend.ngrok-free.app
CORS_ORIGIN=https://placeholder-frontend.ngrok-free.app
REACT_APP_API_URL=https://placeholder-backend.ngrok-free.app
AR_BRIDGE_URL=wss://placeholder-bridge.ngrok-free.app
AR_BRIDGE_HTTP_URL=https://placeholder-bridge-http.ngrok-free.app

# External-specific settings
EXTERNAL_TIMEOUT=60000
CONNECTION_RETRY_ATTEMPTS=3
HEARTBEAT_INTERVAL=30000
RATE_LIMIT_MAX_REQUESTS=200
EOF

echo -e "${GREEN}✅ Created .env.external configuration${NC}"

# Start services in background
echo -e "${YELLOW}📦 Starting services...${NC}"

# Start backend
cd backend
npm run dev > ../backend.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > ../backend.pid
cd ..
echo -e "${GREEN}   ✅ Backend started (PID: $BACKEND_PID)${NC}"

# Start bridge
python webrtc_bridge.py > bridge.log 2>&1 &
BRIDGE_PID=$!
echo $BRIDGE_PID > bridge.pid
echo -e "${GREEN}   ✅ Bridge started (PID: $BRIDGE_PID)${NC}"

# Wait for services to initialize
echo -e "${YELLOW}⏳ Waiting for services to initialize...${NC}"
sleep 10

# Test services are responding
echo -e "${YELLOW}🔍 Testing service health...${NC}"
curl -s http://localhost:3001/health > /dev/null || {
    echo -e "${RED}❌ Backend not responding${NC}"
    exit 1
}
curl -s http://localhost:8766/health > /dev/null || {
    echo -e "${RED}❌ Bridge not responding${NC}"
    exit 1
}
echo -e "${GREEN}   ✅ Services are healthy${NC}"

# Start Ngrok tunnels
echo -e "${YELLOW}🌐 Creating Ngrok tunnels...${NC}"

# Backend tunnel
ngrok http 3001 --name backend --log stdout > ngrok-backend.log 2>&1 &
NGROK_BACKEND_PID=$!

# Bridge WebSocket tunnel
ngrok http 8765 --name bridge --log stdout > ngrok-bridge.log 2>&1 &
NGROK_BRIDGE_PID=$!

# Bridge HTTP tunnel  
ngrok http 8766 --name bridge-http --log stdout > ngrok-bridge-http.log 2>&1 &
NGROK_BRIDGE_HTTP_PID=$!

# Wait for tunnels to establish
echo -e "${YELLOW}⏳ Waiting for tunnels to establish...${NC}"
sleep 15

# Get tunnel URLs from Ngrok API
echo -e "${YELLOW}🔍 Retrieving tunnel URLs...${NC}"
BACKEND_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="backend") | .public_url' | head -1)
BRIDGE_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="bridge") | .public_url' | head -1 | sed 's/https:/wss:/')
BRIDGE_HTTP_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="bridge-http") | .public_url' | head -1)

if [ "$BACKEND_URL" = "null" ] || [ -z "$BACKEND_URL" ]; then
    echo -e "${RED}❌ Failed to get backend tunnel URL${NC}"
    exit 1
fi

# Start frontend tunnel
ngrok http 3000 --name frontend --log stdout > ngrok-frontend.log 2>&1 &
NGROK_FRONTEND_PID=$!

sleep 10
FRONTEND_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="frontend") | .public_url' | head -1)

# Update .env.external with real URLs
cat > .env.external << EOF
# External Configuration - Auto-generated with Ngrok URLs
NODE_ENV=external
EXTERNAL_MODE=true

# Real Ngrok URLs
API_BASE_URL=$BACKEND_URL
BACKEND_EXTERNAL_URL=$BACKEND_URL
FRONTEND_EXTERNAL_URL=$FRONTEND_URL
CORS_ORIGIN=$FRONTEND_URL
REACT_APP_API_URL=$BACKEND_URL
AR_BRIDGE_URL=$BRIDGE_URL
AR_BRIDGE_HTTP_URL=$BRIDGE_HTTP_URL

# External-specific settings
EXTERNAL_TIMEOUT=60000
CONNECTION_RETRY_ATTEMPTS=3
HEARTBEAT_INTERVAL=30000
RATE_LIMIT_MAX_REQUESTS=200

# Generated at: $(date)
EOF

# Start frontend
echo -e "${YELLOW}🎨 Starting frontend with external configuration...${NC}"
cd frontend
REACT_APP_API_URL=$BACKEND_URL npm start > ../frontend.log 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > ../frontend.pid
cd ..

echo -e "${GREEN}✅ External mode setup completed!${NC}"
echo ""
echo -e "${BLUE}🎯 Ngrok Tunnel Configuration:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}📱 Frontend URL:     ${FRONTEND_URL}${NC}"
echo -e "${GREEN}🔧 Backend API URL:  ${BACKEND_URL}${NC}"
echo -e "${GREEN}🌐 Bridge WebSocket: ${BRIDGE_URL}${NC}"
echo -e "${GREEN}🔌 Bridge HTTP API:  ${BRIDGE_HTTP_URL}${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}📋 Quick Access Commands:${NC}"
echo "   Frontend: open $FRONTEND_URL"
echo "   API Test: curl $BACKEND_URL/health"
echo "   Ngrok Web: open http://localhost:4040"
echo ""
echo -e "${GREEN}💡 Share the frontend URL with remote collaborators!${NC}"
echo -e "${YELLOW}⚠️  Keep this terminal running to maintain tunnels.${NC}"
echo ""
echo -e "${BLUE}🔄 Tunnels are active. Press Ctrl+C to stop.${NC}"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down external mode...${NC}"
    kill $BACKEND_PID $BRIDGE_PID $FRONTEND_PID $NGROK_BACKEND_PID $NGROK_BRIDGE_PID $NGROK_BRIDGE_HTTP_PID $NGROK_FRONTEND_PID 2>/dev/null || true
    rm -f *.pid *.log
    echo -e "${GREEN}✅ Cleanup completed${NC}"
}

trap cleanup INT TERM

# Keep running
while true; do
    sleep 30
    # Basic health check
    if ! curl -s http://localhost:3001/health > /dev/null; then
        echo -e "${RED}⚠️  Backend health check failed${NC}"
    fi
done