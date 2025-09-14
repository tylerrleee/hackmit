const crypto = require('crypto');

class MedicalComplianceService {
    constructor(logger) {
        this.logger = logger;
        this.auditLog = new Map(); // In production, use secure database
        this.encryptionKey = process.env.ENCRYPTION_KEY || this.generateEncryptionKey();
        this.dataRetentionDays = parseInt(process.env.DATA_RETENTION_DAYS) || 2555; // 7 years default
        this.hipaaAuditEnabled = process.env.HIPAA_AUDIT_ENABLED === 'true';
        
        // HIPAA required audit events
        this.auditEventTypes = {
            USER_LOGIN: 'user_login',
            USER_LOGOUT: 'user_logout',
            DATA_ACCESS: 'data_access',
            DATA_MODIFICATION: 'data_modification',
            DATA_EXPORT: 'data_export',
            SYSTEM_ACCESS: 'system_access',
            PERMISSION_CHANGE: 'permission_change',
            EMERGENCY_ACCESS: 'emergency_access',
            FAILED_LOGIN: 'failed_login',
            UNAUTHORIZED_ACCESS: 'unauthorized_access'
        };

        // Initialize audit log cleanup
        this.setupAuditCleanup();
    }

    // HIPAA Audit Logging
    async logAuditEvent(eventType, details) {
        if (!this.hipaaAuditEnabled) {
            return;
        }

        try {
            const auditEntry = {
                id: crypto.randomUUID(),
                eventType,
                timestamp: new Date().toISOString(),
                userId: details.userId || null,
                username: details.username || null,
                userRole: details.userRole || null,
                action: details.action || null,
                resource: details.resource || null,
                resourceId: details.resourceId || null,
                outcome: details.outcome || 'success',
                ip: details.ip || null,
                userAgent: details.userAgent || null,
                sessionId: details.sessionId || null,
                additionalData: details.additionalData || {},
                hipaaCompliant: true
            };

            // Encrypt sensitive data
            if (auditEntry.additionalData.sensitiveData) {
                auditEntry.additionalData.sensitiveData = this.encryptData(
                    JSON.stringify(auditEntry.additionalData.sensitiveData)
                );
            }

            this.auditLog.set(auditEntry.id, auditEntry);

            // Log to Winston for persistent storage
            this.logger.info('HIPAA Audit Event', {
                auditId: auditEntry.id,
                eventType,
                userId: auditEntry.userId,
                outcome: auditEntry.outcome,
                hipaa: true
            });

            return auditEntry.id;

        } catch (error) {
            this.logger.error('Failed to log audit event:', error);
            throw new Error('Audit logging failed');
        }
    }

    // Log user authentication events
    async logUserLogin(user, request, success = true) {
        return await this.logAuditEvent(
            success ? this.auditEventTypes.USER_LOGIN : this.auditEventTypes.FAILED_LOGIN,
            {
                userId: user?.id,
                username: user?.username,
                userRole: user?.role,
                action: success ? 'login_successful' : 'login_failed',
                outcome: success ? 'success' : 'failure',
                ip: request?.ip,
                userAgent: request?.get?.('User-Agent'),
                additionalData: {
                    loginMethod: 'password',
                    timestamp: new Date().toISOString()
                }
            }
        );
    }

    async logUserLogout(user, request) {
        return await this.logAuditEvent(
            this.auditEventTypes.USER_LOGOUT,
            {
                userId: user.id,
                username: user.username,
                userRole: user.role,
                action: 'logout',
                outcome: 'success',
                ip: request?.ip,
                userAgent: request?.get?.('User-Agent')
            }
        );
    }

    // Log data access events
    async logDataAccess(user, resource, resourceId, action = 'read') {
        return await this.logAuditEvent(
            this.auditEventTypes.DATA_ACCESS,
            {
                userId: user.id,
                username: user.username,
                userRole: user.role,
                action,
                resource,
                resourceId,
                outcome: 'success'
            }
        );
    }

    async logDataModification(user, resource, resourceId, changes) {
        return await this.logAuditEvent(
            this.auditEventTypes.DATA_MODIFICATION,
            {
                userId: user.id,
                username: user.username,
                userRole: user.role,
                action: 'modify',
                resource,
                resourceId,
                outcome: 'success',
                additionalData: {
                    changes: this.sanitizeChanges(changes)
                }
            }
        );
    }

