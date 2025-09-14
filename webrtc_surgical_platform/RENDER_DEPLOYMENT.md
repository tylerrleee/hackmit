# Render.com Deployment Guide - WebRTC Surgical Platform

## Why Render.com?

Render.com offers the **fastest path to production** for your WebRTC platform:
- ✅ Direct GitHub integration
- ✅ Automatic Docker builds
- ✅ Free tier available for testing
- ✅ PostgreSQL/Redis included
- ✅ SSL certificates automatic
- ✅ No DevOps expertise required

## Step-by-Step Deployment

### 1. Push Code to GitHub
```bash
# First, commit all your Docker work:
git add .
git commit -m "Add Docker containerization and deployment infrastructure"
git push origin LAB5

# Or push to main for production:
git push origin main
```

### 2. Create Render Account
1. Go to https://render.com
2. Sign up with your GitHub account
3. Grant access to your repository

### 3. Create Blueprint Deployment

Create `render.yaml` in your root directory:

```yaml
services:
  # Backend API Service
  - type: web
    name: surgical-platform-backend
    env: docker
    dockerfilePath: ./backend/Dockerfile
    plan: starter  # Free tier for testing
    region: ohio   # US East
    buildCommand: ""
    startCommand: ""
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3001
      - key: MONGODB_URI
        value: your-mongodb-atlas-connection-string
      - key: JWT_SECRET
        generateValue: true
      - key: CORS_ORIGIN
        value: https://surgical-platform-frontend.onrender.com
      - key: STUN_SERVER_URL
        value: stun:stun.relay.metered.ca:80
      - key: TURN_SERVER_URL  
        value: turn:a.relay.metered.ca:80
      - key: TURN_USERNAME
        value: your-metered-username
      - key: TURN_CREDENTIAL
        value: your-metered-password
    healthCheckPath: /health

  # Frontend Web Service  
  - type: web
    name: surgical-platform-frontend
    env: docker
    dockerfilePath: ./frontend/Dockerfile
    plan: starter
    region: ohio
    buildCommand: ""
    startCommand: ""
    envVars:
      - key: REACT_APP_API_URL
        value: https://surgical-platform-backend.onrender.com
      - key: REACT_APP_WEBSOCKET_URL
        value: wss://surgical-platform-bridge.onrender.com
    routes:
      - type: redirect
        source: /*
        destination: https://surgical-platform-frontend.onrender.com/:splat

  # WebRTC Bridge Service
  - type: web  
    name: surgical-platform-bridge
    env: docker
    dockerfilePath: ./webrtc_bridge/Dockerfile
    plan: starter
    region: ohio
    buildCommand: ""
    startCommand: ""
    envVars:
      - key: PYTHONPATH
        value: /app
      - key: PYTHONUNBUFFERED
        value: 1
```

### 4. Alternative: Manual Service Creation

If render.yaml doesn't work, create services manually:

#### Backend Service:
```bash
# Service Type: Web Service
# Connect Repository: your-github-username/webrtc_surgical_platform
# Branch: LAB5 (or main)
# Root Directory: backend
# Environment: Docker
# Dockerfile Path: ./backend/Dockerfile
# Plan: Starter (Free)
```

#### Frontend Service:
```bash
# Service Type: Web Service  
# Connect Repository: your-github-username/webrtc_surgical_platform
# Branch: LAB5 (or main)
# Root Directory: frontend
# Environment: Docker
# Dockerfile Path: ./frontend/Dockerfile
# Plan: Starter (Free)
```

#### WebRTC Bridge Service:
```bash
# Service Type: Web Service
# Connect Repository: your-github-username/webrtc_surgical_platform  
# Branch: LAB5 (or main)
# Root Directory: webrtc_bridge
# Environment: Docker
# Dockerfile Path: ./webrtc_bridge/Dockerfile
# Plan: Starter (Free)
```

### 5. Environment Variables Setup

For each service, add these environment variables in Render dashboard:

#### Backend Environment Variables:
```bash
NODE_ENV=production
PORT=3001
MONGODB_URI=your-mongodb-atlas-connection-string
JWT_SECRET=auto-generated-by-render
CORS_ORIGIN=https://surgical-platform-frontend.onrender.com
STUN_SERVER_URL=stun:stun.relay.metered.ca:80
TURN_SERVER_URL=turn:a.relay.metered.ca:80
TURN_USERNAME=your-metered-username
TURN_CREDENTIAL=your-metered-password
HIPAA_AUDIT_ENABLED=true
DATA_RETENTION_DAYS=2555
LOG_LEVEL=info
```

#### Frontend Environment Variables:
```bash
REACT_APP_API_URL=https://surgical-platform-backend.onrender.com
REACT_APP_WEBSOCKET_URL=wss://surgical-platform-bridge.onrender.com
NODE_ENV=production
```

### 6. Deploy Services

1. **Backend**: Will be available at `https://surgical-platform-backend.onrender.com`
2. **Frontend**: Will be available at `https://surgical-platform-frontend.onrender.com`  
3. **Bridge**: Will be available at `wss://surgical-platform-bridge.onrender.com`

### 7. Verify Deployment

```bash
# Test backend health:
curl https://surgical-platform-backend.onrender.com/health

# Test frontend:
curl https://surgical-platform-frontend.onrender.com/health

# Test WebRTC bridge:
curl https://surgical-platform-bridge.onrender.com/health
```

### 8. Custom Domain (Optional)

1. In Render dashboard → Settings → Custom Domains
2. Add your domain: `surgical-platform.com`
3. Update DNS records as instructed
4. SSL certificate will be automatically provisioned

## Expected Deployment Timeline

- **Setup Time**: 10-15 minutes
- **Build Time**: 5-10 minutes per service
- **Total Go-Live Time**: 20-30 minutes

## Free Tier Limitations

- **750 hours/month** per service (sufficient for MVP testing)
- **Sleep after 15 minutes** of inactivity
- **10GB bandwidth/month** per service
- **No custom domains** on free tier

## Production Scaling

- **Starter Plan**: $7/month per service (no sleep, custom domains)
- **Standard Plan**: $25/month per service (more CPU/memory)
- **Pro Plan**: $85/month per service (dedicated resources)

## Troubleshooting

### Build Failures:
1. Check Render build logs
2. Verify Dockerfile syntax
3. Ensure dependencies are correct

### Service Connection Issues:
1. Verify environment variables
2. Check CORS settings
3. Confirm service URLs are correct

Your WebRTC Surgical Platform will be **live and accessible worldwide** after Render deployment!