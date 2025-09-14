#!/bin/bash
#
# Quick Ngrok Setup - Simple way to expose both frontend and backend
#

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🚀 Quick Ngrok Setup for WebRTC Platform${NC}"
echo -e "${BLUE}========================================${NC}"

# Check if Ngrok auth token is set
if [ -z "$NGROK_AUTH_TOKEN" ]; then
    echo -e "${RED}❌ Please set NGROK_AUTH_TOKEN first:${NC}"
    echo "   export NGROK_AUTH_TOKEN=\"your_token_here\""
    echo "   Get token from: https://dashboard.ngrok.com/get-started/your-authtoken"
    exit 1
fi

# Check if services are running
if ! curl -s http://localhost:3001/health > /dev/null; then
    echo -e "${RED}❌ Backend not running. Please start it first:${NC}"
    echo "   cd backend && npm run dev"
    exit 1
fi

if ! curl -s http://localhost:3000 > /dev/null; then
    echo -e "${YELLOW}⚠️  Frontend not running. Starting it...${NC}"
    cd frontend
    npm start > ../frontend.log 2>&1 &
    cd ..
    echo -e "${YELLOW}⏳ Waiting for frontend to start...${NC}"
    sleep 15
fi

# Set Ngrok auth token
ngrok config add-authtoken "$NGROK_AUTH_TOKEN"

echo -e "${YELLOW}🌐 Creating Ngrok tunnels...${NC}"

# Kill any existing Ngrok processes
pkill -f ngrok || true
sleep 2

# Start backend tunnel in background
echo -e "${BLUE}   Creating backend tunnel...${NC}"
ngrok http 3001 --name backend --log stdout > ngrok-backend.log 2>&1 &
BACKEND_NGROK_PID=$!

# Wait for backend tunnel to establish
sleep 10

# Get backend URL
BACKEND_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="backend") | .public_url' | head -1)

if [ "$BACKEND_URL" = "null" ] || [ -z "$BACKEND_URL" ]; then
    echo -e "${RED}❌ Failed to get backend tunnel URL${NC}"
    echo "Check ngrok-backend.log for errors"
    exit 1
fi

echo -e "${GREEN}   ✅ Backend tunnel: ${BACKEND_URL}${NC}"

# Update frontend environment and restart it
echo -e "${BLUE}   Updating frontend configuration...${NC}"
pkill -f "npm start" || true
sleep 2

# Start frontend with correct backend URL
cd frontend
REACT_APP_API_URL="$BACKEND_URL" npm start > ../frontend-external.log 2>&1 &
FRONTEND_PID=$!
cd ..

echo -e "${YELLOW}⏳ Waiting for frontend to restart with new config...${NC}"
sleep 15

# Create frontend tunnel
echo -e "${BLUE}   Creating frontend tunnel...${NC}"
ngrok http 3000 --name frontend --log stdout > ngrok-frontend.log 2>&1 &
FRONTEND_NGROK_PID=$!

sleep 10

# Get frontend URL
FRONTEND_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="frontend") | .public_url' | head -1)

if [ "$FRONTEND_URL" = "null" ] || [ -z "$FRONTEND_URL" ]; then
    echo -e "${RED}❌ Failed to get frontend tunnel URL${NC}"
    echo "Check ngrok-frontend.log for errors"
    exit 1
fi

# Create bridge tunnel if bridge is running
if curl -s http://localhost:8766/health > /dev/null; then
    echo -e "${BLUE}   Creating bridge tunnel...${NC}"
    ngrok http 8765 --name bridge --log stdout > ngrok-bridge.log 2>&1 &
    BRIDGE_NGROK_PID=$!
    sleep 10
    BRIDGE_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="bridge") | .public_url' | head -1 | sed 's/https:/wss:/')
fi

echo -e "${GREEN}✅ Ngrok setup completed!${NC}"
echo ""
echo -e "${BLUE}🎯 Your Ngrok URLs:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}📱 Frontend:  ${FRONTEND_URL}${NC}"
echo -e "${GREEN}🔧 Backend:   ${BACKEND_URL}${NC}"
if [ ! -z "$BRIDGE_URL" ]; then
    echo -e "${GREEN}🌐 Bridge:    ${BRIDGE_URL}${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}📋 Quick Tests:${NC}"
echo "   Backend:  curl $BACKEND_URL/health"
echo "   Frontend: open $FRONTEND_URL"
echo "   Ngrok UI: open http://localhost:4040"
echo ""
echo -e "${GREEN}💡 Share the frontend URL with remote users!${NC}"
echo -e "${YELLOW}⚠️  Keep this terminal running to maintain tunnels.${NC}"
echo ""

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down tunnels...${NC}"
    kill $BACKEND_NGROK_PID $FRONTEND_NGROK_PID $BRIDGE_NGROK_PID 2>/dev/null || true
    echo -e "${GREEN}✅ Tunnels stopped${NC}"
}

trap cleanup INT TERM

# Monitor tunnels
echo -e "${BLUE}🔄 Monitoring tunnels... Press Ctrl+C to stop${NC}"
while true; do
    sleep 30
    # Check if tunnels are still active
    if ! curl -s http://localhost:4040/api/tunnels | grep -q "backend"; then
        echo -e "${RED}⚠️  Backend tunnel disconnected${NC}"
    fi
done