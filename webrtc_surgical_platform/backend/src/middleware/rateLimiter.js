// Simple rate limiter implementation without external dependencies

class SimpleRateLimiter {
    constructor(options = {}) {
        this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
        this.maxRequests = options.maxRequests || 100;
        this.message = options.message || 'Too many requests';
        this.clients = new Map(); // IP -> { count, resetTime }
    }

    middleware() {
        return (req, res, next) => {
            const clientId = req.ip || req.connection.remoteAddress || 'unknown';
            const now = Date.now();
            
            // Clean up expired entries
            this.cleanup();
            
            let clientData = this.clients.get(clientId);
            
            if (!clientData) {
                // First request from this client
                clientData = {
                    count: 1,
                    resetTime: now + this.windowMs
                };
                this.clients.set(clientId, clientData);
                
                // Add rate limit headers
                res.set({
                    'X-RateLimit-Limit': this.maxRequests,
                    'X-RateLimit-Remaining': this.maxRequests - 1,
                    'X-RateLimit-Reset': clientData.resetTime
                });
                
                return next();
            }
            
            if (now > clientData.resetTime) {
                // Reset the counter
                clientData.count = 1;
                clientData.resetTime = now + this.windowMs;
            } else {
                clientData.count++;
            }
            
            // Add rate limit headers
            res.set({
                'X-RateLimit-Limit': this.maxRequests,
                'X-RateLimit-Remaining': Math.max(0, this.maxRequests - clientData.count),
                'X-RateLimit-Reset': clientData.resetTime
            });
            
            if (clientData.count > this.maxRequests) {
                const retryAfter = Math.ceil((clientData.resetTime - now) / 1000);
                
                res.status(429).json({
                    error: 'Too Many Requests',
                    message: this.message,
                    retryAfter
                });
                return;
            }
            
            next();
        };
    }
    
    cleanup() {
        const now = Date.now();
        for (const [clientId, data] of this.clients) {
            if (now > data.resetTime) {
                this.clients.delete(clientId);
            }
        }
    }
}

// Create rate limiter instances
const generalLimiter = new SimpleRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,
    message: 'Too many requests from this IP'
});

const authLimiter = new SimpleRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,
    message: 'Too many authentication attempts'
});

const uploadLimiter = new SimpleRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20,
    message: 'Too many file uploads'
});

// Socket.IO rate limiter
const signalingLimiter = (socket, next) => {
    const clientId = socket.handshake.address;
    // For now, just allow all socket connections
    // In production, implement proper socket rate limiting
    next();
};

// Mock rate limiter service for compatibility
const rateLimiterService = {
    createMiddleware: (type) => {
        switch (type) {
            case 'auth':
                return authLimiter.middleware();
            case 'upload':
                return uploadLimiter.middleware();
            default:
                return generalLimiter.middleware();
        }
    },
    
    async checkLimit(type, key) {
        return {
            allowed: true,
            remaining: 50,
            resetTime: 0
        };
    },
    
    async resetLimit(type, key) {
        return true;
    },
    
    async getStats() {
        return {
            general: { points: 100, duration: 900 },
            auth: { points: 10, duration: 900 },
            upload: { points: 20, duration: 3600 }
        };
    }
};

module.exports = {
    rateLimiter: generalLimiter.middleware(),
    authRateLimiter: authLimiter.middleware(),
    signalingRateLimiter: signalingLimiter,
    uploadRateLimiter: uploadLimiter.middleware(),
    rateLimiterService
};