#!/bin/bash
#
# Start WebRTC Surgical Platform in Local Mode (localhost only)
# This script starts all services for local development
#

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🏠 Starting WebRTC Surgical Platform in Local Mode${NC}"
echo -e "${BLUE}===============================================${NC}"

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"

# Check Node.js dependencies
if [ ! -d "backend/node_modules" ]; then
    echo "Installing backend dependencies..."
    cd backend && npm install && cd ..
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

# Check Python dependencies
if ! python -c "import websockets, aiohttp" &> /dev/null; then
    echo "Installing Python dependencies..."
    pip install websockets aiohttp python-dotenv requests
fi

echo -e "${GREEN}✅ Prerequisites check completed${NC}"
echo ""

# Set local mode environment
export NODE_ENV=development
export EXTERNAL_MODE=false

echo -e "${YELLOW}🚀 Starting services in local mode...${NC}"
echo ""
echo "Services will be available at:"
echo "   📱 Frontend:  http://localhost:3000"
echo "   🔧 Backend:   http://localhost:3001" 
echo "   🌐 AR Bridge: ws://localhost:8765"
echo "   🔌 HTTP API:  http://localhost:8766"
echo ""
echo -e "${YELLOW}⏳ Starting all services...${NC}"
echo ""

# Function to start a service and track its PID
start_service() {
    local name=$1
    local command=$2
    local dir=${3:-.}
    
    echo -e "${BLUE}Starting $name...${NC}"
    cd "$dir"
    $command &
    local pid=$!
    echo $pid > "../${name,,}.pid"
    cd - > /dev/null
    sleep 2
}

# Start backend
start_service "Backend" "npm run dev" "backend"

# Start frontend  
start_service "Frontend" "npm start" "frontend"

# Start WebRTC bridge
start_service "Bridge" "python webrtc_bridge.py"

echo -e "${GREEN}✅ All services started successfully!${NC}"
echo ""
echo -e "${BLUE}🎯 Quick Access:${NC}"
echo "   📱 Open frontend: open http://localhost:3000"
echo "   🔧 Test backend:  curl http://localhost:3001/health"
echo "   🌐 Test bridge:   python test_ar_client_live.py"
echo ""
echo -e "${YELLOW}💡 To stop all services, run: ./stop-services.sh${NC}"
echo -e "${YELLOW}📋 To view logs, run: tail -f *.log${NC}"
echo ""
echo -e "${GREEN}🔄 Services are running. Press Ctrl+C to stop monitoring.${NC}"

# Monitor services
trap 'echo -e "\n${YELLOW}🛑 Stopping monitoring (services continue running)${NC}"' INT

while true; do
    sleep 30
    # Check if services are still running
    for service in backend frontend bridge; do
        if [ -f "${service}.pid" ]; then
            pid=$(cat "${service}.pid")
            if ! kill -0 $pid 2>/dev/null; then
                echo -e "${RED}⚠️  $service (PID $pid) has stopped${NC}"
                rm -f "${service}.pid"
            fi
        fi
    done
done