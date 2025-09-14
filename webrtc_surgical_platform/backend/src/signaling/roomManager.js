const { v4: uuidv4 } = require('uuid');

class RoomManager {
    constructor(logger) {
        this.logger = logger;
        this.rooms = new Map(); // roomId -> roomInfo
        this.userRoomMap = new Map(); // userId -> roomId
        this.activeCalls = new Map(); // callId -> callInfo
        
        // Room cleanup interval (every 5 minutes)
        this.cleanupInterval = setInterval(() => {
            this.cleanupEmptyRooms();
        }, 5 * 60 * 1000);
    }

    async createRoom(creatorInfo, roomConfig = {}) {
        try {
            const roomId = roomConfig.roomId || uuidv4();
            const {
                roomType = 'consultation',
                maxParticipants = 10,
                isPrivate = false,
                metadata = {},
                expiresIn = 24 * 60 * 60 * 1000 // 24 hours default
            } = roomConfig;

            const room = {
                id: roomId,
                type: roomType,
                creator: {
                    id: creatorInfo.userId,
                    name: creatorInfo.userName,
                    role: creatorInfo.userRole
                },
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + expiresIn),
                maxParticipants,
                isPrivate,
                metadata,
                participants: [],
                activeCalls: [],
                chatHistory: [],
                fileShares: [],
                annotations: [],
                status: 'active'
            };

            this.rooms.set(roomId, room);

            this.logger.info(`Room created: ${roomId}`, {
                creatorId: creatorInfo.userId,
                roomType,
                isPrivate
            });

            return room;

        } catch (error) {
            this.logger.error('Error creating room:', error);
            throw new Error('Failed to create room');
        }
    }

    async joinRoom(roomId, userInfo, joinOptions = {}) {
        try {
            let room = this.rooms.get(roomId);

            // Create room if it doesn't exist (for ad-hoc rooms)
            if (!room) {
                room = await this.createRoom(userInfo, { 
                    roomId,
                    roomType: joinOptions.roomType || 'consultation',
                    metadata: joinOptions.metadata || {}
                });
            }

            // Check if room is full
            if (room.participants.length >= room.maxParticipants) {
                throw new Error('Room is full');
            }

            // Check if user is already in the room
            const existingParticipant = room.participants.find(p => p.id === userInfo.userId);
            if (existingParticipant) {
                // Update existing participant info
                existingParticipant.lastSeen = new Date();
                existingParticipant.socketId = userInfo.socketId;
                return room;
            }

            // Add user to room
            const participant = {
                id: userInfo.userId,
                name: userInfo.userName,
                role: userInfo.userRole,
                socketId: userInfo.socketId,
                joinedAt: joinOptions.joinedAt || new Date(),
                lastSeen: new Date(),
                isOnline: true,
                permissions: this.getUserPermissions(userInfo.userRole, room.type),
                metadata: joinOptions.metadata || {}
            };

            room.participants.push(participant);
            this.userRoomMap.set(userInfo.userId, roomId);

            // Update room last activity
            room.lastActivity = new Date();

            this.logger.info(`User joined room: ${userInfo.userName} -> ${roomId}`, {
                userId: userInfo.userId,
                participantCount: room.participants.length,
                roomType: room.type
            });

            return room;

        } catch (error) {
            this.logger.error('Error joining room:', error);
            throw error;
        }
    }

    async leaveRoom(roomId, userId) {
        try {
            const room = this.rooms.get(roomId);
            if (!room) {
                return null;
            }

            // Remove user from participants
            const participantIndex = room.participants.findIndex(p => p.id === userId);
            if (participantIndex !== -1) {
                const participant = room.participants[participantIndex];
                room.participants.splice(participantIndex, 1);
                
                this.userRoomMap.delete(userId);
                
                // End any active calls this user is in
                const userCalls = room.activeCalls.filter(call => 
                    call.participants.includes(userId)
                );
                
                for (const call of userCalls) {
                    await this.endCall(call.id, userId);
                }

                // Update room last activity
                room.lastActivity = new Date();

                this.logger.info(`User left room: ${participant.name} -> ${roomId}`, {
                    userId,
                    remainingParticipants: room.participants.length
                });

                // Mark room for cleanup if empty
                if (room.participants.length === 0) {
                    room.status = 'empty';
                    room.emptySince = new Date();
                }
            }

            return room;

        } catch (error) {
            this.logger.error('Error leaving room:', error);
            throw error;
        }
    }

    async getRoomInfo(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) {
            throw new Error('Room not found');
        }

        return {
            ...room,
            participants: room.participants.map(p => ({
                id: p.id,
                name: p.name,
                role: p.role,
                joinedAt: p.joinedAt,
                isOnline: p.isOnline,
                permissions: p.permissions
            }))
        };
    }

    async startCall(roomId, initiatorId, targetId, callOptions = {}) {
        try {
            const room = this.rooms.get(roomId);
            if (!room) {
                throw new Error('Room not found');
            }

            const callId = uuidv4();
            const {
                callType = 'consultation',
                priority = 'normal',
                metadata = {}
            } = callOptions;

            const call = {
                id: callId,
                roomId,
                participants: [initiatorId, targetId],
                initiator: initiatorId,
                type: callType,
                priority,
                status: 'connecting',
                startedAt: new Date(),
                metadata,
                events: []
            };

            // Add to active calls
            this.activeCalls.set(callId, call);
            room.activeCalls.push(call);

            // Update room activity
            room.lastActivity = new Date();

            // Log call event
            call.events.push({
                type: 'call_started',
                userId: initiatorId,
                timestamp: new Date()
            });

            this.logger.info(`Call started: ${callId}`, {
                roomId,
                initiator: initiatorId,
                target: targetId,
                callType
            });

            return call;

        } catch (error) {
            this.logger.error('Error starting call:', error);
            throw error;
        }
    }

    async endCall(callId, userId) {
        try {
            const call = this.activeCalls.get(callId);
            if (!call) {
                return null;
            }

            // Update call status
            call.status = 'ended';
            call.endedAt = new Date();
            call.endedBy = userId;

            // Calculate call duration
            call.duration = call.endedAt - call.startedAt;

            // Log call event
            call.events.push({
                type: 'call_ended',
                userId,
                timestamp: new Date()
            });

            // Remove from active calls
            this.activeCalls.delete(callId);

            // Remove from room's active calls
            const room = this.rooms.get(call.roomId);
            if (room) {
                const callIndex = room.activeCalls.findIndex(c => c.id === callId);
                if (callIndex !== -1) {
                    room.activeCalls.splice(callIndex, 1);
                }
                room.lastActivity = new Date();
            }

            this.logger.info(`Call ended: ${callId}`, {
                roomId: call.roomId,
                duration: call.duration,
                endedBy: userId
            });

            return call;

        } catch (error) {
            this.logger.error('Error ending call:', error);
            throw error;
        }
    }

    getUserPermissions(userRole, roomType) {
        const basePermissions = {
            canChat: true,
            canViewStream: true,
            canShareFiles: true
        };

        // Role-based permissions
        switch (userRole) {
            case 'surgeon':
            case 'doctor':
                return {
                    ...basePermissions,
                    canInitiateCalls: true,
                    canEndCalls: true,
                    canShareScreen: true,
                    canAnnotate: true,
                    canInviteUsers: true,
                    canManageRoom: true,
                    canAccessAI: true
                };

            case 'nurse':
            case 'medical_staff':
                return {
                    ...basePermissions,
                    canInitiateCalls: true,
                    canShareScreen: true,
                    canAnnotate: true,
                    canAccessAI: roomType === 'consultation'
                };

            case 'student':
                return {
                    ...basePermissions,
                    canAnnotate: false,
                    canShareScreen: false
                };

            case 'observer':
                return {
                    canChat: false,
                    canViewStream: true,
                    canShareFiles: false
                };

            default:
                return basePermissions;
        }
    }

    // Room management utilities
    getRoomsForUser(userId) {
        return Array.from(this.rooms.values()).filter(room =>
            room.participants.some(p => p.id === userId)
        );
    }

    getActiveRooms() {
        return Array.from(this.rooms.values()).filter(room =>
            room.status === 'active' && room.participants.length > 0
        );
    }

    getRoomStats() {
        const totalRooms = this.rooms.size;
        const activeRooms = this.getActiveRooms().length;
        const totalParticipants = Array.from(this.rooms.values())
            .reduce((sum, room) => sum + room.participants.length, 0);
        const activeCalls = this.activeCalls.size;

        return {
            totalRooms,
            activeRooms,
            totalParticipants,
            activeCalls,
            timestamp: new Date()
        };
    }

    // Chat and messaging
    addChatMessage(roomId, message) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.chatHistory.push({
                ...message,
                id: uuidv4(),
                timestamp: new Date()
            });

            // Keep only last 100 messages
            if (room.chatHistory.length > 100) {
                room.chatHistory.splice(0, room.chatHistory.length - 100);
            }

            room.lastActivity = new Date();
        }
    }

    addFileShare(roomId, fileInfo) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.fileShares.push({
                ...fileInfo,
                id: uuidv4(),
                timestamp: new Date()
            });

            room.lastActivity = new Date();
        }
    }

    addAnnotation(roomId, annotation) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.annotations.push({
                ...annotation,
                id: uuidv4(),
                timestamp: new Date()
            });

            room.lastActivity = new Date();
        }
    }

    // Cleanup methods
    cleanupEmptyRooms() {
        const now = new Date();
        const emptyRoomThreshold = 10 * 60 * 1000; // 10 minutes
        let cleanedCount = 0;

        for (const [roomId, room] of this.rooms) {
            if (room.status === 'empty' && room.emptySince) {
                const emptySince = now - room.emptySince;
                if (emptySince > emptyRoomThreshold) {
                    this.rooms.delete(roomId);
                    cleanedCount++;
                }
            }

            // Also clean expired rooms
            if (room.expiresAt && now > room.expiresAt) {
                this.rooms.delete(roomId);
                // Remove users from room map
                room.participants.forEach(p => {
                    this.userRoomMap.delete(p.id);
                });
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.logger.info(`Cleaned up ${cleanedCount} empty/expired rooms`);
        }
    }

    // Update participant status
    updateParticipantStatus(roomId, userId, status) {
        const room = this.rooms.get(roomId);
        if (room) {
            const participant = room.participants.find(p => p.id === userId);
            if (participant) {
                participant.isOnline = status === 'online';
                participant.lastSeen = new Date();
                room.lastActivity = new Date();
            }
        }
    }

    // Destroy room manager
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}

module.exports = RoomManager;