#!/bin/bash

# WebRTC Surgical Platform - Backend Startup Script
echo "🏥 Starting WebRTC Surgical Platform Backend..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Change to backend directory
cd backend

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Copying from .env.example..."
    cp .env.example .env
    echo "⚠️  Please configure your .env file before production use!"
fi

# Create logs directory if it doesn't exist
if [ ! -d "logs" ]; then
    mkdir logs
fi

echo "✅ Starting backend server on port 3001..."
echo "🔗 Server will be available at: http://localhost:3001"
echo "📚 API docs available at: http://localhost:3001/api"
echo ""
echo "Press Ctrl+C to stop the server"
echo "==============================================="

# Start the server
npm run dev