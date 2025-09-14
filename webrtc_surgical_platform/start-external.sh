#!/bin/bash
#
# Start WebRTC Surgical Platform in External Mode (with Ngrok tunnels)
# This script sets up Ngrok tunnels for remote access
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

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"

# Check if Ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}❌ Ngrok is not installed. Please install it first:${NC}"
    echo "   macOS: brew install ngrok/ngrok/ngrok"
    echo "   Linux: Download from https://ngrok.com/download"
    exit 1
fi

# Check if auth token is set
if [ -z "$NGROK_AUTH_TOKEN" ]; then
    echo -e "${RED}❌ NGROK_AUTH_TOKEN environment variable is not set.${NC}"
    echo "Please set your Ngrok auth token:"
    echo "   export NGROK_AUTH_TOKEN=\"your_token_here\""
    echo "Get your token from: https://dashboard.ngrok.com/get-started/your-authtoken"
    exit 1
fi

# Check Node.js dependencies
echo -e "${YELLOW}📦 Checking Node.js dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    echo "Installing root dependencies..."
    npm install
fi

if [ ! -d "backend/node_modules" ]; then
    echo "Installing backend dependencies..."
    cd backend && npm install && cd ..
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

# Check Python dependencies
echo -e "${YELLOW}🐍 Checking Python dependencies...${NC}"
if ! python -c "import websockets, aiohttp" &> /dev/null; then
    echo "Installing Python dependencies..."
    pip install websockets aiohttp python-dotenv requests
fi

echo -e "${GREEN}✅ Prerequisites check completed${NC}"
echo ""

# Set external mode environment
export NODE_ENV=external
export EXTERNAL_MODE=true

echo -e "${YELLOW}🚀 Starting Ngrok tunnel setup...${NC}"
echo "This will:"
echo "   1. Create Ngrok tunnels for all services"
echo "   2. Update configuration files dynamically"
echo "   3. Start all services with external URLs"
echo ""
echo -e "${YELLOW}⏳ This may take 30-60 seconds to complete...${NC}"
echo ""

# Start the automated Ngrok setup
node setup-ngrok.js