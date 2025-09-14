# Multi-Location Setup Guide

This guide explains how to set up the WebRTC Surgical Platform for communication between two computers at different locations using Ngrok tunneling.

## Overview

The system now supports two modes:
- **Local Mode**: All services run on localhost (development)
- **External Mode**: Services exposed via Ngrok tunnels (multi-location)

## Quick Start

### 1. External Mode (Multi-Location)

For remote access and collaboration:

```bash
# Set your Ngrok auth token (get from https://dashboard.ngrok.com/get-started/your-authtoken)
export NGROK_AUTH_TOKEN="your_token_here"

# Start with Ngrok tunnels
./start-external.sh
```

This will:
- Create Ngrok tunnels for all services
- Update configuration files automatically
- Start all services with external URLs
- Display public URLs for sharing

### 2. Local Mode (Development)

For local development only:

```bash
# Start in local mode
./start-local.sh
```

Services will be available at:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- WebRTC Bridge: ws://localhost:8765

### 3. Stop Services

To stop all running services:

```bash
./stop-services.sh
```

## Detailed Setup Instructions

### Prerequisites

1. **Install Ngrok**:
   ```bash
   # macOS
   brew install ngrok/ngrok/ngrok
   
   # Linux
   # Download from https://ngrok.com/download
   ```

2. **Get Ngrok Auth Token**:
   - Sign up at https://ngrok.com/
   - Get your auth token from: https://dashboard.ngrok.com/get-started/your-authtoken
   - Set the environment variable: `export NGROK_AUTH_TOKEN="your_token_here"`

3. **Install Dependencies**:
   ```bash
   # Node.js dependencies
   npm install
   cd backend && npm install && cd ..
   cd frontend && npm install && cd ..
   
   # Python dependencies
   pip install websockets aiohttp python-dotenv requests
   ```

### External Mode Configuration

When you run `./start-external.sh`, the system automatically:

1. **Creates Ngrok Tunnels**:
   - Backend API: `https://abc123.ngrok-free.app`
   - Frontend: `https://def456.ngrok-free.app`
   - WebRTC Bridge: `wss://ghi789.ngrok-free.app`
   - HTTP API: `https://jkl012.ngrok-free.app`

2. **Updates Configuration**:
   - Generates `.env.external` with tunnel URLs
   - Updates backend CORS settings
   - Configures frontend for external API calls
   - Sets up bridge service with external endpoints

3. **Displays Public URLs** for sharing with remote users

### Multi-Location Usage

#### Location A (Doctor/Expert)
1. Run the system in external mode: `./start-external.sh`
2. Share the frontend URL with Location B
3. Login and create a consultation room
4. Share room ID with Location B

#### Location B (Field Medic)
1. Open the shared frontend URL in browser
2. Login with field medic credentials
3. Join the room using the room ID from Location A
4. Start AR annotation system (if available)

### Configuration Files

The system uses environment-based configuration:

- **`.env`**: Base configuration (local defaults)
- **`.env.external`**: External/Ngrok configuration (auto-generated)
- **`ngrok.yml`**: Ngrok tunnel settings
- **`ngrok-config.json`**: Runtime configuration (auto-generated)

### Architecture

```
Location A (Doctor)                Location B (Field Medic)
┌─────────────────────┐           ┌─────────────────────┐
│  Frontend (React)   │           │   AR Field Device  │
│  Backend (Node.js)  │           │   OR Web Browser   │
│  Bridge (Python)    │           │                     │
└─────────┬───────────┘           └─────────┬───────────┘
          │                                 │
          └─────────── Internet ────────────┘
                   (Ngrok Tunnels)
```

### URL Examples

After starting external mode, you'll see URLs like:
```
🎯 Ngrok Tunnel Configuration:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 Frontend URL:     https://abc123.ngrok-free.app
🔧 Backend API URL:  https://def456.ngrok-free.app
🌐 Bridge WebSocket: wss://ghi789.ngrok-free.app
🔌 Bridge HTTP API:  https://jkl012.ngrok-free.app
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Testing Multi-Location Setup

1. **Test Backend API**:
   ```bash
   curl https://your-backend-url.ngrok-free.app/health
   ```

2. **Test Frontend Access**:
   ```bash
   open https://your-frontend-url.ngrok-free.app
   ```

3. **Test WebRTC Bridge**:
   ```bash
   python test_ar_client_live.py --bridge-url wss://your-bridge-url.ngrok-free.app
   ```

### Troubleshooting

#### Common Issues

1. **"NGROK_AUTH_TOKEN not found"**:
   - Set your auth token: `export NGROK_AUTH_TOKEN="your_token"`
   - Get token from: https://dashboard.ngrok.com/get-started/your-authtoken

2. **Tunnel creation fails**:
   - Check if ports are already in use
   - Ensure services are running before creating tunnels
   - Verify Ngrok account has available tunnels

3. **CORS errors in browser**:
   - Check that frontend and backend URLs are correctly configured
   - Verify `.env.external` was generated properly

4. **WebSocket connection fails**:
   - Ensure bridge service is running on correct port
   - Check WebSocket URL format (wss:// not ws://)

#### Debug Commands

```bash
# Check Ngrok status
ngrok config check
ngrok tunnel list

# View service logs
tail -f backend.log
tail -f bridge.log

# Check running processes
ps aux | grep -E "(npm|python|ngrok)"

# Test connectivity
curl -I https://your-backend-url.ngrok-free.app/health
```

### Security Considerations

- Ngrok tunnels are public - use authentication
- Change default credentials before external deployment
- Monitor Ngrok dashboard for tunnel usage
- Use HTTPS/WSS for all external connections

### Performance Tips

- Use paid Ngrok plan for better performance
- Choose Ngrok region closest to both locations
- Monitor latency in video calls
- Consider dedicated VPS for production use

## Advanced Configuration

### Custom Ngrok Configuration

Edit `ngrok.yml` to customize tunnel settings:

```yaml
tunnels:
  backend:
    proto: http
    addr: 3001
    hostname: my-custom-domain.ngrok.app  # Custom domain
    bind_tls: true
```

### Environment Variables

Customize behavior with environment variables:

```bash
export NGROK_REGION=eu          # Use EU region
export EXTERNAL_TIMEOUT=120000  # Increase timeout
export HEARTBEAT_INTERVAL=15000 # More frequent heartbeat
```

### Manual Tunnel Management

For advanced users who want to manage tunnels manually:

```bash
# Start tunnels manually
ngrok start --all --config ngrok.yml

# Update configuration with custom URLs
node -e "
const config = require('./external_config');
config.updateExternalUrls({
  backend: 'https://your-backend.ngrok.app',
  frontend: 'https://your-frontend.ngrok.app'
});
"
```

## Support

For issues or questions:
1. Check logs in console output
2. Verify all prerequisites are installed
3. Test individual components first
4. Check Ngrok dashboard for tunnel status

The system is designed to gracefully handle network interruptions and automatically reconnect when possible.