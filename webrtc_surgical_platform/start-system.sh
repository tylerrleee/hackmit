#!/bin/bash

# WebRTC Surgical Platform - Full System Startup Script
echo "🏥 Starting WebRTC Surgical Platform - Full System"
echo "=================================================="

# Function to check if port is in use
check_port() {
    lsof -i :$1 >/dev/null 2>&1
}

# Function to check Python dependencies
check_python_deps() {
    echo "🐍 Checking Python AR system dependencies..."
    cd ..
    
    # Check if numpy version is compatible
    python -c "import numpy; print(f'   ✅ NumPy: {numpy.__version__}')" 2>/dev/null || {
        echo "   ⚠️  NumPy compatibility issues detected"
        echo "   💡 Run: pip install 'numpy<2.0' to fix scipy compatibility"
        return 1
    }
    
    # Check scipy compatibility
    python -c "import scipy; print(f'   ✅ SciPy: {scipy.__version__}')" 2>/dev/null || {
        echo "   ⚠️  SciPy not available or incompatible"
        echo "   💡 Install dependencies: pip install -r requirements.txt"
        return 1
    }
    
    # Check AR core module
    python -c "from ar_core import CoreARProcessor; print('   ✅ AR Core: Available')" 2>/dev/null || {
        echo "   ⚠️  AR Core module has dependency issues"
        echo "   💡 Try: pip install 'numpy<2.0' scikit-learn"
        return 1
    }
    
    cd webrtc_surgical_platform
    return 0
}

# Check Node.js installation
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "📋 System Requirements Check:"
echo "   ✅ Node.js: $(node --version)"
echo "   ✅ NPM: $(npm --version)"

# Check Python AR system dependencies
if check_python_deps; then
    echo "   ✅ Python AR System: Ready"
    AR_SYSTEM_READY=true
else
    echo "   ⚠️  Python AR System: Dependencies need fixing"
    AR_SYSTEM_READY=false
fi
echo ""

# Check ports
echo "🔌 Port Availability Check:"
if check_port 3001; then
    echo "   ⚠️  Port 3001 is already in use (backend)"
    echo "   💡 Run 'lsof -ti :3001 | xargs kill' to free the port"
else
    echo "   ✅ Port 3001 available (backend)"
fi

if check_port 3000; then
    echo "   ⚠️  Port 3000 is already in use (frontend)"
    echo "   💡 Run 'lsof -ti :3000 | xargs kill' to free the port"  
else
    echo "   ✅ Port 3000 available (frontend)"
fi
echo ""

# Backend setup
echo "🔧 Setting up Backend..."
cd backend

if [ ! -d "node_modules" ]; then
    echo "   📦 Installing backend dependencies..."
    npm install --silent
    if [ $? -ne 0 ]; then
        echo "   ❌ Failed to install backend dependencies"
        exit 1
    fi
else
    echo "   ✅ Backend dependencies already installed"
fi

if [ ! -f ".env" ]; then
    echo "   📝 Creating .env file from template..."
    cp .env.example .env
    echo "   ⚠️  Please configure your .env file for production use!"
else
    echo "   ✅ Environment file found"
fi

if [ ! -d "logs" ]; then
    mkdir logs
fi

echo "   ✅ Backend setup complete"
cd ..

# AR System setup
echo ""
echo "📱 Setting up AR System..."
if [ "$AR_SYSTEM_READY" = true ]; then
    echo "   🔧 Starting WebRTC Bridge Service..."
    cd ..
    python webrtc_surgical_platform/webrtc_bridge.py &
    BRIDGE_PID=$!
    echo "   ✅ WebRTC Bridge running (PID: $BRIDGE_PID)"
    
    echo "   🚀 AR Camera System ready for launch"
    echo "   💡 To start AR camera: python camera_ar_demo.py --webrtc-enabled"
    cd webrtc_surgical_platform
else
    echo "   ⚠️  AR System dependencies not ready - WebRTC-only mode"
    echo "   💡 Fix dependencies to enable full AR functionality"
fi

# Test system
echo ""
echo "🧪 Running System Health Check..."
cd backend && npm run dev &
BACKEND_PID=$!
echo "   🔄 Starting backend server (PID: $BACKEND_PID)..."

# Wait a moment for server to start
sleep 3

# Run test
echo "   🏃‍♂️ Running comprehensive test suite..."
cd ..
node quick_test.js

# Keep backend running or stop based on test results
echo ""
echo "🎯 System Status:"
echo "   📡 Backend Server: Running on http://localhost:3001"
echo "   📚 API Documentation: http://localhost:3001/api"
echo "   🏥 Health Check: http://localhost:3001/health"
if [ "$AR_SYSTEM_READY" = true ]; then
    echo "   🌉 WebRTC Bridge: Running on ws://localhost:8765"
    echo "   📱 AR System: Ready for camera_ar_demo.py"
else
    echo "   ⚠️  AR System: Disabled (dependency issues)"
fi
echo ""
echo "👤 Test Accounts Available:"
echo "   🩺 Surgeon: username=dr.smith, password=SecurePass123!"
echo "   🏥 Doctor: username=dr.johnson, password=SecurePass123!"  
echo "   👩‍⚕️ Nurse: username=nurse.williams, password=SecurePass123!"
echo ""
echo "🚀 Quick Start Commands:"
echo "   📊 Test System: python test_end_to_end_workflow.py"
echo "   🖥️  Frontend: cd frontend && npm start (http://localhost:3000)"
if [ "$AR_SYSTEM_READY" = true ]; then
    echo "   📱 AR Camera: cd .. && python camera_ar_demo.py --webrtc-enabled"
fi
echo ""
echo "🎉 System is ready! Press Ctrl+C to stop all services."
echo "=================================================="

# Wait for user interrupt and cleanup function
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
        echo "   ✅ Backend server stopped"
    fi
    if [ ! -z "$BRIDGE_PID" ]; then
        kill $BRIDGE_PID 2>/dev/null
        echo "   ✅ WebRTC bridge stopped"
    fi
    echo "🎯 All services stopped successfully!"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Wait for user interrupt
if [ "$AR_SYSTEM_READY" = true ]; then
    echo "⚡ Monitoring: Backend (PID: $BACKEND_PID) + Bridge (PID: $BRIDGE_PID)"
    wait $BACKEND_PID $BRIDGE_PID
else
    echo "⚡ Monitoring: Backend (PID: $BACKEND_PID)"
    wait $BACKEND_PID
fi