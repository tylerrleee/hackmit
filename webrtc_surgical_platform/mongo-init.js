// MongoDB Initialization Script for WebRTC Surgical Platform
// This script sets up the database with initial collections and indexes

print('🚀 Initializing WebRTC Surgical Platform Database...');

// Switch to the surgical platform database
db = db.getSiblingDB('surgical_platform');

// Create collections with proper indexes
print('📋 Creating collections and indexes...');

// Users collection with indexes for authentication
db.createCollection('users');
db.users.createIndex({ "username": 1 }, { unique: true });
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "role": 1 });
db.users.createIndex({ "createdAt": 1 });

// Rooms collection for video consultation sessions
db.createCollection('rooms');
db.rooms.createIndex({ "roomId": 1 }, { unique: true });
db.rooms.createIndex({ "createdBy": 1 });
db.rooms.createIndex({ "status": 1 });
db.rooms.createIndex({ "createdAt": 1 });

// Sessions collection for tracking video calls
db.createCollection('sessions');
db.sessions.createIndex({ "roomId": 1 });
db.sessions.createIndex({ "participantIds": 1 });
db.sessions.createIndex({ "startTime": 1 });
db.sessions.createIndex({ "status": 1 });

// AR Annotations collection for storing drawing data
db.createCollection('annotations');
db.annotations.createIndex({ "roomId": 1 });
db.annotations.createIndex({ "sessionId": 1 });
db.annotations.createIndex({ "timestamp": 1 });
db.annotations.createIndex({ "authorId": 1 });

// Medical Cases collection (for future use)
db.createCollection('medical_cases');
db.medical_cases.createIndex({ "caseId": 1 }, { unique: true });
db.medical_cases.createIndex({ "patientId": 1 });
db.medical_cases.createIndex({ "assignedDoctor": 1 });
db.medical_cases.createIndex({ "status": 1 });

// Audit logs for HIPAA compliance
db.createCollection('audit_logs');
db.audit_logs.createIndex({ "userId": 1 });
db.audit_logs.createIndex({ "action": 1 });
db.audit_logs.createIndex({ "timestamp": 1 });
db.audit_logs.createIndex({ "sessionId": 1 });

print('👥 Creating default users...');

// Create default test users
db.users.insertMany([
  {
    _id: ObjectId(),
    username: "dr.smith",
    email: "dr.smith@hospital.com",
    passwordHash: "$2b$12$rQV8Zh.4r1YAJrG3qX6.HOykJGWVhHaHhgZ3J1UjzlHdv2VJ8bKBe", // SecurePass123!
    role: "surgeon",
    firstName: "Dr. John",
    lastName: "Smith",
    department: "Surgical",
    licenseNumber: "MD-12345-SURG",
    isActive: true,
    permissions: ["video_call", "ar_annotations", "room_creation", "patient_data"],
    createdAt: new Date(),
    lastLogin: null,
    metadata: {
      specialties: ["General Surgery", "Trauma Surgery"],
      yearsExperience: 15,
      certifications: ["Board Certified Surgeon", "Trauma Specialist"]
    }
  },
  {
    _id: ObjectId(),
    username: "dr.johnson",
    email: "dr.johnson@hospital.com", 
    passwordHash: "$2b$12$rQV8Zh.4r1YAJrG3qX6.HOykJGWVhHaHhgZ3J1UjzlHdv2VJ8bKBe", // SecurePass123!
    role: "doctor",
    firstName: "Dr. Sarah",
    lastName: "Johnson",
    department: "Emergency Medicine",
    licenseNumber: "MD-67890-EMER",
    isActive: true,
    permissions: ["video_call", "ar_annotations", "room_join"],
    createdAt: new Date(),
    lastLogin: null,
    metadata: {
      specialties: ["Emergency Medicine", "Critical Care"],
      yearsExperience: 12,
      certifications: ["Board Certified Emergency Medicine"]
    }
  },
  {
    _id: ObjectId(),
    username: "nurse.williams",
    email: "nurse.williams@hospital.com",
    passwordHash: "$2b$12$rQV8Zh.4r1YAJrG3qX6.HOykJGWVhHaHhgZ3J1UjzlHdv2VJ8bKBe", // SecurePass123!
    role: "nurse",
    firstName: "Mary",
    lastName: "Williams",
    department: "Surgical Unit",
    licenseNumber: "RN-11111-SURG",
    isActive: true,
    permissions: ["video_call", "room_join"],
    createdAt: new Date(),
    lastLogin: null,
    metadata: {
      specialties: ["Surgical Nursing", "Patient Care"],
      yearsExperience: 8,
      certifications: ["Registered Nurse", "Surgical Care Certification"]
    }
  },
  {
    _id: ObjectId(),
    username: "medic.field1",
    email: "field.medic1@emergency.com",
    passwordHash: "$2b$12$rQV8Zh.4r1YAJrG3qX6.HOykJGWVhHaHhgZ3J1UjzlHdv2VJ8bKBe", // SecurePass123!
    role: "field_medic",
    firstName: "Michael",
    lastName: "Rodriguez",
    department: "Emergency Response",
    licenseNumber: "EMT-22222-FIELD",
    isActive: true,
    permissions: ["video_call", "ar_receive", "emergency_protocols"],
    createdAt: new Date(),
    lastLogin: null,
    metadata: {
      specialties: ["Emergency Medical Services", "Trauma Response"],
      yearsExperience: 6,
      certifications: ["Paramedic", "Advanced Life Support"],
      currentLocation: "Field Unit Alpha"
    }
  }
]);

// Create system configuration
db.createCollection('system_config');
db.system_config.insertOne({
  _id: ObjectId(),
  configType: "platform_settings",
  maxConcurrentRooms: 100,
  maxParticipantsPerRoom: 10,
  sessionTimeoutMinutes: 120,
  annotationRetentionDays: 365,
  auditLogRetentionDays: 2555, // 7 years for HIPAA compliance
  webrtcSettings: {
    stunServers: ["stun:stun.l.google.com:19302"],
    iceServers: [],
    mediaConstraints: {
      video: { width: 1280, height: 720, frameRate: 30 },
      audio: { echoCancellation: true, noiseSuppression: true }
    }
  },
  securitySettings: {
    requireMfa: false,
    sessionTimeoutMinutes: 480, // 8 hours
    maxLoginAttempts: 5,
    lockoutDurationMinutes: 30,
    passwordMinLength: 8,
    requireSpecialChars: true
  },
  hipaaCompliance: {
    auditingEnabled: true,
    dataEncryptionRequired: true,
    accessLoggingRequired: true,
    retentionPolicyEnforced: true
  },
  createdAt: new Date(),
  lastUpdated: new Date()
});

print('✅ Database initialization complete!');
print('👤 Created default users:');
print('   - dr.smith (Surgeon)');
print('   - dr.johnson (Doctor)');  
print('   - nurse.williams (Nurse)');
print('   - medic.field1 (Field Medic)');
print('🔐 Default password for all users: SecurePass123!');
print('📊 Created collections: users, rooms, sessions, annotations, medical_cases, audit_logs');
print('🔧 Applied database indexes for optimal performance');
print('⚡ WebRTC Surgical Platform database is ready!');