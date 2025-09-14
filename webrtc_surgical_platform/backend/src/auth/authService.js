const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class AuthenticationService {
    constructor(logger) {
        this.logger = logger;
        this.jwtSecret = process.env.JWT_SECRET || 'default-secret-change-in-production';
        this.jwtExpiryTime = process.env.JWT_EXPIRY || '24h';
        this.bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
        
        // In-memory user store (replace with database in production)
        this.users = new Map();
        this.refreshTokens = new Map(); // token -> userId
        this.loginAttempts = new Map(); // userId -> { attempts, lastAttempt, lockedUntil }
        
        // Role-based permissions
        this.rolePermissions = this.initializeRolePermissions();
        
        // Initialize with some test users
        this.initializeTestUsers();
    }

    initializeRolePermissions() {
        return {
            'admin': {
                name: 'Administrator',
                permissions: [
                    'user:*', 'room:*', 'call:*', 'system:*', 
                    'ai:*', 'audit:*', 'emergency:*'
                ],
                level: 100
            },
            'surgeon': {
                name: 'Surgeon',
                permissions: [
                    'user:read', 'user:update:own', 'room:*', 'call:*',
                    'ai:surgical', 'ai:analysis', 'emergency:initiate',
                    'patient:read', 'patient:update', 'procedure:*'
                ],
                level: 90
            },
            'doctor': {
                name: 'Doctor',
                permissions: [
                    'user:read', 'user:update:own', 'room:create', 'room:join',
                    'room:manage:own', 'call:*', 'ai:diagnostic', 'emergency:initiate',
                    'patient:read', 'patient:update'
                ],
                level: 80
            },
            'nurse': {
                name: 'Nurse',
                permissions: [
                    'user:read', 'user:update:own', 'room:join', 'call:receive',
                    'call:initiate', 'patient:read', 'emergency:respond'
                ],
                level: 70
            },
            'medical_technician': {
                name: 'Medical Technician',
                permissions: [
                    'user:read', 'user:update:own', 'room:join', 'call:receive',
                    'ai:equipment', 'equipment:monitor'
                ],
                level: 60
            },
            'student': {
                name: 'Medical Student',
                permissions: [
                    'user:read:limited', 'user:update:own', 'room:join:supervised',
                    'call:observe', 'patient:read:limited'
                ],
                level: 30
            },
            'observer': {
                name: 'Observer',
                permissions: [
                    'user:read:limited', 'room:join:invited', 'call:observe'
                ],
                level: 10
            }
        };
    }

    async initializeTestUsers() {
        const testUsers = [
            {
                id: 'surgeon-001',
                username: 'dr.smith',
                email: 'dr.smith@hospital.com',
                password: 'SecurePass123!',
                name: 'Dr. Sarah Smith',
                role: 'surgeon',
                specialization: 'Cardiothoracic Surgery',
                licenseNumber: 'MD-12345',
                verified: true
            },
            {
                id: 'doctor-001',
                username: 'dr.johnson',
                email: 'dr.johnson@hospital.com',
                password: 'SecurePass123!',
                name: 'Dr. Michael Johnson',
                role: 'doctor',
                specialization: 'Emergency Medicine',
                licenseNumber: 'MD-67890',
                verified: true
            },
            {
                id: 'nurse-001',
                username: 'nurse.williams',
                email: 'nurse.williams@hospital.com',
                password: 'SecurePass123!',
                name: 'Emily Williams, RN',
                role: 'nurse',
                department: 'ICU',
                licenseNumber: 'RN-54321',
                verified: true
            }
        ];

        for (const userData of testUsers) {
            await this.createUser(userData);
        }
    }

    async createUser(userData) {
        try {
            const {
                id, username, email, password, name, role,
                specialization, department, licenseNumber, verified = false
            } = userData;

            // Hash password
            const hashedPassword = await bcrypt.hash(password, this.bcryptRounds);

            const user = {
                id: id || this.generateUserId(),
                username,
                email: email.toLowerCase(),
                password: hashedPassword,
                name,
                role,
                specialization,
                department,
                licenseNumber,
                verified,
                createdAt: new Date(),
                lastLogin: null,
                loginCount: 0,
                isActive: true,
                twoFactorEnabled: false,
                sessionTimeout: 8 * 60 * 60 * 1000, // 8 hours
                metadata: {}
            };

            this.users.set(user.id, user);
            this.logger.info(`User created: ${username}`, { userId: user.id, role });

            return { success: true, userId: user.id };

        } catch (error) {
            this.logger.error('Error creating user:', error);
            throw new Error('Failed to create user');
        }
    }

    // Create bound authenticate middleware to preserve context
    authenticate = async (req, res, next) => {
        try {
            const token = this.extractTokenFromRequest(req);
            console.log('Auth middleware - extracted token:', token ? 'present' : 'missing');
            
            if (!token) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication token required'
                });
            }

            const decoded = await this.verifyToken(token);
            console.log('Auth middleware - decoded token:', decoded ? 'valid' : 'invalid');
            const user = this.users.get(decoded.id);
            console.log('Auth middleware - user lookup:', user ? 'found' : 'not found', 'for id:', decoded.id);

            if (!user || !user.isActive) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid or expired token'
                });
            }

            // Add user info to request
            req.user = {
                id: user.id,
                username: user.username,
                email: user.email,
                name: user.name,
                role: user.role,
                permissions: this.rolePermissions[user.role]?.permissions || [],
                verified: user.verified
            };

            next();

        } catch (error) {
            console.error('Authentication error:', error);
            return res.status(401).json({
                success: false,
                error: 'Authentication failed'
            });
        }
    };

    requireRole = (allowedRoles) => {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }

            if (!allowedRoles.includes(req.user.role)) {
                this.logger.warn(`Access denied for user ${req.user.username}`, {
                    userId: req.user.id,
                    requiredRoles: allowedRoles,
                    userRole: req.user.role
                });

                return res.status(403).json({
                    success: false,
                    error: 'Insufficient permissions'
                });
            }

            next();
        };
    };

    requirePermission = (requiredPermission) => {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }

            const hasPermission = this.userHasPermission(req.user, requiredPermission);
            
            if (!hasPermission) {
                this.logger.warn(`Permission denied for user ${req.user.username}`, {
                    userId: req.user.id,
                    requiredPermission,
                    userPermissions: req.user.permissions
                });

                return res.status(403).json({
                    success: false,
                    error: 'Permission denied'
                });
            }

            next();
        };
    };

    async login(credentials) {
        try {
            const { username, password, email, mfaToken } = credentials;
            
            // Find user by username or email
            const user = this.findUserByCredential(username || email);
            
            if (!user) {
                await this.simulateHashComparison(); // Prevent timing attacks
                throw new Error('Invalid credentials');
            }

            // Check if account is locked
            if (this.isAccountLocked(user.id)) {
                const lockInfo = this.loginAttempts.get(user.id);
                throw new Error(`Account locked until ${new Date(lockInfo.lockedUntil).toLocaleString()}`);
            }

            // Verify password
            const validPassword = await bcrypt.compare(password, user.password);
            
            if (!validPassword) {
                this.recordFailedLogin(user.id);
                throw new Error('Invalid credentials');
            }

            // Check if account is verified
            if (!user.verified) {
                throw new Error('Account not verified. Please contact administrator.');
            }

            // Check if account is active
            if (!user.isActive) {
                throw new Error('Account is deactivated. Please contact administrator.');
            }

            // Handle MFA if enabled
            if (user.twoFactorEnabled) {
                if (!mfaToken || !this.verifyMFAToken(user, mfaToken)) {
                    throw new Error('Invalid MFA token');
                }
            }

            // Clear failed login attempts
            this.loginAttempts.delete(user.id);

            // Update user login info
            user.lastLogin = new Date();
            user.loginCount += 1;

            // Generate tokens
            const accessToken = await this.generateAccessToken(user);
            const refreshToken = await this.generateRefreshToken(user);

            this.logger.info(`User logged in: ${user.username}`, {
                userId: user.id,
                role: user.role,
                loginCount: user.loginCount
            });

            return {
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    specialization: user.specialization,
                    department: user.department,
                    permissions: this.rolePermissions[user.role]?.permissions || [],
                    verified: user.verified
                },
                tokens: {
                    accessToken,
                    refreshToken,
                    expiresIn: this.jwtExpiryTime
                }
            };

        } catch (error) {
            this.logger.error('Login error:', error);
            throw error;
        }
    }

    async logout(refreshToken) {
        try {
            if (refreshToken && this.refreshTokens.has(refreshToken)) {
                this.refreshTokens.delete(refreshToken);
            }
            
            return { success: true, message: 'Logged out successfully' };
        } catch (error) {
            this.logger.error('Logout error:', error);
            throw error;
        }
    }

    async refreshAccessToken(refreshToken) {
        try {
            const userId = this.refreshTokens.get(refreshToken);
            
            if (!userId) {
                throw new Error('Invalid refresh token');
            }

            const user = this.users.get(userId);
            
            if (!user || !user.isActive) {
                this.refreshTokens.delete(refreshToken);
                throw new Error('User not found or inactive');
            }

            // Generate new access token
            const newAccessToken = await this.generateAccessToken(user);
            
            return {
                success: true,
                accessToken: newAccessToken,
                expiresIn: this.jwtExpiryTime
            };

        } catch (error) {
            this.logger.error('Token refresh error:', error);
            throw error;
        }
    }

    async verifyToken(token) {
        try {
            const decoded = jwt.verify(token, this.jwtSecret);
            return decoded;
        } catch (error) {
            throw new Error('Invalid or expired token');
        }
    }

    async generateAccessToken(user) {
        const payload = {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            permissions: this.rolePermissions[user.role]?.permissions || [],
            iat: Math.floor(Date.now() / 1000)
        };

        return jwt.sign(payload, this.jwtSecret, {
            expiresIn: this.jwtExpiryTime,
            issuer: 'surgical-platform',
            audience: 'surgical-platform-users'
        });
    }

    async generateRefreshToken(user) {
        const refreshToken = crypto.randomBytes(64).toString('hex');
        this.refreshTokens.set(refreshToken, user.id);
        
        // Set expiry for refresh token (30 days) - fix timeout issue
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const maxTimeout = 2147483647; // Max 32-bit signed integer
        const timeoutMs = Math.min(thirtyDaysMs, maxTimeout);
        
        setTimeout(() => {
            this.refreshTokens.delete(refreshToken);
        }, timeoutMs);

        return refreshToken;
    }

    findUserByCredential(credential) {
        for (const user of this.users.values()) {
            if (user.username === credential || user.email === credential) {
                return user;
            }
        }
        return null;
    }

    extractTokenFromRequest(req) {
        const authHeader = req.headers.authorization;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        
        return req.query.token || req.body.token;
    }

    userHasPermission(user, requiredPermission) {
        const userPermissions = user.permissions || [];
        
        // Check for exact permission match
        if (userPermissions.includes(requiredPermission)) {
            return true;
        }
        
        // Check for wildcard permissions
        const [resource, action] = requiredPermission.split(':');
        const wildcardPermission = `${resource}:*`;
        
        if (userPermissions.includes(wildcardPermission)) {
            return true;
        }
        
        // Check for admin wildcard
        if (userPermissions.includes('*')) {
            return true;
        }
        
        return false;
    }

    recordFailedLogin(userId) {
        const attempts = this.loginAttempts.get(userId) || { attempts: 0, lastAttempt: null };
        attempts.attempts += 1;
        attempts.lastAttempt = new Date();
        
        // Lock account after 5 failed attempts for 30 minutes
        if (attempts.attempts >= 5) {
            attempts.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
        }
        
        this.loginAttempts.set(userId, attempts);
    }

    isAccountLocked(userId) {
        const attempts = this.loginAttempts.get(userId);
        return attempts && attempts.lockedUntil && attempts.lockedUntil > new Date();
    }

    async simulateHashComparison() {
        // Simulate password hash comparison to prevent timing attacks
        await bcrypt.compare('fake-password', '$2b$12$dummy.hash.to.prevent.timing.attacks');
    }

    verifyMFAToken(user, token) {
        // Placeholder for MFA verification
        // In production, implement TOTP or similar
        return true;
    }

    generateUserId() {
        return 'user-' + crypto.randomUUID();
    }

    // Utility methods for user management
    async updateUser(userId, updates) {
        const user = this.users.get(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Validate updates
        const allowedUpdates = ['name', 'email', 'specialization', 'department', 'metadata'];
        const filteredUpdates = {};
        
        for (const key of allowedUpdates) {
            if (updates[key] !== undefined) {
                filteredUpdates[key] = updates[key];
            }
        }

        Object.assign(user, filteredUpdates);
        this.logger.info(`User updated: ${user.username}`, { userId, updates: Object.keys(filteredUpdates) });

        return { success: true };
    }

    async changePassword(userId, currentPassword, newPassword) {
        const user = this.users.get(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const validCurrentPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validCurrentPassword) {
            throw new Error('Current password is incorrect');
        }

        user.password = await bcrypt.hash(newPassword, this.bcryptRounds);
        this.logger.info(`Password changed for user: ${user.username}`, { userId });

        return { success: true };
    }

    async deactivateUser(userId) {
        const user = this.users.get(userId);
        if (!user) {
            throw new Error('User not found');
        }

        user.isActive = false;
        this.logger.info(`User deactivated: ${user.username}`, { userId });

        return { success: true };
    }

    getActiveUsers() {
        return Array.from(this.users.values())
            .filter(user => user.isActive)
            .map(user => ({
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                lastLogin: user.lastLogin,
                verified: user.verified
            }));
    }

    getUsersByRole(role) {
        return Array.from(this.users.values())
            .filter(user => user.role === role && user.isActive)
            .map(user => ({
                id: user.id,
                name: user.name,
                specialization: user.specialization,
                department: user.department,
                verified: user.verified
            }));
    }
}

module.exports = AuthenticationService;