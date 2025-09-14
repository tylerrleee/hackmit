const express = require('express');
const router = express.Router();
const axios = require('axios');
const winston = require('winston');

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    defaultMeta: { service: 'video-call-routes' },
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

class VideoCallService {
    constructor() {
        this.bridgeUrl = process.env.AR_BRIDGE_URL || 'ws://localhost:8765';
        this.bridgeHttpUrl = process.env.AR_BRIDGE_HTTP_URL || 'http://localhost:8766';
        this.activeVideoCalls = new Map(); // Track active video calls
    }

    async sendToBridge(roomId, message) {
        try {
            logger.info(`Sending message to bridge for room ${roomId}:`, message);
            
            // Determine the bridge endpoint based on message type
            let endpoint = '';
            if (message.type === 'start_video_call') {
                endpoint = '/video-call/start';
            } else if (message.type === 'end_video_call') {
                endpoint = '/video-call/end';
            } else {
                // For other message types, just log for now
                return {
                    success: true,
                    message: 'Message logged (no bridge endpoint)',
                    bridgeResponse: message
                };
            }
            
            // Send HTTP request to bridge
            const response = await axios.post(`${this.bridgeHttpUrl}${endpoint}`, {
                roomId: roomId,
                surgeonId: message.surgeonId,
                timestamp: message.timestamp,
                options: message.options || {}
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // 10 second timeout
            });
            
            logger.info(`Bridge response for ${message.type}:`, response.data);
            
            return {
                success: true,
                message: 'Command sent to AR bridge',
                bridgeResponse: response.data
            };
            
        } catch (error) {
            logger.error(`Error sending to bridge: ${error.message}`);
            
            // If bridge is not available, still allow the operation to succeed
            // This ensures the system works even if the bridge is down
            return {
                success: true,
                message: 'Bridge unavailable, command logged locally',
                bridgeResponse: {
                    error: error.message,
                    fallback: true
                }
            };
        }
    }

    async startVideoCall(roomId, surgeonId, options = {}) {
        try {
            logger.info(`Starting video call for room ${roomId}, surgeon ${surgeonId}`);
            
            // Check if video call is already active
            if (this.activeVideoCalls.has(roomId)) {
                throw new Error('Video call is already active for this room');
            }

            // Send start video call message to bridge
            const bridgeMessage = {
                type: 'start_video_call',
                roomId: roomId,
                surgeonId: surgeonId,
                timestamp: new Date().toISOString(),
                options: {
                    requestFieldMedic: options.requestFieldMedic || true,
                    enableAR: options.enableAR || true,
                    quality: options.quality || 'hd'
                }
            };

            const bridgeResponse = await this.sendToBridge(roomId, bridgeMessage);
            
            // Track the active video call
            this.activeVideoCalls.set(roomId, {
                surgeonId,
                startTime: new Date(),
                status: 'starting',
                fieldMedicConnected: false
            });

            return {
                success: true,
                roomId,
                status: 'starting',
                message: 'Video call start request sent to field medic',
                bridgeResponse
            };

        } catch (error) {
            logger.error(`Error starting video call: ${error.message}`);
            throw error;
        }
    }

    async endVideoCall(roomId, surgeonId) {
        try {
            logger.info(`Ending video call for room ${roomId}, surgeon ${surgeonId}`);
            
            // Check if video call exists
            if (!this.activeVideoCalls.has(roomId)) {
                throw new Error('No active video call found for this room');
            }

            // Send end video call message to bridge
            const bridgeMessage = {
                type: 'end_video_call',
                roomId: roomId,
                surgeonId: surgeonId,
                timestamp: new Date().toISOString()
            };

            const bridgeResponse = await this.sendToBridge(roomId, bridgeMessage);
            
            // Remove from active calls
            const callInfo = this.activeVideoCalls.get(roomId);
            this.activeVideoCalls.delete(roomId);

            return {
                success: true,
                roomId,
                status: 'ended',
                message: 'Video call ended successfully',
                duration: callInfo ? new Date() - callInfo.startTime : null,
                bridgeResponse
            };

        } catch (error) {
            logger.error(`Error ending video call: ${error.message}`);
            throw error;
        }
    }

    getVideoCallStatus(roomId) {
        return this.activeVideoCalls.get(roomId) || null;
    }

    getAllActiveVideoCalls() {
        return Array.from(this.activeVideoCalls.entries()).map(([roomId, callInfo]) => ({
            roomId,
            ...callInfo
        }));
    }
}

// Create service instance
const videoCallService = new VideoCallService();

// Authentication middleware (simplified)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    // In a real implementation, verify the JWT token
    // For now, we'll assume it's valid if present
    req.user = { id: 'surgeon-001', role: 'surgeon' }; // Mock user
    next();
};

// Routes

/**
 * POST /api/video-call/start
 * Start a video call with field medic
 */
router.post('/start', authenticateToken, async (req, res) => {
    try {
        const { roomId, surgeonId, requestFieldMedic = true } = req.body;

        if (!roomId) {
            return res.status(400).json({
                error: 'Room ID is required'
            });
        }

        const result = await videoCallService.startVideoCall(roomId, surgeonId || req.user.id, {
            requestFieldMedic,
            enableAR: true
        });

        logger.info(`Video call started successfully for room ${roomId}`);
        
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`Start video call error: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/video-call/end
 * End an active video call
 */
router.post('/end', authenticateToken, async (req, res) => {
    try {
        const { roomId, surgeonId } = req.body;

        if (!roomId) {
            return res.status(400).json({
                error: 'Room ID is required'
            });
        }

        const result = await videoCallService.endVideoCall(roomId, surgeonId || req.user.id);

        logger.info(`Video call ended successfully for room ${roomId}`);
        
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`End video call error: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/video-call/status/:roomId
 * Get video call status for a room
 */
router.get('/status/:roomId', authenticateToken, async (req, res) => {
    try {
        const { roomId } = req.params;
        const status = videoCallService.getVideoCallStatus(roomId);

        res.json({
            success: true,
            data: {
                roomId,
                status: status || 'inactive',
                isActive: !!status,
                callInfo: status
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`Get video call status error: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/video-call/active
 * Get all active video calls
 */
router.get('/active', authenticateToken, async (req, res) => {
    try {
        const activeVideoCalls = videoCallService.getAllActiveVideoCalls();

        res.json({
            success: true,
            data: {
                count: activeVideoCalls.length,
                activeVideoCalls
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`Get active video calls error: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/video-call/field-medic/connected
 * Callback endpoint for when field medic connects
 */
router.post('/field-medic/connected', async (req, res) => {
    try {
        const { roomId, fieldMedicId, capabilities } = req.body;

        if (!roomId) {
            return res.status(400).json({
                error: 'Room ID is required'
            });
        }

        // Update video call status
        const callInfo = videoCallService.getVideoCallStatus(roomId);
        if (callInfo) {
            callInfo.fieldMedicConnected = true;
            callInfo.fieldMedicId = fieldMedicId;
            callInfo.fieldMedicCapabilities = capabilities;
            callInfo.status = 'active';
        }

        logger.info(`Field medic connected to video call in room ${roomId}`);

        res.json({
            success: true,
            message: 'Field medic connection recorded',
            data: {
                roomId,
                fieldMedicId,
                status: 'connected'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`Field medic connected callback error: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = { router, videoCallService };