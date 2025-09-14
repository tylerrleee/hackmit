const express = require('express');
const joi = require('joi');
const { authRateLimiter } = require('../middleware/rateLimiter');

function createAuthRoutes(authService) {
    const router = express.Router();

    // Validation schemas
    const loginSchema = joi.object({
        username: joi.string().min(3).max(50),
        email: joi.string().email(),
        password: joi.string().min(8).max(128).required(),
        mfaToken: joi.string().length(6).pattern(/^[0-9]+$/)
    }).xor('username', 'email');

    const registerSchema = joi.object({
        username: joi.string().alphanum().min(3).max(30).required(),
        email: joi.string().email().required(),
        password: joi.string().min(8).max(128)
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .required()
            .messages({
                'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, one digit, and one special character'
            }),
        name: joi.string().min(2).max(100).required(),
        role: joi.string().valid('doctor', 'nurse', 'medical_technician', 'student').required(),
        specialization: joi.string().max(100),
        department: joi.string().max(100),
        licenseNumber: joi.string().max(50).required()
    });

    const changePasswordSchema = joi.object({
        currentPassword: joi.string().required(),
        newPassword: joi.string().min(8).max(128)
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .required()
    });

    const updateProfileSchema = joi.object({
        name: joi.string().min(2).max(100),
        email: joi.string().email(),
        specialization: joi.string().max(100),
        department: joi.string().max(100),
        metadata: joi.object()
    });

    // Apply rate limiting to auth routes
    router.use(authRateLimiter);

    // Login endpoint
    router.post('/login', async (req, res) => {
        try {
            const { error } = loginSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid login data',
                    details: error.details[0].message
                });
            }

            const result = await authService.login(req.body);
            
            // Set secure HTTP-only cookie for refresh token
            res.cookie('refreshToken', result.tokens.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });

            res.json({
                success: true,
                user: result.user,
                tokens: {
                    accessToken: result.tokens.accessToken,
                    refreshToken: result.tokens.refreshToken,
                    expiresIn: result.tokens.expiresIn
                }
            });

        } catch (error) {
            res.status(401).json({
                success: false,
                error: error.message
            });
        }
    });

    // Register endpoint (for admin users only)
    router.post('/register', authService.authenticate, authService.requireRole(['admin', 'surgeon']), async (req, res) => {
        try {
            const { error } = registerSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid registration data',
                    details: error.details[0].message
                });
            }

            const result = await authService.createUser({
                ...req.body,
                verified: false // Requires admin verification
            });

            res.status(201).json({
                success: true,
                message: 'User registered successfully. Account requires verification.',
                userId: result.userId
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Logout endpoint
    router.post('/logout', async (req, res) => {
        try {
            const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
            
            await authService.logout(refreshToken);
            
            // Clear refresh token cookie
            res.clearCookie('refreshToken');
            
            res.json({
                success: true,
                message: 'Logged out successfully'
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Refresh token endpoint
    router.post('/refresh', async (req, res) => {
        try {
            const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
            
            if (!refreshToken) {
                return res.status(401).json({
                    success: false,
                    error: 'Refresh token required'
                });
            }

            const result = await authService.refreshAccessToken(refreshToken);

            res.json({
                success: true,
                accessToken: result.accessToken,
                expiresIn: result.expiresIn
            });

        } catch (error) {
            res.status(401).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get current user profile
    router.get('/profile', authService.authenticate, async (req, res) => {
        try {
            const user = authService.users.get(req.user.id);
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    specialization: user.specialization,
                    department: user.department,
                    licenseNumber: user.licenseNumber,
                    verified: user.verified,
                    lastLogin: user.lastLogin,
                    loginCount: user.loginCount,
                    twoFactorEnabled: user.twoFactorEnabled,
                    metadata: user.metadata
                }
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Update user profile
    router.patch('/profile', authService.authenticate, async (req, res) => {
        try {
            const { error } = updateProfileSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid profile data',
                    details: error.details[0].message
                });
            }

            await authService.updateUser(req.user.id, req.body);

            res.json({
                success: true,
                message: 'Profile updated successfully'
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Change password
    router.post('/change-password', authService.authenticate, async (req, res) => {
        try {
            const { error } = changePasswordSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid password data',
                    details: error.details[0].message
                });
            }

            const { currentPassword, newPassword } = req.body;
            await authService.changePassword(req.user.id, currentPassword, newPassword);

            res.json({
                success: true,
                message: 'Password changed successfully'
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Verify user account (admin only)
    router.post('/verify/:userId', authService.authenticate, authService.requireRole(['admin', 'surgeon']), async (req, res) => {
        try {
            const { userId } = req.params;
            const user = authService.users.get(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            user.verified = true;
            
            res.json({
                success: true,
                message: `User ${user.username} verified successfully`
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Deactivate user account (admin only)
    router.post('/deactivate/:userId', authService.authenticate, authService.requireRole(['admin']), async (req, res) => {
        try {
            const { userId } = req.params;
            
            await authService.deactivateUser(userId);

            res.json({
                success: true,
                message: 'User deactivated successfully'
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get all users (admin and surgeon only)
    router.get('/users', authService.authenticate, authService.requireRole(['admin', 'surgeon']), async (req, res) => {
        try {
            const { role, verified, active = true } = req.query;
            
            let users = authService.getActiveUsers();

            // Filter by role if specified
            if (role) {
                users = users.filter(user => user.role === role);
            }

            // Filter by verification status if specified
            if (verified !== undefined) {
                const isVerified = verified === 'true';
                users = users.filter(user => user.verified === isVerified);
            }

            res.json({
                success: true,
                users,
                count: users.length
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get users by role
    router.get('/users/by-role/:role', authService.authenticate, async (req, res) => {
        try {
            const { role } = req.params;
            
            // Check if user has permission to view users of this role
            const userRole = req.user.role;
            const userRoleLevel = authService.rolePermissions[userRole]?.level || 0;
            const targetRoleLevel = authService.rolePermissions[role]?.level || 0;

            if (userRoleLevel < targetRoleLevel && userRole !== 'admin') {
                return res.status(403).json({
                    success: false,
                    error: 'Insufficient permissions to view users of this role'
                });
            }

            const users = authService.getUsersByRole(role);

            res.json({
                success: true,
                users,
                count: users.length,
                role
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Check token validity
    router.get('/verify-token', authService.authenticate, async (req, res) => {
        res.json({
            success: true,
            valid: true,
            user: {
                id: req.user.id,
                username: req.user.username,
                role: req.user.role,
                permissions: req.user.permissions
            }
        });
    });

    // Get user permissions
    router.get('/permissions', authService.authenticate, async (req, res) => {
        try {
            const roleInfo = authService.rolePermissions[req.user.role];
            
            res.json({
                success: true,
                role: req.user.role,
                permissions: req.user.permissions,
                roleInfo: {
                    name: roleInfo?.name,
                    level: roleInfo?.level
                }
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Enable/disable 2FA (placeholder)
    router.post('/2fa/enable', authService.authenticate, async (req, res) => {
        try {
            const user = authService.users.get(req.user.id);
            user.twoFactorEnabled = true;

            res.json({
                success: true,
                message: 'Two-factor authentication enabled',
                // In production, return QR code or setup instructions
                setupCode: 'PLACEHOLDER_SETUP_CODE'
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    router.post('/2fa/disable', authService.authenticate, async (req, res) => {
        try {
            const user = authService.users.get(req.user.id);
            user.twoFactorEnabled = false;

            res.json({
                success: true,
                message: 'Two-factor authentication disabled'
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get login history (simplified)
    router.get('/login-history', authService.authenticate, async (req, res) => {
        try {
            const user = authService.users.get(req.user.id);
            
            // In production, this would come from audit logs
            const history = [{
                timestamp: user.lastLogin,
                success: true,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            }];

            res.json({
                success: true,
                history,
                totalLogins: user.loginCount
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Password reset request (placeholder)
    router.post('/password-reset/request', async (req, res) => {
        try {
            const { email } = req.body;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Email is required'
                });
            }

            // In production, send reset email
            // For now, just return success
            res.json({
                success: true,
                message: 'If an account exists with this email, a password reset link has been sent'
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    return router;
}

module.exports = createAuthRoutes;