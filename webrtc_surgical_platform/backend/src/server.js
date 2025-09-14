const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const winston = require('winston');
require('dotenv').config();

const SignalingServer = require('./signaling/signalingServer');
const AuthenticationService = require('./auth/authService');
const RoomManager = require('./signaling/roomManager');
const AIProcessingService = require('./ai/aiProcessingService');
const { rateLimiter } = require('./middleware/rateLimiter');

class SurgicalPlatformServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: process.env.CORS_ORIGIN || "http://localhost:3000",
                methods: ["GET", "POST"],
                credentials: true
            },
            transports: ['websocket', 'polling']
        });
        
        this.setupLogger();
        this.setupMiddleware();
        this.setupServices();
        this.setupRoutes();
        this.setupSignaling();
        this.setupErrorHandling();
    }

    setupLogger() {
        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            defaultMeta: { service: 'surgical-platform-backend' },
            transports: [
                new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
                new winston.transports.File({ filename: 'logs/combined.log' }),
                new winston.transports.Console({
                    format: winston.format.simple()
                })
            ]
        });
    }

    setupMiddleware() {
        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'", "wss:", "ws:"],
                }
            }
        }));

        // CORS
        this.app.use(cors({
            origin: process.env.CORS_ORIGIN || "http://localhost:3000",
            credentials: true
        }));

        // Rate limiting
        this.app.use('/api/', rateLimiter);

        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Request logging
        this.app.use((req, res, next) => {
            this.logger.info(`${req.method} ${req.path}`, {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                timestamp: new Date().toISOString()
            });
            next();
        });
    }

    setupServices() {
        this.authService = new AuthenticationService(this.logger);
        this.roomManager = new RoomManager(this.logger);
        this.aiService = new AIProcessingService(this.logger);
        this.signalingServer = new SignalingServer(this.io, this.roomManager, this.authService, this.logger);
    }

    setupRoutes() {
        // Root endpoint
        this.app.get('/', (req, res) => {
            res.json({
                name: 'WebRTC Surgical Platform API',
                version: '1.0.0',
                status: 'operational',
                endpoints: {
                    health: '/health',
                    auth: '/api/auth',
                    rooms: '/api/rooms',
                    webrtcConfig: '/api/webrtc-config',
                    expertMatching: '/api/matching/find-experts',
                    aiHealth: '/api/ai/health',
                    aiAnalysis: '/api/ai/analyze-frame'
                },
                documentation: '/api'
            });
        });

        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'healthy', 
                timestamp: new Date().toISOString(),
                version: '1.0.0'
            });
        });

        // Authentication routes
        this.app.use('/api/auth', require('./auth/authRoutes')(this.authService));
        
        // Room management routes
        this.app.use('/api/rooms', require('./signaling/roomRoutes')(this.roomManager, this.authService));
        
        // Video call routes
        const { router: videoCallRouter } = require('./videocall/videoCallRoutes');
        this.app.use('/api/video-call', videoCallRouter);

        // WebRTC configuration endpoint
        this.app.get('/api/webrtc-config', this.authService.authenticate, (req, res) => {
            res.json({
                iceServers: [
                    { urls: process.env.STUN_SERVER || 'stun:stun.l.google.com:19302' },
                    {
                        urls: process.env.TURN_SERVER || 'turn:your-turn-server.com:3478',
                        username: process.env.TURN_USERNAME || '',
                        credential: process.env.TURN_CREDENTIAL || ''
                    }
                ]
            });
        });

        // Expert matching endpoints
        this.app.post('/api/matching/find-experts', this.authService.authenticate, (req, res) => {
            const mockMatches = [
                {
                    profile: {
                        id: 'expert-001',
                        name: 'Dr. Emily Chen',
                        specialization: 'Cardiothoracic Surgery',
                        availability: 'available',
                        rating: 4.9,
                        responseTime: '< 5 min'
                    },
                    score: 0.95,
                    matchReasons: ['Perfect specialty match', 'High availability']
                },
                {
                    profile: {
                        id: 'expert-002', 
                        name: 'Dr. Michael Torres',
                        specialization: 'Neurosurgery',
                        availability: 'available',
                        rating: 4.8,
                        responseTime: '< 10 min'
                    },
                    score: 0.82,
                    matchReasons: ['Related expertise', 'Fast response time']
                }
            ];

            res.json({
                success: true,
                matches: mockMatches,
                matchingCriteria: req.body,
                totalFound: mockMatches.length
            });
        });

        // AI service endpoints
        this.app.get('/api/ai/health', this.authService.authenticate, (req, res) => {
            res.json({
                success: true,
                status: 'operational',
                models: ['anatomy-recognition', 'instrument-detection', 'quality-assessment'],
                stats: this.aiService.getSystemStats()
            });
        });

        this.app.post('/api/ai/analyze-frame', this.authService.authenticate, async (req, res) => {
            try {
                const result = await this.aiService.processVideoFrame({
                    userId: req.user.id,
                    roomId: req.body.roomId,
                    frameData: req.body.frameData,
                    analysisType: req.body.analysisType || 'comprehensive'
                });

                res.json(result);
            } catch (error) {
                this.logger.error('AI analysis error:', error);
                res.status(500).json({
                    success: false,
                    error: 'Analysis failed'
                });
            }
        });

        // API documentation
        this.app.get('/api', (req, res) => {
            res.json({
                name: 'WebRTC Surgical Guidance Platform API',
                version: '1.0.0',
                endpoints: {
                    health: '/health',
                    auth: '/api/auth',
                    rooms: '/api/rooms',
                    webrtcConfig: '/api/webrtc-config',
                    expertMatching: '/api/matching/find-experts',
                    aiHealth: '/api/ai/health',
                    aiAnalysis: '/api/ai/analyze-frame'
                }
            });
        });
    }

    setupSignaling() {
        // Socket.IO middleware for authentication
        this.io.use(async (socket, next) => {
            try {
                const token = socket.handshake.auth.token;
                if (!token) {
                    return next(new Error('Authentication token required'));
                }

                const user = await this.authService.verifyToken(token);
                socket.userId = user.id;
                socket.userRole = user.role;
                socket.userName = user.name;

                this.logger.info(`User connected: ${user.name} (${user.id})`, {
                    socketId: socket.id,
                    userRole: user.role
                });

                next();
            } catch (error) {
                this.logger.error('Socket authentication failed:', error);
                next(new Error('Authentication failed'));
            }
        });

        // Initialize signaling server
        this.signalingServer.initialize();

        this.logger.info('Signaling server initialized');
    }

    setupErrorHandling() {
        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({ 
                error: 'Endpoint not found',
                path: req.originalUrl 
            });
        });

        // Global error handler
        this.app.use((error, req, res, next) => {
            this.logger.error('Unhandled error:', error);
            
            res.status(error.status || 500).json({
                error: process.env.NODE_ENV === 'production' 
                    ? 'Internal server error' 
                    : error.message,
                ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
            });
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            this.logger.info('SIGTERM received, shutting down gracefully');
            this.server.close(() => {
                this.logger.info('Process terminated');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            this.logger.info('SIGINT received, shutting down gracefully');
            this.server.close(() => {
                this.logger.info('Process terminated');
                process.exit(0);
            });
        });
    }

    start() {
        const port = process.env.PORT || 3001;
        
        this.server.listen(port, () => {
            this.logger.info(`🏥 WebRTC Surgical Platform Server running on port ${port}`, {
                nodeEnv: process.env.NODE_ENV,
                timestamp: new Date().toISOString()
            });
        });

        return this.server;
    }
}

// Start server if this file is run directly
if (require.main === module) {
    const server = new SurgicalPlatformServer();
    server.start();
}

module.exports = SurgicalPlatformServer;