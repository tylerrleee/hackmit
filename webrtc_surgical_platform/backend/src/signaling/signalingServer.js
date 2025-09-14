const EventEmitter = require('events');
const ARAnnotationService = require('../ar/arAnnotationService');

class SignalingServer extends EventEmitter {
    constructor(io, roomManager, authService, logger) {
        super();
        this.io = io;
        this.roomManager = roomManager;
        this.authService = authService;
        this.logger = logger;
        this.connectedUsers = new Map(); // socketId -> userInfo
        
        // Initialize AR annotation service
        this.arAnnotationService = new ARAnnotationService(logger);
        this.setupARServiceListeners();
    }
    
    // Setup AR annotation service listeners
    setupARServiceListeners() {
        // Listen for broadcast events from AR service
        this.arAnnotationService.on('broadcast', (data) => {
            const socket = this.io.sockets.sockets.get(data.socketId);
            if (socket) {
                socket.emit(data.data.event, data.data);
            }
        });
        
        // Listen for direct socket messages from AR service
        this.arAnnotationService.on('sendToSocket', (data) => {
            const socket = this.io.sockets.sockets.get(data.socketId);
            if (socket) {
                socket.emit(data.data.event, data.data);
            }
        });
        
        // Log AR service events
        this.arAnnotationService.on('sessionCreated', (data) => {
            this.logger.info('AR session created', data);
        });
        
        this.arAnnotationService.on('sessionEnded', (data) => {
            this.logger.info('AR session ended', data);
        });
        
        this.arAnnotationService.on('annotationAdded', (data) => {
            this.logger.debug('AR annotation added', {
                annotationId: data.annotation.id,
                roomId: data.roomId,
                type: data.annotation.type
            });
        });
    }

