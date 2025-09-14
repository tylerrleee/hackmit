# Testing the WebRTC Surgical Platform Implementation

## 🧪 Quick Start Testing Guide

### 1. Prerequisites Setup

First, install the required dependencies:

```bash
# Backend setup
cd webrtc_surgical_platform/backend
npm install

# Frontend setup  
cd ../frontend
npm install

# Python AI services (optional for basic testing)
cd ..
pip install -r requirements.txt
```

### 2. Environment Configuration

```bash
# Backend - copy and configure environment
cd backend
cp .env.example .env

# Edit .env file with your settings:
# - Set JWT_SECRET to a secure random string
# - Configure database connections if needed
# - Set CORS_ORIGIN to http://localhost:3000
```

### 3. Start the Services

#### Terminal 1 - Backend Server
```bash
cd webrtc_surgical_platform/backend
npm run dev
```
Expected output: `🏥 WebRTC Surgical Platform Server running on port 3001`

#### Terminal 2 - Frontend (React PWA)
```bash
cd webrtc_surgical_platform/frontend  
npm start
```
Expected output: `Local: http://localhost:3000`

### 4. Basic Functionality Tests

#### Test 1: Server Health Check
```bash
curl http://localhost:3001/health
```
Expected: `{"status": "healthy", "timestamp": "...", "version": "1.0.0"}`

#### Test 2: API Documentation
Visit: http://localhost:3001/api
Expected: JSON with API endpoint information

#### Test 3: Authentication System
```bash
# Test login with sample user
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "dr.smith",
    "password": "SecurePass123!"
  }'
```
Expected: JSON with user info and access token

#### Test 4: Expert Matching
```bash
# First get access token from login, then:
curl -X POST http://localhost:3001/api/matching/find-experts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "patientInfo": {
      "currentCondition": "cardiac surgery consultation",
      "severity": "moderate"
    },
    "caseType": "consultation",
    "urgency": "normal",
    "requiredSpecializations": ["cardiothoracic_surgery"]
  }'
```
Expected: JSON with matched experts list

#### Test 5: AI Processing
```bash
# Test AI service health
curl -X GET http://localhost:3001/api/ai/health \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```
Expected: AI service status and loaded models info

### 5. Frontend Web Interface Tests

Visit http://localhost:3000 and test:

1. **Login Page**: Try logging in with sample credentials
2. **Dashboard**: Verify expert lists load
3. **Video Call Interface**: Test camera/microphone permissions
4. **Room Creation**: Create a consultation room
5. **WebRTC Connection**: Test peer-to-peer connection

### 6. WebSocket Connection Tests

Open browser console at http://localhost:3000 and run:

```javascript
// Test WebSocket signaling connection
const socket = io('http://localhost:3001', {
  auth: { token: 'YOUR_ACCESS_TOKEN' }
});

socket.on('connect', () => {
  console.log('✅ WebSocket connected');
  
  // Test room joining
  socket.emit('join-room', {
    roomId: 'test-room-123',
    roomType: 'consultation'
  });
});

socket.on('room-joined', (data) => {
  console.log('✅ Joined room:', data);
});
```

### 7. Advanced Integration Tests

#### Test WebRTC Peer Connection
```javascript
// In browser console
const pc = new RTCPeerConnection({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

// Test ICE gathering
pc.onicecandidate = (event) => {
  if (event.candidate) {
    console.log('✅ ICE candidate generated');
  }
};

// Create offer to test peer connection setup
pc.createOffer().then(offer => {
  console.log('✅ WebRTC offer created');
  return pc.setLocalDescription(offer);
});
```

#### Test AI Video Analysis
```bash
# Upload a test image for AI analysis
curl -X POST http://localhost:3001/api/ai/analyze-file \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -F "mediaFile=@test_image.jpg" \
  -F "roomId=test-room" \
  -F "analysisType=comprehensive"
```

### 8. Performance & Load Testing

#### Simple Load Test
```bash
# Test concurrent connections (requires 'ab' tool)
ab -n 100 -c 10 http://localhost:3001/health

# Test authentication load
ab -n 50 -c 5 -p login_data.json -T application/json http://localhost:3001/api/auth/login
```

### 9. Error Handling Tests

```bash
# Test invalid authentication
curl -X GET http://localhost:3001/api/rooms/user/rooms \
  -H "Authorization: Bearer invalid_token"

# Test missing required fields
curl -X POST http://localhost:3001/api/matching/find-experts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{}'
```

### 10. Mobile/PWA Testing

1. Open http://localhost:3000 on mobile browser
2. Test "Add to Home Screen" functionality
3. Verify offline capabilities
4. Test camera/microphone access on mobile

## 🔍 Troubleshooting Common Issues

### Issue: Backend fails to start
**Solution**: Check that port 3001 is available and .env is configured

### Issue: WebRTC connection fails
**Solution**: Ensure browser has camera/microphone permissions and HTTPS in production

### Issue: AI models not loading
**Solution**: This is expected - mock models are used for development. Real models would be loaded in production.

### Issue: Authentication fails
**Solution**: Verify JWT_SECRET is set in .env and sample users are initialized

### Issue: CORS errors
**Solution**: Ensure CORS_ORIGIN in .env matches your frontend URL

## 📊 Success Indicators

✅ **Backend Health**: Server starts on port 3001
✅ **Frontend Access**: React app loads at localhost:3000  
✅ **Authentication**: Can login with sample users
✅ **WebSocket**: Real-time signaling connections work
✅ **Expert Matching**: AI finds and ranks medical experts
✅ **WebRTC**: Peer connections establish successfully
✅ **Security**: JWT tokens validate and expire properly
✅ **AI Pipeline**: Mock AI processing completes

## 🚀 Production Readiness Checklist

- [ ] Replace mock AI models with real trained models
- [ ] Set up production database (MongoDB/PostgreSQL)
- [ ] Configure TURN server for NAT traversal
- [ ] Set up SSL certificates for HTTPS
- [ ] Configure production logging and monitoring
- [ ] Set up proper SMTP for password resets
- [ ] Configure AWS S3 for file storage
- [ ] Set up Redis for caching and sessions
- [ ] Configure production environment variables
- [ ] Set up CI/CD pipeline for deployments

This implementation provides a solid foundation that can be extended with real medical data and models for production use!