#!/bin/bash
#
# Simple Working Ngrok Setup
# Uses one session with sequential tunnel setup
#

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🌐 Simple Working Ngrok Setup${NC}"
echo -e "${BLUE}=============================${NC}"

# Check auth token
if [ -z "$NGROK_AUTH_TOKEN" ]; then
    echo -e "${RED}❌ Set NGROK_AUTH_TOKEN first${NC}"
    exit 1
fi

# Set auth token
ngrok config add-authtoken "$NGROK_AUTH_TOKEN"

# Kill existing Ngrok
pkill -f ngrok || true
sleep 3

# Check services
echo -e "${YELLOW}🔍 Checking services...${NC}"
if ! curl -s http://localhost:3001/health > /dev/null; then
    echo -e "${RED}❌ Backend not running on port 3001${NC}"
    echo "Start it: cd backend && npm run dev"
    exit 1
fi

if ! curl -s http://localhost:3000 > /dev/null; then
    echo -e "${RED}❌ Frontend not running on port 3000${NC}"
    echo "Start it: cd frontend && npm start"
    exit 1
fi

echo -e "${GREEN}✅ Services are running${NC}"

# Create simple ngrok config
cat > simple-ngrok.yml << 'EOF'
version: 2
region: us
tunnels:
  backend:
    proto: http
    addr: 3001
  frontend:
    proto: http
    addr: 3000
EOF

echo -e "${YELLOW}🚀 Starting Ngrok tunnels...${NC}"

# Start Ngrok with simple config
ngrok start --config simple-ngrok.yml --all > ngrok-simple.log 2>&1 &
NGROK_PID=$!

# Wait for startup
echo -e "${YELLOW}⏳ Waiting for tunnels (30 seconds)...${NC}"
sleep 30

# Check if ngrok is running
if ! kill -0 $NGROK_PID 2>/dev/null; then
    echo -e "${RED}❌ Ngrok failed. Log:${NC}"
    cat ngrok-simple.log
    exit 1
fi

# Get URLs
echo -e "${YELLOW}🔍 Getting tunnel URLs...${NC}"
BACKEND_URL=""
FRONTEND_URL=""

# Retry getting URLs a few times
for i in {1..5}; do
    BACKEND_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | jq -r '.tunnels[] | select(.name=="backend") | .public_url' 2>/dev/null | head -1)
    FRONTEND_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | jq -r '.tunnels[] | select(.name=="frontend") | .public_url' 2>/dev/null | head -1)
    
    if [ -n "$BACKEND_URL" ] && [ "$BACKEND_URL" != "null" ]; then
        break
    fi
    
    echo -e "${YELLOW}   Attempt $i/5 - waiting...${NC}"
    sleep 5
done

if [ -z "$BACKEND_URL" ] || [ "$BACKEND_URL" = "null" ]; then
    echo -e "${RED}❌ Could not get backend URL${NC}"
    echo "Available tunnels:"
    curl -s http://localhost:4040/api/tunnels | jq '.tunnels[]' 2>/dev/null || echo "Could not query tunnels"
    exit 1
fi

echo -e "${GREEN}✅ Got tunnel URLs!${NC}"

# Test backend through tunnel
echo -e "${YELLOW}🔍 Testing backend through tunnel...${NC}"
if curl -s "$BACKEND_URL/health" > /dev/null; then
    echo -e "${GREEN}   ✅ Backend works through Ngrok!${NC}"
else
    echo -e "${YELLOW}   ⚠️  Backend might have Ngrok free plan restrictions${NC}"
fi

# Display results
echo ""
echo -e "${BLUE}🎯 Your Working Ngrok Setup:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}🔧 Backend:  ${BACKEND_URL}${NC}"
echo -e "${GREEN}📱 Frontend: ${FRONTEND_URL}${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}📋 Test Commands:${NC}"
echo "   curl $BACKEND_URL/health"
echo "   open $FRONTEND_URL"
echo ""
echo -e "${YELLOW}🔧 To fix frontend → backend connection:${NC}"
echo "   1. Stop frontend: Ctrl+C in frontend terminal"
echo "   2. Restart with: REACT_APP_API_URL=\"$BACKEND_URL\" npm start"
echo "   3. Then access: $FRONTEND_URL"
echo ""

# Create restart command for user
echo "# Frontend restart command" > restart-frontend.sh
echo "cd frontend" >> restart-frontend.sh
echo "REACT_APP_API_URL=\"$BACKEND_URL\" npm start" >> restart-frontend.sh
chmod +x restart-frontend.sh

echo -e "${GREEN}💡 Created 'restart-frontend.sh' for easy frontend restart with correct backend URL${NC}"
echo -e "${BLUE}🔄 Tunnels active. Press Ctrl+C to stop.${NC}"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🛑 Stopping Ngrok...${NC}"
    kill $NGROK_PID 2>/dev/null || true
    rm -f simple-ngrok.yml ngrok-simple.log
    echo -e "${GREEN}✅ Cleanup done${NC}"
}

trap cleanup INT TERM

# Keep running
while kill -0 $NGROK_PID 2>/dev/null; do
    sleep 30
done