    initialize() {
        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
        });
    }

    handleConnection(socket) {
        // Store user connection info
        const userInfo = {
            socketId: socket.id,
            userId: socket.userId,
            userName: socket.userName,
            userRole: socket.userRole,
            connectedAt: new Date(),
            currentRoom: null,
            isInCall: false
        };

        this.connectedUsers.set(socket.id, userInfo);

        // Set up event handlers
        this.setupSocketEventHandlers(socket, userInfo);

        // Emit user connected event
        this.emit('userConnected', userInfo);

        this.logger.info(`Socket connected for user: ${userInfo.userName}`, {
            socketId: socket.id,
            userId: userInfo.userId,
            connectedUsers: this.connectedUsers.size
        });
    }

    setupSocketEventHandlers(socket, userInfo) {
        // Room management
        socket.on('join-room', (data) => this.handleJoinRoom(socket, userInfo, data));
        socket.on('leave-room', (data) => this.handleLeaveRoom(socket, userInfo, data));
        socket.on('get-room-info', (data) => this.handleGetRoomInfo(socket, data));

        // WebRTC signaling
        socket.on('offer', (data) => this.handleOffer(socket, userInfo, data));
        socket.on('answer', (data) => this.handleAnswer(socket, userInfo, data));
        socket.on('ice-candidate', (data) => this.handleIceCandidate(socket, userInfo, data));
        socket.on('renegotiate', (data) => this.handleRenegotiation(socket, userInfo, data));

        // Call management
        socket.on('start-call', (data) => this.handleStartCall(socket, userInfo, data));
        socket.on('end-call', (data) => this.handleEndCall(socket, userInfo, data));
        socket.on('call-status', (data) => this.handleCallStatus(socket, userInfo, data));

        // Chat and messaging
        socket.on('chat-message', (data) => this.handleChatMessage(socket, userInfo, data));
        socket.on('file-share', (data) => this.handleFileShare(socket, userInfo, data));

        // Screen sharing and annotations
        socket.on('screen-share-start', (data) => this.handleScreenShareStart(socket, userInfo, data));
        socket.on('screen-share-stop', (data) => this.handleScreenShareStop(socket, userInfo, data));
        socket.on('annotation', (data) => this.handleAnnotation(socket, userInfo, data));
        
        // AR annotation events
        socket.on('ar-session-create', (data) => this.handleARSessionCreate(socket, userInfo, data));
        socket.on('ar-annotation-add', (data) => this.handleARAnnotationAdd(socket, userInfo, data));
        socket.on('ar-annotations-clear', (data) => this.handleARAnnotationsClear(socket, userInfo, data));
        socket.on('ar-session-info', (data) => this.handleARSessionInfo(socket, userInfo, data));

        // Emergency and priority events
        socket.on('emergency-call', (data) => this.handleEmergencyCall(socket, userInfo, data));
        socket.on('priority-request', (data) => this.handlePriorityRequest(socket, userInfo, data));

        // Disconnect handling
        socket.on('disconnect', (reason) => this.handleDisconnect(socket, userInfo, reason));
        socket.on('error', (error) => this.handleSocketError(socket, userInfo, error));
    }

    // Room Management Handlers
    async handleJoinRoom(socket, userInfo, data) {
        try {
            const { roomId, roomType = 'consultation', metadata = {} } = data;

            if (!roomId) {
                socket.emit('error', { message: 'Room ID is required' });
                return;
            }

            // Validate room access permissions
            const hasAccess = await this.validateRoomAccess(userInfo, roomId, roomType);
            if (!hasAccess) {
                socket.emit('error', { message: 'Access denied to room' });
                return;
            }

            // Leave current room if in one
            if (userInfo.currentRoom) {
                await this.handleLeaveRoom(socket, userInfo, { roomId: userInfo.currentRoom });
            }

            // Join the room
            const roomInfo = await this.roomManager.joinRoom(roomId, userInfo, {
                roomType,
                metadata,
                joinedAt: new Date()
            });

            socket.join(roomId);
            userInfo.currentRoom = roomId;

            // Add participant to AR annotation service if session exists
            try {
                this.arAnnotationService.addParticipant(roomId, socket.id, userInfo);
            } catch (error) {
                // AR session might not exist yet, which is fine
                this.logger.debug('No AR session found for room (this is normal):', roomId);
            }

            // Notify other room members
            socket.to(roomId).emit('user-joined', {
                user: {
                    id: userInfo.userId,
                    name: userInfo.userName,
                    role: userInfo.userRole,
                    socketId: socket.id
                },
                roomInfo
            });

            // Send room info to the joining user
            socket.emit('room-joined', {
                roomId,
                roomInfo,
                participants: roomInfo.participants
            });

            this.logger.info(`User ${userInfo.userName} joined room ${roomId}`, {
                userId: userInfo.userId,
                roomType,
                participantCount: roomInfo.participants.length
            });

        } catch (error) {
            this.logger.error('Error joining room:', error);
            socket.emit('error', { message: 'Failed to join room' });
        }
    }

    async handleLeaveRoom(socket, userInfo, data) {
        try {
            const roomId = data?.roomId || userInfo.currentRoom;

            if (!roomId) {
                return; // Not in a room
            }

            const roomInfo = await this.roomManager.leaveRoom(roomId, userInfo.userId);
            
            socket.leave(roomId);
            userInfo.currentRoom = null;
            userInfo.isInCall = false;

            // Notify other room members
            socket.to(roomId).emit('user-left', {
                userId: userInfo.userId,
                userName: userInfo.userName,
                roomInfo
            });

            socket.emit('room-left', { roomId });

            this.logger.info(`User ${userInfo.userName} left room ${roomId}`, {
                userId: userInfo.userId,
                remainingParticipants: roomInfo?.participants?.length || 0
            });

        } catch (error) {
            this.logger.error('Error leaving room:', error);
        }
    }

    async handleGetRoomInfo(socket, data) {
        try {
            const { roomId } = data;
            const roomInfo = await this.roomManager.getRoomInfo(roomId);
            
            socket.emit('room-info', roomInfo);
        } catch (error) {
            this.logger.error('Error getting room info:', error);
            socket.emit('error', { message: 'Failed to get room info' });
        }
    }

    // WebRTC Signaling Handlers
    handleOffer(socket, userInfo, data) {
        const { targetUserId, offer, callId } = data;

        if (!userInfo.currentRoom) {
            socket.emit('error', { message: 'Must be in a room to make calls' });
            return;
        }

        // Find target user's socket
        const targetSocket = this.findUserSocket(targetUserId);
        if (!targetSocket) {
            socket.emit('error', { message: 'Target user not found' });
            return;
        }

        // Forward offer to target user
        targetSocket.emit('offer', {
            fromUserId: userInfo.userId,
            fromUserName: userInfo.userName,
            offer,
            callId,
            roomId: userInfo.currentRoom
        });

        this.logger.info(`WebRTC offer sent from ${userInfo.userName} to ${targetUserId}`, {
            callId,
            roomId: userInfo.currentRoom
        });
    }

    handleAnswer(socket, userInfo, data) {
        const { targetUserId, answer, callId } = data;

        const targetSocket = this.findUserSocket(targetUserId);
        if (!targetSocket) {
            socket.emit('error', { message: 'Target user not found' });
            return;
        }

        // Forward answer to target user
        targetSocket.emit('answer', {
            fromUserId: userInfo.userId,
            fromUserName: userInfo.userName,
            answer,
            callId
        });

        this.logger.info(`WebRTC answer sent from ${userInfo.userName} to ${targetUserId}`, {
            callId
        });
    }

    handleIceCandidate(socket, userInfo, data) {
        const { targetUserId, candidate, callId } = data;

        const targetSocket = this.findUserSocket(targetUserId);
        if (!targetSocket) {
            return; // Silently ignore if target not found (they may have disconnected)
        }

        // Forward ICE candidate to target user
        targetSocket.emit('ice-candidate', {
            fromUserId: userInfo.userId,
            candidate,
            callId
        });
    }

    handleRenegotiation(socket, userInfo, data) {
        const { targetUserId, offer, callId } = data;

        const targetSocket = this.findUserSocket(targetUserId);
        if (!targetSocket) {
            socket.emit('error', { message: 'Target user not found for renegotiation' });
            return;
        }

        targetSocket.emit('renegotiate', {
            fromUserId: userInfo.userId,
            offer,
            callId
        });
    }

    // Call Management Handlers
    async handleStartCall(socket, userInfo, data) {
        try {
            const { targetUserId, callType = 'consultation', priority = 'normal' } = data;

            if (!userInfo.currentRoom) {
                socket.emit('error', { message: 'Must be in a room to start calls' });
                return;
            }

            const callInfo = await this.roomManager.startCall(
                userInfo.currentRoom,
                userInfo.userId,
                targetUserId,
                { callType, priority }
            );

            userInfo.isInCall = true;

            // Notify room participants
            this.io.to(userInfo.currentRoom).emit('call-started', {
                callId: callInfo.id,
                initiator: userInfo.userId,
                target: targetUserId,
                callType,
                startedAt: callInfo.startedAt
            });

            this.logger.info(`Call started between ${userInfo.userName} and ${targetUserId}`, {
                callId: callInfo.id,
                roomId: userInfo.currentRoom,
                callType
            });

        } catch (error) {
            this.logger.error('Error starting call:', error);
            socket.emit('error', { message: 'Failed to start call' });
        }
    }

    async handleEndCall(socket, userInfo, data) {
        try {
            const { callId } = data;

            await this.roomManager.endCall(callId, userInfo.userId);

            userInfo.isInCall = false;

            // Notify room participants
            if (userInfo.currentRoom) {
                this.io.to(userInfo.currentRoom).emit('call-ended', {
                    callId,
                    endedBy: userInfo.userId,
                    endedAt: new Date()
                });
            }

            this.logger.info(`Call ended by ${userInfo.userName}`, {
                callId,
                roomId: userInfo.currentRoom
            });

        } catch (error) {
            this.logger.error('Error ending call:', error);
        }
    }

    handleCallStatus(socket, userInfo, data) {
        const { status, callId, metadata = {} } = data;

        if (userInfo.currentRoom) {
            socket.to(userInfo.currentRoom).emit('call-status-update', {
                userId: userInfo.userId,
                status,
                callId,
                metadata,
                timestamp: new Date()
            });
        }
    }

    // Utility Methods
    findUserSocket(userId) {
        for (const [socketId, userInfo] of this.connectedUsers) {
            if (userInfo.userId === userId) {
                return this.io.sockets.sockets.get(socketId);
            }
        }
        return null;
    }

    async validateRoomAccess(userInfo, roomId, roomType) {
        // Implement role-based access control
        const { userRole } = userInfo;

        // For now, allow all authenticated users
        // In production, implement proper RBAC
        return true;
    }

    handleChatMessage(socket, userInfo, data) {
        if (userInfo.currentRoom) {
            socket.to(userInfo.currentRoom).emit('chat-message', {
                from: userInfo.userName,
                fromId: userInfo.userId,
                message: data.message,
                timestamp: new Date(),
                messageId: data.messageId
            });
        }
    }

    handleFileShare(socket, userInfo, data) {
        if (userInfo.currentRoom) {
            socket.to(userInfo.currentRoom).emit('file-shared', {
                from: userInfo.userName,
                fromId: userInfo.userId,
                fileName: data.fileName,
                fileSize: data.fileSize,
                fileType: data.fileType,
                fileId: data.fileId,
                timestamp: new Date()
            });
        }
    }

    handleScreenShareStart(socket, userInfo, data) {
        if (userInfo.currentRoom) {
            socket.to(userInfo.currentRoom).emit('screen-share-started', {
                userId: userInfo.userId,
                userName: userInfo.userName,
                sessionId: data.sessionId,
                timestamp: new Date()
            });
        }
    }

    handleScreenShareStop(socket, userInfo, data) {
        if (userInfo.currentRoom) {
            socket.to(userInfo.currentRoom).emit('screen-share-stopped', {
                userId: userInfo.userId,
                sessionId: data.sessionId,
                timestamp: new Date()
            });
        }
    }

    handleAnnotation(socket, userInfo, data) {
        if (userInfo.currentRoom) {
            socket.to(userInfo.currentRoom).emit('annotation', {
                from: userInfo.userName,
                fromId: userInfo.userId,
                annotation: data.annotation,
                timestamp: new Date()
            });
        }
    }
    
    // AR Annotation Handlers
    async handleARSessionCreate(socket, userInfo, data) {
        try {
            if (!userInfo.currentRoom) {
                socket.emit('ar-error', { message: 'Must be in a room to create AR session' });
                return;
            }
            
            const sessionConfig = {
                medicalMode: true,
                precisionLevel: data.precisionLevel || 'high',
                maxAnnotations: data.maxAnnotations || 1000,
                ...data.config
            };
            
            const session = this.arAnnotationService.createSession(
                userInfo.currentRoom, 
                userInfo.userId, 
                sessionConfig
            );
            
            socket.emit('ar-session-created', {
                sessionId: session.id,
                roomId: session.roomId,
                config: session.config
            });
            
            // Notify room participants
            socket.to(userInfo.currentRoom).emit('ar-session-available', {
                sessionId: session.id,
                createdBy: userInfo.userName,
                config: session.config
            });
            
        } catch (error) {
            socket.emit('ar-error', { message: error.message });
        }
    }
    
    async handleARAnnotationAdd(socket, userInfo, data) {
        try {
            if (!userInfo.currentRoom) {
                socket.emit('ar-error', { message: 'Must be in a room to add annotations' });
                return;
            }
            
            const annotation = this.arAnnotationService.addAnnotation(
                userInfo.currentRoom,
                socket.id,
                data
            );
            
            // Confirmation back to sender
            socket.emit('ar-annotation-added', {
                annotationId: annotation.id,
                status: 'success'
            });
            
        } catch (error) {
            socket.emit('ar-error', { message: error.message });
        }
    }
    
    async handleARAnnotationsClear(socket, userInfo, data) {
        try {
            if (!userInfo.currentRoom) {
                socket.emit('ar-error', { message: 'Must be in a room to clear annotations' });
                return;
            }
            
            const result = this.arAnnotationService.clearAnnotations(
                userInfo.currentRoom,
                socket.id,
                data.clearType || 'all'
            );
            
            socket.emit('ar-annotations-clear-result', result);
            
        } catch (error) {
            socket.emit('ar-error', { message: error.message });
        }
    }
    
    async handleARSessionInfo(socket, userInfo, data) {
        try {
            const roomId = data.roomId || userInfo.currentRoom;
            if (!roomId) {
                socket.emit('ar-error', { message: 'Room ID required' });
                return;
            }
            
            const sessionInfo = this.arAnnotationService.getSessionInfo(roomId);
            
            socket.emit('ar-session-info', {
                sessionInfo,
                serviceStats: this.arAnnotationService.getStats()
            });
            
        } catch (error) {
            socket.emit('ar-error', { message: error.message });
        }
    }

    handleEmergencyCall(socket, userInfo, data) {
        // Implement emergency call routing
        this.logger.warn(`Emergency call from ${userInfo.userName}`, {
            userId: userInfo.userId,
            roomId: userInfo.currentRoom,
            emergency: data
        });

        if (userInfo.currentRoom) {
            socket.to(userInfo.currentRoom).emit('emergency-call', {
                from: userInfo.userName,
                fromId: userInfo.userId,
                emergency: data,
                timestamp: new Date()
            });
        }
    }

    handlePriorityRequest(socket, userInfo, data) {
        // Handle priority consultation requests
        this.logger.info(`Priority request from ${userInfo.userName}`, {
            userId: userInfo.userId,
            request: data
        });
    }

    handleDisconnect(socket, userInfo, reason) {
        try {
            // Leave current room
            if (userInfo.currentRoom) {
                this.handleLeaveRoom(socket, userInfo, {});
            }

            // Remove from connected users
            this.connectedUsers.delete(socket.id);

            this.emit('userDisconnected', userInfo);

            this.logger.info(`User disconnected: ${userInfo.userName}`, {
                socketId: socket.id,
                userId: userInfo.userId,
                reason,
                connectedUsers: this.connectedUsers.size
            });

        } catch (error) {
            this.logger.error('Error handling disconnect:', error);
        }
    }

    handleSocketError(socket, userInfo, error) {
        this.logger.error(`Socket error for user ${userInfo.userName}:`, error);
        
        // Attempt to recover or disconnect gracefully
        socket.emit('error', { 
            message: 'Connection error occurred', 
            shouldReconnect: true 
        });
    }

    // Public Methods
    getConnectedUsers() {
        return Array.from(this.connectedUsers.values());
    }

    getUsersInRoom(roomId) {
        return Array.from(this.connectedUsers.values())
            .filter(user => user.currentRoom === roomId);
    }

    broadcastToRoom(roomId, event, data) {
        this.io.to(roomId).emit(event, data);
    }

    broadcastToAll(event, data) {
        this.io.emit(event, data);
    }
}

module.exports = SignalingServer;