const EventEmitter = require('events');

class ARAnnotationService extends EventEmitter {
    constructor(logger) {
        super();
        this.logger = logger;
        
        // In-memory storage for active annotation sessions
        this.activeSessions = new Map(); // roomId -> session data
        this.annotations = new Map(); // sessionId -> annotations array
        this.participants = new Map(); // roomId -> Set of socketIds
        
        // Annotation data structures
        this.annotationTypes = {
            DRAW: 'draw',
            ARROW: 'arrow',
            CIRCLE: 'circle',
            RECTANGLE: 'rectangle',
            TEXT: 'text',
            ANCHOR: 'anchor',
            CLEAR: 'clear'
        };
        
        // Performance tracking
        this.stats = {
            totalSessions: 0,
            activeAnnotations: 0,
            messagesPerSecond: 0,
            lastMessageTime: Date.now(),
            messageCount: 0
        };
        
        // Start performance monitoring
        this.startPerformanceMonitoring();
    }
    
    // Initialize a new AR annotation session for a room
    createSession(roomId, creatorId, sessionConfig = {}) {
        try {
            const sessionId = this.generateSessionId();
            const session = {
                id: sessionId,
                roomId,
                creatorId,
                createdAt: new Date(),
                isActive: true,
                config: {
                    maxAnnotations: sessionConfig.maxAnnotations || 1000,
                    retentionTime: sessionConfig.retentionTime || 24 * 60 * 60 * 1000, // 24 hours
                    medicalMode: sessionConfig.medicalMode || true,
                    precisionLevel: sessionConfig.precisionLevel || 'high', // high, medium, low
                    ...sessionConfig
                },
                participants: new Set(),
                metadata: {
                    totalAnnotations: 0,
                    lastActivity: new Date()
                }
            };
            
            this.activeSessions.set(roomId, session);
            this.annotations.set(sessionId, []);
            this.participants.set(roomId, new Set());
            
            this.stats.totalSessions++;
            
            this.logger.info('AR annotation session created', {
                sessionId,
                roomId,
                creatorId,
                config: session.config
            });
            
            this.emit('sessionCreated', { sessionId, roomId, session });
            
            return session;
            
        } catch (error) {
            this.logger.error('Failed to create AR annotation session:', error);
            throw error;
        }
    }
    
    // Add participant to annotation session
    addParticipant(roomId, socketId, userInfo) {
        try {
            const session = this.activeSessions.get(roomId);
            if (!session) {
                throw new Error(`No active session found for room: ${roomId}`);
            }
            
            const participants = this.participants.get(roomId);
            participants.add(socketId);
            session.participants.add(socketId);
            
            this.logger.info('Participant added to AR session', {
                sessionId: session.id,
                roomId,
                socketId,
                userId: userInfo.userId,
                totalParticipants: participants.size
            });
            
            this.emit('participantJoined', { sessionId: session.id, roomId, socketId, userInfo });
            
            // Send existing annotations to new participant
            this.sendAnnotationHistory(socketId, session.id);
            
            return session;
            
        } catch (error) {
            this.logger.error('Failed to add participant to AR session:', error);
            throw error;
        }
    }
    
    // Remove participant from annotation session
    removeParticipant(roomId, socketId) {
        try {
            const session = this.activeSessions.get(roomId);
            if (!session) {
                return false;
            }
            
            const participants = this.participants.get(roomId);
            participants.delete(socketId);
            session.participants.delete(socketId);
            
            this.logger.info('Participant removed from AR session', {
                sessionId: session.id,
                roomId,
                socketId,
                remainingParticipants: participants.size
            });
            
            this.emit('participantLeft', { sessionId: session.id, roomId, socketId });
            
            // Clean up session if no participants left
            if (participants.size === 0) {
                this.endSession(roomId);
            }
            
            return true;
            
        } catch (error) {
            this.logger.error('Failed to remove participant from AR session:', error);
            return false;
        }
    }
    
