const crypto = require('crypto');
const { promisify } = require('util');

class KeyManagementService {
    constructor(logger) {
        this.logger = logger;
        this.roomKeys = new Map(); // roomId -> key info
        this.userKeys = new Map(); // userId -> public/private key pair
        this.keyRotationInterval = 24 * 60 * 60 * 1000; // 24 hours
        this.keyHistoryLimit = 5; // Keep last 5 keys for decryption
        
        // Crypto settings
        this.keyLength = 32; // 256-bit keys
        this.algorithm = 'aes-256-gcm';
        this.hashAlgorithm = 'sha256';
        this.ivLength = 16; // 128-bit IV
        
        // Initialize key rotation
        this.setupKeyRotation();
        
        // Security policies
        this.securityPolicies = {
            keyRotationEnabled: true,
            enforceEncryption: true,
            allowFallbackMethods: false,
            auditKeyUsage: true,
            maxKeyAge: 24 * 60 * 60 * 1000, // 24 hours
            minKeyStrength: 256
        };
    }

    // Generate master key for a room
    async generateRoomMasterKey(roomId, creatorId) {
        try {
            const keyId = crypto.randomUUID();
            const masterKey = crypto.randomBytes(this.keyLength);
            const derivedKey = this.deriveEncryptionKey(masterKey, roomId);
            
            const keyInfo = {
                keyId,
                roomId,
                masterKey: masterKey.toString('hex'),
                derivedKey: derivedKey.toString('hex'),
                createdAt: new Date(),
                createdBy: creatorId,
                expiresAt: new Date(Date.now() + this.keyRotationInterval),
                version: 1,
                active: true,
                usageCount: 0,
                distributedTo: new Set([creatorId])
            };

            // Store current key and maintain history
            if (this.roomKeys.has(roomId)) {
                const existingKeys = this.roomKeys.get(roomId);
                existingKeys.history = existingKeys.history || [];
                existingKeys.history.unshift(existingKeys.current);
                
                // Limit history size
                if (existingKeys.history.length > this.keyHistoryLimit) {
                    existingKeys.history = existingKeys.history.slice(0, this.keyHistoryLimit);
                }
                
                existingKeys.current = keyInfo;
                existingKeys.current.version = existingKeys.history.length + 1;
            } else {
                this.roomKeys.set(roomId, {
                    current: keyInfo,
                    history: []
                });
            }

            this.logger.info(`Generated master key for room: ${roomId}`, {
                keyId,
                creatorId,
                version: keyInfo.version
            });

            return {
                keyId,
                key: keyInfo.derivedKey,
                version: keyInfo.version,
                expiresAt: keyInfo.expiresAt
            };

        } catch (error) {
            this.logger.error('Failed to generate room master key:', error);
            throw new Error('Key generation failed');
        }
    }

    // Derive encryption key from master key
    deriveEncryptionKey(masterKey, roomId, purpose = 'stream-encryption') {
        const info = `${roomId}:${purpose}`;
        return crypto.pbkdf2Sync(masterKey, info, 10000, this.keyLength, this.hashAlgorithm);
    }

    // Get current room key for a user
    async getRoomKey(roomId, userId) {
        try {
            const roomKeyInfo = this.roomKeys.get(roomId);
            
            if (!roomKeyInfo || !roomKeyInfo.current) {
                throw new Error(`No key found for room: ${roomId}`);
            }

            const currentKey = roomKeyInfo.current;
            
            // Check if key has expired
            if (new Date() > currentKey.expiresAt) {
                this.logger.warn(`Room key expired for room: ${roomId}`);
                // Auto-rotate if policy allows
                if (this.securityPolicies.keyRotationEnabled) {
                    return await this.rotateRoomKey(roomId, userId);
                }
                throw new Error('Room key expired');
            }

            // Check if user is authorized to access key
            if (!currentKey.distributedTo.has(userId)) {
                throw new Error(`User ${userId} not authorized for room key`);
            }

            // Update usage tracking
            currentKey.usageCount++;
            currentKey.lastUsed = new Date();
            currentKey.lastUsedBy = userId;

            // Log key access for audit
            if (this.securityPolicies.auditKeyUsage) {
                this.logger.info(`Key accessed for room: ${roomId}`, {
                    keyId: currentKey.keyId,
                    userId,
                    version: currentKey.version,
                    usageCount: currentKey.usageCount
                });
            }

            return {
                keyId: currentKey.keyId,
                key: currentKey.derivedKey,
                version: currentKey.version,
                expiresAt: currentKey.expiresAt
            };

        } catch (error) {
            this.logger.error(`Failed to get room key for room ${roomId}:`, error);
            throw error;
        }
    }