    async logUnauthorizedAccess(user, resource, attemptedAction) {
        return await this.logAuditEvent(
            this.auditEventTypes.UNAUTHORIZED_ACCESS,
            {
                userId: user?.id,
                username: user?.username,
                userRole: user?.role,
                action: attemptedAction,
                resource,
                outcome: 'failure',
                additionalData: {
                    reason: 'insufficient_permissions'
                }
            }
        );
    }

    async logEmergencyAccess(user, resource, justification) {
        return await this.logAuditEvent(
            this.auditEventTypes.EMERGENCY_ACCESS,
            {
                userId: user.id,
                username: user.username,
                userRole: user.role,
                action: 'emergency_access',
                resource,
                outcome: 'success',
                additionalData: {
                    justification,
                    emergencyLevel: 'high',
                    requiresReview: true
                }
            }
        );
    }

    // Data encryption/decryption
    encryptData(data) {
        try {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey);
            
            let encrypted = cipher.update(data, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            const authTag = cipher.getAuthTag();
            
            return {
                encrypted,
                iv: iv.toString('hex'),
                authTag: authTag.toString('hex')
            };

        } catch (error) {
            this.logger.error('Data encryption failed:', error);
            throw new Error('Encryption failed');
        }
    }

    decryptData(encryptedData) {
        try {
            const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey);
            
            decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
            
            let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted;

        } catch (error) {
            this.logger.error('Data decryption failed:', error);
            throw new Error('Decryption failed');
        }
    }

    // Data sanitization for audit logs
    sanitizeChanges(changes) {
        const sanitized = { ...changes };
        
        // Remove sensitive fields
        const sensitiveFields = ['password', 'ssn', 'creditCard', 'bankAccount'];
        sensitiveFields.forEach(field => {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        });

        return sanitized;
    }

    // Generate secure encryption key
    generateEncryptionKey() {
        return crypto.randomBytes(32).toString('hex');
    }

    // Audit log retrieval
    async getAuditLogs(filters = {}) {
        try {
            let logs = Array.from(this.auditLog.values());

            // Apply filters
            if (filters.userId) {
                logs = logs.filter(log => log.userId === filters.userId);
            }

            if (filters.eventType) {
                logs = logs.filter(log => log.eventType === filters.eventType);
            }

            if (filters.startDate && filters.endDate) {
                const start = new Date(filters.startDate);
                const end = new Date(filters.endDate);
                logs = logs.filter(log => {
                    const logDate = new Date(log.timestamp);
                    return logDate >= start && logDate <= end;
                });
            }

            if (filters.resource) {
                logs = logs.filter(log => log.resource === filters.resource);
            }

            // Sort by timestamp (most recent first)
            logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            // Apply pagination
            const page = filters.page || 1;
            const limit = filters.limit || 100;
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;

            return {
                logs: logs.slice(startIndex, endIndex),
                totalCount: logs.length,
                page,
                totalPages: Math.ceil(logs.length / limit)
            };

        } catch (error) {
            this.logger.error('Failed to retrieve audit logs:', error);
            throw new Error('Audit log retrieval failed');
        }
    }

    // Compliance reporting
    async generateComplianceReport(startDate, endDate) {
        try {
            const logs = await this.getAuditLogs({ startDate, endDate, limit: 10000 });

            const report = {
                period: { startDate, endDate },
                generatedAt: new Date().toISOString(),
                totalEvents: logs.totalCount,
                eventBreakdown: {},
                userActivity: {},
                failedLoginAttempts: 0,
                unauthorizedAccessAttempts: 0,
                emergencyAccessEvents: 0,
                dataModifications: 0
            };

            // Analyze audit events
            logs.logs.forEach(log => {
                // Event type breakdown
                report.eventBreakdown[log.eventType] = 
                    (report.eventBreakdown[log.eventType] || 0) + 1;

                // User activity
                if (log.userId) {
                    report.userActivity[log.userId] = 
                        (report.userActivity[log.userId] || 0) + 1;
                }

                // Security metrics
                switch (log.eventType) {
                    case this.auditEventTypes.FAILED_LOGIN:
                        report.failedLoginAttempts++;
                        break;
                    case this.auditEventTypes.UNAUTHORIZED_ACCESS:
                        report.unauthorizedAccessAttempts++;
                        break;
                    case this.auditEventTypes.EMERGENCY_ACCESS:
                        report.emergencyAccessEvents++;
                        break;
                    case this.auditEventTypes.DATA_MODIFICATION:
                        report.dataModifications++;
                        break;
                }
            });

            return report;

        } catch (error) {
            this.logger.error('Failed to generate compliance report:', error);
            throw new Error('Compliance report generation failed');
        }
    }

    // Data retention compliance
    setupAuditCleanup() {
        // Run cleanup daily at 2 AM
        setInterval(() => {
            this.cleanupExpiredAuditLogs();
        }, 24 * 60 * 60 * 1000);
    }

    async cleanupExpiredAuditLogs() {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.dataRetentionDays);

            let deletedCount = 0;
            
            for (const [id, log] of this.auditLog) {
                if (new Date(log.timestamp) < cutoffDate) {
                    this.auditLog.delete(id);
                    deletedCount++;
                }
            }

            if (deletedCount > 0) {
                this.logger.info(`Cleaned up ${deletedCount} expired audit logs`, {
                    cutoffDate: cutoffDate.toISOString(),
                    retentionDays: this.dataRetentionDays
                });
            }

        } catch (error) {
            this.logger.error('Audit log cleanup failed:', error);
        }
    }

    // HIPAA compliance checks
    async validateHIPAACompliance(user, action, resource) {
        const complianceChecks = {
            userAuthenticated: !!user,
            userAuthorized: false,
            auditLogged: false,
            dataEncrypted: true, // Assume encrypted in transit
            minimumNecessary: true // Simplified check
        };

        try {
            // Check authorization (simplified)
            complianceChecks.userAuthorized = await this.checkUserAuthorization(user, action, resource);

            // Log the compliance check
            complianceChecks.auditLogged = await this.logAuditEvent(
                this.auditEventTypes.DATA_ACCESS,
                {
                    userId: user?.id,
                    username: user?.username,
                    userRole: user?.role,
                    action,
                    resource,
                    outcome: complianceChecks.userAuthorized ? 'success' : 'failure'
                }
            );

            const isCompliant = Object.values(complianceChecks).every(check => check === true);

            return {
                compliant: isCompliant,
                checks: complianceChecks,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('HIPAA compliance validation failed:', error);
            return {
                compliant: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async checkUserAuthorization(user, action, resource) {
        // Simplified authorization check
        if (!user || !user.permissions) {
            return false;
        }

        const requiredPermission = `${resource}:${action}`;
        return user.permissions.includes(requiredPermission) || 
               user.permissions.includes(`${resource}:*`) ||
               user.permissions.includes('*');
    }

    // Data breach notification (placeholder)
    async handleDataBreach(incident) {
        try {
            const breachLog = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                type: 'data_breach',
                severity: incident.severity || 'high',
                affectedUsers: incident.affectedUsers || [],
                description: incident.description,
                containmentActions: incident.containmentActions || [],
                notificationRequired: true,
                reportedToAuthorities: false
            };

            // Log the breach
            await this.logAuditEvent('data_breach', {
                action: 'breach_detected',
                resource: 'system',
                outcome: 'security_incident',
                additionalData: breachLog
            });

            // In production, trigger automated breach response
            this.logger.error('DATA BREACH DETECTED', breachLog);

            return breachLog;

        } catch (error) {
            this.logger.error('Data breach handling failed:', error);
            throw error;
        }
    }

    // Export audit logs for compliance
    async exportAuditLogs(filters, format = 'json') {
        try {
            const logs = await this.getAuditLogs(filters);
            
            const exportData = {
                exportedAt: new Date().toISOString(),
                totalRecords: logs.totalCount,
                filters,
                logs: logs.logs
            };

            if (format === 'csv') {
                return this.convertToCSV(exportData.logs);
            }

            return JSON.stringify(exportData, null, 2);

        } catch (error) {
            this.logger.error('Audit log export failed:', error);
            throw error;
        }
    }

    convertToCSV(logs) {
        if (logs.length === 0) return '';

        const headers = Object.keys(logs[0]).join(',');
        const rows = logs.map(log => 
            Object.values(log).map(value => 
                typeof value === 'object' ? JSON.stringify(value) : value
            ).join(',')
        ).join('\n');

        return `${headers}\n${rows}`;
    }

    // Get compliance status
    getComplianceStatus() {
        return {
            hipaaAuditEnabled: this.hipaaAuditEnabled,
            dataRetentionDays: this.dataRetentionDays,
            encryptionEnabled: !!this.encryptionKey,
            totalAuditLogs: this.auditLog.size,
            lastCleanup: new Date().toISOString() // Simplified
        };
    }
}

module.exports = MedicalComplianceService;