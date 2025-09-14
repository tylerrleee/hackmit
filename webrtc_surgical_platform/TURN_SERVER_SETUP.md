# TURN Server Setup for WebRTC Surgical Platform

## Why TURN Server is Required

WebRTC needs TURN servers for users behind NAT/firewalls to connect. For production deployment, this is **essential** for reliable video calls.

## Quick Setup Options

### Option 1: Metered.ca (Recommended - Easiest)
```bash
# Sign up at: https://www.metered.ca/tools/openrelay/
# Free tier: 50GB/month

# Get your TURN credentials:
STUN_SERVER_URL=stun:stun.relay.metered.ca:80
TURN_SERVER_URL=turn:a.relay.metered.ca:80
TURN_USERNAME=your-metered-username
TURN_CREDENTIAL=your-metered-password

# Alternative servers:
TURN_SERVER_URL=turn:a.relay.metered.ca:80?transport=tcp
TURN_SERVER_URL=turn:a.relay.metered.ca:443?transport=tcp
```

### Option 2: Twilio STUN/TURN (Enterprise)
```bash
# Sign up at: https://www.twilio.com/stun-turn
# Pay-per-use pricing

# Twilio ICE servers:
STUN_SERVER_URL=stun:global.stun.twilio.com:3478
TURN_SERVER_URL=turn:global.turn.twilio.com:3478
TURN_USERNAME=your-twilio-account-sid
TURN_CREDENTIAL=your-twilio-auth-token
```

### Option 3: Xirsys (WebRTC Focused)
```bash
# Sign up at: https://xirsys.com
# Free tier: 500MB/month

# Xirsys ICE servers (get from dashboard):
STUN_SERVER_URL=stun:stun.xirsys.com
TURN_SERVER_URL=turn:stun.xirsys.com:80
TURN_USERNAME=your-xirsys-username  
TURN_CREDENTIAL=your-xirsys-credential
```

### Option 4: Self-Hosted coturn (Advanced)
```bash
# For AWS EC2 or similar:
# 1. Launch Ubuntu 22.04 instance
# 2. Install coturn:

sudo apt update && sudo apt install coturn

# Configure /etc/turnserver.conf:
listening-port=3478
fingerprint
lt-cred-mech
user=surgical:SecurePassword123
realm=surgical-platform.com
log-file=/var/log/turnserver.log

# Start coturn:
sudo systemctl enable coturn
sudo systemctl start coturn

# Your TURN config:
TURN_SERVER_URL=turn:your-ec2-ip:3478
TURN_USERNAME=surgical
TURN_CREDENTIAL=SecurePassword123
```

## Testing TURN Server

### 1. Online TURN Test Tool
```bash
# Use: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
# Enter your TURN server details to test connectivity
```

### 2. Command Line Test
```bash
# Test STUN server:
npm install -g get-stun-binding-address
get-stun-binding-address stun.relay.metered.ca 80

# Test TURN server:
curl -X POST https://networktest.twilio.com/v1/test-ice-servers \
  -d "servers[0][urls]=turn:your-turn-server:3478" \
  -d "servers[0][username]=your-username" \
  -d "servers[0][credential]=your-credential"
```

## Integration with Your Platform

### Update .env.production
```bash
# Add to your .env.production file:
STUN_SERVER_URL=stun:stun.relay.metered.ca:80
TURN_SERVER_URL=turn:a.relay.metered.ca:80
TURN_USERNAME=your-metered-username
TURN_CREDENTIAL=your-metered-password
```

### Backend Configuration
The backend already supports TURN servers in:
- `backend/src/config/webrtcConfig.js`
- Environment variables are automatically used

## Recommended for Go-Live

**For immediate deployment: Use Metered.ca**
1. Sign up at https://www.metered.ca/tools/openrelay/
2. Get free TURN credentials
3. Add to your environment variables
4. Deploy immediately

**Total setup time: 2 minutes**

## Production Scaling

- **Free tiers**: Good for MVP testing (50-500MB/month)
- **Paid tiers**: $0.40-2.00 per GB for production traffic
- **Self-hosted**: Most cost-effective for high volume (>100GB/month)

Your TURN server setup ensures WebRTC video calls work reliably for all users!