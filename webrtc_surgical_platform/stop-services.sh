#!/bin/bash
#
# Stop all WebRTC Surgical Platform services
# This script gracefully stops all running services
#

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🛑 Stopping WebRTC Surgical Platform Services${NC}"
echo -e "${BLUE}============================================${NC}"

# Function to stop a service by PID file
stop_service() {
    local name=$1
    local pidfile=$(echo "${name}" | tr '[:upper:]' '[:lower:]').pid
    
    if [ -f "$pidfile" ]; then
        local pid=$(cat "$pidfile")
        echo -e "${YELLOW}Stopping $name (PID $pid)...${NC}"
        
        if kill -0 $pid 2>/dev/null; then
            kill -TERM $pid 2>/dev/null || true
            sleep 2
            
            # Force kill if still running
            if kill -0 $pid 2>/dev/null; then
                echo -e "${RED}Force killing $name...${NC}"
                kill -KILL $pid 2>/dev/null || true
            fi
            
            echo -e "${GREEN}✅ $name stopped${NC}"
        else
            echo -e "${YELLOW}$name was not running${NC}"
        fi
        
        rm -f "$pidfile"
    else
        echo -e "${YELLOW}No PID file found for $name${NC}"
    fi
}

# Stop services by PID files
stop_service "Backend"
stop_service "Frontend" 
stop_service "Bridge"

# Kill any remaining processes by name
echo -e "${YELLOW}🔍 Checking for remaining processes...${NC}"

# Kill Node.js processes (backend/frontend)
for pid in $(ps aux | grep -E "(npm run dev|npm start)" | grep -v grep | awk '{print $2}'); do
    echo -e "${YELLOW}Killing Node.js process $pid...${NC}"
    kill -TERM $pid 2>/dev/null || true
done

# Kill Python bridge processes
for pid in $(ps aux | grep "webrtc_bridge.py" | grep -v grep | awk '{print $2}'); do
    echo -e "${YELLOW}Killing bridge process $pid...${NC}"
    kill -TERM $pid 2>/dev/null || true
done

# Kill Ngrok processes
for pid in $(ps aux | grep "ngrok" | grep -v grep | awk '{print $2}'); do
    echo -e "${YELLOW}Killing Ngrok process $pid...${NC}"
    kill -TERM $pid 2>/dev/null || true
done

# Clean up any remaining PID files
rm -f *.pid 2>/dev/null || true

# Clean up temporary files
rm -f ngrok-config.json 2>/dev/null || true

echo -e "${GREEN}✅ All services stopped successfully${NC}"
echo ""
echo -e "${BLUE}📋 Cleanup completed:${NC}"
echo "   🗑️  PID files removed"
echo "   🗑️  Temporary config files cleaned"
echo "   🔄  System ready for restart"
echo ""