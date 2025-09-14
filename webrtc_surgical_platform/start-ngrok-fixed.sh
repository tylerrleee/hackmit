#!/bin/bash
#
# Fixed Ngrok Setup - Single Session (works with free accounts)
#

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🌐 Fixed Ngrok Setup - Single Session${NC}"
echo -e "${BLUE}====================================${NC}"

# Check if Ngrok auth token is set
if [ -z "$NGROK_AUTH_TOKEN" ]; then
    echo -e "${RED}❌ Please set NGROK_AUTH_TOKEN first:${NC}"
    echo "   export NGROK_AUTH_TOKEN=\"your_token_here\""
    echo "   Get token from: https://dashboard.ngrok.com/get-started/your-authtoken"
    exit 1
fi

# Set Ngrok auth token
ngrok config add-authtoken "$NGROK_AUTH_TOKEN"

# Kill any existing Ngrok processes
echo -e "${YELLOW}🧹 Cleaning up existing Ngrok sessions...${NC}"
pkill -f ngrok || true
sleep 3

# Check if services are running
echo -e "${YELLOW}🔍 Checking if services are running...${NC}"

if ! curl -s http://localhost:3001/health > /dev/null; then
    echo -e "${RED}❌ Backend not running on port 3001${NC}"
    echo "   Please start it: cd backend && npm run dev"
    exit 1
fi
echo -e "${GREEN}   ✅ Backend running${NC}"

if ! curl -s http://localhost:3000 > /dev/null; then
    echo -e "${RED}❌ Frontend not running on port 3000${NC}"  
    echo "   Please start it: cd frontend && npm start"
    exit 1
fi
echo -e "${GREEN}   ✅ Frontend running${NC}"

if curl -s http://localhost:8766/health > /dev/null; then
    echo -e "${GREEN}   ✅ Bridge running${NC}"
    BRIDGE_RUNNING=true
else
    echo -e "${YELLOW}   ⚠️  Bridge not running (optional)${NC}"
    BRIDGE_RUNNING=false
fi

# Start single Ngrok session with multiple tunnels
echo -e "${YELLOW}🚀 Starting single Ngrok session with multiple tunnels...${NC}"

if [ "$BRIDGE_RUNNING" = true ]; then
    # Start all tunnels including bridge
    ngrok start --config ngrok-single-session.yml --all > ngrok-session.log 2>&1 &
else
    # Start only frontend and backend tunnels
    ngrok start --config ngrok-single-session.yml frontend backend > ngrok-session.log 2>&1 &
fi

NGROK_PID=$!
echo -e "${YELLOW}⏳ Waiting for tunnels to establish...${NC}"
sleep 15

# Check if Ngrok started successfully
if ! kill -0 $NGROK_PID 2>/dev/null; then
    echo -e "${RED}❌ Ngrok failed to start. Checking logs...${NC}"
    cat ngrok-session.log
    exit 1
fi

# Get tunnel URLs
echo -e "${YELLOW}🔍 Retrieving tunnel URLs...${NC}"
BACKEND_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="backend") | .public_url' | head -1)
FRONTEND_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="frontend") | .public_url' | head -1)

if [ "$BRIDGE_RUNNING" = true ]; then
    BRIDGE_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="bridge") | .public_url' | head -1)
    BRIDGE_HTTP_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | select(.name=="bridge-http") | .public_url' | head -1)
    # Convert bridge URL to WebSocket
    BRIDGE_WS_URL=$(echo $BRIDGE_URL | sed 's/https:/wss:/')
fi

# Verify URLs
if [ "$BACKEND_URL" = "null" ] || [ -z "$BACKEND_URL" ]; then
    echo -e "${RED}❌ Failed to get backend tunnel URL${NC}"
    echo "Ngrok tunnels status:"
    curl -s http://localhost:4040/api/tunnels | jq '.tunnels[] | {name, public_url}'
    exit 1
fi

if [ "$FRONTEND_URL" = "null" ] || [ -z "$FRONTEND_URL" ]; then
    echo -e "${RED}❌ Failed to get frontend tunnel URL${NC}"
    exit 1
fi

# Test backend connectivity through tunnel
echo -e "${YELLOW}🔍 Testing backend through tunnel...${NC}"
if curl -s "$BACKEND_URL/health" > /dev/null; then
    echo -e "${GREEN}   ✅ Backend accessible through Ngrok${NC}"
else
    echo -e "${RED}   ❌ Backend not accessible through Ngrok${NC}"
    echo "   This might be due to Ngrok's free plan limitations"
fi

# Update configuration files
echo -e "${YELLOW}📝 Creating external configuration...${NC}"
cat > .env.ngrok << EOF
# Ngrok Configuration - Generated $(date)
NODE_ENV=external
EXTERNAL_MODE=true

# Ngrok URLs
API_BASE_URL=$BACKEND_URL
BACKEND_EXTERNAL_URL=$BACKEND_URL
FRONTEND_EXTERNAL_URL=$FRONTEND_URL
CORS_ORIGIN=$FRONTEND_URL
REACT_APP_API_URL=$BACKEND_URL
EOF

if [ "$BRIDGE_RUNNING" = true ]; then
cat >> .env.ngrok << EOF
AR_BRIDGE_URL=$BRIDGE_WS_URL
AR_BRIDGE_HTTP_URL=$BRIDGE_HTTP_URL
EOF
fi

echo -e "${GREEN}✅ Ngrok setup completed successfully!${NC}"
echo ""
echo -e "${BLUE}🎯 Your Ngrok Tunnel URLs:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}📱 Frontend:  ${FRONTEND_URL}${NC}"
echo -e "${GREEN}🔧 Backend:   ${BACKEND_URL}${NC}"
if [ "$BRIDGE_RUNNING" = true ]; then
    echo -e "${GREEN}🌐 Bridge WS: ${BRIDGE_WS_URL}${NC}"
    echo -e "${GREEN}🔌 Bridge HTTP: ${BRIDGE_HTTP_URL}${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}📋 Quick Tests:${NC}"
echo "   Backend health: curl $BACKEND_URL/health"
echo "   Frontend app:   open $FRONTEND_URL"
echo "   Ngrok dashboard: open http://localhost:4040"
echo ""
echo -e "${GREEN}💡 Share the frontend URL with remote collaborators!${NC}"
echo ""
echo -e "${YELLOW}⚠️  Important for Free Ngrok Accounts:${NC}"
echo "   • Free accounts have limited bandwidth/requests per month"
echo "   • Tunnels may have connection limits"
echo "   • Consider upgrading for production use"
echo ""
echo -e "${BLUE}🔄 Tunnels active. Press Ctrl+C to stop.${NC}"

# Cleanup function  
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down Ngrok session...${NC}"
    kill $NGROK_PID 2>/dev/null || true
    rm -f ngrok-session.log .env.ngrok
    echo -e "${GREEN}✅ Cleanup completed${NC}"
}

trap cleanup INT TERM

# Monitor session
while kill -0 $NGROK_PID 2>/dev/null; do
    sleep 30
    # Basic connectivity check
    if ! curl -s "$BACKEND_URL/health" > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Backend connectivity issue detected${NC}"
    fi
done

echo -e "${RED}❌ Ngrok session ended unexpectedly${NC}"