    // Distribute room key to a new user
    async distributeRoomKey(roomId, userId, requesterId) {
        try {
            const roomKeyInfo = this.roomKeys.get(roomId);
            
            if (!roomKeyInfo || !roomKeyInfo.current) {
                throw new Error(`No key found for room: ${roomId}`);
            }

            const currentKey = roomKeyInfo.current;
            
            // Verify requester has permission to distribute keys
            if (!currentKey.distributedTo.has(requesterId)) {
                throw new Error(`Requester ${requesterId} not authorized to distribute keys`);
            }

            // Add user to distribution list
            currentKey.distributedTo.add(userId);
            
            this.logger.info(`Room key distributed to user: ${userId}`, {
                roomId,
                keyId: currentKey.keyId,
                requesterId,
                version: currentKey.version
            });

            return await this.getRoomKey(roomId, userId);

        } catch (error) {
            this.logger.error(`Failed to distribute room key:`, error);
            throw error;
        }
    }

    // Rotate room key
    async rotateRoomKey(roomId, requesterId) {
        try {
            const existingKeyInfo = this.roomKeys.get(roomId);
            
            if (!existingKeyInfo) {
                throw new Error(`No existing key for room: ${roomId}`);
            }

            // Generate new key
            const newKeyInfo = await this.generateRoomMasterKey(roomId, requesterId);
            
            // Copy distribution list from old key
            const newKey = this.roomKeys.get(roomId).current;
            newKey.distributedTo = new Set(existingKeyInfo.current.distributedTo);

            this.logger.info(`Room key rotated for room: ${roomId}`, {
                oldKeyId: existingKeyInfo.current.keyId,
                newKeyId: newKey.keyId,
                requesterId
            });

            return newKeyInfo;

        } catch (error) {
            this.logger.error(`Failed to rotate room key for room ${roomId}:`, error);
            throw error;
        }
    }

    // Revoke access for a user
    async revokeUserAccess(roomId, userId, requesterId) {
        try {
            const roomKeyInfo = this.roomKeys.get(roomId);
            
            if (!roomKeyInfo || !roomKeyInfo.current) {
                throw new Error(`No key found for room: ${roomId}`);
            }

            const currentKey = roomKeyInfo.current;
            
            // Verify requester has permission
            if (!currentKey.distributedTo.has(requesterId)) {
                throw new Error(`Requester ${requesterId} not authorized`);
            }

            // Remove user from distribution list
            currentKey.distributedTo.delete(userId);
            
            this.logger.info(`User access revoked for room: ${roomId}`, {
                userId,
                requesterId,
                keyId: currentKey.keyId
            });

            return { success: true };

        } catch (error) {
            this.logger.error(`Failed to revoke user access:`, error);
            throw error;
        }
    }

