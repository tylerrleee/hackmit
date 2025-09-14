# WebRTC Surgical Platform - Vercel Deployment Guide

## 🎯 Overview

This guide covers the **hybrid deployment strategy** for the WebRTC Surgical Platform:
- **Frontend**: Deployed on Vercel (static site)
- **Backend + WebRTC Services**: Deployed on Railway/Render (WebSocket support)

## ⚠️ Important Limitations

**Vercel does not support WebSockets or Socket.IO**, which are essential for this platform. Therefore, we use a hybrid approach where:
- Vercel hosts the React frontend for excellent global CDN performance
- Railway/Render hosts the Node.js backend and Python WebRTC bridge services

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Vercel         │    │  Railway/Render │    │  MongoDB Atlas  │
│                 │    │                 │    │                 │
│  React Frontend │───▶│  Node.js API    │───▶│  Database       │
│  Static Files   │    │  Socket.IO      │    │  User Data      │
│  PWA Support    │    │  WebRTC Bridge  │    │  Room Sessions  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📋 Prerequisites

- **Vercel Account**: [vercel.com](https://vercel.com)
- **Railway Account**: [railway.app](https://railway.app) (recommended)
- **Alternative**: Render account for backend services
- **MongoDB Atlas**: For production database
- **GitHub Repository**: Connected to deployment services

## 🚀 Step 1: Prepare the Project

### 1.1 Environment Configuration

The project includes deployment-specific configuration files:

```bash
# Frontend configurations
.env.vercel.production     # Vercel-specific settings
frontend/.env.vercel       # Frontend Vercel config

# Backend configurations  
.env.railway.production    # Railway backend config
.env.render.production     # Render backend config

# Deployment files
vercel.json               # Vercel deployment config
railway.json              # Railway service config
render-backend.yaml       # Render services config
```

### 1.2 Install Dependencies

```bash
# Frontend dependencies
cd frontend
npm install

# Backend dependencies
cd ../backend
npm install

# Python dependencies (for bridge service)
cd ../
pip install -r requirements.txt
```

## 🌐 Step 2: Deploy Backend Services (Railway)

### 2.1 Railway Setup

1. **Create Railway Account**: Visit [railway.app](https://railway.app)
2. **Connect GitHub**: Link your repository
3. **Create New Project**: Select "Deploy from GitHub repo"

### 2.2 Deploy Backend Service

1. **Create Backend Service**:
   ```bash
   # Railway will auto-detect Node.js
   # Root directory: /backend
   # Build command: npm ci --only=production
   # Start command: npm start
   ```

2. **Configure Environment Variables**:
   ```bash
   NODE_ENV=production
   PORT=3001
   CORS_ORIGIN=https://webrtc-surgical-platform.vercel.app
   JWT_SECRET=your_jwt_secret_here
   MONGODB_URI=mongodb+srv://...
   DEPLOYMENT_TARGET=railway
   ```

3. **Custom Domain** (optional):
   - Set up custom domain: `api.your-domain.com`
   - Or use Railway URL: `https://webrtc-surgical-backend.railway.app`

### 2.3 Deploy WebRTC Bridge Service

1. **Create Bridge Service**:
   ```bash
   # Railway will detect Python from requirements.txt
   # Root directory: / (project root)
   # Build command: pip install -r requirements.txt
   # Start command: python webrtc_bridge.py --port=$PORT
   ```

2. **Configure Environment Variables**:
   ```bash
   PYTHON_VERSION=3.11
   WS_PORT=8765
   WEBRTC_BACKEND_URL=https://webrtc-surgical-backend.railway.app
   ```

## 📱 Step 3: Deploy Frontend (Vercel)

### 3.1 Vercel Setup

1. **Create Vercel Account**: Visit [vercel.com](https://vercel.com)
2. **Import Project**: Connect GitHub repository
3. **Configure Build Settings**:
   ```bash
   Framework Preset: Create React App
   Root Directory: frontend
   Build Command: npm run vercel-build
   Output Directory: build
   Install Command: npm install
   ```

### 3.2 Environment Variables in Vercel Dashboard

Set these in **Project Settings → Environment Variables**:

```bash
# API Configuration
REACT_APP_API_URL=https://webrtc-surgical-backend.railway.app
REACT_APP_WS_URL=wss://webrtc-surgical-backend.railway.app
REACT_APP_AR_BRIDGE_URL=wss://webrtc-surgical-bridge.railway.app

# Deployment Configuration
REACT_APP_DEPLOYMENT_TARGET=vercel
REACT_APP_ENVIRONMENT=production
NODE_ENV=production

# Build Configuration
GENERATE_SOURCEMAP=false
CI=true
SKIP_PREFLIGHT_CHECK=true

# Feature Flags
REACT_APP_PWA_ENABLED=true
REACT_APP_ENABLE_OFFLINE_MODE=true
REACT_APP_ENABLE_TRANSLATION=true
```

### 3.3 Deploy

```bash
# Deploy via Git push or Vercel CLI
vercel --prod
```

## 🗄️ Step 4: Database Setup (MongoDB Atlas)

### 4.1 Create MongoDB Atlas Cluster

1. **Sign up**: [cloud.mongodb.com](https://cloud.mongodb.com)
2. **Create Cluster**: Choose M10+ for production
3. **Database Access**: Create user with `readWrite` permissions
4. **Network Access**: Add Railway/Render IP ranges
5. **Get Connection String**: Copy MongoDB URI

### 4.2 Initialize Database

```bash
# Run this script to set up initial collections
node backend/scripts/init-database.js
```

## 🔧 Step 5: Configuration and Testing

### 5.1 Update CORS Configuration

Ensure backend CORS is configured for Vercel:

```javascript
// backend/.env.railway.production
CORS_ORIGIN=https://webrtc-surgical-platform.vercel.app,https://your-custom-domain.com
```

### 5.2 Test Deployment

1. **Frontend Health Check**:
   ```bash
   cd frontend
   npm run health-check
   ```

2. **API Connectivity**:
   ```bash
   curl https://webrtc-surgical-backend.railway.app/api/health
   ```

3. **WebSocket Connection**:
   - Open browser dev tools
   - Visit your Vercel URL
   - Check network tab for successful WebSocket connections

## 🚨 Troubleshooting

### Common Issues

1. **CORS Errors**:
   ```bash
   # Add your Vercel domain to backend CORS_ORIGIN
   CORS_ORIGIN=https://your-app.vercel.app
   ```

2. **WebSocket Connection Failed**:
   ```bash
   # Ensure WebSocket URLs use wss:// not ws://
   REACT_APP_WS_URL=wss://your-backend.railway.app
   ```

3. **Build Failures**:
   ```bash
   # Check build logs in Vercel dashboard
   # Ensure all environment variables are set
   ```

### Health Checks

```bash
# Frontend
npm run health-check

# Backend API
curl https://your-backend/api/health

# WebSocket Bridge  
wscat -c wss://your-bridge-service
```

## 🎉 Step 6: Go Live

### 6.1 Custom Domains

1. **Vercel**: Project Settings → Domains → Add domain
2. **Railway**: Service Settings → Networking → Custom Domain

### 6.2 SSL Certificates

Both Vercel and Railway provide automatic SSL certificates for custom domains.

### 6.3 Monitoring

- **Vercel Analytics**: Built-in performance monitoring
- **Railway Metrics**: Service health and resource usage
- **MongoDB Atlas**: Database performance monitoring

## 📊 Performance Optimization

### Frontend (Vercel)

- ✅ Global CDN distribution
- ✅ Automatic static optimization
- ✅ Edge caching
- ✅ Progressive Web App support

### Backend (Railway)

- ✅ Auto-scaling based on traffic
- ✅ Zero-downtime deployments
- ✅ Built-in monitoring
- ✅ WebSocket support

## 🔄 CI/CD Pipeline

### Automatic Deployments

1. **Frontend**: Auto-deploys on push to `main` branch
2. **Backend**: Auto-deploys on push to `main` branch
3. **Environment Branches**: 
   - `staging` → Staging deployments
   - `main` → Production deployments

### Deployment Commands

```bash
# Manual deployment
vercel --prod                    # Frontend
railway up                       # Backend

# Environment-specific builds
npm run build:vercel            # Frontend for Vercel
npm run build:railway           # Backend for Railway
```

## 📞 Support

For deployment issues:

1. **Check logs**: Vercel/Railway dashboards
2. **Run health checks**: Use provided scripts
3. **Review CORS configuration**: Most common issue
4. **Verify environment variables**: All services configured

## 🎯 Production Checklist

- [ ] Frontend deployed to Vercel
- [ ] Backend API deployed to Railway/Render
- [ ] WebRTC bridge service deployed
- [ ] MongoDB Atlas configured
- [ ] Environment variables set
- [ ] Custom domains configured (optional)
- [ ] CORS properly configured
- [ ] Health checks passing
- [ ] SSL certificates active
- [ ] Monitoring setup

The WebRTC Surgical Platform is now ready for production use with global scale and reliability! 🚀