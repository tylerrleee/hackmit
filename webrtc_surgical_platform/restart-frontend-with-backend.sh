#!/bin/bash
# Restart frontend with external backend URL
cd frontend
pkill -f "npm start" || true
sleep 2
echo "Starting frontend with backend: https://e7805d656042.ngrok-free.app"
REACT_APP_API_URL="https://e7805d656042.ngrok-free.app" npm start