    // Add annotation to session
    addAnnotation(roomId, socketId, annotationData) {
        try {
            const session = this.activeSessions.get(roomId);
            if (!session || !session.isActive) {
                throw new Error(`No active session found for room: ${roomId}`);
            }
            
            // Validate annotation data
            this.validateAnnotationData(annotationData);
            
            // Create annotation object
            const annotation = {
                id: this.generateAnnotationId(),
                sessionId: session.id,
                authorId: socketId,
                timestamp: new Date(),
                type: annotationData.type,
                data: annotationData.data,
                metadata: {
                    precision: session.config.precisionLevel,
                    medicalContext: annotationData.medicalContext || null,
                    ...annotationData.metadata
                }
            };
            
            // Add to annotations storage
            const sessionAnnotations = this.annotations.get(session.id);
            sessionAnnotations.push(annotation);
            
            // Update session metadata
            session.metadata.totalAnnotations++;
            session.metadata.lastActivity = new Date();
            this.stats.activeAnnotations++;
            this.stats.messageCount++;
            
            this.logger.debug('Annotation added', {
                annotationId: annotation.id,
                sessionId: session.id,
                roomId,
                type: annotation.type,
                authorId: socketId
            });
            
            this.emit('annotationAdded', { annotation, roomId, session });
            
            // Broadcast to all participants except sender
            this.broadcastAnnotation(roomId, socketId, annotation);
            
            return annotation;
            
        } catch (error) {
            this.logger.error('Failed to add annotation:', error);
            throw error;
        }
    }
    
    // Validate annotation data
    validateAnnotationData(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid annotation data');
        }
        
        if (!data.type || !Object.values(this.annotationTypes).includes(data.type)) {
            throw new Error('Invalid annotation type');
        }
        
        if (!data.data) {
            throw new Error('Missing annotation data');
        }
        
        // Type-specific validation
        switch (data.type) {
            case this.annotationTypes.DRAW:
                if (!Array.isArray(data.data.points) || data.data.points.length < 2) {
                    throw new Error('Draw annotation requires at least 2 points');
                }
                break;
                
            case this.annotationTypes.ARROW:
                if (!data.data.start || !data.data.end) {
                    throw new Error('Arrow annotation requires start and end points');
                }
                break;
                
            case this.annotationTypes.TEXT:
                if (!data.data.text || !data.data.position) {
                    throw new Error('Text annotation requires text and position');
                }
                break;
        }
        
