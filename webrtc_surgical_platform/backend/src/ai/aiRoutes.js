const express = require('express');
const multer = require('multer');
const joi = require('joi');

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Accept image and video files
        const allowedMimes = [
            'image/jpeg',
            'image/png',
            'image/bmp',
            'video/mp4',
            'video/avi',
            'video/webm'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images and videos are allowed.'));
        }
    }
});

function createAIRoutes(aiService, authService) {
    const router = express.Router();

    // Validation schemas
    const analysisRequestSchema = joi.object({
        roomId: joi.string().required(),
        analysisType: joi.string().valid(
            'comprehensive',
            'anatomy_only',
            'instruments_only',
            'procedure_phase',
            'risk_assessment',
            'quality_assessment'
        ).default('comprehensive'),
        priority: joi.string().valid('low', 'normal', 'high', 'emergency').default('normal'),
        frameData: joi.string(), // base64 encoded image data
        metadata: joi.object().default({})
    });

    // Apply authentication to all routes
    router.use(authService.authenticate);

    // Analyze video frame
    router.post('/analyze-frame', async (req, res) => {
        try {
            const { error, value } = analysisRequestSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid request data',
                    details: error.details[0].message
                });
            }

            const requestData = {
                ...value,
                userId: req.user.id,
                timestamp: new Date().toISOString()
            };

            const result = await aiService.processVideoFrame(requestData);

            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Upload and analyze image/video file
    router.post('/analyze-file', upload.single('mediaFile'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No file uploaded'
                });
            }

            const { roomId, analysisType = 'comprehensive', priority = 'normal' } = req.body;

            if (!roomId) {
                return res.status(400).json({
                    success: false,
                    error: 'Room ID is required'
                });
            }

            const requestData = {
                roomId,
                analysisType,
                priority,
                frameData: req.file.buffer,
                userId: req.user.id,
                metadata: {
                    originalFilename: req.file.originalname,
                    mimeType: req.file.mimetype,
                    fileSize: req.file.size,
                    uploadedAt: new Date().toISOString()
                }
            };

            const result = await aiService.processVideoFrame(requestData);

            res.json({
                success: true,
                ...result,
                fileInfo: {
                    filename: req.file.originalname,
                    size: req.file.size,
                    type: req.file.mimetype
                }
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get processing status
    router.get('/status/:requestId', async (req, res) => {
        try {
            const { requestId } = req.params;
            
            const status = await aiService.getProcessingStatus(requestId);
            
            if (status.error) {
                return res.status(404).json({
                    success: false,
                    error: status.error
                });
            }

            res.json({
                success: true,
                ...status
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Cancel processing request
    router.delete('/cancel/:requestId', async (req, res) => {
        try {
            const { requestId } = req.params;
            
            const result = await aiService.cancelProcessing(requestId);
            
            if (result.error) {
                return res.status(404).json({
                    success: false,
                    error: result.error
                });
            }

            res.json({
                success: true,
                message: 'Processing request cancelled successfully'
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get system statistics (admin and surgeons only)
    router.get('/system/stats', authService.requireRole(['admin', 'surgeon', 'doctor']), async (req, res) => {
        try {
            const stats = aiService.getSystemStats();

            res.json({
                success: true,
                stats
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get available analysis types
    router.get('/analysis-types', async (req, res) => {
        try {
            const analysisTypes = {
                comprehensive: {
                    name: 'Comprehensive Analysis',
                    description: 'Full analysis including anatomy, instruments, and quality assessment',
                    estimatedTime: 5000,
                    features: ['anatomy_recognition', 'instrument_detection', 'quality_assessment']
                },
                anatomy_only: {
                    name: 'Anatomy Recognition',
                    description: 'Identify anatomical structures in the video frame',
                    estimatedTime: 2000,
                    features: ['organ_detection', 'tissue_classification']
                },
                instruments_only: {
                    name: 'Surgical Instrument Detection',
                    description: 'Detect and classify surgical instruments',
                    estimatedTime: 2000,
                    features: ['instrument_detection', 'tool_tracking']
                },
                procedure_phase: {
                    name: 'Procedure Phase Analysis',
                    description: 'Identify current phase of surgical procedure',
                    estimatedTime: 3000,
                    features: ['phase_recognition', 'progress_tracking']
                },
                risk_assessment: {
                    name: 'Risk Assessment',
                    description: 'Assess potential risks in current surgical state',
                    estimatedTime: 1500,
                    features: ['risk_detection', 'safety_alerts']
                },
                quality_assessment: {
                    name: 'Video Quality Assessment',
                    description: 'Evaluate video quality and provide improvement recommendations',
                    estimatedTime: 1000,
                    features: ['blur_detection', 'lighting_analysis', 'focus_assessment']
                }
            };

            res.json({
                success: true,
                analysisTypes
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get model information (admin only)
    router.get('/models', authService.requireRole(['admin']), async (req, res) => {
        try {
            const models = [];
            
            for (const [name, info] of aiService.models) {
                models.push({
                    name,
                    loadedAt: info.loadedAt,
                    inferenceCount: info.inferenceCount,
                    averageInferenceTime: info.averageInferenceTime,
                    isMock: info.isMock || false,
                    config: {
                        inputSize: info.config.inputSize,
                        labels: info.config.labels,
                        confidence: info.config.confidence,
                        enabled: info.config.enabled
                    }
                });
            }

            res.json({
                success: true,
                models,
                totalModels: models.length
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Batch analysis for multiple frames
    router.post('/analyze-batch', async (req, res) => {
        try {
            const batchRequestSchema = joi.object({
                roomId: joi.string().required(),
                frames: joi.array().items(joi.object({
                    frameData: joi.string().required(),
                    timestamp: joi.string().required(),
                    frameId: joi.string().required()
                })).min(1).max(10).required(), // Limit to 10 frames per batch
                analysisType: joi.string().valid(
                    'comprehensive',
                    'anatomy_only',
                    'instruments_only',
                    'procedure_phase',
                    'quality_assessment'
                ).default('comprehensive'),
                priority: joi.string().valid('low', 'normal', 'high').default('normal')
            });

            const { error, value } = batchRequestSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid batch request data',
                    details: error.details[0].message
                });
            }

            const batchResults = [];
            
            // Process each frame
            for (const frame of value.frames) {
                const requestData = {
                    roomId: value.roomId,
                    analysisType: value.analysisType,
                    priority: value.priority,
                    frameData: frame.frameData,
                    userId: req.user.id,
                    metadata: {
                        frameId: frame.frameId,
                        timestamp: frame.timestamp,
                        batchRequest: true
                    }
                };

                try {
                    const result = await aiService.processVideoFrame(requestData);
                    batchResults.push({
                        frameId: frame.frameId,
                        ...result
                    });
                } catch (frameError) {
                    batchResults.push({
                        frameId: frame.frameId,
                        success: false,
                        error: frameError.message
                    });
                }
            }

            res.json({
                success: true,
                batchId: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                totalFrames: value.frames.length,
                results: batchResults
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Real-time analysis stream endpoint (WebSocket upgrade)
    router.get('/stream/:roomId', async (req, res) => {
        try {
            const { roomId } = req.params;
            
            // Check if user has access to this room
            // In production, validate room access permissions
            
            res.json({
                success: true,
                message: 'Real-time analysis stream endpoint',
                roomId,
                instructions: 'Upgrade to WebSocket connection for real-time frame analysis',
                wsEndpoint: `/ws/ai/stream/${roomId}`
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get analysis history for a room
    router.get('/history/:roomId', async (req, res) => {
        try {
            const { roomId } = req.params;
            const { limit = 50, offset = 0, analysisType } = req.query;

            // In production, implement actual history storage and retrieval
            // For now, return mock data
            const mockHistory = Array.from({ length: parseInt(limit) }, (_, i) => ({
                id: `analysis_${Date.now() - i * 60000}`,
                roomId,
                analysisType: analysisType || 'comprehensive',
                userId: req.user.id,
                timestamp: new Date(Date.now() - i * 60000).toISOString(),
                processingTime: 2000 + Math.random() * 3000,
                confidence: 0.7 + Math.random() * 0.3,
                detectionCount: Math.floor(Math.random() * 5)
            }));

            res.json({
                success: true,
                history: mockHistory,
                pagination: {
                    total: 1000, // Mock total
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: parseInt(offset) + parseInt(limit) < 1000
                }
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Export analysis results
    router.get('/export/:roomId', authService.requireRole(['admin', 'surgeon', 'doctor']), async (req, res) => {
        try {
            const { roomId } = req.params;
            const { format = 'json', startDate, endDate } = req.query;

            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    error: 'Start date and end date are required'
                });
            }

            // In production, implement actual data export
            const exportData = {
                roomId,
                exportedAt: new Date().toISOString(),
                dateRange: { startDate, endDate },
                format,
                summary: {
                    totalAnalyses: 150,
                    averageConfidence: 0.85,
                    mostCommonDetections: ['scalpel', 'forceps', 'tissue']
                },
                data: [] // Would contain actual analysis data
            };

            if (format === 'csv') {
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename=analysis_export_${roomId}_${Date.now()}.csv`);
                res.send('timestamp,analysisType,confidence,detections\n'); // Mock CSV header
            } else {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename=analysis_export_${roomId}_${Date.now()}.json`);
                res.json(exportData);
            }

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Health check for AI service
    router.get('/health', async (req, res) => {
        try {
            const systemStats = aiService.getSystemStats();
            const isHealthy = systemStats.loadedModels.length > 0 && 
                           systemStats.queueSize < 100; // Arbitrary health threshold

            res.json({
                success: true,
                healthy: isHealthy,
                timestamp: new Date().toISOString(),
                models: systemStats.loadedModels.length,
                queueSize: systemStats.queueSize,
                activeJobs: systemStats.activeJobs
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                healthy: false,
                error: error.message
            });
        }
    });

    return router;
}

module.exports = createAIRoutes;