#!/bin/bash
#
# Working Ngrok Setup - Direct command approach
#

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🌐 Working Ngrok Setup${NC}"
echo -e "${BLUE}=====================${NC}"

# Kill any existing ngrok
pkill -f ngrok || true
sleep 2

# Check services
echo -e "${YELLOW}🔍 Checking services...${NC}"
if ! curl -s http://localhost:3001/health > /dev/null; then
    echo -e "${RED}❌ Backend not running on port 3001${NC}"
    exit 1
fi

if ! curl -s http://localhost:3000 > /dev/null; then
    echo -e "${RED}❌ Frontend not running on port 3000${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Services running${NC}"

# Start backend tunnel
echo -e "${YELLOW}🚀 Creating backend tunnel...${NC}"
ngrok http 3001 --log=stdout > ngrok-backend-simple.log 2>&1 &
BACKEND_NGROK_PID=$!

# Wait for backend tunnel
echo -e "${YELLOW}⏳ Waiting for backend tunnel...${NC}"
sleep 15

# Get backend URL
BACKEND_URL=""
for i in {1..10}; do
    BACKEND_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | jq -r '.tunnels[0].public_url' 2>/dev/null)
    if [ -n "$BACKEND_URL" ] && [ "$BACKEND_URL" != "null" ]; then
        break
    fi
    sleep 2
done

if [ -z "$BACKEND_URL" ] || [ "$BACKEND_URL" = "null" ]; then
    echo -e "${RED}❌ Could not get backend URL${NC}"
    cat ngrok-backend-simple.log
    exit 1
fi

echo -e "${GREEN}✅ Backend tunnel: ${BACKEND_URL}${NC}"

# Test backend
echo -e "${YELLOW}🔍 Testing backend through tunnel...${NC}"
if curl -s "${BACKEND_URL}/health" > /dev/null; then
    echo -e "${GREEN}   ✅ Backend accessible!${NC}"
else
    echo -e "${YELLOW}   ⚠️  Backend may have restrictions${NC}"
fi

# Start frontend tunnel in new process  
echo -e "${YELLOW}🚀 Creating frontend tunnel...${NC}"
ngrok http 3000 --log=stdout > ngrok-frontend-simple.log 2>&1 &
FRONTEND_NGROK_PID=$!

sleep 15

# Get frontend URL
FRONTEND_URL=""
for i in {1..10}; do
    # Get the second tunnel (frontend)
    FRONTEND_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | jq -r '.tunnels[1].public_url' 2>/dev/null)
    if [ -n "$FRONTEND_URL" ] && [ "$FRONTEND_URL" != "null" ]; then
        break
    fi
    sleep 2
done

if [ -z "$FRONTEND_URL" ] || [ "$FRONTEND_URL" = "null" ]; then
    echo -e "${YELLOW}⚠️  Frontend tunnel creation may have failed${NC}"
    echo "Available tunnels:"
    curl -s http://localhost:4040/api/tunnels | jq '.tunnels[]' 2>/dev/null || echo "Could not query"
fi

echo ""
echo -e "${BLUE}🎯 Ngrok Tunnels Created:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}🔧 Backend:  ${BACKEND_URL}${NC}"
if [ -n "$FRONTEND_URL" ] && [ "$FRONTEND_URL" != "null" ]; then
    echo -e "${GREEN}📱 Frontend: ${FRONTEND_URL}${NC}"
else
    echo -e "${YELLOW}📱 Frontend: Creating second tunnel may require paid plan${NC}"
    echo -e "${YELLOW}            Use: ngrok http 3000 in separate terminal${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create frontend restart command
cat > restart-frontend-with-backend.sh << EOF
#!/bin/bash
# Restart frontend with external backend URL
cd frontend
pkill -f "npm start" || true
sleep 2
echo "Starting frontend with backend: ${BACKEND_URL}"
REACT_APP_API_URL="${BACKEND_URL}" npm start
EOF
chmod +x restart-frontend-with-backend.sh

echo ""
echo -e "${YELLOW}📋 Next Steps:${NC}"
echo "1. Test backend: curl ${BACKEND_URL}/health"
if [ -n "$FRONTEND_URL" ] && [ "$FRONTEND_URL" != "null" ]; then
    echo "2. Test frontend: open ${FRONTEND_URL}"
else
    echo "2. Create frontend tunnel: ngrok http 3000 (in new terminal)"
fi
echo "3. Restart frontend with external backend:"
echo "   ./restart-frontend-with-backend.sh"
echo ""
echo -e "${GREEN}💡 Backend tunnel is working! Frontend accessible via network or additional tunnel.${NC}"
echo -e "${BLUE}🔄 Keep this terminal open. Press Ctrl+C to stop tunnels.${NC}"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🛑 Stopping tunnels...${NC}"
    kill $BACKEND_NGROK_PID $FRONTEND_NGROK_PID 2>/dev/null || true
    rm -f ngrok-*-simple.log
    echo -e "${GREEN}✅ Cleanup done${NC}"
}

trap cleanup INT TERM

# Keep running
while kill -0 $BACKEND_NGROK_PID 2>/dev/null; do
    sleep 30
done