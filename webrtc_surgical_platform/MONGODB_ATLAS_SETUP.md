# MongoDB Atlas Setup for WebRTC Surgical Platform

## Quick Setup Guide

### 1. Create MongoDB Atlas Account
1. Go to https://cloud.mongodb.com
2. Sign up or log in
3. Create a new organization: "WebRTC Surgical Platform"

### 2. Create Production Database
```bash
# Cluster Configuration:
- Cluster Name: surgical-platform-prod
- Cloud Provider: AWS
- Region: US East (N. Virginia) us-east-1  
- Cluster Tier: M10 (2GB RAM) - Production ready
- Storage: 10GB SSD
```

### 3. Database Security
```bash
# Create Database User:
Username: surgical_admin
Password: [Generate secure password]
Built-in Role: Atlas Admin

# Network Access:
Add IP Address: 0.0.0.0/0 (Allow access from anywhere)
# Note: In production, restrict to your deployment IPs
```

### 4. Get Connection String
```bash
# Connection String Format:
mongodb+srv://surgical_admin:<password>@surgical-platform-prod.xxxxx.mongodb.net/surgical_platform?retryWrites=true&w=majority

# Replace:
- <password> with your actual password
- xxxxx with your cluster identifier
```

### 5. Initialize Database
```javascript
// Run this in MongoDB Atlas Data Explorer or MongoDB Compass:
use surgical_platform

// Create collections and indexes (copy from mongo-init.js)
db.createCollection('users');
db.users.createIndex({ "username": 1 }, { unique: true });
db.users.createIndex({ "email": 1 }, { unique: true });

db.createCollection('rooms');
db.rooms.createIndex({ "roomId": 1 }, { unique: true });

db.createCollection('sessions');
db.sessions.createIndex({ "roomId": 1 });

db.createCollection('annotations');  
db.annotations.createIndex({ "roomId": 1 });
```

### 6. Add Test Data
```javascript
// Insert default users (run in Atlas Data Explorer):
db.users.insertMany([
  {
    username: "dr.smith",
    email: "dr.smith@hospital.com", 
    passwordHash: "$2b$12$rQV8Zh.4r1YAJrG3qX6.HOykJGWVhHaHhgZ3J1UjzlHdv2VJ8bKBe",
    role: "surgeon",
    firstName: "Dr. John",
    lastName: "Smith",
    isActive: true,
    permissions: ["video_call", "ar_annotations", "room_creation"],
    createdAt: new Date()
  },
  {
    username: "dr.johnson",
    email: "dr.johnson@hospital.com",
    passwordHash: "$2b$12$rQV8Zh.4r1YAJrG3qX6.HOykJGWVhHaHhgZ3J1UjzlHdv2VJ8bKBe", 
    role: "doctor",
    firstName: "Dr. Sarah", 
    lastName: "Johnson",
    isActive: true,
    permissions: ["video_call", "ar_annotations", "room_join"],
    createdAt: new Date()
  },
  {
    username: "nurse.williams",
    email: "nurse.williams@hospital.com",
    passwordHash: "$2b$12$rQV8Zh.4r1YAJrG3qX6.HOykJGWVhHaHhgZ3J1UjzlHdv2VJ8bKBe",
    role: "nurse", 
    firstName: "Mary",
    lastName: "Williams",
    isActive: true,
    permissions: ["video_call", "room_join"],
    createdAt: new Date()
  }
]);
```

## ✅ Verification Steps

1. **Test Connection**: Use MongoDB Compass to connect with connection string
2. **Verify Collections**: Ensure users, rooms, sessions collections exist
3. **Test User Login**: Verify test accounts work with password: `SecurePass123!`

## 🔒 Production Security

```bash
# After initial setup, restrict network access:
1. Remove 0.0.0.0/0 access
2. Add specific IP ranges for your cloud deployment
3. Enable database audit logging
4. Set up monitoring alerts
```

Your MongoDB Atlas database is now ready for production deployment!