    // Encrypt data with room key
    async encryptWithRoomKey(roomId, data, userId) {
        try {
            const keyInfo = await this.getRoomKey(roomId, userId);
            const key = Buffer.from(keyInfo.key, 'hex');
            
            // Generate random IV
            const iv = crypto.randomBytes(this.ivLength);
            
            // Create cipher
            const cipher = crypto.createCipher(this.algorithm, key);
            cipher.setAutoPadding(true);
            
            // Encrypt data
            let encrypted = cipher.update(data, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            // Get auth tag for GCM
            const authTag = cipher.getAuthTag();
            
            const result = {
                encrypted,
                iv: iv.toString('hex'),
                authTag: authTag.toString('hex'),
                keyId: keyInfo.keyId,
                version: keyInfo.version
            };

            return result;

        } catch (error) {
            this.logger.error(`Failed to encrypt with room key:`, error);
            throw error;
        }
    }

    // Decrypt data with room key
    async decryptWithRoomKey(roomId, encryptedData, userId) {
        try {
            const { encrypted, iv, authTag, keyId, version } = encryptedData;
            
            // Get appropriate key (current or historical)
            let keyInfo;
            const roomKeyInfo = this.roomKeys.get(roomId);
            
            if (roomKeyInfo.current.keyId === keyId) {
                keyInfo = await this.getRoomKey(roomId, userId);
            } else {
                // Search in key history
                const historicalKey = roomKeyInfo.history.find(k => k.keyId === keyId);
                if (!historicalKey) {
                    throw new Error(`Key ${keyId} not found in history`);
                }
                keyInfo = {
                    key: historicalKey.derivedKey,
                    keyId: historicalKey.keyId,
                    version: historicalKey.version
                };
            }

            const key = Buffer.from(keyInfo.key, 'hex');
            
            // Create decipher
            const decipher = crypto.createDecipher(this.algorithm, key);
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));
            
            // Decrypt data
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;

        } catch (error) {
            this.logger.error(`Failed to decrypt with room key:`, error);
            throw error;
        }
    }

    // Generate user key pair for asymmetric encryption
    async generateUserKeyPair(userId) {
        try {
            const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem'
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem'
                }
            });

            const keyPairInfo = {
                userId,
                publicKey,
                privateKey,
                createdAt: new Date(),
                keyId: crypto.randomUUID(),
                algorithm: 'rsa-2048'
            };

            this.userKeys.set(userId, keyPairInfo);

            this.logger.info(`Generated key pair for user: ${userId}`, {
                keyId: keyPairInfo.keyId
            });

            return {
                keyId: keyPairInfo.keyId,
                publicKey
            };

        } catch (error) {
            this.logger.error(`Failed to generate user key pair:`, error);
            throw error;
        }
    }

    // Get user public key
    getUserPublicKey(userId) {
        const keyPair = this.userKeys.get(userId);
        if (!keyPair) {
            return null;
        }

        return {
            keyId: keyPair.keyId,
            publicKey: keyPair.publicKey,
            algorithm: keyPair.algorithm
        };
    }

    // Encrypt data with user's public key
    async encryptForUser(data, recipientUserId) {
        try {
            const keyPair = this.userKeys.get(recipientUserId);
            if (!keyPair) {
                throw new Error(`No public key found for user: ${recipientUserId}`);
            }

            const encrypted = crypto.publicEncrypt(keyPair.publicKey, Buffer.from(data, 'utf8'));
            
            return {
                encrypted: encrypted.toString('base64'),
                keyId: keyPair.keyId,
                algorithm: keyPair.algorithm
            };

        } catch (error) {
            this.logger.error(`Failed to encrypt for user ${recipientUserId}:`, error);
            throw error;
        }
    }

    // Decrypt data with user's private key
    async decryptFromUser(encryptedData, userId) {
        try {
            const { encrypted, keyId } = encryptedData;
            const keyPair = this.userKeys.get(userId);
            
            if (!keyPair || keyPair.keyId !== keyId) {
                throw new Error(`Invalid key for user: ${userId}`);
            }

            const decrypted = crypto.privateDecrypt(
                keyPair.privateKey,
                Buffer.from(encrypted, 'base64')
            );

            return decrypted.toString('utf8');

        } catch (error) {
            this.logger.error(`Failed to decrypt from user:`, error);
            throw error;
        }
    }

    // Setup automatic key rotation
    setupKeyRotation() {
        if (!this.securityPolicies.keyRotationEnabled) {
            return;
        }

        setInterval(() => {
            this.performScheduledKeyRotation();
        }, 60 * 60 * 1000); // Check every hour
    }

    async performScheduledKeyRotation() {
        try {
            const now = new Date();
            let rotatedCount = 0;

            for (const [roomId, keyInfo] of this.roomKeys) {
                if (keyInfo.current && now > keyInfo.current.expiresAt) {
                    // Get a user who can rotate the key (first distributor)
                    const rotator = Array.from(keyInfo.current.distributedTo)[0];
                    
                    if (rotator) {
                        await this.rotateRoomKey(roomId, rotator);
                        rotatedCount++;
                    }
                }
            }

            if (rotatedCount > 0) {
                this.logger.info(`Scheduled key rotation completed`, {
                    rotatedRooms: rotatedCount
                });
            }

        } catch (error) {
            this.logger.error('Scheduled key rotation failed:', error);
        }
    }

    // Security audit
    performSecurityAudit() {
        const audit = {
            timestamp: new Date().toISOString(),
            totalRooms: this.roomKeys.size,
            totalUsers: this.userKeys.size,
            securityPolicies: this.securityPolicies,
            keyStatistics: this.getKeyStatistics(),
            recommendations: []
        };

        // Check for expired keys
        let expiredKeys = 0;
        const now = new Date();
        
        for (const [roomId, keyInfo] of this.roomKeys) {
            if (keyInfo.current && now > keyInfo.current.expiresAt) {
                expiredKeys++;
            }
        }

        audit.expiredKeys = expiredKeys;

        // Add recommendations
        if (expiredKeys > 0) {
            audit.recommendations.push(`${expiredKeys} room(s) have expired keys - immediate rotation required`);
        }

        if (!this.securityPolicies.keyRotationEnabled) {
            audit.recommendations.push('Key rotation is disabled - consider enabling for better security');
        }

        return audit;
    }

    getKeyStatistics() {
        const stats = {
            activeRoomKeys: 0,
            expiredRoomKeys: 0,
            totalKeyUsage: 0,
            averageKeyAge: 0,
            keysByVersion: {}
        };

        const now = new Date();
        let totalAge = 0;

        for (const [roomId, keyInfo] of this.roomKeys) {
            if (keyInfo.current) {
                stats.totalKeyUsage += keyInfo.current.usageCount || 0;
                
                const age = now - keyInfo.current.createdAt;
                totalAge += age;
                
                if (now > keyInfo.current.expiresAt) {
                    stats.expiredRoomKeys++;
                } else {
                    stats.activeRoomKeys++;
                }

                const version = keyInfo.current.version;
                stats.keysByVersion[version] = (stats.keysByVersion[version] || 0) + 1;
            }
        }

        if (this.roomKeys.size > 0) {
            stats.averageKeyAge = totalAge / this.roomKeys.size;
        }

        return stats;
    }

    // Cleanup expired keys and resources
    cleanup() {
        try {
            const now = new Date();
            let cleanedRooms = 0;
            let cleanedUsers = 0;

            // Clean expired room keys
            for (const [roomId, keyInfo] of this.roomKeys) {
                // Remove very old historical keys
                if (keyInfo.history) {
                    const cutoffDate = new Date(now - 7 * 24 * 60 * 60 * 1000); // 7 days
                    keyInfo.history = keyInfo.history.filter(k => k.createdAt > cutoffDate);
                }

                // Remove empty room entries
                if (!keyInfo.current && (!keyInfo.history || keyInfo.history.length === 0)) {
                    this.roomKeys.delete(roomId);
                    cleanedRooms++;
                }
            }

            this.logger.info('Key management cleanup completed', {
                cleanedRooms,
                remainingRooms: this.roomKeys.size,
                remainingUsers: this.userKeys.size
            });

        } catch (error) {
            this.logger.error('Cleanup failed:', error);
        }
    }

    // Get room key info (for debugging/admin)
    getRoomKeyInfo(roomId) {
        const keyInfo = this.roomKeys.get(roomId);
        if (!keyInfo) {
            return null;
        }

        return {
            roomId,
            currentKey: {
                keyId: keyInfo.current?.keyId,
                version: keyInfo.current?.version,
                createdAt: keyInfo.current?.createdAt,
                expiresAt: keyInfo.current?.expiresAt,
                usageCount: keyInfo.current?.usageCount,
                distributedToCount: keyInfo.current?.distributedTo?.size || 0
            },
            historyCount: keyInfo.history?.length || 0
        };
    }
}

module.exports = KeyManagementService;