        return true;
    }
    
    // Broadcast annotation to room participants
    broadcastAnnotation(roomId, senderSocketId, annotation) {
        try {
            const participants = this.participants.get(roomId);
            if (!participants) {
                return;
            }
            
            const broadcastData = {
                event: 'ar-annotation',
                annotation,
                roomId,
                timestamp: Date.now()
            };
            
            // Broadcast to all participants except sender
            participants.forEach(socketId => {
                if (socketId !== senderSocketId) {
                    this.emit('broadcast', { socketId, data: broadcastData });
                }
            });
            
            this.logger.debug('Annotation broadcasted', {
                annotationId: annotation.id,
                roomId,
                recipients: participants.size - 1
            });
            
        } catch (error) {
            this.logger.error('Failed to broadcast annotation:', error);
        }
    }
    
    // Send annotation history to participant
    sendAnnotationHistory(socketId, sessionId) {
        try {
            const annotations = this.annotations.get(sessionId);
            if (!annotations || annotations.length === 0) {
                return;
            }
            
            const historyData = {
                event: 'ar-annotation-history',
                sessionId,
                annotations,
                timestamp: Date.now()
            };
            
            this.emit('sendToSocket', { socketId, data: historyData });
            
            this.logger.debug('Annotation history sent', {
                sessionId,
                socketId,
                annotationCount: annotations.length
            });
            
        } catch (error) {
            this.logger.error('Failed to send annotation history:', error);
        }
    }
    
    // Clear annotations for session
    clearAnnotations(roomId, socketId, clearType = 'all') {
        try {
            const session = this.activeSessions.get(roomId);
            if (!session) {
                throw new Error(`No active session found for room: ${roomId}`);
            }
            
            const annotations = this.annotations.get(session.id);
            let clearedCount = 0;
            
            if (clearType === 'all') {
                clearedCount = annotations.length;
                annotations.length = 0; // Clear array
            } else if (clearType === 'own') {
                const originalLength = annotations.length;
                this.annotations.set(session.id, annotations.filter(ann => ann.authorId !== socketId));
                clearedCount = originalLength - annotations.length;
            }
            
            // Update stats
            this.stats.activeAnnotations = Math.max(0, this.stats.activeAnnotations - clearedCount);
            session.metadata.totalAnnotations = Math.max(0, session.metadata.totalAnnotations - clearedCount);
            
            const clearData = {
                event: 'ar-annotations-cleared',
                sessionId: session.id,
                roomId,
                clearType,
                clearedBy: socketId,
                clearedCount,
                timestamp: Date.now()
            };
            
            // Broadcast clear event
            const participants = this.participants.get(roomId);
            participants.forEach(participantSocketId => {
                this.emit('sendToSocket', { socketId: participantSocketId, data: clearData });
            });
            
            this.logger.info('Annotations cleared', {
                sessionId: session.id,
                roomId,
                clearType,
                clearedBy: socketId,
                clearedCount
            });
            
            return { success: true, clearedCount };
            
        } catch (error) {
            this.logger.error('Failed to clear annotations:', error);
            throw error;
        }
    }
    
    // End annotation session
    endSession(roomId) {
        try {
            const session = this.activeSessions.get(roomId);
            if (!session) {
                return false;
            }
            
            session.isActive = false;
            session.endedAt = new Date();
            
            // Archive session data (in production, save to database)
            this.archiveSession(session);
            
            // Clean up memory
            this.activeSessions.delete(roomId);
            this.annotations.delete(session.id);
            this.participants.delete(roomId);
            
            this.logger.info('AR annotation session ended', {
                sessionId: session.id,
                roomId,
                duration: session.endedAt - session.createdAt,
                totalAnnotations: session.metadata.totalAnnotations
            });
            
            this.emit('sessionEnded', { sessionId: session.id, roomId, session });
            
            return true;
            
        } catch (error) {
            this.logger.error('Failed to end AR annotation session:', error);
            return false;
        }
    }
    
    // Archive session data
    archiveSession(session) {
        // In production, implement database storage
        this.logger.debug('Session archived', {
            sessionId: session.id,
            roomId: session.roomId,
            annotations: session.metadata.totalAnnotations,
            duration: (session.endedAt - session.createdAt) / 1000
        });
    }
    
    // Get session information
    getSessionInfo(roomId) {
        const session = this.activeSessions.get(roomId);
        if (!session) {
            return null;
        }
        
        const annotations = this.annotations.get(session.id) || [];
        const participants = this.participants.get(roomId) || new Set();
        
        return {
            sessionId: session.id,
            roomId: session.roomId,
            isActive: session.isActive,
            createdAt: session.createdAt,
            participantCount: participants.size,
            annotationCount: annotations.length,
            lastActivity: session.metadata.lastActivity,
            config: session.config
        };
    }
    
    // Get service statistics
    getStats() {
        const now = Date.now();
        const timeDiff = (now - this.stats.lastMessageTime) / 1000;
        const messagesPerSecond = timeDiff > 0 ? this.stats.messageCount / timeDiff : 0;
        
        return {
            ...this.stats,
            messagesPerSecond: Math.round(messagesPerSecond * 100) / 100,
            activeSessions: this.activeSessions.size,
            memoryUsage: process.memoryUsage()
        };
    }
    
    // Start performance monitoring
    startPerformanceMonitoring() {
        setInterval(() => {
            this.stats.messagesPerSecond = 0;
            this.stats.messageCount = 0;
            this.stats.lastMessageTime = Date.now();
        }, 1000); // Reset every second
    }
    
    // Utility methods
    generateSessionId() {
        return `ar_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    generateAnnotationId() {
        return `ar_ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

module.exports = ARAnnotationService;